import type { Candidate, Comparsa, Night, Rubro, RubroItem } from "./carnaval.js";
import type { ConfigurationVersionStatus } from "./configuration.js";
import type { Planilla, PlanillaStatus } from "./planilla.js";
import type { Specialty } from "./specialty.js";
import type { DeviceContext, Vote } from "./vote.js";

export interface JudgeAssignmentContext {
  assignmentId: string;
  nightId: string;
  nightNumber: number;
  specialtyId: string;
  specialty: Specialty;
  confirmed: boolean;
}

export interface JudgeContextEdition {
  id: string;
  code: string;
  name: string;
  votingNights: number;
}

export interface JudgeContextConfiguration {
  versionId: string;
  version: number;
  status: ConfigurationVersionStatus;
}

export interface JudgeContextResponse {
  edition: JudgeContextEdition;
  nights: Night[];
  assignments: JudgeAssignmentContext[];
  rubros: Rubro[];
  items: RubroItem[];
  candidates: Candidate[];
  comparsas: Comparsa[];
  configuration: JudgeContextConfiguration | null;
}

export interface PlanillaSummary {
  id: string;
  nightId: string;
  nightNumber: number;
  status: PlanillaStatus;
  confirmedAt?: string;
  votesCount: number;
  updatedAt: string;
}

export interface PlanillaDetail {
  planilla: Planilla;
  votes: Vote[];
}

export interface VoteUpsertPayload {
  comparsaId: string;
  rubroId: string;
  itemId: string;
  candidateId: string;
  score: number;
  idempotencyKey: string;
  clientRef?: string;
  deviceContext?: DeviceContext;
}

export interface RubroTotal {
  rubroId: string;
  total: number;
}

export interface ConfirmPlanillaResult {
  planilla: Planilla;
  votesConfirmed: number;
  omissionsInserted: number;
  /**
   * Totales por rubro de la planilla tras la subsanación de omisiones,
   * calculados por el servidor (autoridad del total por rubro; SVC2-64).
   * Valores ya materializados en la planilla, ordenados por rubroId.
   */
  rubroTotals: RubroTotal[];
}

export interface SyncVotePayload {
  id: string;
  planillaId: string;
  comparsaId: string;
  rubroId: string;
  itemId: string;
  candidateId: string;
  score: number;
  idempotencyKey: string;
  clientRef?: string;
  confirmedAt?: string;
  deviceContext?: DeviceContext;
}

export interface SyncPlanillaPayload {
  planilla: {
    id: string;
    nightId: string;
    clientRef: string;
    status?: PlanillaStatus;
    confirmedAt?: string;
  };
  votes: SyncVotePayload[];
}

export interface SyncVoteResult {
  id: string;
  action: "INSERTED" | "EXISTS" | "REJECTED";
  reason?: string;
}

export interface SyncPlanillaResult {
  planillaId: string;
  planillaAction: "INSERTED" | "ALREADY_EXISTS" | "CONFLICT";
  reason?: string;
  votes: SyncVoteResult[];
}

export interface SyncPlanillasRequest {
  planillas: SyncPlanillaPayload[];
  deviceContext?: DeviceContext;
}

export interface SyncPlanillasResult {
  planillas: SyncPlanillaResult[];
  syncedAt: string;
}
