import { describe, expect, it } from "vitest";
import {
  breakpoints,
  colors,
  focus,
  motion,
  radius,
  spacing,
  tints,
  touch,
  typography,
  zIndex,
} from "../src/theme/index.js";
import {
  buttonClass,
  type ButtonVariant,
} from "../src/ui/components/controls.js";
import {
  connectionInfo,
  syncInfo,
  toneClass,
  type Tone,
} from "../src/ui/components/badges.js";
import { noticeClass, type NoticeTone } from "../src/ui/components/overlay.js";

/**
 * Design tokens y helpers de presentación puros (FASE C).
 *
 * Se testea la capa derivada de `styles.css`: constantes y funciones puras de
 * mapeo de estado → (clase, etiqueta, tono). Los builders de DOM no se testean
 * aquí porque el entorno de tests es Node sin DOM (no se añaden dependencias);
 * su markup se verifica con el resto de la app mediante typecheck y build.
 */

describe("theme/index — tokens", () => {
  it("expone la paleta existente sin inventar colores nuevos", () => {
    expect(colors.bg).toBe("#0c0f16");
    expect(colors.primary).toBe("#7aa2ff");
    expect(colors.overlay).toBe("rgba(4, 6, 10, 0.72)");
  });

  it("mantiene la escala de tintes consistente con la paleta", () => {
    expect(tints.warn).toBe("rgba(246, 196, 83, 0.12)");
    expect(tints.primary).toBe("rgba(122, 162, 255, 0.15)");
  });

  it("define espaciado, radio y moción como escala creciente", () => {
    expect(spacing.s1).toBe(4);
    expect(spacing.s4).toBe(16);
    expect(radius.sm).toBe(10);
    expect(radius.lg).toBe(14);
    expect(radius.pill).toBe(999);
    expect(motion.fastMs).toBeLessThan(motion.slowMs);
  });

  it("define target táctil, capas y breakpoints usados por la app", () => {
    expect(touch.min).toBe(48);
    expect(zIndex).toEqual({ topbar: 10, overlay: 40, notice: 60 });
    expect(breakpoints.medium).toBe(640);
    expect(breakpoints.contentMax).toBe(720);
    expect(focus.ringWidth).toBe(2);
  });

  it("define tipografía base legible", () => {
    expect(typography.fontSize).toBe(17);
    expect(typography.lineHeight).toBe(1.45);
    expect(typography.fontFamily).toContain("system-ui");
  });
});

describe("components — helpers puros de presentación", () => {
  it("toneClass mapea cada tono a su clase CSS", () => {
    const tones: Tone[] = ["ok", "warn", "error", "info", "neutral"];
    expect(tones.map(toneClass)).toEqual([
      "tone-ok",
      "tone-warn",
      "tone-error",
      "tone-info",
      "tone-neutral",
    ]);
  });

  it("buttonClass compone variante y bloque", () => {
    const variants: ButtonVariant[] = ["primary", "secondary", "ghost", "danger"];
    expect(variants.map((v) => buttonClass(v))).toEqual([
      "btn btn-primary",
      "btn btn-secondary",
      "btn btn-ghost",
      "btn btn-danger",
    ]);
    expect(buttonClass("primary", true)).toBe("btn btn-primary btn-block");
  });

  it("connectionInfo distingue en línea / sin conexión", () => {
    expect(connectionInfo(true)).toEqual({ label: "En línea", tone: "ok" });
    expect(connectionInfo(false)).toEqual({ label: "Sin conexión", tone: "warn" });
  });

  it("syncInfo presenta el estado de la cola sin inventar reglas", () => {
    const base = { online: true, pending: 0, syncing: 0, synced: 5, failed: 0, blocked: 0, retryableFailed: 0 };
    expect(syncInfo(base)).toEqual({ label: "Sincronizado", tone: "ok" });
    expect(syncInfo({ ...base, pending: 2 })).toEqual({
      label: "Cambios sin sincronizar",
      tone: "warn",
    });
    expect(syncInfo({ ...base, syncing: 1 })).toEqual({
      label: "Sincronizando",
      tone: "info",
    });
    expect(syncInfo({ ...base, failed: 1 })).toEqual({
      label: "Revisión pendiente",
      tone: "error",
    });
    expect(syncInfo({ ...base, online: false })).toEqual({
      label: "Sin conexión",
      tone: "warn",
    });
  });

  it("noticeClass mapea a las clases de toast existentes", () => {
    const tones: NoticeTone[] = ["info", "success", "error"];
    expect(tones.map(noticeClass)).toEqual([
      "notice notice-info",
      "notice notice-success",
      "notice notice-error",
    ]);
  });
});