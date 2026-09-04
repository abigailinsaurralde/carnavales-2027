import { describe, expect, it } from "vitest";
import type {
  SyncPlanillasRequest,
  SyncPlanillasResult,
} from "@votaciones2027/shared-types";
import { nextRetryDelayMs } from "../src/offline/backoff.js";
import type { Clock } from "../src/offline/clock.js";
import { createManualConnectivity } from "../src/offline/connectivity.js";
import { MemoryStorage } from "../src/offline/storage.js";
import { OfflineStore } from "../src/offline/store.js";
import { SyncManager } from "../src/offline/sync-manager.js";
import type {
  SyncTransport,
  SyncTransportResult,
} from "../src/offline/transport.js";
import type {
  LocalPlanilla,
  LocalVote,
  OutboxOperation,
} from "../src/offline/types.js";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface VoteSeed {
  id: string;
  planillaId: string;
  score?: number;
  idempotencyKey?: string;
  clientRef?: string;
}

function makeVote(seed: VoteSeed): LocalVote {
  return {
    id: seed.id,
    planillaId: seed.planillaId,
    nightId: "night-1",
    comparsaId: "cmp-1",
    rubroId: "rubro-1",
    itemId: "item-1",
    candidateId: "cand-1",
    score: seed.score ?? 7,
    idempotencyKey: seed.idempotencyKey ?? `key-${seed.id}`,
    clientRef: seed.clientRef ?? `vote-ref-${seed.id}`,
    syncState: "PENDING",
    updatedAt: "2027-01-01T00:00:00.000Z",
  };
}

function makePlanilla(
  id: string,
  nightId = "night-1",
  status: LocalPlanilla["status"] = "BORRADOR",
): LocalPlanilla {
  return {
    id,
    nightId,
    clientRef: `plan-${id}`,
    status,
    updatedAt: "2027-01-01T00:00:00.000Z",
  };
}

function okResult(
  planillaId: string,
  votes: Array<{ id: string; action: "INSERTED" | "EXISTS" | "REJECTED"; reason?: string }>,
  overrides: Partial<SyncPlanillasResult["planillas"][number]> = {},
): SyncPlanillasResult {
  return {
    planillas: [
      {
        planillaId,
        planillaAction: "ALREADY_EXISTS",
        votes,
        ...overrides,
      },
    ],
    syncedAt: "2027-01-01T00:00:00.000Z",
  };
}

function okForRequest(request: SyncPlanillasRequest): SyncPlanillasResult {
  const planilla = request.planillas[0]!;
  return okResult(
    planilla.planilla.id,
    planilla.votes.map((v) => ({ id: v.id, action: "EXISTS" as const })),
  );
}

class StubTransport implements SyncTransport {
  readonly calls: SyncPlanillasRequest[] = [];
  private scripted: Array<
    | { kind: "result"; result: SyncTransportResult }
    | {
        kind: "handler";
        handler: (req: SyncPlanillasRequest) => Promise<SyncTransportResult>;
      }
  > = [];
  private active = 0;
  private idleWaiters: Array<{ target: number; resolve: () => void }> = [];
  private startWaiters: Array<{ target: number; resolve: () => void }> = [];

  script(result: SyncTransportResult): void {
    this.scripted.push({ kind: "result", result });
  }
  scriptHandler(
    handler: (req: SyncPlanillasRequest) => Promise<SyncTransportResult>,
  ): void {
    this.scripted.push({ kind: "handler", handler });
  }
  ok(data: SyncPlanillasResult): void {
    this.script({ ok: true, data });
  }
  okFromRequest(): void {
    this.scriptHandler(async (req) => ({ ok: true, data: okForRequest(req) }));
  }
  http(status: number, body?: unknown): void {
    this.script({ ok: false, kind: "HTTP", status, ...(body === undefined ? {} : { body }) });
  }
  network(): void {
    this.script({ ok: false, kind: "NETWORK" });
  }
  timeout(): void {
    this.script({ ok: false, kind: "TIMEOUT" });
  }

  async syncPlanillas(req: SyncPlanillasRequest): Promise<SyncTransportResult> {
    this.calls.push(req);
    this.notify(this.startWaiters);
    this.active += 1;
    try {
      const entry = this.scripted.shift();
      if (entry === undefined) {
        throw new Error("StubTransport: no scripted response available");
      }
      if (entry.kind === "handler") {
        return await entry.handler(req);
      }
      return entry.result;
    } finally {
      this.active -= 1;
      this.notify(this.idleWaiters);
    }
  }

  /** Resuelve cuando se haya INICIADO la llamada número `n`. */
  waitForCallStarted(n: number): Promise<void> {
    if (this.calls.length >= n) return Promise.resolve();
    return this.register(this.startWaiters, n);
  }

  /** Resuelve cuando la llamada número `n` haya terminado. */
  waitForCallDone(n: number): Promise<void> {
    if (this.calls.length >= n && this.active === 0) return Promise.resolve();
    return this.register(this.idleWaiters, n);
  }

  waitForIdle(): Promise<void> {
    return this.waitForCallDone(Math.max(1, this.calls.length));
  }

  private register(
    pool: Array<{ target: number; resolve: () => void }>,
    target: number,
  ): Promise<void> {
    return new Promise((resolve) => {
      pool.push({ target, resolve });
    });
  }

  private notify(pool: Array<{ target: number; resolve: () => void }>): void {
    const remaining: Array<{ target: number; resolve: () => void }> = [];
    for (const waiter of pool) {
      if (
        waiter.target <= this.calls.length &&
        (pool === this.idleWaiters ? this.active === 0 : true)
      ) {
        waiter.resolve();
      } else {
        remaining.push(waiter);
      }
    }
    pool.length = 0;
    for (const item of remaining) pool.push(item);
  }
}

class FakeClock implements Clock {
  private now = 1_700_000_000_000;
  private nextTimerId = 1;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();

  nowMs(): number {
    return this.now;
  }
  nowIso(): string {
    return new Date(this.now).toISOString();
  }
  iso(ms: number): string {
    return new Date(ms).toISOString();
  }
  setTimeout(callback: () => void, ms: number): unknown {
    const id = this.nextTimerId;
    this.nextTimerId += 1;
    this.timers.set(id, { at: this.now + ms, callback });
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }
  advance(ms: number): void {
    this.now += ms;
    const due = Array.from(this.timers.entries())
      .filter(([, timer]) => timer.at <= this.now)
      .sort(([, a], [, b]) => a.at - b.at);
    for (const [id, timer] of due) {
      this.timers.delete(id);
      timer.callback();
    }
  }
}

interface Harness {
  manager: SyncManager;
  store: OfflineStore;
  kv: MemoryStorage;
  clock: FakeClock;
  connectivity: ReturnType<typeof createManualConnectivity>;
  transport: StubTransport;
}

function makeHarness(options?: {
  baseMs?: number;
  maxAttempts?: number;
  initialOnline?: boolean;
}): Harness {
  const kv = new MemoryStorage();
  const store = new OfflineStore(kv);
  const clock = new FakeClock();
  const connectivity = createManualConnectivity(options?.initialOnline ?? true);
  const transport = new StubTransport();
  const manager = new SyncManager({
    store,
    transport,
    connectivity,
    clock,
    maxAttempts: options?.maxAttempts ?? 8,
    backoff: {
      baseMs: options?.baseMs ?? 1000,
      maxMs: 60000,
      random: () => 0.5,
    },
  });
  return { manager, store, kv, clock, connectivity, transport };
}

async function enqueueOffline(
  harness: Harness,
  planilla: LocalPlanilla,
  votes: LocalVote[],
): Promise<OutboxOperation> {
  harness.connectivity.setOnline(false);
  const op = await harness.manager.enqueuePlanilla(planilla, votes);
  return op;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("nextRetryDelayMs (backoff exponencial + jitter)", () => {
  it("crece exponencialmente desde la base y respeta el tope", () => {
    const options = { baseMs: 1000, maxMs: 60000, random: () => 0.5 };
    const first = nextRetryDelayMs(1, options);
    const second = nextRetryDelayMs(2, options);
    const third = nextRetryDelayMs(3, options);
    expect(first).toBe(750);
    expect(second).toBe(1500);
    expect(third).toBe(3000);
    expect(nextRetryDelayMs(10, options)).toBe(45000);
    expect(nextRetryDelayMs(100, { ...options, random: () => 1 })).toBe(60000);
  });
});

describe("persistencia local", () => {
  it("guarda el voto y encola la operación PENDING estando offline", async () => {
    const harness = makeHarness({ initialOnline: false });
    const planilla = makePlanilla("p-1");
    const vote = makeVote({ id: "v-1", planillaId: "p-1", score: 8 });

    const op = await harness.manager.enqueuePlanilla(planilla, [vote]);

    expect(op.state).toBe("PENDING");
    expect(harness.store.loadPlanilla("p-1")).toEqual(planilla);
    expect(harness.store.loadVote("p-1", "v-1")?.score).toBe(8);
    expect(harness.store.loadVote("p-1", "v-1")?.syncState).toBe("PENDING");
    expect(harness.store.loadOperation(op.id)?.state).toBe("PENDING");
    expect(harness.manager.getSnapshot()).toMatchObject({
      online: false,
      pending: 1,
      synced: 0,
    });
    expect(harness.transport.calls).toHaveLength(0);
  });

  it("los datos sobreviven a una 'nueva sesión' (mismo KVStorage)", async () => {
    const backing = new Map<string, string>();
    const kv1 = new MemoryStorage(backing);
    const store1 = new OfflineStore(kv1);
    const clock = new FakeClock();
    const connectivity = createManualConnectivity(false);
    const transport = new StubTransport();
    const manager1 = new SyncManager({
      store: store1,
      transport,
      connectivity,
      clock,
      backoff: { baseMs: 1000, maxMs: 60000, random: () => 0.5 },
    });

    const planilla = makePlanilla("p-1");
    const vote = makeVote({ id: "v-1", planillaId: "p-1", score: 9 });
    const op = await manager1.enqueuePlanilla(planilla, [vote]);
    expect(op.state).toBe("PENDING");

    // "Segunda sesión" sobre el mismo almacenamiento.
    const kv2 = new MemoryStorage(backing);
    const store2 = new OfflineStore(kv2);
    expect(store2.loadPlanilla("p-1")).toEqual(planilla);
    expect(store2.loadVote("p-1", "v-1")?.score).toBe(9);
    expect(store2.listOperations()).toHaveLength(1);
    expect(store2.loadOperation(op.id)?.state).toBe("PENDING");
  });

  it("coalesce múltiples ediciones en una sola operación por planilla", async () => {
    const harness = makeHarness({ initialOnline: false });
    harness.transport.okFromRequest();
    const planilla = makePlanilla("p-1");
    const v1 = makeVote({ id: "v-1", planillaId: "p-1", score: 7 });

    const op1 = await harness.manager.enqueuePlanilla(planilla, [v1]);
    const v1Edited = makeVote({ id: "v-1", planillaId: "p-1", score: 9 });
    const v2 = makeVote({ id: "v-2", planillaId: "p-1", score: 6 });
    const op2 = await harness.manager.enqueuePlanilla(planilla, [
      v1Edited,
      v2,
    ]);

    expect(op1.id).toBe(op2.id);
    expect(harness.store.listOperations()).toHaveLength(1);
    const latest = harness.store.loadOperation(op1.id);
    expect(latest?.revision).toBe(2);
    expect(latest?.payload.planilla.id).toBe("p-1");
    expect(latest?.payload.votes).toHaveLength(2);

    harness.connectivity.setOnline(true);
    await harness.manager.whenIdle();
    expect(harness.transport.calls).toHaveLength(1);
    const sent = harness.transport.calls[0]!.planillas[0]!;
    expect(sent.votes.map((v) => v.score).sort()).toEqual([6, 9]);
  });
});

describe("sincronización y reconciliación", () => {
  it("sincroniza la cola al recuperar conectividad", async () => {
    const harness = makeHarness();
    harness.transport.okFromRequest();
    const planilla = makePlanilla("p-1");
    const vote = makeVote({ id: "v-1", planillaId: "p-1", score: 8 });
    await enqueueOffline(harness, planilla, [vote]);

    harness.connectivity.setOnline(true);
    await harness.manager.whenIdle();

    expect(harness.transport.calls).toHaveLength(1);
    const op = harness.store.listOperations()[0]!;
    expect(op.state).toBe("SYNCED");
    expect(harness.store.loadVote("p-1", "v-1")?.syncState).toBe("SYNCED");
    expect(harness.manager.getSnapshot()).toMatchObject({
      online: true,
      pending: 0,
      synced: 1,
    });
  });

  it("no envía nada cuando el dispositivo está offline", async () => {
    const harness = makeHarness({ initialOnline: false });
    const planilla = makePlanilla("p-1");
    const vote = makeVote({ id: "v-1", planillaId: "p-1" });
    await harness.manager.enqueuePlanilla(planilla, [vote]);

    const outcome = await harness.manager.syncAllOnce();

    expect(outcome.attempted).toBe(0);
    expect(harness.transport.calls).toHaveLength(0);
    expect(harness.store.listOperations()[0]?.state).toBe("PENDING");
  });

  it("una caída de red no pierde la operación y programa reintento", async () => {
    const harness = makeHarness();
    harness.transport.network();
    harness.transport.okFromRequest();
    const planilla = makePlanilla("p-1");
    const vote = makeVote({ id: "v-1", planillaId: "p-1", score: 8 });
    await enqueueOffline(harness, planilla, [vote]);

    harness.connectivity.setOnline(true);
    await harness.manager.whenIdle();

    let op = harness.store.listOperations()[0]!;
    expect(op.state).toBe("PENDING"); // NUNCA SYNCED sin confirmación
    expect(op.lastError?.retryable).toBe(true);
    expect(op.nextAttemptAt).toBeDefined();

    // Aún no vence la espera → no se envía.
    const outcome = await harness.manager.syncAllOnce();
    expect(outcome.attempted).toBe(0);
    expect(harness.transport.calls).toHaveLength(1);

    // Vence la espera → reintento automático → éxito.
    const remaining = Date.parse(op.nextAttemptAt!) - harness.clock.nowMs();
    harness.clock.advance(remaining);
    await harness.manager.whenIdle();

    op = harness.store.listOperations()[0]!;
    expect(harness.transport.calls).toHaveLength(2);
    expect(op.state).toBe("SYNCED");
    expect(harness.store.loadVote("p-1", "v-1")?.syncState).toBe("SYNCED");
  });

  it("reintenta con backoff creciente ante HTTP 500", async () => {
    const harness = makeHarness();
    harness.transport.http(500, { detail: "temporal" });
    harness.transport.http(500, { detail: "temporal" });
    harness.transport.okFromRequest();
    const planilla = makePlanilla("p-1");
    const vote = makeVote({ id: "v-1", planillaId: "p-1" });
    await enqueueOffline(harness, planilla, [vote]);

    harness.connectivity.setOnline(true);
    await harness.manager.whenIdle();
    const afterFirst = harness.store.listOperations()[0]!;
    expect(afterFirst.state).toBe("PENDING");
    expect(afterFirst.attempts).toBe(1);
    expect(afterFirst.nextAttemptAt).toBeDefined();
    expect(afterFirst.lastError?.code).toBe("HTTP_500");

    const firstWait =
      Date.parse(afterFirst.nextAttemptAt!) - harness.clock.nowMs();
    harness.clock.advance(firstWait);
    await harness.manager.whenIdle();
    const afterSecond = harness.store.listOperations()[0]!;
    expect(afterSecond.attempts).toBe(2);
    const secondWait =
      Date.parse(afterSecond.nextAttemptAt!) - harness.clock.nowMs();
    expect(secondWait).toBeGreaterThan(firstWait); // backoff creciente

    harness.clock.advance(secondWait);
    await harness.manager.whenIdle();

    const finalOp = harness.store.listOperations()[0]!;
    expect(harness.transport.calls).toHaveLength(3);
    expect(finalOp.state).toBe("SYNCED");
  });

  it("trunca los reintentos tras maxAttempts (sin bucle infinito)", async () => {
    const harness = makeHarness({ maxAttempts: 2 });
    harness.transport.network();
    harness.transport.network();
    harness.transport.okFromRequest();
    const planilla = makePlanilla("p-1");
    const vote = makeVote({ id: "v-1", planillaId: "p-1" });
    await enqueueOffline(harness, planilla, [vote]);

    harness.connectivity.setOnline(true);
    await harness.manager.whenIdle();
    const afterFirst = harness.store.listOperations()[0]!;
    harness.clock.advance(Date.parse(afterFirst.nextAttemptAt!) - harness.clock.nowMs());
    await harness.manager.whenIdle();

    const op = harness.store.listOperations()[0]!;
    expect(harness.transport.calls).toHaveLength(2);
    expect(op.state).toBe("FAILED");
    expect(op.lastError?.code).toBe("MAX_ATTEMPTS");
    expect(op.lastError?.retryable).toBe(true);
    expect(harness.store.loadVote("p-1", "v-1")?.syncState).toBe("FAILED");
  });

  it("una respuesta 401/403 no se reintenta (FAILED permanente)", async () => {
    const harness = makeHarness();
    harness.transport.http(401, { message: "unauthorized" });
    const planilla = makePlanilla("p-1");
    const vote = makeVote({ id: "v-1", planillaId: "p-1" });
    await enqueueOffline(harness, planilla, [vote]);

    harness.connectivity.setOnline(true);
    await harness.manager.whenIdle();

    const op = harness.store.listOperations()[0]!;
    expect(op.state).toBe("FAILED");
    expect(op.lastError?.code).toBe("HTTP_401");
    expect(op.lastError?.retryable).toBe(false);
    expect(op.nextAttemptAt).toBeUndefined();
    expect(harness.transport.calls).toHaveLength(1);
    expect(harness.store.loadVote("p-1", "v-1")?.syncState).toBe("FAILED");
  });

  it("reintento idempotente: reenvía exactamente el mismo payload (timeout tras procesar)", async () => {
    const harness = makeHarness();
    harness.transport.timeout(); // el servidor PROBABLEMENTE procesó
    harness.transport.okFromRequest(); // retransmisión → EXISTS
    const planilla = makePlanilla("p-1");
    const vote = makeVote({ id: "v-1", planillaId: "p-1", score: 8 });
    await enqueueOffline(harness, planilla, [vote]);

    harness.connectivity.setOnline(true);
    await harness.manager.whenIdle();
    let op = harness.store.listOperations()[0]!;
    harness.clock.advance(Date.parse(op.nextAttemptAt!) - harness.clock.nowMs());
    await harness.manager.whenIdle();

    const [first, second] = [harness.transport.calls[0], harness.transport.calls[1]];
    expect(first).toEqual(second); // mismo payload, sin duplicados
    expect(harness.transport.calls).toHaveLength(2);
    op = harness.store.listOperations()[0]!;
    expect(op.state).toBe("SYNCED");
  });

  it("rechazo de un voto → operación SYNCED parcial y voto FAILED con diagnóstico", async () => {
    const harness = makeHarness();
    harness.transport.ok(
      okResult("p-1", [
        { id: "v-1", action: "INSERTED" },
        { id: "v-2", action: "REJECTED", reason: "VOTE_CONFIRMED_IMMUTABLE" },
      ]),
    );
    const planilla = makePlanilla("p-1");
    await enqueueOffline(harness, planilla, [
      makeVote({ id: "v-1", planillaId: "p-1", score: 8 }),
      makeVote({ id: "v-2", planillaId: "p-1", score: 6 }),
    ]);

    harness.connectivity.setOnline(true);
    await harness.manager.whenIdle();

    const op = harness.store.listOperations()[0]!;
    expect(op.state).toBe("SYNCED");
    expect(op.lastError?.code).toBe("PARTIAL");
    expect(harness.store.loadVote("p-1", "v-1")?.syncState).toBe("SYNCED");
    const rejected = harness.store.loadVote("p-1", "v-2")!;
    expect(rejected.syncState).toBe("FAILED");
    expect(rejected.error).toBe("VOTE_CONFIRMED_IMMUTABLE");
  });

  it("conflicto de planilla → operación FAILED con causa conservada", async () => {
    const harness = makeHarness();
    harness.transport.ok(
      okResult("p-1", [], {
        planillaAction: "CONFLICT",
        reason: "PLANILLA_NOT_OWNED",
      }),
    );
    const planilla = makePlanilla("p-1");
    const vote = makeVote({ id: "v-1", planillaId: "p-1" });
    await enqueueOffline(harness, planilla, [vote]);

    harness.connectivity.setOnline(true);
    await harness.manager.whenIdle();

    const op = harness.store.listOperations()[0]!;
    expect(op.state).toBe("FAILED");
    expect(op.lastError?.code).toBe("PLANILLA_CONFLICT");
    expect(op.lastError?.retryable).toBe(false);
    expect((op.lastError?.details as SyncPlanillasResult | undefined)?.planillas[0]?.reason).toBe(
      "PLANILLA_NOT_OWNED",
    );
    expect(harness.store.loadVote("p-1", "v-1")?.syncState).toBe("FAILED");
  });

  it("reconcilia y remapea el id de planilla si el servidor lo cambió", async () => {
    const serverPlanillaId = "p-server-1";
    const harness = makeHarness();
    harness.transport.ok(okResult(serverPlanillaId, [{ id: "v-1", action: "INSERTED" }]));
    const planilla = makePlanilla("p-client-1");
    const vote = makeVote({ id: "v-1", planillaId: "p-client-1", score: 8 });
    await enqueueOffline(harness, planilla, [vote]);

    harness.connectivity.setOnline(true);
    await harness.manager.whenIdle();

    expect(harness.store.loadPlanilla("p-client-1")).toBeNull();
    expect(harness.store.loadPlanilla(serverPlanillaId)).not.toBeNull();
    expect(harness.store.loadVote("p-client-1", "v-1")).toBeNull();
    const voteNow = harness.store.loadVote(serverPlanillaId, "v-1");
    expect(voteNow?.planillaId).toBe(serverPlanillaId);
    expect(voteNow?.syncState).toBe("SYNCED");
    const op = harness.store.listOperations()[0]!;
    expect(op.planillaId).toBe(serverPlanillaId);
    expect(op.state).toBe("SYNCED");
  });

  it("edición durante el vuelo re-encola la versión nueva (revisión)", async () => {
    const harness = makeHarness();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    harness.transport.scriptHandler(async (req) => {
      await gate;
      return { ok: true, data: okForRequest(req) };
    });
    // La respuesta del primer envío dispara el re-envío de la versión nueva
    // (revisión 2); se provee la respuesta para esa segunda llamada.
    harness.transport.scriptHandler(async (req) => ({
      ok: true,
      data: okForRequest(req),
    }));

    const planilla = makePlanilla("p-1");
    const v1 = makeVote({ id: "v-1", planillaId: "p-1", score: 7 });
    await enqueueOffline(harness, planilla, [v1]);

    harness.connectivity.setOnline(true);
    await harness.transport.waitForCallStarted(1);
    let op = harness.store.listOperations()[0]!;
    expect(op.state).toBe("SYNCING");

    // El juez corrige el voto mientras la respuesta está en vuelo.
    const edited = makeVote({ id: "v-1", planillaId: "p-1", score: 9 });
    await harness.manager.enqueuePlanilla(planilla, [edited]);
    op = harness.store.listOperations()[0]!;
    expect(op.revision).toBe(2);
    expect(op.state).toBe("PENDING");

    release();
    await harness.manager.whenIdle();

    // El propio drenado re-envía la versión nueva tras conciliar la vieja.
    expect(harness.transport.calls).toHaveLength(2);
    expect(harness.transport.calls[1]!.planillas[0]!.votes[0]!.score).toBe(9);
    op = harness.store.listOperations()[0]!;
    expect(op.state).toBe("SYNCED");
    expect(harness.store.loadVote("p-1", "v-1")?.score).toBe(9);
  });

  it("planilla local confirmada no se envía (confirmación server-side)", async () => {
    const harness = makeHarness();
    const planilla = makePlanilla("p-1", "night-1", "CONFIRMADA");
    const vote = makeVote({ id: "v-1", planillaId: "p-1" });
    await enqueueOffline(harness, planilla, [vote]);

    harness.connectivity.setOnline(true);
    await harness.manager.syncAllOnce();

    expect(harness.transport.calls).toHaveLength(0);
    const op = harness.store.listOperations()[0]!;
    expect(op.state).toBe("SYNCED");
    expect(harness.store.loadVote("p-1", "v-1")?.syncState).toBe("SYNCED");
  });

  it("drena múltiples planillas pendientes en orden", async () => {
    const harness = makeHarness();
    harness.transport.okFromRequest();
    harness.transport.okFromRequest();
    await enqueueOffline(harness, makePlanilla("p-a"), [
      makeVote({ id: "v-a1", planillaId: "p-a" }),
    ]);
    await enqueueOffline(harness, makePlanilla("p-b"), [
      makeVote({ id: "v-b1", planillaId: "p-b" }),
    ]);

    harness.connectivity.setOnline(true);
    await harness.manager.whenIdle();

    expect(harness.transport.calls).toHaveLength(2);
    expect(harness.store.listOperations().map((op) => op.state)).toEqual([
      "SYNCED",
      "SYNCED",
    ]);
    expect(harness.manager.getSnapshot()).toMatchObject({
      pending: 0,
      synced: 2,
    });
  });
});

describe("seguridad del almacén local", () => {
  it("nunca persiste el token de sesión en el KVStorage", async () => {
    const harness = makeHarness();
    harness.transport.okFromRequest();
    const planilla = makePlanilla("p-1");
    const vote = makeVote({ id: "v-1", planillaId: "p-1" });
    await enqueueOffline(harness, planilla, [vote]);
    harness.connectivity.setOnline(true);
    await harness.manager.whenIdle();

    const allKeys = harness.kv.list("");
    expect(allKeys.length).toBeGreaterThan(0);
    expect(allKeys.some((key) => /token|session|bearer/i.test(key))).toBe(false);
    expect(harness.store.listOperations()[0]?.state).toBe("SYNCED");
  });
});