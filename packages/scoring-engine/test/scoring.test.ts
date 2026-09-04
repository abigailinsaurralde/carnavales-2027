import { describe, expect, it } from "vitest";
import { VoteValidationError } from "../src/index.js";
import { runScrutinio } from "../src/scrutinio.js";
import {
  computeCandidateResolutions,
  SELECTION_REASON_CANDIDATE_MAX_TIE,
  SELECTION_REASON_HIGHEST_CANDIDATE_TOTAL,
} from "../src/omission.js";
import { computeRubroTotals } from "../src/totals.js";
import { CARNAVAL_2027_RULES } from "@votaciones2027/shared-types";
import {
  buildSnapshot,
  makeCandidate,
  makeComparsas,
  makeItem,
  makeNights,
  makePenalty,
  makeRubro,
  makeVote,
} from "./helpers.js";

describe("frozen parameters", () => {
  it("exposes the centralized CARNAVAL_2027_RULES with congealed values", () => {
    expect(CARNAVAL_2027_RULES).toEqual({
      votingNights: 3,
      totalJudges: 9,
      judgesPerNight: 3,
      specialtiesPerNight: ["BAILE", "VESTUARIO", "BATERIA"],
      judgesPerSpecialtyPerNight: 1,
      scoreMin: 0,
      scoreMax: 10,
      omissionScore: 5,
      discardHighest: 0,
      discardLowest: 0,
      randomRubrosCountTowardComparsaWinner: false,
      confirmedVotesMutable: false,
    });
  });
});

function singleRes(votes: Parameters<typeof computeCandidateResolutions>[0]) {
  const rubro = makeRubro("r1", "NOMINATIVO");
  const item = makeItem("r1", "i1");
  const nights = makeNights();
  return computeCandidateResolutions(
    votes,
    nights,
    makeComparsas(["c1"]),
    [rubro],
    [item],
  );
}

describe("omission correction (rules 7 and 8)", () => {
  it("assigns 5 with OMISSION_CORRECTION source when a night is omitted", () => {
    const rubro = makeRubro("r1", "NOMINATIVO");
    const item = makeItem("r1", "i1");
    const nights = makeNights();

    // Vote present in night1, night2 but omitted in night3.
    const votes = [
      makeVote({ nightId: nights[0]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k1", score: 8 }),
      makeVote({ nightId: nights[1]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k1", score: 7 }),
    ];

    const { resolutions, correctedCells } = computeCandidateResolutions(
      votes, nights, makeComparsas(["c1"]), [rubro], [item],
    );

    const candidate = resolutions[0]!.candidates[0]!;
    const night3 = candidate.byNight.find((n) => n.nightId === nights[2]!.id)!;
    expect(night3).toMatchObject({
      score: 5,
      scoreSource: "OMISSION_CORRECTION",
      omitted: true,
    });
    expect(correctedCells).toHaveLength(1);
  });

  it("does not confuse a judge's 5 with an omission-corrected 5", () => {
    const rubro = makeRubro("r1", "NOMINATIVO");
    const item = makeItem("r1", "i1");
    const nights = makeNights();

    const votes = [
      makeVote({ nightId: nights[0]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k1", score: 5 }),
    ];

    const { resolutions } = computeCandidateResolutions(
      votes, nights, makeComparsas(["c1"]), [rubro], [item],
    );

    const candidate = resolutions[0]!.candidates[0]!;
    const judgeNight = candidate.byNight.find((n) => n.nightId === nights[0]!.id)!;
    const omittedNight = candidate.byNight.find((n) => n.nightId === nights[1]!.id)!;

    expect(judgeNight.score).toBe(5);
    expect(judgeNight.scoreSource).toBe("JUDGE");
    expect(judgeNight.omitted).toBe(false);

    expect(omittedNight.score).toBe(5);
    expect(omittedNight.scoreSource).toBe("OMISSION_CORRECTION");
    expect(omittedNight.omitted).toBe(true);
  });
});

describe("multi-candidate rule (rule 15, definitive MAX of candidate totals)", () => {
  it("resolves a single candidate to its own 3-night total", () => {
    const nights = makeNights();
    const votes = [
      makeVote({ nightId: nights[0]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k1", score: 9 }),
      makeVote({ nightId: nights[1]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k1", score: 8 }),
      makeVote({ nightId: nights[2]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k1", score: 7 }),
    ];

    const { resolutions } = singleRes(votes);
    const r = resolutions[0]!;

    expect(r.selectedCandidateId).toBe("k1");
    expect(r.selectedTotal).toBe(24);
    expect(r.selectionReason).toBe(SELECTION_REASON_HIGHEST_CANDIDATE_TOTAL);
    expect(r.candidates).toHaveLength(1);
  });

  it("selects the candidate with the highest 3-night total (27 vs 26)", () => {
    const nights = makeNights();
    const votes = [
      // k1 -> 10+9+8 = 27 ; k2 -> 9+9+8 = 26
      makeVote({ nightId: nights[0]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k1", score: 10 }),
      makeVote({ nightId: nights[1]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k1", score: 9 }),
      makeVote({ nightId: nights[2]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k1", score: 8 }),
      makeVote({ nightId: nights[0]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k2", score: 9 }),
      makeVote({ nightId: nights[1]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k2", score: 9 }),
      makeVote({ nightId: nights[2]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k2", score: 8 }),
    ];

    const { resolutions } = singleRes(votes);
    const r = resolutions[0]!;
    expect(r.selectedCandidateId).toBe("k1");
    expect(r.selectedTotal).toBe(27);
  });

  it("selects the candidate with the highest 3-night total (23 vs 26)", () => {
    const nights = makeNights();
    const votes = [
      // k1 -> 9+8+6 = 23 ; k2 -> 9+9+8 = 26
      makeVote({ nightId: nights[0]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k1", score: 9 }),
      makeVote({ nightId: nights[1]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k1", score: 8 }),
      makeVote({ nightId: nights[2]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k1", score: 6 }),
      makeVote({ nightId: nights[0]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k2", score: 9 }),
      makeVote({ nightId: nights[1]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k2", score: 9 }),
      makeVote({ nightId: nights[2]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k2", score: 8 }),
    ];

    const { resolutions } = singleRes(votes);
    const r = resolutions[0]!;
    expect(r.selectedCandidateId).toBe("k2");
    expect(r.selectedTotal).toBe(26);
  });

  it("keeps non-selected candidates auditable (never deleted)", () => {
    const nights = makeNights();
    const votes = [
      makeVote({ nightId: nights[0]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k1", score: 10 }),
      makeVote({ nightId: nights[1]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k1", score: 9 }),
      makeVote({ nightId: nights[2]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k1", score: 8 }),
      makeVote({ nightId: nights[0]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k2", score: 5 }),
      makeVote({ nightId: nights[1]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k2", score: 5 }),
      makeVote({ nightId: nights[2]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k2", score: 5 }),
    ];

    const { resolutions } = singleRes(votes);
    const r = resolutions[0]!;

    expect(r.candidates).toHaveLength(2);
    const selected = r.candidates.find((c) => c.selected)!;
    const unselected = r.candidates.find((c) => !c.selected)!;
    expect(selected.candidateId).toBe("k1");
    expect(selected.total).toBe(27);
    expect(unselected.candidateId).toBe("k2");
    expect(unselected.total).toBe(15);
    expect(unselected.byNight).toHaveLength(3);
  });

  it("does not sum both candidates: singles out the max total (27 not 53)", () => {
    const nights = makeNights();
    const votes = [
      makeVote({ nightId: nights[0]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k1", score: 10 }),
      makeVote({ nightId: nights[1]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k1", score: 9 }),
      makeVote({ nightId: nights[2]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k1", score: 8 }),
      makeVote({ nightId: nights[0]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k2", score: 9 }),
      makeVote({ nightId: nights[1]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k2", score: 9 }),
      makeVote({ nightId: nights[2]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k2", score: 8 }),
    ];

    const { resolutions } = singleRes(votes);
    const totals = computeRubroTotals(resolutions, makeNights(), []);

    expect(resolutions[0]!.selectedTotal).toBe(27);
    expect(totals[0]!.totalSinPenalizaciones).toBe(27);
  });

  it("applies MAX over the 3-night TOTAL, not over individual nights", () => {
    // A = [10,6,6] -> total 22 ; B = [8,8,8] -> total 24.
    // Individual-night MAX would wrongly pick A (10); the rule requires B (24).
    const nights = makeNights();
    const votes = [
      makeVote({ nightId: nights[0]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "A", score: 10 }),
      makeVote({ nightId: nights[1]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "A", score: 6 }),
      makeVote({ nightId: nights[2]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "A", score: 6 }),
      makeVote({ nightId: nights[0]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "B", score: 8 }),
      makeVote({ nightId: nights[1]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "B", score: 8 }),
      makeVote({ nightId: nights[2]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "B", score: 8 }),
    ];

    const { resolutions } = singleRes(votes);
    const r = resolutions[0]!;

    expect(r.candidates).toHaveLength(2);
    expect(r.selectedCandidateId).toBe("B");
    expect(r.selectedTotal).toBe(24);
  });

  it("represents a tie on the maximum as pending (no candidateId business rule)", () => {
    const nights = makeNights();
    // Both candidates total 24. The reglamento does not define the tie-break,
    // so the engine must NOT pick one via candidateId/alphabetical order.
    const votes = [
      makeVote({ nightId: nights[0]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "A", score: 8 }),
      makeVote({ nightId: nights[1]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "A", score: 8 }),
      makeVote({ nightId: nights[2]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "A", score: 8 }),
      makeVote({ nightId: nights[0]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "B", score: 8 }),
      makeVote({ nightId: nights[1]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "B", score: 8 }),
      makeVote({ nightId: nights[2]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "B", score: 8 }),
    ];

    const { resolutions } = singleRes(votes);
    const r = resolutions[0]!;

    // The distinction is explicit: no official candidate is selected.
    expect(r.selectionReason).toBe(SELECTION_REASON_CANDIDATE_MAX_TIE);
    expect(r.selectedCandidateId).toBeUndefined();
    expect(r.tiedCandidateIds).toEqual(["A", "B"]);
    expect(r.selectedTotal).toBe(24);
    // Both tied candidates are flagged selected=true (they share the max);
    // both remain auditable.
    expect(r.candidates).toHaveLength(2);
    expect(r.candidates.every((c) => c.selected)).toBe(true);

    // The rubro total reflects the pending tie (item not counted).
    const totals = computeRubroTotals(resolutions, makeNights(), []);
    expect(totals[0]!.hasPendingCandidateTie).toBe(true);
    expect(totals[0]!.pendingTies[0]).toEqual({
      itemId: "i1",
      tiedCandidateIds: ["A", "B"],
    });
  });
});

describe("rubro totals (rule 9, no discard)", () => {
  it("sums the three nights without discarding extremes", () => {
    const rubro = makeRubro("r1", "NOMINATIVO");
    const item = makeItem("r1", "i1");
    const nights = makeNights();

    // extreme values to prove no discard: a 2 (min) and a 10 (max) both count.
    const votes = [
      makeVote({ nightId: nights[0]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k1", score: 2 }),
      makeVote({ nightId: nights[1]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k1", score: 10 }),
      makeVote({ nightId: nights[2]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k1", score: 7 }),
    ];

    const { resolutions } = computeCandidateResolutions(
      votes, nights, makeComparsas(["c1"]), [rubro], [item],
    );
    const totals = computeRubroTotals(resolutions, nights, []);
    const t = totals[0]!;

    expect(t.totalSinPenalizaciones).toBe(2 + 10 + 7);
    expect(t.byNight).toHaveLength(3);
  });

  it("never modifies the original judge votes", () => {
    const rubro = makeRubro("r1", "NOMINATIVO");
    const item = makeItem("r1", "i1");
    const nights = makeNights();
    const votes = [
      makeVote({ nightId: nights[0]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k1", score: 8 }),
      makeVote({ nightId: nights[1]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k1", score: 9 }),
      makeVote({ nightId: nights[2]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k1", score: 10 }),
    ];
    const before = votes.map((v) => ({ ...v }));

    const { resolutions } = computeCandidateResolutions(
      votes, nights, makeComparsas(["c1"]), [rubro], [item],
    );
    computeRubroTotals(resolutions, nights, []);

    expect(votes.map((v) => ({ ...v }))).toEqual(before);
  });
});

describe("penalizaciones (rule 13)", () => {
  function runWithPenalty(penalty: ReturnType<typeof makePenalty>) {
    const rubro = makeRubro("r1", "NOMINATIVO");
    const item = makeItem("r1", "i1");
    const nights = makeNights();
    const votes = [
      makeVote({ nightId: nights[0]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k1", score: 8 }),
      makeVote({ nightId: nights[1]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k1", score: 8 }),
      makeVote({ nightId: nights[2]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k1", score: 8 }),
    ];
    const { resolutions } = computeCandidateResolutions(
      votes, nights, makeComparsas(["c1"]), [rubro], [item],
    );
    return { totals: computeRubroTotals(resolutions, nights, [penalty]), expectedBase: 24 };
  }

  it("deducts approved penalties without altering the original note", () => {
    const { totals } = runWithPenalty(makePenalty("c1", 0.5));
    const t = totals[0]!;
    expect(t.totalSinPenalizaciones).toBe(24);
    expect(t.penalizacionTotal).toBe(0.5);
    expect(t.total).toBeCloseTo(23.5);
  });

  it("ignores non-approved penalties", () => {
    const { totals } = runWithPenalty(makePenalty("c1", 0.5, "PENDIENTE_APROBACION"));
    expect(totals[0]!.penalizacionTotal).toBe(0);
  });
});

describe("vote validation (rules 7, 22)", () => {
  it("accepts notes on the valid 0..10 scale without error", () => {
    const nights = makeNights();
    const votes = [
      makeVote({ nightId: nights[0]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k1", score: 0 }), // no presentado
      makeVote({ nightId: nights[1]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k1", score: 5 }),
      makeVote({ nightId: nights[2]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k1", score: 10 }),
    ];
    const { resolutions } = singleRes(votes);
    expect(resolutions).toHaveLength(1);
  });

  it("rejects scores outside 0..10", () => {
    const snapshot = buildSnapshot({});
    const nights = makeNights();
    const bad = makeVote({ nightId: nights[0]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k1", score: 11 });
    snapshot.votes = [bad];
    expect(() => runScrutinio(snapshot, { executedBy: "admin" })).toThrow(VoteValidationError);
  });

  it("rejects duplicate votes for the same evaluation cell", () => {
    const snapshot = buildSnapshot({});
    const nights = makeNights();
    const v1 = makeVote({ nightId: nights[0]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k1", score: 7, id: "a" });
    const v2 = makeVote({ nightId: nights[0]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k1", score: 9, id: "b" });
    snapshot.votes = [v1, v2];
    expect(() => runScrutinio(snapshot, { executedBy: "admin" })).toThrow(VoteValidationError);
  });

  it("rejects editions that do not have exactly the frozen night count", () => {
    const snapshot = buildSnapshot({ nights: makeNights(4) as unknown as ReturnType<typeof makeNights> });
    expect(() => runScrutinio(snapshot, { executedBy: "admin" })).toThrow(VoteValidationError);
  });

  it("rejects editions with fewer than the frozen three nights", () => {
    const snapshot = buildSnapshot({ nights: makeNights(2) as unknown as ReturnType<typeof makeNights> });
    expect(() => runScrutinio(snapshot, { executedBy: "admin" })).toThrow(VoteValidationError);
  });
});

describe("multi-candidate Comparsa Ganadora integration (rule 15)", () => {
  it("uses the winning candidate's total to rank comparsas", () => {
    const rubro = makeRubro("r-nom", "NOMINATIVO");
    const item = makeItem("r-nom", "i1");
    const nights = makeNights();
    const comparsas = makeComparsas(["c1", "c2"]);

    // c1 has two candidates: A=22, B=24 -> computable 24.
    // c2 has one candidate totalling 23.
    const votes = [
      makeVote({ nightId: nights[0]!.id, comparsaId: "c1", rubroId: "r-nom", itemId: "i1", candidateId: "A", score: 10 }),
      makeVote({ nightId: nights[1]!.id, comparsaId: "c1", rubroId: "r-nom", itemId: "i1", candidateId: "A", score: 6 }),
      makeVote({ nightId: nights[2]!.id, comparsaId: "c1", rubroId: "r-nom", itemId: "i1", candidateId: "A", score: 6 }),
      makeVote({ nightId: nights[0]!.id, comparsaId: "c1", rubroId: "r-nom", itemId: "i1", candidateId: "B", score: 8 }),
      makeVote({ nightId: nights[1]!.id, comparsaId: "c1", rubroId: "r-nom", itemId: "i1", candidateId: "B", score: 8 }),
      makeVote({ nightId: nights[2]!.id, comparsaId: "c1", rubroId: "r-nom", itemId: "i1", candidateId: "B", score: 8 }),
      makeVote({ nightId: nights[0]!.id, comparsaId: "c2", rubroId: "r-nom", itemId: "i1", candidateId: "C", score: 8 }),
      makeVote({ nightId: nights[1]!.id, comparsaId: "c2", rubroId: "r-nom", itemId: "i1", candidateId: "C", score: 8 }),
      makeVote({ nightId: nights[2]!.id, comparsaId: "c2", rubroId: "r-nom", itemId: "i1", candidateId: "C", score: 7 }),
    ];

    const snapshot = buildSnapshot({
      comparsas,
      rubros: [rubro],
      items: [item],
      candidates: [
        makeCandidate("i1", "c1", "A"),
        makeCandidate("i1", "c1", "B"),
        makeCandidate("i1", "c2", "C"),
      ],
      votes,
    });

    const result = runScrutinio(snapshot, { executedBy: "escribano" });

    expect(result.winnerComparsaId).toBe("c1");
    expect(result.ranking[0]!.totalNominativo).toBe(24);

    const res = result.candidateResolutions.find((r) => r.comparsaId === "c1")!;
    expect(res.selectedCandidateId).toBe("B");
    expect(res.candidates).toHaveLength(2);
    expect(res.candidates.find((c) => c.candidateId === "A")!.selected).toBe(false);
  });

  it("accepts multi-candidate rubros without raising a pending rule", () => {
    const nights = makeNights();
    const votes = [
      makeVote({ nightId: nights[0]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k1", score: 8 }),
      makeVote({ nightId: nights[0]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k2", score: 6 }),
      makeVote({ nightId: nights[1]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k1", score: 8 }),
      makeVote({ nightId: nights[1]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k2", score: 6 }),
      makeVote({ nightId: nights[2]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k1", score: 8 }),
      makeVote({ nightId: nights[2]!.id, comparsaId: "c1", rubroId: "r1", itemId: "i1", candidateId: "k2", score: 6 }),
    ];

    const { resolutions } = singleRes(votes);
    const runs = computeCandidateResolutions(
      votes, makeNights(), makeComparsas(["c1"]), [makeRubro("r1", "NOMINATIVO")], [makeItem("r1", "i1")],
    );
    expect(runs.resolutions).toHaveLength(1);
    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]!.selectedCandidateId).toBe("k1");
  });
});
