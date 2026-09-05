import type { RateLimitTier } from "./http/rate-limit.js";

export interface RateLimitConfig {
  enabled: boolean;
  windowMs: number;
  limits: Record<RateLimitTier, number>;
}

export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  enabled: true,
  windowMs: 60_000,
  limits: { auth: 10, "admin-write": 60, default: 300 },
};

export const DEFAULT_SESSION_TTL_HOURS = 12;

export interface AppConfig {
  port: number;
  nodeEnv: "development" | "production" | "test";
  databaseUrl: string;
  corsOrigins: string[];
  sessionTtlHours: number;
  rateLimit: RateLimitConfig;
}

export const NODE_ENVS = ["development", "production", "test"] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parsePort(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT: expected an integer between 0 and 65535`);
  }
  return port;
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === "") return fallback;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  throw new Error(`Invalid boolean: expected "true" or "false"`);
}

function parsePositiveInteger(
  raw: string | undefined,
  fallback: number,
  name: string,
): number {
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid ${name}: expected a positive integer`);
  }
  return value;
}

function readRateLimit(nodeEnv: NodeEnv): RateLimitConfig {
  return {
    enabled: parseBoolean(
      process.env["RATE_LIMIT_ENABLED"],
      nodeEnv !== "test",
    ),
    windowMs: parsePositiveInteger(
      process.env["RATE_LIMIT_WINDOW_MS"],
      DEFAULT_RATE_LIMIT.windowMs,
      "RATE_LIMIT_WINDOW_MS",
    ),
    limits: {
      auth: parsePositiveInteger(
        process.env["RATE_LIMIT_AUTH_MAX"],
        DEFAULT_RATE_LIMIT.limits.auth,
        "RATE_LIMIT_AUTH_MAX",
      ),
      "admin-write": parsePositiveInteger(
        process.env["RATE_LIMIT_ADMIN_WRITE_MAX"],
        DEFAULT_RATE_LIMIT.limits["admin-write"],
        "RATE_LIMIT_ADMIN_WRITE_MAX",
      ),
      default: parsePositiveInteger(
        process.env["RATE_LIMIT_DEFAULT_MAX"],
        DEFAULT_RATE_LIMIT.limits.default,
        "RATE_LIMIT_DEFAULT_MAX",
      ),
    },
  };
}

export function loadConfig(overrides?: Partial<AppConfig>): AppConfig {
  const rawNodeEnv = process.env["NODE_ENV"] ?? "development";
  if (!(NODE_ENVS as readonly string[]).includes(rawNodeEnv)) {
    throw new Error(
      `Invalid NODE_ENV "${rawNodeEnv}": expected one of ${NODE_ENVS.join(", ")}`,
    );
  }
  const nodeEnv = rawNodeEnv as NodeEnv;

  const port = parsePort(process.env["PORT"], 3000);
  const databaseUrl = overrides?.databaseUrl ?? requireEnv("DATABASE_URL");
  const sessionTtlHours = parsePositiveInteger(
    process.env["SESSION_TTL_HOURS"],
    overrides?.sessionTtlHours ?? DEFAULT_SESSION_TTL_HOURS,
    "SESSION_TTL_HOURS",
  );
  const corsOrigins = (process.env["CORS_ORIGINS"] ?? "*")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");

  if (nodeEnv === "production" && corsOrigins.includes("*")) {
    throw new Error(
      "Invalid CORS_ORIGINS for production: wildcard '*' is not allowed",
    );
  }

  return {
    port,
    nodeEnv,
    databaseUrl,
    corsOrigins,
    sessionTtlHours,
    rateLimit: readRateLimit(nodeEnv),
    ...overrides,
  };
}
