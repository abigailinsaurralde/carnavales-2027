import type {
  AdminAssignmentResult,
  AssignmentInput,
  JudgeAssignmentView,
} from "@votaciones2027/shared-types";
import type { AdminAssignmentRepository } from "../../../domain/repositories/admin-assignment-repository.js";
import type { AdminCatalogueRepository } from "../../../domain/repositories/admin-catalogue-repository.js";
import type { AuditRepository } from "../../../domain/repositories/audit-repository.js";
import type { NightRepository } from "../../../domain/repositories/night-repository.js";
import type { AdminUserRepository } from "../../../domain/repositories/admin-user-repository.js";
import { NotFoundError } from "../../../errors/app-error.js";
import type { UseCase } from "../../types.js";

export class UpsertAssignment
  implements
    UseCase<{ id?: string } & AssignmentInput & { actorUserId: string }, AdminAssignmentResult>
{
  constructor(
    private readonly assignments: AdminAssignmentRepository,
    private readonly users: AdminUserRepository,
    private readonly nights: NightRepository,
    private readonly audits: AuditRepository,
    private readonly catalogue: AdminCatalogueRepository,
  ) {}

  async execute(
    input: { id?: string } & AssignmentInput & { actorUserId: string },
  ): Promise<AdminAssignmentResult> {
    const judge = await this.users.listByRole("JUDGE").then((list) =>
      list.find((u) => u.id === input.judgeId),
    );
    if (judge === undefined) {
      throw new NotFoundError("Judge");
    }
    const night = await this.nights.findById(input.nightId);
    if (night === null) {
      throw new NotFoundError("Night");
    }

    if (input.id === undefined) {
      const specialty = await this.catalogue.findSpecialtyById(input.specialtyId);
      if (specialty === null) {
        throw new NotFoundError("Specialty");
      }
      const item = await this.assignments.create({
        judgeId: input.judgeId,
        nightId: input.nightId,
        specialtyId: input.specialtyId,
        isEffective: input.isEffective,
      });
      await this.audit(input.actorUserId, item, "create");
      return { created: true, item };
    }

    const item = await this.assignments.update(input.id, {
      isEffective: input.isEffective,
    });
    if (item === null) {
      throw new NotFoundError("Judge assignment");
    }
    await this.audit(input.actorUserId, item, "update");
    return { created: false, item };
  }

  private async audit(
    actorUserId: string,
    item: JudgeAssignmentView,
    action: string,
  ): Promise<void> {
    await this.audits.create({
      eventType: "ADMIN_ACTION",
      actorUserId,
      entityType: "JUDGE_ASSIGNMENT",
      entityId: item.id,
      payload: {
        action,
        judgeId: item.judgeId,
        nightId: item.nightId,
        specialtyId: item.specialtyId,
        isEffective: item.isEffective,
      },
    });
  }
}