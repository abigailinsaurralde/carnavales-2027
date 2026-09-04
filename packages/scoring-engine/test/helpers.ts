import type {
  Candidate,
  Comparsa,
  Night,
  Penalizacion,
  Rubro,
  RubroItem,
  Vote,
} from "@votaciones2027/shared-types";
import type { ScrutinioSnapshot } from "../src/model.js";

export const EDITION = "ed-2027";

export function makeNights(n = 3): Night[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `night-${i + 1}`,
    editionId: EDITION,
    number: i + 1,
    status: "CERRADA" as const,
  }));
}

export function makeComparsas(ids: string[]): Comparsa[] {
  return ids.map((id) => ({ id, editionId: EDITION, code: id, name: id }));
}

export function makeRubro(
  id: string,
  type: Rubro["type"],
  specialty: Rubro["specialty"] = "BAILE",
): Rubro {
  return { id, editionId: EDITION, specialty, name: id, type };
}

export function makeItem(rubroId: string, itemId: string): RubroItem {
  return { id: itemId, rubroId, name: itemId, orderIndex: 0 };
}

export function makeCandidate(itemId: string, comparsaId: string, candidateId?: string): Candidate {
  return { id: candidateId ?? `${itemId}-${comparsaId}`, itemId, comparsaId, label: candidateId ?? comparsaId };
}

export function makeVote(
  opts: Partial<Vote> & {
    nightId: string;
    comparsaId: string;
    rubroId: string;
    itemId: string;
    candidateId: string;
    score: number;
  },
): Vote {
  return {
    id: opts.id ?? `v-${opts.nightId}-${opts.comparsaId}-${opts.rubroId}-${opts.itemId}`,
    planillaId: opts.planillaId ?? `p-${opts.nightId}`,
    judgeId: opts.judgeId ?? `j-${opts.nightId}`,
    nightId: opts.nightId,
    comparsaId: opts.comparsaId,
    rubroId: opts.rubroId,
    itemId: opts.itemId,
    candidateId: opts.candidateId,
    score: opts.score,
    scoreSource: opts.scoreSource ?? "JUDGE",
    idempotencyKey: opts.idempotencyKey ?? `k-${opts.score}`,
    syncState: opts.syncState ?? "SYNCED",
  };
}

export function makePenalty(
  comparsaId: string,
  cantidad: number,
  estado: Penalizacion["estado"] = "APROBADA",
): Penalizacion {
  return {
    id: `pen-${comparsaId}-${cantidad}`,
    editionId: EDITION,
    comparsaId,
    motivo: "test",
    reglaArticulo: "art-test",
    cantidad,
    estado,
    registeredBy: "admin",
  };
}

export function buildSnapshot(partial: Partial<ScrutinioSnapshot>): ScrutinioSnapshot {
  return {
    editionId: EDITION,
    nights: makeNights(),
    comparsas: makeComparsas(["c1", "c2"]),
    rubros: [],
    items: [],
    candidates: [],
    votes: [],
    penalizaciones: [],
    ...partial,
  };
}
