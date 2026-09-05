import { handleGetConfigurationVersion } from "./configuration.js";
import {
  handleCreateComparsa,
  handleGetAdminContext,
  handleListAssignments,
  handleListCandidates,
  handleListComparsas,
  handleListRubroItems,
  handleListRubros,
  handleUpdateComparsa,
  handleUpdateNight,
  handleUpsertAssignment,
  handleUpsertCandidate,
  handleUpsertRubro,
  handleUpsertRubroItem,
} from "./admin.js";
import {
  handleGetSessionUser,
  handleIssueAccessToken,
  handleLogin,
  handleLoginWithAccessToken,
  handleLogout,
} from "./auth.js";
import { handleGetEdition } from "./edition.js";
import { handleHealth } from "./health.js";
import {
  handleConfirmPlanilla,
  handleCreatePlanilla,
  handleGetJudgeContext,
  handleGetPlanilla,
  handleListMyPlanillas,
  handleSyncPlanillas,
  handleUpsertVote,
} from "./judge.js";
import { handleGetNight } from "./night.js";
import type { Route, RouteContext } from "./router.js";

export type { RouteContext };

export function createRoutes(): readonly Route[] {
  return [
    { method: "GET", path: "/health", handler: handleHealth },
    { method: "GET", path: "/editions/:editionId", handler: handleGetEdition },
    { method: "GET", path: "/nights/:nightId", handler: handleGetNight },
    {
      method: "GET",
      path: "/editions/:editionId/configuration",
      handler: handleGetConfigurationVersion,
    },
    { method: "POST", path: "/auth/login", handler: handleLogin },
    { method: "POST", path: "/auth/access-token", handler: handleIssueAccessToken },
    {
      method: "POST",
      path: "/auth/access-token/login",
      handler: handleLoginWithAccessToken,
    },
    { method: "POST", path: "/auth/logout", handler: handleLogout },
    { method: "GET", path: "/auth/me", handler: handleGetSessionUser },
    { method: "GET", path: "/judge/context", handler: handleGetJudgeContext },
    { method: "GET", path: "/judge/planillas", handler: handleListMyPlanillas },
    { method: "POST", path: "/judge/planillas", handler: handleCreatePlanilla },
    {
      method: "POST",
      path: "/judge/planillas/sync",
      handler: handleSyncPlanillas,
    },
    {
      method: "GET",
      path: "/judge/planillas/:planillaId",
      handler: handleGetPlanilla,
    },
    {
      method: "PUT",
      path: "/judge/planillas/:planillaId/votes/:voteId",
      handler: handleUpsertVote,
    },
    {
      method: "POST",
      path: "/judge/planillas/:planillaId/confirm",
      handler: handleConfirmPlanilla,
    },
    { method: "GET", path: "/admin/context", handler: handleGetAdminContext },
    { method: "GET", path: "/admin/comparsas", handler: handleListComparsas },
    { method: "POST", path: "/admin/comparsas", handler: handleCreateComparsa },
    { method: "GET", path: "/admin/rubros", handler: handleListRubros },
    {
      method: "GET",
      path: "/admin/rubros/:rubroId/items",
      handler: handleListRubroItems,
    },
    { method: "POST", path: "/admin/rubros", handler: handleUpsertRubro },
    {
      method: "PUT",
      path: "/admin/comparsas/:comparsaId",
      handler: handleUpdateComparsa,
    },
    {
      method: "PUT",
      path: "/admin/rubros/:rubroId",
      handler: handleUpsertRubro,
    },
    {
      method: "POST",
      path: "/admin/rubros/:rubroId/items",
      handler: handleUpsertRubroItem,
    },
    { method: "PUT", path: "/admin/items/:itemId", handler: handleUpsertRubroItem },
    { method: "GET", path: "/admin/candidates", handler: handleListCandidates },
    { method: "POST", path: "/admin/candidates", handler: handleUpsertCandidate },
    {
      method: "PUT",
      path: "/admin/candidates/:candidateId",
      handler: handleUpsertCandidate,
    },
    {
      method: "PUT",
      path: "/admin/nights/:nightId",
      handler: handleUpdateNight,
    },
    { method: "GET", path: "/admin/assignments", handler: handleListAssignments },
    { method: "POST", path: "/admin/assignments", handler: handleUpsertAssignment },
    {
      method: "PUT",
      path: "/admin/assignments/:assignmentId",
      handler: handleUpsertAssignment,
    },
  ];
}
