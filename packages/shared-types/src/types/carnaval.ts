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