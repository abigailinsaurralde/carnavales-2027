export type PlanillaStatus =
  | "BORRADOR"
  | "EN_EVALUACION"
  | "CONFIRMADA"
  | "SINCRONIZADA"
  | "CERRADA";

export interface Planilla {
  id: string;
  judgeId: string;
  nightId: string;
  status: PlanillaStatus;
  confirmedAt?: string;
  closedAt?: string;
}