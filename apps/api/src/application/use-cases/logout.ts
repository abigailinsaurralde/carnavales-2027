import type { SessionRepository } from "../../domain/repositories/session-repository.js";
import { hashSessionToken } from "../../infrastructure/crypto/tokens.js";
import type { UseCase } from "../types.js";

export interface LogoutInput {
  token: string;
}

export class Logout implements UseCase<LogoutInput, void> {
  constructor(private readonly sessions: SessionRepository) {}

  async execute(input: LogoutInput): Promise<void> {
    const tokenHash = hashSessionToken(input.token);
    const session = await this.sessions.findByTokenHash(tokenHash);
    // Idempotente y sin enumeración de sesiones: si no existe o ya está
    // revocada, no se hace nada y no se revela el estado.
    if (session !== null && session.revokedAt === null) {
      await this.sessions.revoke(session.id);
    }
  }
}