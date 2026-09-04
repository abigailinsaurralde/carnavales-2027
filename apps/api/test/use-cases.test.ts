import { describe, it, expect } from "vitest";
import type { EditionRepository } from "../src/domain/repositories/edition-repository.js";
import type { NightRepository } from "../src/domain/repositories/night-repository.js";
import type { ConfigurationRepository } from "../src/domain/repositories/configuration-repository.js";
import { GetEdition } from "../src/application/use-cases/get-edition.js";
import { GetNight } from "../src/application/use-cases/get-night.js";
import { GetConfigurationVersion } from "../src/application/use-cases/get-configuration-version.js";
import { NotFoundError } from "../src/errors/app-error.js";
import type { CarnavalEdition, Night, ConfigurationVersion } from "../src/domain/index.js";

const edition: CarnavalEdition = {
  id: "e1",
  code: "2027",
  name: "Carnavales Goya 2027",
  votingNights: 3,
};

const night: Night = {
  id: "n1",
  editionId: "e1",
  number: 1,
  status: "PLANIFICADA",
};

const config: ConfigurationVersion = {
  id: "c1",
  editionId: "e1",
  version: 1,
  status: "BORRADOR",
  rulesRef: "CARNAVAL_2027_RULES",
  contentRef: "ref-1",
};

function makeEditions(edition: CarnavalEdition | null): EditionRepository {
  return { findById: async () => edition };
}

function makeNights(night: Night | null): NightRepository {
  return {
    findById: async () => night,
    findByEdition: async () => (night === null ? [] : [night]),
  };
}

function makeConfigs(config: ConfigurationVersion | null): ConfigurationRepository {
  return {
    findByEdition: async () => (config === null ? [] : [config]),
    findLatestByEdition: async () => config,
  };
}

describe("GetEdition", () => {
  it("returns the edition when found", async () => {
    const useCase = new GetEdition(makeEditions(edition));
    await expect(useCase.execute({ editionId: "e1" })).resolves.toEqual(edition);
  });

  it("throws NotFoundError when edition missing", async () => {
    const useCase = new GetEdition(makeEditions(null));
    await expect(useCase.execute({ editionId: "missing" })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("GetNight", () => {
  it("returns the night when found", async () => {
    const useCase = new GetNight(makeNights(night));
    await expect(useCase.execute({ nightId: "n1" })).resolves.toEqual(night);
  });

  it("throws NotFoundError when night missing", async () => {
    const useCase = new GetNight(makeNights(null));
    await expect(useCase.execute({ nightId: "missing" })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("GetConfigurationVersion", () => {
  it("returns latest configuration when found", async () => {
    const useCase = new GetConfigurationVersion(makeConfigs(config));
    await expect(useCase.execute({ editionId: "e1" })).resolves.toEqual(config);
  });

  it("throws NotFoundError when no configuration", async () => {
    const useCase = new GetConfigurationVersion(makeConfigs(null));
    await expect(useCase.execute({ editionId: "missing" })).rejects.toBeInstanceOf(NotFoundError);
  });
});
