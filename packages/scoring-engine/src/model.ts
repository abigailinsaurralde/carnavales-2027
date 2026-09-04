import type {
  Candidate,
  Comparsa,
  Night,
  Penalizacion,
  Rubro,
  RubroItem,
  Vote,
} from "@votaciones2027/shared-types";

/**
 * In-memory immutable snapshot of the evidence required to perform a scrutinio.
 *
 * This is the "CALCULO" layer input (rule 17): it reads only the immutable
 * evidence (VOTO, PENALIZACION, catalogo) and never mutates it.
 */
export interface ScrutinioSnapshot {
  editionId: string;
  nights: ReadonlyArray<Night>;
  comparsas: ReadonlyArray<Comparsa>;
  rubros: ReadonlyArray<Rubro>;
  items: ReadonlyArray<RubroItem>;
  candidates: ReadonlyArray<Candidate>;
  votes: ReadonlyArray<Vote>;
  penalizaciones: ReadonlyArray<Penalizacion>;
}

export interface ScrutinioConfig {
  readonly executedBy: string;
}
