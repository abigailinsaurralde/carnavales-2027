import type { JudgeAssignmentContext, Specialty } from "@votaciones2027/shared-types";

export interface EffectiveAssignment {
  id: string;
  nightId: string;
  specialtyId: string;
  specialty: Specialty;
}

export interface JudgeAssignmentRepository {
  /** Asignaciones EFECTIVAS del juez, con datos de noche y especialidad. */
  findEffectiveAssignments(judgeId: string): Promise<JudgeAssignmentContext[]>;
  /** Asignación efectiva del juez para una noche dada (o null). */
  findEffectiveByJudgeAndNight(
    judgeId: string,
    nightId: string,
  ): Promise<EffectiveAssignment | null>;
}
