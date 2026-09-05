import type {
  AdminComparsaResult,
  Comparsa,
  ComparsaInput,
} from "@votaciones2027/shared-types";
import type { AdminCatalogueRepository } from "../../../domain/repositories/admin-catalogue-repository.js";
import type { AuditRepository } from "../../../domain/repositories/audit-repository.js";
import type { EditionRepository } from "../../../domain/repositories/edition-repository.js";
import type { UseCase } from "../../types.js";
import { resolveEdition2027 } from "./resolve-edition.js";

export class CreateComparsa
  implements UseCase<ComparsaInput & { actorUserId: string }, AdminComparsaResult>
{
  constructor(
    private readonly editions: EditionRepository,
    private readonly catalogue: AdminCatalogueRepository,
    private readonly audits: AuditRepository,
  ) {}

  async execute(
    input: ComparsaInput & { actorUserId: string },
  ): Promise<AdminComparsaResult> {
    const edition = await resolveEdition2027(this.editions);
    const item = await this.catalogue.createComparsa(edition.id, {
      code: input.code,
      name: input.name,
    });
    await this.audit(input.actorUserId, edition.id, item);
    return { created: true, item };
  }

  private async audit(
    actorUserId: string,
    editionId: string,
    item: Comparsa,
  ): Promise<void> {
    await this.audits.create({
      eventType: "ADMIN_ACTION",
      actorUserId,
      entityType: "COMPARSA",
      entityId: item.id,
      payload: { action: "create", editionId, code: item.code, name: item.name },
    });
  }
}