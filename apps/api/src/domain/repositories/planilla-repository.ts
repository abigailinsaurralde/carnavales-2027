import type { PlanillaStatus } from "@votaciones2027/shared-types";
import type { Planilla } from "../entities/planilla.js";

export interface CreatePlanillaInput {
  id: string;
  judgeId: string;
  nightId: string;
  status: PlanillaStatus;
  clientRef?: string;
}

export interface PlanillaSummaryRow {
  id: string;
  nightId: string;
  nightNumber: number;
  status: PlanillaStatus;
  confirmedAt: Date | null;
  votesCount: number;
  updatedAt: Date;
}

export interface PlanillaRepository {
  findById(id: string): Promise<Planilla | null>;
  findByIdForUpdate(id: string): Promise<Planilla | null>;
  findByJudgeAndNight(judgeId: string, nightId: string): Promise<Planilla | null>;
  findByJudge(judgeId: string): Promise<PlanillaSummaryRow[]>;
  findByClientRef(judgeId: string, clientRef: string): Promise<Planilla | null>;
  findByJudgeNightClientRef(
    judgeId: string,
    nightId: string,
    clientRef: string,
  ): Promise<Planilla | null>;
  create(input: CreatePlanillaInput): Promise<Planilla>;
  confirm(id: string, confirmedAt: Date): Promise<void>;
  touch(id: string): Promise<void>;
}
