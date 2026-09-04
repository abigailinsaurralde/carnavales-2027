import type {
  DeviceContext,
  ScoreSource,
  Vote,
  VoteSyncState,
} from "@votaciones2027/shared-types";

export interface CreateVoteInput {
  id: string;
  planillaId: string;
  judgeId: string;
  nightId: string;
  editionId: string;
  comparsaId: string;
  rubroId: string;
  itemId: string;
  candidateId: string;
  score: number;
  scoreSource: ScoreSource;
  idempotencyKey: string;
  versionId: string;
  clientRef?: string;
  confirmedAt?: Date;
  deviceContext?: DeviceContext;
}

export interface UpdateVoteInput {
  score: number;
  idempotencyKey: string;
  clientRef?: string;
  deviceContext?: DeviceContext;
}

export interface VoteRepository {
  findByPlanilla(planillaId: string): Promise<Vote[]>;
  findById(id: string): Promise<Vote | null>;
  findByBusinessKey(
    judgeId: string,
    nightId: string,
    comparsaId: string,
    rubroId: string,
    itemId: string,
    candidateId: string,
  ): Promise<Vote | null>;
  findByIdempotencyKey(
    judgeId: string,
    idempotencyKey: string,
  ): Promise<Vote | null>;
  findByClientRef(
    judgeId: string,
    clientRef: string,
  ): Promise<Vote | null>;
  create(input: CreateVoteInput): Promise<Vote>;
  update(id: string, input: UpdateVoteInput): Promise<Vote>;
  confirm(id: string, confirmedAt: Date): Promise<void>;
  delete(id: string): Promise<void>;
}

export type { Vote, VoteSyncState };