/**
 * Design tokens del Frontend de VOTACIONES2027.
 *
 * Fuente única de las decisiones visuales existentes (colores, espaciado,
 * radios, tipografía, targets táctiles, capas z, breakpoints y moción).
 * `../styles.css` consume los mismos valores como custom properties (una
 * capa deriva de la otra; no deben divergir).
 *
 * REGLA: ninguna de estas constantes introduce una regla de negocio; solo
 * sistematiza decisiones de presentación ya existentes en `styles.css`.
 */

export const colors = {
  bg: "#0c0f16",
  surface: "#141926",
  surface2: "#1b2231",
  border: "#262f42",
  text: "#e9edf4",
  muted: "#98a2b3",
  primary: "#7aa2ff",
  primaryText: "#0c111c",
  ok: "#3fd68f",
  warn: "#f6c453",
  error: "#f27c7c",
  info: "#56b7f0",
  overlay: "rgba(4, 6, 10, 0.72)",
  dangerText: "#2a0a0a",
} as const;

/** Versiones suavizadas (fondos de badges/banners) de los tonos de estado. */
export const tints = {
  ok: "rgba(63, 214, 143, 0.12)",
  warn: "rgba(246, 196, 83, 0.12)",
  error: "rgba(242, 124, 124, 0.12)",
  info: "rgba(86, 183, 240, 0.12)",
  primary: "rgba(122, 162, 255, 0.15)",
} as const;

/** Escala de espaciado (px). */
export const spacing = {
  none: 0,
  s1: 4,
  s2: 8,
  s3: 12,
  s4: 16,
  s5: 24,
  s6: 32,
} as const;

/** Radios de borde (px). */
export const radius = {
  sm: 10,
  md: 12,
  lg: 14,
  pill: 999,
} as const;

/** Tipografía base. */
export const typography = {
  fontFamily:
    'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
  fontSize: 17,
  lineHeight: 1.45,
} as const;

/** Tamaño mínimo de control táctil (px). */
export const touch = { min: 48 } as const;

/** Escala de capas (z-index). */
export const zIndex = { topbar: 10, overlay: 40, notice: 60 } as const;

/** Breakpoints (px). */
export const breakpoints = { medium: 640, contentMax: 720 } as const;

/** Aro de foco accesible y duraciones de transición. */
export const focus = { ringWidth: 2, offset: 2 } as const;
export const motion = { fastMs: 150, slowMs: 300 } as const;