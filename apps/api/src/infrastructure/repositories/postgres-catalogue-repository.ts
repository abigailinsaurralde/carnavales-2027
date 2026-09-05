import type {
  AdminCatalogCounts,
  Candidate,
  Comparsa,
  Rubro,
  RubroItem,
  Specialty,
} from "@votaciones2027/shared-types";
import type { DbPool } from "../../db/pool.js";
import type {
  AdminCatalogueRepository,
  SpecialtyRecord,
} from "../../domain/repositories/admin-catalogue-repository.js";
import type {
  CandidateRef,
  CatalogueRepository,
  ComparsaRef,
  RubroItemRef,
  RubroWithSpecialty,
} from "../../domain/repositories/catalogue-repository.js";
import {
  ConflictError,
  DatabaseError,
  NotFoundError,
} from "../../errors/app-error.js";

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

interface SpecialtyRow {
  id: string;
  code: string;
  order: number;
}

function pgErrorCode(error: unknown): string | null {
  if (error instanceof DatabaseError && error.pgCode !== undefined) {
    return error.pgCode;
  }
  if (typeof error === "object" && error !== null && "code" in error) {
    return String((error as { code: unknown }).code);
  }
  return null;
}

function requireRow<T>(row: T | undefined): T {
  if (row === undefined) {
    throw new DatabaseError("Insert did not return a row");
  }
  return row;
}

function rowToRubro(row: RubroRow): Rubro {
  return {
    id: row.id,
    editionId: row.edition_id,
    specialty: row.specialty_code as Specialty,
    name: row.name,
    type: row.type as Rubro["type"],
  };
}

export class PostgresCatalogueRepository
  implements CatalogueRepository, AdminCatalogueRepository
{
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
    return result.rows.map(rowToRubro);
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
    if (row === undefined) {
      return null;
    }
    return {
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

  async listComparsas(editionId: string): Promise<Comparsa[]> {
    return this.findComparsasByEdition(editionId);
  }

  async listRubros(editionId: string): Promise<Rubro[]> {
    return this.findRubrosByEdition(editionId);
  }

  async listItemsByRubro(rubroId: string): Promise<RubroItem[]> {
    const result = await this.db.query<RubroItemRow>(
      `SELECT id, rubro_id, name, order_index
       FROM rubro_item
       WHERE rubro_id = $1
       ORDER BY order_index`,
      [rubroId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      rubroId: row.rubro_id,
      name: row.name,
      orderIndex: row.order_index,
    }));
  }

  async listCandidates(editionId: string): Promise<Candidate[]> {
    return this.findCandidatesByEdition(editionId);
  }

  async catalogCounts(editionId: string): Promise<AdminCatalogCounts> {
    const result = await this.db.query<{
      comparsas: string;
      rubros: string;
      items: string;
      candidates: string;
      assignments: string;
    }>(
      `SELECT
         (SELECT count(*) FROM comparsa WHERE edition_id = $1) AS comparsas,
         (SELECT count(*) FROM rubro WHERE edition_id = $1) AS rubros,
         (SELECT count(*) FROM rubro_item ri JOIN rubro r ON r.id = ri.rubro_id
            WHERE r.edition_id = $1) AS items,
         (SELECT count(*) FROM candidate c
            JOIN rubro_item ri ON ri.id = c.item_id
            JOIN rubro r ON r.id = ri.rubro_id
            WHERE r.edition_id = $1) AS candidates,
         (SELECT count(*) FROM judge_assignment ja JOIN night n ON n.id = ja.night_id
            WHERE n.edition_id = $1) AS assignments`,
      [editionId],
    );
    const row = result.rows[0];
    return {
      comparsas: Number(row?.comparsas ?? 0),
      rubros: Number(row?.rubros ?? 0),
      items: Number(row?.items ?? 0),
      candidates: Number(row?.candidates ?? 0),
      assignments: Number(row?.assignments ?? 0),
    };
  }

  async listSpecialties(): Promise<SpecialtyRecord[]> {
    const result = await this.db.query<SpecialtyRow>(
      `SELECT id, code, "order"
       FROM specialty
       ORDER BY "order"`,
    );
    return result.rows.map((row) => ({
      id: row.id,
      code: row.code as Specialty,
      order: row.order,
    }));
  }

  async findSpecialtyByCode(code: Specialty): Promise<SpecialtyRecord | null> {
    const result = await this.db.query<SpecialtyRow>(
      `SELECT id, code, "order"
       FROM specialty
       WHERE code = $1`,
      [code],
    );
    const row = result.rows[0];
    return row === undefined ? null : { id: row.id, code: row.code as Specialty, order: row.order };
  }

  async findSpecialtyById(id: string): Promise<SpecialtyRecord | null> {
    const result = await this.db.query<SpecialtyRow>(
      `SELECT id, code, "order"
       FROM specialty
       WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row === undefined ? null : { id: row.id, code: row.code as Specialty, order: row.order };
  }

  async createComparsa(
    editionId: string,
    input: { code: string; name: string },
  ): Promise<Comparsa> {
    try {
      const result = await this.db.query<ComparsaRow>(
        `INSERT INTO comparsa (edition_id, code, name)
         VALUES ($1, $2, $3)
         RETURNING id, edition_id, code, name`,
        [editionId, input.code, input.name],
      );
      const row = requireRow(result.rows[0]);
      return {
        id: row.id,
        editionId: row.edition_id,
        code: row.code,
        name: row.name,
      };
    } catch (error) {
      if (pgErrorCode(error) === "23505") {
        throw new ConflictError(
          "A comparsa with this code already exists in the edition",
          "COMPARSA_CODE_CONFLICT",
        );
      }
      throw error;
    }
  }

  async updateComparsa(
    id: string,
    input: { code: string; name: string },
  ): Promise<Comparsa | null> {
    try {
      const result = await this.db.query<ComparsaRow>(
        `UPDATE comparsa
         SET code = $2, name = $3
         WHERE id = $1
         RETURNING id, edition_id, code, name`,
        [id, input.code, input.name],
      );
      const row = result.rows[0];
      return row === undefined
        ? null
        : { id: row.id, editionId: row.edition_id, code: row.code, name: row.name };
    } catch (error) {
      if (pgErrorCode(error) === "23505") {
        throw new ConflictError(
          "A comparsa with this code already exists in the edition",
          "COMPARSA_CODE_CONFLICT",
        );
      }
      throw error;
    }
  }

  async createRubro(
    editionId: string,
    input: { specialtyId: string; name: string; type: Rubro["type"] },
  ): Promise<Rubro> {
    try {
      const result = await this.db.query<RubroRow>(
        `INSERT INTO rubro (edition_id, specialty_id, name, type)
         VALUES ($1, $2, $3, $4)
         RETURNING id, edition_id, specialty_id, name, type`,
        [editionId, input.specialtyId, input.name, input.type],
      );
      const inserted = requireRow(result.rows[0]);
      const created = await this.findRubroById(inserted.id);
      if (created === null) {
        throw new NotFoundError("Rubro");
      }
      return {
        id: created.id,
        editionId: created.editionId,
        specialty: created.specialty,
        name: created.name,
        type: created.type,
      };
    } catch (error) {
      if (pgErrorCode(error) === "23503") {
        throw new NotFoundError("Referenced resource");
      }
      throw error;
    }
  }

  async updateRubro(
    id: string,
    input: { specialtyId: string; name: string; type: Rubro["type"] },
  ): Promise<Rubro | null> {
    try {
      const result = await this.db.query<RubroRow>(
        `UPDATE rubro
         SET specialty_id = $2, name = $3, type = $4
         WHERE id = $1
         RETURNING id, edition_id, specialty_id, name, type`,
        [id, input.specialtyId, input.name, input.type],
      );
      const row = result.rows[0];
      if (row === undefined) {
        return null;
      }
      const updated = await this.findRubroById(id);
      if (updated === null) {
        return null;
      }
      return {
        id: updated.id,
        editionId: updated.editionId,
        specialty: updated.specialty,
        name: updated.name,
        type: updated.type,
      };
    } catch (error) {
      if (pgErrorCode(error) === "23503") {
        throw new NotFoundError("Referenced resource");
      }
      throw error;
    }
  }

  async createItem(input: {
    rubroId: string;
    name: string;
    orderIndex: number;
  }): Promise<RubroItem> {
    try {
      const result = await this.db.query<RubroItemRow>(
        `INSERT INTO rubro_item (rubro_id, name, order_index)
         VALUES ($1, $2, $3)
         RETURNING id, rubro_id, name, order_index`,
        [input.rubroId, input.name, input.orderIndex],
      );
      const row = requireRow(result.rows[0]);
      return { id: row.id, rubroId: row.rubro_id, name: row.name, orderIndex: row.order_index };
    } catch (error) {
      if (pgErrorCode(error) === "23503") {
        throw new NotFoundError("Referenced resource");
      }
      throw error;
    }
  }

  async updateItem(
    id: string,
    input: { name: string; orderIndex: number },
  ): Promise<RubroItem | null> {
    try {
      const result = await this.db.query<RubroItemRow>(
        `UPDATE rubro_item
         SET name = $2, order_index = $3
         WHERE id = $1
         RETURNING id, rubro_id, name, order_index`,
        [id, input.name, input.orderIndex],
      );
      const row = result.rows[0];
      return row === undefined
        ? null
        : { id: row.id, rubroId: row.rubro_id, name: row.name, orderIndex: row.order_index };
    } catch (error) {
      if (pgErrorCode(error) === "23503") {
        throw new NotFoundError("Referenced resource");
      }
      throw error;
    }
  }

  async createCandidate(input: {
    itemId: string;
    comparsaId: string;
    label: string;
  }): Promise<Candidate> {
    try {
      const result = await this.db.query<CandidateRow>(
        `INSERT INTO candidate (item_id, comparsa_id, label)
         VALUES ($1, $2, $3)
         RETURNING id, item_id, comparsa_id, label`,
        [input.itemId, input.comparsaId, input.label],
      );
      const row = requireRow(result.rows[0]);
      return { id: row.id, itemId: row.item_id, comparsaId: row.comparsa_id, label: row.label };
    } catch (error) {
      if (pgErrorCode(error) === "23503") {
        throw new NotFoundError("Referenced resource");
      }
      throw error;
    }
  }

  async updateCandidate(
    id: string,
    input: { itemId: string; comparsaId: string; label: string },
  ): Promise<Candidate | null> {
    try {
      const result = await this.db.query<CandidateRow>(
        `UPDATE candidate
         SET item_id = $2, comparsa_id = $3, label = $4
         WHERE id = $1
         RETURNING id, item_id, comparsa_id, label`,
        [id, input.itemId, input.comparsaId, input.label],
      );
      const row = result.rows[0];
      return row === undefined
        ? null
        : { id: row.id, itemId: row.item_id, comparsaId: row.comparsa_id, label: row.label };
    } catch (error) {
      if (pgErrorCode(error) === "23503") {
        throw new NotFoundError("Referenced resource");
      }
      throw error;
    }
  }
}