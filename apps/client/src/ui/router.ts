export type Route =
  | { name: "login" }
  | { name: "home" }
  | { name: "planilla"; planillaId: string };

export interface Router {
  get(): Route;
  navigate(route: Route): void;
  subscribe(listener: () => void): () => void;
}

function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, "");
  const parts = raw.split("/").filter((s) => s !== "");
  if (parts.length === 0) return { name: "home" };
  if (parts[0] === "login") return { name: "login" };
  if (parts[0] === "planillas" && parts[1] !== undefined) {
    return { name: "planilla", planillaId: decodeURIComponent(parts[1]) };
  }
  return { name: "home" };
}

export function createRouter(): Router {
  const listeners = new Set<() => void>();

  const emit = (): void => {
    for (const listener of Array.from(listeners)) listener();
  };

  const handleHashChange = (): void => emit();

  if (typeof window !== "undefined") {
    window.addEventListener("hashchange", handleHashChange);
  }

  return {
    get() {
      return parseHash(
        typeof window !== "undefined" ? window.location.hash : "",
      );
    },
    navigate(route) {
      if (typeof window === "undefined") return;
      const target =
        route.name === "login"
          ? "#/login"
          : route.name === "planilla"
            ? `#/planillas/${encodeURIComponent(route.planillaId)}`
            : "#/";
      if (window.location.hash === target) {
        emit();
        return;
      }
      window.location.hash = target;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}