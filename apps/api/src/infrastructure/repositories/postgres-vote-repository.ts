import type { Vote } from "@votaciones2027/shared-types";
import type { QueryRunner } from "../../db/pool.js";
import type {
  CreateVoteInput,
  UpdateVoteInput,
  VoteRepository,
} from "../../domain/repositories/vote-repository.js";
import { mapVote, type VoteRow } from "../mappers/vote-mapper.js";

const VOTE_COLUMNS = `id, edition_id, planilla_id, judge_id, night_id, comparsa_id, rubro_id,
       item_id, candidate_id, score, score_source, idempotency_key, version_id,
       sync_state, confirmed_at, device_context`;

/**
 * NOTA DE CONTRATO CON DATABASE: los queries de este repositorio referencian
 * la columna `vote.client_ref` (agregada por la migración 003, fuera del
 * alcance Backend). Idem `planilla.client_ref` en PostgresPlanillaRepository.
 */
export class PostgresVoteRepository implements VoteRepository {
  constructor(private readonly db: QueryRunner) {}

  async findByPlanilla(planillaId: string): Promise<Vote[]> {
    const result = await this.db.query<VoteRow>(
      `SELECT ${VOTE_COLUMNS}
       FROM vote
       WHERE planilla_id = $1
       ORDER BY comparsa_id, rubro_id, item_id, candidate_id`,
      [planillaId],
    );
    return result.rows.map(mapVote);
  }

  async findById(id: string): Promise<Vote | null> {
    const result = await this.db.query<VoteRow>(
      `SELECT ${VOTE_COLUMNS}
       FROM vote
       WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapVote(row);
  }

  async findByBusinessKey(
    judgeId: string,
    nightId: string,
    comparsaId: string,
    rubroId: string,
    itemId: string,
    candidateId: string,
  ): Promise<Vote | null> {
    const result = await this.db.query<VoteRow>(
      `SELECT ${VOTE_COLUMNS}
       FROM vote
       WHERE judge_id = $1 AND night_id = $2 AND comparsa_id = $3
         AND rubro_id = $4 AND item_id = $5 AND candidate_id = $6`,
      [judgeId, nightId, comparsaId, rubroId, itemId, candidateId],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapVote(row);
  }

  async findByIdempotencyKey(judgeId: string, idempotencyKey: string): Promise<Vote | null> {
    const result = await this.db.query<VoteRow>(
      `SELECT ${VOTE_COLUMNS}
       FROM vote
       WHERE judge_id = $1 AND idempotency_key = $2`,
      [judgeId, idempotencyKey],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapVote(row);
  }

  async findByClientRef(judgeId: string, clientRef: string): Promise<Vote | null> {
    const result = await this.db.query<VoteRow>(
      `SELECT ${VOTE_COLUMNS}
       FROM vote
       WHERE judge_id = $1 AND client_ref = $2`,
      [judgeId, clientRef],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapVote(row);
  }

  async create(input: CreateVoteInput): Promise<Vote> {
    const result = await this.db.query<VoteRow>(
      `INSERT INTO vote (id, edition_id, planilla_id, judge_id, night_id, comparsa_id,
                         rubro_id, item_id, candidate_id, score, score_source,
                         idempotency_key, version_id, sync_state, confirmed_at,
                         device_context, client_ref)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       RETURNING ${VOTE_COLUMNS}`,
      [
        input.id,
        input.editionId,
        input.planillaId,
        input.judgeId,
        input.nightId,
        input.comparsaId,
        input.rubroId,
        input.itemId,
        input.candidateId,
        input.score,
        input.scoreSource,
        input.idempotencyKey,
        input.versionId,
        "PENDING" as const,
        input.confirmedAt ?? null,
        input.deviceContext === undefined ? null : JSON.stringify(input.deviceContext),
        input.clientRef ?? null,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error("INSERT INTO vote returned no row");
    }
    return mapVote(row);
  }

  async update(id: string, input: UpdateVoteInput): Promise<Vote> {
    const result = await this.db.query<VoteRow>(
      `UPDATE vote
       SET score = $2, idempotency_key = $3, client_ref = $4, device_context = $5
       WHERE id = $1
       RETURNING ${VOTE_COLUMNS}`,
      [
        id,
        input.score,
        input.idempotencyKey,
        input.clientRef ?? null,
        input.deviceContext === undefined ? null : JSON.stringify(input.deviceContext),
      ],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error("UPDATE vote returned no row");
    }
    return mapVote(row);
  }

  async confirm(id: string, confirmedAt: Date): Promise<void> {
    await this.db.query(
      `UPDATE vote SET confirmed_at = $2 WHERE id = $1`,
      [id, confirmedAt],
    );
  }

  async delete(id: string): Promise<void> {
    await this.db.query(
      `DELETE FROM vote WHERE id = $1`,
      [id],
    );
  }
}