import type { AdminContextResponse } from "@votaciones2027/shared-types";
import type { AdminCatalogueRepository } from "../../../domain/repositories/admin-catalogue-repository.js";
import type { AdminUserRepository } from "../../../domain/repositories/admin-user-repository.js";
import type { EditionRepository } from "../../../domain/repositories/edition-repository.js";
import type { NightRepository } from "../../../domain/repositories/night-repository.js";
import type { UseCase } from "../../types.js";
import { resolveEdition2027 } from "./resolve-edition.js";

export class AdminGetContext implements UseCase<object, AdminContextResponse> {
  constructor(
    private readonly editions: EditionRepository,
    private readonly nights: NightRepository,
    private readonly catalogue: AdminCatalogueRepository,
    private readonly users: AdminUserRepository,
  ) {}

  async execute(_input: object): Promise<AdminContextResponse> {
    const edition = await resolveEdition2027(this.editions);

    const [nights, specialties, judges, counts] = await Promise.all([
      this.nights.findByEdition(edition.id),
      this.catalogue.listSpecialties(),
      this.users.listByRole("JUDGE"),
      this.catalogue.catalogCounts(edition.id),
    ]);

    return {
      edition,
      nights: nights.map((n) => n),
      specialties: specialties.map((s) => ({ id: s.id, code: s.code })),
      judges: judges.map((j) => ({
        id: j.id,
        email: j.email,
        ...(j.displayName === undefined ? {} : { displayName: j.displayName }),
        role: j.role,
      })),
      counts,
    };
  }
}