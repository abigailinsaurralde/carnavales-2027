import type { IncomingMessage, ServerResponse } from "node:http";
import type { Application } from "../application/index.js";

export interface RouteContext {
  app: Application;
  nodeEnv: string;
  corsOrigins: readonly string[];
}

type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
  params: Record<string, string>,
) => void | Promise<void>;

export interface Route {
  method: string;
  path: string;
  handler: RouteHandler;
}

export function matchRoute(
  routes: readonly Route[],
  method: string | undefined,
  url: string | undefined,
): { route: Route; params: Record<string, string> } | undefined {
  if (!method || !url) return undefined;

  const pathname = url.split("?")[0] ?? "/";

  for (const route of routes) {
    if (route.method !== method) continue;

    const params = matchPath(route.path, pathname);
    if (params !== undefined) {
      return { route, params };
    }
  }

  return undefined;
}

/**
 * Busca una ruta que coincida por PATH aunque el método no coincida.
 * Permite distinguir 404 (ninguna ruta) de 405 (ruta existente, método no
 * admitido), devolviendo el candidato para anunciar el header `Allow`.
 */
export function findPathCandidate(
  routes: readonly Route[],
  url: string | undefined,
): Route | undefined {
  if (!url) return undefined;

  const pathname = url.split("?")[0] ?? "/";

  for (const route of routes) {
    if (matchPath(route.path, pathname) !== undefined) {
      return route;
    }
  }

  return undefined;
}

function matchPath(
  pattern: string,
  pathname: string,
): Record<string, string> | undefined {
  const patternParts = pattern.split("/");
  const pathnameParts = pathname.split("/");

  if (patternParts.length !== pathnameParts.length) return undefined;

  const params: Record<string, string> = {};

  for (let i = 0; i < patternParts.length; i++) {
    const pp = patternParts[i]!;
    const ip = pathnameParts[i]!;

    if (pp.startsWith(":")) {
      params[pp.slice(1)] = ip;
    } else if (pp !== ip) {
      return undefined;
    }
  }

  return params;
}
