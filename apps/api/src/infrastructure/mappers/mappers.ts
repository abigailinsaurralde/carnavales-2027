import type { CarnavalEdition, Night } from "@votaciones2027/shared-types";

export interface EditionRow {
  id: string;
  code: string;
  name: string;
  voting_nights: number;
  starts_on: string | null;
  ends_on: string | null;
}

export function mapEdition(row: EditionRow): CarnavalEdition {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    votingNights: row.voting_nights,
    ...(row.starts_on === null ? {} : { startsOn: row.starts_on }),
    ...(row.ends_on === null ? {} : { endsOn: row.ends_on }),
  };
}

export interface NightRow {
  id: string;
  edition_id: string;
  number: number;
  date: string | null;
  status: string;
}

export function mapNight(row: NightRow): Night {
  return {
    id: row.id,
    editionId: row.edition_id,
    number: row.number,
    ...(row.date === null ? {} : { date: row.date }),
    status: row.status as Night["status"],
  };
}
