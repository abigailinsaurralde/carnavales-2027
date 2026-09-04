import type {
  JudgeContextConfiguration,
  JudgeContextEdition,
  JudgeContextResponse,
} from "@votaciones2027/shared-types";
import { EDITION_CODE_2027 } from "../constants.js";
import type { CatalogueRepository } from "../../domain/repositories/catalogue-repository.js";
import type { ConfigurationRepository } from "../../domain/repositories/configuration-repository.js";
import type { EditionRepository } from "../../domain/repositories/edition-repository.js";
import type { JudgeAssignmentRepository } from "../../domain/repositories/judge-assignment-repository.js";
import type { NightRepository } from "../../domain/repositories/night-repository.js";
import { NotFoundError } from "../../errors/app-error.js";
import type { UseCase } from "../types.js";

export interface JudgeContextInput {
  judgeId: string;
}

export class JudgeContext implements UseCase<JudgeContextInput, JudgeContextResponse> {
  constructor(
    private readonly editions: EditionRepository,
    private readonly nights: NightRepository,
    private readonly configurations: ConfigurationRepository,
    private readonly assignments: JudgeAssignmentRepository,
    private readonly catalogue: CatalogueRepository,
  ) {}

  async execute(input: JudgeContextInput): Promise<JudgeContextResponse> {
    const edition = await this.editions.findByCode(EDITION_CODE_2027);
    if (edition === null) {
      throw new NotFoundError(`Edition with code '${EDITION_CODE_2027}'`);
    }

    const [nights, assignments, rubros, items, candidates, comparsas, configuration] =
      await Promise.all([
        this.nights.findByEdition(edition.id),
        this.assignments.findEffectiveAssignments(input.judgeId),
        this.catalogue.findRubrosByEdition(edition.id),
        this.catalogue.findItemsByEdition(edition.id),
        this.catalogue.findCandidatesByEdition(edition.id),
        this.catalogue.findComparsasByEdition(edition.id),
        this.configurations.findLatestByEdition(edition.id),
      ]);

    const editionInfo: JudgeContextEdition = {
      id: edition.id,
      code: edition.code,
      name: edition.name,
      votingNights: edition.votingNights,
    };

    const configurationInfo: JudgeContextConfiguration | null =
      configuration === null
        ? null
        : {
            versionId: configuration.id,
            version: configuration.version,
            status: configuration.status,
          };

    return {
      edition: editionInfo,
      nights,
      assignments,
      rubros,
      items,
      candidates,
      comparsas,
      configuration: configurationInfo,
    };
  }
}