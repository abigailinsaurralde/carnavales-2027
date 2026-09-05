import type { AuthSession, LoginWithAccessTokenRequest } from "@votaciones2027/shared-types";
import { toAuthenticatedUser } from "../../domain/entities/user.js";
import type { AccessTokenRepository } from "../../domain/repositories/access-token-repository.js";
import type { AuditRepository } from "../../domain/repositories/audit-repository.js";
import type { SessionRepository } from "../../domain/repositories/session-repository.js";
import type { UserRepository } from "../../domain/repositories/user-repository.js";
import { InvalidCredentialsError } from "../../errors/app-error.js";
import {
  DUMMY_PASSWORD_HASH,
  verifyPassword,
} from "../../infrastructure/crypto/passwords.js";
import {
  generateSessionToken,
  hashAccessToken,
  hashSessionToken,
} from "../../infrastructure/crypto/tokens.js";
import type { UseCase } from "../types.js";

/**
 * Canje del access token temporal (correo + DNI + token de un solo uso) por
 * una sesión server-side estándar. SVC2-31 / SVC2-10 / SVC2-24.
 *
 * - Reutiliza EXACTAMENTE la mecánica de sesión de Login (generateSessionToken
 *   / hashSessionToken / sessions.create): no se crea una segunda
 *   autenticación paralela.
 * - El access token es de UN solo uso: se marca used_at al canje exitoso.
 * - El token plano del access token nunca se persiste ni se devuelve; la
 *   respuesta es un AuthSession idéntico al de /auth/login.
 * - Ante cualquier fallo de credenciales se lanza InvalidCredentialsError con
 *   igualación de timing (scrypt dummy) para no revelar qué factor falló.
 */
export class LoginWithAccessToken
  implements UseCase<LoginWithAccessTokenRequest, AuthSession>
{
  constructor(
    private readonly users: UserRepository,
    private readonly accessTokens: AccessTokenRepository,
    private readonly sessions: SessionRepository,
    private readonly audits: AuditRepository,
    private readonly sessionTtlHours: number,
  ) {}

  async execute(input: LoginWithAccessTokenRequest): Promise<AuthSession> {
    const email = input.email.trim().toLowerCase();
    const dni = input.dni.trim();
    const user = await this.users.findByEmail(email);

    if (user === null || user.dni === undefined || user.role !== "JUDGE") {
      await verifyPassword(`${dni}:${input.token}`, DUMMY_PASSWORD_HASH);
      throw new InvalidCredentialsError();
    }

    if (user.dni !== dni) {
      await verifyPassword(`${dni}:${input.token}`, DUMMY_PASSWORD_HASH);
      throw new InvalidCredentialsError();
    }

    const tokenHash = hashAccessToken(input.token);
    const accessToken = await this.accessTokens.findByTokenHash(tokenHash);

    if (
      accessToken === null ||
      accessToken.userId !== user.id ||
      accessToken.expiresAt.getTime() <= Date.now() ||
      accessToken.usedAt !== null ||
      accessToken.revokedAt !== null
    ) {
      throw new InvalidCredentialsError();
    }

    // Consumo atómico condicional del token de un solo uso, ANTES de crear la
    // sesión. Fail-closed: ante una carrera concurrente, solo un canje obtiene
    // `true`; los demás lanzan InvalidCredentialsError. Si la sesión fallara
    // tras consumir el token, este queda consumido sin sesión (comportamiento
    // seguro y documentado; no se introduce transacción nueva aquí).
    const consumed = await this.accessTokens.markUsed(accessToken.id);
    if (!consumed) {
      throw new InvalidCredentialsError();
    }

    const sessionToken = generateSessionToken();
    const sessionTokenHash = hashSessionToken(sessionToken);
    const expiresAt = new Date(
      Date.now() + this.sessionTtlHours * 60 * 60 * 1000,
    );

    await this.sessions.create({
      userId: user.id,
      tokenHash: sessionTokenHash,
      expiresAt,
    });

    await this.audits.create({
      eventType: "LOGIN",
      entityType: "USER",
      entityId: user.id,
      actorUserId: user.id,
      payload: { method: "access-token" },
    });

    return {
      token: sessionToken,
      expiresAt: expiresAt.toISOString(),
      user: toAuthenticatedUser(user),
    };
  }
}