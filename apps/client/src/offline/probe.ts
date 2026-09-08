import type { Connectivity } from "./connectivity.js";
import { systemClock, type Clock } from "./clock.js";

/**
 * Sondeo (probe) del backend: determina si el servidor está alcanzable a
 * nivel HTTP y lo comunica a `Connectivity`.
 *
 * Propósito: `navigator.onLine` solo informa del enlace de red del
 * dispositivo; una red "arriba" no implica que el backend responda. F5/F6 en
 * la hoja de sincronización separan "dispositivo conectado" (red) de
 * "backend alcanzable" (HTTP). El probe aporta esa segunda señal y la
 * inyecta en `Connectivity.setOnline`, que ya fue diseñada para que la capa
 * de aplicación corrija el estado con señales propias.
 *
 * Semántica de alcanzabilidad:
 *  - CUALQUIER respuesta HTTP (200, 404, 500, ...) → backend alcanzable.
 *    Nunca se usa `response.ok`, porque un 404/500 demuestra conectividad
 *    HTTP funcional aunque la operación haya fallado.
 *  - Fallo de red (fetch rechaza) → backend NO alcanzable.
 *  - Timeout (abort del `AbortController`) → backend NO alcanzable.
 *
 * Integración: `createBackendProbe` sondea periódicamente `GET /health` con
 * timeout propio, evita probes solapados y actualiza `Connectivity` con cada
 * resultado. Al volver el backend, `setOnline(true)` dispara la suscripción
 * existente del `SyncManager` y reanuda el drenado.
 */

export interface ProbeBackendOptions {
  timeoutMs?: number;
  fetchFn?: (url: string, init: RequestInit) => Promise<Response>;
}

/**
 * Comprueba si `url` devuelve una respuesta HTTP dentro del timeout.
 *
 * Devuelve `true` ante cualquier respuesta del servidor y `false` ante fallo
 * de red o timeout. No corrige estado ni dispara efectos: es la unidad pura
 * de medición, comprobable en tests con `fetchFn` inyectado.
 */
export async function probeBackend(
  url: string,
  options: ProbeBackendOptions = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 4000;
  const fetchFn =
    options.fetchFn ?? ((u: string, init: RequestInit) => fetch(u, init));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    try {
      await fetchFn(url, { method: "GET", signal: controller.signal });
      return true;
    } catch {
      return false;
    }
  } finally {
    clearTimeout(timer);
  }
}

export interface BackendProbeOptions {
  baseUrl: string;
  connectivity: Connectivity;
  intervalMs?: number;
  timeoutMs?: number;
  path?: string;
  fetchFn?: (url: string, init: RequestInit) => Promise<Response>;
  clock?: Clock;
}

/** Sondeo controlado del backend: `start`/`stop`/`probeNow`. */
export interface BackendProbe {
  start(): void;
  stop(): void;
  probeNow(): Promise<boolean>;
}

/**
 * Probe periódico conectado a `Connectivity`.
 *
 * - `start()` sondea de inmediato y luego en intervalos de `intervalMs`.
 * - `stop()` cancela el timer; un probe en vuelo termina sin reprogramar.
 * - `probeNow()` fuerza una medición; si ya hay una en curso, devuelve la
 *   misma (sin probes solapados y sin timers duplicados).
 * - `start()` repetido es idempotente (no duplica loops ni timers).
 */
export function createBackendProbe(options: BackendProbeOptions): BackendProbe {
  const baseUrl = options.baseUrl;
  const path = options.path ?? "/health";
  const intervalMs = options.intervalMs ?? 20000;
  const timeoutMs = options.timeoutMs ?? 4000;
  const fetchFn =
    options.fetchFn ?? ((u: string, init: RequestInit) => fetch(u, init));
  const clock = options.clock ?? systemClock;
  const connectivity = options.connectivity;

  let running = false;
  let inFlight: Promise<boolean> | null = null;
  let timer: unknown = undefined;

  const probeOnce = async (): Promise<boolean> => {
    const reachable = await probeBackend(`${baseUrl}${path}`, {
      timeoutMs,
      fetchFn,
    });
    connectivity.setOnline(reachable);
    return reachable;
  };

  const schedule = (): void => {
    if (!running || timer !== undefined) return;
    timer = clock.setTimeout(() => {
      timer = undefined;
      if (running) void probeNow();
    }, intervalMs);
  };

  const probeNow = (): Promise<boolean> => {
    if (inFlight !== null) return inFlight;
    inFlight = probeOnce().finally(() => {
      inFlight = null;
      if (running) schedule();
    });
    return inFlight;
  };

  return {
    start() {
      if (running) return;
      running = true;
      void probeNow();
    },
    stop() {
      running = false;
      if (timer !== undefined) {
        clock.clearTimeout(timer);
        timer = undefined;
      }
    },
    probeNow,
  };
}