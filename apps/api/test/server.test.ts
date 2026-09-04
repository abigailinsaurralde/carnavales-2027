import { describe, it, expect, afterAll } from "vitest";
import { createApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import type { DbPool } from "../src/db/pool.js";

function mockDb(): DbPool {
  const query = async () =>
    ({ rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] }) as never;
  return {
    query,
    withTransaction: (fn) => fn({ query }),
    async end() {},
  };
}

function getConfig() {
  return loadConfig({ databaseUrl: "postgresql://mock@localhost/mock" });
}

function fetchJson(
  server: import("node:http").Server,
  path: string,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const port = (server.address() as import("net").AddressInfo).port;
    const req = import("node:http").then((http) =>
      http.get(`http://127.0.0.1:${port}${path}`, (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk.toString()));
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) });
        });
      }),
    );
    req.catch(reject);
  });
}

describe("server", () => {
  let app: ReturnType<typeof createApp>;

  afterAll(async () => {
    await app?.close();
  });

  it("health check returns 200", async () => {
    app = createApp(getConfig(), mockDb());
    await new Promise<void>((resolve) => app.server.listen(0, resolve));

    const { status, body } = await fetchJson(app.server, "/health");
    expect(status).toBe(200);
    expect(body).toHaveProperty("status", "ok");
  });

  it("unknown route returns 404", async () => {
    app = createApp(getConfig(), mockDb());
    await new Promise<void>((resolve) => app.server.listen(0, resolve));

    const { status, body } = await fetchJson(app.server, "/nonexistent");
    expect(status).toBe(404);
    expect(body).toHaveProperty("error");
  });
});
