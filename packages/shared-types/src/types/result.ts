export type TieBreakStage = 1 | 2 | 3;

export interface RubroResult {
  rubroId: string;
  comparsaId: string;
  total: number;
}

export interface TieBreakResolution {
  stage: TieBreakStage;
  comparasaIds: ReadonlyArray<string>;
  detail: Record<string, unknown>;
}

export interface ScrutinioRun {
  id: string;
  editionId: string;
  executedBy: string;
  inputSnapshotHash: string;
  executedAt: string;
}

export interface ScrutinioResult {
  run: ScrutinioRun;
  rubroResults: ReadonlyArray<RubroResult>;
  winnerComparsaId?: string;
  tieBreaks: ReadonlyArray<TieBreakResolution>;
}