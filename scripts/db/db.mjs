/**
 * VOTACIONES2027 — Runner de base de datos para el entorno Docker (HITO DOCKER,
 * FASES 1-4).
 *
 * Reemplaza la dependencia de un `psql` LOCAL (p. ej.
 * `C:\Program Files\PostgreSQL\18\bin\psql.exe`): el `psql` se ejecuta DENTRO
 * del contenedor `postgres` de Compose.
 *
 * Requisito previo: `npm run docker:up` (PostgreSQL Docker arriba y healthy).
 *
 * Comandos:
 *   node scripts/db/db.mjs migrate            Aplica las migraciones 001-007
 *                                             (ordenadas) sobre la BD de dev.
 *   node scripts/db/db.mjs init [--seed]      Crea la BD de dev si no existe,
 *                                             migra. `--seed` aplica además
 *                                             database/seeds/002 (TEST ONLY).
 *   node scripts/db/db.mjs reset --yes        DESTRUYE la BD de dev, la recrea
 *                                             y migra. Requiere --yes explícito.
 *
 * Reglas del HITO respetadas:
 *   - No reescribe migraciones; lee database/migrations/ tal cual.
 *   - No duplica SQL en docker/ (.gitignore lo impide además).
 *   - ON_ERROR_STOP=1 y orden estricto de aplicación.
 *   - Sin operaciones destructivas automáticas (reset exige --yes).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const COMPOSE_FILE = join(REPO_ROOT, "docker", "compose.yaml");
const MIGRATIONS_DIR = join(REPO_ROOT, "database", "migrations");
const SEEDS_DIR = join(REPO_ROOT, "database", "seeds");
const ADMIN_DB = "postgres";

/** Lee docker/.env (si existe) con un parser mínimo KEY=VALUE. */
async function readDotEnv(file) {
  try {
    await access(file);
  } catch {
    return {};
  }
  const text = await readFile(file, "utf8");
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

const dockerEnv = await readDotEnv(join(REPO_ROOT, "docker", ".env"));

/** Rol de inicialización/desarrollo (superusuario del contenedor). */
const POSTGRES_USER = process.env.POSTGRES_USER ?? dockerEnv.POSTGRES_USER ?? "postgres";
/** Base de datos de DESARROLLO (separada de votaciones2027_e2e). */
const POSTGRES_DB = process.env.POSTGRES_DB ?? dockerEnv.POSTGRES_DB ?? "votaciones2027";

const escIdent = (s) => s.replace(/"/g, '""');
const escLiteral = (s) => s.replace(/'/g, "''");

/**
 * Ejecuta psql DENTRO del contenedor postgres de Compose.
 * @param dbName base contra la que conectar (socket interno, sin password).
 * @param sqlFile archivo .sql a aplicar por stdin (null para `-c` inline).
 * @param inlineSql sentencia inline cuando sqlFile es null.
 */
async function psqlExec(dbName, sqlFile, inlineSql) {
  const args = [
    "compose",
    "-f",
    COMPOSE_FILE,
    "exec",
    "-T",
    "postgres",
    "psql",
    "-v",
    "ON_ERROR_STOP=1",
    "-q",
    "-U",
    POSTGRES_USER,
    "-d",
    dbName,
  ];
  if (sqlFile !== null) {
    args.push("-f", "-");
  } else {
    args.push("-c", inlineSql);
  }
  const input = sqlFile !== null ? await readFile(sqlFile, "utf8") : undefined;
  const { stdout, stderr } = await execFileAsync("docker", args, {
    input,
    maxBuffer: 10 * 1024 * 1024,
  });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}

/** Consulta escalar (psql -tA) contra la base indicada. */
async function psqlScalar(sql, dbName = ADMIN_DB) {
  const args = [
    "compose",
    "-f",
    COMPOSE_FILE,
    "exec",
    "-T",
    "postgres",
    "psql",
    "-tA",
    "-v",
    "ON_ERROR_STOP=1",
    "-q",
    "-U",
    POSTGRES_USER,
    "-d",
    dbName,
    "-c",
    sql,
  ];
  const { stdout } = await execFileAsync("docker", args, {
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.trim();
}

function listMigrations() {
  return readdir(MIGRATIONS_DIR).then((files) =>
    files.filter((f) => f.endsWith(".sql") && /^\d{3}_/.test(f)).sort(),
  );
}

async function databaseExists() {
  const result = await psqlScalar(
    `SELECT 1 FROM pg_database WHERE datname = '${escLiteral(POSTGRES_DB)}'`,
  );
  return result === "1";
}

async function createDatabase() {
  await psqlExec(ADMIN_DB, null, `CREATE DATABASE "${escIdent(POSTGRES_DB)}"`);
}

async function applyMigrations() {
  const files = await listMigrations();
  if (files.length === 0) {
    throw new Error(`No se encontraron migraciones en ${MIGRATIONS_DIR}`);
  }
  for (const file of files) {
    const script = join(MIGRATIONS_DIR, file);
    // Las migraciones controlan su propia transacción (BEGIN/COMMIT); por eso
    // no se usa --single-transaction.
    await psqlExec(POSTGRES_DB, script, null);
    console.log(`OK  ${file}`);
  }
}

async function applySeedTestUsers() {
  const seed = join(SEEDS_DIR, "002_seed_test_users.sql");
  await access(seed); // error claro si el seed no existe
  console.warn(
    "AVISO: el seed 002 crea usuarios de TEST con contraseña conocida (TEST ONLY). " +
      "Nunca ejecutar en producción.",
  );
  await psqlExec(POSTGRES_DB, seed, null);
  console.log("OK  002_seed_test_users.sql (TEST ONLY)");
}

async function cmdMigrate() {
  console.log(`Aplicando migraciones sobre '${POSTGRES_DB}' (contenedor postgres)...`);
  await applyMigrations();
}

async function cmdInit({ withSeed }) {
  if (!(await databaseExists())) {
    console.log(`Creando base de desarrollo '${POSTGRES_DB}'...`);
    await createDatabase();
  } else {
    console.log(`Base de desarrollo '${POSTGRES_DB}' ya existe.`);
  }
  await applyMigrations();
  if (withSeed) await applySeedTestUsers();
}

async function cmdReset({ withSeed }) {
  console.warn(
    `Operación DESTRUCTIVA: se eliminará la base '${POSTGRES_DB}' del contenedor ` +
      `Docker (volumen conservado, datos de la base perdidos) y se recreará desde cero.`,
  );
  await psqlExec(ADMIN_DB, null, `DROP DATABASE IF EXISTS "${escIdent(POSTGRES_DB)}" WITH (FORCE)`);
  console.log(`Base '${POSTGRES_DB}' eliminada.`);
  await cmdInit({ withSeed });
}

function usage() {
  console.error(
    [
      "Uso:",
      "  node scripts/db/db.mjs migrate",
      "  node scripts/db/db.mjs init [--seed]",
      "  node scripts/db/db.mjs reset --yes [--seed]",
      "",
      "Requiere PostgreSQL Docker arriba: npm run docker:up",
    ].join("\n"),
  );
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const withSeed = rest.includes("--seed");
  const hasYes = rest.includes("--yes");

  if (command === "migrate") {
    await cmdMigrate();
  } else if (command === "init") {
    await cmdInit({ withSeed });
  } else if (command === "reset") {
    if (!hasYes) {
      console.error(
        `Resistencia a operaciones destructivas: 'db:reset' elimina la base ` +
          `'${POSTGRES_DB}'. Para confirmar: node scripts/db/db.mjs reset --yes`,
      );
      process.exitCode = 1;
      return;
    }
    await cmdReset({ withSeed });
  } else {
    usage();
    process.exitCode = 2;
    return;
  }

  console.log("db: OK");
}

main().catch((err) => {
  if (err !== null && err !== undefined && err.code === "ENOENT") {
    console.error(
      "docker no está disponible en este entorno. Inicie Docker y ejecute primero: npm run docker:up",
    );
  } else {
    const detail = err?.stderr ?? err?.message ?? String(err);
    console.error(`[db] error: ${detail}`);
  }
  process.exitCode = 1;
});