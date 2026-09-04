import type {
  Candidate,
  Comparsa,
  Rubro,
  RubroItem,
  Specialty,
} from "@votaciones2027/shared-types";

export interface RubroWithSpecialty {
  id: string;
  editionId: string;
  specialtyId: string;
  specialty: Specialty;
  name: string;
  type: Rubro["type"];
}

export interface RubroItemRef {
  id: string;
  rubroId: string;
}

export interface CandidateRef {
  id: string;
  itemId: string;
  comparsaId: string;
}

export interface ComparsaRef {
  id: string;
  editionId: string;
}

export interface CatalogueRepository {
  findRubrosByEdition(editionId: string): Promise<Rubro[]>;
  findItemsByEdition(editionId: string): Promise<RubroItem[]>;
  findCandidatesByEdition(editionId: string): Promise<Candidate[]>;
  findComparsasByEdition(editionId: string): Promise<Comparsa[]>;
  findRubroById(rubroId: string): Promise<RubroWithSpecialty | null>;
  findItemById(itemId: string): Promise<RubroItemRef | null>;
  findCandidateById(candidateId: string): Promise<CandidateRef | null>;
  findComparsaById(comparsaId: string): Promise<ComparsaRef | null>;
}