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
      const samePayload =
        existingByIdempotencyKey.planillaId === planilla.id &&
        existingByIdempotencyKey.comparsaId === comparsaId &&
        existingByIdempotencyKey.rubroId === rubroId &&
        existingByIdempotencyKey.itemId === itemId &&
        existingByIdempotencyKey.candidateId === candidateId &&
        existingByIdempotencyKey.score === score;

      if (!samePayload) {
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
  }
}