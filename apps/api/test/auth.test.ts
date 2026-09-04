import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Login } from "../src/application/use-cases/login.js";
import { Logout } from "../src/application/use-cases/logout.js";
import { GetSessionUser } from "../src/application/use-cases/get-session-user.js";
import { loadConfig } from "../src/config.js";
import type { DbPool } from "../src/db/pool.js";
import type { Session } from "../src/domain/entities/session.js";
import type { UserAccount } from "../src/domain/entities/user.js";
import type { SessionRepository, CreateSessionInput } from "../src/domain/repositories/session-repository.js";
import type { UserRepository } from "../src/domain/repositories/user-repository.js";
import { InvalidCredentialsError, UnauthorizedError } from "../src/errors/app-error.js";
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  verifyPassword,
} from "../src/infrastructure/crypto/passwords.js";
import {
  generateSessionToken,
  hashSessionToken,
} from "../src/infrastructure/crypto/tokens.js";
import { createApp } from "../src/server.js";
import type { AuthSession } from "@votaciones2027/shared-types";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PASSWORD = "Strong-Pass-123";
const SEED_EMAIL = "juez.baile.1@goya2027.test";

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

// ---------------------------------------------------------------------------
// DbPool scripted: replica las queries SQL REALES de los repos Postgres
// ---------------------------------------------------------------------------

function scriptedDb(users: UserAccount[], sessions: Map<string, Session>): DbPool {
  return {
    async query<T>(text: string, params?: unknown[]) {
      if (text.includes("FROM user_account") && text.includes("WHERE email")) {
        const email = String((params ?? [])[0]);
        const user = users.find((u) => u.email === email);
        return { rows: user === undefined ? [] : [toUserRow(user)] as T[] };
      }
      if (text.includes("FROM user_account") && text.includes("WHERE id")) {
        const id = String((params ?? [])[0]);
        const user = users.find((u) => u.id === id);
        return { rows: user === undefined ? [] : [toUserRow(user)] as T[] };
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
        return { rows: session === undefined ? [] : [toSessionRow(session)] as T[] };
      }
      if (text.startsWith("UPDATE session")) {
        const id = String((params ?? [])[0]);
        for (const session of sessions.values()) {
          if (session.id === id) session.revokedAt = new Date();
        }
        return { rows: [] as T[] };
      }
      throw new Error(`Unexpected query in auth test: ${text}`);
    },
    async end() {},
  };
}

function toUserRow(user: UserAccount): Record<string, unknown> {
  return {
    id: user.id,
    email: user.email,
    display_name: user.displayName ?? null,
    role: user.role,
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

// ---------------------------------------------------------------------------
// Helpers HTTP
// ---------------------------------------------------------------------------

async function startApp(users: UserAccount[], sessions: Map<string, Session>) {
  const app = createApp(
    loadConfig({ databaseUrl: "postgresql://mock@localhost/mock" }),
    scriptedDb(users, sessions),
  );
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

// ---------------------------------------------------------------------------
// Datos fixture
// ---------------------------------------------------------------------------

let judge: UserAccount;

beforeAll(async () => {
  const hash = await hashPassword(PASSWORD);
  judge = {
    id: USER_ID,
    email: SEED_EMAIL,
    displayName: "Juez de prueba BAILE",
    role: "JUDGE",
    passwordHash: hash,
  };
});

let users: FakeUserRepository;
let sessionsRepo: FakeSessionRepository;

beforeEach(() => {
  users = new FakeUserRepository([judge]);
  sessionsRepo = new FakeSessionRepository();
});

// ---------------------------------------------------------------------------
// crypto
// ---------------------------------------------------------------------------

describe("password crypto", () => {
  it("hashPassword produce el formato scrypt$salt$hash", async () => {
    const hash = await hashPassword("Some-Password-1");
    expect(hash.split("$")).toHaveLength(3);
    expect(hash.startsWith("scrypt$")).toBe(true);
  });

  it("verifyPassword acepta la contraseña correcta y rechaza la incorrecta", async () => {
    const hash = await hashPassword("Some-Password-1");
    expect(await verifyPassword("Some-Password-1", hash)).toBe(true);
    expect(await verifyPassword("Wrong-Password-9", hash)).toBe(false);
  });

  it("verifyPassword contra el hash dummy siempre falla", async () => {
    expect(await verifyPassword("What-Ever-123", DUMMY_PASSWORD_HASH)).toBe(false);
  });

  it("el hash dummy tiene formato scrypt de 3 partes (igualación de timing real)", () => {
    // Si el formato fuera inválido (< 3 partes), verifyPassword haría
    // early-return SIN ejecutar scrypt, rompiendo la igualación de latencia
    // entre "email inexistente" y "contraseña inválida" (anti-enumeración).
    const parts = DUMMY_PASSWORD_HASH.split("$");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe("scrypt");
    expect(parts[1]).toHaveLength(2 * 16);
    expect(parts[2]).toHaveLength(2 * 64);
  });
});

// ---------------------------------------------------------------------------
// Login (use-case)
// ---------------------------------------------------------------------------

describe("Login use-case", () => {
  it("crea una sesión y devuelve token, expiración y usuario sin hash", async () => {
    const login = new Login(users, sessionsRepo, 12);
    const result: AuthSession = await login.execute({ email: SEED_EMAIL, password: PASSWORD });

    expect(result.token.length).toBeGreaterThanOrEqual(32);
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(result.user.email).toBe(SEED_EMAIL);
    expect(result.user.role).toBe("JUDGE");
    expect(result.user).not.toHaveProperty("passwordHash");
    expect(sessionsRepo.sessions.size).toBe(1);
  });

  it("normaliza el email (trim + lowercase)", async () => {
    const login = new Login(users, sessionsRepo, 12);
    const result = await login.execute({
      email: `  ${SEED_EMAIL.toUpperCase()}  `,
      password: PASSWORD,
    });
    expect(result.user.email).toBe(SEED_EMAIL);
  });

  it("rechaza email desconocido con InvalidCredentialsError", async () => {
    const login = new Login(users, sessionsRepo, 12);
    await expect(
      login.execute({ email: "nobody@goya2027.test", password: PASSWORD }),
    ).rejects.toThrow(InvalidCredentialsError);
    // No se crea sesión para cuentas inexistentes
    expect(sessionsRepo.sessions.size).toBe(0);
  });

  it("rechaza contraseña incorrecta con el mismo error que email desconocido", async () => {
    const login = new Login(users, sessionsRepo, 12);
    let unknownError: unknown;
    let wrongPassError: unknown;
    try {
      await login.execute({ email: "nobody@goya2027.test", password: PASSWORD });
    } catch (err) {
      unknownError = err;
    }
    try {
      await login.execute({ email: SEED_EMAIL, password: "Wrong-Password-9" });
    } catch (err) {
      wrongPassError = err;
    }
    // Mismo tipo y mismo mensaje: no hay enumeración de usuarios.
    expect(wrongPassError).toBeInstanceOf(InvalidCredentialsError);
    expect((unknownError as Error).message).toBe((wrongPassError as Error).message);
    expect((wrongPassError as Error).message).toMatch(/invalid email or password/i);
  });

  it("rechaza cuentas sin password_hash (login deshabilitado)", async () => {
    const noLoginUser: UserAccount = {
      id: "22222222-2222-4222-8222-222222222222",
      email: "sin-login@goya2027.test",
      role: "JUDGE",
      // Sin passwordHash: creada por el alta masiva de jurados (SVC2-24),
      // no por registro de credenciales.
    };
    const repo = new FakeUserRepository([noLoginUser]);
    const login = new Login(repo, sessionsRepo, 12);
    await expect(
      login.execute({ email: "sin-login@goya2027.test", password: PASSWORD }),
    ).rejects.toThrow(InvalidCredentialsError);
    expect(sessionsRepo.sessions.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Sesión (use-case)
// ---------------------------------------------------------------------------

async function createActiveSession(tokenTtlMs: number): Promise<{ token: string; sessionId: string }> {
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + tokenTtlMs);
  await sessionsRepo.create({ userId: USER_ID, tokenHash, expiresAt });
  const session = await sessionsRepo.findByTokenHash(tokenHash);
  return { token, sessionId: session?.id ?? "" };
}

describe("GetSessionUser use-case", () => {
  it("devuelve el usuario de una sesión válida", async () => {
    const { token } = await createActiveSession(60 * 60 * 1000);
    const useCase = new GetSessionUser(users, sessionsRepo);
    const user = await useCase.execute({ token });
    expect(user.id).toBe(USER_ID);
    expect(user.email).toBe(SEED_EMAIL);
  });

  it("rechaza token desconocido", async () => {
    const useCase = new GetSessionUser(users, sessionsRepo);
    await expect(useCase.execute({ token: generateSessionToken() })).rejects.toThrow(
      UnauthorizedError,
    );
  });

  it("rechaza sesión expirada", async () => {
    const { token } = await createActiveSession(-1000);
    const useCase = new GetSessionUser(users, sessionsRepo);
    await expect(useCase.execute({ token })).rejects.toThrow(UnauthorizedError);
  });

  it("rechaza sesión revocada", async () => {
    const { token, sessionId } = await createActiveSession(60 * 60 * 1000);
    await sessionsRepo.revoke(sessionId);
    const useCase = new GetSessionUser(users, sessionsRepo);
    await expect(useCase.execute({ token })).rejects.toThrow(UnauthorizedError);
  });
});

describe("Logout use-case", () => {
  it("revoca la sesión activa", async () => {
    const { token } = await createActiveSession(60 * 60 * 1000);
    const logout = new Logout(sessionsRepo);
    await logout.execute({ token });
    const session = await sessionsRepo.findByTokenHash(hashSessionToken(token));
    expect(session?.revokedAt).not.toBeNull();
  });

  it("es idempotente con token desconocido", async () => {
    const logout = new Logout(sessionsRepo);
    await expect(logout.execute({ token: generateSessionToken() })).resolves.toBeUndefined();
  });

  it("es idempotente si la sesión ya está revocada", async () => {
    const { token, sessionId } = await createActiveSession(60 * 60 * 1000);
    await sessionsRepo.revoke(sessionId);
    const logout = new Logout(sessionsRepo);
    await expect(logout.execute({ token })).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// HTTP (contratos de API)
// ---------------------------------------------------------------------------

let serverApp: ReturnType<typeof createApp> | undefined;
const sessionsMap = new Map<string, Session>();
beforeEach(() => {
  sessionsMap.clear();
});

async function startHttpApp(): Promise<ReturnType<typeof createApp>> {
  const app = await startApp([judge], sessionsMap);
  serverApp = app;
  return app;
}

describe("POST /auth/login (HTTP)", () => {
  it("devuelve 200 con token, expiración y usuario sin credenciales", async () => {
    const app = await startHttpApp();
    try {
      const res = await jsonRequest(app.server, "/auth/login", {}, {
        email: SEED_EMAIL,
        password: PASSWORD,
      });
      expect(res.status).toBe(200);
      const body = res.body as AuthSession;
      expect(body.token).toBeTypeOf("string");
      expect(typeof body.expiresAt).toBe("string");
      expect(body.user.role).toBe("JUDGE");
      expect(body.user).not.toHaveProperty("passwordHash");
    } finally {
      await app.close();
    }
  });

  it("devuelve 401 idéntico para email desconocido y contraseña incorrecta", async () => {
    const app = await startHttpApp();
    try {
      const unknown = await jsonRequest(app.server, "/auth/login", {}, {
        email: "nobody@goya2027.test",
        password: PASSWORD,
      });
      const wrongPass = await jsonRequest(app.server, "/auth/login", {}, {
        email: SEED_EMAIL,
        password: "Wrong-Password-9",
      });
      expect(unknown.status).toBe(401);
      expect(wrongPass.status).toBe(401);
      expect(JSON.stringify(unknown.body)).toBe(JSON.stringify(wrongPass.body));
      expect(unknown.body).toMatchObject({
        error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password" },
      });
    } finally {
      await app.close();
    }
  });

  it("devuelve 400 para body inválido o JSON mal formado", async () => {
    const app = await startHttpApp();
    try {
      const missing = await jsonRequest(app.server, "/auth/login", {}, { email: SEED_EMAIL });
      expect(missing.status).toBe(400);
      const badJson = await httpRequest(
        app.server,
        "/auth/login",
        "POST",
        { "content-type": "application/json" },
        "{ not json",
      );
      expect(badJson.status).toBe(400);
    } finally {
      await app.close();
    }
  });

  it("devuelve 404 para rutas auth inexistentes", async () => {
    const app = await startHttpApp();
    try {
      const res = await jsonRequest(app.server, "/auth/nope", {}, {
        email: SEED_EMAIL,
        password: PASSWORD,
      });
      expect(res.status).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("devuelve 405 con header Allow para método no admitido en ruta existente", async () => {
    const app = await startHttpApp();
    try {
      const res = await httpRequest(app.server, "/auth/login", "GET");
      expect(res.status).toBe(405);
      expect(res.headers["allow"]).toBe("POST");
    } finally {
      await app.close();
    }
  });
});

describe("GET /auth/me y POST /auth/logout (HTTP)", () => {
  async function loginToken(app: ReturnType<typeof createApp>): Promise<string> {
    const res = await jsonRequest(app.server, "/auth/login", {}, {
      email: SEED_EMAIL,
      password: PASSWORD,
    });
    expect(res.status).toBe(200);
    return (res.body as AuthSession).token;
  }

  it("GET /auth/me devuelve 200 con token válido", async () => {
    const app = await startHttpApp();
    try {
      const token = await loginToken(app);
      const res = await jsonRequest(app.server, "/auth/me", {
        authorization: `Bearer ${token}`,
      });
      expect(res.status).toBe(200);
      expect((res.body as { email: string }).email).toBe(SEED_EMAIL);
    } finally {
      await app.close();
    }
  });

  it("GET /auth/me devuelve 401 sin token o con token inválido", async () => {
    const app = await startHttpApp();
    try {
      const noToken = await jsonRequest(app.server, "/auth/me");
      expect(noToken.status).toBe(401);
      const badToken = await jsonRequest(app.server, "/auth/me", {
        authorization: "Bearer not-a-valid-token",
      });
      expect(badToken.status).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("logout revoca la sesión y me deja de funcionar (204 + 401)", async () => {
    const app = await startHttpApp();
    try {
      const token = await loginToken(app);
      const logout = await jsonRequest(app.server, "/auth/logout", {
        authorization: `Bearer ${token}`,
      }, undefined, "POST");
      expect(logout.status).toBe(204);
      const after = await jsonRequest(app.server, "/auth/me", {
        authorization: `Bearer ${token}`,
      });
      expect(after.status).toBe(401);
      // Logout repetido sigue siendo 204 (idempotente).
      const again = await jsonRequest(app.server, "/auth/logout", {
        authorization: `Bearer ${token}`,
      }, undefined, "POST");
      expect(again.status).toBe(204);
    } finally {
      await app.close();
    }
  });

  it("logout sin token devuelve 401", async () => {
    const app = await startHttpApp();
    try {
      const res = await jsonRequest(app.server, "/auth/logout", {}, undefined, "POST");
      expect(res.status).toBe(401);
    } finally {
      await app.close();
    }
  });
});