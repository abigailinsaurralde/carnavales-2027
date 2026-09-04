import type { CarnavalEdition } from "../entities/carnaval.js";

export interface EditionRepository {
  findById(id: string): Promise<CarnavalEdition | null>;
}
