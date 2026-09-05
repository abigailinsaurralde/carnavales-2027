import type { AccessTokenRepository } from "../domain/repositories/access-token-repository.js";
import type { AuditRepository } from "../domain/repositories/audit-repository.js";
import type { CatalogueRepository } from "../domain/repositories/catalogue-repository.js";
import type { ConfigurationRepository } from "../domain/repositories/configuration-repository.js";
import type { EditionRepository } from "../domain/repositories/edition-repository.js";
import type { JudgeAssignmentRepository } from "../domain/repositories/judge-assignment-repository.js";
import type { NightRepository } from "../domain/repositories/night-repository.js";
import type { PlanillaRepository } from "../domain/repositories/planilla-repository.js";
import type { SessionRepository } from "../domain/repositories/session-repository.js";
import type { UnitOfWork } from "../domain/repositories/unit-of-work.js";
import type { UserRepository } from "../domain/repositories/user-repository.js";
import type { VoteRepository } from "../domain/repositories/vote-repository.js";
import { VoteValidator } from "./services/vote-validator.js";
import {
  ConfirmPlanilla,
  CreatePlanilla,
  GetConfigurationVersion,
  GetEdition,
  GetNight,
  GetPlanilla,
  GetSessionUser,
  JudgeContext,
  IssueAccessToken,
  ListMyPlanillas,
  Login,
  LoginWithAccessToken,
  Logout,
  SyncPlanillas,
  UpsertVote,
} from "./use-cases/index.js";

export interface Application {
  getEdition: GetEdition;
  getNight: GetNight;
  getConfigurationVersion: GetConfigurationVersion;
  login: Login;
  logout: Logout;
  getSessionUser: GetSessionUser;
  issueAccessToken: IssueAccessToken;
  loginWithAccessToken: LoginWithAccessToken;
  judgeContext: JudgeContext;
  listMyPlanillas: ListMyPlanillas;
  createPlanilla: CreatePlanilla;
  getPlanilla: GetPlanilla;
  upsertVote: UpsertVote;
  confirmPlanilla: ConfirmPlanilla;
  syncPlanillas: SyncPlanillas;
}

export interface Repositories {
  editions: EditionRepository;
  nights: NightRepository;
  configurations: ConfigurationRepository;
  users: UserRepository;
  sessions: SessionRepository;
  accessTokens: AccessTokenRepository;
  planillas: PlanillaRepository;
  votes: VoteRepository;
  assignments: JudgeAssignmentRepository;
  catalogue: CatalogueRepository;
  audits: AuditRepository;
  uow: UnitOfWork;
}

export interface ApplicationOptions {
  sessionTtlHours: number;
}

export function createApplication(
  repos: Repositories,
  options: ApplicationOptions,
): Application {
  const validator = new VoteValidator(
    repos.nights,
    repos.assignments,
    repos.catalogue,
  );

  return {
    getEdition: new GetEdition(repos.editions),
    getNight: new GetNight(repos.nights),
    getConfigurationVersion: new GetConfigurationVersion(repos.configurations),
    login: new Login(
      repos.users,
      repos.sessions,
      repos.audits,
      options.sessionTtlHours,
    ),
    logout: new Logout(repos.sessions),
    getSessionUser: new GetSessionUser(repos.users, repos.sessions),
    issueAccessToken: new IssueAccessToken(
      repos.users,
      repos.accessTokens,
      repos.audits,
    ),
    loginWithAccessToken: new LoginWithAccessToken(
      repos.users,
      repos.accessTokens,
      repos.sessions,
      repos.audits,
      options.sessionTtlHours,
    ),
    judgeContext: new JudgeContext(
      repos.editions,
      repos.nights,
      repos.configurations,
      repos.assignments,
      repos.catalogue,
    ),
    listMyPlanillas: new ListMyPlanillas(repos.planillas),
    createPlanilla: new CreatePlanilla(
      repos.planillas,
      repos.votes,
      repos.assignments,
      repos.audits,
    ),
    getPlanilla: new GetPlanilla(repos.planillas, repos.votes),
    upsertVote: new UpsertVote(
      repos.editions,
      repos.configurations,
      repos.planillas,
      repos.votes,
      validator,
    ),
    confirmPlanilla: new ConfirmPlanilla(
      repos.editions,
      repos.configurations,
      repos.assignments,
      repos.catalogue,
      repos.uow,
    ),
    syncPlanillas: new SyncPlanillas(
      repos.editions,
      repos.configurations,
      repos.assignments,
      repos.catalogue,
      repos.uow,
      validator,
    ),
  };
}