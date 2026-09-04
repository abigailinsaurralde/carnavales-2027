import type { Rubro } from "@votaciones2027/shared-types";
import type { RubroComputation } from "./totals.js";

/**
 * The winner of a single rubro (rule 5.1/5.2): the comparssa with the highest
 * computable total. All comparssas tied at the maximum are returned.
 */
export interface RubroWinner {
  rubroId: string;
  rubroType: Rubro["type"];
  winnerComparsaIds: ReadonlyArray<string>;
}

/**
 * Determines the winner (or winners in case of a tied maximum) of each rubro.
 * Independently of the rubro type, a winner exists so that rule 5.2 (rubros
 * aleatorios keep an individual winner) is honored.
 */
export function determineRubroWinners(
  rubros: ReadonlyArray<Rubro>,
  computations: ReadonlyArray<RubroComputation>,
): ReadonlyArray<RubroWinner> {
  const byRubro = new Map<string, Rubro>();
  for (const r of rubros) byRubro.set(r.id, r);

  const byRubroComp = new Map<string, RubroComputation[]>();
  for (const c of computations) {
    const list = byRubroComp.get(c.rubroId);
    if (list) list.push(c);
    else byRubroComp.set(c.rubroId, [c]);
  }

  const result: RubroWinner[] = [];
  for (const rubro of rubros) {
    const comps = byRubroComp.get(rubro.id) ?? [];
    if (comps.length === 0) continue;
    const maxTotal = Math.max(...comps.map((c) => c.total));
    result.push({
      rubroId: rubro.id,
      rubroType: rubro.type,
      winnerComparsaIds: comps
        .filter((c) => c.total === maxTotal)
        .map((c) => c.comparsaId),
    });
  }
  return result;
}
