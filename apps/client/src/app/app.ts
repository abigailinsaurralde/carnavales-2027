import type {
  AuthenticatedUser,
  ConfirmPlanillaResult,
  JudgeContextResponse,
  PlanillaSummary,
  Planilla,
  Vote,
} from "@votaciones2027/shared-types";
import {
  ApiClient,
  errorCode,
  type ApiResult,
} from "../api/client.js";
import { createSessionStore, type SessionStore } from "../api/session.js";
import type {
  Connectivity,
  DrainOutcome,
  KVStorage,
  LocalPlanilla,
  LocalVote,
  OfflineStore,
  OutboxOperation,
  SyncSnapshot,
} from "../offline/index.js";
import {
  buildSheet,
  canConfirmPlanilla,
  isEditable,
  voteKey,
  type SheetModel,
} from "../ui/sheet.js";
import { friendlyError } from "../ui/vocab.js";
import { createRouter, type Router } from "../ui/router.js";

export interface PlanillaCard {
  planillaId: string;
  nightId: string;
  nightNumber: number;
  specialty: string;
  status: string;
  confirmedAt?: string;
  votesCount: number;
  localSync: "ok" | "pending" | "syncing" | "error" | "none";
  updatedAt: string;
  isLocalOnly: boolean;
  creationPending: boolean;
}

/**
 * Estado de la pantalla de acceso.
 *
 * - `mode === "judge"` es el acceso principal del PMV: correo + DNI + código
 *   temporal de un solo uso (SVC2-31). El paso 1 pide el código (`identify`);
 *   el paso 2 lo canjea por una sesión (`awaiting-token`).
 * - `mode === "operator"` conserva el acceso por contraseña para roles
 *   operativos (ADMIN / ESCRIBANO_VEEDOR).
 *
 * El email y el DNI del paso 1 se conservan en memoria para el canje; el
 * código temporal (token de acceso) NUNCA se persiste ni se muestra en la UI.
 */
export interface LoginView {
  mode: "judge" | "operator";
  judgeStep: "identify" | "awaiting-token";
  judgeEmail: string;
  judgeDni: string;
}

function defaultLoginView(): LoginView {
  return { mode: "judge", judgeStep: "identify", judgeEmail: "", judgeDni: "" };
}

export interface DetailView {
  planillaId: string;
  nightNumber: number;
  specialty: string;
  status: string;
  confirmedAt?: string;
  sheet: SheetModel;
  planillaSync: "ok" | "pending" | "syncing" | "error" | "none";
  canConfirm: boolean;
  blockedReasons: string[];
  reviewing: boolean;
  confirmOpen: boolean;
  busy: boolean;
  pickedVoteKey?: string;
}

export interface AppViewState {
  route: ReturnType<Router["get"]>;
  user: AuthenticatedUser | null;
  online: boolean;
  snapshot: SyncSnapshot;
  context: JudgeContextResponse | null;
  planillas: PlanillaCard[];
  detail: DetailView | null;
  notice: { text: string; tone: "info" | "success" | "error" } | null;
  login: LoginView;
}

export interface AppServices {
  api: ApiClient;
  store: OfflineStore;
  sync: SyncSource;
  connectivity: Connectivity;
  session: SessionStore;
  router: Router;
  cache: KVStorage;
  clock: { nowIso(): string };
  createId(): string;
}

/**
 * Superficie del gestor de sincronización que consume la aplicación. La
 * instancia real (`SyncManager`) emite cambios por constructor; esta fachada
 * enruta ese canal a suscriptores posteriores.
 */
export interface SyncSource {
  getSnapshot(): SyncSnapshot;
  whenStatusChanges(listener: (snapshot: SyncSnapshot) => void): () => void;
  syncAllOnce(): Promise<DrainOutcome>;
  enqueuePlanilla(planilla: LocalPlanilla, votes: LocalVote[]): Promise<OutboxOperation>;
}

const CONTEXT_CACHE_KEY = "cache.context";

export class JudgeApp {
  private readonly services: AppServices;
  private readonly listeners = new Set<() => void>();
  private detailServer: { planilla: Planilla; votes: Vote[] } | null = null;

  private state: AppViewState = {
    route: { name: "login" },
    user: null,
    online: true,
    snapshot: { online: true, pending: 0, syncing: 0, synced: 0, failed: 0 },
    context: null,
    planillas: [],
    detail: null,
    notice: null,
    login: defaultLoginView(),
  };

  constructor(services: AppServices) {
    this.services = services;
    services.session.subscribe(() => void this.onSessionChange());
    services.router.subscribe(() => void this.onRoute());
    services.connectivity.subscribe(() => {
      this.state.online = services.connectivity.isOnline();
      this.emit();
      if (services.connectivity.isOnline()) {
        void this.refreshIfNeeded();
      }
    });
    services.sync.whenStatusChanges((snapshot) => {
      this.state.snapshot = snapshot;
      this.emit();
      void this.refreshIfNeeded();
    });
  }

  async boot(): Promise<void> {
    await this.loadCachedContext();
    await this.refreshIfNeeded();
    this.emit();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): AppViewState {
    return this.state;
  }

  private emit(): void {
    for (const listener of Array.from(this.listeners)) listener();
  }

  // ---- Sesión ----

  private async onSessionChange(): Promise<void> {
    this.state.user = this.services.session.getUser();
    const signedIn = this.services.session.isSignedIn();
    const route = this.services.router.get();
    if (!signedIn && route.name !== "login") {
      this.services.router.navigate({ name: "login" });
      this.state.detail = null;
      this.state.context = null;
      this.emit();
      return;
    }
    if (signedIn && route.name === "login") {
      this.services.router.navigate({ name: "home" });
      return;
    }
    if (signedIn && route.name === "home") {
      await this.refreshAssignments();
      this.emit();
    }
  }

  async login(email: string, password: string): Promise<void> {
    const result = await this.services.api.login({ email, password });
    if (!result.ok) {
      this.showLoginError(result);
      return;
    }
    this.services.session.set(result.data.token, result.data.user);
    this.services.router.navigate({ name: "home" });
    this.emit();
  }

  /**
   * Paso 1 del acceso del juez: pide la emisión del código temporal
   * (correo + DNI). El token plano devuelto por el servidor es el punto de
   * entrega fuera de banda (mesa de votación): NO se conserva, NO se persiste
   * y NO se expone en la pantalla; solo se confirma la emisión.
   */
  async requestAccessToken(email: string, dni: string): Promise<void> {
    const result = await this.services.api.issueAccessToken({ email, dni });
    if (!result.ok) {
      this.showAccessTokenIssueError(result);
      return;
    }
    this.state.login = {
      mode: "judge",
      judgeStep: "awaiting-token",
      judgeEmail: email,
      judgeDni: dni,
    };
    this.setNotice(
      "Código de acceso emitido. Te lo entrega la mesa de votación.",
      "success",
    );
  }

  /** Paso 2 del acceso del juez: canjea el código temporal por una sesión. */
  async loginWithAccessToken(
    email: string,
    dni: string,
    token: string,
  ): Promise<void> {
    const result = await this.services.api.loginWithAccessToken({
      email,
      dni,
      token,
    });
    if (!result.ok) {
      this.showAccessTokenExchangeError(result);
      return;
    }
    this.services.session.set(result.data.token, result.data.user);
    this.resetLoginView();
    this.services.router.navigate({ name: "home" });
    this.emit();
  }

  /**
   * Cambia entre el acceso del juez (código temporal) y el acceso operativo
   * (contraseña). Al volver al modo juez se reinicia al paso 1 (identificación)
   * para permitir pedir un código nuevo.
   */
  setLoginMode(mode: "judge" | "operator"): void {
    this.state.login = {
      mode,
      judgeStep: "identify",
      judgeEmail: "",
      judgeDni: "",
    };
    this.emit();
  }

  private resetLoginView(): void {
    this.state.login = defaultLoginView();
  }

  async logout(): Promise<void> {
    const token = this.services.session.getToken();
    if (token !== null) {
      await this.services.api.logout();
    }
    this.services.session.clear();
    this.state.context = null;
    this.state.planillas = [];
    this.state.detail = null;
    this.resetLoginView();
    this.services.router.navigate({ name: "login" });
    this.emit();
  }

  // ---- Contexto y planillas ----

  private async loadCachedContext(): Promise<void> {
    if (this.state.context !== null) return;
    const raw = this.services.cache.get(CONTEXT_CACHE_KEY);
    if (raw === null) return;
    try {
      const parsed = JSON.parse(raw) as JudgeContextResponse;
      if (parsed !== null && typeof parsed === "object") {
        this.state.context = parsed;
      }
    } catch {
      this.services.cache.remove(CONTEXT_CACHE_KEY);
    }
  }

  private persistContext(context: JudgeContextResponse): void {
    this.services.cache.set(CONTEXT_CACHE_KEY, JSON.stringify(context));
  }

  private async refreshIfNeeded(): Promise<void> {
    const signedIn = this.services.session.isSignedIn();
    const route = this.services.router.get();
    if (!signedIn || !this.state.online) return;
    if (route.name === "home" || route.name === "login") {
      await this.refreshAssignments();
    }
  }

  private async refreshAssignments(): Promise<void> {
    if (!this.services.session.isSignedIn() || !this.state.online) return;

    const [contextRes, planillasRes] = await Promise.all([
      this.services.api.judgeContext(),
      this.services.api.listPlanillas(),
    ]);
    if (isUnauthorized(contextRes) || isUnauthorized(planillasRes)) {
      this.expireSession();
      return;
    }
    if (contextRes.ok) {
      this.state.context = contextRes.data;
      this.persistContext(contextRes.data);
    }
    const serverPlanillas: PlanillaSummary[] = planillasRes.ok
      ? planillasRes.data
      : [];
    this.state.planillas = this.buildPlanillaCards(
      this.state.context,
      serverPlanillas,
    );
    this.emit();
  }

  private buildPlanillaCards(
    context: JudgeContextResponse | null,
    serverPlanillas: PlanillaSummary[],
  ): PlanillaCard[] {
    const byNight = new Map<string, PlanillaSummary>();
    for (const p of serverPlanillas) byNight.set(p.nightId, p);

    const byLocalNight = new Map<string, LocalPlanilla>();
    for (const id of this.services.store.listPlanillaIds()) {
      const lp = this.services.store.loadPlanilla(id);
      if (lp !== null) byLocalNight.set(lp.nightId, lp);
    }

    const cards: PlanillaCard[] = [];
    const assignments = context === null ? [] : context.assignments;

    for (const assignment of assignments) {
      const night = context?.nights.find((n) => n.id === assignment.nightId);
      const nightNumber = night?.number ?? 0;

      const serverP = byNight.get(assignment.nightId);
      const localP = byLocalNight.get(assignment.nightId);
      if (serverP !== undefined) {
        const votesCount = localP !== undefined
          ? this.services.store.loadVotesByPlanilla(localP.id).length
          : serverP.votesCount;
        cards.push({
          planillaId: serverP.id,
          nightId: assignment.nightId,
          nightNumber,
          specialty: assignment.specialty,
          status: serverP.status,
          ...(serverP.confirmedAt === undefined ? {} : { confirmedAt: serverP.confirmedAt }),
          votesCount,
          localSync: this.localSyncOf(serverP.id),
          updatedAt: localP?.updatedAt ?? serverP.updatedAt,
          isLocalOnly: false,
          creationPending: this.isPlanillaPending(serverP.id),
        });
      } else if (localP !== undefined) {
        cards.push({
          planillaId: localP.id,
          nightId: assignment.nightId,
          nightNumber,
          specialty: assignment.specialty,
          status: localP.status,
          votesCount: this.services.store.loadVotesByPlanilla(localP.id).length,
          localSync: this.localSyncOf(localP.id),
          updatedAt: localP.updatedAt,
          isLocalOnly: true,
          creationPending: this.isPlanillaPending(localP.id),
        });
      } else {
        cards.push({
          planillaId: "",
          nightId: assignment.nightId,
          nightNumber,
          specialty: assignment.specialty,
          status: "NO_PLANILLA",
          votesCount: 0,
          localSync: "none",
          updatedAt: "",
          isLocalOnly: false,
          creationPending: false,
        });
      }
    }
    return cards;
  }

  private localSyncOf(planillaId: string): PlanillaCard["localSync"] {
    const votes = this.services.store.loadVotesByPlanilla(planillaId);
    if (votes.some((v) => v.syncState === "FAILED")) return "error";
    const op = this.services.store.findOperationByPlanilla(planillaId);
    if (op === null) return votes.some((v) => v.syncState === "PENDING") ? "pending" : "none";
    switch (op.state) {
      case "PENDING":
        return "pending";
      case "SYNCING":
        return "syncing";
      case "FAILED":
        return "error";
      default:
        return "ok";
    }
  }

  private isPlanillaPending(planillaId: string): boolean {
    const op = this.services.store.findOperationByPlanilla(planillaId);
    return (
      op !== null && (op.state === "PENDING" || op.state === "SYNCING")
    );
  }

  async createPlanilla(nightId: string): Promise<void> {
    const planillaId = this.services.createId();
    const now = this.services.clock.nowIso();
    const local: LocalPlanilla = {
      id: planillaId,
      nightId,
      clientRef: `planilla-${planillaId}`,
      status: "BORRADOR",
      updatedAt: now,
    };
    await this.services.sync.enqueuePlanilla(local, []);
    await this.refreshAssignmentsIfPossible();
    this.services.router.navigate({ name: "planilla", planillaId });
    this.emit();
  }

  private async refreshAssignmentsIfPossible(): Promise<void> {
    if (this.state.online) {
      await this.refreshAssignments();
    }
  }

  // ---- Detalle / hoja de notas ----

  async openPlanilla(planillaId: string): Promise<void> {
    this.state.detail = null;
    this.emit();

    this.detailServer = null;
    if (this.state.online) {
      const result = await this.services.api.planilla(planillaId);
      if (isUnauthorized(result)) {
        this.expireSession();
        return;
      }
      if (result.ok) {
        this.detailServer = result.data;
        this.reconcileLocal(planillaId);
      } else {
        const code = errorCode(result.body);
        if (code === "NOT_FOUND") {
          this.setNotice(
            "No se encontró la planilla en el servidor. Se mantiene la copia de este dispositivo.",
            "info",
          );
        }
      }
    }
    await this.renderDetail(planillaId);
  }

  private reconcileLocal(planillaId: string): void {
    const server = this.detailServer;
    if (server === null) return;

    const planilla: LocalPlanilla = {
      id: server.planilla.id,
      nightId: server.planilla.nightId,
      clientRef: `planilla-${server.planilla.id}`,
      status: server.planilla.status,
      updatedAt: this.services.clock.nowIso(),
    };
    this.services.store.savePlanilla(planilla);

    const existing = this.services.store.loadVotesByPlanilla(planillaId);
    const localByKey = new Map<string, LocalVote>();
    for (const lv of existing) localByKey.set(voteKey(lv), lv);

    for (const v of server.votes) {
      const key = voteKey(v);
      const current = localByKey.get(key);
      // No pisar una edición local pendiente por sincronizar.
      if (current !== undefined && current.syncState !== "SYNCED") continue;
      const mirrored: LocalVote = {
        id: v.id,
        planillaId,
        nightId: server.planilla.nightId,
        comparsaId: v.comparsaId,
        rubroId: v.rubroId,
        itemId: v.itemId,
        candidateId: v.candidateId,
        score: v.score,
        idempotencyKey: v.idempotencyKey,
        syncState: "SYNCED",
        updatedAt: this.services.clock.nowIso(),
      };
      this.services.store.saveVote(mirrored);
    }
  }

  private async renderDetail(planillaId: string): Promise<void> {
    const context = this.state.context;
    const local = this.services.store.loadPlanilla(planillaId);
    if (local === null) {
      this.setNotice("No se encontró la planilla.", "error");
      this.services.router.navigate({ name: "home" });
      return;
    }
    const assignment = context?.assignments.find(
      (a) => a.nightId === local.nightId,
    );
    const specialty = assignment?.specialty ?? "";
    const nightNumber =
      context?.nights.find((n) => n.id === local.nightId)?.number ?? 0;

    const localVotes = this.services.store.loadVotesByPlanilla(planillaId);
    const sheet = buildSheet(
      context ?? emptyContext(),
      assignment ?? emptyAssignment(local.nightId, specialty),
      this.detailServer?.votes ?? [],
      localVotes,
    );

    const op = this.services.store.findOperationByPlanilla(planillaId);
    const planillaSync = this.planillaSyncState(op, localVotes);
    // La cola está "en vuelo" si hay una operación sin confirmación del
    // servidor (PENDING/SYNCING/FAILED) o alguna nota rechazada (FAILED): en
    // cualquiera de esos casos el servidor aún no tiene la versión definitiva
    // y confirmar podría convertir votos intencionales en omisiones.
    const hasPendingSync =
      (op !== null && op.state !== "SYNCED") ||
      localVotes.some((v) => v.syncState === "FAILED");

    const blockedReasons = this.blockReasons(
      local.status,
      hasPendingSync,
      this.state.online,
    );
    const canConfirm = canConfirmPlanilla({
      planillaStatus: local.status,
      online: this.state.online,
      hasPendingSync,
      confirmedAlready: local.status === "CONFIRMADA",
    });

    const confirmedAt =
      this.detailServer?.planilla.confirmedAt ?? localConfirmedAt(local);

    this.state.detail = {
      planillaId,
      nightNumber,
      specialty,
      status: local.status,
      ...(confirmedAt === undefined ? {} : { confirmedAt }),
      sheet,
      planillaSync,
      canConfirm,
      blockedReasons,
      reviewing: false,
      confirmOpen: false,
      busy: false,
      ...(this.state.detail?.pickedVoteKey === undefined
        ? {}
        : { pickedVoteKey: this.state.detail.pickedVoteKey }),
    };
    this.emit();
  }

  private blockReasons(
    status: string,
    hasPendingSync: boolean,
    online: boolean,
  ): string[] {
    const reasons: string[] = [];
    if (!isEditable(status) && status !== "NO_PLANILLA") {
      reasons.push("La planilla ya está confirmada. No se puede modificar.");
    }
    if (!online) {
      reasons.push("Sin conexión: tus notas se guardan en este dispositivo.");
    }
    if (hasPendingSync) {
      reasons.push("Hay notas sin sincronizar. Esperá a que sincronicen antes de confirmar.");
    }
    return reasons;
  }

  private planillaSyncState(
    op: LocalPlanillaSyncOp | null,
    votes: LocalVote[],
  ): DetailView["planillaSync"] {
    if (votes.some((v) => v.syncState === "FAILED") || (op !== null && op.state === "FAILED")) {
      return "error";
    }
    if (op !== null && op.state === "SYNCING") return "syncing";
    if (op !== null && op.state === "PENDING") return "pending";
    return "ok";
  }

  // ---- Notas ----

  async setScore(
    planillaId: string,
    cell: { comparsaId: string; rubroId: string; itemId: string },
    candidateId: string,
    score: number,
  ): Promise<void> {
    const local = this.services.store.loadPlanilla(planillaId);
    if (local === null || !isEditable(local.status)) return;

    const votes = this.services.store.loadVotesByPlanilla(planillaId);
    const now = this.services.clock.nowIso();
    const existing = votes.find((v) => v.candidateId === candidateId);
    const voteId = existing?.id ?? this.services.createId();
    const idempotencyKey =
      existing?.idempotencyKey ?? this.services.createId();

    const vote: LocalVote = {
      id: voteId,
      planillaId,
      nightId: local.nightId,
      comparsaId: cell.comparsaId,
      rubroId: cell.rubroId,
      itemId: cell.itemId,
      candidateId,
      score,
      idempotencyKey,
      syncState: "PENDING",
      updatedAt: now,
    };
    this.services.store.saveVote(vote);

    const planilla: LocalPlanilla = { ...local, updatedAt: now };
    await this.services.sync.enqueuePlanilla(planilla, [
      ...votes.filter((v) => v.candidateId !== candidateId),
      vote,
    ]);
    await this.renderDetail(planillaId);
  }

  // ---- Revisión y confirmación ----

  setReviewing(on: boolean): void {
    const detail = this.state.detail;
    if (detail === null) return;
    this.state.detail = { ...detail, reviewing: on };
    this.emit();
  }

  setConfirmOpen(on: boolean): void {
    const detail = this.state.detail;
    if (detail === null) return;
    this.state.detail = { ...detail, confirmOpen: on };
    this.emit();
  }

  setPickedVoteKey(key: string | undefined): void {
    const detail = this.state.detail;
    if (detail === null) return;
    const next = { ...detail };
    if (key === undefined) {
      delete next.pickedVoteKey;
    } else {
      next.pickedVoteKey = key;
    }
    this.state.detail = next;
    this.emit();
  }

  async confirmPlanilla(): Promise<void> {
    const detail = this.state.detail;
    if (detail === null || !detail.canConfirm) return;
    this.state.detail = { ...detail, busy: true, confirmOpen: false };
    this.emit();

    const result = await this.services.api.confirmPlanilla(detail.planillaId);
    if (!result.ok) {
      if (isUnauthorized(result)) {
        this.expireSession();
        return;
      }
      this.state.detail = { ...this.state.detail!, busy: false };
      this.setNotice(friendlyError(result.kind, result.body), "error");
      return;
    }

    this.applyConfirmedDetail(result);
    this.state.detail = { ...this.state.detail!, busy: false, reviewing: false, confirmOpen: false };
    this.setNotice(
      result.data.votesConfirmed + result.data.omissionsInserted > 0
        ? `Planilla confirmada. ${result.data.votesConfirmed} nota(s) y ${result.data.omissionsInserted} omisión(es) quedaron fijas.`
        : "Planilla confirmada. No puede modificarse.",
      "success",
    );
    void this.refreshAssignmentsIfPossible();
    await this.renderDetail(detail.planillaId);
  }

  private applyConfirmedDetail(result: { ok: true; data: ConfirmPlanillaResult }): void {
    const detail = this.state.detail;
    if (detail === null) return;
    const planillaId = detail.planillaId;
    const prev = this.services.store.loadPlanilla(planillaId);
    const planilla: LocalPlanilla = {
      id: planillaId,
      nightId: prev?.nightId ?? this.detailServer?.planilla.nightId ?? "",
      clientRef: `planilla-${planillaId}`,
      status: "CONFIRMADA",
      updatedAt: this.services.clock.nowIso(),
    };
    this.services.store.savePlanilla(planilla);

    for (const vote of this.services.store.loadVotesByPlanilla(planillaId)) {
      this.services.store.saveVote({ ...vote, syncState: "SYNCED" });
    }
    const op = this.services.store.findOperationByPlanilla(planillaId);
    if (op !== null) {
      this.services.store.saveOperation({ ...op, state: "SYNCED" });
    }
  }

  async retrySync(): Promise<void> {
    if (!this.state.online) {
      this.setNotice("Sin conexión. Reintentá cuando estés conectado.", "info");
      return;
    }
    const res = await this.services.sync.syncAllOnce();
    if (res.attempted === 0 && res.synced === 0 && res.failed === 0) {
      this.setNotice("Nada pendiente de sincronizar.", "info");
      return;
    }
    if (res.failed > 0) {
      this.setNotice("No se pudo sincronizar todo. Reintentá.", "error");
      return;
    }
    this.setNotice(
      res.synced > 0 ? "Sincronizado." : "Nada pendiente de sincronizar.",
      res.synced > 0 ? "success" : "info",
    );
    const detail = this.state.detail;
    if (detail !== null) {
      await this.openPlanilla(detail.planillaId);
    }
  }

  // ---- Utilidades ----

  /**
   * Maneja los fallos de transporte comunes a todos los flujos de acceso.
   * Devuelve true si el error ya fue mostrado (red/timeout).
   */
  private showAuthTransportError(result: ApiResult<unknown>): boolean {
    if (result.ok) return false;
    if (result.kind === "NETWORK") {
      this.setNotice("Sin conexión. Revisá tu conexión e intentá de nuevo.", "error");
      return true;
    }
    if (result.kind === "TIMEOUT") {
      this.setNotice("El servidor no respondió. Intentá de nuevo.", "error");
      return true;
    }
    return false;
  }

  private showLoginError(result: ApiResult<unknown>): void {
    if (result.ok) return;
    if (this.showAuthTransportError(result)) return;
    const code = errorCode(result.body);
    if (code === "INVALID_CREDENTIALS") {
      this.setNotice("Email o contraseña incorrectos.", "error");
      return;
    }
    this.setNotice(friendlyError(result.kind, result.body), "error");
  }

  /** Errores de la emisión del código temporal (correo + DNI). */
  private showAccessTokenIssueError(result: ApiResult<unknown>): void {
    if (result.ok) return;
    if (this.showAuthTransportError(result)) return;
    const code = errorCode(result.body);
    if (code === "INVALID_CREDENTIALS") {
      this.setNotice(
        "No se encontró un juez con ese correo y DNI. Revisá los datos.",
        "error",
      );
      return;
    }
    this.setNotice(friendlyError(result.kind, result.body), "error");
  }

  /** Errores del canje del código temporal por sesión. */
  private showAccessTokenExchangeError(result: ApiResult<unknown>): void {
    if (result.ok) return;
    if (this.showAuthTransportError(result)) return;
    const code = errorCode(result.body);
    if (code === "INVALID_CREDENTIALS") {
      this.setNotice(
        "El código no es válido, venció o ya fue usado. Pedí un código nuevo.",
        "error",
      );
      return;
    }
    this.setNotice(friendlyError(result.kind, result.body), "error");
  }

  setNotice(text: string, tone: "info" | "success" | "error"): void {
    this.state.notice = { text, tone };
    this.emit();
  }

  private expireSession(): void {
    this.services.session.clear();
    this.state.context = null;
    this.state.planillas = [];
    this.state.detail = null;
    this.resetLoginView();
    this.services.router.navigate({ name: "login" });
    this.emit();
  }

  private async onRoute(): Promise<void> {
    const route = this.services.router.get();
    this.state.route = route;
    if (route.name === "planilla") {
      await this.openPlanilla(route.planillaId);
    } else if (route.name === "home") {
      this.state.detail = null;
      if (this.services.session.isSignedIn()) {
        await this.refreshAssignments();
      }
    } else if (route.name === "login") {
      this.state.detail = null;
      this.resetLoginView();
    }
    this.emit();
  }
}

// ---- Helpers de tipado ----

type LocalPlanillaSyncOp = {
  state: "PENDING" | "SYNCING" | "SYNCED" | "FAILED";
};

function isUnauthorized(result: ApiResult<unknown>): boolean {
  if (result.ok) return false;
  return result.kind === "UNAUTHORIZED" || result.kind === "FORBIDDEN";
}

function localConfirmedAt(local: LocalPlanilla): string | undefined {
  return local.status === "CONFIRMADA" ? local.updatedAt : undefined;
}

function emptyContext(): JudgeContextResponse {
  return {
    edition: { id: "", code: "", name: "", votingNights: 0 },
    nights: [],
    assignments: [],
    rubros: [],
    items: [],
    candidates: [],
    comparsas: [],
    configuration: null,
  };
}

function emptyAssignment(
  nightId: string,
  specialty: string,
): import("@votaciones2027/shared-types").JudgeAssignmentContext {
  return {
    assignmentId: "",
    nightId,
    nightNumber: 0,
    specialtyId: specialty,
    specialty: specialty as import("@votaciones2027/shared-types").Specialty,
    confirmed: false,
  };
}