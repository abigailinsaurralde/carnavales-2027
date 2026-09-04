import { randomUUID } from "node:crypto";
import type { Planilla, Vote } from "@votaciones2027/shared-types";
import { toSharedPlanilla } from "../../domain/entities/planilla.js";
import type { AuditRepository } from "../../domain/repositories/audit-repository.js";
import type { JudgeAssignmentRepository } from "../../domain/repositories/judge-assignment-repository.js";
import type { PlanillaRepository } from "../../domain/repositories/planilla-repository.js";
import type { VoteRepository } from "../../domain/repositories/vote-repository.js";
import { ForbiddenError } from "../../errors/app-error.js";
import type { UseCase } from "../types.js";

export interface CreatePlanillaInput {
  judgeId: string;
  nightId: string;
}

export interface CreatePlanillaResult {
  planilla: Planilla;
  votes: Vote[];
  created: boolean;
}

export class CreatePlanilla implements UseCase<CreatePlanillaInput, CreatePlanillaResult> {
  constructor(
    private readonly planillas: PlanillaRepository,
    private readonly votes: VoteRepository,
    private readonly assignments: JudgeAssignmentRepository,
    private readonly audits: AuditRepository,
  ) {}

  async execute(input: CreatePlanillaInput): Promise<CreatePlanillaResult> {
    const assignment = await this.assignments.findEffectiveByJudgeAndNight(
      input.judgeId,
      input.nightId,
    );
    if (assignment === null) {
      throw new ForbiddenError("Judge has no effective assignment for this night");
    }

    const existing = await this.planillas.findByJudgeAndNight(
      input.judgeId,
      input.nightId,
    );
    if (existing !== null) {
      // Idempotente: 1 planilla por (juez, noche). Devuelve la existente.
      const votes = await this.votes.findByPlanilla(existing.id);
      return { planilla: toSharedPlanilla(existing), votes, created: false };
    }

    const id = randomUUID();
    const created = await this.planillas.create({
      id,
      judgeId: input.judgeId,
      nightId: input.nightId,
      status: "BORRADOR",
    });

    await this.audits.create({
      eventType: "PLANILLA_CREATED",
      entityType: "PLANILLA",
      entityId: created.id,
      actorUserId: input.judgeId,
      payload: { nightId: input.nightId },
    });

    return { planilla: toSharedPlanilla(created), votes: [], created: true };
  }
}