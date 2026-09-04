import type {
  AuditEntityType,
  AuditEvent,
  AuditEventType,
  DeviceContext,
} from "@votaciones2027/shared-types";

export interface CreateAuditEventInput {
  eventType: AuditEventType;
  entityType: AuditEntityType;
  entityId?: string | null;
  actorUserId?: string;
  deviceContext?: DeviceContext;
  payload: Record<string, unknown>;
}

export interface AuditRepository {
  create(input: CreateAuditEventInput): Promise<AuditEvent>;
}