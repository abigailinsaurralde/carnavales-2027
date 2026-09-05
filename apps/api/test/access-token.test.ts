import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type {
  AuthenticatedUser,
  AuthSession,
  AuditEvent,
  IssueAccessTokenResponse,
} from "@votaciones2027/shared-types";
import {
  ACCESS_TOKEN_TTL_MS,
  IssueAccessToken,
} from "../src/application/use-cases/issue-access-token.js";
import { LoginWithAccessToken } from "../src/application/use-cases/login-with-access-token.js";
import { loadConfig } from "../src/config.js";
import type { DbPool } from "../src/db/pool.js";
import type { AccessToken } from "../src/domain/entities/access-token.js";
import type { Session } from "../src/domain/entities/session.js";
import type { UserAccount } from "../src/domain/entities/user.js";
import type {
  AccessTokenRepository,
  CreateAccessTokenInput,
} from "../src/domain/repositories/access-token-repository.js";
import type {
  AuditRepository,
  CreateAuditEventInput,
} from "../src/domain/repositories/audit-repository.js";
import type {
  CreateSessionInput,
  SessionRepository,
} from "../src/domain/repositories/session-repository.js";
import type { UserRepository } from "../src/domain/repositories/user-repository.js";
import { InvalidCredentialsError } from "../src/errors/app-error.js";
import {
  generateAccessToken,
  hashAccessToken,
} from "../src/infrastructure/crypto/tokens.js";
import { createApp } from "../src/server.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const JUDGE_NO_DNI_ID = "22222222-2222-4222-8222-222222222222";
const WRITER_ID = "33333333-3333-4333-8333-333333333333";
const SEED_EMAIL = "juez.baile.1@goya2027.test";
const SEED_DNI = "30123456";

// ---------------------------------------------------------------------------
// Fakes de repositorios (in-memory)
// ---------------------------------------------------------------------------

class FakeUserRepository implements UserRepository {
  private readonly byEmail = new Map<string, UserAccount>();
  private readonly byId = new Map<string, UserAccount>();

  constructor(users: UserAccount[]) {
    for (const user of users) {
      this.byEmail.set(user.email, user);
      this.byId.set(user.id, user);
    }
  }

  async findByEmail(email: string): Promise<UserAccount | null> {
    return this.byEmail.get(email) ?? null;
  }

  async findById(id: string): Promise<UserAccount | null> {
    return this.byId.get(id) ?? null;
  }
}

class FakeAccessTokenRepository implements AccessTokenRepository {
  readonly tokens = new Map<string, AccessToken>();

  async create(input: CreateAccessTokenInput): Promise<void> {
    this.tokens.set(input.tokenHash, {
      id: input.id,
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      usedAt: null,
      revokedAt: null,
    });
  }

  async findByTokenHash(tokenHash: string): Promise<AccessToken | null> {
    return this.tokens.get(tokenHash) ?? null;
  }

  async markUsed(id: string): Promise<void> {
    const token = [...this.tokens.values()].find((t) => t.id === id);
    if (token !== undefined) token.usedAt = new Date();
  }
}

class FakeSessionRepository implements SessionRepository {
  readonly sessions = new Map<string, Session>();
  private seq = 0;

  async create(input: CreateSessionInput): Promise<void> {
    this.seq += 1;
    this.sessions.set(input.tokenHash, {
      id: `session-${this.seq}`,
      userId: input.userId,
      tokenHash: input.tokenHash,
      createdAt: new Date(),
      expiresAt: input.expiresAt,
      revokedAt: null,
    });
  }

  async findByTokenHash(tokenHash: string): Promise<Session | null> {
    return this.sessions.get(tokenHash) ?? null;
  }

  async revoke(id: string): Promise<void> {
    const session = [...this.sessions.values()].find((s) => s.id === id);
    if (session !== undefined) session.revokedAt = new Date();
  }
}

class FakeAuditRepository implements AuditRepository {
  readonly events: CreateAuditEventInput[] = [];

  async create(input: CreateAuditEventInput): Promise<AuditEvent> {
    this.events.push(input);
    return {
      id: `audit-${this.events.length}`,
      eventType: input.eventType,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      ...(input.actorUserId === undefined ? {} : { actorUserId: input.actorUserId }),
      occurredAt: new Date().toISOString(),
      payload: input.payload,
    };
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let judge: UserAccount;
let judgeNoDni: UserAccount;
let writer: UserAccount;

beforeAll(() => {
  judge = {
    id: USER_ID,
    email: SEED_EMAIL,
    displayName: "Juez de prueba BAILE",
    role: "JUDGE",
    dni: SEED_DNI,
    // Sin passwordHash: el juez NO usa contraseña (SVC2-47 fuera de alcance),
    // accede con correo + DNI + token temporal de un solo uso.
  };
  judgeNoDni = {
    id: JUDGE_NO_DNI_ID,
    email: "juez.sin.dni@goya2027.test",
    displayName: "Juez sin DNI cargado",
    role: "JUDGE",
  };
  writer = {
    id: WRITER_ID,
    email: "escribano.1@goya2027.test",
    displayName: "Escribano de prueba",
    role: "ESCRIBANO_VEEDOR",
    dni: "25123456",
  };
});

let users: FakeUserRepository;
let accessTokensRepo: FakeAccessTokenRepository;
let sessionsRepo: FakeSessionRepository;
let audits: FakeAuditRepository;

beforeEach(() => {
  users = new FakeUserRepository([judge, judgeNoDni, writer]);
  accessTokensRepo = new FakeAccessTokenRepository();
  sessionsRepo = new FakeSessionRepository();
  audits = new FakeAuditRepository();
});

// ---------------------------------------------------------------------------
// IssueAccessToken (use-case)
// ---------------------------------------------------------------------------

describe("IssueAccessToken use-case", () => {
  it("emite un token temporal, persiste SOLO el hash y audita sin token plano", async () => {
    const issue = new IssueAccessToken(users, accessTokensRepo, audits);
    const result = await issue.execute({ email: SEED_EMAIL, dni: SEED_DNI });

    expect(result.token).toMatch(/^[0-9a-f]{64}$/);
    const ttlMs = new Date(result.expiresAt).getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(ACCESS_TOKEN_TTL_MS - 2000);
    expect(ttlMs).toBeLessThanOrEqual(ACCESS_TOKEN_TTL_MS);

    // Solo el hash se persiste; el token plano nunca llega al repo.
    expect(accessTokensRepo.tokens.size).toBe(1);
    const stored = accessTokensRepo.tokens.get(hashAccessToken(result.token));
    expect(stored).toBeDefined();
    expect(stored?.tokenHash).toBe(hashAccessToken(result.token));
    expect(JSON.stringify([...accessTokensRepo.tokens.values()])).not.toContain(
      result.token,
    );

    // Auditoría de emisión: expiración sí, token plano NO.
    const event = audits.events[0];
    expect(event?.eventType).toBe("ACCESS_TOKEN_ISSUED");
    expect(event?.entityType).toBe("USER");
    expect(event?.actorUserId).toBe(USER_ID);
    expect(event?.payload.expiresAt).toBe(result.expiresAt);
    expect(event?.payload).not.toHaveProperty("token");
  });

  it("rechaza DNI incorrecto con InvalidCredentialsError", async () => {
    const issue = new IssueAccessToken(users, accessTokensRepo, audits);
    await expect(
      issue.execute({ email: SEED_EMAIL, dni: "99999999" }),
    ).rejects.toThrow(InvalidCredentialsError);
    expect(accessTokensRepo.tokens.size).toBe(0);
    expect(audits.events).toHaveLength(0);
  });

  it("rechaza email desconocido con el mismo error (anti-enumeración)", async () => {
    const issue = new IssueAccessToken(users, accessTokensRepo, audits);
    await expect(
      issue.execute({ email: "nobody@goya2027.test", dni: SEED_DNI }),
    ).rejects.toThrow(InvalidCredentialsError);
  });

  it("rechaza cuenta de juez sin DNI cargado", async () => {
    const issue = new IssueAccessToken(users, accessTokensRepo, audits);
    await expect(
      issue.execute({ email: judgeNoDni.email, dni: SEED_DNI }),
    ).rejects.toThrow(InvalidCredentialsError);
  });

  it("rechaza roles no-juez (el access token es solo para JUDGE)", async () => {
    const issue = new IssueAccessToken(users, accessTokensRepo, audits);
    await expect(
      issue.execute({ email: writer.email, dni: writer.dni }),
    ).rejects.toThrow(InvalidCredentialsError);
    expect(accessTokensRepo.tokens.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// LoginWithAccessToken (use-case)
// ---------------------------------------------------------------------------

describe("LoginWithAccessToken use-case", () => {
  it("flujo completo: emisión → canje → sesión server-side estándar", async () => {
    const issue = new IssueAccessToken(users, accessTokensRepo, audits);
    const issued = await issue.execute({ email: SEED_EMAIL, dni: SEED_DNI });

    const login = new LoginWithAccessToken(
      users,
      accessTokensRepo,
      sessionsRepo,
      audits,
      12,
    );
    const result = await login.execute({
      email: SEED_EMAIL,
      dni: SEED_DNI,
      token: issued.token,
    });

    // La sesión es un AuthSession idéntico al de /auth/login.
    expect(result.token).not.toBe(issued.token);
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(result.user.email).toBe(SEED_EMAIL);
    expect(result.user.role).toBe("JUDGE");
    expect(result.user.dni).toBe(SEED_DNI);
    expect(result.user).not.toHaveProperty("passwordHash");
    expect(sessionsRepo.sessions.size).toBe(1);

    // El token plano del access token NO queda disponible en la respuesta.
    expect(JSON.stringify(result)).not.toContain(issued.token);

    // Access token consumido (used_at) y solo su hash persistido.
    const stored = accessTokensRepo.tokens.get(hashAccessToken(issued.token));
    expect(stored?.usedAt).not.toBeNull();
    expect(stored?.tokenHash).toBe(hashAccessToken(issued.token));

    // Inicio de sesión auditado (LOGIN), como exige §19 del Reglamento.
    const loginEvent = audits.events.find((e) => e.eventType === "LOGIN");
    expect(loginEvent).toBeDefined();
    expect(loginEvent?.actorUserId).toBe(USER_ID);
  });

  it("rechaza reusar un token ya usado (un solo uso)", async () => {
    const issue = new IssueAccessToken(users, accessTokensRepo, audits);
    const issued = await issue.execute({ email: SEED_EMAIL, dni: SEED_DNI });
    const login = new LoginWithAccessToken(
      users,
      accessTokensRepo,
      sessionsRepo,
      audits,
      12,
    );

    const first = await login.execute({
      email: SEED_EMAIL,
      dni: SEED_DNI,
      token: issued.token,
    });
    expect(first.token).toBeTypeOf("string");

    await expect(
      login.execute({ email: SEED_EMAIL, dni: SEED_DNI, token: issued.token }),
    ).rejects.toThrow(InvalidCredentialsError);
    // Solo la primera sesión existe; el replay no crea otra.
    expect(sessionsRepo.sessions.size).toBe(1);
  });

  it("rechaza token expirado", async () => {
    const token = generateAccessToken();
    await accessTokensRepo.create({
      id: "at-expired",
      userId: USER_ID,
      tokenHash: hashAccessToken(token),
      expiresAt: new Date(Date.now() - 1000),
    });
    const login = new LoginWithAccessToken(
      users,
      accessTokensRepo,
      sessionsRepo,
      audits,
      12,
    );
    await expect(
      login.execute({ email: SEED_EMAIL, dni: SEED_DNI, token }),
    ).rejects.toThrow(InvalidCredentialsError);
    expect(sessionsRepo.sessions.size).toBe(0);
  });

  it("rechaza token revocado", async () => {
    const token = generateAccessToken();
    const tokenHash = hashAccessToken(token);
    await accessTokensRepo.create({
      id: "at-revoked",
      userId: USER_ID,
      tokenHash,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    const stored = accessTokensRepo.tokens.get(tokenHash);
    if (stored !== undefined) stored.revokedAt = new Date();

    const login = new LoginWithAccessToken(
      users,
      accessTokensRepo,
      sessionsRepo,
      audits,
      12,
    );
    await expect(
      login.execute({ email: SEED_EMAIL, dni: SEED_DNI, token }),
    ).rejects.toThrow(InvalidCredentialsError);
    expect(sessionsRepo.sessions.size).toBe(0);
  });

  it("rechaza token desconocido", async () => {
    const login = new LoginWithAccessToken(
      users,
      accessTokensRepo,
      sessionsRepo,
      audits,
      12,
    );
    await expect(
      login.execute({ email: SEED_EMAIL, dni: SEED_DNI, token: generateAccessToken() }),
    ).rejects.toThrow(InvalidCredentialsError);
    expect(sessionsRepo.sessions.size).toBe(0);
  });

  it("rechaza DNI incorrecto y NO consume el token", async () => {
    const issue = new IssueAccessToken(users, accessTokensRepo, audits);
    const issued = await issue.execute({ email: SEED_EMAIL, dni: SEED_DNI });
    const login = new LoginWithAccessToken(
      users,
      accessTokensRepo,
      sessionsRepo,
      audits,
      12,
    );

    await expect(
      login.execute({ email: SEED_EMAIL, dni: "99999999", token: issued.token }),
    ).rejects.toThrow(InvalidCredentialsError);

    // El token sigue vigente: un canje posterior correcto funciona.
    const stored = accessTokensRepo.tokens.get(hashAccessToken(issued.token));
    expect(stored?.usedAt).toBeNull();
    const result = await login.execute({
      email: SEED_EMAIL,
      dni: SEED_DNI,
      token: issued.token,
    });
    expect(result.token).toBeTypeOf("string");
    expect(sessionsRepo.sessions.size).toBe(1);
  });

  it("rechaza token emitido para otro usuario", async () => {
    const issue = new IssueAccessToken(users, accessTokensRepo, audits);
    const issued = await issue.execute({ email: SEED_EMAIL, dni: SEED_DNI });
    const login = new LoginWithAccessToken(
      users,
      accessTokensRepo,
      sessionsRepo,
      audits,
      12,
    );
    // Mismo token, pero el usuario cambia sus credenciales de cuenta: el
    // access token está ligado al userId que lo solicitó.
    await expect(
      login.execute({ email: judgeNoDni.email, dni: SEED_DNI, token: issued.token }),
    ).rejects.toThrow(InvalidCredentialsError);
    expect(sessionsRepo.sessions.size).toBe(0);
  });

  it("rechaza email desconocido con el mismo error genérico", async () => {
    const login = new LoginWithAccessToken(
      users,
      accessTokensRepo,
      sessionsRepo,
      audits,
      12,
    );
    await expect(
      login.execute({
        email: "nobody@goya2027.test",
        dni: SEED_DNI,
        token: generateAccessToken(),
      }),
    ).rejects.toThrow(InvalidCredentialsError);
  });

  it("rechaza cuentas no-juez aunque tengan DNI", async () => {
    const login = new LoginWithAccessToken(
      users,
      accessTokensRepo,
      sessionsRepo,
      audits,
      12,
    );
    await expect(
      login.execute({ email: writer.email, dni: writer.dni ?? "", token: generateAccessToken() }),
    ).rejects.toThrow(InvalidCredentialsError);
    expect(sessionsRepo.sessions.size).toBe(0);
  });

  it("los errores del canje no crean sesión ni marcan uso indebido", async () => {
    const login = new LoginWithAccessToken(
      users,
      accessTokensRepo,
      sessionsRepo,
      audits,
      12,
    );
    await expect(
      login.execute({ email: SEED_EMAIL, dni: SEED_DNI, token: generateAccessToken() }),
    ).rejects.toThrow(InvalidCredentialsError);
    expect(sessionsRepo.sessions.size).toBe(0);
    expect([...accessTokensRepo.tokens.values()]).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// HTTP (contratos de API)
// ---------------------------------------------------------------------------

interface DbAccessTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date | string;
  used_at: Date | string | null;
  revoked_at: Date | string | null;
}

function toUserRow(user: UserAccount): Record<string, unknown> {
  return {
    id: user.id,
    email: user.email,
    display_name: user.displayName ?? null,
    role: user.role,
    dni: user.dni ?? null,
    password_hash: user.passwordHash ?? null,
  };
}

function toSessionRow(session: Session): Record<string, unknown> {
  return {
    id: session.id,
    user_id: session.userId,
    token_hash: session.tokenHash,
    created_at: session.createdAt,
    expires_at: session.expiresAt,
    revoked_at: session.revokedAt,
  };
}

// Pool scripted: replica las queries SQL REALES de los repos Postgres
// (incluida la migración 004 para access_token), igual que auth.test.ts.
function scriptedDb(
  users: UserAccount[],
  sessions: Map<string, Session>,
  accessTokens: Map<string, DbAccessTokenRow>,
  auditEvents: unknown[],
): DbPool {
  const query = async <T>(text: string, params?: unknown[]) => {
    if (text.includes("FROM user_account") && text.includes("WHERE email")) {
      const email = String((params ?? [])[0]);
      const user = users.find((u) => u.email === email);
      return { rows: user === undefined ? [] : ([toUserRow(user)] as T[]) };
    }
    if (text.includes("FROM user_account") && text.includes("WHERE id")) {
      const id = String((params ?? [])[0]);
      const user = users.find((u) => u.id === id);
      return { rows: user === undefined ? [] : ([toUserRow(user)] as T[]) };
    }
    if (text.startsWith("INSERT INTO access_token")) {
      const [id, userId, tokenHash, expiresAt] = params as [
        string,
        string,
        string,
        Date,
      ];
      accessTokens.set(tokenHash, {
        id,
        user_id: userId,
        token_hash: tokenHash,
        expires_at: expiresAt,
        used_at: null,
        revoked_at: null,
      });
      return { rows: [] as T[] };
    }
    if (text.includes("FROM access_token")) {
      const tokenHash = String((params ?? [])[0]);
      const row = accessTokens.get(tokenHash);
      return { rows: row === undefined ? [] : ([row] as T[]) };
    }
    if (text.startsWith("UPDATE access_token")) {
      const id = String((params ?? [])[0]);
      for (const row of accessTokens.values()) {
        if (row.id === id) row.used_at = new Date();
      }
      return { rows: [] as T[] };
    }
    if (text.startsWith("INSERT INTO session")) {
      const [userId, tokenHash, expiresAt] = params as [string, string, Date];
      sessions.set(tokenHash, {
        id: `session-http-${sessions.size + 1}`,
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
      return { rows: session === undefined ? [] : ([toSessionRow(session)] as T[]) };
    }
    if (text.startsWith("INSERT INTO audit_event")) {
      const row = {
        id: `audit-${auditEvents.length + 1}`,
        event_type: String((params ?? [])[0]),
        entity_type: String((params ?? [])[1]),
        entity_id: (params ?? [])[2] ?? null,
        actor_user_id: (params ?? [])[3] ?? null,
        occurred_at: new Date(),
      };
      auditEvents.push(row);
      return { rows: [row] as T[] };
    }
    throw new Error(`Unexpected query in access-token test: ${text}`);
  };
  return {
    query,
    withTransaction: (fn) => fn({ query }),
    async end() {},
  };
}

let serverApp: ReturnType<typeof createApp> | undefined;
const sessionsMap = new Map<string, Session>();
const accessTokensMap = new Map<string, DbAccessTokenRow>();
const auditEvents: unknown[] = [];

beforeEach(() => {
  sessionsMap.clear();
  accessTokensMap.clear();
  auditEvents.length = 0;
});

async function startHttpApp(usersArgs?: UserAccount[]): Promise<ReturnType<typeof createApp>> {
  const app = createApp(
    loadConfig({ databaseUrl: "postgresql://mock@localhost/mock" }),
    scriptedDb(usersArgs ?? [judge, judgeNoDni, writer], sessionsMap, accessTokensMap, auditEvents),
  );
  serverApp = app;
  await new Promise<void>((resolve) => app.server.listen(0, resolve));
  return app;
}

function httpRequest(
  server: Server,
  path: string,
  method = "GET",
  headers: Record<string, string> = {},
  body?: string,
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  const port = (server.address() as AddressInfo).port;
  return new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, path, method, headers },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk.toString()));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data }),
        );
      },
    );
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function jsonRequest(
  server: Server,
  path: string,
  headers: Record<string, string> = {},
  body?: unknown,
  method?: string,
): Promise<{ status: number; body: unknown }> {
  const resolvedMethod = method ?? (body === undefined ? "GET" : "POST");
  return httpRequest(
    server,
    path,
    resolvedMethod,
    { "content-type": "application/json", ...headers },
    body === undefined ? undefined : JSON.stringify(body),
  ).then((res) => ({
    status: res.status,
    body: res.body === "" ? undefined : (JSON.parse(res.body) as unknown),
  }));
}

describe("POST /auth/access-token (HTTP)", () => {
  it("devuelve 200 con token plano y expiración; NO devuelve el usuario", async () => {
    const app = await startHttpApp();
    try {
      const res = await jsonRequest(app.server, "/auth/access-token", {}, {
        email: SEED_EMAIL,
        dni: SEED_DNI,
      });
      expect(res.status).toBe(200);
      const body = res.body as IssueAccessTokenResponse;
      expect(body.token).toMatch(/^[0-9a-f]{64}$/);
      expect(typeof body.expiresAt).toBe("string");
      expect(body).not.toHaveProperty("user");
    } finally {
      await app.close();
    }
  });

  it("devuelve 400 para DNI con formato inválido (puntos, letras, longitud)", async () => {
    const app = await startHttpApp();
    try {
      const withDots = await jsonRequest(app.server, "/auth/access-token", {}, {
        email: SEED_EMAIL,
        dni: "30.123.456",
      });
      const tooShort = await jsonRequest(app.server, "/auth/access-token", {}, {
        email: SEED_EMAIL,
        dni: "12345",
      });
      const tooLong = await jsonRequest(app.server, "/auth/access-token", {}, {
        email: SEED_EMAIL,
        dni: "123456789",
      });
      const letters = await jsonRequest(app.server, "/auth/access-token", {}, {
        email: SEED_EMAIL,
        dni: "abcdefgh",
      });
      const missing = await jsonRequest(app.server, "/auth/access-token", {}, {
        email: SEED_EMAIL,
      });
      for (const res of [withDots, tooShort, tooLong, letters, missing]) {
        expect(res.status).toBe(400);
        expect((res.body as { error: { code: string } }).error.code).toBe(
          "VALIDATION_ERROR",
        );
      }
      expect(accessTokensMap.size).toBe(0);
    } finally {
      await app.close();
    }
  });

  it("devuelve 400 para email inválido", async () => {
    const app = await startHttpApp();
    try {
      const res = await jsonRequest(app.server, "/auth/access-token", {}, {
        email: "not-an-email",
        dni: SEED_DNI,
      });
      expect(res.status).toBe(400);
    } finally {
      await app.close();
    }
  });

  it("devuelve 401 idéntico para email desconocido y DNI incorrecto", async () => {
    const app = await startHttpApp();
    try {
      const unknown = await jsonRequest(app.server, "/auth/access-token", {}, {
        email: "nobody@goya2027.test",
        dni: SEED_DNI,
      });
      const wrongDni = await jsonRequest(app.server, "/auth/access-token", {}, {
        email: SEED_EMAIL,
        dni: "99999999",
      });
      expect(unknown.status).toBe(401);
      expect(wrongDni.status).toBe(401);
      expect(JSON.stringify(unknown.body)).toBe(JSON.stringify(wrongDni.body));
      expect(unknown.body).toMatchObject({
        error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password" },
      });
    } finally {
      await app.close();
    }
  });

  it("audita ACCESS_TOKEN_ISSUED sin token plano en la emisión HTTP", async () => {
    const app = await startHttpApp();
    try {
      const res = await jsonRequest(app.server, "/auth/access-token", {}, {
        email: SEED_EMAIL,
        dni: SEED_DNI,
      });
      expect(res.status).toBe(200);
      expect(auditEvents).toHaveLength(1);
      const event = auditEvents[0] as { event_type: string; actor_user_id: string; payload: unknown };
      expect(event.event_type).toBe("ACCESS_TOKEN_ISSUED");
      expect(event.actor_user_id).toBe(USER_ID);
      expect(JSON.stringify(event.payload ?? {})).not.toContain(
        (res.body as IssueAccessTokenResponse).token,
      );
    } finally {
      await app.close();
    }
  });
});

describe("POST /auth/access-token/login (HTTP)", () => {
  async function issueToken(app: ReturnType<typeof createApp>): Promise<string> {
    const res = await jsonRequest(app.server, "/auth/access-token", {}, {
      email: SEED_EMAIL,
      dni: SEED_DNI,
    });
    expect(res.status).toBe(200);
    return (res.body as IssueAccessTokenResponse).token;
  }

  it("flujo completo: emisión → canje → sesión válida en /auth/me", async () => {
    const app = await startHttpApp();
    try {
      const plainToken = await issueToken(app);

      const login = await jsonRequest(app.server, "/auth/access-token/login", {}, {
        email: SEED_EMAIL,
        dni: SEED_DNI,
        token: plainToken,
      });
      expect(login.status).toBe(200);
      const session = login.body as AuthSession;
      expect(session.token).toBeTypeOf("string");
      expect(session.token).not.toBe(plainToken);
      // El access token plano NO queda disponible en la respuesta de login.
      expect(JSON.stringify(session)).not.toContain(plainToken);
      expect(session.user.dni).toBe(SEED_DNI);
      expect(session.user).not.toHaveProperty("passwordHash");

      // La sesión es la MISMA mecánica server-side: /auth/me la valida.
      const me = await jsonRequest(app.server, "/auth/me", {
        authorization: `Bearer ${session.token}`,
      });
      expect(me.status).toBe(200);
      expect((me.body as AuthenticatedUser).dni).toBe(SEED_DNI);

      // Reuso del mismo access token → 401 (un solo uso).
      const replay = await jsonRequest(app.server, "/auth/access-token/login", {}, {
        email: SEED_EMAIL,
        dni: SEED_DNI,
        token: plainToken,
      });
      expect(replay.status).toBe(401);
      expect(replay.body).toMatchObject({ error: { code: "INVALID_CREDENTIALS" } });
    } finally {
      await app.close();
    }
  });

  it("devuelve 401 para token desconocido", async () => {
    const app = await startHttpApp();
    try {
      const res = await jsonRequest(app.server, "/auth/access-token/login", {}, {
        email: SEED_EMAIL,
        dni: SEED_DNI,
        token: "0".repeat(64),
      });
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ error: { code: "INVALID_CREDENTIALS" } });
    } finally {
      await app.close();
    }
  });

  it("devuelve 401 para DNI incorrecto en el canje", async () => {
    const app = await startHttpApp();
    try {
      const plainToken = await issueToken(app);
      const res = await jsonRequest(app.server, "/auth/access-token/login", {}, {
        email: SEED_EMAIL,
        dni: "99999999",
        token: plainToken,
      });
      expect(res.status).toBe(401);
      // El token NO se consume con un canje fallido.
      const stored = accessTokensMap.get(hashAccessToken(plainToken));
      expect(stored?.used_at).toBeNull();
    } finally {
      await app.close();
    }
  });

  it("devuelve 400 para body inválido (token faltante o vacío, DNI inválido)", async () => {
    const app = await startHttpApp();
    try {
      const missingToken = await jsonRequest(app.server, "/auth/access-token/login", {}, {
        email: SEED_EMAIL,
        dni: SEED_DNI,
      });
      expect(missingToken.status).toBe(400);

      const emptyToken = await jsonRequest(app.server, "/auth/access-token/login", {}, {
        email: SEED_EMAIL,
        dni: SEED_DNI,
        token: "",
      });
      expect(emptyToken.status).toBe(400);

      const badDni = await jsonRequest(app.server, "/auth/access-token/login", {}, {
        email: SEED_EMAIL,
        dni: "30123456-7",
        token: "0".repeat(64),
      });
      expect(badDni.status).toBe(400);
      expect((badDni.body as { error: { code: string } }).error.code).toBe(
        "VALIDATION_ERROR",
      );
    } finally {
      await app.close();
    }
  });

  it("devuelve 405 para GET en rutas de access token", async () => {
    const app = await startHttpApp();
    try {
      const issue = await httpRequest(app.server, "/auth/access-token", "GET");
      expect(issue.status).toBe(405);
      expect(issue.headers["allow"]).toBe("POST");

      const login = await httpRequest(app.server, "/auth/access-token/login", "GET");
      expect(login.status).toBe(405);
    } finally {
      await app.close();
    }
  });
});