import { describe, expect, it } from "vitest";
import { ApiClient, errorCode } from "../src/api/client.js";

/** Construye un Response del entorno node (Node 18+ expone Response global). */
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeClient(options?: {
  fetchFn?: (url: string, init: RequestInit) => Promise<Response>;
  token?: () => string | null;
}) {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const inner = options?.fetchFn ?? (async () => json(200, {}));
  const fetchFn: (url: string, init: RequestInit) => Promise<Response> = async (url, init) => {
    requests.push({ url, init });
    return inner(url, init);
  };
  const api = new ApiClient({
    baseUrl: "http://test",
    getToken: options?.token ?? (() => "tok-1"),
    timeoutMs: 5000,
    fetchFn,
  });
  return { api, requests };
}

describe("ApiClient", () => {
  it("arma la URL con baseUrl y envía el token de autorización", async () => {
    const { api, requests } = makeClient();
    await api.me();
    expect(requests[0]!.url).toBe("http://test/auth/me");
    expect(requests[0]!.init.headers).toMatchObject({
      authorization: "Bearer tok-1",
      "content-type": "application/json",
    });
  });

  it("normaliza una respuesta 200 JSON como éxito", async () => {
    const { api } = makeClient({
      fetchFn: async () => json(200, { ok: true, value: 42 }),
    });
    const result = await api.me();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ ok: true, value: 42 });
  });

  it("interpreta un 204 como éxito vacío (logout)", async () => {
    const { api } = makeClient({ fetchFn: async () => new Response(null, { status: 204 }) });
    const result = await api.logout();
    expect(result.ok).toBe(true);
  });

  it("convierte un 401 en UNAUTHORIZED preservando el cuerpo de error", async () => {
    const { api } = makeClient({
      fetchFn: async () =>
        json(401, { error: { code: "INVALID_CREDENTIALS", message: "Bad credentials" } }),
    });
    const result = await api.login({ email: "a@b.c", password: "x" });
    expect(result).toMatchObject({
      ok: false,
      kind: "UNAUTHORIZED",
      status: 401,
      body: { error: { code: "INVALID_CREDENTIALS" } },
    });
  });

  it("convierte un 403 en FORBIDDEN", async () => {
    const { api } = makeClient({
      fetchFn: async () => json(403, { error: { code: "FORBIDDEN", message: "No" } }),
    });
    const result = await api.judgeContext();
    expect(result).toMatchObject({ ok: false, kind: "FORBIDDEN", status: 403 });
  });

  it("convierte cualquier otro estado en HTTP con su cuerpo", async () => {
    const body = { error: { code: "PLANILLA_NOT_EDITABLE", message: "X" } };
    const { api } = makeClient({ fetchFn: async () => json(409, body) });
    const result = await api.confirmPlanilla("p-1");
    expect(result).toMatchObject({ ok: false, kind: "HTTP", status: 409, body });
  });

  it("clasifica una excepción de red como NETWORK", async () => {
    const { api } = makeClient({
      fetchFn: async () => {
        throw new TypeError("fetch failed");
      },
    });
    const result = await api.judgeContext();
    expect(result).toMatchObject({ ok: false, kind: "NETWORK" });
  });

  it("clasifica una abort por timeout como TIMEOUT", async () => {
    const { api } = makeClient({
      fetchFn: async () => {
        throw new DOMException("The operation was aborted.", "AbortError");
      },
    });
    const result = await api.judgeContext();
    expect(result).toMatchObject({ ok: false, kind: "TIMEOUT" });
  });

  it("no persiste el token: lo pide en cada llamada vía getToken", async () => {
    let token = "tok-a";
    const { api, requests } = makeClient({
      token: () => token,
      fetchFn: async () => json(200, {}),
    });
    await api.me();
    token = "tok-b";
    await api.me();
    expect(requests[1]!.init.headers).toMatchObject({ authorization: "Bearer tok-b" });
  });
});

describe("errorCode", () => {
  it("lee el código del cuerpo de error estándar", () => {
    expect(errorCode({ error: { code: "NOT_FOUND", message: "x" } })).toBe("NOT_FOUND");
    expect(errorCode({})).toBeUndefined();
    expect(errorCode(null)).toBeUndefined();
  });
});