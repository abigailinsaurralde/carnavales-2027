/**
 * Fixtures E2E — VOTACIONES2027 (Carnavales Goya 2027).
 *
 * Datos de infraestructura y dominio para el HITO "Integración E2E real".
 * NO reemplazables por mocks: el foco del HITO es ejercitar apps/client ->
 * apps/api -> PostgreSQL reales.
 *
 * Identificadores deterministas con formato UUID v4-variant válido para la
 * validación del backend (ver apps/api/src/validation/uuid.ts).
 *
 * REGLAS:
 *  - No introduce reglas de negocio: solo construye un escenario de prueba
 *    consistente con el esquema real (database/migrations) y con la lógica ya
 *    definida en aplicaciones y contrato compartido.
 *  - Contraseña de prueba documentada en database/seeds/002_seed_test_users.sql:
 *    SOLO para entornos de test. No hay secretos reales en este repositorio.
 */

// ---------------------------------------------------------------------------
// Infraestructura PostgreSQL local (entorno de desarrollo verificado: psql 18.4)
// ---------------------------------------------------------------------------

export const E2E_DB_HOST = "localhost";
export const E2E_DB_PORT = 5432;
export const E2E_DB_NAME = "votaciones2027_e2e";
export const E2E_DB_USER = "postgres";
export const E2E_DB_PASSWORD = "postgres";

/** Base administrativa desde la que se DROP/CREATE la base exclusiva de E2E. */
export const E2E_ADMIN_DB_NAME = "postgres";

export const E2E_ADMIN_DB_URL = `postgresql://${E2E_DB_USER}:${E2E_DB_PASSWORD}@${E2E_DB_HOST}:${E2E_DB_PORT}/${E2E_ADMIN_DB_NAME}`;

export const E2E_DB_URL = `postgresql://${E2E_DB_USER}:${E2E_DB_PASSWORD}@${E2E_DB_HOST}:${E2E_DB_PORT}/${E2E_DB_NAME}`;

/** Ruta verificada de psql en este entorno (no está en PATH). */
export const PSQL_BIN = "C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe";

// ---------------------------------------------------------------------------
// Identificadores deterministas (UUID v4/variant válidos)
// ---------------------------------------------------------------------------

export const EDITION_CODE_2027 = "2027";
export const EDITION_ID = "e2e00001-0000-4000-8000-000000000001";
export const SPECIALTY_ID = "e2e00001-0000-4000-8000-000000000002";
export const CONFIG_ID = "e2e00001-0000-4000-8000-000000000003";
export const SNAPSHOT_ID = "e2e00001-0000-4000-8000-000000000004";
export const NIGHT1_ID = "e2e00001-0000-4000-8000-000000000005";
export const NIGHT2_ID = "e2e00001-0000-4000-8000-000000000006";
export const ASSIGNMENT1_ID = "e2e00001-0000-4000-8000-000000000007";
export const ASSIGNMENT2_ID = "e2e00001-0000-4000-8000-000000000008";
export const COMPARSA_ID = "e2e00001-0000-4000-8000-000000000009";
export const RUBRO_ID = "e2e00001-0000-4000-8000-000000000010";
export const ITEM_ID = "e2e00001-0000-4000-8000-000000000011";
export const CANDIDATE_ID = "e2e00001-0000-4000-8000-000000000012";
export const JUDGE_ID = "e2e00002-0000-4000-8000-000000000001";
// Noche dedicada al test "I" de ventana (FASE B): número 3, ABIERTA, sin fecha
// oficial (date NULL). starts_at/ends_at se fijan dentro del propio test.
export const NIGHT3_ID = "e2e00001-0000-4000-8000-000000000013";
export const ASSIGNMENT3_ID = "e2e00001-0000-4000-8000-000000000014";

// ---------------------------------------------------------------------------
// Credenciales de prueba (misma contraseña que database/seeds/002_seed_test_users.sql)
// ---------------------------------------------------------------------------

export const JUDGE_EMAIL = "juez.e2e.baile@goya2027.test";
export const JUDGE_DISPLAY_NAME = "Juez de prueba E2E BAILE";
export const TEST_PASSWORD = "ChangeMe-2027!";

/** Hash scrypt de 'ChangeMe-2027!' (idéntico al del seed 002, usuario 1). */
export const JUDGE_PASSWORD_HASH =
  "scrypt$0a404e3a38ee0c2bab4f5beb2add347c$e8818deb0344ba6548f749b1df168e62d460949556d2bcae4858d3055fae9623db761988d2677bb9bc28a45d86d1c29993c26355d85182b13635ed8b8b4a3dd4";

/** Versión de configuración congelada efectiva (CARNAVAL_2027_RULES). */
export const CONFIG_RULES_REF = "CARNAVAL_2027_RULES";
export const CONFIG_VERSION_NUMBER = 1;

// ---------------------------------------------------------------------------
// Sentencias SQL de seed (parametrizadas): solo arman el escenario técnico.
// ---------------------------------------------------------------------------

export const SEED_STATEMENTS: Array<{
  sql: string;
  params: unknown[];
}> = [
  {
    sql: `INSERT INTO carnaval_edition (id, code, name, voting_nights) VALUES ($1, $2, $3, $4)`,
    params: [EDITION_ID, EDITION_CODE_2027, "Carnavales Goya 2027", 3],
  },
  {
    sql: `INSERT INTO specialty (id, code, "order") VALUES ($1, 'BAILE', 1)`,
    params: [SPECIALTY_ID],
  },
  {
    sql: `INSERT INTO configuration_version
      (id, edition_id, version, status, rules_ref, content_ref)
      VALUES ($1, $2, $3, 'CONGELADA', $4, 'e2e-carnaval-2027-content-ref')`,
    params: [CONFIG_ID, EDITION_ID, CONFIG_VERSION_NUMBER, CONFIG_RULES_REF],
  },
  {
    sql: `INSERT INTO configuration_snapshot (id, configuration_version_id, content)
      VALUES ($1, $2, '{}'::jsonb)`,
    params: [SNAPSHOT_ID, CONFIG_ID],
  },
  {
    sql: `INSERT INTO user_account (id, email, display_name, role, password_hash)
      VALUES ($1, $2, $3, 'JUDGE', $4)`,
    params: [JUDGE_ID, JUDGE_EMAIL, JUDGE_DISPLAY_NAME, JUDGE_PASSWORD_HASH],
  },
  {
    sql: `INSERT INTO comparsa (id, edition_id, code, name) VALUES ($1, $2, 'COMP-E2E', 'Comparsa E2E')`,
    params: [COMPARSA_ID, EDITION_ID],
  },
  {
    sql: `INSERT INTO night (id, edition_id, number, date, status)
      VALUES ($1, $2, 1, '2027-01-15', 'ABIERTA')`,
    params: [NIGHT1_ID, EDITION_ID],
  },
  {
    sql: `INSERT INTO night (id, edition_id, number, date, status)
      VALUES ($1, $2, 2, '2027-01-22', 'ABIERTA')`,
    params: [NIGHT2_ID, EDITION_ID],
  },
  {
    sql: `INSERT INTO night (id, edition_id, number, date, status)
      VALUES ($1, $2, 3, NULL, 'ABIERTA')`,
    params: [NIGHT3_ID, EDITION_ID],
  },
  {
    sql: `INSERT INTO judge_assignment
      (id, judge_id, night_id, specialty_id, is_effective)
      VALUES ($1, $2, $3, $4, TRUE)`,
    params: [ASSIGNMENT1_ID, JUDGE_ID, NIGHT1_ID, SPECIALTY_ID],
  },
  {
    sql: `INSERT INTO judge_assignment
      (id, judge_id, night_id, specialty_id, is_effective)
      VALUES ($1, $2, $3, $4, TRUE)`,
    params: [ASSIGNMENT2_ID, JUDGE_ID, NIGHT2_ID, SPECIALTY_ID],
  },
  {
    sql: `INSERT INTO judge_assignment
      (id, judge_id, night_id, specialty_id, is_effective)
      VALUES ($1, $2, $3, $4, TRUE)`,
    params: [ASSIGNMENT3_ID, JUDGE_ID, NIGHT3_ID, SPECIALTY_ID],
  },
  {
    sql: `INSERT INTO rubro (id, edition_id, specialty_id, name, type)
      VALUES ($1, $2, $3, 'Menor de Estilo', 'NOMINATIVO')`,
    params: [RUBRO_ID, EDITION_ID, SPECIALTY_ID],
  },
  {
    sql: `INSERT INTO rubro_item (id, rubro_id, name, order_index)
      VALUES ($1, $2, 'Puntaje General', 1)`,
    params: [ITEM_ID, RUBRO_ID],
  },
  {
    sql: `INSERT INTO candidate (id, item_id, comparsa_id, label)
      VALUES ($1, $2, $3, 'Candidato E2E')`,
    params: [CANDIDATE_ID, ITEM_ID, COMPARSA_ID],
  },
];