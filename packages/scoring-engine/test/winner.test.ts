import { describe, expect, it } from "vitest";
import { runScrutinio } from "../src/scrutinio.js";
import {
  buildSnapshot,
  makeCandidate,
  makeComparsas,
  makeItem,
  makeNights,
  makeRubro,
  makeVote,
} from "./helpers.js";

/**
 * Builds a snapshot for one nominativo rubro with a single item, where each
 * comparssa gets one score per night. Returns the snapshot.
 */
function singleRubroMultiComparssa(
  rubro: ReturnType<typeof makeRubro>,
  scores: Record<string, number[]>, // comparsaId -> [n1, n2, n3]
) {
  const item = makeItem(rubro.id, "i1");
  const nights = makeNights();
  const comparsas = makeComparsas(Object.keys(scores));

  const votes = Object.entries(scores).flatMap(([cid, vals]) =>
    vals.map((score, i) =>
      makeVote({
        nightId: nights[i]!.id,
        comparsaId: cid,
        rubroId: rubro.id,
        itemId: "i1",
        candidateId: makeCandidate("i1", cid).id,
        score,
      }),
    ),
  );

  return buildSnapshot({
    comparsas,
    rubros: [rubro],
    items: [item],
    candidates: votes.map((v) => makeCandidate("i1", v.comparsaId)),
    votes,
  });
}

describe("Comparsa Ganadora (rules 15, 9)", () => {
  it("uses only nominativo rubros and sums across the three nights", () => {
    const nominativo = makeRubro("r-nom", "NOMINATIVO");
    const snapshot = singleRubroMultiComparssa(nominativo, {
      c1: [10, 10, 10], // 30
      c2: [5, 5, 5], // 15
    });

    const result = runScrutinio(snapshot, { executedBy: "escribano" });

    expect(result.winnerComparsaId).toBe("c1");
    expect(result.ranking[0]!.totalNominativo).toBe(30);
  });

  it("excludes aleatorio rubros from the Comparsa Ganadora calculation", () => {
    const nominativo = makeRubro("r-nom", "NOMINATIVO");
    const aleatorio = makeRubro("r-ale", "ALEATORIO", "BAILE");

    const nomItem = makeItem("r-nom", "i1");
    const aleItem = makeItem("r-ale", "i1");
    const nights = makeNights();
    const comparsas = makeComparsas(["c1", "c2"]);

    // c1 wins nominativo. c2 crushes the aleatorio rubro massively.
    const votes = [
      ...([10, 9, 8] as const).flatMap((s, i) =>
        makeVote({ nightId: nights[i]!.id, comparsaId: "c1", rubroId: "r-nom", itemId: "i1", candidateId: "k-c1", score: s }),
      ),
      ...([6, 6, 6] as const).flatMap((s, i) =>
        makeVote({ nightId: nights[i]!.id, comparsaId: "c2", rubroId: "r-nom", itemId: "i1", candidateId: "k-c2", score: s }),
      ),
      ...([1, 1, 1] as const).flatMap((s, i) =>
        makeVote({ nightId: nights[i]!.id, comparsaId: "c1", rubroId: "r-ale", itemId: "i1", candidateId: "a-c1", score: s }),
      ),
      ...([10, 10, 10] as const).flatMap((s, i) =>
        makeVote({ nightId: nights[i]!.id, comparsaId: "c2", rubroId: "r-ale", itemId: "i1", candidateId: "a-c2", score: s }),
      ),
    ];

    const snapshot = buildSnapshot({
      comparsas,
      rubros: [nominativo, aleatorio],
      items: [nomItem, aleItem],
      candidates: [],
      votes,
    });

    const result = runScrutinio(snapshot, { executedBy: "escribano" });

    // Winner from nominativo only -> c1, despite c2's aleatorio edge.
    expect(result.winnerComparsaId).toBe("c1");
  });
});

describe("tie-break (rule 16)", () => {
  it("(stage 1) breaks a tie by most nominativo rubros won", () => {
    const r1 = makeRubro("r1", "NOMINATIVO");
    const r2 = makeRubro("r2", "NOMINATIVO");
    const r3 = makeRubro("r3", "NOMINATIVO");
    const nights = makeNights();
    const comparsas = makeComparsas(["c1", "c2"]);

    // Equal total nominativo (60 each) with different count of rubros won:
    //   c1 wins r1 and r2 (2 won), c2 wins r3 (1 won) -> stage 1 picks c1.
    const perNight = (cid: string, rubroId: string, vals: number[]) =>
      vals.map((s, i) => makeVote({ nightId: nights[i]!.id, comparsaId: cid, rubroId, itemId: "i1", candidateId: "k", score: s }));

    const votes = [
      ...perNight("c1", "r1", [10, 10, 10]), // 30, c1 wins
      ...perNight("c2", "r1", [7, 7, 6]), // 20
      ...perNight("c1", "r2", [10, 10, 10]), // 30, c1 wins
      ...perNight("c2", "r2", [7, 7, 6]), // 20
      ...perNight("c1", "r3", [0, 0, 0]), // 0 (no presentado)
      ...perNight("c2", "r3", [7, 7, 6]), // 20, c2 wins
    ];

    const snapshot = buildSnapshot({
      comparsas,
      rubros: [r1, r2, r3],
      items: [makeItem("r1", "i1"), makeItem("r2", "i1"), makeItem("r3", "i1")],
      candidates: [],
      votes,
    });

    const result = runScrutinio(snapshot, { executedBy: "escribano" });

    // c1 total = 30+30+0 = 60, c2 total = 20+20+20 = 60 -> real tie.
    // Rubros won: c1 = 2, c2 = 1 -> stage 1 selects c1.
    expect(result.ranking[0]!.totalNominativo).toBe(60);
    expect(result.ranking[1]!.totalNominativo).toBe(60);
    expect(result.tieBreaks[0]!.stage).toBe(1);
    expect(result.winnerComparsaId).toBe("c1");
  });

  it("(stage 2) breaks a tie by the winner of Mejor Bateria", () => {
    const rBaile = makeRubro("r-baile", "NOMINATIVO", "BAILE");
    const rBateria = makeRubro("r-bateria", "NOMINATIVO", "BATERIA");
    const nights = makeNights();
    const comparsas = makeComparsas(["c1", "c2"]);

    const perNight = (cid: string, rubroId: string, vals: number[]) =>
      vals.map((s, i) => makeVote({ nightId: nights[i]!.id, comparsaId: cid, rubroId, itemId: "i1", candidateId: "k", score: s }));

    const votes = [
      ...perNight("c1", "r-baile", [10, 10, 10]), // 30, c1 wins baile
      ...perNight("c2", "r-baile", [7, 7, 6]), // 20
      ...perNight("c1", "r-bateria", [7, 7, 6]), // 20
      ...perNight("c2", "r-bateria", [10, 10, 10]), // 30, c2 wins bateria
    ];

    const snapshot = buildSnapshot({
      comparsas,
      rubros: [rBaile, rBateria],
      items: [makeItem("r-baile", "i1"), makeItem("r-bateria", "i1")],
      candidates: [],
      votes,
    });

    const result = runScrutinio(snapshot, { executedBy: "escribano" });

    // c1 total = 30+20 = 50, c2 total = 20+30 = 50 -> tie.
    // Rubros won each = 1 -> stage 1 does not resolve; stage 2 (bateria) -> c2.
    expect(result.ranking[0]!.totalNominativo).toBe(50);
    expect(result.ranking[1]!.totalNominativo).toBe(50);
    expect(result.tieBreaks[0]!.stage).toBe(1);
    expect(result.tieBreaks[1]!.stage).toBe(2);
    expect(result.winnerComparsaId).toBe("c2");
  });

  it("(stage 3) reports an unresolved tie as PEND-102 when bateria does not decide", () => {
    const r1 = makeRubro("r1", "NOMINATIVO");
    const nights = makeNights();
    const comparsas = makeComparsas(["c1", "c2"]);

    // Identical scores in the single nominativo rubro -> full tie.
    const votes = [
      ...([9, 9, 9] as const).flatMap((s, i) => makeVote({ nightId: nights[i]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k", score: s })),
      ...([9, 9, 9] as const).flatMap((s, i) => makeVote({ nightId: nights[i]!.id, comparsaId: "c2", rubroId: "r1", itemId: "i1", candidateId: "k", score: s })),
    ];

    const snapshot = buildSnapshot({
      comparsas,
      rubros: [r1],
      items: [makeItem("r1", "i1")],
      candidates: [],
      votes,
    });

    const result = runScrutinio(snapshot, { executedBy: "escribano" });

    expect(result.winnerComparsaId).toBeUndefined();
    const stage3 = result.tieBreaks.find((t) => t.stage === 3);
    expect(stage3).toBeDefined();
    expect(stage3!.detail).toMatchObject({ pending: "PEND-102" });
  });
});

describe("reproducibility (rule 14)", () => {
  it("produces identical results for identical inputs", () => {
    const nominativo = makeRubro("r-nom", "NOMINATIVO");
    const snapshot = singleRubroMultiComparssa(nominativo, {
      c1: [10, 10, 10],
      c2: [5, 5, 5],
    });

    const a = runScrutinio(snapshot, { executedBy: "escribano" });
    const b = runScrutinio(snapshot, { executedBy: "escribano" });

    expect(a.winnerComparsaId).toBe(b.winnerComparsaId);
    expect(a.ranking).toEqual(b.ranking);
    expect(a.rubroResults).toEqual(b.rubroResults);
  });
});
