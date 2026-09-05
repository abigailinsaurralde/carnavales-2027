import type { Night } from "@votaciones2027/shared-types";

/**
 * Escritura de la ventana/calendario de una noche (Slice 1).
 *
 * `date`, `startsAt` y `endsAt` admiten tres casos:
 *   - ausente: el valor NO se modifica;
 *   - string: el valor se fija;
 *   - null: el valor se limpia (vuelve a NULL en BD → el servidor deja de
 *     aplicar la ventana, PEND-114; sin inventar fechas oficiales, PEND-110).
 */
export type NightPatch = {
  date?: string | null | undefined;
  startsAt?: string | null | undefined;
  endsAt?: string | null | undefined;
};

export interface AdminNightRepository {
  updateNight(id: string, patch: NightPatch): Promise<Night | null>;
}