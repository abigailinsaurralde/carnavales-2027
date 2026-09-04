import type {
  PlanillaStatus,
  SyncPlanillaPayload,
  SyncVotePayload,
} from "@votaciones2027/shared-types";

/**
 * Estado de sincronización LOCAL de un voto o planilla.
 *
 * Extiende el contrato compartido (`PENDING | SYNCED | FAILED`) con el estado
 * transitorio `SYNCING`, que solo existe en el cliente mientras la operación
 * está en vuelo hacia el servidor. El servidor nunca ve este estado.
 */
export type LocalSyncState = "PENDING" | "SYNCING" | "SYNCED" | "FAILED";

export interface LocalVote {
  id: string;
  planillaId: string;
  nightId: string;
  comparsaId: string;
  rubroId: string;
  itemId: string;
  candidateId: string;
  score: number;
  idempotencyKey: string;
  clientRef?: string;
  syncState: LocalSyncState;
  error?: string;
  updatedAt: string;
}

export interface LocalPlanilla {
  id: string;
  nightId: string;
  clientRef: string;
  status: PlanillaStatus;
  updatedAt: string;
}

export type OutboxState = "PENDING" | "SYNCING" | "SYNCED" | "FAILED";
export type OutboxKind = "SYNC_PLANILLA";
export type OutboxResource = "PLANILLA";

export interface OutboxError {
  code: string;
  message: string;
  retryable: boolean;
  details?: unknown;
}

/**
 * Operación de la cola de sincronización (outbox).
 *
 * Se coalesce una sola operación por planilla: las ediciones locales durante
 * el vuelo incrementan `revision` para que el gestor re-encole la versión
 * nueva apenas termine la respuesta del servidor.
 */
export interface OutboxOperation {
  id: string;
  kind: OutboxKind;
  resource: OutboxResource;
  planillaId: string;
  payload: SyncPlanillaPayload;
  state: OutboxState;
  attempts: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
  lastAttemptAt?: string;
  nextAttemptAt?: string;
  lastError?: OutboxError;
}

export function canSyncPlanillaStatus(status: PlanillaStatus): boolean {
  return status === "BORRADOR" || status === "EN_EVALUACION";
}

export function toSyncVotePayload(vote: LocalVote): SyncVotePayload {
  return {
    id: vote.id,
    planillaId: vote.planillaId,
    comparsaId: vote.comparsaId,
    rubroId: vote.rubroId,
    itemId: vote.itemId,
    candidateId: vote.candidateId,
    score: vote.score,
    idempotencyKey: vote.idempotencyKey,
    ...(vote.clientRef === undefined ? {} : { clientRef: vote.clientRef }),
  };
}