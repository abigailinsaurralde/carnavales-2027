import { describe, it, expect, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { createApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import type { DbPool } from "../src/db/pool.js";

type RowsByQuery = () => unknown[];

function mockDb(rows: RowsByQuery): DbPool {
  const query = async <T>() => ({ rows: rows() as T[] }) as never;
  return {
    query,
    withTransaction: (fn) => fn({ query }),
    async end() {},
  };
}

async function fetchJson(
  server: Server,
  path: string,
): Promise<{ status: number; body: unknown }> {
  const port = (server.address() as import("net").AddressInfo).port;
  return new Promise((resolve, reject) => {
    void import("node:http").then((http) => {
      http.get(`http://127.0.0.1:${port}${path}`, (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk.toString()));
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(data || "{}") });
        });
      }).on("error", reject);
    });
  });
}

describe("resource routes", () => {
  let apps: ReturnType<typeof createApp>[] = [];

  afterAll(async () => {
    for (const app of apps) await app.close();
  });

  async function start(rows: RowsByQuery): Promise<ReturnType<typeof createApp>> {
    const app = createApp(
      loadConfig({ databaseUrl: "postgresql://mock@localhost/mock" }),
      mockDb(rows),
    );
    apps.push(app);
    await new Promise<void>((resolve) => app.server.listen(0, resolve));
    return app;
  }

  it("GET /editions/:id returns edition", async () => {
    const app = await start(() => [
      { id: "11111111-1111-4111-8111-111111111111", code: "2027", name: "Carnavales Goya 2027", voting_nights: 3, starts_on: null, ends_on: null },
    ]);
    const { status, body } = await fetchJson(app.server, "/editions/11111111-1111-4111-8111-111111111111");
    expect(status).toBe(200);
    expect(body).toMatchObject({ id: "11111111-1111-4111-8111-111111111111", code: "2027" });
  });

  it("GET /editions/:id returns 404 when not found", async () => {
    const app = await start(() => []);
    const { status, body } = await fetchJson(app.server, "/editions/22222222-2222-4222-8222-222222222222");
    expect(status).toBe(404);
    expect(body).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it("GET /nights/:id returns night", async () => {
    const app = await start(() => [
      { id: "33333333-3333-4333-8333-333333333333", edition_id: "11111111-1111-4111-8111-111111111111", number: 1, date: null, status: "ABIERTA" },
    ]);
    const { status, body } = await fetchJson(app.server, "/nights/33333333-3333-4333-8333-333333333333");
    expect(status).toBe(200);
    expect(body).toMatchObject({ id: "33333333-3333-4333-8333-333333333333", number: 1, status: "ABIERTA" });
  });

  it("GET /editions/:id/configuration returns config", async () => {
    const app = await start(() => [
      { id: "44444444-4444-4444-8444-444444444444", edition_id: "11111111-1111-4111-8111-111111111111", version: 1, status: "BORRADOR", frozen_at: null, frozen_by: null, rules_ref: "CARNAVAL_2027_RULES", content_ref: "ref-1" },
    ]);
    const { status, body } = await fetchJson(app.server, "/editions/11111111-1111-4111-8111-111111111111/configuration");
    expect(status).toBe(200);
    expect(body).toMatchObject({ id: "44444444-4444-4444-8444-444444444444", version: 1, rulesRef: "CARNAVAL_2027_RULES" });
  });
});
