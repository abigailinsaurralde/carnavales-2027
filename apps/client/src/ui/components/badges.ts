import type { SyncSnapshot } from "../../offline/index.js";
import { h } from "../dom.js";

/** Tonos de estado para badges/banners (clases `.tone-*` de `../styles.css`). */
export type Tone = "ok" | "warn" | "error" | "info" | "neutral";

/** Clase de tono (función pura, comprobable). */
export function toneClass(tone: Tone): string {
  return tone === "neutral" ? "tone-neutral" : `tone-${tone}`;
}

export interface BadgeOptions {
  text: string;
  tone?: Tone;
}

/**
 * Etiqueta de estado compacta. `text` es siempre lenguaje de usuario
 * (`../ui/vocab.ts`); nunca un ID técnico.
 */
export function badge(options: BadgeOptions): HTMLSpanElement {
  const el = h(
    "span",
    { className: `badge ${toneClass(options.tone ?? "neutral")}` },
    options.text,
  );
  return el as HTMLSpanElement;
}

/** Estado de conexión → (etiqueta, tono) — función pura, comprobable. */
export function connectionInfo(online: boolean): { label: string; tone: Tone } {
  return online
    ? { label: "En línea", tone: "ok" }
    : { label: "Sin conexión", tone: "warn" };
}

/** Badge de conexión con punto de color (markup `.badge` + `.dot`). */
export function connectionBadge(online: boolean): HTMLElement {
  const { label, tone } = connectionInfo(online);
  const el = badge({ text: label, tone });
  el.prepend(
    h("span", {
      className: `dot ${online ? "dot-online" : "dot-offline"}`,
    }),
  );
  return el;
}

/**
 * Snapshot global del motor offline → (etiqueta, tono) — función pura,
 * comprobable. Presenta el estado de la COLAm; no decide reglas de negocio.
 */
export function syncInfo(snapshot: SyncSnapshot): { label: string; tone: Tone } {
  if (!snapshot.online) return { label: "Sin conexión", tone: "warn" };
  if (snapshot.failed > 0) return { label: "Revisión pendiente", tone: "error" };
  if (snapshot.syncing > 0) return { label: "Sincronizando", tone: "info" };
  if (snapshot.pending > 0) return { label: "Cambios sin sincronizar", tone: "warn" };
  return { label: "Sincronizado", tone: "ok" };
}

/** Badge global de sincronización a partir del snapshot del offline engine. */
export function syncBadge(snapshot: SyncSnapshot): HTMLElement {
  const { label, tone } = syncInfo(snapshot);
  return badge({ text: label, tone });
}