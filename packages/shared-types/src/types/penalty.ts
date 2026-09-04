export type PenalizacionStatus = "PENDIENTE_APROBACION" | "APROBADA" | "RECHAZADA";

export interface Penalizacion {
  id: string;
  editionId: string;
  comparsaId: string;
  nightId?: string;
  motivo: string;
  reglaArticulo: string;
  cantidad: number;
  evidencia?: string;
  estado: PenalizacionStatus;
  registeredBy: string;
  approvedBy?: string;
}