import type { DeviceContext } from "./vote.js";

export type AuditEventType =
  | "LOGIN"
  | "ACCESS_TOKEN_ISSUED"
  | "JURY_ASSIGNED"
  | "JURY_REPLACED"
  | "PLANILLA_CREATED"
  | "PLANILLA_MODIFIED"
  | "VOTE_CONFIRMED"
  | "SYNC_EXECUTED"
  | "OMISSION_CORRECTED"
  | "PLANILLA_CLOSED"
  | "PENALIZACION_REGISTERED"
  | "PENALIZACION_APPROVED"
  | "SCRUTINY_EXECUTED"
  | "TIE_BREAK_RESOLVED"
  | "ACTA_GENERATED"
  | "ADMIN_ACTION";

export type AuditEntityType =
  | "NIGHT"
  | "JUDGE_ASSIGNMENT"
  | "JUDGE_REPLACEMENT"
  | "SPECIALTY"
  | "RUBRO"
  | "RUBRO_ITEM"
  | "CANDIDATE"
  | "PLANILLA"
  | "VOTE"
  | "PENALIZACION"
  | "SCRUTINIO"
  | "CONFIGURATION_VERSION"
  | "ACTA"
  | "USER";

export interface AuditEvent {
  id: string;
  eventType: AuditEventType;
  entityType: AuditEntityType;
  entityId: string | null;
  actorUserId?: string;
  occurredAt: string;
  deviceContext?: DeviceContext;
  payload: Record<string, unknown>;
}