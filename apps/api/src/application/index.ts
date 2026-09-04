import type { EditionRepository } from "../domain/repositories/edition-repository.js";
import type { NightRepository } from "../domain/repositories/night-repository.js";
import type { ConfigurationRepository } from "../domain/repositories/configuration-repository.js";
import {
  GetConfigurationVersion,
  GetEdition,
  GetNight,
} from "./use-cases/index.js";

export interface Application {
  getEdition: GetEdition;
  getNight: GetNight;
  getConfigurationVersion: GetConfigurationVersion;
}

export interface Repositories {
  editions: EditionRepository;
  nights: NightRepository;
  configurations: ConfigurationRepository;
}

export function createApplication(repos: Repositories): Application {
  return {
    getEdition: new GetEdition(repos.editions),
    getNight: new GetNight(repos.nights),
    getConfigurationVersion: new GetConfigurationVersion(repos.configurations),
  };
}
