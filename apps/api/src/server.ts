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
import { PostgresAuditRepository } from "./infrastructure/repositories/postgres-audit-repository.js";
import { PostgresAccessTokenRepository } from "./infrastructure/repositories/postgres-access-token-repository.js";
import { PostgresCatalogueRepository } from "./infrastructure/repositories/postgres-catalogue-repository.js";
import { PostgresConfigurationRepository } from "./infrastructure/repositories/postgres-configuration-repository.js";
import { PostgresEditionRepository } from "./infrastructure/repositories/postgres-edition-repository.js";
import { PostgresJudgeAssignmentRepository } from "./infrastructure/repositories/postgres-judge-assignment-repository.js";
import { PostgresNightRepository } from "./infrastructure/repositories/postgres-night-repository.js";
import { PostgresPlanillaRepository } from "./infrastructure/repositories/postgres-planilla-repository.js";
import { PostgresSessionRepository } from "./infrastructure/repositories/postgres-session-repository.js";
import { PostgresUnitOfWork } from "./infrastructure/repositories/postgres-unit-of-work.js";
import { PostgresUserRepository } from "./infrastructure/repositories/postgres-user-repository.js";
import { PostgresVoteRepository } from "./infrastructure/repositories/postgres-vote-repository.js";
import { createRoutes, type RouteContext } from "./routes/index.js";
import { findPathCandidate, matchRoute, type Route } from "./routes/router.js";
import {
  classifyTier,
  createRateLimiter,
  type RateLimiter,
} from "./http/rate-limit.js";

const MAX_BODY_BYTES = 1024 * 1024; // 1 MB

export interface AppServer {
  server: Server;
  close(): Promise<void>;
}

export function createApp(config: AppConfig, db: DbPool = createPool(config.databaseUrl)): AppServer {
  const app = createApplication(
    {
      editions: new PostgresEditionRepository(db),
      nights: new PostgresNightRepository(db),
      configurations: new PostgresConfigurationRepository(db),
      users: new PostgresUserRepository(db),
      sessions: new PostgresSessionRepository(db),
      accessTokens: new PostgresAccessTokenRepository(db),
      planillas: new PostgresPlanillaRepository(db),
      votes: new PostgresVoteRepository(db),
      assignments: new PostgresJudgeAssignmentRepository(db),
      catalogue: new PostgresCatalogueRepository(db),
      audits: new PostgresAuditRepository(db),
      uow: new PostgresUnitOfWork(db),
    },
    { sessionTtlHours: config.sessionTtlHours },
  );

  const routes = createRoutes();
  const ctx: RouteContext = { app, nodeEnv: config.nodeEnv, corsOrigins: config.corsOrigins };

  const limiter: RateLimiter | null = config.rateLimit.enabled
    ? createRateLimiter({
        windowMs: config.rateLimit.windowMs,
        limits: config.rateLimit.limits,
      })
    : null;

  const server = createServer((req, res) => {
    void handleRequest(req, res, routes, ctx, config.nodeEnv, limiter);
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
  limiter: RateLimiter | null,
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

    if (limiter !== null) {
      const tier = classifyTier(method ?? "", req.url ?? "");
      const ip = req.socket.remoteAddress ?? "unknown";
      const check = limiter.check(`${ip}|${tier}`);
      if (!check.allowed) {
        res.setHeader("Retry-After", String(check.retryAfterSeconds));
        writeJson(res, 429, {
          error: { code: "TOO_MANY_REQUESTS", message: "Rate limit exceeded" },
        });
        return;
      }
    }

    const match = matchRoute(routes, req.method, req.url);

    if (match) {
      await match.route.handler(req, res, ctx, match.params);
      return;
    }

    const candidate = findPathCandidate(routes, req.url);
    if (candidate !== undefined) {
      res.setHeader("Allow", candidate.method);
      writeJson(res, 405, {
        error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" },
      });
      return;
    }

    writeJson(res, 404, {
      error: { code: "NOT_FOUND", message: "Route not found" },
    });
  } catch (err) {
    handleError(res, err, nodeEnv);
  }
}
