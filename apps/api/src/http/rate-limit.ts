/**
 * Rate limiting (S1.3) — fixed-window in-memory por IP y tier.
 *
 * Parámetros aprobados (D2/S1.3):
 *   - auth         10 req/min/IP   (POST /auth/login, /auth/access-token,
 *                                  /auth/access-token/login → protección de
 *                                  fuerza bruta sobre credenciales).
 *   - admin-write  60 req/min/IP   (POST/PUT en /admin/* → escrituras de la
 *                                  consola de administración).
 *   - default     300 req/min/IP   (resto de la API).
 *
 * Limitaciones documentadas:
 *   - Estado en memoria POR INSTANCIA de proceso: no es compartido entre
 *     réplicas. Para un despliegue multi-instancia debe usarse un almacén
 *     compartido (fuera del alcance de S1).
 *   - Clave por IP (`req.socket.remoteAddress`). No se procesan proxies
 *     adicionales (documentar en el despliegue).
 *   - Fixed window: ráfaga de hasta 2× el límite en el cruce entre ventanas
 *     (comportamiento aceptado del esquema propuesto y aprobado).
 *
 * El reloj es inyectable para tests deterministas. Sin dependencias externas.
 */

export type RateLimitTier = "auth" | "admin-write" | "default";

export interface RateLimiterOptions {
  windowMs: number;
  limits: Record<RateLimitTier, number>;
  now?: () => number;
}

export interface RateLimitCheck {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
}

interface WindowState {
  startedAt: number;
  count: number;
}

export interface RateLimiter {
  check(key: string): RateLimitCheck;
}

/**
 * Clasifica una petición en su tier de límite según método + path.
 * La clasificación es técnica (protección), NO define reglas de negocio.
 */
export function classifyTier(method: string, pathname: string): RateLimitTier {
  const path = pathname.split("?")[0] ?? "";
  if (path.startsWith("/auth/")) {
    return "auth";
  }
  if (path.startsWith("/admin/") && (method === "POST" || method === "PUT")) {
    return "admin-write";
  }
  return "default";
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const { windowMs, limits } = options;
  const now = options.now ?? ((): number => Date.now());
  const windows = new Map<string, WindowState>();

  const prune = (current: number): void => {
    for (const [key, state] of windows) {
      if (current - state.startedAt >= windowMs) windows.delete(key);
    }
  };

  return {
    check(key) {
      const current = now();
      prune(current);
      const tier = key.slice(key.indexOf("|") + 1) as RateLimitTier;
      const max = limits[tier] ?? 0;
      const state = windows.get(key);
      if (state === undefined || current - state.startedAt >= windowMs) {
        windows.set(key, { startedAt: current, count: 1 });
        return { allowed: 1 <= max, retryAfterSeconds: 0, remaining: Math.max(0, max - 1) };
      }
      state.count += 1;
      if (state.count <= max) {
        return {
          allowed: true,
          retryAfterSeconds: 0,
          remaining: Math.max(0, max - state.count),
        };
      }
      const retryAfterMs = windowMs - (current - state.startedAt);
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
        remaining: 0,
      };
    },
  };
}