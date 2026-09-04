import type { Night } from "@votaciones2027/shared-types";
import type { DbPool } from "../../db/pool.js";
import type { NightRepository } from "../../domain/repositories/night-repository.js";
import { mapNight, type NightRow } from "../mappers/mappers.js";

export class PostgresNightRepository implements NightRepository {
  constructor(private readonly db: DbPool) {}

  async findById(id: string): Promise<Night | null> {
    const result = await this.db.query<NightRow>(
      `SELECT id, edition_id, number, date, status
       FROM night
       WHERE id = $1`,
      [id],
    );

    const row = result.rows[0];
    return row === undefined ? null : mapNight(row);
  }

  async findByEdition(editionId: string): Promise<Night[]> {
    const result = await this.db.query<NightRow>(
      `SELECT id, edition_id, number, date, status
       FROM night
       WHERE edition_id = $1
       ORDER BY number`,
      [editionId],
    );

    return result.rows.map(mapNight);
  }
}
