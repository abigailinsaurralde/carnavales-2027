import type { Specialty } from "./specialty.js";

export interface JuryAssignment {
  id: string;
  nightId: string;
  judgeId: string;
  specialty: Specialty;
  confirmed: boolean;
}

export interface JudgeReplacement {
  id: string;
  nightId: string;
  originalJudgeId: string;
  replacementJudgeId: string;
  specialty: Specialty;
  reason: string;
  authorizedBy: string;
  occurredAt: string;
}