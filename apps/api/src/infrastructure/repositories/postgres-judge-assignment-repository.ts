import type { JudgeAssignmentContext, Specialty } from "@votaciones2027/shared-types";
import type { DbPool } from "../../db/pool.js";
import type {
  EffectiveAssignment,
  JudgeAssignmentRepository,
} from "../../domain/repositories/judge-assignment-repository.js";

interface AssignmentContextRow {
  id: string;
  night_id: string;
  night_number: number;
  specialty_id: string;
  specialty_code: string;
  confirmed: boolean;
}

interface EffectiveAssignmentRow {
  id: string;
  night_id: string;
  specialty_id: string;
  specialty_code: string;
}

/**
 * DECISIÓN TÉCNICA (no de negocio): el esquema 001 no posee una columna
 * `judge_assignment.confirmed`; el único flag de estado de la asignación es
 * `is_effective`. Como el contexto solo expone asignaciones EFECTIVAS, el
 * campo `confirmed` del contrato se deriva de `is_effective` (TRUE en todas
 * las filas devueltas). Si la migración 003 añade una columna independiente
 * de confirmación, este query deberá actualizarse para leerla.
 */
export class PostgresJudgeAssignmentRepository implements JudgeAssignmentRepository {
  constructor(private readonly db: DbPool) {}

  async findEffectiveAssignments(judgeId: string): Promise<JudgeAssignmentContext[]> {
    const result = await this.db.query<AssignmentContextRow>(
      `SELECT ja.id, ja.night_id, n.number AS night_number, ja.specialty_id,
              s.code AS specialty_code, ja.is_effective AS confirmed
       FROM judge_assignment ja
       JOIN night n ON n.id = ja.night_id
       JOIN specialty s ON s.id = ja.specialty_id
       WHERE ja.judge_id = $1 AND ja.is_effective = TRUE
       ORDER BY n.number`,
      [judgeId],
    );
    return result.rows.map((row) => ({
      assignmentId: row.id,
      nightId: row.night_id,
      nightNumber: row.night_number,
      specialtyId: row.specialty_id,
      specialty: row.specialty_code as Specialty,
      confirmed: row.confirmed,
    }));
  }

  async findEffectiveByJudgeAndNight(
    judgeId: string,
    nightId: string,
  ): Promise<EffectiveAssignment | null> {
    const result = await this.db.query<EffectiveAssignmentRow>(
      `SELECT ja.id, ja.night_id, ja.specialty_id, s.code AS specialty_code
       FROM judge_assignment ja
       JOIN specialty s ON s.id = ja.specialty_id
       WHERE ja.judge_id = $1 AND ja.night_id = $2 AND ja.is_effective = TRUE
       LIMIT 1`,
      [judgeId, nightId],
    );
    const row = result.rows[0];
    return row === undefined
      ? null
      : {
          id: row.id,
          nightId: row.night_id,
          specialtyId: row.specialty_id,
          specialty: row.specialty_code as Specialty,
        };
  }
}