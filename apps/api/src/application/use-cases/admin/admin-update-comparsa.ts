import type {
  AdminComparsaResult,
  ComparsaInput,
} from "@votaciones2027/shared-types";
import type { AdminCatalogueRepository } from "../../../domain/repositories/admin-catalogue-repository.js";
import type { AuditRepository } from "../../../domain/repositories/audit-repository.js";
import { NotFoundError } from "../../../errors/app-error.js";
import type { UseCase } from "../../types.js";

export class UpdateComparsa
  implements
    UseCase<{ id: string } & ComparsaInput & { actorUserId: string }, AdminComparsaResult>
{
  constructor(
    private readonly catalogue: AdminCatalogueRepository,
    private readonly audits: AuditRepository,
  ) {}

  async execute(
    input: { id: string } & ComparsaInput & { actorUserId: string },
  ): Promise<AdminComparsaResult> {
    const item = await this.catalogue.updateComparsa(input.id, {
      code: input.code,
      name: input.name,
    });
    if (item === null) {
      throw new NotFoundError("Comparsa");
    }
    await this.audits.create({
      eventType: "ADMIN_ACTION",
      actorUserId: input.actorUserId,
      entityType: "COMPARSA",
      entityId: item.id,
      payload: { action: "update", code: item.code, name: item.name },
    });
    return { created: false, item };
  }
}