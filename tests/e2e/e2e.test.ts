/**
 * HITO "Integración E2E real" — VOTACIONES2027 (Carnavales Goya 2027).
 *
 * Demuestra, contra infraestructura REAL (PostgreSQL local + API real +
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
  CANDIDATE_ID,
  COMPARSA_ID,
  CONFIG_RULES_REF,
  EDITION_ID,
  ITEM_ID,
  JUDGE_DISPLAY_NAME,
  JUDGE_EMAIL,
  JUDGE_ID,
  NIGHT1_ID,
  NIGHT2_ID,
  RUBRO_ID,
  SPECIALTY_ID,
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
    psqlBin = await resolvePsqlBin();
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
});