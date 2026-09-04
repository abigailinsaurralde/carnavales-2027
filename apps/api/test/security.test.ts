import { describe, it, expect } from "vitest";
import { request, type Server } from "node:http";
import { createApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { DatabaseError } from "../src/errors/app-error.js";
import { handleError } from "../src/errors/handler.js";
import { isUuid } from "../src/validation/uuid.js";
import { requireUuid } from "../src/validation/index.js";
import { ValidationError } from "../src/errors/app-error.js";
import { PostgresEditionRepository } from "../src/infrastructure/repositories/postgres-edition-repository.js";
import { PostgresNightRepository } from "../src/infrastructure/repositories/postgres-night-repository.js";
import type { DbPool } from "../src/db/pool.js";

const VALID_EDITION = "11111111-1111-4111-8111-111111111111";

function fakeDb(rows: unknown[], captured: { text: string; params: unknown[] }[]): DbPool {
  return {
    async query<T>(text: string, params?: unknown[]) {
      captured.push({ text, params: params ?? [] });
      return { rows: rows as T[] };
    },
    async end() {},
  };
}

function mockDb(rows: unknown[]): DbPool {
  return {
    async query<T>() {
      return { rows: rows as T[] };
    },
    async end() {},
  };
}

async function startServer(rows: unknown[], corsOrigins = "*"): Promise<ReturnType<typeof createApp>> {
  const app = createApp(
    loadConfig({ databaseUrl: "postgresql://mock@localhost/mock", corsOrigins: [corsOrigins] }),
    mockDb(rows),
  );
  await new Promise<void>((resolve) => app.server.listen(0, resolve));
  return app;
}

function httpRequest(
  server: Server,
  path: string,
  method = "GET",
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  const port = (server.address() as import("net").AddressInfo).port;
  return new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, path, method, headers },
      (res) => {
        let data = "";
        res.on("data", (c: Buffer) => (data += c.toString()));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: data,
          });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("SQL Injection guards", () => {
  it("passes hostile IDs as parameters, never interpolating into SQL", async () => {
    const captured: { text: string; params: unknown[] }[] = [];
    const repo = new PostgresEditionRepository(fakeDb([], captured));
    const payload = "' OR '1'='1";
    await repo.findById(payload);
    expect(captured[0]?.params).toEqual([payload]);
    expect(captured[0]?.text).not.toContain(payload);
    expect(captured[0]?.text).toContain("$1");
  });

  it("passes DROP payload as parameter, not concatenated", async () => {
    const captured: { text: string; params: unknown[] }[] = [];
    const repo = new PostgresNightRepository(fakeDb([], captured));
    const payload = "'; DROP TABLE night; --";
    await repo.findByEdition(payload);
    expect(captured[0]?.params).toEqual([payload]);
    expect(captured[0]?.text).not.toContain("DROP TABLE");
  });

  it("does not concatenate payload into WHERE clause", async () => {
    const captured: { text: string; params: unknown[] }[] = [];
    const repo = new PostgresEditionRepository(fakeDb([], captured));
    const payload = "x OR 1=1 --";
    await repo.findById(payload);
    expect(captured[0]?.text).toBe("SELECT id, code, name, voting_nights, starts_on, ends_on\n       FROM carnaval_edition\n       WHERE id = $1");
  });
});

describe("Input validation", () => {
  it("rejects non-UUID strings", () => {
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("12345")).toBe(false);
    expect(isUuid("' OR '1'='1")).toBe(false);
    expect(isUuid(VALID_EDITION)).toBe(true);
  });

  it("requireUuid throws ValidationError for invalid value", () => {
    expect(() => requireUuid("nope", "editionId")).toThrow(ValidationError);
  });

  it("requireUuid returns the value for a valid UUID", () => {
    expect(requireUuid(VALID_EDITION, "editionId")).toBe(VALID_EDITION);
  });

  it("returns 400 for invalid UUID path param over HTTP", async () => {
    const app = await startServer([]);
    try {
      const res = await httpRequest(app.server, "/editions/not-a-uuid");
      expect(res.status).toBe(400);
      expect(JSON.parse(res.body)).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    } finally {
      await app.close();
    }
  });
});

describe("Error leakage", () => {
  it("DatabaseError never exposes its internal message to the client", () => {
    const error = new DatabaseError("relation \"night\" does not exist at 10.0.0.5:5432");
    for (const env of ["development", "production", "test"]) {
      const res = {} as { body: unknown; statusCode: number };
      const headers: Record<string, string> = {};
      handleError(
        {
          writeHead: (code: number) => {
            res.statusCode = code;
            return res;
          },
          end: (body: string) => {
            res.body = JSON.parse(body);
          },
          setHeader: (name: string, value: string) => {
            headers[name] = value;
          },
        } as never,
        error,
        env,
      );
      expect(JSON.stringify(res.body)).not.toContain("night");
      expect(JSON.stringify(res.body)).not.toContain("5432");
      expect(JSON.stringify(res.body)).not.toContain("10.0.0.5");
      const message = (res.body as { error: { message: string } }).error.message;
      expect(message).toBe("Internal server error");
    }
  });
});

describe("CORS", () => {
  it("refuses to start in production with wildcard origin", () => {
    const prev = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "production";
    process.env["DATABASE_URL"] = "postgresql://mock@localhost/mock";
    process.env["CORS_ORIGINS"] = "*";
    try {
      expect(() => loadConfig()).toThrow(/wildcard/i);
    } finally {
      process.env["NODE_ENV"] = prev;
      delete process.env["CORS_ORIGINS"];
    }
  });

  it("emits security headers on responses", async () => {
    const app = await startServer([]);
    try {
      const res = await httpRequest(app.server, "/health");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["x-frame-options"]).toBe("DENY");
      expect(res.headers["referrer-policy"]).toBe("no-referrer");
    } finally {
      await app.close();
    }
  });

  it("echoes allowed specific origin", async () => {
    const app = createApp(
      loadConfig({ databaseUrl: "postgresql://mock@localhost/mock", corsOrigins: ["https://app.example.com"] }),
      mockDb([]),
    );
    await new Promise<void>((resolve) => app.server.listen(0, resolve));
    try {
      const res = await httpRequest(app.server, "/health", "GET", {
        origin: "https://app.example.com",
      });
      expect(res.headers["access-control-allow-origin"]).toBe("https://app.example.com");
    } finally {
      await app.close();
    }
  });

  it("does not allow a non-listed origin", async () => {
    const app = createApp(
      loadConfig({ databaseUrl: "postgresql://mock@localhost/mock", corsOrigins: ["https://app.example.com"] }),
      mockDb([]),
    );
    await new Promise<void>((resolve) => app.server.listen(0, resolve));
    try {
      const res = await httpRequest(app.server, "/health", "GET", {
        origin: "https://evil.example.com",
      });
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});

describe("HTTP security", () => {
  it("rejects unsupported methods with 405", async () => {
    const app = await startServer([]);
    try {
      const res = await httpRequest(app.server, "/health", "POST");
      expect(res.status).toBe(405);
    } finally {
      await app.close();
    }
  });

  it("handles OPTIONS preflight with 204", async () => {
    const app = await startServer([]);
    try {
      const res = await httpRequest(app.server, "/editions/" + VALID_EDITION, "OPTIONS", {
        origin: "https://app.example.com",
        "access-control-request-method": "GET",
      });
      expect(res.status).toBe(204);
      expect(res.headers["access-control-allow-methods"]).toBe("GET, HEAD, POST, OPTIONS");
    } finally {
      await app.close();
    }
  });

  it("rejects oversized request bodies with 413", async () => {
    const app = await startServer([]);
    try {
      const res = await httpRequest(
        app.server,
        "/health",
        "POST",
        { "content-length": String(2 * 1024 * 1024) },
      );
      expect(res.status).toBe(413);
    } finally {
      await app.close();
    }
  });
});

describe("Secrets audit", () => {
  const SUSPICIOUS = [
    /(password|passwd|pwd|secret|apikey|api_key|token|bearer)\s*[:=]\s*['"][^'"]+/i,
    /postgres(ql)?:\/\/[^:]+:[^@\s]+@/,
  ];

  it("does not contain hardcoded credentials in source", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const path = await import("node:path");
    const root = path.resolve(process.cwd(), "src");

    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts")) files.push(full);
      }
    };
    walk(root);

    let found: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      for (const pattern of SUSPICIOUS) {
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (pattern.test(lines[i])) {
            found.push(`${path.relative(root, file)}:${i + 1} ${lines[i]!.trim()}`);
          }
        }
      }
    }
    expect(found).toEqual([]);
  });
});
