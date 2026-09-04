import type { Penalizacion } from "@votaciones2027/shared-types";
import {
  SELECTION_REASON_CANDIDATE_MAX_TIE,
  type CandidateResolution,
} from "./omission.js";

/**
 * A rubro computation kept separate from the evidence (rule 17: CALCULO layer
 * never overwrites the VOTO layer). The original votes remain untouched; the
 * totals are derived values.
 */
export interface RubroComputation {
  rubroId: string;
  comparsaId: string;
  /** Sum of the computable night-values across the edition nights (rule 9). */
  totalSinPenalizaciones: number;
  /** Penalizaciones approved and applicable to this comparssa/rubro scope. */
  penalizacionTotal: number;
  /** Total computable after penalizaciones (never mutating evidence). */
  total: number;
  /** Per-night composición, one entry per computable night. */
  byNight: ReadonlyArray<{
    nightId: string;
    /** Sum of the items of this rubro for this comparssa in that night. */
    nocheValue: number;
    omittedItems: number;
  }>;
  /** Items whose candidate selection could not be resolved (max tie). They are
   *  NOT included in the totals and remain explicitly pending (rule 15). */
  pendingTies: ReadonlyArray<{
    itemId: string;
    tiedCandidateIds: ReadonlyArray<string>;
  }>;
  /** True when any item of this (rubro, comparssa) has a pending candidate tie. */
  hasPendingCandidateTie: boolean;
}

/**
 * Groups and totals the candidate resolutions per (rubro, comparsa).
 *
 * Rules 9 and 15: within a nominativo rubro, every candidate of a comparsa has
 * its own 3-night total and the computable value per item is MAX(TOTAL). Items
 * of a rubro are summed, and the rubro total is the sum of the 3 nights
 * (no discard of highest/lowest, no dropping of a night). The original values
 * are never modified for the calculation.
 */
export function computeRubroTotals(
  resolutions: ReadonlyArray<CandidateResolution>,
  nights: ReadonlyArray<{ id: string }>,
  penalizaciones: ReadonlyArray<Penalizacion>,
): ReadonlyArray<RubroComputation> {
  // Group resolutions by (rubro, comparsa).
  const groups = new Map<string, CandidateResolution[]>();
  for (const r of resolutions) {
    const key = `${r.rubroId}|${r.comparsaId}`;
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }

  // Approved penalizaciones aggregated per (comparssa). The frozen rules let a
  // penalizacion target a comparssa (optionally a night); aggregating has no
  // cross-night discard, so we sum all approved amounts.
  const approved = penalizaciones.filter((p) => p.estado === "APROBADA");
  const penByComparsa = new Map<string, number>();
  for (const p of approved) {
    penByComparsa.set(p.comparsaId, (penByComparsa.get(p.comparsaId) ?? 0) + p.cantidad);
  }

  const selectedNightValue = (
    r: CandidateResolution,
    nightId: string,
  ): CandidateResolution["candidates"][number]["byNight"][number] | undefined =>
    r.candidates.find((c) => c.selected)?.byNight.find((n) => n.nightId === nightId);

  const results: RubroComputation[] = [];
  for (const [key, group] of groups) {
    const [rubroId, comparsaId] = key.split("|") as [string, string];

    const pendingTies: Array<RubroComputation["pendingTies"][number]> = [];

    const byNight: Array<RubroComputation["byNight"][number]> = [];
    let totalSinPenalizaciones = 0;
    for (const night of nights) {
      let nocheValue = 0;
      let omittedItems = 0;
      for (const r of group) {
        if (r.selectionReason === SELECTION_REASON_CANDIDATE_MAX_TIE) {
          if (!pendingTies.some((p) => p.itemId === r.itemId)) {
            pendingTies.push({ itemId: r.itemId, tiedCandidateIds: r.tiedCandidateIds });
          }
          // The item's contribution is undefined (pending): do not count it.
          continue;
        }
        const value = selectedNightValue(r, night.id);
        if (!value) continue;
        nocheValue += value.score;
        if (value.omitted) omittedItems += 1;
      }
      totalSinPenalizaciones += nocheValue;
      byNight.push({ nightId: night.id, nocheValue, omittedItems });
    }

    const penalizacionTotal = penByComparsa.get(comparsaId) ?? 0;

    results.push({
      rubroId,
      comparsaId,
      totalSinPenalizaciones,
      penalizacionTotal,
      total: totalSinPenalizaciones - penalizacionTotal,
      byNight,
      pendingTies,
      hasPendingCandidateTie: pendingTies.length > 0,
    });
  }

  return results;
}
