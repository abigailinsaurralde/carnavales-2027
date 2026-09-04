export interface BackoffOptions {
  /** Espera base del primer reintento (ms). */
  baseMs: number;
  /** Tope máximo del intervalo (ms). */
  maxMs: number;
  /** Fuente de aleatoriedad inyectable (tests deterministas). */
  random?: () => number;
}

/**
 * Retraso para el reintento `attempts`-ésimo (1-based): crecimiento
 * exponencial `base * 2^(attempts-1)` con tope `maxMs` y jitter "equal" (la
 * mitad fija + mitad aleatoria), que garantiza un mínimo de espera y reparte
 * los reintentos de clientes simultáneos.
 */
export function nextRetryDelayMs(
  attempts: number,
  options: BackoffOptions,
): number {
  const random = options.random ?? Math.random;
  const exponent = Math.max(0, attempts - 1);
  const cap = Math.min(options.maxMs, options.baseMs * 2 ** exponent);
  const jitter = random();
  const delay = Math.floor(cap / 2 + jitter * (cap / 2));
  return Math.min(options.maxMs, Math.max(1, delay));
}