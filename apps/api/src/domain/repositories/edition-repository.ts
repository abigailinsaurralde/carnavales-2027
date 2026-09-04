import type { CarnavalEdition } from "../entities/carnaval.js";

export interface EditionRepository {
  findById(id: string): Promise<CarnavalEdition | null>;
  findByCode(code: string): Promise<CarnavalEdition | null>;
}
