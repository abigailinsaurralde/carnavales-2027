import type { Night } from "@votaciones2027/shared-types";
import type { QueryRunner } from "../../db/pool.js";
import type {
  AdminNightRepository,
  NightPatch,
} from "../../domain/repositories/admin-night-repository.js";
import type { NightRepository } from "../../domain/repositories/night-repository.js";
import { mapNight, type NightRow } from "../mappers/mappers.js";

export class PostgresNightRepository
  implements NightRepository, AdminNightRepository
{
  constructor(private readonly db: QueryRunner) {}

  async findById(id: string): Promise<Night | null> {
    const result = await this.db.query<NightRow>(
      `SELECT id, edition_id, number, date, status, starts_at, ends_at
       FROM night
       WHERE id = $1`,
      [id],
    );

    const row = result.rows[0];
    return row === undefined ? null : mapNight(row);
  }

  async findByEdition(editionId: string): Promise<Night[]> {
    const result = await this.db.query<NightRow>(
      `SELECT id, edition_id, number, date, status, starts_at, ends_at
       FROM night
       WHERE edition_id = $1
       ORDER BY number`,
      [editionId],
    );

    return result.rows.map(mapNight);
  }

  async updateNight(id: string, patch: NightPatch): Promise<Night | null> {
    const columnMap: Record<keyof NightPatch, string> = {
      date: "date",
      startsAt: "starts_at",
      endsAt: "ends_at",
    };
    const entries = Object.entries(patch) as [
      keyof NightPatch,
      NightPatch[keyof NightPatch],
    ][];
    if (entries.length === 0) {
      return this.findById(id);
    }

    const sets: string[] = [];
    const values: unknown[] = [id];
    for (const [column, value] of entries) {
      sets.push(`${columnMap[column]} = $${values.length + 1}`);
      values.push(value === undefined ? null : value);
    }

    const result = await this.db.query<NightRow>(
      `UPDATE night
       SET ${sets.join(", ")}
       WHERE id = $1
       RETURNING id, edition_id, number, date, status, starts_at, ends_at`,
      values,
    );

    const row = result.rows[0];
    return row === undefined ? null : mapNight(row);
  }
}