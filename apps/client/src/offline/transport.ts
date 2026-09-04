import type {
  SyncPlanillasRequest,
  SyncPlanillasResult,
} from "@votaciones2027/shared-types";

/**
 * Resultado discriminado de un intento de sincronización.
 *
 * `ok: false` distingue el tipo de fallo para decidir reintento:
 *  - NETWORK: sin respuesta (sin conexión, DNS, TLS...).
 *  - TIMEOUT: no se recibió respuesta a tiempo (puede haberse procesado).
 *  - HTTP: el servidor respondió con estado no exitoso.
 */
export type SyncTransportResult =
  | { ok: true; data: SyncPlanillasResult }
  | {
      ok: false;
      kind: "NETWORK" | "TIMEOUT" | "HTTP";
      status?: number;
      body?: unknown;
    };

export interface SyncTransport {
  syncPlanillas(request: SyncPlanillasRequest): Promise<SyncTransportResult>;
}

export interface HttpTransportOptions {
  baseUrl: string;
  getToken: () => string | null;
  timeoutMs?: number;
  fetchFn?: (url: string, init: RequestInit) => Promise<Response>;
}

export function createHttpTransport(options: HttpTransportOptions): SyncTransport {
  const timeoutMs = options.timeoutMs ?? 15000;
  const fetchFn =
    options.fetchFn ?? ((url: string, init: RequestInit) => fetch(url, init));

  return {
    async syncPlanillas(request) {
      const token = options.getToken();
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (token !== null) {
        headers["authorization"] = `Bearer ${token}`;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        let response: Response;
        try {
          response = await fetchFn(`${options.baseUrl}/judge/planillas/sync`, {
            method: "POST",
            headers,
            body: JSON.stringify(request),
            signal: controller.signal,
          });
        } catch (error) {
          if (
            typeof DOMException !== "undefined" &&
            error instanceof DOMException &&
            error.name === "AbortError"
          ) {
            return { ok: false, kind: "TIMEOUT" };
          }
          return { ok: false, kind: "NETWORK" };
        }

        if (response.status === 200) {
          const data = (await response.json()) as SyncPlanillasResult;
          return { ok: true, data };
        }

        let body: unknown;
        try {
          body = await response.json();
        } catch {
          body = undefined;
        }
        return { ok: false, kind: "HTTP", status: response.status, body };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}