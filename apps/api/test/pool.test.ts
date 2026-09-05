import { afterEach, describe, expect, it, vi } from "vitest";
import { createPool } from "../src/db/pool.js";
import { DatabaseError } from "../src/errors/app-error.js";

// Mock del módulo `pg` para ejercitar el ciclo transaccional (BEGIN/COMMIT/
// ROLLBACK) de createPool.withTransaction sin una conexión real.
const pgMock = vi.hoisted(() => {
  class MockPool {
    on(): this {
      return this;
    }
    async connect(): Promise<unknown> {
      throw new Error("connect not mocked in this test");
    }
    async query(): Promise<unknown> {
      throw new Error("pool query not mocked in this test");
    }
    async end(): Promise<void> {}
  }
  return { MockPool };
});

vi.mock("pg", () => ({
  default: { Pool: pgMock.MockPool },
  Pool: pgMock.MockPool,
}));

interface MockClient {
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
}

function makeDb(client: MockClient) {
  vi.spyOn(pgMock.MockPool.prototype, "connect").mockImplementation(
    async () => client as never,
  );
  return createPool("postgresql://mock@localhost/mock");
}

function queryTexts(client: MockClient): string[] {
  return client.query.mock.calls.map((call: unknown[]) => String(call[0]));
}

describe("createPool.withTransaction", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ejecuta fn y confirma con COMMIT, liberando el cliente dedicado", async () => {
    const client: MockClient = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
    const db = makeDb(client);

    const result = await db.withTransaction(async (tx) => {
      await tx.query("SELECT 1");
      return "ok";
    });

    expect(result).toBe("ok");
    expect(queryTexts(client)).toEqual(["BEGIN", "SELECT 1", "COMMIT"]);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("aborta con ROLLBACK (sin COMMIT) y propaga intacto un error de negocio", async () => {
    const client: MockClient = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
    const db = makeDb(client);

    class BusinessError extends Error {}
    const error = new BusinessError("boom");

    await expect(db.withTransaction(() => Promise.reject(error))).rejects.toBe(error);

    const texts = queryTexts(client);
    expect(texts[0]).toBe("BEGIN");
    expect(texts).toContain("ROLLBACK");
    expect(texts).not.toContain("COMMIT");
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("envuelve errores de query en DatabaseError y ejecuta ROLLBACK", async () => {
    const client: MockClient = {
      query: vi.fn((text: string) => {
        if (text === "BEGIN" || text === "ROLLBACK") return Promise.resolve({ rows: [] });
        return Promise.reject(new Error("boom on select"));
      }),
      release: vi.fn(),
    };
    const db = makeDb(client);

    await expect(
      db.withTransaction(async (tx) => {
        await tx.query("SELECT boom");
      }),
    ).rejects.toBeInstanceOf(DatabaseError);

    const texts = queryTexts(client);
    expect(texts).toContain("ROLLBACK");
    expect(texts).not.toContain("COMMIT");
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("conserva el SQLSTATE (pgCode) al envolver errores de query", async () => {
    // RESUMEN: el pool envuelve los errores de pg en DatabaseError; si el
    // SQLSTATE (p. ej. 23505 por violación de unicidad) se perdiera, los
    // repositorios no podrían mapear el conflicto a 409. Regresión del gap.
    const pgLikeError = Object.assign(new Error("duplicate key value"), {
      code: "23505",
    });
    vi.spyOn(pgMock.MockPool.prototype, "query").mockRejectedValueOnce(pgLikeError);
    const db = createPool("postgresql://mock@localhost/mock");

    await expect(
      db.query("INSERT INTO x VALUES ($1)", ["1"]),
    ).rejects.toMatchObject({ pgCode: "23505" });
  });
});