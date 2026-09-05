import type { AccessToken } from "../entities/access-token.js";

export interface CreateAccessTokenInput {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}

/**
 * Repositorio de access tokens temporales de un solo uso.
 *
 * Invariantes de persistencia (diseño coordinado con Database, migración 004):
 * - `token_hash` es UNIQUE: un token emitido es identificable por su hash.
 * - El consumo es irreversible: `markUsed` es un UPDATE de `used_at`, nunca un
 *   DELETE (preserva trazabilidad y evita reuso del token).
 */
export interface AccessTokenRepository {
  create(input: CreateAccessTokenInput): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<AccessToken | null>;
  /** Consumo de un solo uso: UPDATE used_at, nunca DELETE. */
  markUsed(id: string): Promise<void>;
}