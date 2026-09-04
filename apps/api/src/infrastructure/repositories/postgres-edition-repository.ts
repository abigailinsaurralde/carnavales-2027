import type { CarnavalEdition } from "@votaciones2027/shared-types";
import type { DbPool } from "../../db/pool.js";
import type { EditionRepository } from "../../domain/repositories/edition-repository.js";
import { mapEdition, type EditionRow } from "../mappers/mappers.js";

export class PostgresEditionRepository implements EditionRepository {
  constructor(private readonly db: DbPool) {}

  async findById(id: string): Promise<CarnavalEdition | null> {
    const result = await this.db.query<EditionRow>(
      `SELECT id, code, name, voting_nights, starts_on, ends_on
       FROM carnaval_edition
       WHERE id = $1`,
      [id],
    );

    const row = result.rows[0];
    return row === undefined ? null : mapEdition(row);
  }
}
