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
 * - El consumo es un UPDATE condicional atómico `WHERE id = $1 AND used_at IS
 *   NULL`, nunca un DELETE (preserva trazabilidad). En PostgreSQL el UPDATE
 *   condicional se serializa entre transacciones concurrentes: solo una obtiene
 *   rowCount = 1, las demás obtienen 0 (cierra la carrera TOCTOU de doble uso).
 */
export interface AccessTokenRepository {
  create(input: CreateAccessTokenInput): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<AccessToken | null>;
  /**
   * Consumo atómico condicional del token de un solo uso: `true` SOLO si el
   * token estaba sin usar (se actualizó 1 fila); `false` si ya estaba usado.
   */
  markUsed(id: string): Promise<boolean>;
}