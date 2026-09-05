import type {
  AuthenticatedUser,
  AuthSession,
  Candidate,
  Comparsa,
  IssueAccessTokenResponse,
  JudgeAssignmentContext,
  JudgeContextResponse,
  Night,
  Rubro,
  RubroItem,
} from "@votaciones2027/shared-types";

/**
 * Fixtures compartidos del hito "FRONTEND FUNCIONAL DEL JUEZ".
 *
 * Representan un escenario mínimo y consistente con los contratos reales:
 * una noche abierta, un juez de Baile asignado, dos comparsas y dos ítems de
 * la especialidad (4 candidatos elegibles en total).
 */

export const EDITION_ID = "e-2027";
export const NIGHT_ID = "n-1";

export function makeContext(): JudgeContextResponse {
  const edition = {
    id: EDITION_ID,
    code: "CAR2027",
    name: "Carnavales Goya",
    votingNights: 2,
  };

  const nights: Night[] = [
    { id: NIGHT_ID, editionId: EDITION_ID, number: 1, status: "ABIERTA" },
  ];

  const rubros: Rubro[] = [
    { id: "r-baile", editionId: EDITION_ID, specialty: "BAILE", name: "Baile", type: "NOMINATIVO" },
    { id: "r-bateria", editionId: EDITION_ID, specialty: "BATERIA", name: "Batería", type: "NOMINATIVO" },
  ];

  const items: RubroItem[] = [
    { id: "i-1", rubroId: "r-baile", name: "Música y armonía", orderIndex: 0 },
    { id: "i-2", rubroId: "r-baile", name: "Bailarines en escena", orderIndex: 1 },
    { id: "i-3", rubroId: "r-bateria", name: "Redoblantes", orderIndex: 0 },
  ];

  const comparsas: Comparsa[] = [
    { id: "cmp-1", editionId: EDITION_ID, code: "L01", name: "Los de la Estrella" },
    { id: "cmp-2", editionId: EDITION_ID, code: "L02", name: "Herencia del Norte" },
  ];

  const candidates: Candidate[] = [
    { id: "can-1-1", itemId: "i-1", comparsaId: "cmp-1", label: "Los de la Estrella" },
    { id: "can-1-2", itemId: "i-2", comparsaId: "cmp-1", label: "Los de la Estrella" },
    { id: "can-2-1", itemId: "i-1", comparsaId: "cmp-2", label: "Herencia del Norte" },
    { id: "can-2-2", itemId: "i-2", comparsaId: "cmp-2", label: "Herencia del Norte" },
    { id: "can-x-3", itemId: "i-3", comparsaId: "cmp-1", label: "Los de la Estrella" },
  ];

  const assignments: JudgeAssignmentContext[] = [
    {
      assignmentId: "a-baile",
      nightId: NIGHT_ID,
      nightNumber: 1,
      specialtyId: "sp-baile",
      specialty: "BAILE",
      confirmed: false,
    },
  ];

  return {
    edition,
    nights,
    assignments,
    rubros,
    items,
    candidates,
    comparsas,
    configuration: null,
  };
}

/** DNI de persona física del juez (SVC2-24), identificador del acceso SVC2-31. */
export const JUDGE_DNI = "30123456";

export const JUDGE_USER: AuthenticatedUser = {
  id: "juez-1",
  email: "juez.baile.1@goya2027.test",
  displayName: "Juez de Baile",
  role: "JUDGE",
  dni: JUDGE_DNI,
};

export const JUDGE_SESSION: AuthSession = {
  token: "token-juez-1",
  expiresAt: "2030-01-01T00:00:00.000Z",
  user: JUDGE_USER,
};

export const JUDGE_EMAIL = JUDGE_USER.email;
export const JUDGE_PASSWORD = "ChangeMe-2027!";

/**
 * Access token temporal de un solo uso (SVC2-31). En producción lo genera el
 * servidor y se entrega fuera de banda (mesa de votación); el fixture fija un
 * valor estable para los tests del flujo de acceso.
 */
export const JUDGE_ACCESS_TOKEN = "a3f0c2e9d8b74a1e6c5f0d9b8a7e6c5f";

export const ACCESS_TOKEN_ISSUE: IssueAccessTokenResponse = {
  token: JUDGE_ACCESS_TOKEN,
  expiresAt: "2030-01-01T00:00:00.000Z",
};

/** Sesión operativa (acceso por contraseña conservado para roles operativos). */
export const OPERATOR_USER: AuthenticatedUser = {
  id: "escribano-1",
  email: "escribano@goya2027.test",
  displayName: "Escribano/Veedor",
  role: "ESCRIBANO_VEEDOR",
};

export const OPERATOR_SESSION: AuthSession = {
  token: "token-escribano-1",
  expiresAt: "2030-01-01T00:00:00.000Z",
  user: OPERATOR_USER,
};

export const OPERATOR_EMAIL = OPERATOR_USER.email;
export const OPERATOR_PASSWORD = "ChangeMe-2027!";