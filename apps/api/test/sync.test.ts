import { afterEach, describe, expect, it } from "vitest";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type {
  CarnavalEdition,
  Candidate,
  Comparsa,
  ConfigurationVersion,
  Night,
  Rubro,
  RubroItem,
  Specialty,
  SyncPlanillaPayload,
  SyncVotePayload,
  Vote,
} from "@votaciones2027/shared-types";
import { SyncPlanillas } from "../src/application/use-cases/sync-planillas.js";
import { VoteValidator } from "../src/application/services/vote-validator.js";
import { loadConfig } from "../src/config.js";
import type { DbPool } from "../src/db/pool.js";
import type { Planilla } from "../src/domain/entities/planilla.js";
import type { Session } from "../src/domain/entities/session.js";
import type { UserAccount } from "../src/domain/entities/user.js";
import type {
  AuditRepository,
  CreateAuditEventInput,
} from "../src/domain/repositories/audit-repository.js";
import type { CatalogueRepository } from "../src/domain/repositories/catalogue-repository.js";
import type { ConfigurationRepository } from "../src/domain/repositories/configuration-repository.js";
import type { EditionRepository } from "../src/domain/repositories/edition-repository.js";
import type { EffectiveAssignment } from "../src/domain/repositories/judge-assignment-repository.js";
import type { JudgeAssignmentRepository } from "../src/domain/repositories/judge-assignment-repository.js";
import type { NightRepository } from "../src/domain/repositories/night-repository.js";
import type {
  CreatePlanillaInput,
  PlanillaRepository,
  PlanillaSummaryRow,
} from "../src/domain/repositories/planilla-repository.js";
import type {
  UnitOfWork,
  UnitOfWorkRepositories,
} from "../src/domain/repositories/unit-of-work.js";
import type { VoteRepository } from "../src/domain/repositories/vote-repository.js";
import { hashSessionToken } from "../src/infrastructure/crypto/tokens.js";
import { createApp } from "../src/server.js";

// ---------------------------------------------------------------------------
// Identificadores estables (UUIDs válidos)
// ---------------------------------------------------------------------------

const EDITION_ID = "11111111-1111-4111-8111-111111111111";
const NIGHT_A_ID = "21111111-1111-4111-8111-111111111111";
const NIGHT_B_ID = "31111111-1111-4111-8111-111111111111";
const SPECIALTY_ID_BAILE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JUDGE_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_JUDGE_ID = "42222222-2222-4222-8222-222222222222";
const WRITER_ID = "52222222-2222-4222-8222-222222222222";
const CONFIG_ID = "88888888-8888-4888-8888-888888888888";
const RUBRO_ID = "55555555-5555-4555-8555-555555555555";
const ITEM_ID = "66666666-6666-4666-8666-666666666666";
const CANDIDATE_ID = "77777777-7777-4777-8777-777777777777";
const COMPARSA_ID = "99999999-9999-4999-8999-999999999999";
const PLANILLA_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const PLANILLA2_ID = "12345678-1234-4123-8123-123456789abc";
const VOTE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const VOTE2_ID = "b3b3b3b3-b3b3-4b3b-8b3b-b3b3b3b3b3b3";

const EDITION_CODE = "2027";
const CLIENT_REF = "client-ref-p";
const VOTE_CLIENT_REF = "client-ref-v";

// ---------------------------------------------------------------------------
// Datos fixture
// ---------------------------------------------------------------------------

const edition: CarnavalEdition = {
  id: EDITION_ID,
  code: EDITION_CODE,
  name: "Carnavales Goya 2027",
  votingNights: 3,
};

const nightA: Night = { id: NIGHT_A_ID, editionId: EDITION_ID, number: 1, status: "ABIERTA" };
const nightB: Night = { id: NIGHT_B_ID, editionId: EDITION_ID, number: 2, status: "ABIERTA" };

const config: ConfigurationVersion = {
  id: CONFIG_ID,
  editionId: EDITION_ID,
  version: 1,
  status: "BORRADOR",
  rulesRef: "CARNAVAL_2027_RULES",
  contentRef: "ref-1",
};

const rubro: Rubro = { id: RUBRO_ID, editionId: EDITION_ID, specialty: "BAILE", name: "Baile", type: "NOMINATIVO" };
const item: RubroItem = { id: ITEM_ID, rubroId: RUBRO_ID, name: "Coreografía", orderIndex: 1 };
const candidate: Candidate = { id: CANDIDATE_ID, itemId: ITEM_ID, comparsaId: COMPARSA_ID, label: "Comparsa Uno" };
const comparsa: Comparsa = { id: COMPARSA_ID, editionId: EDITION_ID, code: "C01", name: "Comparsa Uno" };

const assignmentBaileNightA = {
  id: "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  judgeId: JUDGE_ID,
  nightId: NIGHT_A_ID,
  nightNumber: 1,
  specialtyId: SPECIALTY_ID_BAILE,
  specialty: "BAILE" as Specialty,
  confirmed: true,
};

// ---------------------------------------------------------------------------
// Payload builders
// ---------------------------------------------------------------------------

function planillaRef(
  id = PLANILLA_ID,
  nightId = NIGHT_A_ID,
  clientRef = CLIENT_REF,
): SyncPlanillaPayload["planilla"] {
  return { id, nightId, clientRef };
}

function syncVote(overrides?: Partial<SyncVotePayload>): SyncVotePayload {
  return {
    id: VOTE_ID,
    planillaId: PLANILLA_ID,
    comparsaId: COMPARSA_ID,
    rubroId: RUBRO_ID,
    itemId: ITEM_ID,
    candidateId: CANDIDATE_ID,
    score: 8.5,
    idempotencyKey: "key-1",
    clientRef: VOTE_CLIENT_REF,
    ...overrides,
  };
}

function syncPlanilla(
  planilla: SyncPlanillaPayload["planilla"],
  votes: SyncVotePayload[],
): SyncPlanillaPayload {
  return { planilla, votes };
}

// ---------------------------------------------------------------------------
// Fakes en-memoria (tests de use-case)
// ---------------------------------------------------------------------------

class FakeEditionRepository implements EditionRepository {
  constructor(private readonly editions: CarnavalEdition[]) {}
  async findById(id: string): Promise<CarnavalEdition | null> {
    return this.editions.find((e) => e.id === id) ?? null;
  }
  async findByCode(code: string): Promise<CarnavalEdition | null> {
    return this.editions.find((e) => e.code === code) ?? null;
  }
}

class FakeNightRepository implements NightRepository {
  constructor(private readonly nights: Night[]) {}
  async findById(id: string): Promise<Night | null> {
    return this.nights.find((n) => n.id === id) ?? null;
  }
  async findByEdition(editionId: string): Promise<Night[]> {
    return this.nights.filter((n) => n.editionId === editionId).sort((a, b) => a.number - b.number);
  }
}

class FakeConfigurationRepository implements ConfigurationRepository {
  constructor(private readonly configs: ConfigurationVersion[]) {}
  async findByEdition(editionId: string): Promise<ConfigurationVersion[]> {
    return this.configs
      .filter((c) => c.editionId === editionId)
      .sort((a, b) => b.version - a.version);
  }
  async findLatestByEdition(editionId: string): Promise<ConfigurationVersion | null> {
    return (await this.findByEdition(editionId))[0] ?? null;
  }
}

interface FakeAssignment {
  id: string;
  judgeId: string;
  nightId: string;
  nightNumber: number;
  specialtyId: string;
  specialty: Specialty;
  confirmed: boolean;
}

class FakeJudgeAssignmentRepository implements JudgeAssignmentRepository {
  constructor(private readonly assignments: FakeAssignment[]) {}
  async findEffectiveAssignments(judgeId: string) {
    return this.assignments
      .filter((a) => a.judgeId === judgeId && a.confirmed)
      .map((a) => ({
        assignmentId: a.id,
        nightId: a.nightId,
        nightNumber: a.nightNumber,
        specialtyId: a.specialtyId,
        specialty: a.specialty,
        confirmed: a.confirmed,
      }));
  }
  async findEffectiveByJudgeAndNight(judgeId: string, nightId: string): Promise<EffectiveAssignment | null> {
    const a = this.assignments.find((x) => x.judgeId === judgeId && x.nightId === nightId && x.confirmed);
    return a === undefined
      ? null
      : { id: a.id, nightId: a.nightId, specialtyId: a.specialtyId, specialty: a.specialty };
  }
}

interface FakeRubro extends Rubro {
  specialtyId: string;
}
interface FakeItem extends RubroItem {
  rubroId: string;
}
interface FakeCandidate extends Candidate {
  itemId: string;
  comparsaId: string;
}
interface FakeComparsa extends Comparsa {
  editionId: string;
}

class FakeCatalogueRepository implements CatalogueRepository {
  constructor(
    private readonly rubros: FakeRubro[],
    private readonly items: FakeItem[],
    private readonly candidates: FakeCandidate[],
    private readonly comparsas: FakeComparsa[],
  ) {}
  async findRubrosByEdition(editionId: string): Promise<Rubro[]> {
    return this.rubros.filter((r) => r.editionId === editionId).map((r) => ({
      id: r.id,
      editionId: r.editionId,
      specialty: r.specialty,
      name: r.name,
      type: r.type,
    }));
  }
  async findItemsByEdition(editionId: string): Promise<RubroItem[]> {
    const rubroIds = new Set(this.rubros.filter((r) => r.editionId === editionId).map((r) => r.id));
    return this.items
      .filter((i) => rubroIds.has(i.rubroId))
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((i) => ({ id: i.id, rubroId: i.rubroId, name: i.name, orderIndex: i.orderIndex }));
  }
  async findCandidatesByEdition(editionId: string): Promise<Candidate[]> {
    const itemIds = new Set((await this.findItemsByEdition(editionId)).map((i) => i.id));
    return this.candidates.filter((c) => itemIds.has(c.itemId)).map((c) => ({
      id: c.id,
      itemId: c.itemId,
      comparsaId: c.comparsaId,
      label: c.label,
    }));
  }
  async findComparsasByEdition(editionId: string): Promise<Comparsa[]> {
    return this.comparsas.filter((c) => c.editionId === editionId).map((c) => ({ ...c }));
  }
  async findRubroById(rubroId: string) {
    const r = this.rubros.find((x) => x.id === rubroId);
    return r === undefined
      ? null
      : { id: r.id, editionId: r.editionId, specialtyId: r.specialtyId, specialty: r.specialty, name: r.name, type: r.type };
  }
  async findItemById(itemId: string) {
    const i = this.items.find((x) => x.id === itemId);
    return i === undefined ? null : { id: i.id, rubroId: i.rubroId };
  }
  async findCandidateById(candidateId: string) {
    const c = this.candidates.find((x) => x.id === candidateId);
    return c === undefined ? null : { id: c.id, itemId: c.itemId, comparsaId: c.comparsaId };
  }
  async findComparsaById(comparsaId: string) {
    const c = this.comparsas.find((x) => x.id === comparsaId);
    return c === undefined ? null : { id: c.id, editionId: c.editionId };
  }
}

interface PlanillaEntity {
  planilla: Planilla;
  clientRef?: string;
}

class FakePlanillaRepository implements PlanillaRepository {
  readonly planillas: PlanillaEntity[] = [];
  readonly touches: string[] = [];
  private votes: FakeVoteRepository | null = null;

  linkVotes(votes: FakeVoteRepository): void {
    this.votes = votes;
  }

  private countVotes(planillaId: string): number {
    return this.votes === null
      ? 0
      : this.votes.votes.filter((v) => v.vote.planillaId === planillaId).length;
  }

  async findById(id: string) {
    const p = this.planillas.find((x) => x.planilla.id === id);
    return p === undefined ? null : { ...p.planilla };
  }
  async findByIdForUpdate(id: string) {
    const p = this.planillas.find((x) => x.planilla.id === id);
    return p === undefined ? null : { ...p.planilla };
  }
  async findByJudgeAndNight(judgeId: string, nightId: string) {
    const p = this.planillas.find((x) => x.planilla.judgeId === judgeId && x.planilla.nightId === nightId);
    return p === undefined ? null : { ...p.planilla };
  }
  async findByJudge(judgeId: string): Promise<PlanillaSummaryRow[]> {
    return this.planillas
      .filter((x) => x.planilla.judgeId === judgeId)
      .sort((a, b) => (a.planilla.updatedAt > b.planilla.updatedAt ? 1 : -1))
      .map((x) => ({
        id: x.planilla.id,
        nightId: x.planilla.nightId,
        nightNumber: x.planilla.nightId === NIGHT_A_ID ? 1 : 2,
        status: x.planilla.status,
        confirmedAt: x.planilla.confirmedAt,
        votesCount: this.countVotes(x.planilla.id),
        updatedAt: x.planilla.updatedAt,
      }));
  }
  async findByClientRef(judgeId: string, clientRef: string) {
    const p = this.planillas.find((x) => x.planilla.judgeId === judgeId && x.clientRef === clientRef);
    return p === undefined ? null : { ...p.planilla };
  }
  async findByJudgeNightClientRef(judgeId: string, nightId: string, clientRef: string) {
    const p = this.planillas.find(
      (x) => x.planilla.judgeId === judgeId && x.planilla.nightId === nightId && x.clientRef === clientRef,
    );
    return p === undefined ? null : { ...p.planilla };
  }
  async create(input: CreatePlanillaInput) {
    const entity: PlanillaEntity = {
      planilla: {
        id: input.id,
        judgeId: input.judgeId,
        nightId: input.nightId,
        status: input.status,
        confirmedAt: null,
        closedAt: null,
        updatedAt: new Date(),
      },
      ...(input.clientRef === undefined ? {} : { clientRef: input.clientRef }),
    };
    this.planillas.push(entity);
    return { ...entity.planilla };
  }
  async confirm(id: string, confirmedAt: Date): Promise<void> {
    const p = this.planillas.find((x) => x.planilla.id === id);
    if (p !== undefined) {
      p.planilla.status = "CONFIRMADA";
      p.planilla.confirmedAt = confirmedAt;
      p.planilla.updatedAt = new Date();
    }
  }
  async touch(id: string): Promise<void> {
    this.touches.push(id);
    const p = this.planillas.find((x) => x.planilla.id === id);
    if (p !== undefined) p.planilla.updatedAt = new Date();
  }
}

interface StoredVote {
  vote: Vote;
  clientRef?: string;
}

class FakeVoteRepository implements VoteRepository {
  readonly votes: StoredVote[] = [];

  async findByPlanilla(planillaId: string): Promise<Vote[]> {
    return this.votes
      .filter((v) => v.vote.planillaId === planillaId)
      .map((v) => ({ ...v.vote }));
  }
  async findById(id: string): Promise<Vote | null> {
    const v = this.votes.find((x) => x.vote.id === id);
    return v === undefined ? null : { ...v.vote };
  }
  async findByBusinessKey(
    judgeId: string,
    nightId: string,
    comparsaId: string,
    rubroId: string,
    itemId: string,
    candidateId: string,
  ): Promise<Vote | null> {
    const v = this.votes.find(
      (x) =>
        x.vote.judgeId === judgeId &&
        x.vote.nightId === nightId &&
        x.vote.comparsaId === comparsaId &&
        x.vote.rubroId === rubroId &&
        x.vote.itemId === itemId &&
        x.vote.candidateId === candidateId,
    );
    return v === undefined ? null : { ...v.vote };
  }
  async findByIdempotencyKey(judgeId: string, idempotencyKey: string): Promise<Vote | null> {
    const v = this.votes.find((x) => x.vote.judgeId === judgeId && x.vote.idempotencyKey === idempotencyKey);
    return v === undefined ? null : { ...v.vote };
  }
  async findByClientRef(judgeId: string, clientRef: string): Promise<Vote | null> {
    const v = this.votes.find((x) => x.vote.judgeId === judgeId && x.clientRef === clientRef);
    return v === undefined ? null : { ...v.vote };
  }
  async create(input: Parameters<VoteRepository["create"]>[0]): Promise<Vote> {
    const vote: Vote = {
      id: input.id,
      planillaId: input.planillaId,
      judgeId: input.judgeId,
      nightId: input.nightId,
      comparsaId: input.comparsaId,
      rubroId: input.rubroId,
      itemId: input.itemId,
      candidateId: input.candidateId,
      score: input.score,
      scoreSource: input.scoreSource,
      idempotencyKey: input.idempotencyKey,
      versionId: input.versionId,
      syncState: "PENDING",
      ...(input.deviceContext === undefined ? {} : { deviceContext: input.deviceContext }),
      ...(input.confirmedAt === undefined ? {} : { confirmedAt: input.confirmedAt.toISOString() }),
    };
    this.votes.push({ vote, ...(input.clientRef === undefined ? {} : { clientRef: input.clientRef }) });
    return { ...vote };
  }
  async update(id: string, input: Parameters<VoteRepository["update"]>[1]): Promise<Vote> {
    const stored = this.votes.find((x) => x.vote.id === id);
    if (stored === undefined) throw new Error("vote not found");
    stored.vote.score = input.score;
    stored.vote.idempotencyKey = input.idempotencyKey;
    if (input.deviceContext !== undefined) stored.vote.deviceContext = input.deviceContext;
    if (input.clientRef !== undefined) stored.clientRef = input.clientRef;
    return { ...stored.vote };
  }
  async confirm(id: string, confirmedAt: Date): Promise<void> {
    const v = this.votes.find((x) => x.vote.id === id);
    if (v !== undefined) v.vote.confirmedAt = confirmedAt.toISOString();
  }
  async delete(id: string): Promise<void> {
    const idx = this.votes.findIndex((x) => x.vote.id === id);
    if (idx >= 0) this.votes.splice(idx, 1);
  }
}

class FakeAuditRepository implements AuditRepository {
  readonly events: CreateAuditEventInput[] = [];
  async create(input: CreateAuditEventInput) {
    this.events.push(input);
    return {
      id: `audit-${this.events.length}`,
      eventType: input.eventType as "PLANILLA_CREATED",
      entityType: input.entityType as "PLANILLA",
      entityId: input.entityId ?? null,
      ...(input.actorUserId === undefined ? {} : { actorUserId: input.actorUserId }),
      occurredAt: new Date().toISOString(),
      payload: input.payload,
    };
  }
}

class FakeUnitOfWork implements UnitOfWork {
  constructor(
    private readonly planillas: FakePlanillaRepository,
    private readonly votes: FakeVoteRepository,
    private readonly audits: FakeAuditRepository,
  ) {}

  async withTransaction<T>(fn: (tx: UnitOfWorkRepositories) => Promise<T>): Promise<T> {
    return fn({ planillas: this.planillas, votes: this.votes, audits: this.audits });
  }
}

interface BuiltRepos {
  editions: FakeEditionRepository;
  nights: FakeNightRepository;
  configurations: FakeConfigurationRepository;
  assignments: FakeJudgeAssignmentRepository;
  catalogue: FakeCatalogueRepository;
  planillas: FakePlanillaRepository;
  votes: FakeVoteRepository;
  audits: FakeAuditRepository;
  uow: UnitOfWork;
}

function buildRepos(): BuiltRepos {
  const repos: BuiltRepos = {
    editions: new FakeEditionRepository([edition]),
    nights: new FakeNightRepository([nightA, nightB]),
    configurations: new FakeConfigurationRepository([config]),
    assignments: new FakeJudgeAssignmentRepository([assignmentBaileNightA]),
    catalogue: new FakeCatalogueRepository(
      [{ ...rubro, specialtyId: SPECIALTY_ID_BAILE }],
      [item],
      [candidate],
      [comparsa],
    ),
    planillas: new FakePlanillaRepository(),
    votes: new FakeVoteRepository(),
    audits: new FakeAuditRepository(),
  };
  repos.planillas.linkVotes(repos.votes);
  repos.uow = new FakeUnitOfWork(repos.planillas, repos.votes, repos.audits);
  return repos;
}

function buildSync(repos: BuiltRepos): SyncPlanillas {
  return new SyncPlanillas(
    repos.editions,
    repos.configurations,
    repos.assignments,
    repos.catalogue,
    repos.uow,
    new VoteValidator(repos.nights, repos.assignments, repos.catalogue),
  );
}

function seedPlanilla(
  repos: BuiltRepos,
  overrides: Partial<Planilla> & { clientRef?: string },
): void {
  repos.planillas.planillas.push({
    planilla: {
      id: PLANILLA_ID,
      judgeId: JUDGE_ID,
      nightId: NIGHT_A_ID,
      status: "BORRADOR",
      confirmedAt: null,
      closedAt: null,
      updatedAt: new Date("2026-01-01T00:00:00Z"),
      ...overrides,
    },
    ...(overrides.clientRef === undefined ? {} : { clientRef: overrides.clientRef }),
  });
}

function seedVote(repos: BuiltRepos, overrides: Partial<Vote> & { clientRef?: string }): void {
  repos.votes.votes.push({
    vote: {
      id: VOTE_ID,
      planillaId: PLANILLA_ID,
      judgeId: JUDGE_ID,
      nightId: NIGHT_A_ID,
      comparsaId: COMPARSA_ID,
      rubroId: RUBRO_ID,
      itemId: ITEM_ID,
      candidateId: CANDIDATE_ID,
      score: 8.5,
      scoreSource: "JUDGE",
      idempotencyKey: "key-1",
      versionId: CONFIG_ID,
      syncState: "PENDING",
      ...overrides,
    },
    ...(overrides.clientRef === undefined ? {} : { clientRef: overrides.clientRef }),
  });
}

// ---------------------------------------------------------------------------
// SyncPlanillas (use-case)
// ---------------------------------------------------------------------------

describe("SyncPlanillas use-case", () => {
  it("crea la planilla con su voto y audita PLANILLA_CREATED solo una vez", async () => {
    const repos = buildRepos();
    const sync = buildSync(repos);

    const first = await sync.execute({
      judgeId: JUDGE_ID,
      payload: { planillas: [syncPlanilla(planillaRef(), [syncVote()])] },
    });

    expect(first.planillas).toHaveLength(1);
    expect(first.planillas[0]!.planillaAction).toBe("INSERTED");
    expect(first.planillas[0]!.planillaId).toBe(PLANILLA_ID);
    expect(first.planillas[0]!.votes[0]!.action).toBe("INSERTED");

    const stored = repos.planillas.findById(PLANILLA_ID);
    expect((await stored)?.status).toBe("BORRADOR");
    expect(repos.audits.events.map((e) => e.eventType)).toEqual(["PLANILLA_CREATED"]);
    expect(repos.audits.events[0]!.payload).toMatchObject({ nightId: NIGHT_A_ID, source: "SYNC" });
    expect(repos.planillas.touches).toHaveLength(0);

    // Reintento idéntico: sin mutaciones, sin duplicar auditoría.
    const replay = await sync.execute({
      judgeId: JUDGE_ID,
      payload: { planillas: [syncPlanilla(planillaRef(), [syncVote()])] },
    });
    expect(replay.planillas[0]!.planillaAction).toBe("ALREADY_EXISTS");
    expect(replay.planillas[0]!.votes[0]!.action).toBe("EXISTS");
    expect(repos.audits.events.map((e) => e.eventType)).toEqual(["PLANILLA_CREATED"]);
  });

  it("resuelve una planilla ya conocida por clientRef+night sin crear duplicado", async () => {
    const repos = buildRepos();
    const sync = buildSync(repos);

    await sync.execute({
      judgeId: JUDGE_ID,
      payload: { planillas: [syncPlanilla(planillaRef(), [syncVote()])] },
    });

    // El dispositivo reenvía con un id local distinto pero el mismo clientRef.
    const second = await sync.execute({
      judgeId: JUDGE_ID,
      payload: { planillas: [syncPlanilla(planillaRef(PLANILLA2_ID), [])] },
    });

    expect(second.planillas[0]!.planillaAction).toBe("ALREADY_EXISTS");
    expect(second.planillas[0]!.planillaId).toBe(PLANILLA_ID);
    expect(repos.planillas.planillas.map((p) => p.planilla.id)).toEqual([PLANILLA_ID]);
  });

  it("actualiza un voto no confirmado por id (score) y toca la planilla", async () => {
    const repos = buildRepos();
    const sync = buildSync(repos);
    seedPlanilla(repos, {});
    seedVote(repos, { score: 8 });

    const result = await sync.execute({
      judgeId: JUDGE_ID,
      payload: {
        planillas: [syncPlanilla(planillaRef(), [syncVote({ score: 7 })])],
      },
    });

    expect(result.planillas[0]!.planillaAction).toBe("ALREADY_EXISTS");
    expect(result.planillas[0]!.votes[0]!.action).toBe("INSERTED");
    expect((await repos.votes.findById(VOTE_ID))?.score).toBe(7);
    expect(repos.planillas.touches).toEqual([PLANILLA_ID]);
    expect(repos.audits.events).toHaveLength(0);
  });

  it("rechaza modificar un voto confirmado (inmutabilidad)", async () => {
    const repos = buildRepos();
    const sync = buildSync(repos);
    seedPlanilla(repos, {});
    seedVote(repos, { confirmedAt: "2026-02-01T00:00:00Z" });

    const result = await sync.execute({
      judgeId: JUDGE_ID,
      payload: {
        planillas: [syncPlanilla(planillaRef(), [syncVote({ score: 3 })])],
      },
    });

    expect(result.planillas[0]!.votes[0]!.action).toBe("REJECTED");
    expect(result.planillas[0]!.votes[0]!.reason).toBe("VOTE_CONFIRMED_IMMUTABLE");
    expect((await repos.votes.findById(VOTE_ID))?.score).toBe(8.5);
    expect(repos.planillas.touches).toHaveLength(0);
  });

  it("rechaza votos nuevos sobre una planilla confirmada", async () => {
    const repos = buildRepos();
    const sync = buildSync(repos);
    seedPlanilla(repos, { status: "CONFIRMADA" });

    const result = await sync.execute({
      judgeId: JUDGE_ID,
      payload: {
        planillas: [syncPlanilla(planillaRef(), [syncVote({ id: VOTE2_ID })])],
      },
    });

    expect(result.planillas[0]!.votes[0]!.action).toBe("REJECTED");
    expect(result.planillas[0]!.votes[0]!.reason).toBe("PLANILLA_NOT_EDITABLE");
    expect(repos.votes.votes).toHaveLength(0);
  });

  it("detecta que la planilla pertenece a otro juez (ownership)", async () => {
    const repos = buildRepos();
    const sync = buildSync(repos);
    seedPlanilla(repos, { judgeId: OTHER_JUDGE_ID });

    const result = await sync.execute({
      judgeId: JUDGE_ID,
      payload: { planillas: [syncPlanilla(planillaRef(), [])] },
    });

    expect(result.planillas[0]!.planillaAction).toBe("CONFLICT");
    expect(result.planillas[0]!.reason).toBe("PLANILLA_NOT_OWNED");
    expect(result.planillas[0]!.votes).toHaveLength(0);
  });

  it("requiere asignación efectiva para crear una planilla de una noche sin asignación", async () => {
    const repos = buildRepos();
    const sync = buildSync(repos);

    const result = await sync.execute({
      judgeId: JUDGE_ID,
      payload: { planillas: [syncPlanilla(planillaRef(PLANILLA_ID, NIGHT_B_ID), [])] },
    });

    expect(result.planillas[0]!.planillaAction).toBe("CONFLICT");
    expect(result.planillas[0]!.reason).toBe("JUDGE_NOT_ASSIGNED");
    expect(repos.planillas.planillas).toHaveLength(0);
  });

  it("rechaza reutilizar una idempotencyKey con target distinto", async () => {
    const repos = buildRepos();
    const sync = buildSync(repos);
    seedPlanilla(repos, {});
    seedVote(repos, { idempotencyKey: "key-1", score: 9 });

    const result = await sync.execute({
      judgeId: JUDGE_ID,
      payload: {
        planillas: [
          syncPlanilla(planillaRef(), [
            syncVote({ id: VOTE2_ID, score: 4, clientRef: "client-ref-otra" }),
          ]),
        ],
      },
    });

    expect(result.planillas[0]!.votes[0]!.action).toBe("REJECTED");
    expect(result.planillas[0]!.votes[0]!.reason).toBe("IDEMPOTENCY_CONFLICT");
    expect(repos.votes.votes).toHaveLength(1);
  });

  it("reconoce un voto existente por clave de negocio con target idéntico como EXISTS", async () => {
    const repos = buildRepos();
    const sync = buildSync(repos);
    seedPlanilla(repos, {});
    seedVote(repos, { id: VOTE_ID, idempotencyKey: "key-original", score: 8.5 });

    // Mismo target pero id e idempotencyKey distintos desde el reenvío.
    const result = await sync.execute({
      judgeId: JUDGE_ID,
      payload: {
        planillas: [
          syncPlanilla(planillaRef(), [
            syncVote({ id: VOTE2_ID, idempotencyKey: "key-distinta", score: 8.5, clientRef: "cr-distinta" }),
          ]),
        ],
      },
    });

    expect(result.planillas[0]!.votes[0]!.action).toBe("EXISTS");
    expect(result.planillas[0]!.votes[0]!.id).toBe(VOTE_ID);
  });

  it("rechaza un voto que referencia otra planilla", async () => {
    const repos = buildRepos();
    const sync = buildSync(repos);
    seedPlanilla(repos, {});

    const result = await sync.execute({
      judgeId: JUDGE_ID,
      payload: {
        planillas: [syncPlanilla(planillaRef(), [syncVote({ planillaId: PLANILLA2_ID })])],
      },
    });

    expect(result.planillas[0]!.votes[0]!.action).toBe("REJECTED");
    expect(result.planillas[0]!.votes[0]!.reason).toBe("VOTE_PLANILLA_MISMATCH");
  });

  it("rechaza confirmedAt y estados terminales llegados del cliente (confirmación server-side)", async () => {
    const repos = buildRepos();
    const sync = buildSync(repos);

    const terminalPlanilla = await sync.execute({
      judgeId: JUDGE_ID,
      payload: {
        planillas: [syncPlanilla({ ...planillaRef(), status: "CONFIRMADA" }, [])],
      },
    });
    expect(terminalPlanilla.planillas[0]!.planillaAction).toBe("CONFLICT");
    expect(terminalPlanilla.planillas[0]!.reason).toBe("CONFIRMATION_NOT_SYNCABLE");

    const confirmedPlanilla = await sync.execute({
      judgeId: JUDGE_ID,
      payload: {
        planillas: [syncPlanilla({ ...planillaRef(), confirmedAt: "2026-02-01T00:00:00Z" }, [])],
      },
    });
    expect(confirmedPlanilla.planillas[0]!.planillaAction).toBe("CONFLICT");
    expect(confirmedPlanilla.planillas[0]!.reason).toBe("CONFIRMATION_NOT_SYNCABLE");

    const confirmedVote = await sync.execute({
      judgeId: JUDGE_ID,
      payload: {
        planillas: [
          syncPlanilla(planillaRef(), [syncVote({ confirmedAt: "2026-02-01T00:00:00Z" })]),
        ],
      },
    });
    expect(confirmedVote.planillas[0]!.votes[0]!.action).toBe("REJECTED");
    expect(confirmedVote.planillas[0]!.votes[0]!.reason).toBe("CONFIRMED_NOT_SYNCABLE");
  });

  it("reporta CONFLICT para payloads inválidos", async () => {
    const repos = buildRepos();
    const sync = buildSync(repos);

    const badId = await sync.execute({
      judgeId: JUDGE_ID,
      payload: { planillas: [syncPlanilla(planillaRef("no-es-uuid"), [])] },
    });
    expect(badId.planillas[0]!.planillaAction).toBe("CONFLICT");
    expect(badId.planillas[0]!.reason).toBe("INVALID_PAYLOAD");

    const badScore = await sync.execute({
      judgeId: JUDGE_ID,
      payload: {
        planillas: [syncPlanilla(planillaRef(), [syncVote({ score: 999 })])],
      },
    });
    expect(badScore.planillas[0]!.votes[0]!.action).toBe("REJECTED");
    expect(badScore.planillas[0]!.votes[0]!.reason).toBe("INVALID_PAYLOAD");
  });

  it("procesa un batch de planillas de forma independiente", async () => {
    const repos = buildRepos();
    const sync = buildSync(repos);

    const result = await sync.execute({
      judgeId: JUDGE_ID,
      payload: {
        planillas: [
          syncPlanilla(planillaRef(PLANILLA_ID, NIGHT_A_ID), [syncVote()]),
          syncPlanilla(planillaRef(PLANILLA2_ID, NIGHT_B_ID, "client-ref-otra"), []),
        ],
      },
    });

    expect(result.planillas).toHaveLength(2);
    expect(result.planillas[0]!.planillaAction).toBe("INSERTED");
    expect(result.planillas[1]!.planillaAction).toBe("CONFLICT");
    expect(result.planillas[1]!.reason).toBe("JUDGE_NOT_ASSIGNED");
    expect(repos.planillas.planillas).toHaveLength(1);
  });

  it("acepta un lote sin planillas", async () => {
    const repos = buildRepos();
    const sync = buildSync(repos);

    const result = await sync.execute({
      judgeId: JUDGE_ID,
      payload: { planillas: [] },
    });

    expect(result.planillas).toEqual([]);
    expect(typeof result.syncedAt).toBe("string");
  });

  it("rechaza la actualización de un voto no confirmado cuando la clave de negocio apunta a otra planilla", async () => {
    const repos = buildRepos();
    const sync = buildSync(repos);
    seedPlanilla(repos, {});

    // Voto existente del juez con el mismo target de negocio pero Otra planilla.
    seedVote(repos, { id: VOTE_ID, planillaId: OTHER_JUDGE_ID, nightId: NIGHT_A_ID });

    const result = await sync.execute({
      judgeId: JUDGE_ID,
      payload: {
        planillas: [
          syncPlanilla(planillaRef(), [
            syncVote({ id: VOTE2_ID, score: 8.5, idempotencyKey: "clave-distinta", clientRef: "cr-d" }),
          ]),
        ],
      },
    });

    // El voto NO existe por id + el ítem de planilla: pasa a clave de negocio.
    // La clave de negocio existe en otra planilla → mismatch.
    expect(result.planillas[0]!.votes[0]!.action).toBe("REJECTED");
    expect(result.planillas[0]!.votes[0]!.reason).toBe("VOTE_PLANILLA_MISMATCH");
  });
});

// ---------------------------------------------------------------------------
// HTTP: POST /judge/planillas/sync
// ---------------------------------------------------------------------------

const JUDGE_HTTP_ID = "01010101-0101-4101-8101-010101010101";
const JUDGE_TOKEN = "sync-http-judge-token";
const WRITER_TOKEN = "sync-http-writer-token";

const runningApps: Array<{ server: Server; close: () => Promise<void> }> = [];

function editionRow() {
  return {
    id: EDITION_ID,
    code: EDITION_CODE,
    name: "Carnavales Goya 2027",
    voting_nights: 3,
    starts_on: null,
    ends_on: null,
  };
}

function configRow() {
  return {
    id: CONFIG_ID,
    edition_id: EDITION_ID,
    version: 1,
    status: "BORRADOR",
    frozen_at: null,
    frozen_by: null,
    rules_ref: "CARNAVAL_2027_RULES",
    content_ref: "ref-1",
  };
}

function toUserRow(user: UserAccount): Record<string, unknown> {
  return {
    id: user.id,
    email: user.email,
    display_name: user.displayName ?? null,
    role: user.role,
    dni: user.dni ?? null,
    password_hash: user.passwordHash ?? null,
  };
}

function toSessionRow(session: Session): Record<string, unknown> {
  return {
    id: session.id,
    user_id: session.userId,
    token_hash: session.tokenHash,
    created_at: session.createdAt,
    expires_at: session.expiresAt,
    revoked_at: session.revokedAt,
  };
}

function scriptedDb(users: UserAccount[], sessions: Map<string, Session>): DbPool {
  const query = async <T>(text: string, params?: unknown[]) => {
    if (text.includes("FROM session")) {
      const tokenHash = String((params ?? [])[0]);
      const session = sessions.get(tokenHash);
      return { rows: session === undefined ? [] : [toSessionRow(session)] as T[] };
    }
    if (text.includes("FROM user_account") && text.includes("WHERE id")) {
      const id = String((params ?? [])[0]);
      const user = users.find((u) => u.id === id);
      return { rows: user === undefined ? [] : [toUserRow(user)] as T[] };
    }
    if (text.includes("FROM carnaval_edition") && text.includes("WHERE code")) {
      return { rows: [editionRow()] as T[] };
    }
    if (text.includes("FROM configuration_version")) {
      return { rows: [configRow()] as T[] };
    }
    throw new Error(`Unexpected query in sync test: ${text}`);
  };
  return {
    query,
    withTransaction: (fn) => fn({ query }),
    async end() {},
  };
}

function makeUsers(): UserAccount[] {
  return [
    { id: JUDGE_HTTP_ID, email: "juez.baile.1@goya2027.test", displayName: "Juez de prueba", role: "JUDGE" },
    { id: WRITER_ID, email: "escribano.1@goya2027.test", displayName: "Escribano de prueba", role: "ESCRIBANO_VEEDOR" },
  ];
}

function makeSessions(): Map<string, Session> {
  const sessions = new Map<string, Session>();
  sessions.set(hashSessionToken(JUDGE_TOKEN), {
    id: "sess-judge",
    userId: JUDGE_HTTP_ID,
    tokenHash: hashSessionToken(JUDGE_TOKEN),
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 3_600_000),
    revokedAt: null,
  });
  sessions.set(hashSessionToken(WRITER_TOKEN), {
    id: "sess-writer",
    userId: WRITER_ID,
    tokenHash: hashSessionToken(WRITER_TOKEN),
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 3_600_000),
    revokedAt: null,
  });
  return sessions;
}

async function startApp(): Promise<Server> {
  const users = makeUsers();
  const sessions = makeSessions();
  const app = createApp(
    loadConfig({ databaseUrl: "postgresql://mock@localhost/mock" }),
    scriptedDb(users, sessions),
  );
  await new Promise<void>((resolve) => app.server.listen(0, resolve));
  runningApps.push(app);
  return app.server;
}

function jsonRequest(
  server: Server,
  path: string,
  headers: Record<string, string> = {},
  body?: unknown,
  method = "POST",
): Promise<{ status: number; body: unknown }> {
  const port = (server.address() as AddressInfo).port;
  return new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, path, method, headers },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk.toString()));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body: data === "" ? undefined : (JSON.parse(data) as unknown),
          }),
        );
      },
    );
    req.on("error", reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

describe("POST /judge/planillas/sync (HTTP)", () => {
  afterEach(async () => {
    while (runningApps.length > 0) {
      const app = runningApps.pop();
      await app?.close();
    }
  });

  it("rechaza peticiones sin sesión", async () => {
    const server = await startApp();
    const { status } = await jsonRequest(server, "/judge/planillas/sync", {
      "content-type": "application/json",
    }, { planillas: [] });
    expect(status).toBe(401);
  });

  it("rechaza roles que no son juez", async () => {
    const server = await startApp();
    const { status } = await jsonRequest(server, "/judge/planillas/sync", {
      "content-type": "application/json",
      authorization: `Bearer ${WRITER_TOKEN}`,
    }, { planillas: [] });
    expect(status).toBe(403);
  });

  it("valida el cuerpo: exige el array 'planillas'", async () => {
    const server = await startApp();
    const { status, body } = await jsonRequest(server, "/judge/planillas/sync", {
      "content-type": "application/json",
      authorization: `Bearer ${JUDGE_TOKEN}`,
    }, { foo: 1 });
    expect(status).toBe(400);
    expect(body).toHaveProperty("error");
  });

  it("acepta un lote sin planillas y responde con syncedAt", async () => {
    const server = await startApp();
    const { status, body } = await jsonRequest(server, "/judge/planillas/sync", {
      "content-type": "application/json",
      authorization: `Bearer ${JUDGE_TOKEN}`,
    }, { planillas: [] });
    expect(status).toBe(200);
    expect(body).toMatchObject({ planillas: [] });
    expect(typeof (body as SyncPlanillasResult).syncedAt).toBe("string");
  });
});