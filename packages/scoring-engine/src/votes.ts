import type { Vote } from "@votaciones2027/shared-types";
import {
  CARNAVAL_2027_RULES,
} from "@votaciones2027/shared-types";
import { VoteValidationError } from "./errors.js";

/**
 * Invariants checked over the immutable evidence (VOTO layer) before any
 * calculation runs. These mirror the frozen rules:
 *
 * - score within [0, 10] (rule 7)
 * - a confirmed vote is immutable: it must be unique per
 *   (night, comparsa, rubro, item, candidate) to avoid duplicates (rule 22)
 * - only the configured number of nights participates (rule 2.1 / 23)
 */
export function validateVotes(
  votes: ReadonlyArray<Vote>,
  nightIds: ReadonlyArray<string>,
): void {
  const violations: string[] = [];
  const { scoreMin, scoreMax, votingNights } = CARNAVAL_2027_RULES;

  const allowedNights = new Set(nightIds);
  // nightIds count must equal the frozen votingNights for edition 2027
  if (nightIds.length !== votingNights) {
    violations.push(
      `expected ${votingNights} voting nights, got ${nightIds.length}`,
    );
  }

  for (const v of votes) {
    if (v.score < scoreMin || v.score > scoreMax) {
      violations.push(
        `vote ${v.id} score ${v.score} out of range [${scoreMin},${scoreMax}]`,
      );
    }
    if (!allowedNights.has(v.nightId)) {
      violations.push(`vote ${v.id} references a night outside the edition`);
    }
  }

  // Duplicate detection: same Judge/Night/Comparsa/Rubro/Item/Candidate is a
  // duplicate vote, forbidden by rule 22.
  const seen = new Map<string, Vote>();
  for (const v of votes) {
    const key = [
      v.judgeId,
      v.nightId,
      v.comparsaId,
      v.rubroId,
      v.itemId,
      v.candidateId,
    ].join("|");
    const prev = seen.get(key);
    if (prev) {
      violations.push(
        `duplicate vote for the same cell: ${prev.id} and ${v.id}`,
      );
      continue;
    }
    seen.set(key, v);
  }

  if (violations.length > 0) {
    throw new VoteValidationError(violations);
  }
}
