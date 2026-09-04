import type { Rubro, RubroItem, Vote } from "@votaciones2027/shared-types";
import { CARNAVAL_2027_RULES } from "@votaciones2027/shared-types";

/**
 * Multi-candidate rule (rule 15, definitive): within a nominativo rubro, every
 * candidate of the same comparsa builds its own 3-night TOTAL, and the
 * computable result for that (comparsa, rubro, item) is MAX(TOTAL_CANDIDATO).
 *
 * This is NOT a pending decision anymore: the project defines the rule.
 * Candidates not selected are kept (logically excluded, never deleted) so they
 * remain available for audit (rule 15).
 */
export const SELECTION_REASON_HIGHEST_CANDIDATE_TOTAL = "HIGHEST_CANDIDATE_TOTAL" as const;
/**
 * Raised when two or more candidates of the same (comparsa, rubro, item) reach
 * the SAME maximum total. The frozen reglamento does NOT define how to break
 * this tie, so the engine never converts `candidateId`/alphabetical order into a
 * business rule: the selection result is left explicitly unresolved (pending).
 */
export const SELECTION_REASON_CANDIDATE_MAX_TIE = "CANDIDATE_MAX_TIE" as const;
export type SelectionReason =
  | typeof SELECTION_REASON_HIGHEST_CANDIDATE_TOTAL
  | typeof SELECTION_REASON_CANDIDATE_MAX_TIE;

/**
 * A single scored night for one candidate. Provenance is preserved (rule 7):
 * JUDGE for an actual vote, OMISSION_CORRECTION for a corrected omission (5).
 */
export interface CandidateNightValue {
  nightId: string;
  score: number;
  scoreSource: "JUDGE" | "OMISSION_CORRECTION";
  omitted: boolean;
  /** Reference to the original judge vote backing this value, if any. */
  originalVoteId?: string;
}

/**
 * One candidate's evaluation within a (comparsa, rubro, item): its individual
 * 3-night total and per-night composition. `selected` marks whether it is the
 * candidate whose MAX total determines the computable result.
 */
export interface CandidateEvaluation {
  candidateId: string;
  /** Sum of the 3 nights (rule 9, no discard). */
  total: number;
  byNight: ReadonlyArray<CandidateNightValue>;
  /** Number of nights that were corrected as omissions (score 5). */
  omittedNights: number;
  selected: boolean;
}

/**
 * The auditable result for a (comparsa, rubro, item) cell: which candidate was
 * selected by MAX(TOTAL_CANDIDATO) and all candidates (selected or not).
 *
 * When the maximum total is shared by more than one candidate, `selectedCandidateId`
 * is `undefined`, `selectionReason` is CANDIDATE_MAX_TIE and `tiedCandidateIds`
 * lists the candidates at that maximum: the selection is represented as pending
 * rather than inventing an official tie-break (e.g. alphabetical order).
 */
export interface CandidateResolution {
  comparsaId: string;
  rubroId: string;
  itemId: string;
  selectedCandidateId?: string;
  /** Total of the selected (or tied-maximum) candidate(s). */
  selectedTotal: number;
  selectionReason: SelectionReason;
  /** Candidates sharing the maximum total, only when CANDIDATE_MAX_TIE. */
  tiedCandidateIds: ReadonlyArray<string>;
  candidates: ReadonlyArray<CandidateEvaluation>;
}

export interface CandidateResolutionOutput {
  resolutions: ReadonlyArray<CandidateResolution>;
  /** All per-candidate nights corrected for omission (audit per rule 8). */
  correctedCells: ReadonlyArray<CandidateNightValue>;
}

/** Key correlating votes with their (comparsa, rubro, item) resolution. */
export function candidateResolutionKey(
  comparsaId: string,
  rubroId: string,
  itemId: string,
): string {
  return [comparsaId, rubroId, itemId].join("|");
}

/**
 * Builds the candidate resolutions of an edition, applying rules 7, 8, 9 and the
 * definitive multi-candidate rule (rule 15):
 *
 * - each candidate maps its votes to per-night values;
 * - when a night of a candidate has no score, the omission is corrected with the
 *   frozen omissionScore (5) and source OMISSION_CORRECTION (rule 7, 8);
 * - candidate TOTAL = sum of its 3 nights (rule 9, no discard);
 * - selection = candidate with the highest TOTAL (rule 15). When several
 *   candidates are tied at the maximum, the selection is left explicit as a
 *   CANDIDATE_MAX_TIE (spec-undefined) and never resolved via candidateId or
 *   alphabetical order.
 *
 * The universe of candidates is derived from the votes present per
 * (comparsa, rubro, item). A cell that should have been evaluated but has no
 * candidate votes is represented by a synthetic candidate scored 5 on every
 * night, so an omission still resolves to a computable value.
 */
export function computeCandidateResolutions(
  votes: ReadonlyArray<Vote>,
  nights: ReadonlyArray<{ id: string }>,
  comparsas: ReadonlyArray<{ id: string }>,
  rubros: ReadonlyArray<Rubro>,
  items: ReadonlyArray<RubroItem>,
): CandidateResolutionOutput {
  const { omissionScore } = CARNAVAL_2027_RULES;

  // Index votes by (comparsa, rubro, item).
  const votesByKey = new Map<string, Vote[]>();
  for (const v of votes) {
    const key = candidateResolutionKey(v.comparsaId, v.rubroId, v.itemId);
    const list = votesByKey.get(key);
    if (list) list.push(v);
    else votesByKey.set(key, [v]);
  }

  const itemByRubro = new Map<string, RubroItem[]>();
  for (const it of items) {
    const list = itemByRubro.get(it.rubroId);
    if (list) list.push(it);
    else itemByRubro.set(it.rubroId, [it]);
  }

  const resolutions: CandidateResolution[] = [];
  const correctedCells: CandidateNightValue[] = [];

  const makeOmission = (nightId: string): CandidateNightValue => {
    const corrected: CandidateNightValue = {
      nightId,
      score: omissionScore,
      scoreSource: "OMISSION_CORRECTION",
      omitted: true,
    };
    correctedCells.push(corrected);
    return corrected;
  };

  // Builds the ordered per-night values for one candidate across the edition
  // nights, correcting missing nights as omissions.
  const buildNightValues = (votesForCandidate: ReadonlyArray<Vote>): CandidateNightValue[] => {
    const byNight = new Map<string, Vote>();
    for (const v of votesForCandidate) byNight.set(v.nightId, v);
    const out: CandidateNightValue[] = [];
    for (const night of nights) {
      const v = byNight.get(night.id);
      if (v) {
        out.push({
          nightId: night.id,
          score: v.score,
          scoreSource: "JUDGE",
          omitted: false,
          originalVoteId: v.id,
        });
      } else {
        out.push(makeOmission(night.id));
      }
    }
    return out;
  };

  for (const rubro of rubros) {
    const rubroItems = itemByRubro.get(rubro.id) ?? [];
    if (rubroItems.length === 0) continue;

    for (const it of rubroItems) {
      for (const comparsa of comparsas) {
        const key = candidateResolutionKey(comparsa.id, rubro.id, it.id);
        const cellVotes = votesByKey.get(key) ?? [];

        const candidates: CandidateEvaluation[] = [];

        if (cellVotes.length === 0) {
          // Cell had to be evaluated but shows no score at all: a synthetic
          // candidate scored 5 on every night (rule 7, 8).
          const byNight = nights.map((n) => makeOmission(n.id));
          candidates.push({
            candidateId: "__omission__",
            total: byNight.reduce((a, b) => a + b.score, 0),
            byNight,
            omittedNights: byNight.length,
            selected: true,
          });
        } else {
          const byCandidate = new Map<string, Vote[]>();
          for (const v of cellVotes) {
            const list = byCandidate.get(v.candidateId);
            if (list) list.push(v);
            else byCandidate.set(v.candidateId, [v]);
          }
          for (const [candidateId, cv] of byCandidate) {
            const byNight = buildNightValues(cv);
            candidates.push({
              candidateId,
              total: byNight.reduce((a, b) => a + b.score, 0),
              byNight,
              omittedNights: byNight.filter((v) => v.omitted).length,
              selected: false,
            });
          }
        }

        // Select MAX(TOTAL_CANDIDATO). On a tie at the maximum, do NOT invent
        // an official selection (no candidateId / alphabetical business rule):
        // represent the tie explicitly as pending.
        const maxTotal = Math.max(...candidates.map((c) => c.total));
        const tiedIds = new Set(
          candidates.filter((c) => c.total === maxTotal).map((c) => c.candidateId),
        );
        const hasTie = tiedIds.size > 1;

        let selectedCandidateId: string | undefined;
        for (let i = 0; i < candidates.length; i++) {
          if (tiedIds.has(candidates[i]!.candidateId)) {
            candidates[i] = { ...candidates[i]!, selected: true };
            if (!hasTie) selectedCandidateId = candidates[i]!.candidateId;
          }
        }

        const resolution: CandidateResolution = {
          comparsaId: comparsa.id,
          rubroId: rubro.id,
          itemId: it.id,
          selectedTotal: maxTotal,
          selectionReason: hasTie
            ? SELECTION_REASON_CANDIDATE_MAX_TIE
            : SELECTION_REASON_HIGHEST_CANDIDATE_TOTAL,
          tiedCandidateIds: [...tiedIds].sort(),
          candidates,
        };
        if (selectedCandidateId !== undefined) {
          resolution.selectedCandidateId = selectedCandidateId;
        }
        resolutions.push(resolution);
      }
    }
  }

  return { resolutions, correctedCells };
}