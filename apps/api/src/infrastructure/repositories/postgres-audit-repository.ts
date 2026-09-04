import type { AuditEvent } from "@votaciones2027/shared-types";
import type { QueryRunner } from "../../db/pool.js";
import type {
  AuditRepository,
  CreateAuditEventInput,
} from "../../domain/repositories/audit-repository.js";

export class PostgresAuditRepository implements AuditRepository {
  constructor(private readonly db: QueryRunner) {}

  async create(input: CreateAuditEventInput): Promise<AuditEvent> {
    const result = await this.db.query<{
      id: string;
      event_type: string;
      entity_type: string;
      entity_id: string | null;
      actor_user_id: string | null;
      occurred_at: Date | string;
    }>(
      `INSERT INTO audit_event (event_type, entity_type, entity_id, actor_user_id, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING id, event_type, entity_type, entity_id, actor_user_id, occurred_at`,
      [
        input.eventType,
        input.entityType,
        input.entityId ?? null,
        input.actorUserId ?? null,
        JSON.stringify(input.payload),
      ],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error("INSERT INTO audit_event returned no row");
    }
    return {
      id: row.id,
      eventType: row.event_type as AuditEvent["eventType"],
      entityType: row.entity_type as AuditEvent["entityType"],
      entityId: row.entity_id,
      ...(row.actor_user_id === null ? {} : { actorUserId: row.actor_user_id }),
      occurredAt: new Date(row.occurred_at).toISOString(),
      ...(input.deviceContext === undefined ? {} : { deviceContext: input.deviceContext }),
      payload: input.payload,
    };
  }
}