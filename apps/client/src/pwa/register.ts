/**
 * Registro del Service Worker y flujo de actualización de la PWA.
 *
 * Solo se activa en producción (build de Vite). En desarrollo el SW no se
 * registra para no interferir con HMR / WebSocket del dev server.
 *
 * Flujo de actualización:
 *   1. Se detecta un nuevo SW instalado y en espera (updatefound → installed).
 *   2. Se notifica a los suscriptores (onUpdateAvailable).
 *   3. La aplicación puede presentar un prompt al usuario.
 *   4. Al confirmar, `applyUpdate()` envía SKIP_WAITING al SW.
 *   5. El SW se activa y `controllerchange` dispara un reload automático.
 */

export interface PwaManager {
  /**
   * Registra un callback que se invoca cuando hay un SW nuevo esperando.
   * Retorna una función de desuscripción.
   */
  onUpdateAvailable(callback: () => void): () => void;

  /** Indica que hay un update disponible (útil para estado inicial). */
  isUpdateAvailable(): boolean;

  /** Envía SKIP_WAITING al SW en espera y recarga la página. */
  applyUpdate(): void;
}

interface NavigatorLike {
  serviceWorker?: ServiceWorkerContainer;
}

interface WindowLike {
  location: { reload(): void };
  addEventListener?(type: string, listener: () => void): void;
}

interface RegisterOptions {
  swUrl?: string;
  scope?: string;
  nav?: NavigatorLike;
  win?: WindowLike;
  isProd?: boolean;
}

/**
 * Registra el service worker y retorna un `PwaManager` para gestionar
 * actualizaciones. Si el entorno no soporta SW o no es producción,
 * retorna `null`.
 */
export function registerPwa(options?: RegisterOptions): PwaManager | null {
  const nav = options?.nav ?? (typeof navigator !== "undefined" ? navigator : undefined);
  const win = options?.win ?? (typeof window !== "undefined" ? window : undefined);
  const swUrl = options?.swUrl ?? "/sw.js";
  const scope = options?.scope ?? "/";

  if (nav === undefined || win === undefined) return null;
  if (!("serviceWorker" in nav) || nav.serviceWorker === undefined) return null;

  const isProd =
    options?.isProd ??
    (import.meta as { env?: { PROD?: boolean } }).env?.PROD ??
    false;
  if (!isProd) return null;

  let waitingWorker: ServiceWorker | null = null;
  const listeners = new Set<() => void>();

  nav.serviceWorker
    .register(swUrl, { scope })
    .then((registration) => {
      // Verificar updates periódicamente (cada 60s cuando la pestaña está activa)
      const checkUpdate = (): void => {
        void registration.update();
      };
      setInterval(checkUpdate, 60_000);

      // Escuchar el evento updatefound del registration
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        if (installing === null) return;

        installing.addEventListener("statechange", () => {
          if (
            installing.state === "installed" &&
            nav.serviceWorker !== undefined &&
            nav.serviceWorker.controller !== null
          ) {
            // Hay un SW nuevo instalado y el actual sigue controlando
            waitingWorker = installing;
            emit();
          }
        });
      });
    })
    .catch(() => {
      // SW registration failed — no crítico para PMV
    });

  // Cuando un nuevo SW se activa, recargar para usar la nueva versión
  const onControllerChange = (): void => {
    win.location.reload();
  };
  nav.serviceWorker.addEventListener("controllerchange", onControllerChange);

  function emit(): void {
    for (const listener of Array.from(listeners)) listener();
  }

  return {
    onUpdateAvailable(callback) {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },

    isUpdateAvailable() {
      return waitingWorker !== null;
    },

    applyUpdate() {
      if (waitingWorker === null) return;
      waitingWorker.postMessage({ type: "SKIP_WAITING" });
      waitingWorker = null;
    },
  };
}
