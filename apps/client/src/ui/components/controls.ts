import { h } from "../dom.js";
import type { Child } from "../dom.js";

/**
 * Variantes de botón. Coinciden con las clases CSS `.btn .btn-<variant>`
 * existentes en `../styles.css`.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonOptions {
  label: Child;
  variant?: ButtonVariant;
  block?: boolean;
  type?: "button" | "submit";
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
  onClick?: (event: MouseEvent) => void;
}

/** Clase de presentación de un botón (función pura, comprobable). */
export function buttonClass(variant: ButtonVariant, block = false): string {
  return `btn btn-${variant}${block ? " btn-block" : ""}`;
}

/**
 * Botón normalizado con estilo de sistema, target táctil (`--touch-min`) y
 * texto en lenguaje de usuario. `label` nunca es un ID técnico.
 */
export function button(options: ButtonOptions): HTMLButtonElement {
  const props: Record<string, unknown> = {
    type: options.type ?? "button",
    className: buttonClass(options.variant ?? "secondary", options.block ?? false),
  };
  if (options.disabled !== undefined) props.disabled = options.disabled;
  if (options.title !== undefined) props.title = options.title;
  if (options.ariaLabel !== undefined) props.ariaLabel = options.ariaLabel;
  if (options.onClick !== undefined) props.onClick = options.onClick;

  const el = h("button", props as Parameters<typeof h>[1], options.label);
  return el as HTMLButtonElement;
}