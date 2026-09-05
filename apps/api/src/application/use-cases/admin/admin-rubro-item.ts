import type {
  AdminRubroItemResult,
  RubroItemInput,
} from "@votaciones2027/shared-types";
import type { AdminCatalogueRepository } from "../../../domain/repositories/admin-catalogue-repository.js";
import type { AuditRepository } from "../../../domain/repositories/audit-repository.js";
import { NotFoundError } from "../../../errors/app-error.js";
import type { UseCase } from "../../types.js";

export class UpsertRubroItem
  implements
    UseCase<
      { rubroId?: string; id?: string } & RubroItemInput & { actorUserId: string },
      AdminRubroItemResult
    >
{
  constructor(
    private readonly catalogue: AdminCatalogueRepository,
    private readonly audits: AuditRepository,
  ) {}

  async execute(
    input: { rubroId?: string; id?: string } & RubroItemInput & { actorUserId: string },
  ): Promise<AdminRubroItemResult> {
    if (input.id === undefined) {
      if (input.rubroId === undefined) {
        throw new NotFoundError("Rubro");
      }
      const item = await this.catalogue.createItem({
        rubroId: input.rubroId,
        name: input.name,
        orderIndex: input.orderIndex,
      });
      await this.audits.create({
        eventType: "ADMIN_ACTION",
        actorUserId: input.actorUserId,
        entityType: "RUBRO_ITEM",
        entityId: item.id,
        payload: {
          action: "create",
          rubroId: input.rubroId,
          name: item.name,
          orderIndex: item.orderIndex,
        },
      });
      return { created: true, item };
    }

    const item = await this.catalogue.updateItem(input.id, {
      name: input.name,
      orderIndex: input.orderIndex,
    });
    if (item === null) {
      throw new NotFoundError("Rubro item");
    }
    await this.audits.create({
      eventType: "ADMIN_ACTION",
      actorUserId: input.actorUserId,
      entityType: "RUBRO_ITEM",
      entityId: item.id,
      payload: {
        action: "update",
        name: item.name,
        orderIndex: item.orderIndex,
      },
    });
    return { created: false, item };
  }
}