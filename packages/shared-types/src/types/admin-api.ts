import type {
  Candidate,
  CarnavalEdition,
  Comparsa,
  Night,
  Rubro,
  RubroItem,
  RubroType,
} from "./carnaval.js";
import type { Specialty } from "./specialty.js";
import type { UserRole } from "./roles.js";

/**
 * Contratos de la administración (Slice 1 — Administración base).
 *
 * Alcance (decisiones aprobadas):
 *  - CRUD de catálogo: comparsas, rubros, ítems y candidatos (create/update/list;
 *    SIN delete físico: la eliminación lógica no está definida).
 *  - Noches y ventanas: edición de `date`, `startsAt` y `endsAt`.
 *    Las transiciones automáticas ABIERTA/CERRADA NO están definidas (PEND-110/114)
 *    y quedan fuera de este contrato.
 *  - Jueces: SOLO listado de cuentas JUDGE (el alta de jurados reales llega con
 *    SVC2-24, fuera de alcance) + habilitación vía `JudgeAssignment`.
 *  - Ninguna operación elimina datos: el contrato solo expone create/update/list.
 */

/** Cuenta de usuario visible para administración (listado de jueces). */
export interface AdminJudge {
  id: string;
  email: string;
  displayName?: string;
  role: UserRole;
}

/** Conteos del catálogo actual por entidad (orientativos para el panel). */
export interface AdminCatalogCounts {
  comparsas: number;
  rubros: number;
  items: number;
  candidates: number;
  assignments: number;
}

/**
 * Especialidad expuesta por el contexto de administración con identidad
 * persistida y código de dominio. El `id` (UUID) es el identificador que la
 * consola debe usar para construir `AssignmentInput.specialtyId`; el `code` es
 * el código canónico para representar/etiquetar la especialidad en la UI.
 */
export interface AdminSpecialty {
  id: string;
  code: Specialty;
}

/**
 * Contexto completo de la consola de administración. Un solo GET para el panel;
 * las colecciones específicas se consultan por endpoints dedicados.
 */
export interface AdminContextResponse {
  edition: CarnavalEdition;
  nights: Night[];
  specialties: AdminSpecialty[];
  judges: AdminJudge[];
  counts: AdminCatalogCounts;
}

/** Create/update de una comparsa. */
export interface ComparsaInput {
  code: string;
  name: string;
}

/** Create/update de un rubro. */
export interface RubroInput {
  specialty: Specialty;
  name: string;
  type: RubroType;
}

/** Create/update de un ítem de rubro. */
export interface RubroItemInput {
  name: string;
  orderIndex: number;
}

/** Create/update de un candidato (ítem de una comparsa). */
export interface CandidateInput {
  itemId: string;
  comparsaId: string;
  label: string;
}

/**
 * Actualización de una noche: SOLO datos explícitamente en alcance.
 * - `date`: fecha calendario de la noche (opcional, sin inventar fechas
 *   oficiales, PEND-110).
 * - `startsAt`/`endsAt`: ventana de votación (PEND-114). `null` limpia la
 *   ventana (el servidor deja de aplicarla). Mientras no existan fechas
 *   oficiales el servidor es la autoridad temporal.
 * `number`/`status` NO son editables: el número está anclado a la edición y las
 * transiciones de estado dependen de decisiones pendientes.
 */
export interface NightUpdateInput {
  date?: string | null | undefined;
  startsAt?: string | null | undefined;
  endsAt?: string | null | undefined;
}

/**
 * Create/update de una asignación (habilitación) de juez por noche y
 * especialidad. `isEffective = false` deshabilita la asignación sin inventar
 * semántica de reemplazo (el reemplazo es S3).
 */
export interface AssignmentInput {
  judgeId: string;
  nightId: string;
  specialtyId: string;
  isEffective: boolean;
}

/** Asignación de juez expuesta por la administración. */
export interface JudgeAssignmentView {
  id: string;
  judgeId: string;
  nightId: string;
  specialtyId: string;
  isEffective: boolean;
}

export interface AdminCreateResult<T> {
  created: true;
  item: T;
}

export interface AdminUpdateResult<T> {
  created: false;
  item: T;
}

export type AdminComparsaResult = AdminCreateResult<Comparsa> | AdminUpdateResult<Comparsa>;
export type AdminRubroResult = AdminCreateResult<Rubro> | AdminUpdateResult<Rubro>;
export type AdminRubroItemResult = AdminCreateResult<RubroItem> | AdminUpdateResult<RubroItem>;
export type AdminCandidateResult = AdminCreateResult<Candidate> | AdminUpdateResult<Candidate>;
export type AdminAssignmentResult =
  | AdminCreateResult<JudgeAssignmentView>
  | AdminUpdateResult<JudgeAssignmentView>;