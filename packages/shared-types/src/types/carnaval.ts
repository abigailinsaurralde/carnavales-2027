import type { Specialty } from "./specialty.js";

export type NightStatus = "PLANIFICADA" | "ABIERTA" | "CERRADA";

export type RubroType = "NOMINATIVO" | "ALEATORIO";

export interface CarnavalEdition {
  id: string;
  code: string;
  name: string;
  votingNights: number;
  startsOn?: string;
  endsOn?: string;
}

export interface Night {
  id: string;
  editionId: string;
  number: number;
  date?: string;
  status: NightStatus;
  /**
   * Inicio de la ventana de votación de la noche (inicio del estado ABIERTA).
   * ISO-8601. Opcional: mientras sea undefined el servidor NO aplica ventana
   * (no existen fechas oficiales, PEND-110).
   */
  startsAt?: string;
  /**
   * Fin de la ventana de votación de la noche (fin del estado ABIERTA).
   * ISO-8601. Opcional: mientras sea undefined el servidor NO aplica ventana.
   */
  endsAt?: string;
}

export interface Comparsa {
  id: string;
  editionId: string;
  code: string;
  name: string;
}

export interface Rubro {
  id: string;
  editionId: string;
  specialty: Specialty;
  name: string;
  type: RubroType;
}

export interface RubroItem {
  id: string;
  rubroId: string;
  name: string;
  orderIndex: number;
}

export interface Candidate {
  id: string;
  itemId: string;
  comparsaId: string;
  label: string;
}