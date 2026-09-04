import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { AppConfig } from "./config.js";
import { createApplication } from "./application/index.js";
import { createPool, type DbPool } from "./db/pool.js";
import { handleError, writeJson } from "./errors/handler.js";
import {
  applyCorsHeaders,
  applySecurityHeaders,
  resolveCorsOrigin,
  sendPreflight,
} from "./http/security.js";
import { PostgresConfigurationRepository } from "./infrastructure/repositories/postgres-configuration-repository.js";
import { PostgresEditionRepository } from "./infrastructure/repositories/postgres-edition-repository.js";
import { PostgresNightRepository } from "./infrastructure/repositories/postgres-night-repository.js";
import { createRoutes, type RouteContext } from "./routes/index.js";
import { matchRoute, type Route } from "./routes/router.js";

const MAX_BODY_BYTES = 1024 * 1024; // 1 MB

export interface AppServer {
  server: Server;
  close(): Promise<void>;
}

export function createApp(config: AppConfig, db: DbPool = createPool(config.databaseUrl)): AppServer {
  const app = createApplication({
    editions: new PostgresEditionRepository(db),
    nights: new PostgresNightRepository(db),
    configurations: new PostgresConfigurationRepository(db),
  });

  const routes = createRoutes();
  const ctx: RouteContext = { app, nodeEnv: config.nodeEnv, corsOrigins: config.corsOrigins };

  const server = createServer((req, res) => {
    void handleRequest(req, res, routes, ctx, config.nodeEnv);
  });

  return {
    server,
    async close(): Promise<void> {
      await db.end();
      return new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  routes: readonly Route[],
  ctx: RouteContext,
  nodeEnv: string,
): Promise<void> {
  try {
    applySecurityHeaders(res);

    const corsOrigin = resolveCorsOrigin(ctx.corsOrigins, req);
    applyCorsHeaders(res, corsOrigin, false);

    const method = req.method;

    if (method === "OPTIONS") {
      sendPreflight(res, corsOrigin);
      return;
    }

    const contentLength = Number(req.headers["content-length"] ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
      writeJson(res, 413, {
        error: { code: "PAYLOAD_TOO_LARGE", message: "Request body too large" },
      });
      req.destroy();
      return;
    }

    if (method !== undefined && !["GET", "HEAD"].includes(method)) {
      writeJson(res, 405, {
        error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" },
      });
      return;
    }

    const match = matchRoute(routes, req.method, req.url);

    if (!match) {
      writeJson(res, 404, {
        error: { code: "NOT_FOUND", message: "Route not found" },
      });
      return;
    }

    await match.route.handler(req, res, ctx, match.params);
  } catch (err) {
    handleError(res, err, nodeEnv);
  }
}
