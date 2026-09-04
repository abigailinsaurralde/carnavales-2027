import type { UserRole } from "@votaciones2027/shared-types";
import type { DbPool } from "../../db/pool.js";
import type { UserAccount } from "../../domain/entities/user.js";
import type { UserRepository } from "../../domain/repositories/user-repository.js";

interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  password_hash: string | null;
}

function mapUser(row: UserRow): UserAccount {
  return {
    id: row.id,
    email: row.email,
    ...(row.display_name === null ? {} : { displayName: row.display_name }),
    role: row.role as UserRole,
    ...(row.password_hash === null ? {} : { passwordHash: row.password_hash }),
  };
}

export class PostgresUserRepository implements UserRepository {
  constructor(private readonly db: DbPool) {}

  async findByEmail(email: string): Promise<UserAccount | null> {
    const result = await this.db.query<UserRow>(
      `SELECT id, email, display_name, role, password_hash
       FROM user_account
       WHERE email = $1`,
      [email],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapUser(row);
  }

  async findById(id: string): Promise<UserAccount | null> {
    const result = await this.db.query<UserRow>(
      `SELECT id, email, display_name, role, password_hash
       FROM user_account
       WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapUser(row);
  }
}