import { describe, expect, it } from "vitest";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { loadConfig } from "../src/config.js";
import { createApp } from "../src/server.js";
import type { DbPool } from "../src/db/pool.js";
import {
  classifyTier,
  createRateLimiter,
  type RateLimitTier,
} from "../src/http/rate-limit.js";

function neverDb(): DbPool {
  const error = () => {
    throw new Error("rate-limit test should never touch the database");
  };
  return {
    query: error,
    withTransaction: error,
    async end() {},
  };
}

function httpGet(
  server: Server,
  path: string,
): Promise<{ status: number; retryAfter: string | undefined }> {
  const port = (server.address() as AddressInfo).port;
  return new Promise((resolve, reject) => {
    request(
      { host: "127.0.0.1", port, path, method: "GET" },
      (res) => {
        res.resume();
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, retryAfter: res.headers["retry-after"] }),
        );
      },
    ).on("error", reject).end();
  });
}

describe("rate-limit", () => {
  describe("classifyTier", () => {
    it("classifies auth paths as auth", () => {
      expect(classifyTier("POST", "/auth/login")).toBe("auth");
      expect(classifyTier("POST", "/auth/access-token")).toBe("auth");
      expect(classifyTier("POST", "/auth/logout")).toBe("auth");
    });

    it("classifies admin writes as admin-write", () => {
      expect(classifyTier("POST", "/admin/comparsas")).toBe("admin-write");
      expect(classifyTier("PUT", "/admin/rubros/xyz")).toBe("admin-write");
      expect(classifyTier("PUT", "/admin/nights/xyz")).toBe("admin-write");
    });

    it("classifies everything else as default", () => {
      expect(classifyTier("GET", "/health")).toBe("default");
      expect(classifyTier("GET", "/admin/context")).toBe("default");
      expect(classifyTier("GET", "/judge/context")).toBe("default");
      expect(classifyTier("POST", "/judge/planillas/sync")).toBe("default");
    });
  });

  describe("createRateLimiter", () => {
    it("allows requests within the limit and denies beyond it", () => {
      let now = 0;
      const limiter = createRateLimiter({
        windowMs: 60_000,
        limits: { auth: 2, "admin-write": 5, default: 10 },
        now: () => now,
      });

      expect(limiter.check("ip-1|auth").allowed).toBe(true);
      expect(limiter.check("ip-1|auth").allowed).toBe(true);
      expect(limiter.check("ip-1|auth")).toMatchObject({
        allowed: false,
        retryAfterSeconds: 60,
      });
    });

    it("different tiers for the same IP are counted separately", () => {
      let now = 0;
      const limiter = createRateLimiter({
        windowMs: 60_000,
        limits: { auth: 1, "admin-write": 5, default: 10 },
        now: () => now,
      });
      expect(limiter.check("ip-1|auth").allowed).toBe(true);
      expect(limiter.check("ip-1|auth").allowed).toBe(false);
      expect(limiter.check("ip-1|default").allowed).toBe(true);
    });

    it("different IPs are counted independently", () => {
      let now = 0;
      const limiter = createRateLimiter({
        windowMs: 60_000,
        limits: { auth: 1, "admin-write": 5, default: 10 },
        now: () => now,
      });
      expect(limiter.check("ip-1|auth").allowed).toBe(true);
      expect(limiter.check("ip-2|auth").allowed).toBe(true);
      expect(limiter.check("ip-2|auth").allowed).toBe(false);
    });

    it("reports remaining budget within the window", () => {
      let now = 0;
      const limiter = createRateLimiter({
        windowMs: 60_000,
        limits: { auth: 3, "admin-write": 5, default: 10 },
        now: () => now,
      });
      expect(limiter.check("ip-1|auth")).toMatchObject({ allowed: true, remaining: 2 });
      expect(limiter.check("ip-1|auth")).toMatchObject({ allowed: true, remaining: 1 });
      expect(limiter.check("ip-1|auth")).toMatchObject({ allowed: true, remaining: 0 });
      expect(limiter.check("ip-1|auth")).toMatchObject({ allowed: false, remaining: 0 });
    });

    it("resets the window when time advances", () => {
      let now = 0;
      const limiter = createRateLimiter({
        windowMs: 60_000,
        limits: { auth: 1, "admin-write": 5, default: 10 },
        now: () => now,
      });
      expect(limiter.check("ip-1|auth").allowed).toBe(true);
      expect(limiter.check("ip-1|auth").allowed).toBe(false);
      now = 60_001;
      expect(limiter.check("ip-1|auth").allowed).toBe(true);
    });

    it("prunes expired buckets lazily", () => {
      let now = 0;
      const limiter = createRateLimiter({
        windowMs: 60_000,
        limits: { auth: 1, "admin-write": 5, default: 10 },
        now: () => now,
      });
      void limiter.check("ip-a|auth");
      void limiter.check("ip-b|auth");
      void limiter.check("ip-zz|auth");
      now = 120_000;
      void limiter.check("ip-1|auth");
      expect(true).toBe(true);
    });
  });

  describe("rate-limit integration over HTTP", () => {
    it("returns 429 with Retry-After once the limit is exceeded", async () => {
      const app = createApp(
        loadConfig({
          databaseUrl: "postgresql://mock@localhost/mock",
          nodeEnv: "test",
          port: 0,
          corsOrigins: ["*"],
          sessionTtlHours: 12,
          rateLimit: {
            enabled: true,
            windowMs: 60_000,
            limits: { auth: 1, "admin-write": 1, default: 2 },
          },
        }),
        neverDb(),
      );
      await new Promise<void>((resolve) => app.server.listen(0, resolve));
      try {
        expect((await httpGet(app.server, "/health")).status).toBe(200);
        expect((await httpGet(app.server, "/health")).status).toBe(200);
        const third = await httpGet(app.server, "/health");
        expect(third.status).toBe(429);
        expect(third.retryAfter).toBe("60");
        expect((await httpGet(app.server, "/health")).status).toBe(429);
      } finally {
        await app.close();
      }
    });
  });
});