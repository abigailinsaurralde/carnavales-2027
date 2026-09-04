/**
 * Errors raised by the scoring engine.
 *
 * Per rule 22, the engine must never silently invent business behavior. When a
 * rule required by the calculation is not defined, the engine stops and raises
 * a PendingRuleError identifying the pending decision instead of guessing.
 */

export class ScoringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScoringError";
  }
}

/**
 * Raised when a calculation step depends on a rule that is not defined in the
 * frozen MVP specification (see docs/product/PENDIENTES.md). The engine must
 * stop (rule 22) rather than fabricate a behavior.
 */
export class PendingRuleError extends ScoringError {
  public readonly pendingId: string;

  constructor(pendingId: string, message: string) {
    super(message);
    this.name = "PendingRuleError";
    this.pendingId = pendingId;
  }
}

/** Raised when an input vote violates a frozen invariant. */
export class VoteValidationError extends ScoringError {
  public readonly violations: ReadonlyArray<string>;

  constructor(violations: ReadonlyArray<string>) {
    super(`Invalid votes: ${violations.join(" | ")}`);
    this.name = "VoteValidationError";
    this.violations = violations;
  }
}
