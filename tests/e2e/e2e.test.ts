/**
 * HITO "Integración E2E real" — VOTACIONES2027 (Carnavales Goya 2027).
 *
 * Demuestra, contra infraestructura REAL (PostgreSQL real — Docker por defecto,
 * local opcional — + API real +
 * componente offline real del cliente) el flujo completo del PMV:
 *
 *   A. Autenticación real y token opaco (en BD solo SHA-256).
 *   B. Cliente real (JudgeApp + OfflineStore + SyncManager + ApiClient)
 *      obtiene contexto desde la API real.
 *   C. Captura offline con outbox persistente en disco → reconexión →
 *      sincronización real → persistencia real verificada en PostgreSQL.
 *   D. Idempotencia: reenvío del MISMO payload de sync (resend de red/timeout).
 *   E. Confirmación real (CONFIRMADA) sin duplicados; N=1 → 0 omisiones.
 *   F. Inmutabilidad persistente: API (409) + triggers reales en PostgreSQL.
 *   G. Rollback real: unidad de trabajo con fallo inyectado = nada se persiste.
 *   H. Concurrencia real: dos confirmaciones paralelas → una única transición.
 *
 * REGLAS RESPETADAS:
 *  - No combina mocks con el flujo real; PostgreSQL NO se reemplaza.
 *  - No inventa reglas de negocio; solo verifica contratos e integridad ya
 *    definidos (REGlas disponible en fuentes de verdad y código).
 *  - Escenario único N=1 (1 rubro, 1 ítem, 1 candidato) → omissionsInserted=0.
 */
import * as fs from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type {
  SyncPlanillaPayload,
  SyncVotePayload,
  PlanillaSummary,
} from "@votaciones2027/shared-types";
import { createApplication, type Repositories } from "../../apps/api/src/application/index.js";
import type { DbPool } from "../../apps/api/src/db/pool.js";
import type { UnitOfWork, UnitOfWorkRepositories } from "../../apps/api/src/domain/repositories/unit-of-work.js";
import { PostgresAuditRepository } from "../../apps/api/src/infrastructure/repositories/postgres-audit-repository.js";
import { PostgresAccessTokenRepository } from "../../apps/api/src/infrastructure/repositories/postgres-access-token-repository.js";
import { PostgresCatalogueRepository } from "../../apps/api/src/infrastructure/repositories/postgres-catalogue-repository.js";
import { PostgresConfigurationRepository } from "../../apps/api/src/infrastructure/repositories/postgres-configuration-repository.js";
import { PostgresEditionRepository } from "../../apps/api/src/infrastructure/repositories/postgres-edition-repository.js";
import { PostgresJudgeAssignmentRepository } from "../../apps/api/src/infrastructure/repositories/postgres-judge-assignment-repository.js";
import { PostgresNightRepository } from "../../apps/api/src/infrastructure/repositories/postgres-night-repository.js";
import { PostgresPlanillaRepository } from "../../apps/api/src/infrastructure/repositories/postgres-planilla-repository.js";
import { PostgresSessionRepository } from "../../apps/api/src/infrastructure/repositories/postgres-session-repository.js";
import { PostgresUnitOfWork } from "../../apps/api/src/infrastructure/repositories/postgres-unit-of-work.js";
import { PostgresUserRepository } from "../../apps/api/src/infrastructure/repositories/postgres-user-repository.js";
import { PostgresVoteRepository } from "../../apps/api/src/infrastructure/repositories/postgres-vote-repository.js";
import { ApiClient } from "../../apps/client/src/api/client.js";
import { createSessionStore } from "../../apps/client/src/api/session.js";
import { JudgeApp } from "../../apps/client/src/app/app.js";
import { systemClock } from "../../apps/client/src/offline/clock.js";
import { createManualConnectivity } from "../../apps/client/src/offline/connectivity.js";
import { MemoryStorage } from "../../apps/client/src/offline/storage.js";
import { OfflineStore } from "../../apps/client/src/offline/store.js";
import { SyncManager, type SyncSnapshot } from "../../apps/client/src/offline/sync-manager.js";
import { createHttpTransport } from "../../apps/client/src/offline/transport.js";
import type { LocalPlanilla, LocalVote } from "../../apps/client/src/offline/types.js";
import { createRouter } from "../../apps/client/src/ui/router.js";
import {
  apiJson,
  applyMigrations,
  bootRealApi,
  ensurePostgresRunning,
  FileKVStorage,
  resetE2eDatabase,
  resolvePsqlBin,
  seedE2eDatabase,
  sha256,
  shutdownHarness,
  sleep,
  tempKvFile,
  type E2EHarness,
} from "./infra.js";
import {
  ADMIN_EMAIL,
  ADMIN_ID,
  CANDIDATE_ID,
  COMPARSA_ID,
  CONFIG_RULES_REF,
  E2E_DB_URL,
  E2E_PSQL_MODE,
  EDITION_ID,
  ITEM_ID,
  JUDGE_DISPLAY_NAME,
  JUDGE_EMAIL,
  JUDGE_ID,
  NIGHT1_ID,
  NIGHT2_ID,
  NIGHT3_ID,
  RUBRO_ID,
  SPECIALTY_ID,
  SPECIALTY_VESTUARIO_ID,
} from "./fixtures.js";

class RollbackProbeError extends Error {}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("expected a record value");
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("expected an array value");
  return value;
}

function buildRepos(db: DbPool, uow: UnitOfWork): Repositories {
  return {
    editions: new PostgresEditionRepository(db),
    nights: new PostgresNightRepository(db),
    configurations: new PostgresConfigurationRepository(db),
    users: new PostgresUserRepository(db),
    sessions: new PostgresSessionRepository(db),
    accessTokens: new PostgresAccessTokenRepository(db),
    planillas: new PostgresPlanillaRepository(db),
    votes: new PostgresVoteRepository(db),
    assignments: new PostgresJudgeAssignmentRepository(db),
    catalogue: new PostgresCatalogueRepository(db),
    audits: new PostgresAuditRepository(db),
    uow,
  };
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 10000,
  intervalMs = 60,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    }
    await sleep(intervalMs);
  }
}

async function countEvent(db: DbPool, eventType: string, actorUserId: string): Promise<number> {
  const result = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM audit_event WHERE event_type = $1 AND actor_user_id = $2`,
    [eventType, actorUserId],
  );
  return result.rows[0]?.n ?? 0;
}

async function countEventForEntity(
  db: DbPool,
  eventType: string,
  entityId: string,
): Promise<number> {
  const result = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM audit_event WHERE event_type = $1 AND entity_id = $2`,
    [eventType, entityId],
  );
  return result.rows[0]?.n ?? 0;
}

describe("HITO E2E real: cliente offline-first -> API real -> PostgreSQL real", () => {
  let harness: E2EHarness;
  let psqlBin: string;
  let sessionToken: string;

  const kvFile = tempKvFile("outbox");

  let planilla1Id: string;
  let vote1Id: string;
  let vote1IdempotencyKey: string;

  beforeAll(async () => {
    await ensurePostgresRunning();
    // Modo docker (por defecto): psql proviene del contenedor; no se resuelve
    // ningún binario psql local. Solo el modo "local" usa resolvePsqlBin().
    psqlBin = E2E_PSQL_MODE === "docker" ? "" : await resolvePsqlBin();
    await resetE2eDatabase();
    await applyMigrations(psqlBin);
    harness = await bootRealApi();
    await seedE2eDatabase(harness.db);
  });

  afterAll(async () => {
    if (harness) await shutdownHarness(harness);
    fs.rmSync(kvFile, { force: true });
  });

  // -------------------------------------------------------------------------
  // A. Autenticación real y token opaco
  // -------------------------------------------------------------------------

  test("A. login real: token opaco y en BD solo su SHA-256 (nunca el token plano)", async () => {
    const login = await apiJson(
      harness.baseUrl,
      "POST",
      "/auth/login",
      undefined,
      { email: JUDGE_EMAIL, password: "ChangeMe-2027!" },
    );
    expect(login.status).toBe(200);
    const body = asRecord(login.body);
    expect(typeof body.token).toBe("string");
    const user = asRecord(body.user);
    expect(user.id).toBe(JUDGE_ID);
    expect(user.email).toBe(JUDGE_EMAIL);
    expect(user.role).toBe("JUDGE");
    expect(user.displayName).toBe(JUDGE_DISPLAY_NAME);
    sessionToken = body.token as string;

    const tokenColumns = await harness.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.columns
       WHERE table_name = 'session' AND column_name IN ('token', 'token_plaintext')`,
    );
    expect(tokenColumns.rows[0]?.n ?? 0).toBe(0);

    const hashColumns = await harness.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.columns
       WHERE table_name = 'session' AND column_name = 'token_hash'`,
    );
    expect(hashColumns.rows[0]?.n ?? 0).toBe(1);

    const sessions = await harness.db.query<{ token_hash: string }>(
      `SELECT token_hash FROM session WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [JUDGE_ID],
    );
    expect(sessions.rows.length).toBe(1);
    expect(sessions.rows[0].token_hash).toBe(sha256(sessionToken));

    const me = await apiJson(harness.baseUrl, "GET", "/auth/me", sessionToken);
    expect(me.status).toBe(200);
    expect(asRecord(asRecord(me.body)).email).toBe(JUDGE_EMAIL);
  });

  // -------------------------------------------------------------------------
  // B. Cliente real: contexto obtenido de la API real
  // -------------------------------------------------------------------------

  test("B. cliente real (JudgeApp + OfflineStore + SyncManager) obtiene contexto real", async () => {
    const cache = new MemoryStorage();
    const store = new OfflineStore(cache);
    const connectivity = createManualConnectivity(true);
    const session = createSessionStore();
    const router = createRouter();
    const api = new ApiClient({ baseUrl: harness.baseUrl, getToken: () => session.getToken() });
    const statusListeners = new Set<(snapshot: SyncSnapshot) => void>();
    const sync = new SyncManager({
      store,
      transport: createHttpTransport({
        baseUrl: harness.baseUrl,
        getToken: () => session.getToken(),
      }),
      connectivity,
      clock: systemClock,
      maxAttempts: 8,
      backoff: { baseMs: 50, maxMs: 2000, random: () => 0.5 },
      onStatusChange: (snapshot) => {
        for (const listener of Array.from(statusListeners)) listener(snapshot);
      },
    });
    sync.start();
    const app = new JudgeApp({
      api,
      store,
      sync: {
        getSnapshot: () => sync.getSnapshot(),
        whenStatusChanges: (listener) => {
          statusListeners.add(listener);
          return () => statusListeners.delete(listener);
        },
        syncAllOnce: () => sync.syncAllOnce(),
        enqueuePlanilla: (planilla, votes) => sync.enqueuePlanilla(planilla, votes),
      },
      connectivity,
      session,
      router,
      cache,
      clock: { nowIso: () => systemClock.nowIso() },
      createId: () => randomUUID(),
    });

    await app.boot();
    await app.login(JUDGE_EMAIL, "ChangeMe-2027!");
    await waitFor(() => app.getState().context !== null);

    const state = app.getState();
    expect(state.user?.email).toBe(JUDGE_EMAIL);
    const context = asRecord(state.context);
    const nights = asArray(context.nights);
    expect(nights.some((n) => asRecord(n).id === NIGHT1_ID)).toBe(true);
    expect(nights.some((n) => asRecord(n).id === NIGHT2_ID)).toBe(true);
    const configuration = asRecord(context.configuration);
    expect(configuration.status).toBe("CONGELADA");
    sync.stop();
  });

  // -------------------------------------------------------------------------
  // C. Offline-first: captura offline, outbox en disco, reconexión real
  // -------------------------------------------------------------------------

  test("C. captura offline con outbox persistente en disco, reconexión y sincronización real", async () => {
    const kv = new FileKVStorage(kvFile);
    const store = new OfflineStore(kv);
    const connectivity = createManualConnectivity(true);

    const sync = new SyncManager({
      store,
      transport: createHttpTransport({
        baseUrl: harness.baseUrl,
        getToken: () => sessionToken,
      }),
      connectivity,
      clock: systemClock,
      maxAttempts: 8,
      backoff: { baseMs: 50, maxMs: 2000, random: () => 0.5 },
    });

    // --- Simular pérdida de conectividad: se captura todo offline ---
    connectivity.setOnline(false);

    const nowIso = systemClock.nowIso();
    planilla1Id = randomUUID();
    vote1Id = randomUUID();
    vote1IdempotencyKey = randomUUID();

    const planilla: LocalPlanilla = {
      id: planilla1Id,
      nightId: NIGHT1_ID,
      clientRef: randomUUID(),
      status: "BORRADOR",
      updatedAt: nowIso,
    };
    const vote: LocalVote = {
      id: vote1Id,
      planillaId: planilla1Id,
      nightId: NIGHT1_ID,
      comparsaId: COMPARSA_ID,
      rubroId: RUBRO_ID,
      itemId: ITEM_ID,
      candidateId: CANDIDATE_ID,
      score: 8.5,
      idempotencyKey: vote1IdempotencyKey,
      clientRef: randomUUID(),
      syncState: "PENDING",
      updatedAt: nowIso,
    };
    await sync.enqueuePlanilla(planilla, [vote]);

    expect(store.loadPlanilla(planilla1Id)?.status).toBe("BORRADOR");
    expect(store.loadVote(planilla1Id, vote1Id)?.score).toBe(8.5);
    const opPending = store.findOperationByPlanilla(planilla1Id);
    expect(opPending?.state).toBe("PENDING");

    const beforeAnyPersist = await harness.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM planilla WHERE id = $1`,
      [planilla1Id],
    );
    expect(beforeAnyPersist.rows[0]?.n ?? 0).toBe(0);

    // Reintento de sync OFFLINE: no se envía nada y no se pierde el voto.
    const offlineOutcome = await sync.syncAllOnce();
    expect(offlineOutcome.attempted).toBe(0);
    expect(store.findOperationByPlanilla(planilla1Id)?.state).toBe("PENDING");
    expect(store.loadVote(planilla1Id, vote1Id)?.syncState).toBe("PENDING");

    // El outbox sobrevive a un reinicio del proceso (KV persistente en disco).
    const reloaded = new OfflineStore(new FileKVStorage(kvFile));
    expect(reloaded.loadPlanilla(planilla1Id)?.status).toBe("BORRADOR");
    expect(reloaded.loadVote(planilla1Id, vote1Id)?.score).toBe(8.5);
    expect(reloaded.findOperationByPlanilla(planilla1Id)?.state).toBe("PENDING");

    // --- Recuperación de conectividad: sincronización real ---
    // Al ponerse online el SyncManager auto-drena vía su suscripción de
    // conectividad; el resultado se observa de forma determinista esperando
    // el estado SYNCED (no via un syncAllOnce() manual, que ya no encontraría
    // la operación porque el drenado en background la toma primero).
    connectivity.setOnline(true);
    await waitFor(
      () => store.findOperationByPlanilla(planilla1Id)?.state === "SYNCED",
      10000,
      60,
    );
    expect(sync.getSnapshot().synced).toBeGreaterThanOrEqual(1);
    expect(store.loadVote(planilla1Id, vote1Id)?.syncState).toBe("SYNCED");

    // Persistencia REAL verificada en PostgreSQL.
    const planillaRows = await harness.db.query<{
      judge_id: string;
      night_id: string;
      client_ref: string | null;
      status: string;
      confirmed_at: string | null;
    }>(`SELECT judge_id, night_id, client_ref, status, confirmed_at FROM planilla WHERE id = $1`, [
      planilla1Id,
    ]);
    expect(planillaRows.rows).toHaveLength(1);
    expect(planillaRows.rows[0]).toMatchObject({
      judge_id: JUDGE_ID,
      night_id: NIGHT1_ID,
      status: "BORRADOR",
      confirmed_at: null,
    });
    expect(planillaRows.rows[0].client_ref).toBeTruthy();

    const voteRows = await harness.db.query<{
      comparsa_id: string;
      rubro_id: string;
      item_id: string;
      candidate_id: string;
      score: string;
      sync_state: string;
      idempotency_key: string;
      client_ref: string | null;
      confirmed_at: string | null;
    }>(
      `SELECT comparsa_id, rubro_id, item_id, candidate_id, score, sync_state,
              idempotency_key, client_ref, confirmed_at
       FROM vote WHERE id = $1`,
      [vote1Id],
    );
    expect(voteRows.rows).toHaveLength(1);
    expect(voteRows.rows[0]).toMatchObject({
      comparsa_id: COMPARSA_ID,
      rubro_id: RUBRO_ID,
      item_id: ITEM_ID,
      candidate_id: CANDIDATE_ID,
      score: "8.5",
      sync_state: "PENDING",
      confirmed_at: null,
    });
    expect(voteRows.rows[0].idempotency_key).toBe(vote1IdempotencyKey);
    expect(voteRows.rows[0].client_ref).toBeTruthy();

    // Auditoría de la creación de la planilla por parte del juez.
    expect(await countEventForEntity(harness.db, "PLANILLA_CREATED", planilla1Id)).toBe(1);

    const list = await apiJson(harness.baseUrl, "GET", "/judge/planillas", sessionToken);
    expect(list.status).toBe(200);
    const summaries = asArray(list.body) as PlanillaSummary[];
    const summary = summaries.find((p) => p.id === planilla1Id);
    expect(summary?.id).toBe(planilla1Id);
    expect(summary?.status).toBe("BORRADOR");
  });

  // -------------------------------------------------------------------------
  // D. Idempotencia: reenvío del MISMO payload de sync
  // -------------------------------------------------------------------------

  test("D. reenvío idempotente del mismo payload de sync (ALREADY_EXISTS/EXISTS, sin duplicados)", async () => {
    const planillaRow = await harness.db.query<{ night_id: string; client_ref: string | null }>(
      `SELECT night_id, client_ref FROM planilla WHERE id = $1`,
      [planilla1Id],
    );
    const voteRows = await harness.db.query<{
      id: string;
      planilla_id: string;
      comparsa_id: string;
      rubro_id: string;
      item_id: string;
      candidate_id: string;
      score: number;
      idempotency_key: string;
      client_ref: string | null;
    }>(
      `SELECT id, planilla_id, comparsa_id, rubro_id, item_id, candidate_id,
              score::float8 AS score, idempotency_key, client_ref
       FROM vote WHERE planilla_id = $1`,
      [planilla1Id],
    );
    expect(voteRows.rows).toHaveLength(1);

    const verdicts = voteRows.rows.map((v): SyncVotePayload => ({
      id: v.id,
      planillaId: v.planilla_id,
      comparsaId: v.comparsa_id,
      rubroId: v.rubro_id,
      itemId: v.item_id,
      candidateId: v.candidate_id,
      score: v.score,
      idempotencyKey: v.idempotency_key,
      ...(v.client_ref === null ? {} : { clientRef: v.client_ref }),
    }));

    const payload: SyncPlanillaPayload = {
      planilla: {
        id: planilla1Id,
        nightId: planillaRow.rows[0].night_id,
        clientRef: planillaRow.rows[0].client_ref ?? "",
        status: "BORRADOR",
      },
      votes: verdicts,
    };

    const res = await apiJson(
      harness.baseUrl,
      "POST",
      "/judge/planillas/sync",
      sessionToken,
      { planillas: [payload] },
    );
    expect(res.status).toBe(200);
    const body = asRecord(res.body);
    const planillas = asArray(body.planillas);
    expect(planillas).toHaveLength(1);
    const planillaResult = asRecord(planillas[0]);
    expect(planillaResult.planillaId).toBe(planilla1Id);
    expect(planillaResult.planillaAction).toBe("ALREADY_EXISTS");
    const votes = asArray(planillaResult.votes);
    expect(votes).toHaveLength(1);
    expect(asRecord(votes[0]).action).toBe("EXISTS");

    const planillaCount = await harness.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM planilla WHERE id = $1`,
      [planilla1Id],
    );
    expect(planillaCount.rows[0]?.n ?? 0).toBe(1);
    const voteCount = await harness.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM vote WHERE planilla_id = $1`,
      [planilla1Id],
    );
    expect(voteCount.rows[0]?.n ?? 0).toBe(1);
    expect(await countEventForEntity(harness.db, "PLANILLA_CREATED", planilla1Id)).toBe(1);
  });

  // -------------------------------------------------------------------------
  // E. Confirmación real
  // -------------------------------------------------------------------------

  test("E. confirmación real: CONFIRMADA, 1 voto confirmado, 0 omisiones (N=1)", async () => {
    const voteConfirmedBefore = await countEvent(harness.db, "VOTE_CONFIRMED", JUDGE_ID);
    const planillaModifiedBefore = await countEventForEntity(
      harness.db,
      "PLANILLA_MODIFIED",
      planilla1Id,
    );
    const omissionBefore = await countEvent(harness.db, "OMISSION_CORRECTED", JUDGE_ID);

    const res = await apiJson(
      harness.baseUrl,
      "POST",
      `/judge/planillas/${planilla1Id}/confirm`,
      sessionToken,
    );
    expect(res.status).toBe(200);
    const body = asRecord(res.body);
    expect(body.votesConfirmed).toBe(1);
    expect(body.omissionsInserted).toBe(0);
    expect(asRecord(body.planilla).status).toBe("CONFIRMADA");
    expect(asRecord(body.planilla).confirmedAt).not.toBe(null);

    const planilla = await harness.db.query<{ status: string; confirmed_at: string | null }>(
      `SELECT status, confirmed_at FROM planilla WHERE id = $1`,
      [planilla1Id],
    );
    expect(planilla.rows[0].status).toBe("CONFIRMADA");
    expect(planilla.rows[0].confirmed_at).not.toBe(null);

    const vote = await harness.db.query<{ confirmed_at: string | null; score: string }>(
      `SELECT confirmed_at, score FROM vote WHERE id = $1`,
      [vote1Id],
    );
    expect(vote.rows[0].confirmed_at).not.toBe(null);
    expect(vote.rows[0].score).toBe("8.5");

    expect(await countEvent(harness.db, "VOTE_CONFIRMED", JUDGE_ID)).toBe(
      voteConfirmedBefore + 1,
    );
    expect(
      await countEventForEntity(harness.db, "PLANILLA_MODIFIED", planilla1Id),
    ).toBe(planillaModifiedBefore + 1);
    expect(await countEvent(harness.db, "OMISSION_CORRECTED", JUDGE_ID)).toBe(omissionBefore);

    // Confirmación repetida: idempotente (resultado 0 + 0, sin nuevos eventos).
    const resRepeat = await apiJson(
      harness.baseUrl,
      "POST",
      `/judge/planillas/${planilla1Id}/confirm`,
      sessionToken,
    );
    expect(resRepeat.status).toBe(200);
    expect(asRecord(resRepeat.body).votesConfirmed).toBe(0);
    expect(asRecord(resRepeat.body).omissionsInserted).toBe(0);
  });

  // -------------------------------------------------------------------------
  // F. Inmutabilidad persistente tras la confirmación
  // -------------------------------------------------------------------------

  test("F. inmutabilidad: API 409 y triggers reales en PostgreSQL", async () => {
    // API: intentar modificar un voto de planilla confirmada → ConflictError.
    const edit = await apiJson(
      harness.baseUrl,
      "PUT",
      `/judge/planillas/${planilla1Id}/votes/${vote1Id}`,
      sessionToken,
      {
        comparsaId: COMPARSA_ID,
        rubroId: RUBRO_ID,
        itemId: ITEM_ID,
        candidateId: CANDIDATE_ID,
        score: 3,
        idempotencyKey: randomUUID(),
      },
    );
    expect(edit.status).toBe(409);
    expect(asRecord(asRecord(edit.body).error).code).toBe("PLANILLA_NOT_EDITABLE");

    // Persistencia: UPDATE del voto confirmado bloqueado por trigger real.
    // DatabaseError oculta el mensaje interno en `internalMessage` (no se
    // expone al cliente); la garantía se verifica sobre esa propiedad.
    await expect(
      harness.db.query(`UPDATE vote SET score = 3 WHERE id = $1`, [vote1Id]),
    ).rejects.toMatchObject({
      internalMessage: expect.stringContaining("voto confirmado es inmutable"),
    });

    await expect(
      harness.db.query(`DELETE FROM vote WHERE id = $1`, [vote1Id]),
    ).rejects.toMatchObject({
      internalMessage: expect.stringContaining("voto confirmado es inmutable"),
    });

    // Persistencia: auditoría append-only (sin UPDATE/DELETE).
    const auditId = await harness.db.query<{ id: string }>(
      `SELECT id FROM audit_event WHERE entity_id = $1 AND event_type = 'VOTE_CONFIRMED' LIMIT 1`,
      [vote1Id],
    );
    if (auditId.rows.length > 0) {
      const id = auditId.rows[0].id;
      await expect(
        harness.db.query(`UPDATE audit_event SET payload = '{}'::jsonb WHERE id = $1`, [id]),
      ).rejects.toMatchObject({
        internalMessage: expect.stringContaining("audit_event es append-only"),
      });
      await expect(
        harness.db.query(`DELETE FROM audit_event WHERE id = $1`, [id]),
      ).rejects.toMatchObject({
        internalMessage: expect.stringContaining("audit_event es append-only"),
      });
    }

    const finalVote = await harness.db.query<{ score: string; confirmed_at: string | null }>(
      `SELECT score, confirmed_at FROM vote WHERE id = $1`,
      [vote1Id],
    );
    expect(finalVote.rows[0].score).toBe("8.5");
    expect(finalVote.rows[0].confirmed_at).not.toBe(null);

    const planilla = await harness.db.query<{ status: string }>(
      `SELECT status FROM planilla WHERE id = $1`,
      [planilla1Id],
    );
    expect(planilla.rows[0].status).toBe("CONFIRMADA");
  });

  // -------------------------------------------------------------------------
  // G. Rollback real con unidad de trabajo que falla antes del commit
  // -------------------------------------------------------------------------

  test("G. rollback real: fallo inyectado en la UoW => nada se persiste", async () => {
    const created = await apiJson(
      harness.baseUrl,
      "POST",
      "/judge/planillas",
      sessionToken,
      { nightId: NIGHT2_ID },
    );
    expect(created.status).toBe(201);
    const planilla2Id = asRecord(asRecord(created.body).planilla).id as string;

    const vote2Id = randomUUID();
    const upserted = await apiJson(
      harness.baseUrl,
      "PUT",
      `/judge/planillas/${planilla2Id}/votes/${vote2Id}`,
      sessionToken,
      {
        comparsaId: COMPARSA_ID,
        rubroId: RUBRO_ID,
        itemId: ITEM_ID,
        candidateId: CANDIDATE_ID,
        score: 9,
        idempotencyKey: randomUUID(),
      },
    );
    expect(upserted.status).toBe(200);
    expect(asRecord(upserted.body).id).toBe(vote2Id);

    const confirmedBefore = await countEvent(harness.db, "VOTE_CONFIRMED", JUDGE_ID);
    const modifiedBefore = await countEventForEntity(
      harness.db,
      "PLANILLA_MODIFIED",
      planilla2Id,
    );

    const realUow = new PostgresUnitOfWork(harness.db);
    const faultingUow: UnitOfWork = {
      withTransaction: async <T>(
        fn: (tx: UnitOfWorkRepositories) => Promise<T>,
      ): Promise<T> => {
        return realUow.withTransaction(async (tx) => {
          const result = await fn(tx);
          throw new RollbackProbeError("Fallo simulado justo antes del commit");
        });
      },
    };
    const app = createApplication(buildRepos(harness.db, faultingUow), {
      sessionTtlHours: 12,
    });

    await expect(
      app.confirmPlanilla.execute({ judgeId: JUDGE_ID, planillaId: planilla2Id }),
    ).rejects.toThrow(RollbackProbeError);

    // Nada de la confirmación quedó persistido.
    const planilla2 = await harness.db.query<{ status: string; confirmed_at: string | null }>(
      `SELECT status, confirmed_at FROM planilla WHERE id = $1`,
      [planilla2Id],
    );
    expect(planilla2.rows[0].status).toBe("BORRADOR");
    expect(planilla2.rows[0].confirmed_at).toBe(null);

    const vote2 = await harness.db.query<{ score: string; confirmed_at: string | null }>(
      `SELECT score, confirmed_at FROM vote WHERE id = $1`,
      [vote2Id],
    );
    expect(vote2.rows[0].score).toBe("9.0");
    expect(vote2.rows[0].confirmed_at).toBe(null);

    expect(await countEvent(harness.db, "VOTE_CONFIRMED", JUDGE_ID)).toBe(confirmedBefore);
    expect(
      await countEventForEntity(harness.db, "PLANILLA_MODIFIED", planilla2Id),
    ).toBe(modifiedBefore);
  });

  // -------------------------------------------------------------------------
  // H. Concurrencia real: dos confirmaciones paralelas
  // -------------------------------------------------------------------------

  test("H. concurrencia real: dos confirmaciones paralelas => una única transición", async () => {
    const list = await apiJson(harness.baseUrl, "GET", "/judge/planillas", sessionToken);
    expect(list.status).toBe(200);
    const summaries = asArray(list.body) as Array<Record<string, unknown>>;
    const planilla2 = summaries.find(
      (p) => p.nightId === NIGHT2_ID && p.status === "BORRADOR",
    );
    expect(planilla2).toBeDefined();
    const planilla2Id = planilla2!.id as string;

    const voteConfirmedBefore = await countEvent(harness.db, "VOTE_CONFIRMED", JUDGE_ID);
    const modifiedBefore = await countEventForEntity(
      harness.db,
      "PLANILLA_MODIFIED",
      planilla2Id,
    );

    const [first, second] = await Promise.all([
      apiJson(harness.baseUrl, "POST", `/judge/planillas/${planilla2Id}/confirm`, sessionToken),
      apiJson(harness.baseUrl, "POST", `/judge/planillas/${planilla2Id}/confirm`, sessionToken),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const votesConfirmedSum =
      Number(asRecord(first.body).votesConfirmed) +
      Number(asRecord(second.body).votesConfirmed);
    expect(votesConfirmedSum).toBe(1);

    const planilla = await harness.db.query<{ status: string; confirmed_at: string | null }>(
      `SELECT status, confirmed_at FROM planilla WHERE id = $1`,
      [planilla2Id],
    );
    expect(planilla.rows[0].status).toBe("CONFIRMADA");
    expect(planilla.rows[0].confirmed_at).not.toBe(null);

    expect(await countEvent(harness.db, "VOTE_CONFIRMED", JUDGE_ID)).toBe(
      voteConfirmedBefore + 1,
    );
    expect(
      await countEventForEntity(harness.db, "PLANILLA_MODIFIED", planilla2Id),
    ).toBe(modifiedBefore + 1);

    expect(await countEventForEntity(harness.db, "PLANILLA_CREATED", planilla2Id)).toBe(1);
  });

  // -------------------------------------------------------------------------
  // I. Ventana de votación de la noche (FASE B)
  // -------------------------------------------------------------------------

  test("I. ventana de votación: el servidor la aplica a votos y confirmación (create NO se bloquea)", async () => {
    // Noche 3 dedicada (seed con fecha NULL). Se fija una ventana CERRADA
    // respecto del reloj del servidor: starts_at = ahora - 1 día,
    // ends_at = ahora - 1 hora. El servidor es la autoridad temporal; la
    // pérdida de conectividad NO extiende la ventana (PEND-104).
    await harness.db.query(
      `UPDATE night SET starts_at = now() - interval '1 day', ends_at = now() - interval '1 hour' WHERE id = $1`,
      [NIGHT3_ID],
    );

    try {
      // create-planilla NO se bloquea por ventana cerrada (borrador vacío sin
      // votos: decisión técnica documentada).
      const created = await apiJson(
        harness.baseUrl,
        "POST",
        "/judge/planillas",
        sessionToken,
        { nightId: NIGHT3_ID },
      );
      expect(created.status).toBe(201);
      const planilla3Id = asRecord(asRecord(created.body).planilla).id as string;

      // upsert-vote → 409 NIGHT_WINDOW_CLOSED (escritura de voto bloqueada).
      const upserted = await apiJson(
        harness.baseUrl,
        "PUT",
        `/judge/planillas/${planilla3Id}/votes/${randomUUID()}`,
        sessionToken,
        {
          comparsaId: COMPARSA_ID,
          rubroId: RUBRO_ID,
          itemId: ITEM_ID,
          candidateId: CANDIDATE_ID,
          score: 8,
          idempotencyKey: randomUUID(),
        },
      );
      expect(upserted.status).toBe(409);
      expect(asRecord(asRecord(upserted.body).error).code).toBe("NIGHT_WINDOW_CLOSED");

      // sync de un borrador → resultado per-vote REJECTED NIGHT_WINDOW_CLOSED,
      // sin error fatal del sync (HTTP 200, el flujo continúa).
      const syncPayload: SyncPlanillaPayload = {
        planilla: {
          id: planilla3Id,
          nightId: NIGHT3_ID,
          clientRef: randomUUID(),
          status: "BORRADOR",
        },
        votes: [
          {
            id: randomUUID(),
            planillaId: planilla3Id,
            comparsaId: COMPARSA_ID,
            rubroId: RUBRO_ID,
            itemId: ITEM_ID,
            candidateId: CANDIDATE_ID,
            score: 8,
            idempotencyKey: randomUUID(),
            clientRef: randomUUID(),
          },
        ],
      };
      const synced = await apiJson(
        harness.baseUrl,
        "POST",
        "/judge/planillas/sync",
        sessionToken,
        { planillas: [syncPayload] },
      );
      expect(synced.status).toBe(200);
      const syncBody = asRecord(synced.body);
      const syncPlanillas = asArray(syncBody.planillas);
      const planillaResult = syncPlanillas.find(
        (p) => asRecord(p).planillaId === planilla3Id,
      ) as Record<string, unknown>;
      expect(planillaResult).toBeDefined();
      const voteResults = asArray(planillaResult.votes) as Array<Record<string, unknown>>;
      expect(voteResults.length).toBeGreaterThanOrEqual(1);
      expect(voteResults[0].action).toBe("REJECTED");
      expect(voteResults[0].reason).toBe("NIGHT_WINDOW_CLOSED");

      // confirm → 409 NIGHT_WINDOW_CLOSED (la ventana se aplica dentro de la
      // transacción, antes de confirmar).
      const confirmed = await apiJson(
        harness.baseUrl,
        "POST",
        `/judge/planillas/${planilla3Id}/confirm`,
        sessionToken,
      );
      expect(confirmed.status).toBe(409);
      expect(asRecord(asRecord(confirmed.body).error).code).toBe("NIGHT_WINDOW_CLOSED");

      // La planilla NO quedó confirmada ni mutada.
      const planillaRow = await harness.db.query<{ status: string }>(
        `SELECT status FROM planilla WHERE id = $1`,
        [planilla3Id],
      );
      expect(planillaRow.rows[0]?.status ?? "").toBe("BORRADOR");
    } finally {
      // Dejar el estado limpio: restaurar la ventana a NULL (sin fechas
      // oficiales) para no afectar tests futuros.
      await harness.db.query(
        `UPDATE night SET starts_at = NULL, ends_at = NULL WHERE id = $1`,
        [NIGHT3_ID],
      );
    }
  });

  // -------------------------------------------------------------------------
  // K. Consola de administración (Slice 1, frontend-espejo contra API real)
  // -------------------------------------------------------------------------

  test("K. consola admin real: contexto, ABM de catálogo, noche, asignación y auditoría", async () => {
    // 1. Login de ADMIN real.
    const login = await apiJson(
      harness.baseUrl,
      "POST",
      "/auth/login",
      undefined,
      { email: ADMIN_EMAIL, password: "ChangeMe-2027!" },
    );
    expect(login.status).toBe(200);
    const adminBody = asRecord(login.body);
    expect(asRecord(adminBody.user).id).toBe(ADMIN_ID);
    expect(asRecord(adminBody.user).role).toBe("ADMIN");
    const adminToken = adminBody.token as string;

    // 2. Contexto de la consola.
    const ctx = await apiJson(harness.baseUrl, "GET", "/admin/context", adminToken);
    expect(ctx.status).toBe(200);
    const ctxBody = asRecord(ctx.body);
    const counts = asRecord(ctxBody.counts);
    expect(Number(counts.comparsas)).toBeGreaterThanOrEqual(1);
    // El contexto expone cada especialidad con identidad persistida (id) y
    // código de dominio (code), de modo que la consola puede construir un
    // AssignmentInput válido con el UUID real.
    const specialties = asArray(ctxBody.specialties).map((s) => asRecord(s));
    expect(specialties.some((s) => s.code === "BAILE" && s.id === SPECIALTY_ID)).toBe(true);
    expect(specialties.some((s) => s.code === "VESTUARIO" && s.id === SPECIALTY_VESTUARIO_ID)).toBe(true);
    const specialtyId = specialties.find((s) => s.code === "BAILE")?.id as string;
    expect(specialtyId).toBe(SPECIALTY_ID);
    const vestuarioId = specialties.find((s) => s.code === "VESTUARIO")?.id as string;
    expect(vestuarioId).toBe(SPECIALTY_VESTUARIO_ID);
    const nights = asArray(ctxBody.nights);
    expect(nights.length).toBeGreaterThanOrEqual(1);
    const judges = asArray(ctxBody.judges);
    expect(judges.some((j) => asRecord(j).id === JUDGE_ID)).toBe(true);

    // 3. ABM de comparsa: crear, listar, actualizar (create/update/list).
    const code = `E2E-${randomUUID().slice(0, 8)}`.toUpperCase();
    const created = await apiJson(
      harness.baseUrl,
      "POST",
      "/admin/comparsas",
      adminToken,
      { code, name: "Comparsa Admin E2E" },
    );
    expect(created.status).toBe(201);
    const createdItem = asRecord(asRecord(created.body).item);
    const comparsaId = createdItem.id as string;
    expect(createdItem.code).toBe(code);

    const list = await apiJson(harness.baseUrl, "GET", "/admin/comparsas", adminToken);
    expect(list.status).toBe(200);
    const comparsas = asArray(list.body);
    expect(comparsas.some((c) => asRecord(c).id === comparsaId)).toBe(true);

    const updated = await apiJson(
      harness.baseUrl,
      "PUT",
      `/admin/comparsas/${comparsaId}`,
      adminToken,
      { code, name: "Comparsa Admin Renombrada" },
    );
    expect(updated.status).toBe(200);
    expect(asRecord(asRecord(updated.body).item).name).toBe("Comparsa Admin Renombrada");

    // 4. Rubro (create) con specialty por código (el backend resuelve → ID).
    const rubroCode = "BAILE";
    const rubro = await apiJson(
      harness.baseUrl,
      "POST",
      "/admin/rubros",
      adminToken,
      { specialty: rubroCode, name: "Rubro Admin E2E", type: "NOMINATIVO" },
    );
    expect(rubro.status).toBe(201);
    const rubroItem = asRecord(asRecord(rubro.body).item);
    expect(rubroItem.specialty).toBe("BAILE");

    // 5. Ítem del rubro (create).
    const rubroId = rubroItem.id as string;
    const item = await apiJson(
      harness.baseUrl,
      "POST",
      `/admin/rubros/${rubroId}/items`,
      adminToken,
      { name: "Ítem Admin E2E", orderIndex: 1 },
    );
    expect(item.status).toBe(201);
    const createdItemEntity = asRecord(asRecord(item.body).item);
    const itemId = createdItemEntity.id as string;

    // 6. Candidato ligado al ítem y a la comparsa recién creada (create).
    const candidate = await apiJson(
      harness.baseUrl,
      "POST",
      "/admin/candidates",
      adminToken,
      { itemId, comparsaId, label: "Candidato Admin E2E" },
    );
    expect(candidate.status).toBe(201);
    expect(asRecord(asRecord(candidate.body).item).comparsaId).toBe(comparsaId);

    // 7. Noche: editar la ventana de votación (update) y limpiar un campo (null).
    const nightId = asRecord(nights[0]).id as string;
    const windowUpdate = await apiJson(
      harness.baseUrl,
      "PUT",
      `/admin/nights/${nightId}`,
      adminToken,
      { startsAt: "2027-01-15T21:00:00.000Z", endsAt: "2027-01-15T23:59:00.000Z" },
    );
    expect(windowUpdate.status).toBe(200);
    expect(asRecord(windowUpdate.body).startsAt).toBe("2027-01-15T21:00:00.000Z");

    // Limpiar un campo individual (null) — comportamiento del frontend: cada
    // campo se envía independientemente; el servidor exige al menos un campo.
    const clearStart = await apiJson(
      harness.baseUrl,
      "PUT",
      `/admin/nights/${nightId}`,
      adminToken,
      { startsAt: null },
    );
    expect(clearStart.status).toBe(200);
    expect((asRecord(clearStart.body) as Record<string, unknown>).startsAt).toBeUndefined();
    expect(asRecord(clearStart.body).endsAt).toBe("2027-01-15T23:59:00.000Z");

    // 8. Asignación existente: ajustar habilitación (update, isEffective=false).
    const assignments = await apiJson(harness.baseUrl, "GET", "/admin/assignments", adminToken);
    expect(assignments.status).toBe(200);
    const assignmentList = asArray(assignments.body);
    const target = assignmentList.find(
      (a) => asRecord(a).nightId === nightId && asRecord(a).specialtyId === SPECIALTY_ID,
    ) as Record<string, unknown>;
    expect(target).toBeDefined();
    const assignmentId = target.id as string;
    const assignmentUpdate = await apiJson(
      harness.baseUrl,
      "PUT",
      `/admin/assignments/${assignmentId}`,
      adminToken,
      { ...target, isEffective: false },
    );
    expect(assignmentUpdate.status).toBe(200);
    expect(asRecord(asRecord(assignmentUpdate.body).item).isEffective).toBe(false);

    // 8b. Crear una asignación NUEVA usando el `specialtyId` real del contexto
    // (gap contractual resuelto): el frontend puede construir un
    // AssignmentInput con el UUID, sin inventar el mapa código→ID.
    const newAssignment = await apiJson(
      harness.baseUrl,
      "POST",
      "/admin/assignments",
      adminToken,
      { judgeId: JUDGE_ID, nightId: NIGHT2_ID, specialtyId: vestuarioId, isEffective: true },
    );
    expect(newAssignment.status).toBe(201);
    const newAssignmentId = asRecord(asRecord(newAssignment.body).item).id as string;
    expect(asRecord(asRecord(newAssignment.body).item).specialtyId).toBe(SPECIALTY_VESTUARIO_ID);

    // Consultar la asignación creada.
    const listAfterCreate = await apiJson(harness.baseUrl, "GET", "/admin/assignments", adminToken);
    expect(listAfterCreate.status).toBe(200);
    expect(
      asArray(listAfterCreate.body).some((a) => asRecord(a).id === newAssignmentId),
    ).toBe(true);

    // La unicidad existente se respeta: duplicar la combinación juez/noche/
    // especialidad es rechazado (409).
    const duplicate = await apiJson(
      harness.baseUrl,
      "POST",
      "/admin/assignments",
      adminToken,
      { judgeId: JUDGE_ID, nightId: NIGHT2_ID, specialtyId: vestuarioId, isEffective: true },
    );
    expect(duplicate.status).toBe(409);

    // 8c. Una especialidad desconocida es rechazada con 404 controlado: sin
    // 500, sin fila insertada y sin evento de auditoría.
    const unknownSpecialty = randomUUID();
    const unknownSpecialtyPost = await apiJson(
      harness.baseUrl,
      "POST",
      "/admin/assignments",
      adminToken,
      { judgeId: JUDGE_ID, nightId: NIGHT2_ID, specialtyId: unknownSpecialty, isEffective: true },
    );
    expect(unknownSpecialtyPost.status).toBe(404);
    expect(asRecord(asRecord(unknownSpecialtyPost.body).error).code).toBe("NOT_FOUND");
    const unknownSpecialtyAssignment = await harness.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM judge_assignment WHERE specialty_id = $1`,
      [unknownSpecialty],
    );
    expect(unknownSpecialtyAssignment.rows[0]?.n ?? 0).toBe(0);
    const unknownSpecialtyAudit = await harness.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_event
       WHERE event_type = 'ADMIN_ACTION' AND entity_type = 'JUDGE_ASSIGNMENT'
         AND entity_id = $1`,
      [unknownSpecialty],
    );
    // El caso de uso valida la especialidad ANTES de insertar/auditar.
    expect(unknownSpecialtyAudit.rows[0]?.n ?? 0).toBe(0);

    // 9. Auditoría: se escribieron ADMIN_ACTION por el actor ADMIN, incluida la
    // creación de la asignación nueva.
    const auditCount = await harness.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_event
       WHERE event_type = 'ADMIN_ACTION' AND actor_user_id = $1`,
      [ADMIN_ID],
    );
    expect(auditCount.rows[0]?.n ?? 0).toBeGreaterThanOrEqual(8);
    const assignmentAudit = await harness.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_event
       WHERE event_type = 'ADMIN_ACTION' AND entity_type = 'JUDGE_ASSIGNMENT'
         AND entity_id = $1 AND actor_user_id = $2`,
      [newAssignmentId, ADMIN_ID],
    );
    expect(assignmentAudit.rows[0]?.n ?? 0).toBeGreaterThanOrEqual(1);

    // 10. Un juez NO puede acceder a la consola (403).
    const judgeAttempt = await apiJson(harness.baseUrl, "GET", "/admin/context", sessionToken);
    expect(judgeAttempt.status).toBe(403);
    expect(asRecord(asRecord(judgeAttempt.body).error).code).toBe("FORBIDDEN");

    // 11. Un acceso sin credenciales es 401.
    const anon = await apiJson(harness.baseUrl, "GET", "/admin/context");
    expect(anon.status).toBe(401);
  });

  // -------------------------------------------------------------------------
  // L. Regresión end-to-end: el flujo de juez sigue operativo tras el Slice 1
  // -------------------------------------------------------------------------

  test("L. regresión: confirmación de juez sigue íntegra tras la consola admin", async () => {
    // Reusar la planilla 1 (NIGHT1, CONFIRMADA en E) y verificar inmutabilidad.
    const voteBefore = await harness.db.query<{ score: string }>(
      `SELECT score FROM vote WHERE planilla_id = $1 AND comparsa_id = $2 LIMIT 1`,
      [planilla1Id, COMPARSA_ID],
    );
    expect(voteBefore.rows.length).toBeGreaterThanOrEqual(1);
    const score = voteBefore.rows[0].score;

    // La API sigue bloqueando la edición de una planilla confirmada.
    const blocked = await apiJson(
      harness.baseUrl,
      "PUT",
      `/judge/planillas/${planilla1Id}/votes/${vote1Id}`,
      sessionToken,
      {
        comparsaId: COMPARSA_ID,
        rubroId: RUBRO_ID,
        itemId: ITEM_ID,
        candidateId: CANDIDATE_ID,
        score: 1,
        idempotencyKey: randomUUID(),
      },
    );
    expect(blocked.status).toBe(409);
    expect(asRecord(asRecord(blocked.body).error).code).toBe("PLANILLA_NOT_EDITABLE");

    // El voto confirmado permanece intacto en PostgreSQL.
    const after = await harness.db.query<{ score: string }>(
      `SELECT score FROM vote WHERE id = $1`,
      [vote1Id],
    );
    expect(after.rows[0]?.score).toBe(score);
  });

  // -------------------------------------------------------------------------
  // M. Privilegios mínimos reales: SET ROLE votaciones_app (S1.4)
  // -------------------------------------------------------------------------
  // Verifica la migración 006 contra PostgreSQL REAL: el rol dedicado lee
  // globalmente, escribe solo lo autorizado (nunca DELETE), la auditoría es
  // INSERT-only y deliberadamente no puede hacer DDL ni gestionar roles.
  // Se ejecuta con `SET ROLE votaciones_app` real; el rol del runtime
  // (desarrollo/E2E) permanece sin cambios (superusuario).

  const APP_ROLE = "votaciones_app";
  const WRITE_TABLES = [
    "comparsa",
    "rubro",
    "rubro_item",
    "candidate",
    "night",
    "planilla",
    "vote",
    "judge_assignment",
  ] as const;
  const INSERT_ONLY_TABLES = ["audit_event"] as const;

  describe("M. SET ROLE votaciones_app: privilegios mínimos reales (S1.4)", () => {
    let pool: pg.Pool;

    beforeAll(() => {
      pool = new pg.Pool({ connectionString: E2E_DB_URL, max: 1 });
    });

    afterAll(async () => {
      await pool.end();
    });

    // SET ROLE es de sesión: cada probe usa un cliente dedicado aislado.
    // Las operaciones permitidas corren en una transacción que se deshace
    // (ROLLBACK) para no contaminar el estado seed.
    async function runAsApp<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`SET ROLE ${APP_ROLE}`);
        const result = await fn(client);
        await client.query("ROLLBACK");
        return result;
      } finally {
        // Si el probe falló, la transacción quedó abortada; ROLLBACK la
        // reanuda y la sesión vuelve limpia al pool (siempre con SET ROLE).
        await client.query("ROLLBACK").catch(() => {});
        await client.query("RESET ROLE").catch(() => {});
        client.release();
      }
    }

    // Sin transacción envolvente: CREATE ROLE no puede ejecutarse dentro de
    // una transacción; el fallo de permiso ocurre antes de cualquier efecto.
    async function expectAppDenied(sql: string, params?: unknown[]): Promise<void> {
      const client = await pool.connect();
      try {
        await client.query(`SET ROLE ${APP_ROLE}`);
        let error: unknown;
        try {
          await client.query(sql, params);
        } catch (caught) {
          error = caught;
        }
        expect(error, `se esperaba rechazo por privilegios para: ${sql}`).toBeDefined();
        // SQLSTATE 42501 (insufficient_privilege), independiente del locale.
        expect((error as { code?: string }).code).toBe("42501");
      } finally {
        await client.query("RESET ROLE").catch(() => {});
        client.release();
      }
    }

    interface PrivilegeRow {
      tablename: string;
      has_select: boolean;
      has_insert: boolean;
      has_update: boolean;
      has_delete: boolean;
      has_truncate: boolean;
    }

    test("M1. el rol es de solo-uso: sin superuser, sin DDL, sin login", async () => {
      const result = await runAsApp((client) =>
        client.query<{
          rolsuper: boolean;
          rolinherit: boolean;
          rolcreaterole: boolean;
          rolcreatedb: boolean;
          rolcanlogin: boolean;
          rolreplication: boolean;
          rolbypassrls: boolean;
        }>(
          `SELECT rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin,
                  rolreplication, rolbypassrls
           FROM pg_roles WHERE rolname = $1`,
          [APP_ROLE],
        ),
      );
      const role = result.rows[0];
      expect(role).toBeDefined();
      expect(role!.rolsuper).toBe(false);
      expect(role!.rolcreaterole).toBe(false);
      expect(role!.rolcreatedb).toBe(false);
      expect(role!.rolcanlogin).toBe(false);
      expect(role!.rolreplication).toBe(false);
      expect(role!.rolbypassrls).toBe(false);
      expect(typeof role!.rolinherit).toBe("boolean");
    });

    test("M2. schema USAGE, sin CREATE en schema ni en la base", async () => {
      const result = await runAsApp((client) =>
        client.query<{
          usage: boolean;
          schema_create: boolean;
          db_connect: boolean;
          db_create: boolean;
        }>(
          `SELECT has_schema_privilege($1, 'public', 'USAGE') AS usage,
                  has_schema_privilege($1, 'public', 'CREATE') AS schema_create,
                  has_database_privilege($1, current_database(), 'CONNECT') AS db_connect,
                  has_database_privilege($1, current_database(), 'CREATE') AS db_create`,
          [APP_ROLE],
        ),
      );
      expect(result.rows[0]?.usage).toBe(true);
      expect(result.rows[0]?.schema_create).toBe(false);
      expect(result.rows[0]?.db_connect).toBe(true);
      expect(result.rows[0]?.db_create).toBe(false);
    });

    test("M3. SELECT global en TODAS las tablas; nada borra ni trunca", async () => {
      const privileges = await runAsApp((client) =>
        client.query<PrivilegeRow>(
          `SELECT t.tablename,
                  has_table_privilege($1, format('public.%I', t.tablename), 'SELECT') AS has_select,
                  has_table_privilege($1, format('public.%I', t.tablename), 'INSERT') AS has_insert,
                  has_table_privilege($1, format('public.%I', t.tablename), 'UPDATE') AS has_update,
                  has_table_privilege($1, format('public.%I', t.tablename), 'DELETE') AS has_delete,
                  has_table_privilege($1, format('public.%I', t.tablename), 'TRUNCATE') AS has_truncate
           FROM pg_tables t
           WHERE t.schemaname = 'public'
           ORDER BY t.tablename`,
          [APP_ROLE],
        ),
      );
      const rows = privileges.rows;
      // El esquema completo debe existir (001–006 aplicadas): 20 tablas.
      expect(rows.length).toBe(20);
      for (const row of rows) {
        expect(row.has_select, `${row.tablename} → SELECT`).toBe(true);
        expect(row.has_delete, `${row.tablename} → DELETE`).toBe(false);
        expect(row.has_truncate, `${row.tablename} → TRUNCATE`).toBe(false);
      }
    });

    test("M4. escrituras acotadas: create/update solo en S1 + operación; resto solo lectura", async () => {
      const result = await runAsApp((client) =>
        client.query<PrivilegeRow>(
          `SELECT t.tablename,
                  has_table_privilege($1, format('public.%I', t.tablename), 'INSERT') AS has_insert,
                  has_table_privilege($1, format('public.%I', t.tablename), 'UPDATE') AS has_update
           FROM pg_tables t
           WHERE t.schemaname = 'public'
           ORDER BY t.tablename`,
          [APP_ROLE],
        ),
      );
      const byTable = new Map(result.rows.map((r) => [r.tablename, r]));
      const writable = [...WRITE_TABLES, ...INSERT_ONLY_TABLES];
      for (const name of writable) {
        expect(byTable.get(name), `tabla ${name} presente`).toBeDefined();
      }
      for (const name of WRITE_TABLES) {
        expect(byTable.get(name)!.has_insert, `${name}.INSERT`).toBe(true);
        expect(byTable.get(name)!.has_update, `${name}.UPDATE`).toBe(true);
      }
      for (const name of INSERT_ONLY_TABLES) {
        expect(byTable.get(name)!.has_insert, `${name}.INSERT`).toBe(true);
        expect(byTable.get(name)!.has_update, `${name}.UPDATE`).toBe(false);
      }
      const readOnly = result.rows.filter((r) => !writable.includes(r.tablename));
      expect(readOnly.length).toBeGreaterThanOrEqual(10);
      for (const row of readOnly) {
        expect(row.has_insert, `${row.tablename}.INSERT`).toBe(false);
        expect(row.has_update, `${row.tablename}.UPDATE`).toBe(false);
      }
    });

    test("M5. operaciones de runtime permitidas como votaciones_app, sin persistir", async () => {
      const comparsaCode = `PRIV-${randomUUID().slice(0, 8)}`;
      const events = await runAsApp(async (client) => {
        const select = await client.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM specialty`,
        );
        const comparsaInsert = await client.query<{ id: string }>(
          `INSERT INTO comparsa (id, edition_id, code, name)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [randomUUID(), EDITION_ID, comparsaCode, "Probe privilegios"],
        );
        const nightUpdate = await client.query(
          `UPDATE night SET ends_at = ends_at WHERE id = $1`,
          [NIGHT1_ID],
        );
        // Habilitación S1: triple (JUDGE, NIGHT3, VESTUARIO) sin colisión con
        // los seeds BAILE de las tres noches ni con el par NIGHT2/VESTUARIO
        // creado por el test K.
        const assignmentInsert = await client.query<{ id: string }>(
          `INSERT INTO judge_assignment (id, judge_id, night_id, specialty_id, is_effective)
           VALUES ($1, $2, $3, $4, true) RETURNING id`,
          [randomUUID(), JUDGE_ID, NIGHT3_ID, SPECIALTY_VESTUARIO_ID],
        );
        // Auditoría append-only: el INSERT está permitido.
        const auditInsert = await client.query(
          `INSERT INTO audit_event (event_type, entity_type, entity_id, actor_user_id, payload)
           VALUES ($1, $2, $3, $4, $5::jsonb)`,
          ["PRIVILEGES_PROBE", "SPECIALTY", SPECIALTY_ID, ADMIN_ID, JSON.stringify({ probe: true })],
        );
        return {
          selectN: select.rows[0]?.n ?? 0,
          comparsaInserted: comparsaInsert.rowCount ?? 0,
          nightUpdated: nightUpdate.rowCount ?? 0,
          assignmentInserted: assignmentInsert.rows[0]?.id,
          auditInserted: auditInsert.rowCount ?? 0,
        };
      });
      expect(events.selectN).toBeGreaterThanOrEqual(1);
      expect(events.comparsaInserted).toBe(1);
      expect(events.nightUpdated).toBe(1);
      expect(events.assignmentInserted).toBeDefined();
      expect(events.auditInserted).toBe(1);

      // El ROLLBACK deshizo todo: ninguna fila del probe quedó persistida.
      const leftovers = await harness.db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM comparsa WHERE code = $1`,
        [comparsaCode],
      );
      expect(leftovers.rows[0]?.n ?? 0).toBe(0);
    });

    test("M6. operaciones NO autorizadas rechazadas (DELETE, UPDATE auditoría, DDL, roles)", async () => {
      await expectAppDenied(`DELETE FROM comparsa`);
      await expectAppDenied(`DELETE FROM audit_event`);
      await expectAppDenied(`UPDATE audit_event SET payload = NULL`);
      await expectAppDenied(`TRUNCATE TABLE comparsa`);
      await expectAppDenied(`CREATE TABLE public.probe_priv_x (id int)`);
      await expectAppDenied(`CREATE ROLE probe_role_x`);
    });
  });
});
