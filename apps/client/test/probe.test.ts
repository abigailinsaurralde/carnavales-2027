import { describe, expect, it } from "vitest";
import type { Clock } from "../src/offline/clock.js";
import { createManualConnectivity } from "../src/offline/connectivity.js";
import {
  createBackendProbe,
  probeBackend,
} from "../src/offline/probe.js";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

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
  pendingCount(): number {
    return this.timers.size;
  }
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

type ScriptedHandler = () => Promise<Response>;

function makeFetchStub(): {
  fetchFn: (url: string, init: RequestInit) => Promise<Response>;
  readonly calls: number;
  script(handler: ScriptedHandler): void;
} {
  let calls = 0;
  const handlers: ScriptedHandler[] = [];
  return {
    get calls() {
      return calls;
    },
    script(handler) {
      handlers.push(handler);
    },
    async fetchFn(url, init) {
      calls += 1;
      const handler = handlers.shift();
      if (handler === undefined) throw new Error("no scripted response");
      return handler();
    },
  };
}

// ---------------------------------------------------------------------------
// probeBackend
// ---------------------------------------------------------------------------

describe("probeBackend", () => {
  it("HTTP 200 → true (backend alcanzable)", async () => {
    const stub = makeFetchStub();
    stub.script(() => Promise.resolve(new Response("ok", { status: 200 })));
    expect(await probeBackend("http://srv/health", { fetchFn: stub.fetchFn })).toBe(true);
  });

  it("HTTP 404 → true (conectividad HTTP existe aunque la ruta no)", async () => {
    const stub = makeFetchStub();
    stub.script(() => Promise.resolve(new Response("nope", { status: 404 })));
    // NO se usa response.ok como definición de conectividad.
    expect(await probeBackend("http://srv/health", { fetchFn: stub.fetchFn })).toBe(true);
  });

  it("HTTP 500 → true (responde el servidor, falló la operación)", async () => {
    const stub = makeFetchStub();
    stub.script(() => Promise.resolve(new Response("boom", { status: 500 })));
    expect(await probeBackend("http://srv/health", { fetchFn: stub.fetchFn })).toBe(true);
  });

  it("network failure → false (backend no alcanzable)", async () => {
    const stub = makeFetchStub();
    stub.script(() => Promise.reject(new TypeError("network down")));
    expect(await probeBackend("http://srv/health", { fetchFn: stub.fetchFn })).toBe(false);
  });

  it("timeout → false (backend no responde a tiempo)", async () => {
    const fetchFn = async (_url: string, init: RequestInit): Promise<Response> => {
      await new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      });
      throw new Error("unreachable");
    };
    expect(await probeBackend("http://srv/health", { timeoutMs: 20, fetchFn })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createBackendProbe
// ---------------------------------------------------------------------------

describe("createBackendProbe", () => {
  it("probeNow actualiza Connectivity (cualquier HTTP → online, fallo → offline)", async () => {
    const connectivity = createManualConnectivity(false);
    const stub = makeFetchStub();
    const probe = createBackendProbe({
      baseUrl: "http://srv",
      connectivity,
      fetchFn: stub.fetchFn,
    });

    stub.script(() => Promise.resolve(new Response("ok", { status: 200 })));
    expect(await probe.probeNow()).toBe(true);
    expect(connectivity.isOnline()).toBe(true);

    stub.script(() => Promise.reject(new Error("down")));
    expect(await probe.probeNow()).toBe(false);
    expect(connectivity.isOnline()).toBe(false);
  });

  it("start sondea de inmediato; el backend que vuelve recupera Connectivity", async () => {
    const connectivity = createManualConnectivity(true);
    const stub = makeFetchStub();
    const clock = new FakeClock();
    stub.script(() => Promise.reject(new Error("down")));
    const probe = createBackendProbe({
      baseUrl: "http://srv",
      connectivity,
      fetchFn: stub.fetchFn,
      intervalMs: 2000,
      clock,
    });

    probe.start();
    await flush();
    expect(connectivity.isOnline()).toBe(false);
    expect(stub.calls).toBe(1);

    // El backend vuelve: el siguiente sondeo periódico lo detecta.
    stub.script(() => Promise.resolve(new Response("ok", { status: 200 })));
    clock.advance(2000);
    await flush();
    expect(stub.calls).toBe(2);
    expect(connectivity.isOnline()).toBe(true);

    probe.stop();
  });

  it("start repetido es idempotente y stop cancela el sondeo (sin fuga de timers)", async () => {
    const connectivity = createManualConnectivity(false);
    const stub = makeFetchStub();
    const clock = new FakeClock();
    stub.script(() => Promise.resolve(new Response("ok", { status: 200 })));
    stub.script(() => Promise.resolve(new Response("ok", { status: 200 })));
    const probe = createBackendProbe({
      baseUrl: "http://srv",
      connectivity,
      fetchFn: stub.fetchFn,
      intervalMs: 1000,
      clock,
    });

    probe.start();
    probe.start();
    probe.start();
    await flush();
    expect(stub.calls).toBe(1);
    expect(clock.pendingCount()).toBe(1);

    clock.advance(1000);
    await flush();
    expect(stub.calls).toBe(2);

    probe.stop();
    expect(clock.pendingCount()).toBe(0);
    const callsAfterStop = stub.calls;
    clock.advance(10000);
    await flush();
    expect(stub.calls).toBe(callsAfterStop);
  });

  it("evita probes solapados: la medición en curso se comparte", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const fetchFn = async (): Promise<Response> => {
      calls += 1;
      await gate;
      return new Response("ok", { status: 200 });
    };
    const connectivity = createManualConnectivity(false);
    const probe = createBackendProbe({
      baseUrl: "http://srv",
      connectivity,
      fetchFn,
    });

    const first = probe.probeNow();
    const second = probe.probeNow();
    expect(second).toBe(first);
    expect(calls).toBe(1);

    release();
    expect(await first).toBe(true);
    expect(calls).toBe(1);
    expect(connectivity.isOnline()).toBe(true);
  });

  it("stop() durante un probe en vuelo no reprograma timers ni deja loop activo", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const fetchFn = async (): Promise<Response> => {
      calls += 1;
      await gate;
      return new Response("ok", { status: 200 });
    };
    const clock = new FakeClock();
    const connectivity = createManualConnectivity(false);
    const probe = createBackendProbe({
      baseUrl: "http://srv",
      connectivity,
      fetchFn,
      intervalMs: 5000,
      clock,
    });

    // 1. Inicia el primer sondeo (queda en vuelo, pendiente del fetch).
    probe.start();
    expect(calls).toBe(1);
    expect(clock.pendingCount()).toBe(0);

    // 2/3. stop() durante el vuelo: no hay timer que agendar.
    probe.stop();
    expect(clock.pendingCount()).toBe(0);

    // 4. El fetch pendiente resuelve DESPUÉS del stop.
    release();
    await flush();

    // La medición en curso puede completarse y actualizar Connectivity,
    // pero su `finally` no debe reprogramar un nuevo sondeo (running=false).
    expect(connectivity.isOnline()).toBe(true);
    expect(clock.pendingCount()).toBe(0);

    // No queda loop activo ni timer duplicado tras varios intervalos.
    const callsAfterStop = calls;
    clock.advance(60000);
    await flush();
    expect(calls).toBe(callsAfterStop);
    expect(clock.pendingCount()).toBe(0);
  });
});