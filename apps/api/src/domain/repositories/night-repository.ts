import type { Night } from "../entities/carnaval.js";

export interface NightRepository {
  findById(id: string): Promise<Night | null>;
  findByEdition(editionId: string): Promise<Night[]>;
}
