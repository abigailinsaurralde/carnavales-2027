/**
 * Infraestructura del HITO E2E real — VOTACIONES2027.
 *
 * Provisiona una base PostgreSQL EXCLUSIVA de test, aplica las migraciones
 * reales de database/migrations, siembra el escenario determinista y levanta la
 * API real (apps/api) sobre esa base. No reemplaza PostgreSQL por mocks.
 *
 * Comandos/componentes ACORDADOS con el HITO:
 *  - psql desde el entorno PostgreSQL Docker por defecto (E2E_PSQL_MODE=docker);
 *    fallback explícito a psql local (E2E_PSQL_MODE=local) sin Docker.
 *  - node-pg solo para DROP/CREATE de la base y consultas de verificación.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { KVStorage } from "../../apps/client/src/offline/storage.js";
import { loadConfig } from "../../apps/api/src/config.js";
import { createPool, type DbPool } from "../../apps/api/src/db/pool.js";
import { createApp, type AppServer } from "../../apps/api/src/server.js";
import {
  E2E_ADMIN_DB_URL,
  E2E_DB_HOST,
  E2E_DB_NAME,
  E2E_DB_PORT,
  E2E_DB_URL,
  E2E_DB_USER,
  E2E_PSQL_MODE,
  PSQL_BIN,
  SEED_STATEMENTS,
} from "./fixtures.js";

const { Pool } = pg;
const execFileAsync = promisify(execFile);

export const REPO_ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
export const MIGRATIONS_DIR = path.join(REPO_ROOT, "database", "migrations");
export const COMPOSE_FILE = path.join(REPO_ROOT, "docker", "compose.yaml");

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

export async function probeTcp(host: string, port: number, timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

async function existsBinary(bin: string): Promise<boolean> {
  try {
    await fsp.access(bin);
    return true;
  } catch {
    return false;
  }
}

/**
 * Guard del HITO: el E2E SOLO corre contra PostgreSQL real. Si el entorno no
 * ofrece PostgreSQL, se detiene con un mensaje claro (no silencio, no mock).
 */
export async function resolvePsqlBin(): Promise<string> {
  if (await existsBinary(PSQL_BIN)) return PSQL_BIN;
  if (await existsBinary("psql")) return "psql";
  throw new Error(
    `[HITO E2E] PostgreSQL real no disponible. No se pudo resolver psql. ` +
      `Instale PostgreSQL (ruta esperada: "${PSQL_BIN}") o habilite 'psql' en PATH. ` +
      `El HITO exige persistencia real; no se usa mock en su lugar.`,
  );
}

export async function ensurePostgresRunning(): Promise<void> {
  if (!(await probeTcp(E2E_DB_HOST, E2E_DB_PORT))) {
    throw new Error(
      `[HITO E2E] PostgreSQL real no responde en ${E2E_DB_HOST}:${E2E_DB_PORT}. ` +
        `Inicie PostgreSQL antes de ejecutar npm run test:e2e ` +
        `(entorno Docker: npm run docker:up; local: servicio postgresql).`,
    );
  }
}

// ---------------------------------------------------------------------------
// Base de datos exclusiva + migraciones reales
// ---------------------------------------------------------------------------

/**
 * DROP/CREATE de la base de test. Específica y aislada: nunca toca la base del
 * entorno de desarrollo ni de producción.
 */
export async function resetE2eDatabase(): Promise<void> {
  const admin = new Pool({ connectionString: E2E_ADMIN_DB_URL, max: 1 });
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${E2E_DB_NAME}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${E2E_DB_NAME}"`);
    await admin.query(`COMMENT ON DATABASE "${E2E_DB_NAME}" IS 'Base exclusiva de pruebas E2E de VOTACIONES2027'`);
  } finally {
    await admin.end();
  }
}

/**
 * Aplica las migraciones versionadas reales del proyecto (001 → 002 → 003)
 * sobre la base E2E dedicada `votaciones2027_e2e`, desde
 * `database/migrations/` sin ninguna transformación.
 */
export async function applyMigrations(psqlBin: string): Promise<void> {
  await applyMigrationsFrom(psqlBin, MIGRATIONS_DIR);
}

async function applyMigrationsFrom(psqlBin: string, dir: string): Promise<void> {
  const files = (await fsp.readdir(dir))
    .filter((f) => f.endsWith(".sql") && /^\d{3}_/.test(f))
    .sort();
  if (files.length === 0) {
    throw new Error(`[HITO E2E] No se encontraron migraciones en ${dir}`);
  }
  for (const file of files) {
    const script = path.join(dir, file);
    // Las migraciones reales ya controlan su propia transacción (BEGIN/COMMIT
    // dentro del archivo); por eso NO se usa --single-transaction.
    await runMigrationScript(psqlBin, script);
  }
}

/**
 * Aplica UN script de migración con psql:
 *  - modo "docker" (POR DEFECTO): psql se ejecuta dentro del contenedor de
 *    Compose (docker/compose.yaml); el SQL entra por stdin. No se requiere
 *    ningún binario psql local.
 *  - modo "local": binario psql local + E2E_DB_URL (compatibilidad explícita
 *    con entornos sin Docker).
 */
async function runMigrationScript(psqlBin: string, script: string): Promise<void> {
  if (E2E_PSQL_MODE === "docker") {
    const sql = await fsp.readFile(script, "utf8");
    await execFileAsync(
      "docker",
      [
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
        E2E_DB_USER,
        "-d",
        E2E_DB_NAME,
        "-f",
        "-",
      ],
      { input: sql, maxBuffer: 10 * 1024 * 1024 },
    );
    return;
  }
  await execFileAsync(
    psqlBin,
    ["-v", "ON_ERROR_STOP=1", "-q", "-f", script, E2E_DB_URL],
    { maxBuffer: 10 * 1024 * 1024 },
  );
}

/** Seed determinista del escenario E2E (ver fixtures.ts). */
export async function seedE2eDatabase(pool: DbPool): Promise<void> {
  for (const statement of SEED_STATEMENTS) {
    await pool.query(statement.sql, statement.params);
  }
}

// ---------------------------------------------------------------------------
// API real
// ---------------------------------------------------------------------------

export interface E2EHarness {
  db: DbPool;
  api: AppServer;
  port: number;
  baseUrl: string;
}

export async function bootRealApi(): Promise<E2EHarness> {
  const db = createPool(E2E_DB_URL);
  const config = loadConfig({
    databaseUrl: E2E_DB_URL,
    nodeEnv: "test",
    port: 0,
    corsOrigins: ["*"],
    sessionTtlHours: 12,
  });
  const api = createApp(config, db);
  await new Promise<void>((resolve, reject) => {
    api.server.once("error", reject);
    api.server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = api.server.address();
  const port = typeof address === "object" && address !== null ? address.port : -1;
  return { db, api, port, baseUrl: `http://127.0.0.1:${port}` };
}

export async function shutdownHarness(harness: E2EHarness): Promise<void> {
  await harness.api.close();
}

// ---------------------------------------------------------------------------
// Cliente HTTP de verificación (mismo contrato ApiClient pero para el test)
// ---------------------------------------------------------------------------

export interface ApiJsonResult {
  status: number;
  body: unknown;
}

export async function apiJson(
  baseUrl: string,
  method: string,
  pathname: string,
  token?: string,
  body?: unknown,
): Promise<ApiJsonResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== undefined) headers["authorization"] = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown = undefined;
  if (text !== "") {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = text;
    }
  }
  return { status: response.status, body: parsed };
}

// ---------------------------------------------------------------------------
// KVStorage persistente en disco (análogo localstorage para Node): permite
// demostrar que el outbox offline sobrevive un reinicio del proceso.
// ---------------------------------------------------------------------------

export class FileKVStorage implements KVStorage {
  private readonly data = new Map<string, string>();
  private readonly file: string;

  constructor(file: string) {
    this.file = file;
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, string>;
      for (const [key, value] of Object.entries(raw)) this.data.set(key, value);
    }
  }

  get(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  set(key: string, value: string): void {
    this.data.set(key, value);
    this.flush();
  }

  remove(key: string): void {
    this.data.delete(key);
    this.flush();
  }

  list(prefix: string): string[] {
    return Array.from(this.data.keys())
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length));
  }

  private flush(): void {
    fs.writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.data), null, 2), "utf8");
  }
}

export function tempKvFile(tag: string): string {
  return path.join(os.tmpdir(), `votaciones2027-e2e-${tag}-${process.pid}.json`);
}