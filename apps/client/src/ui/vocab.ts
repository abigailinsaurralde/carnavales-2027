import type {
  NightStatus,
  PlanillaStatus,
  RubroType,
  Specialty,
} from "@votaciones2027/shared-types";
import { errorCode } from "../api/client.js";
import type { AdminSection } from "./router.js";

/**
 * Vocabulario de presentación: etiquetas legibles para estados y mensajes.
 *
 * REGLA DE PRESENTACIÓN: ningún ID técnico, código de error o detalle de
 * infraestructura debe llegar a la UI. Los errores se traducen a mensajes
 * accionables en lenguaje del juez.
 */

export const SPECIALTY_LABELS: Record<Specialty, string> = {
  BAILE: "Baile",
  VESTUARIO: "Vestuario",
  BATERIA: "Batería",
};

export const NIGHT_STATUS_LABELS: Record<NightStatus, string> = {
  PLANIFICADA: "Planificada",
  ABIERTA: "Abierta",
  CERRADA: "Cerrada",
};

export const RUBRO_TYPE_LABELS: Record<RubroType, string> = {
  NOMINATIVO: "Nominativo",
  ALEATORIO: "Aleatorio",
};

export const PLANILLA_STATUS_LABELS: Record<PlanillaStatus, string> = {
  BORRADOR: "Borrador",
  EN_EVALUACION: "En evaluación",
  CONFIRMADA: "Confirmada",
  SINCRONIZADA: "Sincronizada",
  CERRADA: "Cerrada",
};

export const ADMIN_SECTION_LABELS: Record<AdminSection, string> = {
  overview: "Resumen",
  comparsas: "Comparsas",
  rubros: "Rubros",
  candidates: "Candidatos",
  nights: "Noches",
  assignments: "Asignaciones",
};

export interface SyncBadge {
  label: string;
  tone: "ok" | "pending" | "syncing" | "error";
}

export const SOURCE_LABELS: Record<"JUDGE" | "OMISSION_CORRECTION", string> = {
  JUDGE: "Nota del juez",
  OMISSION_CORRECTION: "Corrección por omisión",
};

export const SCORE_HELP =
  "Notas de 0 a 10. 0 = no se presentó. Si dejás un ítem sin nota, al confirmar se computa 5 (omisión).";

export function nightLabel(nightNumber: number): string {
  return `Noche ${nightNumber}`;
}

export function planillaStatusLabel(status: string): string {
  return PLANILLA_STATUS_LABELS[status as PlanillaStatus] ?? status;
}

/**
 * Traduce un fallo de red/HTTP a un mensaje accionable.
 */
export function friendlyError(kind: string, body: unknown): string {
  const code = errorCode(body);
  if (code === "INVALID_CREDENTIALS") {
    return "Email o contraseña incorrectos. Revisalos e intentá de nuevo.";
  }
  if (code === "UNAUTHORIZED" || kind === "UNAUTHORIZED") {
    return "Tu sesión expiró. Volvé a ingresar con tu cuenta.";
  }
  if (kind === "FORBIDDEN" || code === "FORBIDDEN") {
    return "No tenés permiso para realizar esta acción.";
  }
  if (kind === "NETWORK") {
    return "Sin conexión. El cambio quedó guardado en este dispositivo y se sincronizará cuando haya conexión.";
  }
  if (kind === "TIMEOUT") {
    return "El servidor no respondió a tiempo. Reintentá o esperá a reconectar.";
  }
  if (code === "PLANILLA_NOT_EDITABLE" || code === "VOTE_CONFIRMED_IMMUTABLE") {
    return "La planilla ya está confirmada. No se puede modificar.";
  }
  if (code === "NIGHT_WINDOW_CLOSED") {
    return "La ventana de votación de la noche está cerrada.";
  }
  if (code === "NOT_FOUND") {
    return "No se encontró la planilla. Puede haber sido confirmada o removida.";
  }
  if (code === "PLANILLA_NOT_OWNED") {
    return "Esta planilla no corresponde a tu especialidad. Revisá con el coordinador.";
  }
  if (code === "JUDGE_NOT_ASSIGNED") {
    return "No estás asignado como juez para esta noche. Revisá con el coordinador.";
  }
  if (code === "IDEMPOTENCY_CONFLICT") {
    return "Hubo un conflicto al guardar. Reintentá la operación.";
  }
  if (code === "COMPARSA_CODE_CONFLICT") {
    return "Ya existe una comparsa con ese código.";
  }
  if (code === "CONFLICT") {
    return "Ya existe un registro igual en el sistema. Revisá los datos.";
  }
  if (code === "VALIDATION_ERROR") {
    return "Los datos ingresados no son válidos. Revisalos e intentá de nuevo.";
  }
  if (kind === "HTTP") {
    return "Ocurrió un error al comunicarse con el sistema. Reintentá.";
  }
  return "Ocurrió un error inesperado. Reintentá.";
}