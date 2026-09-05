import type {
  AdminRubroResult,
  RubroInput,
} from "@votaciones2027/shared-types";
import type { AdminCatalogueRepository } from "../../../domain/repositories/admin-catalogue-repository.js";
import type { AuditRepository } from "../../../domain/repositories/audit-repository.js";
import type { EditionRepository } from "../../../domain/repositories/edition-repository.js";
import { NotFoundError } from "../../../errors/app-error.js";
import type { UseCase } from "../../types.js";
import { resolveEdition2027 } from "./resolve-edition.js";

export class UpsertRubro
  implements
    UseCase<{ id?: string } & RubroInput & { actorUserId: string }, AdminRubroResult>
{
  constructor(
    private readonly editions: EditionRepository,
    private readonly catalogue: AdminCatalogueRepository,
    private readonly audits: AuditRepository,
  ) {}

  async execute(
    input: { id?: string } & RubroInput & { actorUserId: string },
  ): Promise<AdminRubroResult> {
    const edition = await resolveEdition2027(this.editions);

    const specialty = await this.catalogue.findSpecialtyByCode(input.specialty);
    if (specialty === null) {
      throw new NotFoundError("Specialty");
    }

    const createPayload = {
      specialtyId: specialty.id,
      name: input.name,
      type: input.type,
    };

    if (input.id === undefined) {
      const item = await this.catalogue.createRubro(edition.id, createPayload);
      await this.audits.create({
        eventType: "ADMIN_ACTION",
        actorUserId: input.actorUserId,
        entityType: "RUBRO",
        entityId: item.id,
        payload: {
          action: "create",
          editionId: edition.id,
          specialty: input.specialty,
          name: item.name,
          type: item.type,
        },
      });
      return { created: true, item };
    }

    const item = await this.catalogue.updateRubro(input.id, createPayload);
    if (item === null) {
      throw new NotFoundError("Rubro");
    }
    await this.audits.create({
      eventType: "ADMIN_ACTION",
      actorUserId: input.actorUserId,
      entityType: "RUBRO",
      entityId: item.id,
      payload: {
        action: "update",
        specialty: item.specialty,
        name: item.name,
        type: item.type,
      },
    });
    return { created: false, item };
  }
}