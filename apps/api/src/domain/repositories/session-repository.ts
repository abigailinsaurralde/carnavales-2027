import type { Session } from "../entities/session.js";

export interface CreateSessionInput {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface SessionRepository {
  create(input: CreateSessionInput): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<Session | null>;
  /** Revocación de sesión: UPDATE revoked_at, nunca DELETE. */
  revoke(id: string): Promise<void>;
}