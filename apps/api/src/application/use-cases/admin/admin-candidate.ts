import type {
  AdminCandidateResult,
  CandidateInput,
} from "@votaciones2027/shared-types";
import type { AdminCatalogueRepository } from "../../../domain/repositories/admin-catalogue-repository.js";
import type { AuditRepository } from "../../../domain/repositories/audit-repository.js";
import { NotFoundError } from "../../../errors/app-error.js";
import type { UseCase } from "../../types.js";

export class UpsertCandidate
  implements
    UseCase<{ id?: string } & CandidateInput & { actorUserId: string }, AdminCandidateResult>
{
  constructor(
    private readonly catalogue: AdminCatalogueRepository,
    private readonly audits: AuditRepository,
  ) {}

  async execute(
    input: { id?: string } & CandidateInput & { actorUserId: string },
  ): Promise<AdminCandidateResult> {
    if (input.id === undefined) {
      const item = await this.catalogue.createCandidate({
        itemId: input.itemId,
        comparsaId: input.comparsaId,
        label: input.label,
      });
      await this.audits.create({
        eventType: "ADMIN_ACTION",
        actorUserId: input.actorUserId,
        entityType: "CANDIDATE",
        entityId: item.id,
        payload: {
          action: "create",
          itemId: input.itemId,
          comparsaId: input.comparsaId,
          label: item.label,
        },
      });
      return { created: true, item };
    }

    const item = await this.catalogue.updateCandidate(input.id, {
      itemId: input.itemId,
      comparsaId: input.comparsaId,
      label: input.label,
    });
    if (item === null) {
      throw new NotFoundError("Candidate");
    }
    await this.audits.create({
      eventType: "ADMIN_ACTION",
      actorUserId: input.actorUserId,
      entityType: "CANDIDATE",
      entityId: item.id,
      payload: {
        action: "update",
        itemId: item.itemId,
        comparsaId: item.comparsaId,
        label: item.label,
      },
    });
    return { created: false, item };
  }
}