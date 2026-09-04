import { describe, it, expect } from "vitest";
import { mapEdition, mapNight, type EditionRow, type NightRow } from "../src/infrastructure/mappers/mappers.js";
import {
  mapConfigurationVersion,
  type ConfigurationVersionRow,
} from "../src/infrastructure/mappers/configuration-mapper.js";

describe("mapEdition", () => {
  it("maps all fields including optional dates", () => {
    const row: EditionRow = {
      id: "e1",
      code: "2027",
      name: "Carnavales Goya 2027",
      voting_nights: 3,
      starts_on: "2027-01-01",
      ends_on: "2027-02-28",
    };
    expect(mapEdition(row)).toEqual({
      id: "e1",
      code: "2027",
      name: "Carnavales Goya 2027",
      votingNights: 3,
      startsOn: "2027-01-01",
      endsOn: "2027-02-28",
    });
  });

  it("omits undefined optional dates", () => {
    const row: EditionRow = {
      id: "e1",
      code: "2027",
      name: "Carnavales Goya 2027",
      voting_nights: 3,
      starts_on: null,
      ends_on: null,
    };
    const edition = mapEdition(row);
    expect(edition).not.toHaveProperty("startsOn");
    expect(edition).not.toHaveProperty("endsOn");
  });
});

describe("mapNight", () => {
  it("maps night with date", () => {
    const row: NightRow = {
      id: "n1",
      edition_id: "e1",
      number: 2,
      date: "2027-02-05",
      status: "ABIERTA",
    };
    expect(mapNight(row)).toEqual({
      id: "n1",
      editionId: "e1",
      number: 2,
      date: "2027-02-05",
      status: "ABIERTA",
    });
  });

  it("omits date when null", () => {
    const row: NightRow = {
      id: "n1",
      edition_id: "e1",
      number: 1,
      date: null,
      status: "PLANIFICADA",
    };
    const night = mapNight(row);
    expect(night).not.toHaveProperty("date");
  });
});

describe("mapConfigurationVersion", () => {
  it("maps all fields including frozen metadata", () => {
    const row: ConfigurationVersionRow = {
      id: "c1",
      edition_id: "e1",
      version: 3,
      status: "CONGELADA",
      frozen_at: "2027-01-01T00:00:00.000Z",
      frozen_by: "u1",
      rules_ref: "CARNAVAL_2027_RULES",
      content_ref: "ref-1",
    };
    expect(mapConfigurationVersion(row)).toEqual({
      id: "c1",
      editionId: "e1",
      version: 3,
      status: "CONGELADA",
      frozenAt: "2027-01-01T00:00:00.000Z",
      frozenBy: "u1",
      rulesRef: "CARNAVAL_2027_RULES",
      contentRef: "ref-1",
    });
  });

  it("omits frozen fields when null", () => {
    const row: ConfigurationVersionRow = {
      id: "c1",
      edition_id: "e1",
      version: 1,
      status: "BORRADOR",
      frozen_at: null,
      frozen_by: null,
      rules_ref: "CARNAVAL_2027_RULES",
      content_ref: "ref-1",
    };
    const config = mapConfigurationVersion(row);
    expect(config).not.toHaveProperty("frozenAt");
    expect(config).not.toHaveProperty("frozenBy");
  });
});
