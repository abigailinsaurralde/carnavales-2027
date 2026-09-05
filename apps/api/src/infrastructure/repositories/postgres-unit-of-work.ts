import type { DbPool } from "../../db/pool.js";
import type {
  UnitOfWork,
  UnitOfWorkRepositories,
} from "../../domain/repositories/unit-of-work.js";
import { PostgresAuditRepository } from "./postgres-audit-repository.js";
import { PostgresNightRepository } from "./postgres-night-repository.js";
import { PostgresPlanillaRepository } from "./postgres-planilla-repository.js";
import { PostgresVoteRepository } from "./postgres-vote-repository.js";

/**
 * Implementa la unidad de trabajo sobre PostgreSQL: dentro de
 * `withTransaction` se crean nuevas instancias de los repositorios atados al
 * mismo cliente transaccional, garantizando atomicidad entre
 * planilla/votos/omisiones/auditoría.
 */
export class PostgresUnitOfWork implements UnitOfWork {
  constructor(private readonly db: DbPool) {}

  withTransaction<T>(fn: (tx: UnitOfWorkRepositories) => Promise<T>): Promise<T> {
    return this.db.withTransaction((runner) =>
      fn({
        planillas: new PostgresPlanillaRepository(runner),
        votes: new PostgresVoteRepository(runner),
        audits: new PostgresAuditRepository(runner),
        nights: new PostgresNightRepository(runner),
      }),
    );
  }
}