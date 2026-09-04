import type { ConfigurationRepository } from "../domain/repositories/configuration-repository.js";
import type { EditionRepository } from "../domain/repositories/edition-repository.js";
import type { NightRepository } from "../domain/repositories/night-repository.js";
import type { SessionRepository } from "../domain/repositories/session-repository.js";
import type { UserRepository } from "../domain/repositories/user-repository.js";
import {
  GetConfigurationVersion,
  GetEdition,
  GetNight,
  GetSessionUser,
  Login,
  Logout,
} from "./use-cases/index.js";

export interface Application {
  getEdition: GetEdition;
  getNight: GetNight;
  getConfigurationVersion: GetConfigurationVersion;
  login: Login;
  logout: Logout;
  getSessionUser: GetSessionUser;
}

export interface Repositories {
  editions: EditionRepository;
  nights: NightRepository;
  configurations: ConfigurationRepository;
  users: UserRepository;
  sessions: SessionRepository;
}

export interface ApplicationOptions {
  sessionTtlHours: number;
}

export function createApplication(
  repos: Repositories,
  options: ApplicationOptions,
): Application {
  return {
    getEdition: new GetEdition(repos.editions),
    getNight: new GetNight(repos.nights),
    getConfigurationVersion: new GetConfigurationVersion(repos.configurations),
    login: new Login(repos.users, repos.sessions, options.sessionTtlHours),
    logout: new Logout(repos.sessions),
    getSessionUser: new GetSessionUser(repos.users, repos.sessions),
  };
}