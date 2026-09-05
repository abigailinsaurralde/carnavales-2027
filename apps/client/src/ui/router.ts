export type AdminSection =
  | "overview"
  | "comparsas"
  | "rubros"
  | "candidates"
  | "nights"
  | "assignments";

export type Route =
  | { name: "login" }
  | { name: "home" }
  | { name: "planilla"; planillaId: string }
  | { name: "admin"; section: AdminSection };

export interface Router {
  get(): Route;
  navigate(route: Route): void;
  subscribe(listener: () => void): () => void;
}

const ADMIN_SECTIONS: readonly AdminSection[] = [
  "overview",
  "comparsas",
  "rubros",
  "candidates",
  "nights",
  "assignments",
];

function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, "");
  const parts = raw.split("/").filter((s) => s !== "");
  if (parts.length === 0) return { name: "home" };
  if (parts[0] === "login") return { name: "login" };
  if (parts[0] === "planillas" && parts[1] !== undefined) {
    return { name: "planilla", planillaId: decodeURIComponent(parts[1]) };
  }
  if (parts[0] === "admin") {
    const section =
      parts[1] !== undefined &&
      (ADMIN_SECTIONS as readonly string[]).includes(parts[1])
        ? (parts[1] as AdminSection)
        : "overview";
    return { name: "admin", section };
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
            : route.name === "admin"
              ? route.section === "overview"
                ? "#/admin"
                : `#/admin/${route.section}`
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