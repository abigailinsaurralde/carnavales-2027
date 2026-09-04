import { handleGetConfigurationVersion } from "./configuration.js";
import { handleGetEdition } from "./edition.js";
import { handleHealth } from "./health.js";
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
  ];
}
