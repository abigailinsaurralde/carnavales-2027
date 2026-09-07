import { describe, expect, it, vi } from "vitest";
import { createIndexedDbAdapter } from "../src/offline/idb-adapter.js";
import { OfflineStore } from "../src/offline/store.js";
import { SyncManager } from "../src/offline/sync-manager.js";
import { createManualConnectivity } from "../src/offline/connectivity.js";
import type { Clock } from "../src/offline/clock.js";
import type { LocalPlanilla, LocalVote } from "../src/offline/types.js";

// ---------------------------------------------------------------------------
// Fake IndexedDB (subconjunto mínimo que usa el adaptador)
// ---------------------------------------------------------------------------

type Handler = (event?: unknown) => void;

class ReportStore {
  entries = new Map<string, { key: string; value: string }>();
  failWrite = false;
  failGetAll = false;
}

class FakeObjectStore {
  constructor(
    private readonly storage: ReportStore,
    private readonly mode: IDBTransactionMode,
  ) {}

  put(entry: { key: string; value: string }): void {
    if (this.mode === "readonly") throw new Error("readonly store");
    this.storage.entries.set(entry.key, entry);
  }

  delete(key: string): void {
    if (this.mode === "readonly") throw new Error("readonly store");
    this.storage.entries.delete(key);
  }

  getAll(): FakeRequest<Array<{ key: string; value: string }>> {
    return new FakeRequest(Array.from(this.storage.entries.values()), {
      fail: this.storage.failGetAll,
    });
  }
}

class FakeRequest<T> {
  result: T;
  error: DOMException | null = null;
  private readonly listeners = new Map<string, Handler[]>();

  constructor(result: T, options?: { fail?: boolean }) {
    this.result = result;
    queueMicrotask(() => {
      if (options?.fail) {
        this.error = new DOMException("storage error");
        this.dispatch("error");
      } else {
        this.dispatch("success");
      }
    });
  }

  addEventListener(type: string, cb: Handler): void {
    const list = this.listeners.get(type) ?? [];
    list.push(cb);
    this.listeners.set(type, list);
  }

  private dispatch(type: string): void {
    for (const cb of this.listeners.get(type) ?? []) cb();
  }
}

class FakeTransaction {
  error: DOMException | null = null;
  private readonly listeners: Record<string, Handler[]> = {
    complete: [],
    error: [],
    abort: [],
  };

  constructor(
    private readonly storage: ReportStore,
    private readonly mode: IDBTransactionMode,
  ) {
    queueMicrotask(() => {
      if (storage.failWrite) {
        this.error = new DOMException("quota exceeded", "QuotaExceededError");
        this.dispatch("error");
        this.dispatch("abort");
      } else {
        this.dispatch("complete");
      }
    });
  }

  objectStore(): FakeObjectStore {
    return new FakeObjectStore(this.storage, this.mode);
  }

  addEventListener(type: string, cb: Handler): void {
    this.listeners[type]?.push(cb);
  }

  private dispatch(type: string): void {
    for (const cb of this.listeners[type] ?? []) cb();
  }
}

class FakeDb {
  readonly stores = new Map<string, ReportStore>();
  readonly storeNames = new Set<string>();

  get objectStoreNames(): { contains(name: string): boolean } {
    return { contains: (name) => this.storeNames.has(name) };
  }

  createObjectStore(name: string): FakeObjectStore {
    this.storeNames.add(name);
    const storage = new ReportStore();
    this.stores.set(name, storage);
    return new FakeObjectStore(storage, "readwrite");
  }

  transaction(name: string, mode: IDBTransactionMode): FakeTransaction {
    const storage = this.stores.get(name) ?? new ReportStore();
    this.stores.set(name, storage);
    return new FakeTransaction(storage, mode);
  }

  close(): void {
    // noop
  }
}

interface OpenRequest {
  result: unknown;
  error: DOMException | null;
  addEventListener(type: string, cb: Handler): void;
}

function makeFactory(dbName = "vote2027"): {
  factory: unknown;
  openCount: () => number;
  upgradeCount: () => number;
  storage: () => ReportStore | undefined;
} {
  const databases = new Map<string, { db: FakeDb; version: number }>();
  const counts = { open: 0, upgrade: 0 };

  const factory: unknown = {
    open(name: string, version: number): OpenRequest {
      counts.open += 1;
      const listeners = new Map<string, Handler[]>();
      const request: OpenRequest = {
        result: null,
        error: null,
        addEventListener(type: string, cb: Handler): void {
          const list = listeners.get(type) ?? [];
          list.push(cb);
          listeners.set(type, list);
        },
      };
      const dispatch = (type: string, event?: { oldVersion: number }): void => {
        if (type === "upgradeneeded") counts.upgrade += 1;
        for (const cb of listeners.get(type) ?? []) cb(event ?? undefined);
      };

      queueMicrotask(() => {
        const existing = databases.get(name);
        if (existing === undefined) {
          const db = new FakeDb();
          databases.set(name, { db, version });
          request.result = db;
          dispatch("upgradeneeded", { oldVersion: 0 });
          dispatch("success");
          return;
        }
        if (existing.version < version) {
          existing.version = version;
          request.result = existing.db;
          dispatch("upgradeneeded", { oldVersion: existing.version });
          dispatch("success");
          return;
        }
        request.result = existing.db;
        dispatch("success");
      });

      return request;
    },
  };

  return {
    factory,
    openCount: () => counts.open,
    upgradeCount: () => counts.upgrade,
    storage: () => databases.get(dbName)?.db.stores.get("kv"),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVote(seed: { id: string; planillaId: string; score: number }): LocalVote {
  return {
    id: seed.id,
    planillaId: seed.planillaId,
    nightId: "night-1",
    comparsaId: "cmp-1",
    rubroId: "rubro-1",
    itemId: "item-1",
    candidateId: "cand-1",
    score: seed.score,
    idempotencyKey: `key-${seed.id}`,
    syncState: "PENDING",
    updatedAt: "2027-01-01T00:00:00.000Z",
  };
}

function makePlanilla(id: string): LocalPlanilla {
  return {
    id,
    nightId: "night-1",
    clientRef: `plan-${id}`,
    status: "BORRADOR",
    updatedAt: "2027-01-01T00:00:00.000Z",
  };
}

const fakeClock: Clock = {
  nowMs: () => 1_700_000_000_000,
  nowIso: () => new Date(1_700_000_000_000).toISOString(),
  iso: (ms) => new Date(ms).toISOString(),
  setTimeout: (cb) => setTimeout(cb, 0),
  clearTimeout: (handle) => clearTimeout(handle as number),
};

const dbFactoryOf = (factory: unknown): IDBFactory =>
  factory as IDBFactory;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("IndexedDbAdapter (KVStorage sobre IndexedDB)", () => {
  it("respeta la interfaz síncrona y persiste con flush", async () => {
    const { factory, storage } = makeFactory();
    const kv = createIndexedDbAdapter("vote2027", { dbFactory: dbFactoryOf(factory) });

    kv.set("a", "1");
    kv.set("b", "2");
    expect(kv.get("a")).toBe("1");
    await kv.flush();

    expect(storage()?.entries.get("a")?.value).toBe("1");
    expect(storage()?.entries.get("b")?.value).toBe("2");
    expect(kv.list("")).toEqual(["a", "b"]);

    kv.remove("a");
    expect(kv.get("a")).toBeNull();
    await kv.flush();
    expect(storage()?.entries.has("a")).toBe(false);
  });

  it("list() devuelve el sufijo sin el prefijo", async () => {
    const { factory } = makeFactory();
    const kv = createIndexedDbAdapter("vote2027", { dbFactory: dbFactoryOf(factory) });

    kv.set("v2027.planilla.p-1", JSON.stringify({ id: "p-1" }));
    kv.set("v2027.votes.p-1", JSON.stringify([]));
    kv.set("otro.k1", "x");

    expect(kv.list("v2027.planilla.")).toEqual(["p-1"]);
    expect(kv.list("v2027.")).toEqual(["planilla.p-1", "votes.p-1"]);
    expect(kv.list("")).toEqual(["v2027.planilla.p-1", "v2027.votes.p-1", "otro.k1"]);
  });

  it("ready() hidrata el estado persistido (recuperación tras reinicio)", async () => {
    const { factory } = makeFactory();
    const kv1 = createIndexedDbAdapter("vote2027", { dbFactory: dbFactoryOf(factory) });
    kv1.set("clave", "valor-persistido");
    await kv1.flush();

    const kv2 = createIndexedDbAdapter("vote2027", { dbFactory: dbFactoryOf(factory) });
    expect(kv2.get("clave")).toBeNull(); // aún no hidratado
    await kv2.ready();
    expect(kv2.get("clave")).toBe("valor-persistido");
  });

  it("la cola offline sobrevive a un reinicio con el mismo almacenamiento", async () => {
    const { factory } = makeFactory();
    const kv1 = createIndexedDbAdapter("vote2027", { dbFactory: dbFactoryOf(factory) });
    const store1 = new OfflineStore(kv1);
    const connectivity1 = createManualConnectivity(false);
    const manager1 = new SyncManager({
      store: store1,
      transport: { syncPlanillas: async () => ({ ok: false, kind: "NETWORK" }) },
      connectivity: connectivity1,
      clock: fakeClock,
      backoff: { baseMs: 1000, maxMs: 60000 },
    });
    await manager1.enqueuePlanilla(makePlanilla("p-1"), [
      makeVote({ id: "v-1", planillaId: "p-1", score: 8 }),
    ]);
    await kv1.flush();

    const kv2 = createIndexedDbAdapter("vote2027", { dbFactory: dbFactoryOf(factory) });
    await kv2.ready();
    const store2 = new OfflineStore(kv2);
    expect(store2.loadPlanilla("p-1")).not.toBeNull();
    expect(store2.loadVote("p-1", "v-1")?.score).toBe(8);
    expect(store2.listOperations().map((op) => op.state)).toEqual(["PENDING"]);
  });

  it("v1 crea el object store en el primer open (migración no destructiva)", async () => {
    const { factory, upgradeCount } = makeFactory();
    const kv = createIndexedDbAdapter("vote2027", { dbFactory: dbFactoryOf(factory) });
    kv.set("k", "v");
    await kv.flush();
    expect(upgradeCount()).toBe(1);
  });

  it("reporta errores de escritura vía onError sin perder el espejo", async () => {
    const { factory, storage } = makeFactory();
    const onError = vi.fn();
    const kv = createIndexedDbAdapter("vote2027", { dbFactory: dbFactoryOf(factory), onError });

    kv.set("k", "v");
    await kv.flush();
    storage()!.failWrite = true;

    kv.set("k2", "v2");
    expect(kv.get("k2")).toBe("v2"); // el espejo sigue sirviendo
    await kv.flush();
    expect(onError).toHaveBeenCalled();
  });

  it("reporta errores de lectura al hidratar sin romper la sesión", async () => {
    const { factory, storage } = makeFactory();
    const kv1 = createIndexedDbAdapter("vote2027", { dbFactory: dbFactoryOf(factory) });
    kv1.set("k", "v");
    await kv1.flush();

    storage()!.failGetAll = true;
    const onError = vi.fn();
    const kv2 = createIndexedDbAdapter("vote2027", { dbFactory: dbFactoryOf(factory), onError });
    await kv2.ready();
    expect(onError).toHaveBeenCalled();
    expect(kv2.get("k")).toBeNull(); // sin datos, pero funcional
    kv2.set("nuevo", "x");
    expect(kv2.get("nuevo")).toBe("x");
  });

  it("funciona en memoria si IndexedDB no está disponible", async () => {
    const kv = createIndexedDbAdapter("vote2027"); // sin dbFactory y sin indexedDB global
    kv.set("k", "v");
    expect(kv.get("k")).toBe("v");
    await kv.ready();
    await kv.flush();
  });
});