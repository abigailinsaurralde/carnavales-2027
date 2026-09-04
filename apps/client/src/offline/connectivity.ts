/**
 * Estado de conectividad del dispositivo.
 *
 * `setOnline` permite a la capa de aplicación corregir el estado según
 * señales propias (p. ej. una solicitud fallida), porque `navigator.onLine`
 * por sí solo no garantiza que el servidor esté alcanzable. Los suscriptores
 * se notifican solo ante cambios de estado.
 */
export interface Connectivity {
  isOnline(): boolean;
  setOnline(next: boolean): void;
  subscribe(listener: () => void): () => void;
}

export function createBrowserConnectivity(): Connectivity {
  let online =
    typeof navigator !== "undefined" ? navigator.onLine : true;
  const listeners = new Set<() => void>();

  const emit = (): void => {
    for (const listener of Array.from(listeners)) listener();
  };

  const setOnline = (next: boolean): void => {
    if (online !== next) {
      online = next;
      emit();
    }
  };

  const handleOnline = (): void => setOnline(true);
  const handleOffline = (): void => setOnline(false);

  if (typeof window !== "undefined") {
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
  }

  return {
    isOnline: () => online,
    setOnline,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Estado de conexión controlado manualmente (tests, simulación). */
export function createManualConnectivity(initialOnline = true): Connectivity {
  let online = initialOnline;
  const listeners = new Set<() => void>();

  const emit = (): void => {
    for (const listener of Array.from(listeners)) listener();
  };

  return {
    isOnline: () => online,
    setOnline(next) {
      if (online !== next) {
        online = next;
        emit();
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}