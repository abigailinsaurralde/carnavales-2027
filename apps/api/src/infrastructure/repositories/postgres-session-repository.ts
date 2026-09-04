import type { DbPool } from "../../db/pool.js";
import type { Session } from "../../domain/entities/session.js";
import type {
  CreateSessionInput,
  SessionRepository,
} from "../../domain/repositories/session-repository.js";

interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: Date | string;
  expires_at: Date | string;
  revoked_at: Date | string | null;
}

function mapSession(row: SessionRow): Session {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    createdAt: new Date(row.created_at),
    expiresAt: new Date(row.expires_at),
    revokedAt: row.revoked_at === null ? null : new Date(row.revoked_at),
  };
}

export class PostgresSessionRepository implements SessionRepository {
  constructor(private readonly db: DbPool) {}

  async create(input: CreateSessionInput): Promise<void> {
    await this.db.query(
      `INSERT INTO session (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [input.userId, input.tokenHash, input.expiresAt],
    );
  }

  async findByTokenHash(tokenHash: string): Promise<Session | null> {
    const result = await this.db.query<SessionRow>(
      `SELECT id, user_id, token_hash, created_at, expires_at, revoked_at
       FROM session
       WHERE token_hash = $1`,
      [tokenHash],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapSession(row);
  }

  async revoke(id: string): Promise<void> {
    await this.db.query(
      `UPDATE session SET revoked_at = now() WHERE id = $1`,
      [id],
    );
  }
}