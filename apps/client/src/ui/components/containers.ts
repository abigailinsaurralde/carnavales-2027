import { h } from "../dom.js";
import type { Child } from "../dom.js";

/** Contenedor de superficie `.card` (reutilizado por planillas y paneles). */
export function card(children: Child | Child[], className?: string): HTMLElement {
  return h(
    "div",
    { className: className === undefined ? "card" : `card ${className}` },
    children,
  );
}

export interface EmptyStateOptions {
  text: string;
  action?: HTMLElement;
}

/** Estado vacío con mensaje accionable y acción opcional. */
export function emptyState(options: EmptyStateOptions): HTMLElement {
  return h("div", { className: "empty-state" }, [
    h("p", { className: "muted" }, options.text),
    ...(options.action === undefined ? [] : [options.action]),
  ]);
}

/** Indicador de carga con `role=status` y etiqueta de usuario. */
export function loader(label = "Cargando"): HTMLElement {
  return h("div", { className: "loader", role: "status", ariaLabel: label }, [
    h("span", { className: "loader-spin" }),
    h("span", { className: "loader-label" }, label),
  ]);
}