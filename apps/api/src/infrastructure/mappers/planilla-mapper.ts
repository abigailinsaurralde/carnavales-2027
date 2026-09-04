import type { PlanillaStatus } from "@votaciones2027/shared-types";
import type { Planilla } from "../../domain/entities/planilla.js";

export interface PlanillaRow {
  id: string;
  judge_id: string;
  night_id: string;
  status: string;
  confirmed_at: Date | string | null;
  closed_at: Date | string | null;
  client_ref: string | null;
  updated_at: Date | string;
}

export function mapPlanilla(row: PlanillaRow): Planilla {
  return {
    id: row.id,
    judgeId: row.judge_id,
    nightId: row.night_id,
    status: row.status as PlanillaStatus,
    confirmedAt: row.confirmed_at === null ? null : new Date(row.confirmed_at),
    closedAt: row.closed_at === null ? null : new Date(row.closed_at),
    ...(row.client_ref === null || row.client_ref === undefined
      ? {}
      : { clientRef: row.client_ref }),
    updatedAt: new Date(row.updated_at),
  };
}