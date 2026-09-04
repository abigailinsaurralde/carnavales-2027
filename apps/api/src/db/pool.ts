import pg from "pg";
import { DatabaseError } from "../errors/app-error.js";

const { Pool } = pg;

/**
 * Ejecutor de queries sobre una conexión concreta (pool o cliente transaccional).
 * Los repositorios que participan en transacciones dependen de esta interfaz
 * (solo necesitan `query`), desacoplándolos de `DbPool`.
 */
export interface QueryRunner {
  query<T extends pg.QueryResultRow = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<pg.QueryResult<T>>;
}

export interface DbPool extends QueryRunner {
  /**
   * Ejecuta `fn` dentro de una transacción (BEGIN/COMMIT/ROLLBACK) sobre un
   * cliente dedicado. Todas las escrituras realizadas por los repositorios
   * recibidos en `fn` se aplican de forma atómica.
   *
   * Limitación documentada: no se soportan transacciones anidadas (el runner
   * transaccional no expone `withTransaction`). Un error de negocio lanzado por
   * `fn` aborta la transacción (ROLLBACK) y se propaga intacto al caller.
   */
  withTransaction<T>(fn: (tx: QueryRunner) => Promise<T>): Promise<T>;
  end(): Promise<void>;
}

function toDatabaseError(err: unknown): DatabaseError {
  return err instanceof DatabaseError
    ? err
    : new DatabaseError(err instanceof Error ? err.message : "Unknown DB error");
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
        throw toDatabaseError(err);
      }
    },

    async withTransaction<T>(fn: (tx: QueryRunner) => Promise<T>): Promise<T> {
      let client: pg.PoolClient | null = null;
      try {
        client = await pool.connect();
        try {
          await client.query("BEGIN");
        } catch (err) {
          throw toDatabaseError(err);
        }

        const txRunner: QueryRunner = {
          async query<TResult extends pg.QueryResultRow = Record<string, unknown>>(
            text: string,
            params?: unknown[],
          ): Promise<pg.QueryResult<TResult>> {
            if (client === null) {
              throw new DatabaseError("Transaction client is not available");
            }
            try {
              return await client.query<TResult>(text, params);
            } catch (err) {
              throw toDatabaseError(err);
            }
          },
        };

        const result = await fn(txRunner);

        try {
          await client.query("COMMIT");
        } catch (err) {
          throw toDatabaseError(err);
        }
        return result;
      } catch (err) {
        // Rollback ante cualquier fallo (escapado de BEGIN, fn o COMMIT). Un
        // error de negocio (NotFoundError/ConflictError/etc.) se re-propaga
        // INTACTO para el mapeo HTTP; los errores técnicos ya vienen envueltos
        // en DatabaseError por las operaciones internas.
        if (client !== null) {
          try {
            await client.query("ROLLBACK");
          } catch {
            // El rollback fallido no enmascara el error original.
          }
        }
        throw err;
      } finally {
        if (client !== null) {
          client.release();
        }
      }
    },

    async end(): Promise<void> {
      await pool.end();
    },
  };
}