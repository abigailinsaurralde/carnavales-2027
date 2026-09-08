import { describe, expect, it } from "vitest";
import type {
  AdminContextResponse,
  AuthSession,
  Candidate,
  Comparsa,
  JudgeAssignmentView,
  Night,
  NightUpdateInput,
  Rubro,
  RubroItem,
  Specialty,
} from "@votaciones2027/shared-types";
import {
  ACCESS_TOKEN_ISSUE,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  ADMIN_SESSION,
  EDITION_ID,
  JUDGE_ACCESS_TOKEN,
  JUDGE_DNI,
  JUDGE_EMAIL,
  JUDGE_SESSION,
  makeContext,
  NIGHT_ID,
  OPERATOR_SESSION,
} from "./fixtures.js";
import { ApiClient } from "../src/api/client.js";
import { createSessionStore, type SessionStore } from "../src/api/session.js";
import { JudgeApp } from "../src/app/app.js";
import { systemClock } from "../src/offline/clock.js";
import { createManualConnectivity } from "../src/offline/connectivity.js";
import { MemoryStorage } from "../src/offline/storage.js";
import { OfflineStore } from "../src/offline/store.js";
import type { Route, Router } from "../src/ui/router.js";

// ---------------------------------------------------------------------------
// Harness: servidor stub de la consola de administración (/admin/*)
// ---------------------------------------------------------------------------

interface AdminServer {
  loginSession: AuthSession;
  comparsas: Comparsa[];
  rubros: Rubro[];
  itemsByRubro: Record<string, RubroItem[]>;
  candidates: Candidate[];
  assignments: JudgeAssignmentView[];
  nights: Night[];
  conflictOn: boolean;
  rejectAdminAuth: boolean;
  calls: Array<{ method: string; path: string; body?: unknown }>;
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

function applyNightPatch(night: Night, input: NightUpdateInput): Partial<Night> {
  const patch: Record<string, string | undefined> = {};
  for (const key of ["date", "startsAt", "endsAt"] as const) {
    const value = input[key];
    if (value === undefined) continue;
    patch[key] = value === null ? undefined : value;
  }
  return patch;
}

function adminContext(server: AdminServer): AdminContextResponse {
  const itemCount = Object.values(server.itemsByRubro).reduce(
    (n, list) => n + list.length,
    0,
  );
  return {
    edition: { id: EDITION_ID, code: "CAR2027", name: "Carnavales Goya", votingNights: 2 },
    nights: server.nights,
    specialties: [
      { id: "sp-baile", code: "BAILE" },
      { id: "sp-vestuario", code: "VESTUARIO" },
      { id: "sp-bateria", code: "BATERIA" },
    ],
    judges: [
      { id: "juez-1", email: JUDGE_EMAIL, displayName: "Juez de Baile", role: "JUDGE" },
    ],
    counts: {
      comparsas: server.comparsas.length,
      rubros: server.rubros.length,
      items: itemCount,
      candidates: server.candidates.length,
      assignments: server.assignments.length,
    },
  };
}

function adminFetch(server: AdminServer) {
  return async function fetchFn(url: string, init: RequestInit): Promise<Response> {
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    const method = (init.method ?? "GET").toUpperCase();
    let body: unknown;
    try {
      body = init.body === undefined ? undefined : JSON.parse(String(init.body));
    } catch {
      body = init.body;
    }
    server.calls.push({ method, path, ...(body === undefined ? {} : { body }) });

    if (path === "/auth/login" && method === "POST") return json(200, server.loginSession);
    if (path === "/auth/access-token" && method === "POST") return json(200, ACCESS_TOKEN_ISSUE);
    if (path === "/auth/access-token/login" && method === "POST") return json(200, server.loginSession);
    if (path === "/auth/logout" && method === "POST") return new Response(null, { status: 204 });

    if (path.startsWith("/admin/") && server.rejectAdminAuth) {
      return json(401, { error: { code: "UNAUTHORIZED", message: "expired" } });
    }

    if (path === "/admin/context" && method === "GET") return json(200, adminContext(server));

    if (path === "/admin/comparsas" && method === "GET") return json(200, server.comparsas);
    if (path === "/admin/comparsas" && method === "POST") {
      if (server.conflictOn) {
        return json(409, { error: { code: "COMPARSA_CODE_CONFLICT", message: "dup" } });
      }
      const input = body as { code: string; name: string };
      const item: Comparsa = {
        id: `cmp-new-${server.comparsas.length}`,
        editionId: EDITION_ID,
        code: input.code,
        name: input.name,
      };
      server.comparsas.push(item);
      return json(201, { created: true, item });
    }
    const comparsaPut = path.match(/^\/admin\/comparsas\/([^/]+)$/);
    if (comparsaPut !== null && method === "PUT") {
      const input = body as { code: string; name: string };
      const id = decodeURIComponent(comparsaPut[1]!);
      const idx = server.comparsas.findIndex((c) => c.id === id);
      const item = { ...server.comparsas[idx]!, code: input.code, name: input.name };
      server.comparsas[idx] = item;
      return json(200, { created: false, item });
    }

    if (path === "/admin/rubros" && method === "GET") return json(200, server.rubros);
    if (path === "/admin/rubros" && method === "POST") {
      const input = body as { specialty: Specialty; name: string; type: Rubro["type"] };
      const item: Rubro = {
        id: `rubro-new-${server.rubros.length}`,
        editionId: EDITION_ID,
        specialty: input.specialty,
        name: input.name,
        type: input.type,
      };
      server.rubros.push(item);
      return json(201, { created: true, item });
    }
    const rubroPut = path.match(/^\/admin\/rubros\/([^/]+)$/);
    if (rubroPut !== null && method === "PUT") {
      const input = body as { specialty: Specialty; name: string; type: Rubro["type"] };
      const id = decodeURIComponent(rubroPut[1]!);
      const idx = server.rubros.findIndex((r) => r.id === id);
      const item = { ...server.rubros[idx]!, specialty: input.specialty, name: input.name, type: input.type };
      server.rubros[idx] = item;
      return json(200, { created: false, item });
    }

    const itemsGet = path.match(/^\/admin\/rubros\/([^/]+)\/items$/);
    if (itemsGet !== null && method === "GET") {
      return json(200, server.itemsByRubro[decodeURIComponent(itemsGet[1]!)] ?? []);
    }
    const itemsPost = path.match(/^\/admin\/rubros\/([^/]+)\/items$/);
    if (itemsPost !== null && method === "POST") {
      const rubroId = decodeURIComponent(itemsPost[1]!);
      const input = body as { name: string; orderIndex: number };
      const count = Object.values(server.itemsByRubro).reduce((n, list) => n + list.length, 0);
      const item: RubroItem = { id: `item-new-${count}`, rubroId, name: input.name, orderIndex: input.orderIndex };
      server.itemsByRubro[rubroId] ??= [];
      server.itemsByRubro[rubroId]!.push(item);
      return json(201, { created: true, item });
    }

    if (path === "/admin/candidates" && method === "GET") return json(200, server.candidates);
    if (path === "/admin/candidates" && method === "POST") {
      const input = body as { itemId: string; comparsaId: string; label: string };
      const item: Candidate = { id: `can-new-${server.candidates.length}`, ...input };
      server.candidates.push(item);
      return json(201, { created: true, item });
    }
    const candidatePut = path.match(/^\/admin\/candidates\/([^/]+)$/);
    if (candidatePut !== null && method === "PUT") {
      const input = body as { itemId: string; comparsaId: string; label: string };
      const id = decodeURIComponent(candidatePut[1]!);
      const idx = server.candidates.findIndex((c) => c.id === id);
      server.candidates[idx] = { ...server.candidates[idx]!, ...input };
      return json(200, { created: false, item: server.candidates[idx] });
    }

    if (path === "/admin/assignments" && method === "GET") return json(200, server.assignments);
    if (path === "/admin/assignments" && method === "POST") {
      const input = body as { judgeId: string; nightId: string; specialtyId: string; isEffective: boolean };
      const item: JudgeAssignmentView = { id: `assn-new-${server.assignments.length}`, ...input };
      server.assignments.push(item);
      return json(201, { created: true, item });
    }
    const assignmentPut = path.match(/^\/admin\/assignments\/([^/]+)$/);
    if (assignmentPut !== null && method === "PUT") {
      const input = body as { judgeId: string; nightId: string; specialtyId: string; isEffective: boolean };
      const id = decodeURIComponent(assignmentPut[1]!);
      const idx = server.assignments.findIndex((a) => a.id === id);
      server.assignments[idx] = { ...server.assignments[idx]!, ...input };
      return json(200, { created: false, item: server.assignments[idx] });
    }

    const nightPut = path.match(/^\/admin\/nights\/([^/]+)$/);
    if (nightPut !== null && method === "PUT") {
      const id = decodeURIComponent(nightPut[1]!);
      const idx = server.nights.findIndex((n) => n.id === id);
      server.nights[idx] = { ...server.nights[idx]!, ...applyNightPatch(server.nights[idx]!, body as NightUpdateInput) };
      return json(200, server.nights[idx]);
    }

    return json(404, { error: { code: "NOT_FOUND", message: "no route" } });
  };
}

function emptySyncSource() {
  return {
    getSnapshot: () => ({ online: false, pending: 0, syncing: 0, synced: 0, failed: 0, blocked: 0, retryableFailed: 0 }),
    whenStatusChanges: () => () => undefined,
    syncAllOnce: async () => ({ attempted: 0, synced: 0, failed: 0, retried: 0 }),
    retryRecoverableFailures: async () => 0,
    enqueuePlanilla: async () => {
      throw new Error("not used");
    },
  };
}

interface Harness {
  app: JudgeApp;
  server: AdminServer;
  session: SessionStore;
  router: Router;
  kv: MemoryStorage;
  planillaIds: string[];
}

function makeHarness(options?: { conflictOn?: boolean }): Harness {
  const kv = new MemoryStorage();
  const store = new OfflineStore(kv);
  const connectivity = createManualConnectivity(true);
  const session = createSessionStore();
  const router = makeRouter({ name: "login" });

  const ctx = makeContext();
  const itemsByRubro: Record<string, RubroItem[]> = {};
  for (const item of ctx.items) {
    itemsByRubro[item.rubroId] ??= [];
    itemsByRubro[item.rubroId]!.push(item);
  }

  const server: AdminServer = {
    loginSession: ADMIN_SESSION,
    comparsas: ctx.comparsas.map((c) => ({ ...c })),
    rubros: ctx.rubros.map((r) => ({ ...r })),
    itemsByRubro,
    candidates: ctx.candidates.map((c) => ({ ...c })),
    assignments: [
      { id: "assn-1", judgeId: "juez-1", nightId: NIGHT_ID, specialtyId: "sp-baile", isEffective: true },
    ],
    nights: ctx.nights.map((n) => ({ ...n })),
    conflictOn: options?.conflictOn ?? false,
    rejectAdminAuth: false,
    calls: [],
  };

  const api = new ApiClient({
    baseUrl: "http://test",
    getToken: () => session.getToken(),
    fetchFn: adminFetch(server),
  });

  let idCounter = 0;
  const planillaIds: string[] = [];
  const createId = (): string => {
    idCounter += 1;
    const next = `id-${idCounter}`;
    planillaIds.push(next);
    return next;
  };

  const app = new JudgeApp({
    api,
    store,
    sync: emptySyncSource(),
    connectivity,
    session,
    router,
    cache: kv,
    clock: { nowIso: () => systemClock.nowIso() },
    createId,
  });

  connectivity.setOnline(false);
  connectivity.setOnline(true);

  return { app, server, session, router, kv, planillaIds };
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 30));
}

async function loginAsAdmin(h: Harness): Promise<void> {
  await h.app.login(ADMIN_EMAIL, ADMIN_PASSWORD);
  await settle();
}

async function loginAsJudge(h: Harness): Promise<void> {
  await h.app.requestAccessToken(JUDGE_EMAIL, JUDGE_DNI);
  await h.app.loginWithAccessToken(JUDGE_EMAIL, JUDGE_DNI, JUDGE_ACCESS_TOKEN);
  await settle();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("consola de administración (frontend)", () => {
  it("el ADMIN inicia directamente en la consola con el contexto cargado", async () => {
    const h = makeHarness();
    await h.app.boot();
    await loginAsAdmin(h);
    const state = h.app.getState();
    expect(state.route.name).toBe("admin");
    if (state.route.name === "admin") expect(state.route.section).toBe("overview");
    expect(state.admin.context).not.toBeNull();
    expect(state.admin.comparsas.length).toBe(2);
    expect(state.admin.assignments[0]?.isEffective).toBe(true);
  });

  it("un rol operativo (no admin) entra a su home, no a la consola", async () => {
    const h = makeHarness();
    h.server.loginSession = OPERATOR_SESSION;
    await h.app.boot();
    await h.app.login("escribano@goya2027.test", "ChangeMe-2027!");
    await settle();
    expect(h.app.getState().route.name).toBe("home");
    expect(h.app.getState().admin.context).toBeNull();
  });

  it("un juez que intenta entrar a la consola es redirigido a su home", async () => {
    const h = makeHarness();
    h.server.loginSession = JUDGE_SESSION;
    await h.app.boot();
    await loginAsJudge(h);
    expect(h.app.getState().route.name).toBe("home");
    h.router.navigate({ name: "admin", section: "comparsas" });
    await settle();
    expect(h.app.getState().route.name).toBe("home");
    expect(h.app.getState().admin.context).toBeNull();
  });

  it("crear una comparsa la persiste y refresca la lista", async () => {
    const h = makeHarness();
    await h.app.boot();
    await loginAsAdmin(h);
    await h.app.adminSaveComparsa(undefined, { code: "L03", name: "La Nueva Banda" });
    await settle();
    const state = h.app.getState();
    expect(state.admin.comparsas.some((c) => c.code === "L03")).toBe(true);
    expect(h.server.calls.some((c) => c.method === "POST" && c.path === "/admin/comparsas")).toBe(true);
    expect(state.notice?.tone).toBe("success");
  });

  it("editar una comparsa existente la actualiza", async () => {
    const h = makeHarness();
    await h.app.boot();
    await loginAsAdmin(h);
    const existing = h.app.getState().admin.comparsas[0]!;
    await h.app.adminSaveComparsa(existing.id, { code: existing.code, name: "Renombrada" });
    await settle();
    const updated = h.app.getState().admin.comparsas.find((c) => c.id === existing.id);
    expect(updated?.name).toBe("Renombrada");
    expect(h.server.calls.some((c) => c.method === "PUT" && c.path === `/admin/comparsas/${existing.id}`)).toBe(true);
  });

  it("conflicto de código de comparsa muestra un mensaje accionable", async () => {
    const h = makeHarness({ conflictOn: true });
    await h.app.boot();
    await loginAsAdmin(h);
    await h.app.adminSaveComparsa(undefined, { code: "L01", name: "Duplicada" });
    await settle();
    const state = h.app.getState();
    expect(state.notice?.tone).toBe("error");
    expect(state.notice?.text.toLowerCase()).toContain("código");
  });

  it("crea rubro, su ítem y un candidato encadenado", async () => {
    const h = makeHarness();
    await h.app.boot();
    await loginAsAdmin(h);

    await h.app.adminSaveRubro(undefined, { specialty: "VESTUARIO", name: "Diseño", type: "NOMINATIVO" });
    await settle();
    const rubro = h.app.getState().admin.rubros.find((r) => r.name === "Diseño");
    expect(rubro).toBeDefined();

    await h.app.adminSaveRubroItem(rubro!.id, undefined, { name: "Bordados", orderIndex: 0 });
    await settle();
    const item = h.app.getState().admin.itemsByRubro[rubro!.id]?.find((i) => i.name === "Bordados");
    expect(item).toBeDefined();

    await h.app.adminSaveCandidate(undefined, { itemId: item!.id, comparsaId: "cmp-1", label: "Candidata X" });
    await settle();
    expect(h.app.getState().admin.candidates.some((c) => c.label === "Candidata X")).toBe(true);
    expect(h.app.getState().admin.candidates.length).toBeGreaterThan(0);
  });

  it("editar la ventana de una noche la persiste", async () => {
    const h = makeHarness();
    await h.app.boot();
    await loginAsAdmin(h);
    await h.app.adminSaveNight(NIGHT_ID, {
      date: "2027-01-16",
      startsAt: "2027-01-16T21:00:00.000Z",
    });
    await settle();
    const night = h.app.getState().admin.context?.nights.find((n) => n.id === NIGHT_ID);
    expect(night?.date).toBe("2027-01-16");
    expect(night?.startsAt).toBe("2027-01-16T21:00:00.000Z");
    expect(h.server.calls.some((c) => c.method === "PUT" && c.path === `/admin/nights/${NIGHT_ID}`)).toBe(true);
  });

  it("ajustar la habilitación de una asignación existente", async () => {
    const h = makeHarness();
    await h.app.boot();
    await loginAsAdmin(h);
    const assn = h.app.getState().admin.assignments[0]!;
    await h.app.adminSaveAssignment(assn.id, {
      judgeId: assn.judgeId,
      nightId: assn.nightId,
      specialtyId: assn.specialtyId,
      isEffective: false,
    });
    await settle();
    const updated = h.app.getState().admin.assignments.find((a) => a.id === assn.id);
    expect(updated?.isEffective).toBe(false);
    expect(h.server.calls.some((c) => c.method === "PUT" && c.path === `/admin/assignments/${assn.id}`)).toBe(true);
  });

  it("crea una asignación nueva usando el specialtyId real del contexto", async () => {
    const h = makeHarness();
    await h.app.boot();
    await loginAsAdmin(h);

    const context = h.app.getState().admin.context!;
    // El contexto expone cada especialidad con id (UUID persistido) + code.
    expect(context.specialties).toEqual([
      { id: "sp-baile", code: "BAILE" },
      { id: "sp-vestuario", code: "VESTUARIO" },
      { id: "sp-bateria", code: "BATERIA" },
    ]);

    const specialty = context.specialties.find((s) => s.code === "VESTUARIO")!;
    await h.app.adminSaveAssignment(undefined, {
      judgeId: "juez-1",
      nightId: NIGHT_ID,
      specialtyId: specialty.id,
      isEffective: true,
    });
    await settle();

    const created = h.server.calls.find(
      (c) => c.method === "POST" && c.path === "/admin/assignments",
    );
    expect(created).toBeDefined();
    // Se envió el UUID real (sp-vestuario), no el código textual.
    expect((created!.body as { specialtyId: string }).specialtyId).toBe("sp-vestuario");
    expect(h.app.getState().admin.assignments.some((a) => a.specialtyId === "sp-vestuario")).toBe(true);
  });

  it("una respuesta no autorizada en la consola expira la sesión", async () => {
    const h = makeHarness();
    await h.app.boot();
    await loginAsAdmin(h);
    h.server.rejectAdminAuth = true;
    await h.app.adminRefresh();
    await settle();
    expect(h.app.getState().user).toBeNull();
    expect(h.app.getState().route.name).toBe("login");
    expect(h.app.getState().admin.context).toBeNull();
  });
});