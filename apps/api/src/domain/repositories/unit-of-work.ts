import type { AuditRepository } from "./audit-repository.js";
import type { NightRepository } from "./night-repository.js";
import type { PlanillaRepository } from "./planilla-repository.js";
import type { VoteRepository } from "./vote-repository.js";

/**
 * Repositorios atados a la conexión transaccional activa.
 */
export interface UnitOfWorkRepositories {
  planillas: PlanillaRepository;
  votes: VoteRepository;
  audits: AuditRepository;
  nights: NightRepository;
}

/**
 * Unidad de trabajo: permite ejecutar un conjunto de operaciones de
 * persistencia de forma atómica (BEGIN/COMMIT/ROLLBACK).
 */
export interface UnitOfWork {
  withTransaction<T>(fn: (tx: UnitOfWorkRepositories) => Promise<T>): Promise<T>;
}