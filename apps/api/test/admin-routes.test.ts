import { beforeAll, describe, expect, it } from "vitest";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { DbPool } from "../src/db/pool.js";
import type { Session } from "../src/domain/entities/session.js";
import type { UserAccount } from "../src/domain/entities/user.js";
import { hashSessionToken } from "../src/infrastructure/crypto/tokens.js";
import { loadConfig } from "../src/config.js";
import { createApp } from "../src/server.js";

const ADMIN_ID = "e2e00002-0000-4000-8000-000000000002";
const JUDGE_ID = "e2e00002-0000-4000-8000-000000000001";
const EDITION_ID = "e2e00001-0000-4000-8000-000000000001";
const SPECIALTY_ID = "e2e00001-0000-4000-8000-000000000002";
const NIGHT1_ID = "e2e00001-0000-4000-8000-000000000005";
const TOKEN = "admin-test-token-1234567890";
const TOKEN_HASH = hashSessionToken(TOKEN);

function sessionOf(userId: string): Session {
  return {
    id: `session-${userId}`,
    userId,
    tokenHash: TOKEN_HASH,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
  };
}

const ADMIN: UserAccount = { id: ADMIN_ID, email: "admin.e2e@goya2027.test", displayName: "Admin E2E", role: "ADMIN" };
const JUDGE: UserAccount = { id: JUDGE_ID, email: "juez.e2e@goya2027.test", displayName: "Juez E2E", role: "JUDGE" };

function scriptedDb(users: UserAccount[], sessions: Map<string, Session>, audits: unknown[]): DbPool {
  const toUser = (u: UserAccount): Record<string, unknown> => ({
    id: u.id,
    email: u.email,
    display_name: u.displayName ?? null,
    role: u.role,
    dni: u.dni ?? null,
    password_hash: u.passwordHash ?? null,
  });
  const toSession = (s: Session): Record<string, unknown> => ({
    id: s.id,
    user_id: s.userId,
    token_hash: s.tokenHash,
    created_at: s.createdAt,
    expires_at: s.expiresAt,
    revoked_at: s.revokedAt,
  });

  const query = async <T>(text: string, params?: unknown[]) => {
    if (text.includes("FROM user_account") && text.includes("WHERE email")) {
      const email = String((params ?? [])[0]);
      const user = users.find((u) => u.email === email);
      return { rows: user === undefined ? [] : [toUser(user)] as T[] };
    }
    if (text.includes("FROM user_account") && text.includes("WHERE id")) {
      const id = String((params ?? [])[0]);
      const user = users.find((u) => u.id === id);
      return { rows: user === undefined ? [] : [toUser(user)] as T[] };
    }
    if (text.includes("FROM user_account") && text.includes("WHERE role")) {
      const role = String((params ?? [])[0]);
      const filtered = users.filter((u) => u.role === role);
      return { rows: filtered.map(toUser) as T[] };
    }
    if (text.includes("INSERT INTO session")) {
      const [userId, tokenHash, expiresAt] = params as [string, string, Date];
      sessions.set(tokenHash, {
        id: `session-${userId}`,
        userId,
        tokenHash,
        createdAt: new Date(),
        expiresAt,
        revokedAt: null,
      });
      return { rows: [] as T[] };
    }
    if (text.includes("FROM session")) {
      const tokenHash = String((params ?? [])[0]);
      const session = sessions.get(tokenHash);
      return { rows: session === undefined ? [] : [toSession(session)] as T[] };
    }
    if (text.startsWith("INSERT INTO audit_event")) {
      const row = {
        id: `audit-${audits.length + 1}`,
        event_type: String((params ?? [])[0]),
        entity_type: String((params ?? [])[1]),
        entity_id: (params ?? [])[2] ?? null,
        actor_user_id: (params ?? [])[3] ?? null,
        occurred_at: new Date(),
      };
      audits.push(row);
      return { rows: [row] as T[] };
    }
    if (text.includes("FROM carnaval_edition") && text.includes("WHERE code")) {
      return {
        rows: [
          { id: EDITION_ID, code: "2027", name: "Carnavales Goya 2027", voting_nights: 3, starts_on: null, ends_on: null },
        ] as T[],
      };
    }
    if (text.includes("FROM night") && text.includes("WHERE edition_id")) {
      return {
        rows: [
          { id: NIGHT1_ID, edition_id: EDITION_ID, number: 1, date: "2027-01-15", status: "ABIERTA", starts_at: null, ends_at: null },
        ] as T[],
      };
    }
    if (text.includes("FROM specialty") && text.includes("ORDER BY")) {
      return { rows: [{ id: SPECIALTY_ID, code: "BAILE", order: 1 }] as T[] };
    }
    if (text.startsWith("SELECT") && text.includes("count(*)")) {
      return {
        rows: [
          { comparsas: "1", rubros: "1", items: "1", candidates: "1", assignments: "0" },
        ] as T[],
      };
    }
    throw new Error(`Unexpected query in admin routes test: ${text}`);
  };
  return {
    query,
    withTransaction: (fn) => fn({ query }),
    async end() {},
  };
}

function httpJson(
  server: Server,
  path: string,
  opts: { method?: string; token?: string; body?: unknown } = {},
): Promise<{ status: number; body: unknown }> {
  const port = (server.address() as AddressInfo).port;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.token !== undefined) headers["authorization"] = `Bearer ${opts.token}`;
  return new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, path, method: opts.method ?? (opts.body === undefined ? "GET" : "POST"), headers },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk.toString()));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: data === "" ? undefined : (JSON.parse(data) as unknown) }),
        );
      },
    );
    req.on("error", reject);
    if (opts.body !== undefined) req.write(JSON.stringify(opts.body));
    req.end();
  });
}

describe("admin routes", () => {
  const sessions = new Map<string, Session>();
  const audits: unknown[] = [];

  beforeAll(async () => {
    sessions.set(TOKEN_HASH, sessionOf(ADMIN_ID));
  });

  it("requires a session token (401)", async () => {
    const app = createApp(
      loadConfig({ databaseUrl: "postgresql://mock@localhost/mock" }),
      scriptedDb([ADMIN, JUDGE], sessions, audits),
    );
    await new Promise<void>((resolve) => app.server.listen(0, resolve));
    try {
      const res = await httpJson(app.server, "/admin/context");
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ error: { code: "UNAUTHORIZED" } });
    } finally {
      await app.close();
    }
  });

  it("requires the ADMIN role (403 for a judge)", async () => {
    const judgeSessions = new Map<string, Session>();
    judgeSessions.set(TOKEN_HASH, sessionOf(JUDGE_ID));
    const app = createApp(
      loadConfig({ databaseUrl: "postgresql://mock@localhost/mock" }),
      scriptedDb([ADMIN, JUDGE], judgeSessions, audits),
    );
    await new Promise<void>((resolve) => app.server.listen(0, resolve));
    try {
      const res = await httpJson(app.server, "/admin/context", { token: TOKEN });
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ error: { code: "FORBIDDEN" } });
    } finally {
      await app.close();
    }
  });

  it("returns the admin context for an ADMIN session", async () => {
    const app = createApp(
      loadConfig({ databaseUrl: "postgresql://mock@localhost/mock" }),
      scriptedDb([ADMIN, JUDGE], sessions, audits),
    );
    await new Promise<void>((resolve) => app.server.listen(0, resolve));
    try {
      const res = await httpJson(app.server, "/admin/context", { token: TOKEN });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        edition: { code: "2027" },
        specialties: [{ id: SPECIALTY_ID, code: "BAILE" }],
        counts: { comparsas: 1 },
      });
    } finally {
      await app.close();
    }
  });

  it("validates the request body before persisting (400)", async () => {
    const app = createApp(
      loadConfig({ databaseUrl: "postgresql://mock@localhost/mock" }),
      scriptedDb([ADMIN, JUDGE], sessions, audits),
    );
    await new Promise<void>((resolve) => app.server.listen(0, resolve));
    try {
      const res = await httpJson(app.server, "/admin/comparsas", {
        method: "POST",
        token: TOKEN,
        body: { code: "", name: "" },
      });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    } finally {
      await app.close();
    }
  });

  it("rejects an invalid rubro type (400)", async () => {
    const app = createApp(
      loadConfig({ databaseUrl: "postgresql://mock@localhost/mock" }),
      scriptedDb([ADMIN, JUDGE], sessions, audits),
    );
    await new Promise<void>((resolve) => app.server.listen(0, resolve));
    try {
      const res = await httpJson(app.server, "/admin/rubros", {
        method: "POST",
        token: TOKEN,
        body: { specialty: "BAILE", name: "Menor", type: "INVALIDO" },
      });
      expect(res.status).toBe(400);
    } finally {
      await app.close();
    }
  });
});