import type {
  DeviceContext,
  ScoreSource,
  Vote,
  VoteSyncState,
} from "@votaciones2027/shared-types";

export interface VoteRow {
  id: string;
  edition_id: string;
  planilla_id: string;
  judge_id: string;
  night_id: string;
  comparsa_id: string;
  rubro_id: string;
  item_id: string;
  candidate_id: string;
  score: number | string;
  score_source: string;
  idempotency_key: string;
  version_id: string;
  sync_state: string;
  confirmed_at: Date | string | null;
  device_context: Record<string, unknown> | null;
}

/**
 * Mapea una fila `vote` al contrato compartido `Vote`.
 * `score` llega como NUMERIC(3,1): pg lo devuelve como string sin parser
 * custom, por eso se normaliza con Number().
 */
export function mapVote(row: VoteRow): Vote {
  const deviceContext =
    row.device_context === null || row.device_context === undefined
      ? undefined
      : (row.device_context as DeviceContext);
  const confirmedAt =
    row.confirmed_at === null || row.confirmed_at === undefined
      ? undefined
      : new Date(row.confirmed_at).toISOString();

  return {
    id: row.id,
    planillaId: row.planilla_id,
    judgeId: row.judge_id,
    nightId: row.night_id,
    comparsaId: row.comparsa_id,
    rubroId: row.rubro_id,
    itemId: row.item_id,
    candidateId: row.candidate_id,
    score: Number(row.score),
    scoreSource: row.score_source as ScoreSource,
    idempotencyKey: row.idempotency_key,
    versionId: row.version_id,
    syncState: row.sync_state as VoteSyncState,
    ...(deviceContext === undefined ? {} : { deviceContext }),
    ...(confirmedAt === undefined ? {} : { confirmedAt }),
  };
}