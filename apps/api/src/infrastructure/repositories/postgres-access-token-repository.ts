import type { DbPool } from "../../db/pool.js";
import type { AccessToken } from "../../domain/entities/access-token.js";
import type {
  AccessTokenRepository,
  CreateAccessTokenInput,
} from "../../domain/repositories/access-token-repository.js";

interface AccessTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date | string;
  used_at: Date | string | null;
  revoked_at: Date | string | null;
}

function mapAccessToken(row: AccessTokenRow): AccessToken {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    expiresAt: new Date(row.expires_at),
    usedAt: row.used_at === null ? null : new Date(row.used_at),
    revokedAt: row.revoked_at === null ? null : new Date(row.revoked_at),
  };
}

/**
 * Repositorio Postgres de access tokens temporales (migración 004,
 * coordinada con Database). El token plano nunca llega aquí: solo su
 * SHA-256 en hex.
 */
export class PostgresAccessTokenRepository implements AccessTokenRepository {
  constructor(private readonly db: DbPool) {}

  async create(input: CreateAccessTokenInput): Promise<void> {
    await this.db.query(
      `INSERT INTO access_token (id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [input.id, input.userId, input.tokenHash, input.expiresAt],
    );
  }

  async findByTokenHash(tokenHash: string): Promise<AccessToken | null> {
    const result = await this.db.query<AccessTokenRow>(
      `SELECT id, user_id, token_hash, expires_at, used_at, revoked_at
       FROM access_token
       WHERE token_hash = $1`,
      [tokenHash],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapAccessToken(row);
  }

  /**
   * Consumo atómico condicional: UPDATE usado con clip `AND used_at IS NULL`.
   * En PostgreSQL el UPDATE condicional es atómico entre transacciones
   * concurrentes: solo una reporta rowCount = 1 (token consumido); las demás
   * reportan 0 (token ya usado) → previene la carrera TOCTOU de doble uso.
   */
  async markUsed(id: string): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE access_token SET used_at = now() WHERE id = $1 AND used_at IS NULL`,
      [id],
    );
    return (result.rowCount ?? 0) > 0;
  }
}