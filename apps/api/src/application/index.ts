import type { AccessTokenRepository } from "../domain/repositories/access-token-repository.js";
import type { AdminAssignmentRepository } from "../domain/repositories/admin-assignment-repository.js";
import type { AdminCatalogueRepository } from "../domain/repositories/admin-catalogue-repository.js";
import type { AdminNightRepository } from "../domain/repositories/admin-night-repository.js";
import type { AdminUserRepository } from "../domain/repositories/admin-user-repository.js";
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
  AdminGetContext,
  AdminListAssignments,
  AdminListCandidates,
  AdminListComparsas,
  AdminListRubroItems,
  AdminListRubros,
  CreateComparsa,
  UpdateComparsa,
  UpsertRubro,
  UpsertRubroItem,
  UpsertCandidate,
  UpdateNight,
  UpsertAssignment,
} from "./use-cases/admin/index.js";
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
  adminGetContext: AdminGetContext;
  adminCreateComparsa: CreateComparsa;
  adminUpdateComparsa: UpdateComparsa;
  adminUpsertRubro: UpsertRubro;
  adminUpsertRubroItem: UpsertRubroItem;
  adminUpsertCandidate: UpsertCandidate;
  adminUpdateNight: UpdateNight;
  adminUpsertAssignment: UpsertAssignment;
  adminListComparsas: AdminListComparsas;
  adminListRubros: AdminListRubros;
  adminListRubroItems: AdminListRubroItems;
  adminListCandidates: AdminListCandidates;
  adminListAssignments: AdminListAssignments;
}

export interface Repositories {
  editions: EditionRepository;
  nights: NightRepository & AdminNightRepository;
  configurations: ConfigurationRepository;
  users: UserRepository & AdminUserRepository;
  sessions: SessionRepository;
  accessTokens: AccessTokenRepository;
  planillas: PlanillaRepository;
  votes: VoteRepository;
  assignments: JudgeAssignmentRepository & AdminAssignmentRepository;
  catalogue: CatalogueRepository & AdminCatalogueRepository;
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
      repos.nights,
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
    adminGetContext: new AdminGetContext(
      repos.editions,
      repos.nights,
      repos.catalogue,
      repos.users,
    ),
    adminCreateComparsa: new CreateComparsa(
      repos.editions,
      repos.catalogue,
      repos.audits,
    ),
    adminUpdateComparsa: new UpdateComparsa(repos.catalogue, repos.audits),
    adminUpsertRubro: new UpsertRubro(
      repos.editions,
      repos.catalogue,
      repos.audits,
    ),
    adminUpsertRubroItem: new UpsertRubroItem(repos.catalogue, repos.audits),
    adminUpsertCandidate: new UpsertCandidate(repos.catalogue, repos.audits),
    adminUpdateNight: new UpdateNight(
      repos.nights,
      repos.nights,
      repos.audits,
    ),
    adminUpsertAssignment: new UpsertAssignment(
      repos.assignments,
      repos.users,
      repos.nights,
      repos.audits,
      repos.catalogue,
    ),
    adminListComparsas: new AdminListComparsas(repos.editions, repos.catalogue),
    adminListRubros: new AdminListRubros(repos.editions, repos.catalogue),
    adminListRubroItems: new AdminListRubroItems(repos.catalogue),
    adminListCandidates: new AdminListCandidates(repos.editions, repos.catalogue),
    adminListAssignments: new AdminListAssignments(
      repos.editions,
      repos.assignments,
    ),
  };
}