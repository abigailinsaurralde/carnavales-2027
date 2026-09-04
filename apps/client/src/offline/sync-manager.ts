import type {
  SyncPlanillaPayload,
  SyncPlanillasRequest,
  SyncPlanillasResult,
} from "@votaciones2027/shared-types";
import { nextRetryDelayMs, type BackoffOptions } from "./backoff.js";
import type { Clock } from "./clock.js";
import type { Connectivity } from "./connectivity.js";
import { createId } from "./id.js";
import type { OfflineStore } from "./store.js";
import type { SyncTransport, SyncTransportResult } from "./transport.js";
import {
  canSyncPlanillaStatus,
  toSyncVotePayload,
  type LocalPlanilla,
  type LocalVote,
  type LocalSyncState,
  type OutboxError,
  type OutboxOperation,
} from "./types.js";

export interface SyncSnapshot {
  online: boolean;
  pending: number;
  syncing: number;
  synced: number;
  failed: number;
}

export interface SyncManagerOptions {
  store: OfflineStore;
  transport: SyncTransport;
  connectivity: Connectivity;
  clock: Clock;
  maxAttempts?: number;
  backoff: BackoffOptions;
  onStatusChange?: (snapshot: SyncSnapshot) => void;
}

export interface DrainOutcome {
  attempted: number;
  synced: number;
  failed: number;
  retried: number;
}

/**
 * Gestor de sincronización offline-first (cola de salida / outbox).
 *
 * Garantías:
 *  - PERSISTENCIA: las operaciones viven en `OfflineStore`; una pérdida de
 *    conexión o un cierre de la app no descarta operaciones pendientes.
 *  - COALESCE: una sola operación por planilla; ediciones durante el vuelo
 *    se re-encolan al terminar la respuesta (revisión).
 *  - REINTENTO: fallos de red/timeout/5xx se reintentan con backoff
 *    exponencial + jitter y tope de intentos (`maxAttempts`); 4xx no
 *    recuperables pasan a FAILED con diagnóstico conservado.
 *  - NO PERDER: jamás se marca SYNCED sin confirmación del servidor.
 *  - CONFIRMACION server-side: el cliente no envía estados terminales; una
 *    planilla local terminal se considera sin nada que sincronizar.
 */
export class SyncManager {
  private readonly store: OfflineStore;
  private readonly transport: SyncTransport;
  private readonly connectivity: Connectivity;
  private readonly clock: Clock;
  private readonly maxAttempts: number;
  private readonly backoff: BackoffOptions;
  private readonly onStatusChange: ((snapshot: SyncSnapshot) => void) | undefined;
  private readonly inFlight = new Set<string>();
  private retryTimer: unknown = undefined;
  private started = false;
  private drainDepth = 0;
  private readonly idleWaiters: Array<() => void> = [];
  private readonly unsubscribeConnectivity: () => void;

  constructor(options: SyncManagerOptions) {
    this.store = options.store;
    this.transport = options.transport;
    this.connectivity = options.connectivity;
    this.clock = options.clock;
    this.maxAttempts = options.maxAttempts ?? 8;
    this.backoff = options.backoff;
    this.onStatusChange = options.onStatusChange;

    this.unsubscribeConnectivity = this.connectivity.subscribe(() => {
      this.emitStatus();
      if (this.connectivity.isOnline()) {
        void this.syncAllOnce();
      }
    });
  }

  /**
   * Persiste una planilla con sus votos y deja una operación PENDING en la
   * cola (coalescida por planilla). Si hay conectividad, dispara el drenado.
   */
  async enqueuePlanilla(
    planilla: LocalPlanilla,
    votes: LocalVote[],
  ): Promise<OutboxOperation> {
    const nowIso = this.clock.nowIso();

    this.store.savePlanilla({ ...planilla, updatedAt: planilla.updatedAt });
    for (const vote of votes) {
      const persisted: LocalVote = {
        id: vote.id,
        planillaId: vote.planillaId,
        nightId: vote.nightId,
        comparsaId: vote.comparsaId,
        rubroId: vote.rubroId,
        itemId: vote.itemId,
        candidateId: vote.candidateId,
        score: vote.score,
        idempotencyKey: vote.idempotencyKey,
        syncState: "PENDING",
        updatedAt: vote.updatedAt,
        ...(vote.clientRef === undefined ? {} : { clientRef: vote.clientRef }),
      };
      this.store.saveVote(persisted);
    }

    const payload = this.buildPayload(
      planilla,
      this.store.loadVotesByPlanilla(planilla.id),
    );
    const existing = this.store.findOperationByPlanilla(planilla.id);
    const operation: OutboxOperation =
      existing === null
        ? this.newOperation(planilla, payload, nowIso)
        : {
            id: existing.id,
            kind: existing.kind,
            resource: existing.resource,
            planillaId: planilla.id,
            payload,
            state: "PENDING",
            attempts: 0,
            revision: existing.revision + 1,
            createdAt: existing.createdAt,
            updatedAt: nowIso,
          };

    this.store.saveOperation(operation);
    this.emitStatus();

    if (this.connectivity.isOnline()) {
      void this.syncAllOnce();
    }
    return operation;
  }

  /**
   * Drena la cola una vez: procesa en orden todas las operaciones PENDING
   * (o SYNCING huérfanas) que estén habilitadas y fuera de vuelo.
   */
  async syncAllOnce(): Promise<DrainOutcome> {
    this.drainDepth += 1;
    try {
      const outcome: DrainOutcome = {
        attempted: 0,
        synced: 0,
        failed: 0,
        retried: 0,
      };
      if (!this.connectivity.isOnline()) return outcome;

      for (;;) {
        const candidate = this.nextCandidate();
        if (candidate === undefined) break;
        const result = await this.processOperation(candidate);
        outcome.attempted += 1;
        if (result === "SYNCED") outcome.synced += 1;
        if (result === "FAILED") outcome.failed += 1;
        if (result === "RETRYABLE") outcome.retried += 1;
      }

      this.emitStatus();
      return outcome;
    } finally {
      this.drainDepth -= 1;
      if (this.drainDepth === 0) {
        const waiters = this.idleWaiters.splice(0);
        for (const resolve of waiters) resolve();
      }
    }
  }

  /**
   * Resuelve cuando no quede ningún drenado en curso. Útil para esperar de
   * forma determinista la reconciliación completa (tests / wiring).
   */
  whenIdle(): Promise<void> {
    if (this.drainDepth === 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.idleWaiters.push(resolve);
    });
  }

  getSnapshot(): SyncSnapshot {
    const ops = this.store.listOperations();
    const count = (state: OutboxOperation["state"]): number =>
      ops.filter((op) => op.state === state).length;
    return {
      online: this.connectivity.isOnline(),
      pending: count("PENDING"),
      syncing: count("SYNCING"),
      synced: count("SYNCED"),
      failed: count("FAILED"),
    };
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.emitStatus();
    if (this.connectivity.isOnline()) {
      void this.syncAllOnce();
    }
  }

  stop(): void {
    this.started = false;
    this.unsubscribeConnectivity();
    if (this.retryTimer !== undefined) {
      this.clock.clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
  }

  disconnect(): void {
    this.stop();
  }

  // ---------------------------------------------------------------- internos

  private nextCandidate(): OutboxOperation | undefined {
    const nowIso = this.clock.nowIso();
    return this.store
      .listOperations()
      .filter((op) => !this.inFlight.has(op.id))
      .filter((op) => (op as { state: string }).state === "PENDING" || (op as { state: string }).state === "SYNCING")
      .filter(
        (op) =>
          op.nextAttemptAt === undefined || op.nextAttemptAt <= nowIso,
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  }

  private async processOperation(
    op: OutboxOperation,
  ): Promise<"SYNCED" | "FAILED" | "RETRYABLE"> {
    this.inFlight.add(op.id);
    try {
      const planilla = this.store.loadPlanilla(op.planillaId);
      if (planilla === null) {
        await this.fail(op, {
          code: "PLANILLA_LOST_LOCALLY",
          message: "La planilla local referida por la cola dejó de existir",
          retryable: false,
        });
        return "FAILED";
      }

      // Planilla local terminal (confirmada/cerrada): el servidor no acepta
      // estados terminales y la confirmación es server-side. No hay nada que
      // sincronizar: la operación se considera satisfecha.
      if (!canSyncPlanillaStatus(planilla.status)) {
        this.store.saveOperation({
          id: op.id,
          kind: op.kind,
          resource: op.resource,
          planillaId: op.planillaId,
          payload: op.payload,
          state: "SYNCED",
          attempts: op.attempts,
          revision: op.revision,
          createdAt: op.createdAt,
          updatedAt: this.clock.nowIso(),
        });
        this.markVotes(planilla.id, "SYNCED");
        return "SYNCED";
      }

      const nowIso = this.clock.nowIso();
      const attempts = op.attempts + 1;
      const syncing: OutboxOperation = {
        id: op.id,
        kind: op.kind,
        resource: op.resource,
        planillaId: op.planillaId,
        payload: op.payload,
        state: "SYNCING",
        attempts,
        revision: op.revision,
        createdAt: op.createdAt,
        updatedAt: nowIso,
        lastAttemptAt: nowIso,
      };
      this.store.saveOperation(syncing);

      const request: SyncPlanillasRequest = {
        planillas: [
          this.buildPayload(
            planilla,
            this.store.loadVotesByPlanilla(op.planillaId),
          ),
        ],
      };

      const result = await this.transport.syncPlanillas(request);

      if (!result.ok) {
        return await this.handleTransportFailure(syncing, result);
      }
      return await this.reconcile(syncing, result.data);
    } finally {
      this.inFlight.delete(op.id);
    }
  }

  private async handleTransportFailure(
    op: OutboxOperation,
    result: Extract<SyncTransportResult, { ok: false }>,
  ): Promise<"RETRYABLE" | "FAILED"> {
    const retryable = this.isRetryableTransportFailure(result);

    if (!retryable) {
      const error: OutboxError = {
        code:
          result.kind === "HTTP"
            ? `HTTP_${result.status ?? 0}`
            : result.kind,
        message: this.transportFailureMessage(result),
        retryable: false,
        ...(result.body === undefined ? {} : { details: result.body }),
      };
      await this.fail(op, error);
      this.markVotes(op.planillaId, "FAILED", error.message);
      return "FAILED";
    }

    if (op.attempts >= this.maxAttempts) {
      const error: OutboxError = {
        code: "MAX_ATTEMPTS",
        message: this.transportFailureMessage(result),
        retryable: true,
        ...(result.body === undefined ? {} : { details: result.body }),
      };
      await this.fail(op, error);
      this.markVotes(op.planillaId, "FAILED", error.message);
      return "FAILED";
    }

    const delayMs = nextRetryDelayMs(op.attempts, this.backoff);
    const nextAttemptAt = this.clock.iso(
      this.clock.nowMs() + delayMs,
    );
    this.store.saveOperation({
      id: op.id,
      kind: op.kind,
      resource: op.resource,
      planillaId: op.planillaId,
      payload: op.payload,
      state: "PENDING",
      attempts: op.attempts,
      revision: op.revision,
      createdAt: op.createdAt,
      updatedAt: this.clock.nowIso(),
      ...(op.lastAttemptAt === undefined ? {} : { lastAttemptAt: op.lastAttemptAt }),
      nextAttemptAt,
      lastError: {
        code:
          result.kind === "HTTP" ? `HTTP_${result.status ?? 0}` : result.kind,
        message: this.transportFailureMessage(result),
        retryable: true,
        ...(result.body === undefined ? {} : { details: result.body }),
      },
    });
    this.scheduleRetry(delayMs);
    return "RETRYABLE";
  }

  /**
   * Reconciliación con la respuesta del servidor: mapea ids, marca votos y
   * decide si la operación quedó satisfecha, parcial o en conflicto. Ediciones
   * locales ocurridas durante el vuelo (revisión mayor) re-encolan la
   * operación para enviar la versión nueva.
   */
  private async reconcile(
    op: OutboxOperation,
    data: SyncPlanillasResult,
  ): Promise<"SYNCED" | "FAILED"> {
    const nowIso = this.clock.nowIso();

    // El op fue re-encolado durante el vuelo (revisión mayor): la respuesta
    // corresponde a la versión vieja ya enviada. No marcar SYNCED ni
    // reconciliar los votos porque el payload local es más reciente; el
    // siguiente ciclo del drenado envía el payload nuevo.
    const latestOp = this.store.loadOperation(op.id);
    if (
      latestOp !== null &&
      latestOp.state === "PENDING" &&
      latestOp.revision > op.revision
    ) {
      return "SYNCED";
    }

    const planillaResult = data.planillas[0];

    if (planillaResult === undefined) {
      await this.fail(op, {
        code: "EMPTY_SYNC_RESPONSE",
        message: "El servidor respondió sin resultados de sincronización",
        retryable: false,
        details: data,
      });
      return "FAILED";
    }

    if (planillaResult.planillaAction === "CONFLICT") {
      const error: OutboxError = {
        code: "PLANILLA_CONFLICT",
        message: planillaResult.reason ?? "Conflicto de planilla en el servidor",
        retryable: false,
        details: data,
      };
      await this.fail(op, error);
      this.markVotes(op.planillaId, "FAILED", error.message);
      return "FAILED";
    }

    // Reconciliar el id de la planilla en el dispositivo.
    let currentOp = op;
    const serverPlanillaId = planillaResult.planillaId;
    if (serverPlanillaId !== op.planillaId) {
      this.remapPlanillaId(op.planillaId, serverPlanillaId);
      currentOp = {
        id: op.id,
        kind: op.kind,
        resource: op.resource,
        planillaId: serverPlanillaId,
        payload: op.payload,
        state: op.state,
        attempts: op.attempts,
        revision: op.revision,
        createdAt: op.createdAt,
        updatedAt: nowIso,
      };
      this.store.saveOperation(currentOp);
    }

    // Reconciliar votos (payload enviado vs respuesta del servidor).
    let rejectedCount = 0;
    for (const voteResult of planillaResult.votes) {
      const local = this.store.loadVote(serverPlanillaId, voteResult.id);
      if (local === null) continue;
      if (voteResult.action === "REJECTED") {
        rejectedCount += 1;
        this.store.saveVote({
          ...local,
          syncState: "FAILED",
          error: voteResult.reason ?? "Rechazado por el servidor",
          updatedAt: nowIso,
        });
      } else {
        this.store.saveVote({ ...local, syncState: "SYNCED", updatedAt: nowIso });
      }
    }

    if (rejectedCount > 0) {
      this.store.saveOperation({
        ...currentOp,
        state: "SYNCED",
        lastError: {
          code: "PARTIAL",
          message: `${rejectedCount} voto(s) rechazado(s) por el servidor`,
          retryable: false,
          details: planillaResult,
        },
        updatedAt: nowIso,
      });
    } else {
      this.store.saveOperation({ ...currentOp, state: "SYNCED", updatedAt: nowIso });
    }

    return "SYNCED";
  }

  private isRetryableTransportFailure(
    result: Extract<SyncTransportResult, { ok: false }>,
  ): boolean {
    if (result.kind === "NETWORK" || result.kind === "TIMEOUT") return true;
    if (result.kind !== "HTTP") return false;
    const status = result.status ?? 0;
    return status >= 500 || status === 429;
  }

  private transportFailureMessage(
    result: Extract<SyncTransportResult, { ok: false }>,
  ): string {
    if (result.kind === "NETWORK") {
      return "No se pudo contactar el servidor (sin conexión de red)";
    }
    if (result.kind === "TIMEOUT") {
      return "El servidor no respondió a tiempo";
    }
    return `El servidor respondió con estado HTTP ${result.status ?? "desconocido"}`;
  }

  private async fail(op: OutboxOperation, error: OutboxError): Promise<void> {
    this.store.saveOperation({
      id: op.id,
      kind: op.kind,
      resource: op.resource,
      planillaId: op.planillaId,
      payload: op.payload,
      state: "FAILED",
      attempts: op.attempts,
      revision: op.revision,
      createdAt: op.createdAt,
      updatedAt: this.clock.nowIso(),
      lastError: error,
    });
  }

  private markVotes(
    planillaId: string,
    state: Extract<LocalSyncState, "SYNCED" | "FAILED">,
    error?: string,
  ): void {
    const nowIso = this.clock.nowIso();
    for (const vote of this.store.loadVotesByPlanilla(planillaId)) {
      this.store.saveVote({
        id: vote.id,
        planillaId: vote.planillaId,
        nightId: vote.nightId,
        comparsaId: vote.comparsaId,
        rubroId: vote.rubroId,
        itemId: vote.itemId,
        candidateId: vote.candidateId,
        score: vote.score,
        idempotencyKey: vote.idempotencyKey,
        syncState: state,
        updatedAt: nowIso,
        ...(vote.clientRef === undefined ? {} : { clientRef: vote.clientRef }),
        ...(error === undefined ? {} : { error }),
      });
    }
  }

  private remapPlanillaId(oldId: string, newId: string): void {
    const nowIso = this.clock.nowIso();
    const planilla = this.store.loadPlanilla(oldId);
    if (planilla !== null) {
      this.store.savePlanilla({
        id: newId,
        nightId: planilla.nightId,
        clientRef: planilla.clientRef,
        status: planilla.status,
        updatedAt: nowIso,
      });
      this.store.removePlanilla(oldId);
    }
    for (const vote of this.store.loadVotesByPlanilla(oldId)) {
      this.store.saveVote({ ...vote, planillaId: newId, updatedAt: nowIso });
      this.store.removeVote(oldId, vote.id);
    }
  }

  private newOperation(
    planilla: LocalPlanilla,
    payload: SyncPlanillaPayload,
    createdAt: string,
  ): OutboxOperation {
    return {
      id: createId(),
      kind: "SYNC_PLANILLA",
      resource: "PLANILLA",
      planillaId: planilla.id,
      payload,
      state: "PENDING",
      attempts: 0,
      revision: 1,
      createdAt,
      updatedAt: createdAt,
    };
  }

  private buildPayload(
    planilla: LocalPlanilla,
    votes: LocalVote[],
  ): SyncPlanillaPayload {
    return {
      planilla: {
        id: planilla.id,
        nightId: planilla.nightId,
        clientRef: planilla.clientRef,
      },
      votes: votes.map((vote) => toSyncVotePayload(vote)),
    };
  }

  private scheduleRetry(delayMs: number): void {
    if (this.retryTimer !== undefined) return;
    this.retryTimer = this.clock.setTimeout(() => {
      this.retryTimer = undefined;
      if (this.connectivity.isOnline()) {
        void this.syncAllOnce();
      }
    }, delayMs);
  }

  private emitStatus(): void {
    if (this.onStatusChange !== undefined) {
      this.onStatusChange(this.getSnapshot());
    }
  }
}