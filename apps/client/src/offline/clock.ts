/**
 * Reloj inyectable: el motor offline depende de esta interfaz (y no de las
 * APIs globales) para poder simular el tiempo en tests y reemplazar timers.
 */
export interface Clock {
  nowMs(): number;
  nowIso(): string;
  iso(ms: number): string;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const systemClock: Clock = {
  nowMs: () => Date.now(),
  nowIso: () => new Date().toISOString(),
  iso: (ms) => new Date(ms).toISOString(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as number | undefined),
};