import type {
  CarnavalEdition,
  DeviceContext,
  Night,
  PlanillaStatus,
  SyncPlanillaPayload,
  SyncPlanillaResult,
  SyncPlanillasRequest,
  SyncPlanillasResult,
  SyncVoteResult,
  Vote,
} from "@votaciones2027/shared-types";
import { EDITION_CODE_2027 } from "../constants.js";
import {
  isEditablePlanilla,
  type Planilla as PlanillaEntity,
} from "../../domain/entities/planilla.js";
import type { CatalogueRepository } from "../../domain/repositories/catalogue-repository.js";
import type { ConfigurationRepository } from "../../domain/repositories/configuration-repository.js";
import type { EditionRepository } from "../../domain/repositories/edition-repository.js";
import type { JudgeAssignmentRepository } from "../../domain/repositories/judge-assignment-repository.js";
import type {
  UnitOfWork,
  UnitOfWorkRepositories,
} from "../../domain/repositories/unit-of-work.js";
import type { UpdateVoteInput } from "../../domain/repositories/vote-repository.js";
import {
  ConflictError,
  DatabaseError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../errors/app-error.js";
import { requireRef, requireUuid, validateScore } from "../../validation/index.js";
import type { UseCase } from "../types.js";
import { VoteValidator } from "../services/vote-validator.js";
import { assertNightWindowOpen } from "../services/night-window.js";

export interface SyncPlanillasInput {
  judgeId: string;
  payload: SyncPlanillasRequest;
}

interface ParsedVote {
  id: string;
  planillaId: string;
  comparsaId: string;
  rubroId: string;
  itemId: string;
  candidateId: string;
  score: number;
  idempotencyKey: string;
  clientRef?: string;
  deviceContext?: DeviceContext;
}

interface VoteTarget {
  planillaId: string;
  comparsaId: string;
  rubroId: string;
  itemId: string;
  candidateId: string;
  score: number;
}

interface ParsedPlanilla {
  id: string;
  nightId: string;
  clientRef: string;
}

type ParsedVoteOutcome =
  | { ok: true; vote: ParsedVote }
  | { ok: false; reason: "INVALID_PAYLOAD" | "CONFIRMED_NOT_SYNCABLE" };

type PlanillaParseOutcome =
  | { ok: true; planilla: ParsedPlanilla }
  | { ok: false; reason: "INVALID_PAYLOAD" | "CONFIRMATION_NOT_SYNCABLE" };

type Resolution =
  | { kind: "OK"; planilla: PlanillaEntity; created: boolean }
  | { kind: "CONFLICT"; result: SyncPlanillaResult };

function tryParseVote(raw: unknown): ParsedVoteOutcome {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "INVALID_PAYLOAD" };
  }
  const v = raw as Record<string, unknown>;

  // La confirmación de votos es exclusiva del servidor: un payload con
  // confirmedAt no es sincronizable (evita intentos de fabricar un voto
  // confirmado desde el cliente).
  if (v["confirmedAt"] !== undefined) {
    return { ok: false, reason: "CONFIRMED_NOT_SYNCABLE" };
  }

  let deviceContext: DeviceContext | undefined;
  if (v["deviceContext"] !== undefined) {
    const rawContext = v["deviceContext"] as DeviceContext | null | undefined;
    if (
      rawContext === null ||
      typeof rawContext !== "object" ||
      Array.isArray(rawContext)
    ) {
      return { ok: false, reason: "INVALID_PAYLOAD" };
    }
    deviceContext = rawContext;
  }

  try {
    const vote: ParsedVote = {
      id: requireUuid(v["id"] as string | undefined, "id"),
      planillaId: requireUuid(v["planillaId"] as string | undefined, "planillaId"),
      comparsaId: requireUuid(v["comparsaId"] as string | undefined, "comparsaId"),
      rubroId: requireUuid(v["rubroId"] as string | undefined, "rubroId"),
      itemId: requireUuid(v["itemId"] as string | undefined, "itemId"),
      candidateId: requireUuid(v["candidateId"] as string | undefined, "candidateId"),
      score: validateScore(v["score"]),
      idempotencyKey: requireRef(v["idempotencyKey"], "idempotencyKey"),
      ...(v["clientRef"] === undefined
        ? {}
        : { clientRef: requireRef(v["clientRef"], "clientRef") }),
      ...(deviceContext === undefined ? {} : { deviceContext }),
    };
    return { ok: true, vote };
  } catch {
    return { ok: false, reason: "INVALID_PAYLOAD" };
  }
}

function tryParsePlanilla(raw: SyncPlanillaPayload): PlanillaParseOutcome {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "INVALID_PAYLOAD" };
  }
  const p = raw["planilla"] as Record<string, unknown> | null | undefined;
  if (p === null || typeof p !== "object" || Array.isArray(p)) {
    return { ok: false, reason: "INVALID_PAYLOAD" };
  }

  // La confirmación de la planilla es exclusiva del servidor.
  if (p["confirmedAt"] !== undefined) {
    return { ok: false, reason: "CONFIRMATION_NOT_SYNCABLE" };
  }

  const status = p["status"] as PlanillaStatus | undefined;
  if (status !== undefined) {
    if (
      status === "CONFIRMADA" ||
      status === "SINCRONIZADA" ||
      status === "CERRADA"
    ) {
      return { ok: false, reason: "CONFIRMATION_NOT_SYNCABLE" };
    }
    if (status !== "BORRADOR" && status !== "EN_EVALUACION") {
      return { ok: false, reason: "INVALID_PAYLOAD" };
    }
  }

  try {
    const planilla: ParsedPlanilla = {
      id: requireUuid(p["id"] as string | undefined, "planilla.id"),
      nightId: requireUuid(p["nightId"] as string | undefined, "planilla.nightId"),
      clientRef: requireRef(p["clientRef"], "planilla.clientRef"),
    };
    return { ok: true, planilla };
  } catch {
    return { ok: false, reason: "INVALID_PAYLOAD" };
  }
}

function rawPlanillaId(raw: unknown): string {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return "";
  const p = (raw as { planilla?: unknown })["planilla"];
  if (p === null || typeof p !== "object" || Array.isArray(p)) return "";
  const id = (p as { id?: unknown })["id"];
  return typeof id === "string" ? id : "";
}

/**
 * Sincronización de planillas del juez desde el cliente offline (FASE 5-7
 * del recorrido: captura local → confirmación del juez → cola de
 * sincronización → servidor → validación → auditoría).
 *
 * Semántica (coincide con UpsertVote pero consolidando varias operaciones):
 *   - Cada planilla se procesa en su propia transacción (UnitOfWork):
 *     o la planilla se resuelve por id (con ownership) y en su defecto por
 *       clientRef+night, clientRef, o judge+night; si no existe, se crea en
 *       estado BORRADOR auditando PLANILLA_CREATED;
 *     o cada voto se aplica idempotentemente por el orden
 *       id → idempotencyKey → clave de negocio → clientRef.
 *   - Reintentos: un payload idéntico ya persistido → EXISTS, sin mutaciones,
 *     sin duplicar auditoría.
 *   - Inmutabilidad: un voto confirmado nunca se modifica (VOTE_CONFIRMED_IMMUTABLE)
 *     y una planilla confirmada nunca recibe votos nuevos (PLANILLA_NOT_EDITABLE);
 *     la sincronización no reabre operaciones cerradas.
 *   - La confirmación es exclusiva del servidor: se rechazan confirmedAt o
 *     estados terminales enviados por el cliente.
 *   - Problemas de una planilla/voto van al resultado, no al estado HTTP
 *     (errores sistémicos sí lanzan excepción).
 */
export class SyncPlanillas implements UseCase<SyncPlanillasInput, SyncPlanillasResult> {
  constructor(
    private readonly editions: EditionRepository,
    private readonly configurations: ConfigurationRepository,
    private readonly assignments: JudgeAssignmentRepository,
    private readonly catalogue: CatalogueRepository,
    private readonly uow: UnitOfWork,
    private readonly validator: VoteValidator,
  ) {}

  async execute(input: SyncPlanillasInput): Promise<SyncPlanillasResult> {
    const edition = await this.editions.findByCode(EDITION_CODE_2027);
    if (edition === null) {
      throw new NotFoundError(`Edition with code '${EDITION_CODE_2027}'`);
    }

    const configuration = await this.configurations.findLatestByEdition(edition.id);
    if (configuration === null) {
      throw new DatabaseError(
        `No configuration version found for edition '${EDITION_CODE_2027}': cannot assign version_id to synced votes`,
      );
    }

    const planillas: SyncPlanillaResult[] = [];
    for (const payload of input.payload.planillas) {
      planillas.push(
        await this.processPlanilla(
          input.judgeId,
          payload,
          edition,
          configuration.id,
        ),
      );
    }

    return { planillas, syncedAt: new Date().toISOString() };
  }

  private async processPlanilla(
    judgeId: string,
    payload: SyncPlanillaPayload,
    edition: CarnavalEdition,
    configurationVersionId: string,
  ): Promise<SyncPlanillaResult> {
    const parsed = tryParsePlanilla(payload);
    if (!parsed.ok) {
      return this.conflict(rawPlanillaId(payload), parsed.reason);
    }

    const rawVotes = Array.isArray(payload.votes) ? payload.votes : [];

    return this.uow.withTransaction(async (tx) => {
      const resolved = await this.resolvePlanilla(tx, judgeId, parsed.planilla);
      if (resolved.kind === "CONFLICT") {
        return resolved.result;
      }

      const { planilla, created } = resolved;
      const editable = isEditablePlanilla(planilla.status);
      const votes: SyncVoteResult[] = [];
      let mutated = false;

      for (const rawVote of rawVotes) {
        const outcome = await this.applyVote(
          tx,
          judgeId,
          planilla,
          editable,
          rawVote,
          edition,
          configurationVersionId,
        );
        votes.push(outcome.result);
        if (outcome.mutated) mutated = true;
      }

      // Mantiene updated_at de la planilla cuando la sincronización trajo
      // cambios reales sobre una planilla ya existente (no se toca al crear).
      if (editable && mutated && !created) {
        await tx.planillas.touch(planilla.id);
      }

      return {
        planillaId: planilla.id,
        planillaAction: created ? "INSERTED" : "ALREADY_EXISTS",
        votes,
      };
    });
  }

  private async resolvePlanilla(
    tx: UnitOfWorkRepositories,
    judgeId: string,
    req: ParsedPlanilla,
  ): Promise<Resolution> {
    const byId = await tx.planillas.findByIdForUpdate(req.id);
    if (byId !== null) {
      if (byId.judgeId !== judgeId) {
        return {
          kind: "CONFLICT",
          result: this.conflict(req.id, "PLANILLA_NOT_OWNED"),
        };
      }
      return { kind: "OK", planilla: byId, created: false };
    }

    const byClientAndNight = await tx.planillas.findByJudgeNightClientRef(
      judgeId,
      req.nightId,
      req.clientRef,
    );
    if (byClientAndNight !== null) {
      return { kind: "OK", planilla: byClientAndNight, created: false };
    }

    const byClientRef = await tx.planillas.findByClientRef(judgeId, req.clientRef);
    if (byClientRef !== null) {
      return { kind: "OK", planilla: byClientRef, created: false };
    }

    const byJudgeNight = await tx.planillas.findByJudgeAndNight(judgeId, req.nightId);
    if (byJudgeNight !== null) {
      return { kind: "OK", planilla: byJudgeNight, created: false };
    }

    // Primera vez que el servidor conoce la planilla: el juez debe estar
    // asignado a la noche (misma garantía que CreatePlanilla).
    const assignment = await this.assignments.findEffectiveByJudgeAndNight(
      judgeId,
      req.nightId,
    );
    if (assignment === null) {
      return {
        kind: "CONFLICT",
        result: this.conflict(req.id, "JUDGE_NOT_ASSIGNED"),
      };
    }

    const created = await tx.planillas.create({
      id: req.id,
      judgeId,
      nightId: req.nightId,
      status: "BORRADOR",
      clientRef: req.clientRef,
    });
    // Única auditoría que genera el sync (igual que CreatePlanilla): el resto
    // son operaciones idempotentes que no duplican auditoría en reintentos.
    await tx.audits.create({
      eventType: "PLANILLA_CREATED",
      entityType: "PLANILLA",
      entityId: created.id,
      actorUserId: judgeId,
      payload: { nightId: req.nightId, source: "SYNC" },
    });
    return { kind: "OK", planilla: created, created: true };
  }

  private async applyVote(
    tx: UnitOfWorkRepositories,
    judgeId: string,
    planilla: PlanillaEntity,
    editable: boolean,
    raw: unknown,
    edition: CarnavalEdition,
    configurationVersionId: string,
  ): Promise<{ result: SyncVoteResult; mutated: boolean }> {
    const parsed = tryParseVote(raw);
    if (!parsed.ok) {
      const requestedId =
        typeof (raw as { id?: unknown })["id"] === "string"
          ? ((raw as { id?: unknown })["id"] as string)
          : "";
      return { result: this.rejected(requestedId, parsed.reason), mutated: false };
    }

    const vote = parsed.vote;
    if (vote.planillaId !== planilla.id) {
      return {
        result: this.rejected(vote.id, "VOTE_PLANILLA_MISMATCH"),
        mutated: false,
      };
    }

    const target: VoteTarget = {
      planillaId: planilla.id,
      comparsaId: vote.comparsaId,
      rubroId: vote.rubroId,
      itemId: vote.itemId,
      candidateId: vote.candidateId,
      score: vote.score,
    };

    // 1) Id del voto (clave más fuerte, igual que UpsertVote).
    const existingById = await tx.votes.findById(vote.id);
    if (existingById !== null) {
      if (this.sameVote(existingById, target)) {
        return { result: this.exists(existingById.id), mutated: false };
      }
      if (existingById.confirmedAt !== undefined) {
        return {
          result: this.rejected(vote.id, "VOTE_CONFIRMED_IMMUTABLE"),
          mutated: false,
        };
      }
      if (!editable) {
        return {
          result: this.rejected(vote.id, "PLANILLA_NOT_EDITABLE"),
          mutated: false,
        };
      }
      // Ventana de votación: gate antes de mutar (excluye el path EXISTS).
      const existingByIdNight = await tx.nights.findById(planilla.nightId);
      if (existingByIdNight === null) {
        return { result: this.rejected(vote.id, "VALIDATION"), mutated: false };
      }
      if (!this.isNightWindowOpen(existingByIdNight)) {
        return {
          result: this.rejected(vote.id, "NIGHT_WINDOW_CLOSED"),
          mutated: false,
        };
      }
      await tx.votes.update(existingById.id, this.buildUpdateInput(vote));
      return { result: this.applied(existingById.id), mutated: true };
    }

    // 2) IdempotencyKey (vuelos/duplicados del reintento del sync).
    const existingByKey = await tx.votes.findByIdempotencyKey(
      judgeId,
      vote.idempotencyKey,
    );
    if (existingByKey !== null) {
      if (this.sameVote(existingByKey, target)) {
        return { result: this.exists(existingByKey.id), mutated: false };
      }
      if (existingByKey.confirmedAt !== undefined) {
        return {
          result: this.rejected(vote.id, "VOTE_CONFIRMED_IMMUTABLE"),
          mutated: false,
        };
      }
      if (!editable) {
        return {
          result: this.rejected(vote.id, "PLANILLA_NOT_EDITABLE"),
          mutated: false,
        };
      }
      return {
        result: this.rejected(vote.id, "IDEMPOTENCY_CONFLICT"),
        mutated: false,
      };
    }

    // 3) Clave de negocio (juez+night+comparsa+rubro+item+candidato).
    const existingByBusiness = await tx.votes.findByBusinessKey(
      judgeId,
      planilla.nightId,
      vote.comparsaId,
      vote.rubroId,
      vote.itemId,
      vote.candidateId,
    );
    if (existingByBusiness !== null) {
      if (this.sameVote(existingByBusiness, target)) {
        return { result: this.exists(existingByBusiness.id), mutated: false };
      }
      if (existingByBusiness.confirmedAt !== undefined) {
        return {
          result: this.rejected(vote.id, "VOTE_CONFIRMED_IMMUTABLE"),
          mutated: false,
        };
      }
      if (existingByBusiness.planillaId !== planilla.id) {
        return {
          result: this.rejected(vote.id, "VOTE_PLANILLA_MISMATCH"),
          mutated: false,
        };
      }
      if (!editable) {
        return {
          result: this.rejected(vote.id, "PLANILLA_NOT_EDITABLE"),
          mutated: false,
        };
      }
      // Ventana de votación: gate antes de mutar (excluye el path EXISTS).
      const existingByBusinessNight = await tx.nights.findById(planilla.nightId);
      if (existingByBusinessNight === null) {
        return { result: this.rejected(vote.id, "VALIDATION"), mutated: false };
      }
      if (!this.isNightWindowOpen(existingByBusinessNight)) {
        return {
          result: this.rejected(vote.id, "NIGHT_WINDOW_CLOSED"),
          mutated: false,
        };
      }
      await tx.votes.update(existingByBusiness.id, this.buildUpdateInput(vote));
      return { result: this.applied(existingByBusiness.id), mutated: true };
    }

    // 4) clientRef del voto (ref estable generado por el cliente).
    if (vote.clientRef !== undefined) {
      const existingByRef = await tx.votes.findByClientRef(judgeId, vote.clientRef);
      if (existingByRef !== null) {
        if (this.sameVote(existingByRef, target)) {
          return { result: this.exists(existingByRef.id), mutated: false };
        }
        if (existingByRef.confirmedAt !== undefined) {
          return {
            result: this.rejected(vote.id, "VOTE_CONFIRMED_IMMUTABLE"),
            mutated: false,
          };
        }
        if (existingByRef.planillaId !== planilla.id) {
          return {
            result: this.rejected(vote.id, "VOTE_PLANILLA_MISMATCH"),
            mutated: false,
          };
        }
        if (!editable) {
          return {
            result: this.rejected(vote.id, "PLANILLA_NOT_EDITABLE"),
            mutated: false,
          };
        }
        // Ventana de votación: gate antes de mutar (excluye el path EXISTS).
        const existingByRefNight = await tx.nights.findById(planilla.nightId);
        if (existingByRefNight === null) {
          return { result: this.rejected(vote.id, "VALIDATION"), mutated: false };
        }
        if (!this.isNightWindowOpen(existingByRefNight)) {
          return {
            result: this.rejected(vote.id, "NIGHT_WINDOW_CLOSED"),
            mutated: false,
          };
        }
        await tx.votes.update(existingByRef.id, this.buildUpdateInput(vote));
        return { result: this.applied(existingByRef.id), mutated: true };
      }
    }

    // 5) INSERT: primera aparición de este voto en el servidor.
    if (!editable) {
      return {
        result: this.rejected(vote.id, "PLANILLA_NOT_EDITABLE"),
        mutated: false,
      };
    }

    let nightId: string;
    let validatedNight: Night;
    try {
      const validated = await this.validator.validateKeyIntegrity({
        judgeId,
        nightId: planilla.nightId,
        comparsaId: vote.comparsaId,
        rubroId: vote.rubroId,
        itemId: vote.itemId,
        candidateId: vote.candidateId,
        edition,
      });
      nightId = validated.night.id;
      validatedNight = validated.night;
    } catch (err) {
      if (err instanceof ForbiddenError) {
        return { result: this.rejected(vote.id, "JUDGE_NOT_ASSIGNED"), mutated: false };
      }
      if (err instanceof ValidationError) {
        return { result: this.rejected(vote.id, "VALIDATION"), mutated: false };
      }
      throw err;
    }

    // Ventana de votación: gate antes de mutar (excluye el path EXISTS).
    if (!this.isNightWindowOpen(validatedNight)) {
      return {
        result: this.rejected(vote.id, "NIGHT_WINDOW_CLOSED"),
        mutated: false,
      };
    }

    await tx.votes.create({
      id: vote.id,
      planillaId: planilla.id,
      judgeId,
      nightId,
      editionId: edition.id,
      comparsaId: vote.comparsaId,
      rubroId: vote.rubroId,
      itemId: vote.itemId,
      candidateId: vote.candidateId,
      score: vote.score,
      scoreSource: "JUDGE",
      idempotencyKey: vote.idempotencyKey,
      versionId: configurationVersionId,
      ...(vote.clientRef === undefined ? {} : { clientRef: vote.clientRef }),
      ...(vote.deviceContext === undefined ? {} : { deviceContext: vote.deviceContext }),
    });
    return { result: this.applied(vote.id), mutated: true };
  }

  private conflict(planillaId: string, reason: string): SyncPlanillaResult {
    return { planillaId, planillaAction: "CONFLICT", reason, votes: [] };
  }

  private exists(id: string): SyncVoteResult {
    return { id, action: "EXISTS" };
  }

  private applied(id: string): SyncVoteResult {
    return { id, action: "INSERTED" };
  }

  private rejected(id: string, reason: string): SyncVoteResult {
    return { id, action: "REJECTED", reason };
  }

  private sameVote(existing: Vote, target: VoteTarget): boolean {
    return (
      existing.planillaId === target.planillaId &&
      existing.comparsaId === target.comparsaId &&
      existing.rubroId === target.rubroId &&
      existing.itemId === target.itemId &&
      existing.candidateId === target.candidateId &&
      existing.score === target.score
    );
  }

  private buildUpdateInput(vote: ParsedVote): UpdateVoteInput {
    return {
      score: vote.score,
      idempotencyKey: vote.idempotencyKey,
      ...(vote.clientRef === undefined ? {} : { clientRef: vote.clientRef }),
      ...(vote.deviceContext === undefined ? {} : { deviceContext: vote.deviceContext }),
    };
  }

  /**
   * true si la ventana de votación de la noche está abierta en el momento del
   * reloj del servidor. false si la ventana está cerrada (o no definida, en
   * cuyo caso la ventana NO se aplica: ver assertNightWindowOpen). No lanza:
   * el sync reporta rechazos por ítem, no excepciones.
   */
  private isNightWindowOpen(night: Night): boolean {
    try {
      assertNightWindowOpen(night, new Date());
      return true;
    } catch (err) {
      if (err instanceof ConflictError && err.code === "NIGHT_WINDOW_CLOSED") {
        return false;
      }
      throw err;
    }
  }
}