import { describe, it, expect } from "vitest";
import { AppError, NotFoundError, ValidationError, DatabaseError } from "../src/errors/app-error.js";

describe("AppError", () => {
  it("has default status 500", () => {
    const err = new AppError("something");
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe("INTERNAL_ERROR");
    expect(err.message).toBe("something");
    expect(err.name).toBe("AppError");
  });

  it("accepts custom status and code", () => {
    const err = new AppError("custom", 422, "UNPROCESSABLE");
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe("UNPROCESSABLE");
  });
});

describe("NotFoundError", () => {
  it("returns 404 with resource name", () => {
    const err = new NotFoundError("Vote");
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toBe("Vote not found");
  });
});

describe("ValidationError", () => {
  it("returns 400", () => {
    const err = new ValidationError("bad input");
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe("VALIDATION_ERROR");
  });
});

describe("DatabaseError", () => {
  it("returns 500", () => {
    const err = new DatabaseError("connection refused");
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe("DATABASE_ERROR");
  });

  it("carries the pgCode and the constraint name when provided", () => {
    const err = new DatabaseError("duplicate key", "23505", "uq_vote_idempotency_per_judge");
    expect(err.pgCode).toBe("23505");
    expect(err.constraint).toBe("uq_vote_idempotency_per_judge");
    expect(err.internalMessage).toBe("duplicate key");
  });
});
