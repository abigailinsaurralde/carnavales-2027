import type { ConfigurationVersion } from "../../domain/entities/configuration.js";
import type { ConfigurationRepository } from "../../domain/repositories/configuration-repository.js";
import { NotFoundError } from "../../errors/app-error.js";
import type { UseCase } from "../types.js";

export interface GetConfigurationVersionInput {
  editionId: string;
}

export class GetConfigurationVersion
  implements UseCase<GetConfigurationVersionInput, ConfigurationVersion>
{
  constructor(private readonly configurations: ConfigurationRepository) {}

  async execute(input: GetConfigurationVersionInput): Promise<ConfigurationVersion> {
    const config = await this.configurations.findLatestByEdition(input.editionId);
    if (config === null) {
      throw new NotFoundError("ConfigurationVersion");
    }
    return config;
  }
}
