export type ConfigurationVersionStatus = "BORRADOR" | "CONGELADA";

export interface ConfigurationVersion {
  id: string;
  editionId: string;
  version: number;
  status: ConfigurationVersionStatus;
  frozenAt?: string;
  frozenBy?: string;
  rulesRef: string;
  contentRef: string;
}
