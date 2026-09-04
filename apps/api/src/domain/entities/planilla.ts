import type { Planilla as SharedPlanilla, PlanillaStatus } from "@votaciones2027/shared-types";

/**
 * Entidad de persistencia de una planilla de votación del jurado.
 * Incluye campos de sincronización (clientRef) y marcas temporales que no
 * existen en el contrato compartido `Planilla` (que solo expone id, judgeId,
 * nightId, status, confirmedAt?, closedAt?).
 */
export interface Planilla {
  id: string;
  judgeId: string;
  nightId: string;
  status: PlanillaStatus;
  confirmedAt: Date | null;
  closedAt: Date | null;
  clientRef?: string;
  updatedAt: Date;
}

/** Mapea la entidad de dominio a su forma de contrato compartido. */
export function toSharedPlanilla(planilla: Planilla): SharedPlanilla {
  return {
    id: planilla.id,
    judgeId: planilla.judgeId,
    nightId: planilla.nightId,
    status: planilla.status,
    ...(planilla.confirmedAt === null ? {} : { confirmedAt: planilla.confirmedAt.toISOString() }),
    ...(planilla.closedAt === null ? {} : { closedAt: planilla.closedAt.toISOString() }),
  };
}

/**
 * Una planilla es editable (permite crear/modificar/eliminar votos y
 * confirmarse) SOLO en estados BORRADOR o EN_EVALUACION. CONFIRMADA,
 * SINCRONIZADA y CERRADA son terminales para la operación del juez.
 */
export function isEditablePlanilla(status: PlanillaStatus): boolean {
  return status === "BORRADOR" || status === "EN_EVALUACION";
}
