import type {
  Rubro,
  RubroResult,
  ScrutinioResult,
  TieBreakResolution,
} from "@votaciones2027/shared-types";
import { validateVotes } from "./votes.js";
import {
  computeCandidateResolutions,
  type CandidateResolution,
} from "./omission.js";
import { computeRubroTotals } from "./totals.js";
import { determineRubroWinners, type RubroWinner } from "./winner.js";
import type { ScrutinioConfig, ScrutinioSnapshot } from "./model.js";

export function computeSnapshotHash(snapshot: ScrutinioSnapshot): string {
  // Minimal, deterministic content hash over the immutable evidence. The exact
  // algorithm/scope for integrity is PEND-113; this placeholder is stable and
  // enough to prove reproducibility within a run but must be replaced once the
  // hash scope is defined (PEND-113).
  const payload = JSON.stringify({
    editionId: snapshot.editionId,
    nights: snapshot.nights.map((n) => n.id).sort(),
    votes: snapshot.votes
      .map((v) => `${v.id}:${v.score}`)
      .sort(),
    penalizaciones: snapshot.penalizaciones
      .map((p) => `${p.id}:${p.cantidad}:${p.estado}`)
      .sort(),
  });
  let hash = 0;
  for (let i = 0; i < payload.length; i++) {
    hash = (hash * 31 + payload.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export interface ComparsaRanking {
  comparsaId: string;
  /** Sum of totals across all nominativo rubros (rule 15). */
  totalNominativo: number;
  /** Number of nominativo rubros in which the comparssa is winner. */
  nominativoRubrosGanados: number;
}

/** Full engine output: the CALCULO + RESULTADO layers for a scrutinee run. */
export interface ScrutinioEngineResult {
  run: ScrutinioResult["run"];
  rubroResults: ReadonlyArray<RubroResult>;
  winnersPerRubro: ReadonlyArray<RubroWinner>;
  ranking: ReadonlyArray<ComparsaRanking>;
  winnerComparsaId: string | undefined;
  tieBreaks: ReadonlyArray<TieBreakResolution>;
  /** Per-(comparsa, rubro, item) candidate resolutions, incl. non-selected
   *  candidates kept for audit (rule 15). */
  candidateResolutions: ReadonlyArray<CandidateResolution>;
  /** Cells corrected for omission (auditable per rule 8). */
  correctedCells: ReturnType<typeof computeCandidateResolutions>["correctedCells"];
}

/** Compares two floats with an epsilon for stable, deterministic ordering. */
function totalCompare(a: number, b: number): number {
  const EPS = 1e-9;
  const d = a - b;
  if (Math.abs(d) <= EPS) return 0;
  return d < 0 ? -1 : 1;
}

function sortedNominativoTotal(
  ranking: ReadonlyArray<ComparsaRanking>,
): ReadonlyArray<ComparsaRanking> {
  return [...ranking].sort((a, b) => -totalCompare(a.totalNominativo, b.totalNominativo));
}

export function runScrutinio(
  snapshot: ScrutinioSnapshot,
  config: ScrutinioConfig,
): ScrutinioEngineResult {
  // validateVotes enforces the frozen nights count (rule 2.1) and the
  // score/duplicate invariants (rules 7, 22).
  validateVotes(snapshot.votes, snapshot.nights.map((n) => n.id));

  // CALCULO layer: derive per-candidate resolutions (applies omission
  // correction and the MAX(TOTAL_CANDIDATO) multi-candidate rule, rule 15).
  const { resolutions, correctedCells } = computeCandidateResolutions(
    snapshot.votes,
    snapshot.nights,
    snapshot.comparsas,
    snapshot.rubros,
    snapshot.items,
  );

  // CALCULO layer: group into per-(rubro, comparsa) totals. Omission-corrected
  // values flow into the totals.
  const totals = computeRubroTotals(
    resolutions,
    snapshot.nights,
    snapshot.penalizaciones,
  );

  const winnersPerRubro = determineRubroWinners(snapshot.rubros, totals);

  const rubroResults: RubroResult[] = totals.map((t) => ({
    rubroId: t.rubroId,
    comparsaId: t.comparsaId,
    total: t.total,
  }));

  // RESULTADO layer: Comparsa Ganadora uses nominativo rubros only (rule 15).
  const nominativoIds = new Set(
    snapshot.rubros.filter((r) => r.type === "NOMINATIVO").map((r) => r.id),
  );
  const nominativoTotals = totals.filter((t) => nominativoIds.has(t.rubroId));

  const byComparsa = new Map<string, ComparsaRanking>();
  for (const comparsa of snapshot.comparsas) {
    byComparsa.set(comparsa.id, {
      comparsaId: comparsa.id,
      totalNominativo: 0,
      nominativoRubrosGanados: 0,
    });
  }
  for (const t of nominativoTotals) {
    const entry = byComparsa.get(t.comparsaId);
    if (entry) entry.totalNominativo += t.total;
  }
  for (const w of winnersPerRubro) {
    if (!nominativoIds.has(w.rubroId)) continue;
    for (const cid of w.winnerComparsaIds) {
      const entry = byComparsa.get(cid);
      if (entry) entry.nominativoRubrosGanados += 1;
    }
  }
  const candidates = [...byComparsa.values()].filter((c) => c.totalNominativo > 0);
  const ranking = sortedNominativoTotal(candidates);

  const tieBreaks: TieBreakResolution[] = [];
  let winnerComparsaId: string | undefined;

  if (ranking.length > 0) {
    const topTotal = ranking[0]!.totalNominativo;
    const leaders = ranking.filter((c) => c.totalNominativo === topTotal);

    if (leaders.length === 1) {
      winnerComparsaId = leaders[0]!.comparsaId;
    } else {
      // Tie-break stage 1 (rule 16.1): most nominativo rubros won.
      const maxWon = Math.max(...leaders.map((c) => c.nominativoRubrosGanados));
      const stage1 = leaders.filter((c) => c.nominativoRubrosGanados === maxWon);
      tieBreaks.push({
        stage: 1,
        comparasaIds: leaders.map((c) => c.comparsaId),
        detail: { chosenComparsaIds: stage1.map((c) => c.comparsaId) },
      });

      if (stage1.length === 1) {
        winnerComparsaId = stage1[0]!.comparsaId;
      } else {
        // Tie-break stage 2 (rule 16.2): winner of Mejor Bateria.
        const bateriaRubro = snapshot.rubros.find(
          (r) => r.specialty === "BATERIA",
        );
        const bateriaWinner = bateriaRubro
          ? winnersPerRubro.find((w) => w.rubroId === bateriaRubro.id)
          : undefined;
        const stage2 = bateriaWinner
          ? stage1.filter((c) =>
              bateriaWinner.winnerComparsaIds.includes(c.comparsaId),
            )
          : [];
        tieBreaks.push({
          stage: 2,
          comparasaIds: stage1.map((c) => c.comparsaId),
          detail: {
            bateriaWinnerComparsaIds: bateriaWinner?.winnerComparsaIds ?? [],
            chosenComparsaIds: stage2.map((c) => c.comparsaId),
          },
        });

        if (stage2.length === 1) {
          winnerComparsaId = stage2[0]!.comparsaId;
        } else {
          // Tie-break stage 3 (rule 16.3): sorteo oficial. The draw mechanism
          // is NOT defined (PEND-102), so the engine reports a pending tie
          // instead of inventing a selection.
          tieBreaks.push({
            stage: 3,
            comparasaIds: stage2.length > 0
              ? stage2.map((c) => c.comparsaId)
              : stage1.map((c) => c.comparsaId),
            detail: { pending: "PEND-102" },
          });
          winnerComparsaId = undefined;
        }
      }
    }
  }

  const inputSnapshotHash = computeSnapshotHash(snapshot);

  return {
    run: {
      id: `${snapshot.editionId}-scrutinio-${inputSnapshotHash}`,
      editionId: snapshot.editionId,
      executedBy: config.executedBy,
      inputSnapshotHash,
      executedAt: new Date().toISOString(),
    },
    rubroResults,
    winnersPerRubro,
    ranking,
    winnerComparsaId,
    tieBreaks,
    candidateResolutions: resolutions,
    correctedCells,
  };
}
