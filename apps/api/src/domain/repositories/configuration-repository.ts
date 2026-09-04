import type { ConfigurationVersion } from "../entities/configuration.js";

export interface ConfigurationRepository {
  findByEdition(editionId: string): Promise<ConfigurationVersion[]>;
  findLatestByEdition(editionId: string): Promise<ConfigurationVersion | null>;
}
