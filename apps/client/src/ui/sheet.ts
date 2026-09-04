import type {
  Candidate,
  Comparsa,
  JudgeAssignmentContext,
  JudgeContextResponse,
  Rubro,
  RubroItem,
  Vote,
} from "@votaciones2027/shared-types";
import type { LocalPlanilla, LocalVote } from "../offline/index.js";

/**
 * Modelo de presentación de la planilla del juez, construido puramente a
 * partir de contratos compartidos y de la capa offline local. Sin dependencia
 * de DOM → comprobable en tests.
 */

/** Clave de negocio de un voto (única por juez/noche/comparsa/rubro/ítem/candidato). */
export function voteKey(k: {
  comparsaId: string;
  rubroId: string;
  itemId: string;
  candidateId: string;
}): string {
  return [k.comparsaId, k.rubroId, k.itemId, k.candidateId].join("\u0001");
}

export interface DisplayVote {
  id: string;
  comparsaId: string;
  rubroId: string;
  itemId: string;
  candidateId: string;
  score: number | null;
  /** Estado de la copia local (la cola de sincronización se representa aquí). */
  syncState: "PENDING" | "SYNCING" | "SYNCED" | "FAILED";
  fromLocal: boolean;
}

export interface Cell {
  comparsaId: string;
  itemId: string;
  rubroId: string;
  candidateId: string | null;
  vote: DisplayVote | null;
}

export interface SheetRow {
  comparsa: Comparsa;
  cells: (Cell | null)[];
}

export interface SheetModel {
  rubros: Rubro[];
  items: RubroItem[];
  comparsas: Comparsa[];
  rows: SheetRow[];
  /** Candidatos elegibles de la especialidad del juez en la noche. */
  eligibleCandidates: Candidate[];
  /** Votos presentados (cada uno con score). Adaptado en este orden *. */
  votes: DisplayVote[];
  scoredCount: number;
  omissionsCount: number;
  /** Mapa itemId → rubroId (para construir votos locales). */
  rubroByItem: Map<string, string>;
}

/**
 * Candidatos elegibles que el juez debía evaluar: candidatos de los ítems de
 * los rubros de su especialidad asignada (misma selección que el servidor usa
 * al confirmar, confirm-planilla).
 */
export function eligibleCandidatesFor(
  context: JudgeContextResponse,
  assignment: JudgeAssignmentContext,
): Candidate[] {
  const specialtyRubroIds = new Set(
    context.rubros
      .filter((r) => r.specialty === assignment.specialty)
      .map((r) => r.id),
  );
  const specialtyItemIds = new Set(
    context.items.filter((i) => specialtyRubroIds.has(i.rubroId)).map((i) => i.id),
  );
  return context.candidates.filter((c) => specialtyItemIds.has(c.itemId));
}

/**
 * Firma canónica de candidato para buscar el voto que corresponde a la celda.
 * La comparación usa las claves de negocio, no los ids de la copia local.
 */
function candidateVoteKey(candidate: Candidate): string {
  return `${candidate.comparsaId}\u0001${candidate.itemId}`;
}

/**
 * Construye el modelo de la hoja de notas para la especialidad asignada.
 *
 * `local` gana siempre: la copia local (que ya persiste cualquier edición)
 * prevalece sobre el estado del servidor para la misma clave de negocio.
 */
export function buildSheet(
  context: JudgeContextResponse,
  assignment: JudgeAssignmentContext,
  serverVotes: readonly Vote[],
  localVotes: readonly LocalVote[],
): SheetModel {
  const rubros = context.rubros
    .filter((r) => r.specialty === assignment.specialty)
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
  const items = context.items
    .filter((i) => rubros.some((r) => r.id === i.rubroId))
    .sort((a, b) => (a.orderIndex === b.orderIndex ? 0 : a.orderIndex - b.orderIndex));
  const comparsas = [...context.comparsas].sort((a, b) =>
    a.code.localeCompare(b.code, "es"),
  );

  const eligible = eligibleCandidatesFor(context, assignment);
  const candidateByKey = new Map<string, Candidate>();
  for (const c of eligible) candidateByKey.set(candidateVoteKey(c), c);

  const byBusinessKey = new Map<string, DisplayVote>();
  for (const v of serverVotes) {
    const key = voteKey(v);
    byBusinessKey.set(key, {
      id: v.id,
      comparsaId: v.comparsaId,
      rubroId: v.rubroId,
      itemId: v.itemId,
      candidateId: v.candidateId,
      score: v.score,
      syncState: "SYNCED",
      fromLocal: false,
    });
  }
  for (const v of localVotes) {
    const key = voteKey(v);
    byBusinessKey.set(key, {
      id: v.id,
      comparsaId: v.comparsaId,
      rubroId: v.rubroId,
      itemId: v.itemId,
      candidateId: v.candidateId,
      score: v.score,
      syncState: v.syncState,
      fromLocal: true,
    });
  }

  const rows: SheetRow[] = comparsas.map((comparsa) => {
    const cells: (Cell | null)[] = items.map((item) => {
      const candidate = candidateByKey.get(
        `${comparsa.id}\u0001${item.id}`,
      );
      if (candidate === undefined) return null;
      const key = voteKey({
        comparsaId: comparsa.id,
        rubroId: item.rubroId,
        itemId: item.id,
        candidateId: candidate.id,
      });
      const vote = byBusinessKey.get(key) ?? null;
      return {
        comparsaId: comparsa.id,
        itemId: item.id,
        rubroId: item.rubroId,
        candidateId: candidate.id,
        vote,
      };
    });
    return { comparsa, cells };
  });

  const votes = Array.from(byBusinessKey.values());
  const scoredCount = votes.filter((v) => v.score !== null).length;
  const omissionsCount = Math.max(0, eligible.length - scoredCount);

  const rubroByItem = new Map<string, string>();
  for (const item of items) rubroByItem.set(item.id, item.rubroId);

  return {
    rubros,
    items,
    comparsas,
    rows,
    eligibleCandidates: eligible,
    votes,
    scoredCount,
    omissionsCount,
    rubroByItem,
  };
}

/**
 * Conversión entre la copia local y su versión de contrato compartido para los
 * votos recién emitidos o editados antes del sync.
 */
export function toLocalVote(
  planilla: LocalPlanilla,
  vote: DisplayVote,
  idempotencyKey: string,
  updatedAt: string,
): LocalVote {
  return {
    id: vote.id,
    planillaId: planilla.id,
    nightId: planilla.nightId,
    comparsaId: vote.comparsaId,
    rubroId: vote.rubroId,
    itemId: vote.itemId,
    candidateId: vote.candidateId,
    score: vote.score ?? 0,
    idempotencyKey,
    syncState: "PENDING",
    updatedAt,
  };
}

/**
 * La planilla se puede confirmar solo si:
 *  - es editable (BORRADOR / EN_EVALUACION);
 *  - el dispositivo está online;
 *  - no hay copias locales pendientes ni fallidas (toda edición sincronizada);
 *  - no hay operación de sincronización en curso (syncing/pending/failed).
 */
export function canConfirmPlanilla(params: {
  planillaStatus: string;
  online: boolean;
  hasPendingSync: boolean;
  confirmedAlready: boolean;
}): boolean {
  if (params.confirmedAlready) return false;
  if (!isEditable(params.planillaStatus)) return false;
  if (!params.online) return false;
  if (params.hasPendingSync) return false;
  return true;
}

export function isEditable(status: string): boolean {
  return status === "BORRADOR" || status === "EN_EVALUACION";
}

export function syncBadgeForVote(vote: DisplayVote): { label: string; tone: "ok" | "pending" | "syncing" | "error" } {
  switch (vote.syncState) {
    case "PENDING":
      return { label: "Pendiente", tone: "pending" };
    case "SYNCING":
      return { label: "Sincronizando", tone: "syncing" };
    case "FAILED":
      return { label: "Error de sincronización", tone: "error" };
    default:
      return { label: "Sincronizado", tone: "ok" };
  }
}