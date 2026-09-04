import type { PlanillaDetail } from "@votaciones2027/shared-types";
import { toSharedPlanilla } from "../../domain/entities/planilla.js";
import type { PlanillaRepository } from "../../domain/repositories/planilla-repository.js";
import type { VoteRepository } from "../../domain/repositories/vote-repository.js";
import { NotFoundError } from "../../errors/app-error.js";
import type { UseCase } from "../types.js";

export interface GetPlanillaInput {
  judgeId: string;
  planillaId: string;
}

export class GetPlanilla implements UseCase<GetPlanillaInput, PlanillaDetail> {
  constructor(
    private readonly planillas: PlanillaRepository,
    private readonly votes: VoteRepository,
  ) {}

  async execute(input: GetPlanillaInput): Promise<PlanillaDetail> {
    const planilla = await this.planillas.findById(input.planillaId);
    // Planilla ajena → 404 (no 403): no revelar existencia.
    if (planilla === null || planilla.judgeId !== input.judgeId) {
      throw new NotFoundError("Planilla");
    }
    const votes = await this.votes.findByPlanilla(planilla.id);
    return { planilla: toSharedPlanilla(planilla), votes };
  }
}