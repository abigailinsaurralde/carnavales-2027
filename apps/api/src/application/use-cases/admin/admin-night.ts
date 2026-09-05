import type { Night, NightUpdateInput } from "@votaciones2027/shared-types";
import type { AdminNightRepository } from "../../../domain/repositories/admin-night-repository.js";
import type { AuditRepository } from "../../../domain/repositories/audit-repository.js";
import type { NightRepository } from "../../../domain/repositories/night-repository.js";
import { NotFoundError } from "../../../errors/app-error.js";
import type { UseCase } from "../../types.js";

export class UpdateNight
  implements UseCase<{ id: string } & NightUpdateInput & { actorUserId: string }, Night>
{
  constructor(
    private readonly nights: NightRepository,
    private readonly adminNights: AdminNightRepository,
    private readonly audits: AuditRepository,
  ) {}

  async execute(
    input: { id: string } & NightUpdateInput & { actorUserId: string },
  ): Promise<Night> {
    const patch: Record<string, string | null> = {};
    if (input.date !== undefined) patch.date = input.date;
    if (input.startsAt !== undefined) patch.startsAt = input.startsAt;
    if (input.endsAt !== undefined) patch.endsAt = input.endsAt;

    const night = await this.adminNights.updateNight(input.id, patch);
    if (night === null) {
      throw new NotFoundError("Night");
    }

    await this.audits.create({
      eventType: "ADMIN_ACTION",
      actorUserId: input.actorUserId,
      entityType: "NIGHT",
      entityId: night.id,
      payload: {
        action: "update_window",
        changed: Object.keys(patch),
      },
    });

    return night;
  }
}