import { EDITION_CODE_2027 } from "../../constants.js";
import type { CarnavalEdition } from "../../../domain/entities/carnaval.js";
import type { EditionRepository } from "../../../domain/repositories/edition-repository.js";
import { NotFoundError } from "../../../errors/app-error.js";

/** Resuelve la edición fija del PMV (Carnavales Goya 2027). */
export async function resolveEdition2027(
  editions: EditionRepository,
): Promise<CarnavalEdition> {
  const edition = await editions.findByCode(EDITION_CODE_2027);
  if (edition === null) {
    throw new NotFoundError(`Edition with code '${EDITION_CODE_2027}'`);
  }
  return edition;
}