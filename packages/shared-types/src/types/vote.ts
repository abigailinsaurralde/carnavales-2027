export type ScoreSource = "JUDGE" | "OMISSION_CORRECTION";

export type VoteSyncState = "PENDING" | "SYNCED" | "FAILED";

export interface DeviceContext {
  deviceId?: string;
  platform?: string;
  userAgent?: string;
  sessionId?: string;
}

export interface Vote {
  id: string;
  planillaId: string;
  judgeId: string;
  nightId: string;
  comparsaId: string;
  rubroId: string;
  itemId: string;
  candidateId: string;
  score: number;
  scoreSource: ScoreSource;
  idempotencyKey: string;
  versionId?: string;
  syncState: VoteSyncState;
  deviceContext?: DeviceContext;
  confirmedAt?: string;
}