import type { PlanillaSummary } from "@votaciones2027/shared-types";
import type { PlanillaRepository } from "../../domain/repositories/planilla-repository.js";
import type { UseCase } from "../types.js";

export interface ListMyPlanillasInput {
  judgeId: string;
}

export class ListMyPlanillas
  implements UseCase<ListMyPlanillasInput, PlanillaSummary[]>
{
  constructor(private readonly planillas: PlanillaRepository) {}

  async execute(input: ListMyPlanillasInput): Promise<PlanillaSummary[]> {
    const rows = await this.planillas.findByJudge(input.judgeId);
    return rows.map((row) => ({
      id: row.id,
      nightId: row.nightId,
      nightNumber: row.nightNumber,
      status: row.status,
      ...(row.confirmedAt === null ? {} : { confirmedAt: row.confirmedAt.toISOString() }),
      votesCount: row.votesCount,
      updatedAt: row.updatedAt.toISOString(),
    }));
  }
}