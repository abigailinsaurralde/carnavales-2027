import pg from "pg";
import { DatabaseError } from "../errors/app-error.js";

const { Pool } = pg;

export interface DbPool {
  query<T extends pg.QueryResultRow = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<pg.QueryResult<T>>;
  end(): Promise<void>;
}

export function createPool(databaseUrl: string): DbPool {
  const pool = new Pool({ connectionString: databaseUrl });

  pool.on("error", (err) => {
    console.error("[db] Unexpected pool error:", err.message);
  });

  return {
    async query<T extends pg.QueryResultRow = Record<string, unknown>>(
      text: string,
      params?: unknown[],
    ): Promise<pg.QueryResult<T>> {
      try {
        return await pool.query<T>(text, params);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown DB error";
        throw new DatabaseError(message);
      }
    },

    async end(): Promise<void> {
      await pool.end();
    },
  };
}
