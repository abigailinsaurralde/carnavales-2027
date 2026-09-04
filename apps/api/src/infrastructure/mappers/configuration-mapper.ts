import type { ConfigurationVersion } from "@votaciones2027/shared-types";

export interface ConfigurationVersionRow {
  id: string;
  edition_id: string;
  version: number;
  status: string;
  frozen_at: string | null;
  frozen_by: string | null;
  rules_ref: string;
  content_ref: string;
}

export function mapConfigurationVersion(row: ConfigurationVersionRow): ConfigurationVersion {
  return {
    id: row.id,
    editionId: row.edition_id,
    version: row.version,
    status: row.status as ConfigurationVersion["status"],
    ...(row.frozen_at === null ? {} : { frozenAt: row.frozen_at }),
    ...(row.frozen_by === null ? {} : { frozenBy: row.frozen_by }),
    rulesRef: row.rules_ref,
    contentRef: row.content_ref,
  };
}
