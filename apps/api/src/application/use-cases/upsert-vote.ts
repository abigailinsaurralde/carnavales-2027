import type { Vote, VoteUpsertPayload } from "@votaciones2027/shared-types";
import { EDITION_CODE_2027 } from "../constants.js";
import { isEditablePlanilla } from "../../domain/entities/planilla.js";
import type { CatalogueRepository } from "../../domain/repositories/catalogue-repository.js";
import type { ConfigurationRepository } from "../../domain/repositories/configuration-repository.js";
import type { EditionRepository } from "../../domain/repositories/edition-repository.js";
import type { PlanillaRepository } from "../../domain/repositories/planilla-repository.js";
import type { VoteRepository } from "../../domain/repositories/vote-repository.js";
import {
  ConflictError,
  DatabaseError,
  NotFoundError,
} from "../../errors/app-error.js";
import {
  requireRef,
  requireRefOpt,
  requireUuid,
  validateScore,
} from "../../validation/index.js";
import type { UseCase } from "../types.js";
import { VoteValidator } from "../services/vote-validator.js";
import { assertNightWindowOpen } from "../services/night-window.js";

export interface UpsertVoteInput {
  judgeId: string;
  planillaId: string;
  voteId: string;
  payload: VoteUpsertPayload;
}

export class UpsertVote implements UseCase<UpsertVoteInput, Vote> {
  constructor(
    private readonly editions: EditionRepository,
    private readonly configurations: ConfigurationRepository,
    private readonly planillas: PlanillaRepository,
    private readonly votes: VoteRepository,
    private readonly validator: VoteValidator,
  ) {}

  async execute(input: UpsertVoteInput): Promise<Vote> {
    const planillaId = requireUuid(input.planillaId, "planillaId");
    const voteId = requireUuid(input.voteId, "voteId");

    // 1. Edición y versión de configuración vigente.
    const edition = await this.editions.findByCode(EDITION_CODE_2027);
    if (edition === null) {
      throw new NotFoundError(`Edition with code '${EDITION_CODE_2027}'`);
    }

    const config = await this.configurations.findLatestByEdition(edition.id);
    if (config === null) {
      throw new DatabaseError(
        `No configuration version found for edition '${EDITION_CODE_2027}': cannot assign version_id to vote`,
      );
    }

    // 2. Planilla: existe, es del juez, editable.
    const planilla = await this.planillas.findById(planillaId);
    if (planilla === null || planilla.judgeId !== input.judgeId) {
      throw new NotFoundError("Planilla");
    }

    if (!isEditablePlanilla(planilla.status)) {
      throw new ConflictError(
        "Planilla is not editable (confirmed or closed planillas are immutable)",
        "PLANILLA_NOT_EDITABLE",
      );
    }

    // 3. Validación del payload.
    const comparsaId = requireUuid(input.payload.comparsaId, "comparsaId");
    const rubroId = requireUuid(input.payload.rubroId, "rubroId");
    const itemId = requireUuid(input.payload.itemId, "itemId");
    const candidateId = requireUuid(input.payload.candidateId, "candidateId");
    const score = validateScore(input.payload.score);
    const idempotencyKey = requireRef(
      input.payload.idempotencyKey,
      "idempotencyKey",
    );
    const clientRef = requireRefOpt(
      input.payload.clientRef,
      "clientRef",
    );

    // 4. Integridad de claves dentro de la edición.
    const { night } = await this.validator.validateKeyIntegrity({
      judgeId: input.judgeId,
      nightId: planilla.nightId,
      comparsaId,
      rubroId,
      itemId,
      candidateId,
      edition,
    });

    // 5. Idempotencia (orden: id → idempotencyKey → clave de negocio → client_ref).
    const existingById = await this.votes.findById(voteId);

    if (existingById !== null) {
      if (existingById.planillaId !== planilla.id) {
        throw new ConflictError(
          "Vote id already belongs to another planilla",
          "VOTE_PLANILLA_MISMATCH",
        );
      }

      if (existingById.confirmedAt !== undefined) {
        throw new ConflictError(
          "Vote is confirmed and immutable",
          "VOTE_CONFIRMED_IMMUTABLE",
        );
      }

      // Ventana de votación: último gate antes de mutar (nunca en el path
      // idempotente).
      assertNightWindowOpen(night, new Date());

      const updateInput = {
        score,
        idempotencyKey,
        ...(clientRef !== undefined ? { clientRef } : {}),
        ...(input.payload.deviceContext !== undefined
          ? { deviceContext: input.payload.deviceContext }
          : {}),
      };

      return await this.votes.update(voteId, updateInput);
    }

    const existingByIdempotencyKey = await this.votes.findByIdempotencyKey(
      input.judgeId,
      idempotencyKey,
    );

    if (existingByIdempotencyKey !== null) {
      if (
        !this.hasSamePayload(
          existingByIdempotencyKey,
          planilla.id,
          comparsaId,
          rubroId,
          itemId,
          candidateId,
          score,
        )
      ) {
        throw new ConflictError(
          "Idempotency key already used with a different payload",
          "IDEMPOTENCY_CONFLICT",
        );
      }

      // Reintento idempotente: mismo payload → devuelve el voto existente.
      return existingByIdempotencyKey;
    }

    const existingByBusinessKey = await this.votes.findByBusinessKey(
      input.judgeId,
      night.id,
      comparsaId,
      rubroId,
      itemId,
      candidateId,
    );

    if (existingByBusinessKey !== null) {
      if (existingByBusinessKey.confirmedAt !== undefined) {
        throw new ConflictError(
          "Vote is confirmed and immutable",
          "VOTE_CONFIRMED_IMMUTABLE",
        );
      }

      // El cliente reenvía su voto con otro id: UPDATE del existente
      // (conserva su id original). Último gate antes de mutar.
      assertNightWindowOpen(night, new Date());

      const updateInput = {
        score,
        idempotencyKey,
        ...(clientRef !== undefined ? { clientRef } : {}),
        ...(input.payload.deviceContext !== undefined
          ? { deviceContext: input.payload.deviceContext }
          : {}),
      };

      return await this.votes.update(
        existingByBusinessKey.id,
        updateInput,
      );
    }

    if (clientRef !== undefined) {
      const existingByClientRef = await this.votes.findByClientRef(
        input.judgeId,
        clientRef,
      );

      if (existingByClientRef !== null) {
        return existingByClientRef;
      }
    }

    // 6. INSERT (PUT idempotente: esta es la primera creación del voto).
    // Último gate antes de escribir.
    assertNightWindowOpen(night, new Date());

    try {
      return await this.votes.create({
        id: voteId,
        planillaId: planilla.id,
        judgeId: input.judgeId,
        nightId: night.id,
        editionId: edition.id,
        comparsaId,
        rubroId,
        itemId,
        candidateId,
        score,
        scoreSource: "JUDGE",
        idempotencyKey,
        versionId: config.id,
        ...(clientRef !== undefined ? { clientRef } : {}),
        ...(input.payload.deviceContext !== undefined
          ? { deviceContext: input.payload.deviceContext }
          : {}),
      });
    } catch (error) {
      // Carrera check-then-insert (ventana 007): otro request con la MISMA
      // (judge_id, idempotency_key) ganó entre nuestro findByIdempotencyKey
      // (devolvió null) y nuestro INSERT → el constraint
      // uq_vote_idempotency_per_judge (007) dispara 23505. Se re-evalúa como
      // el path secuencial SIN cambiar el contrato del repositorio (el path de
      // sync-planillas no pasa por aquí y conserva su comportamiento):
      //   - mismo payload → replay idempotente del voto ganador (200);
      //   - distinto payload → 409 IDEMPOTENCY_CONFLICT (el 500 genérico no es
      //     un contrato válido para una violación de idempotencia).
      if (
        error instanceof DatabaseError &&
        error.pgCode === "23505" &&
        error.constraint === "uq_vote_idempotency_per_judge"
      ) {
        const concurrent = await this.votes.findByIdempotencyKey(
          input.judgeId,
          idempotencyKey,
        );
        if (concurrent !== null) {
          if (
            this.hasSamePayload(
              concurrent,
              planilla.id,
              comparsaId,
              rubroId,
              itemId,
              candidateId,
              score,
            )
          ) {
            return concurrent;
          }
          throw new ConflictError(
            "Idempotency key already used with a different payload",
            "IDEMPOTENCY_CONFLICT",
          );
        }
      }
      // Otro 23505 (p. ej. clave de negocio) o constraint distinto: no se
      // reinterpreta, se propaga como DatabaseError (500 genérico, handler.ts).
      throw error;
    }
  }

  /**
   * Compara un voto persistido contra el payload del request en curso para
   * decidir si un idempotencyKey reutilizado corresponde a un replay idempotente
   * (mismo payload → OK) o a un uso ilegítimo con payload alterado (409).
   * Misma semántica en el path secuencial y en la recuperación de la carrera 23505.
   */
  private hasSamePayload(
    vote: Vote,
    planillaId: string,
    comparsaId: string,
    rubroId: string,
    itemId: string,
    candidateId: string,
    score: number,
  ): boolean {
    return (
      vote.planillaId === planillaId &&
      vote.comparsaId === comparsaId &&
      vote.rubroId === rubroId &&
      vote.itemId === itemId &&
      vote.candidateId === candidateId &&
      vote.score === score
    );
  }
}
