import type { Night } from "../../domain/entities/carnaval.js";
import type { NightRepository } from "../../domain/repositories/night-repository.js";
import { NotFoundError } from "../../errors/app-error.js";
import type { UseCase } from "../types.js";

export interface GetNightInput {
  nightId: string;
}

export class GetNight implements UseCase<GetNightInput, Night> {
  constructor(private readonly nights: NightRepository) {}

  async execute(input: GetNightInput): Promise<Night> {
    const night = await this.nights.findById(input.nightId);
    if (night === null) {
      throw new NotFoundError("Night");
    }
    return night;
  }
}
