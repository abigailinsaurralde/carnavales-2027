import { describe, expect, it } from "vitest";
import {
  ACCESS_TOKEN_ISSUE,
  JUDGE_ACCESS_TOKEN,
  JUDGE_DNI,
  JUDGE_EMAIL,
  JUDGE_SESSION,
  makeContext,
  NIGHT_ID,
  OPERATOR_EMAIL,
  OPERATOR_PASSWORD,
  OPERATOR_SESSION,
} from "./fixtures.js";
import type {
  ConfirmPlanillaResult,
  JudgeContextResponse,
  Planilla,
  PlanillaSummary,
  SyncPlanillasRequest,
  SyncPlanillasResult,
  Vote,
} from "@votaciones2027/shared-types";
import { ApiClient } from "../src/api/client.js";
import { createSessionStore, type SessionStore } from "../src/api/session.js";
import { JudgeApp } from "../src/app/app.js";
import { systemClock } from "../src/offline/clock.js";
import { createManualConnectivity } from "../src/offline/connectivity.js";
import { MemoryStorage } from "../src/offline/storage.js";
import { OfflineStore } from "../src/offline/store.js";
import { SyncManager, type SyncSnapshot } from "../src/offline/sync-manager.js";
import type { Route, Router } from "../src/ui/router.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface StubServer {
  context: JudgeContextResponse;
  details: Map<string, { planilla: Planilla; votes: Vote[] }>;
  loginFails: boolean;
  issueFails: boolean;
  exchangeFails: boolean;
}

function makeRouter(initial: Route): Router {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    navigate(route) {
      current = route;
      for (const listener of Array.from(listeners)) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function serverFetch(server: StubServer) {
  return async function fetchFn(url: string, init: RequestInit): Promise<Response> {
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    const method = (init.method ?? "GET").toUpperCase();

    if (path === "/auth/login") {
      if (server.loginFails) {
        return json(401, { error: { code: "INVALID_CREDENTIALS", message: "Bad" } });
      }
      return json(200, OPERATOR_SESSION);
    }
    if (path === "/auth/access-token" && method === "POST") {
      if (server.issueFails) {
        return json(401, { error: { code: "INVALID_CREDENTIALS", message: "Bad" } });
      }
      return json(200, ACCESS_TOKEN_ISSUE);
    }
    if (path === "/auth/access-token/login" && method === "POST") {
      if (server.exchangeFails) {
        return json(401, { error: { code: "INVALID_CREDENTIALS", message: "Bad" } });
      }
      return json(200, JUDGE_SESSION);
    }
    if (path === "/auth/logout") return new Response(null, { status: 204 });
    if (path === "/judge/context") return json(200, server.context);

    if (path === "/judge/planillas" && method === "GET") {
      const summaries: PlanillaSummary[] = Array.from(server.details.values()).map((d) => ({
        id: d.planilla.id,
        nightId: d.planilla.nightId,
        nightNumber: 1,
        status: d.planilla.status,
        ...(d.planilla.confirmedAt === undefined ? {} : { confirmedAt: d.planilla.confirmedAt }),
        votesCount: d.votes.length,
        updatedAt: "2027-01-01T00:00:00.000Z",
      }));
      return json(200, summaries);
    }

    if (path === "/judge/planillas/sync" && method === "POST") {
      const request = JSON.parse(String(init.body ?? "{}")) as SyncPlanillasRequest;
      const payload = request.planillas[0]!;
      const existing = server.details.get(payload.planilla.id);
      const planilla: Planilla = {
        id: payload.planilla.id,
        judgeId: "juez-1",
        nightId: payload.planilla.nightId,
        status: (payload.planilla.status as Planilla["status"]) ?? "BORRADOR",
      };
      const votes: Vote[] = payload.votes.map((v) => ({
        id: v.id,
        planillaId: v.planillaId,
        judgeId: "juez-1",
        nightId: payload.planilla.nightId,
        comparsaId: v.comparsaId,
        rubroId: v.rubroId,
        itemId: v.itemId,
        candidateId: v.candidateId,
        score: v.score,
        scoreSource: "JUDGE",
        idempotencyKey: v.idempotencyKey,
        syncState: "SYNCED",
      }));
      server.details.set(payload.planilla.id, { planilla, votes });
      const result: SyncPlanillasResult = {
        planillas: [
          {
            planillaId: payload.planilla.id,
            planillaAction: existing === undefined ? "INSERTED" : "ALREADY_EXISTS",
            votes: votes.map((v) => ({ id: v.id, action: "INSERTED" })),
          },
        ],
        syncedAt: "2027-01-01T00:00:00.000Z",
      };
      return json(200, result);
    }

    const confirm = path.match(/^\/judge\/planillas\/([^/]+)\/confirm$/);
    if (confirm !== null && method === "POST") {
      const id = decodeURIComponent(confirm[1]!);
      const detail = server.details.get(id);
      if (detail === undefined) {
        return json(404, { error: { code: "NOT_FOUND", message: "not found" } });
      }
      const confirmedAt = "2027-01-01T00:00:00.000Z";
      const planilla: Planilla = { ...detail.planilla, status: "CONFIRMADA", confirmedAt };
      const votes = detail.votes.map((v) => ({ ...v, confirmedAt }));
      server.details.set(id, { planilla, votes });
      const result: ConfirmPlanillaResult = {
        planilla,
        votesConfirmed: votes.length,
        omissionsInserted: 0,
        rubroTotals: [],
      };
      return json(200, result);
    }

    const detailMatch = path.match(/^\/judge\/planillas\/([^/]+)$/);
    if (detailMatch !== null) {
      const id = decodeURIComponent(detailMatch[1]!);
      const detail = server.details.get(id);
      if (detail === undefined) {
        return json(404, { error: { code: "NOT_FOUND", message: "not found" } });
      }
      return json(200, { planilla: detail.planilla, votes: detail.votes });
    }

    return json(404, { error: { code: "NOT_FOUND", message: "no route" } });
  };
}

interface Harness {
  app: JudgeApp;
  store: OfflineStore;
  sync: SyncManager;
  connectivity: ReturnType<typeof createManualConnectivity>;
  session: SessionStore;
  kv: MemoryStorage;
  server: StubServer;
  planillaIds: string[];
}

function makeHarness(options?: {
  loginFails?: boolean;
  issueFails?: boolean;
  exchangeFails?: boolean;
  initialOnline?: boolean;
}): Harness {
  const kv = new MemoryStorage();
  const store = new OfflineStore(kv);
  const connectivity = createManualConnectivity(options?.initialOnline ?? true);
  const session = createSessionStore();
  const router = makeRouter({ name: "login" });
  const server: StubServer = {
    context: makeContext(),
    details: new Map(),
    loginFails: options?.loginFails ?? false,
    issueFails: options?.issueFails ?? false,
    exchangeFails: options?.exchangeFails ?? false,
  };

  const api = new ApiClient({
    baseUrl: "http://test",
    getToken: () => session.getToken(),
    fetchFn: serverFetch(server),
  });

  let idCounter = 0;
  const planillaIds: string[] = [];
  const createId = (): string => {
    idCounter += 1;
    const next = `id-${idCounter}`;
    planillaIds.push(next);
    return next;
  };

  // El SyncManager solo acepta el canal por constructor: se enruta un único
  // listener activo (mismo patrón que main.ts) hacia la fachada SyncSource.
  let statusListener: ((snapshot: SyncSnapshot) => void) | undefined;
  const sync = new SyncManager({
    store,
    transport: {
      async syncPlanillas(request) {
        const res = await serverFetch(server)("http://test/judge/planillas/sync", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
        });
        const data = (await res.json()) as SyncPlanillasResult;
        return { ok: true, data };
      },
    },
    connectivity,
    clock: systemClock,
    maxAttempts: 8,
    backoff: { baseMs: 1000, maxMs: 60000, random: () => 0.5 },
    onStatusChange: (snapshot) => statusListener?.(snapshot),
  });

  const app = new JudgeApp({
    api,
    store,
    sync: {
      getSnapshot: () => sync.getSnapshot(),
      whenStatusChanges: (listener) => {
        statusListener = listener;
        return () => {
          if (statusListener === listener) statusListener = undefined;
        };
      },
      syncAllOnce: () => sync.syncAllOnce(),
      enqueuePlanilla: (planilla, votes) => sync.enqueuePlanilla(planilla, votes),
    },
    connectivity,
    session,
    router,
    cache: kv,
    clock: { nowIso: () => systemClock.nowIso() },
    createId,
  });

  // Forzar una emisión para que el estado interno refleje la conectividad
  // inicial (createManualConnectivity solo emite ante cambios).
  const target = options?.initialOnline ?? true;
  connectivity.setOnline(!target);
  connectivity.setOnline(target);

  return { app, store, sync, connectivity, session, kv, server, planillaIds };
}

function flush(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Acceso del juez por SVC2-31: emisión del código + canje por sesión. */
async function loginAsJudge(h: Harness): Promise<void> {
  await h.app.requestAccessToken(JUDGE_EMAIL, JUDGE_DNI);
  await h.app.loginWithAccessToken(JUDGE_EMAIL, JUDGE_DNI, JUDGE_ACCESS_TOKEN);
  await flush();
  await flush(20);
}

/** Crea la primera planilla estando sin conexión (queda pendiente). */
async function createLocalPlanilla(h: Harness): Promise<void> {
  h.connectivity.setOnline(false);
  await h.app.createPlanilla(NIGHT_ID);
  await flush();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("flujo del juez (login → notas → sync → confirmación)", () => {
  it("crea la planilla offline, carga notas, sincroniza y confirma", async () => {
    const h = makeHarness();
    const app = h.app;

    await app.boot();
    expect(app.getState().user).toBeNull();

    await loginAsJudge(h);
    expect(app.getState().user?.role).toBe("JUDGE");
    expect(app.getState().context).not.toBeNull();
    await flush();
    // Una única asignación (noche 1): todavía sin planilla → tarjeta para crear.
    expect(app.getState().planillas).toHaveLength(1);
    expect(app.getState().planillas[0]!.planillaId).toBe("");

    // Sin conexión: crear la planilla queda pendiente (sin drenado automático).
    await createLocalPlanilla(h);
    const planillaId = h.planillaIds[0]!;

    let detail = app.getState().detail;
    expect(detail).not.toBeNull();
    expect(detail?.status).toBe("BORRADOR");
    expect(detail?.canConfirm).toBe(false);

    await app.setScore(
      planillaId,
      { comparsaId: "cmp-1", rubroId: "r-baile", itemId: "i-1" },
      "can-1-1",
      8,
    );
    detail = app.getState().detail;
    expect(detail?.sheet.scoredCount).toBe(1);
    expect(detail?.sheet.omissionsCount).toBe(3);
    expect(detail?.canConfirm).toBe(false);
    expect(
      detail?.blockedReasons.some((r) => r.toLowerCase().includes("sincronizar")),
    ).toBe(true);
    expect(h.store.loadVote(planillaId, "id-2")?.syncState).toBe("PENDING");

    // Reconexión: el drenado sincroniza planilla y nota con el servidor.
    h.connectivity.setOnline(true);
    await h.sync.whenIdle();
    await flush();
    expect(h.store.findOperationByPlanilla(planillaId)?.state).toBe("SYNCED");
    expect(h.store.loadVote(planillaId, "id-2")?.syncState).toBe("SYNCED");

    // Reabrir la planilla desde el servidor habilita la confirmación.
    await app.openPlanilla(planillaId);
    detail = app.getState().detail;
    expect(detail?.canConfirm).toBe(true);

    await app.confirmPlanilla();
    detail = app.getState().detail;
    expect(detail?.status).toBe("CONFIRMADA");
    expect(detail?.canConfirm).toBe(false);
    expect(detail?.sheet.scoredCount).toBe(1);
    expect(app.getState().notice?.tone).toBe("success");

    // Inmutabilidad: un intento de editar la planilla confirmada no cambia nada.
    await app.setScore(
      planillaId,
      { comparsaId: "cmp-1", rubroId: "r-baile", itemId: "i-1" },
      "can-1-1",
      5,
    );
    expect(h.store.loadVote(planillaId, "id-2")?.score).toBe(8);

    await flush();
    await flush(20);
    const card = app.getState().planillas.find((c) => c.planillaId === planillaId);
    expect(card?.status).toBe("CONFIRMADA");
  });

  it("no permite confirmar sin conexión", async () => {
    const h = makeHarness({ initialOnline: false });
    const app = h.app;
    await app.boot();
    await loginAsJudge(h);
    await createLocalPlanilla(h);
    const planillaId = h.planillaIds[0]!;
    await app.setScore(
      planillaId,
      { comparsaId: "cmp-1", rubroId: "r-baile", itemId: "i-1" },
      "can-1-1",
      8,
    );
    const detail = app.getState().detail;
    expect(detail?.canConfirm).toBe(false);
    expect(
      detail?.blockedReasons.some((r) => r.toLowerCase().includes("conexión")),
    ).toBe(true);
  });

  it("canje con código inválido muestra un mensaje accionable", async () => {
    const h = makeHarness({ exchangeFails: true });
    const app = h.app;
    await app.boot();
    await app.requestAccessToken(JUDGE_EMAIL, JUDGE_DNI);
    await app.loginWithAccessToken(JUDGE_EMAIL, JUDGE_DNI, JUDGE_ACCESS_TOKEN);
    expect(app.getState().user).toBeNull();
    expect(app.getState().notice?.tone).toBe("error");
    expect(app.getState().notice?.text).toContain("código");
  });

  it("emisión con datos desconocidos muestra un mensaje accionable", async () => {
    const h = makeHarness({ issueFails: true });
    const app = h.app;
    await app.boot();
    await app.requestAccessToken(JUDGE_EMAIL, JUDGE_DNI);
    expect(app.getState().user).toBeNull();
    expect(app.getState().login.judgeStep).toBe("identify");
    expect(app.getState().notice?.tone).toBe("error");
    expect(app.getState().notice?.text).toContain("juez");
  });

  it("conserva el acceso operativo por contraseña", async () => {
    const h = makeHarness();
    const app = h.app;
    await app.boot();
    await app.login(OPERATOR_EMAIL, OPERATOR_PASSWORD);
    await flush();
    await flush(20);
    expect(app.getState().user?.role).toBe("ESCRIBANO_VEEDOR");
    expect(app.getState().user?.email).toBe(OPERATOR_EMAIL);
  });

  it("fallo del acceso por contraseña mantiene el mensaje de credenciales", async () => {
    const h = makeHarness({ loginFails: true });
    const app = h.app;
    await app.boot();
    await app.login(OPERATOR_EMAIL, OPERATOR_PASSWORD);
    expect(app.getState().user).toBeNull();
    expect(app.getState().notice?.tone).toBe("error");
    expect(app.getState().notice?.text).toContain("incorrectos");
  });

  it("la emisión del código confirma la entrega sin persistir el token plano", async () => {
    const h = makeHarness();
    const app = h.app;
    await app.boot();
    await app.requestAccessToken(JUDGE_EMAIL, JUDGE_DNI);
    const state = app.getState();
    expect(state.login.judgeStep).toBe("awaiting-token");
    expect(state.login.judgeEmail).toBe(JUDGE_EMAIL);
    expect(state.login.judgeDni).toBe(JUDGE_DNI);
    expect(state.notice?.tone).toBe("success");
    expect(state.user).toBeNull();
    expect(h.session.getToken()).toBeNull();
    // El token plano del access token no aparece en la persistencia local.
    const persisted = h.kv.list("").map((k) => h.kv.get(k) ?? "");
    expect(persisted.some((v) => v.includes(JUDGE_ACCESS_TOKEN))).toBe(false);
  });

  it("cachea el contexto y permite reconstruir la hoja sin red", async () => {
    const kv = new MemoryStorage();
    const store = new OfflineStore(kv);
    const connectivity = createManualConnectivity();
    const session = createSessionStore();
    const server: StubServer = {
      context: makeContext(),
      details: new Map(),
      loginFails: false,
      issueFails: false,
      exchangeFails: false,
    };
    const router1 = makeRouter({ name: "login" });
    const api1 = new ApiClient({
      baseUrl: "http://test",
      getToken: () => session.getToken(),
      fetchFn: serverFetch(server),
    });
    const app1 = new JudgeApp({
      api: api1,
      store,
      sync: emptySyncSource(),
      connectivity,
      session,
      router: router1,
      cache: kv,
      clock: { nowIso: () => systemClock.nowIso() },
      createId: () => "id-1",
    });
    await app1.boot();
    await app1.requestAccessToken(JUDGE_EMAIL, JUDGE_DNI);
    await app1.loginWithAccessToken(JUDGE_EMAIL, JUDGE_DNI, JUDGE_ACCESS_TOKEN);
    await flush();
    await flush(20);
    expect(kv.get("cache.context")).toContain("Carnavales Goya");

    // Segunda instancia (recarga) sin red: reconstruye la hoja desde la caché.
    const server2: StubServer = {
      context: makeContext(),
      details: new Map(),
      loginFails: false,
      issueFails: false,
      exchangeFails: false,
    };
    const connectivity2 = createManualConnectivity(false);
    const router2 = makeRouter({ name: "login" });
    const app2 = new JudgeApp({
      api: new ApiClient({
        baseUrl: "http://test",
        getToken: () => null,
        fetchFn: () => Promise.resolve(json(500, {})),
      }),
      store,
      sync: emptySyncSource(),
      connectivity: connectivity2,
      session: createSessionStore(),
      router: router2,
      cache: kv,
      clock: { nowIso: () => systemClock.nowIso() },
      createId: () => "id-1",
    });
    await app2.boot();
    expect(app2.getState().context).not.toBeNull();
    void server2;
  });
});

function emptySyncSource() {
  return {
    getSnapshot: () => ({ online: false, pending: 0, syncing: 0, synced: 0, failed: 0 }),
    whenStatusChanges: () => () => undefined,
    syncAllOnce: async () => ({ attempted: 0, synced: 0, failed: 0, retried: 0 }),
    enqueuePlanilla: async () => {
      throw new Error("not used");
    },
  };
}