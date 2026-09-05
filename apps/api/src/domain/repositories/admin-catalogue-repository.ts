import type {
  AdminCatalogCounts,
  Candidate,
  Comparsa,
  Rubro,
  RubroItem,
  Specialty,
} from "@votaciones2027/shared-types";

/**
 * Columna administrativa del catálogo (Slice 1).
 *
 * Se mantiene SEPARADA de `CatalogueRepository` a propósito: los fakes de
 * lectura existentes en los tests no deben verse obligados a implementar
 * escritura. `PostgresCatalogueRepository` implementa ambas interfaces.
 *
 * Ninguna operación elimina datos: create/update/list (el delete físico no
 * está definido en el dominio y queda fuera del contrato de administración).
 */

export interface SpecialtyRecord {
  id: string;
  code: Specialty;
  order: number;
}

export interface AdminCatalogueRepository {
  // Lectura
  listComparsas(editionId: string): Promise<Comparsa[]>;
  listRubros(editionId: string): Promise<Rubro[]>;
  listItemsByRubro(rubroId: string): Promise<RubroItem[]>;
  listCandidates(editionId: string): Promise<Candidate[]>;
  catalogCounts(editionId: string): Promise<AdminCatalogCounts>;
  listSpecialties(): Promise<SpecialtyRecord[]>;
  findSpecialtyByCode(code: Specialty): Promise<SpecialtyRecord | null>;
  findSpecialtyById(id: string): Promise<SpecialtyRecord | null>;

  // Comparsas
  createComparsa(
    editionId: string,
    input: { code: string; name: string },
  ): Promise<Comparsa>;
  updateComparsa(
    id: string,
    input: { code: string; name: string },
  ): Promise<Comparsa | null>;

  // Rubros
  createRubro(
    editionId: string,
    input: { specialtyId: string; name: string; type: Rubro["type"] },
  ): Promise<Rubro>;
  updateRubro(
    id: string,
    input: { specialtyId: string; name: string; type: Rubro["type"] },
  ): Promise<Rubro | null>;

  // Ítems de rubro
  createItem(input: {
    rubroId: string;
    name: string;
    orderIndex: number;
  }): Promise<RubroItem>;
  updateItem(
    id: string,
    input: { name: string; orderIndex: number },
  ): Promise<RubroItem | null>;

  // Candidatos
  createCandidate(input: {
    itemId: string;
    comparsaId: string;
    label: string;
  }): Promise<Candidate>;
  updateCandidate(
    id: string,
    input: { itemId: string; comparsaId: string; label: string },
  ): Promise<Candidate | null>;
}