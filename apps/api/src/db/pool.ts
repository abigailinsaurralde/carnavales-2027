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
  if (err instanceof DatabaseError) return err;
  // Conserva el SQLSTATE original (p. ej. 23505) para que los repositorios
  // puedan mapear violaciones de unicidad/FK a errores de negocio (409/404)
  // y el nombre del constraint violado (locale-independiente) para distinguir
  // qué UNIQUE/FK disparó el error sin parsear mensajes localizados.
  const message = err instanceof Error ? err.message : "Unknown DB error";
  const pgCode =
    typeof err === "object" && err !== null && "code" in err
      ? String((err as { code: unknown }).code)
      : undefined;
  const constraint =
    typeof err === "object" && err !== null && "constraint" in err
      ? String((err as { constraint: unknown }).constraint)
      : undefined;
  return new DatabaseError(
    message,
    pgCode === undefined ? undefined : pgCode,
    constraint === undefined ? undefined : constraint,
  );
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
