import { describe, expect, it } from "vitest";
import { friendlyError } from "../src/ui/vocab.js";

/**
 * Vocabulario de presentación (FASE B).
 *
 * Verifica el mapeo de códigos de error del backend a mensajes accionables
 * para el juez. Se testea la función pura `friendlyError` (mismo patrón que
 * sheet.test.ts: lógica de presentación pura, sin DOM).
 */
describe("friendlyError — mapeo de códigos a mensajes", () => {
  it("traduce NIGHT_WINDOW_CLOSED a un mensaje de ventana de votación cerrada", () => {
    const msg = friendlyError("HTTP", { error: { code: "NIGHT_WINDOW_CLOSED" } });
    expect(msg).toBe("La ventana de votación de la noche está cerrada.");
  });

  it("no confunde NIGHT_WINDOW_CLOSED con inmutabilidad (PLANILLA_NOT_EDITABLE / VOTE_CONFIRMED_IMMUTABLE)", () => {
    // La ventana cerrada y la confirmación previa son mensajes distintos.
    expect(friendlyError("HTTP", { error: { code: "PLANILLA_NOT_EDITABLE" } })).toBe(
      "La planilla ya está confirmada. No se puede modificar.",
    );
    expect(friendlyError("HTTP", { error: { code: "VOTE_CONFIRMED_IMMUTABLE" } })).toBe(
      "La planilla ya está confirmada. No se puede modificar.",
    );
    expect(friendlyError("HTTP", { error: { code: "NIGHT_WINDOW_CLOSED" } })).toBe(
      "La ventana de votación de la noche está cerrada.",
    );
  });

  it("mantiene el fallback ante un error de infraestructura sin código conocido", () => {
    expect(friendlyError("NETWORK", {})).toBe(
      "Sin conexión. El cambio quedó guardado en este dispositivo y se sincronizará cuando haya conexión.",
    );
  });
});
