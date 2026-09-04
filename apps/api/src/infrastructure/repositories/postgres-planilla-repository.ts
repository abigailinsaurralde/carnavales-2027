import type { QueryRunner } from "../../db/pool.js";
import type { Planilla } from "../../domain/entities/planilla.js";
import type {
  CreatePlanillaInput,
  PlanillaRepository,
  PlanillaSummaryRow,
} from "../../domain/repositories/planilla-repository.js";
import { mapPlanilla, type PlanillaRow } from "../mappers/planilla-mapper.js";

interface PlanillaSummaryDbRow {
  id: string;
  night_id: string;
  night_number: number;
  status: string;
  confirmed_at: Date | string | null;
  votes_count: number;
  updated_at: Date | string;
}

function mapSummaryRow(row: PlanillaSummaryDbRow): PlanillaSummaryRow {
  return {
    id: row.id,
    nightId: row.night_id,
    nightNumber: row.night_number,
    status: row.status as PlanillaSummaryRow["status"],
    confirmedAt: row.confirmed_at === null ? null : new Date(row.confirmed_at),
    votesCount: row.votes_count,
    updatedAt: new Date(row.updated_at),
  };
}

export class PostgresPlanillaRepository implements PlanillaRepository {
  constructor(private readonly db: QueryRunner) {}

  async findById(id: string): Promise<Planilla | null> {
    const result = await this.db.query<PlanillaRow>(
      `SELECT id, judge_id, night_id, status, confirmed_at, closed_at, client_ref, updated_at
       FROM planilla
       WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapPlanilla(row);
  }

  async findByIdForUpdate(id: string): Promise<Planilla | null> {
    const result = await this.db.query<PlanillaRow>(
      `SELECT id, judge_id, night_id, status, confirmed_at, closed_at, client_ref, updated_at
       FROM planilla
       WHERE id = $1
       FOR UPDATE`,
      [id],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapPlanilla(row);
  }

  async findByJudgeAndNight(judgeId: string, nightId: string): Promise<Planilla | null> {
    const result = await this.db.query<PlanillaRow>(
      `SELECT id, judge_id, night_id, status, confirmed_at, closed_at, client_ref, updated_at
       FROM planilla
       WHERE judge_id = $1 AND night_id = $2`,
      [judgeId, nightId],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapPlanilla(row);
  }

  async findByClientRef(judgeId: string, clientRef: string): Promise<Planilla | null> {
    const result = await this.db.query<PlanillaRow>(
      `SELECT id, judge_id, night_id, status, confirmed_at, closed_at, client_ref, updated_at
       FROM planilla
       WHERE judge_id = $1 AND client_ref = $2`,
      [judgeId, clientRef],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapPlanilla(row);
  }

  async findByJudgeNightClientRef(
    judgeId: string,
    nightId: string,
    clientRef: string,
  ): Promise<Planilla | null> {
    const result = await this.db.query<PlanillaRow>(
      `SELECT id, judge_id, night_id, status, confirmed_at, closed_at, client_ref, updated_at
       FROM planilla
       WHERE judge_id = $1 AND night_id = $2 AND client_ref = $3`,
      [judgeId, nightId, clientRef],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapPlanilla(row);
  }

  async findByJudge(judgeId: string): Promise<PlanillaSummaryRow[]> {
    const result = await this.db.query<PlanillaSummaryDbRow>(
      `SELECT p.id, p.night_id, n.number AS night_number, p.status, p.confirmed_at,
              (SELECT count(*)::int FROM vote v WHERE v.planilla_id = p.id) AS votes_count,
              p.updated_at
       FROM planilla p
       JOIN night n ON n.id = p.night_id
       WHERE p.judge_id = $1
       ORDER BY n.number`,
      [judgeId],
    );
    return result.rows.map(mapSummaryRow);
  }

  async create(input: CreatePlanillaInput): Promise<Planilla> {
    const result = await this.db.query<PlanillaRow>(
      `INSERT INTO planilla (id, judge_id, night_id, status, client_ref)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, judge_id, night_id, status, confirmed_at, closed_at, client_ref, updated_at`,
      [input.id, input.judgeId, input.nightId, input.status, input.clientRef ?? null],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error("INSERT INTO planilla returned no row");
    }
    return mapPlanilla(row);
  }

  async confirm(id: string, confirmedAt: Date): Promise<void> {
    await this.db.query(
      `UPDATE planilla
       SET status = 'CONFIRMADA', confirmed_at = $2, updated_at = now()
       WHERE id = $1`,
      [id, confirmedAt],
    );
  }

  async touch(id: string): Promise<void> {
    await this.db.query(
      `UPDATE planilla SET updated_at = now() WHERE id = $1`,
      [id],
    );
  }
}