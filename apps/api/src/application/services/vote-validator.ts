import type { CarnavalEdition, Night } from "@votaciones2027/shared-types";
import type { CatalogueRepository } from "../../domain/repositories/catalogue-repository.js";
import type { EffectiveAssignment } from "../../domain/repositories/judge-assignment-repository.js";
import type { JudgeAssignmentRepository } from "../../domain/repositories/judge-assignment-repository.js";
import type { NightRepository } from "../../domain/repositories/night-repository.js";
import {
  ForbiddenError,
  ValidationError,
} from "../../errors/app-error.js";

export interface ValidatedVoteKeyContext {
  night: Night;
  assignment: EffectiveAssignment;
}

export interface VoteKeyIntegrityInput {
  judgeId: string;
  nightId: string;
  comparsaId: string;
  rubroId: string;
  itemId: string;
  candidateId: string;
  edition: CarnavalEdition;
}

/**
 * Validación de integridad de claves de un voto dentro de la edición.
 *
 * Cadena validada (C4): candidate → item → rubro → specialty → asignación
 * EFECTIVA del juez en la noche; y todos los elementos pertenecientes a la
 * misma edición.
 *
 * NO valida puntaje ni idempotencia (responsabilidad de quienes lo invocan).
 */
export class VoteValidator {
  constructor(
    private readonly nights: NightRepository,
    private readonly assignments: JudgeAssignmentRepository,
    private readonly catalogue: CatalogueRepository,
  ) {}

  async validateKeyIntegrity(
    input: VoteKeyIntegrityInput,
  ): Promise<ValidatedVoteKeyContext> {
    const night = await this.nights.findById(input.nightId);
    if (night === null) {
      throw new ValidationError("Night not found");
    }
    if (night.editionId !== input.edition.id) {
      throw new ValidationError(
        "Night does not belong to the current edition",
      );
    }

    const rubro = await this.catalogue.findRubroById(input.rubroId);
    if (rubro === null) {
      throw new ValidationError("Rubro not found");
    }
    if (rubro.editionId !== night.editionId) {
      throw new ValidationError(
        "Rubro does not belong to the planilla edition",
      );
    }

    const assignment = await this.assignments.findEffectiveByJudgeAndNight(
      input.judgeId,
      input.nightId,
    );
    if (assignment === null) {
      throw new ForbiddenError("Judge has no effective assignment for this night");
    }
    if (rubro.specialtyId !== assignment.specialtyId) {
      throw new ValidationError(
        "Rubro specialty does not match the judge assignment for this night",
      );
    }

    const item = await this.catalogue.findItemById(input.itemId);
    if (item === null) {
      throw new ValidationError("Item not found");
    }
    if (item.rubroId !== input.rubroId) {
      throw new ValidationError("Item does not belong to the rubro");
    }

    const candidate = await this.catalogue.findCandidateById(input.candidateId);
    if (candidate === null) {
      throw new ValidationError("Candidate not found");
    }
    if (candidate.itemId !== input.itemId) {
      throw new ValidationError("Candidate does not belong to the item");
    }

    const comparsa = await this.catalogue.findComparsaById(input.comparsaId);
    if (comparsa === null) {
      throw new ValidationError("Comparsa not found");
    }
    if (comparsa.editionId !== night.editionId) {
      throw new ValidationError(
        "Comparsa does not belong to the planilla edition",
      );
    }

    return { night, assignment };
  }
}