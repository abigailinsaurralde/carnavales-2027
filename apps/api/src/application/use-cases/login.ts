import type { AuthSession, LoginRequest } from "@votaciones2027/shared-types";
import { toAuthenticatedUser } from "../../domain/entities/user.js";
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
  hashSessionToken,
} from "../../infrastructure/crypto/tokens.js";
import type { UseCase } from "../types.js";

export class Login implements UseCase<LoginRequest, AuthSession> {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly audits: AuditRepository,
    private readonly sessionTtlHours: number,
  ) {}

  async execute(input: LoginRequest): Promise<AuthSession> {
    const email = input.email.trim().toLowerCase();
    const user = await this.users.findByEmail(email);

    if (user === null || user.passwordHash === undefined) {
      // Igualar el coste temporal de scrypt para no revelar si la cuenta
      // existe (anti-enumeración por timing) y devolver el mismo error.
      await verifyPassword(input.password, DUMMY_PASSWORD_HASH);
      throw new InvalidCredentialsError();
    }

    const passwordOk = await verifyPassword(input.password, user.passwordHash);
    if (!passwordOk) {
      throw new InvalidCredentialsError();
    }

    const token = generateSessionToken();
    const tokenHash = hashSessionToken(token);
    const expiresAt = new Date(
      Date.now() + this.sessionTtlHours * 60 * 60 * 1000,
    );

    await this.sessions.create({ userId: user.id, tokenHash, expiresAt });

    // §19 del Reglamento exige auditar el inicio de sesión. Mismo patrón que
    // login-with-access-token.ts, distinguiendo el método utilizado.
    await this.audits.create({
      eventType: "LOGIN",
      entityType: "USER",
      entityId: user.id,
      actorUserId: user.id,
      payload: { method: "password" },
    });

    return {
      token,
      expiresAt: expiresAt.toISOString(),
      user: toAuthenticatedUser(user),
    };
  }
}