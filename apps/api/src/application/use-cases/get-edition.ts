import type { CarnavalEdition } from "../../domain/entities/carnaval.js";
import type { EditionRepository } from "../../domain/repositories/edition-repository.js";
import { NotFoundError } from "../../errors/app-error.js";
import type { UseCase } from "../types.js";

export interface GetEditionInput {
  editionId: string;
}

export class GetEdition implements UseCase<GetEditionInput, CarnavalEdition> {
  constructor(private readonly editions: EditionRepository) {}

  async execute(input: GetEditionInput): Promise<CarnavalEdition> {
    const edition = await this.editions.findById(input.editionId);
    if (edition === null) {
      throw new NotFoundError("Edition");
    }
    return edition;
  }
}
