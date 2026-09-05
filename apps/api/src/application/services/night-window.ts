import type { Night } from "@votaciones2027/shared-types";
import { ConflictError } from "../../errors/app-error.js";

/**
 * Evaluación de la ventana temporal de votación de una noche.
 *
 * Semántica (PEND-114 técnico; PEND-104 decidido por el usuario):
 *  - El servidor es la autoridad temporal (reloj del servidor, no del cliente).
 *  - Mientras `night.startsAt` o `night.endsAt` sea undefined (no hay fechas
 *    oficiales, PEND-110) NO existe ventana que aplicar: esta función no hace
 *    nada.
 *  - Cuando la ventana está definida, una escritura de voto (o confirmación)
 *    ANTES de `startsAt` o DESPUÉS de `endsAt` se rechaza con
 *    `ConflictError` y código `NIGHT_WINDOW_CLOSED`.
 *  - La pérdida de conectividad NO extiende la ventana.
 */
export function assertNightWindowOpen(night: Night, now: Date): void {
  if (night.startsAt === undefined || night.endsAt === undefined) {
    // Sin fechas oficiales no hay ventana que aplicar.
    return;
  }

  const start = new Date(night.startsAt);
  const end = new Date(night.endsAt);

  if (now < start) {
    throw new ConflictError(
      "Night voting window has not started",
      "NIGHT_WINDOW_CLOSED",
    );
  }

  if (now > end) {
    throw new ConflictError(
      "Night voting window is closed",
      "NIGHT_WINDOW_CLOSED",
    );
  }
}
