import type {
  Candidate,
  Comparsa,
  JudgeAssignmentView,
  Rubro,
  RubroItem,
} from "@votaciones2027/shared-types";
import type { UseCase } from "../../types.js";
import { resolveEdition2027 } from "./resolve-edition.js";
import type { EditionRepository } from "../../../domain/repositories/edition-repository.js";
import type { AdminCatalogueRepository } from "../../../domain/repositories/admin-catalogue-repository.js";
import type { AdminAssignmentRepository } from "../../../domain/repositories/admin-assignment-repository.js";

export class AdminListComparsas implements UseCase<object, Comparsa[]> {
  constructor(
    private readonly editions: EditionRepository,
    private readonly catalogue: AdminCatalogueRepository,
  ) {}

  async execute(_input: object): Promise<Comparsa[]> {
    const edition = await resolveEdition2027(this.editions);
    return this.catalogue.listComparsas(edition.id);
  }
}

export class AdminListRubros implements UseCase<object, Rubro[]> {
  constructor(
    private readonly editions: EditionRepository,
    private readonly catalogue: AdminCatalogueRepository,
  ) {}

  async execute(_input: object): Promise<Rubro[]> {
    const edition = await resolveEdition2027(this.editions);
    return this.catalogue.listRubros(edition.id);
  }
}

export class AdminListRubroItems
  implements UseCase<{ rubroId: string }, RubroItem[]>
{
  constructor(private readonly catalogue: AdminCatalogueRepository) {}

  async execute(input: { rubroId: string }): Promise<RubroItem[]> {
    return this.catalogue.listItemsByRubro(input.rubroId);
  }
}

export class AdminListCandidates implements UseCase<object, Candidate[]> {
  constructor(
    private readonly editions: EditionRepository,
    private readonly catalogue: AdminCatalogueRepository,
  ) {}

  async execute(_input: object): Promise<Candidate[]> {
    const edition = await resolveEdition2027(this.editions);
    return this.catalogue.listCandidates(edition.id);
  }
}

export class AdminListAssignments
  implements UseCase<object, JudgeAssignmentView[]>
{
  constructor(
    private readonly editions: EditionRepository,
    private readonly assignments: AdminAssignmentRepository,
  ) {}

  async execute(_input: object): Promise<JudgeAssignmentView[]> {
    const edition = await resolveEdition2027(this.editions);
    return this.assignments.listByEdition(edition.id);
  }
}