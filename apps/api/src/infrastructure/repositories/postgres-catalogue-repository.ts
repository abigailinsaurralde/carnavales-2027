import type {
  Candidate,
  Comparsa,
  Rubro,
  RubroItem,
  Specialty,
} from "@votaciones2027/shared-types";
import type { DbPool } from "../../db/pool.js";
import type {
  CandidateRef,
  CatalogueRepository,
  ComparsaRef,
  RubroItemRef,
  RubroWithSpecialty,
} from "../../domain/repositories/catalogue-repository.js";

interface RubroRow {
  id: string;
  edition_id: string;
  specialty_id: string;
  specialty_code: string;
  name: string;
  type: string;
}

interface RubroItemRow {
  id: string;
  rubro_id: string;
  name: string;
  order_index: number;
}

interface CandidateRow {
  id: string;
  item_id: string;
  comparsa_id: string;
  label: string;
}

interface ComparsaRow {
  id: string;
  edition_id: string;
  code: string;
  name: string;
}

export class PostgresCatalogueRepository implements CatalogueRepository {
  constructor(private readonly db: DbPool) {}

  async findRubrosByEdition(editionId: string): Promise<Rubro[]> {
    const result = await this.db.query<RubroRow>(
      `SELECT r.id, r.edition_id, r.specialty_id, s.code AS specialty_code, r.name, r.type
       FROM rubro r
       JOIN specialty s ON s.id = r.specialty_id
       WHERE r.edition_id = $1
       ORDER BY s."order", r.name`,
      [editionId],
    );
    return result.rows.map<Rubro>((row) => ({
      id: row.id,
      editionId: row.edition_id,
      specialty: row.specialty_code as Specialty,
      name: row.name,
      type: row.type as Rubro["type"],
    }));
  }

  async findItemsByEdition(editionId: string): Promise<RubroItem[]> {
    const result = await this.db.query<RubroItemRow>(
      `SELECT ri.id, ri.rubro_id, ri.name, ri.order_index
       FROM rubro_item ri
       JOIN rubro r ON r.id = ri.rubro_id
       WHERE r.edition_id = $1
       ORDER BY r.id, ri.order_index`,
      [editionId],
    );
    return result.rows.map<RubroItem>((row) => ({
      id: row.id,
      rubroId: row.rubro_id,
      name: row.name,
      orderIndex: row.order_index,
    }));
  }

  async findCandidatesByEdition(editionId: string): Promise<Candidate[]> {
    const result = await this.db.query<CandidateRow>(
      `SELECT c.id, c.item_id, c.comparsa_id, c.label
       FROM candidate c
       JOIN rubro_item ri ON ri.id = c.item_id
       JOIN rubro r ON r.id = ri.rubro_id
       WHERE r.edition_id = $1
       ORDER BY ri.order_index, c.label`,
      [editionId],
    );
    return result.rows.map<Candidate>((row) => ({
      id: row.id,
      itemId: row.item_id,
      comparsaId: row.comparsa_id,
      label: row.label,
    }));
  }

  async findComparsasByEdition(editionId: string): Promise<Comparsa[]> {
    const result = await this.db.query<ComparsaRow>(
      `SELECT id, edition_id, code, name
       FROM comparsa
       WHERE edition_id = $1
       ORDER BY code`,
      [editionId],
    );
    return result.rows.map<Comparsa>((row) => ({
      id: row.id,
      editionId: row.edition_id,
      code: row.code,
      name: row.name,
    }));
  }

  async findRubroById(rubroId: string): Promise<RubroWithSpecialty | null> {
    const result = await this.db.query<RubroRow>(
      `SELECT r.id, r.edition_id, r.specialty_id, s.code AS specialty_code, r.name, r.type
       FROM rubro r
       JOIN specialty s ON s.id = r.specialty_id
       WHERE r.id = $1`,
      [rubroId],
    );
    const row = result.rows[0];
    return row === undefined
      ? null
      : {
          id: row.id,
          editionId: row.edition_id,
          specialtyId: row.specialty_id,
          specialty: row.specialty_code as Specialty,
          name: row.name,
          type: row.type as Rubro["type"],
        };
  }

  async findItemById(itemId: string): Promise<RubroItemRef | null> {
    const result = await this.db.query<RubroItemRow>(
      `SELECT id, rubro_id, name, order_index
       FROM rubro_item
       WHERE id = $1`,
      [itemId],
    );
    const row = result.rows[0];
    return row === undefined ? null : { id: row.id, rubroId: row.rubro_id };
  }

  async findCandidateById(candidateId: string): Promise<CandidateRef | null> {
    const result = await this.db.query<CandidateRow>(
      `SELECT id, item_id, comparsa_id, label
       FROM candidate
       WHERE id = $1`,
      [candidateId],
    );
    const row = result.rows[0];
    return row === undefined
      ? null
      : { id: row.id, itemId: row.item_id, comparsaId: row.comparsa_id };
  }

  async findComparsaById(comparsaId: string): Promise<ComparsaRef | null> {
    const result = await this.db.query<ComparsaRow>(
      `SELECT id, edition_id, code, name
       FROM comparsa
       WHERE id = $1`,
      [comparsaId],
    );
    const row = result.rows[0];
    return row === undefined
      ? null
      : { id: row.id, editionId: row.edition_id };
  }
}