import type {
  JudgeAssignmentContext,
  JudgeAssignmentView,
} from "@votaciones2027/shared-types";
import type { DbPool } from "../../db/pool.js";
import type { AdminAssignmentRepository } from "../../domain/repositories/admin-assignment-repository.js";
import type {
  EffectiveAssignment,
  JudgeAssignmentRepository,
} from "../../domain/repositories/judge-assignment-repository.js";
import { ConflictError, DatabaseError } from "../../errors/app-error.js";

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

interface FlatAssignmentRow {
  id: string;
  judge_id: string;
  night_id: string;
  specialty_id: string;
  is_effective: boolean;
}

function pgErrorCode(error: unknown): string | null {
  if (error instanceof DatabaseError && error.pgCode !== undefined) {
    return error.pgCode;
  }
  if (typeof error === "object" && error !== null && "code" in error) {
    return String((error as { code: unknown }).code);
  }
  return null;
}

function requireRow<T>(row: T | undefined): T {
  if (row === undefined) {
    throw new DatabaseError("Insert did not return a row");
  }
  return row;
}

/**
 * DECISIÓN TÉCNICA (no de negocio): el esquema 001 no posee una columna
 * `judge_assignment.confirmed`; el único flag de estado de la asignación es
 * `is_effective`. Como el contexto solo expone asignaciones EFECTIVAS, el
 * campo `confirmed` del contrato se deriva de `is_effective` (TRUE en todas
 * las filas devueltas). Si la migración 003 añade una columna independiente
 * de confirmación, este query deberá actualizarse para leerla.
 */
export class PostgresJudgeAssignmentRepository
  implements JudgeAssignmentRepository, AdminAssignmentRepository
{
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
      specialty: row.specialty_code as EffectiveAssignment["specialty"],
      confirmed: row.confirmed,
    }));
  }

  async findEffectiveByJudgeAndNight(
    judgeId: string,
    nightId: string,
  ): Promise<EffectiveAssignment | null> {
    // ORDER BY s.code: resolución DETERMINISTA cuando el juez tiene más de una
    // asignación efectiva en la misma noche (estado que el console admin
    // admite hoy; el conjunto de incompatibilidades es PEND-112 y NO se decide
    // aquí). Sin el ORDER BY, `LIMIT 1` devolvía una fila arbitraria y el
    // resultado del caso de uso dependía del plan físico de PostgreSQL.
    const result = await this.db.query<EffectiveAssignmentRow>(
      `SELECT ja.id, ja.night_id, ja.specialty_id, s.code AS specialty_code
       FROM judge_assignment ja
       JOIN specialty s ON s.id = ja.specialty_id
       WHERE ja.judge_id = $1 AND ja.night_id = $2 AND ja.is_effective = TRUE
       ORDER BY s.code
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
          specialty: row.specialty_code as EffectiveAssignment["specialty"],
        };
  }

  async listByEdition(editionId: string): Promise<JudgeAssignmentView[]> {
    const result = await this.db.query<FlatAssignmentRow>(
      `SELECT ja.id, ja.judge_id, ja.night_id, ja.specialty_id, ja.is_effective
       FROM judge_assignment ja
       JOIN night n ON n.id = ja.night_id
       WHERE n.edition_id = $1
       ORDER BY n.number, ja.specialty_id, ja.judge_id`,
      [editionId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      judgeId: row.judge_id,
      nightId: row.night_id,
      specialtyId: row.specialty_id,
      isEffective: row.is_effective,
    }));
  }

  async create(input: {
    judgeId: string;
    nightId: string;
    specialtyId: string;
    isEffective: boolean;
  }): Promise<JudgeAssignmentView> {
    try {
      const result = await this.db.query<FlatAssignmentRow>(
        `INSERT INTO judge_assignment (judge_id, night_id, specialty_id, is_effective)
         VALUES ($1, $2, $3, $4)
         RETURNING id, judge_id, night_id, specialty_id, is_effective`,
        [input.judgeId, input.nightId, input.specialtyId, input.isEffective],
      );
      return this.flatRowToView(requireRow(result.rows[0]));
    } catch (error) {
      if (pgErrorCode(error) === "23505") {
        throw new ConflictError("A judge assignment already exists for this combination");
      }
      throw error;
    }
  }

  async update(
    id: string,
    input: { isEffective: boolean },
  ): Promise<JudgeAssignmentView | null> {
    try {
      const result = await this.db.query<FlatAssignmentRow>(
        `UPDATE judge_assignment
         SET is_effective = $2
         WHERE id = $1
         RETURNING id, judge_id, night_id, specialty_id, is_effective`,
        [id, input.isEffective],
      );
      const row = result.rows[0];
      return row === undefined ? null : this.flatRowToView(row);
    } catch (error) {
      if (pgErrorCode(error) === "23505") {
        throw new ConflictError("A judge assignment already exists for this combination");
      }
      throw error;
    }
  }

  private flatRowToView(row: FlatAssignmentRow): JudgeAssignmentView {
    return {
      id: row.id,
      judgeId: row.judge_id,
      nightId: row.night_id,
      specialtyId: row.specialty_id,
      isEffective: row.is_effective,
    };
  }
}
