import { describe, it, expect } from "vitest";
import type { DbPool } from "../src/db/pool.js";
import { PostgresEditionRepository } from "../src/infrastructure/repositories/postgres-edition-repository.js";
import { PostgresNightRepository } from "../src/infrastructure/repositories/postgres-night-repository.js";
import { PostgresConfigurationRepository } from "../src/infrastructure/repositories/postgres-configuration-repository.js";

function fakeDb(rows: unknown[]): DbPool & { captured: { text: string; params: unknown[] }[] } {
  const captured: { text: string; params: unknown[] }[] = [];
  const db = {
    async query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }> {
      captured.push({ text, params: params ?? [] });
      return { rows: rows as T[] };
    },
    async end() {},
  };
  return Object.assign(db, { captured });
}

describe("PostgresEditionRepository", () => {
  it("returns null when no row found", async () => {
    const db = fakeDb([]);
    const repo = new PostgresEditionRepository(db);
    await expect(repo.findById("e1")).resolves.toBeNull();
    expect(db.captured[0]?.text).toContain("FROM carnaval_edition");
    expect(db.captured[0]?.params).toEqual(["e1"]);
  });

  it("maps a row to domain entity", async () => {
    const db = fakeDb([
      {
        id: "e1",
        code: "2027",
        name: "Carnavales Goya 2027",
        voting_nights: 3,
        starts_on: null,
        ends_on: null,
      },
    ]);
    const repo = new PostgresEditionRepository(db);
    const result = await repo.findById("e1");
    expect(result).toEqual({
      id: "e1",
      code: "2027",
      name: "Carnavales Goya 2027",
      votingNights: 3,
    });
  });
});

describe("PostgresNightRepository", () => {
  it("returns nights ordered by number", async () => {
    const db = fakeDb([
      { id: "n2", edition_id: "e1", number: 2, date: null, status: "ABIERTA" },
      { id: "n1", edition_id: "e1", number: 1, date: null, status: "PLANIFICADA" },
    ]);
    const repo = new PostgresNightRepository(db);
    const result = await repo.findByEdition("e1");
    expect(result).toHaveLength(2);
    expect(db.captured[0]?.text).toContain("ORDER BY number");
    expect(db.captured[0]?.params).toEqual(["e1"]);
  });
});

describe("PostgresConfigurationRepository", () => {
  it("returns latest configuration version", async () => {
    const db = fakeDb([
      {
        id: "c1",
        edition_id: "e1",
        version: 2,
        status: "CONGELADA",
        frozen_at: "2027-01-01T00:00:00.000Z",
        frozen_by: "u1",
        rules_ref: "CARNAVAL_2027_RULES",
        content_ref: "ref-2",
      },
    ]);
    const repo = new PostgresConfigurationRepository(db);
    const result = await repo.findLatestByEdition("e1");
    expect(result?.version).toBe(2);
    expect(result?.status).toBe("CONGELADA");
    expect(db.captured[0]?.text).toContain("LIMIT 1");
    expect(db.captured[0]?.params).toEqual(["e1"]);
  });

  it("returns null when no config found", async () => {
    const db = fakeDb([]);
    const repo = new PostgresConfigurationRepository(db);
    await expect(repo.findLatestByEdition("e1")).resolves.toBeNull();
  });
});
