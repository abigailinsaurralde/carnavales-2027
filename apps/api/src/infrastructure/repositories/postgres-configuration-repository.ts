import type { ConfigurationVersion } from "@votaciones2027/shared-types";
import type { DbPool } from "../../db/pool.js";
import type { ConfigurationRepository } from "../../domain/repositories/configuration-repository.js";
import {
  mapConfigurationVersion,
  type ConfigurationVersionRow,
} from "../mappers/configuration-mapper.js";

export class PostgresConfigurationRepository implements ConfigurationRepository {
  constructor(private readonly db: DbPool) {}

  async findByEdition(editionId: string): Promise<ConfigurationVersion[]> {
    const result = await this.db.query<ConfigurationVersionRow>(
      `SELECT id, edition_id, version, status, frozen_at, frozen_by, rules_ref, content_ref
       FROM configuration_version
       WHERE edition_id = $1
       ORDER BY version DESC`,
      [editionId],
    );

    return result.rows.map(mapConfigurationVersion);
  }

  async findLatestByEdition(editionId: string): Promise<ConfigurationVersion | null> {
    const result = await this.db.query<ConfigurationVersionRow>(
      `SELECT id, edition_id, version, status, frozen_at, frozen_by, rules_ref, content_ref
       FROM configuration_version
       WHERE edition_id = $1
       ORDER BY version DESC
       LIMIT 1`,
      [editionId],
    );

    const row = result.rows[0];
    return row === undefined ? null : mapConfigurationVersion(row);
  }
}
