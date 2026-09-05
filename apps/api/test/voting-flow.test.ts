import { describe, expect, it } from "vitest";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type {
  AuthenticatedUser,
  CarnavalEdition,
  Candidate,
  Comparsa,
  ConfigurationVersion,
  Night,
  Planilla,
  Rubro,
  RubroItem,
  Specialty,
  Vote,
  VoteUpsertPayload,
} from "@votaciones2027/shared-types";
import { JudgeContext } from "../src/application/use-cases/judge-context.js";
import { CreatePlanilla } from "../src/application/use-cases/create-planilla.js";
import { ConfirmPlanilla } from "../src/application/use-cases/confirm-planilla.js";
import { GetPlanilla } from "../src/application/use-cases/get-planilla.js";
import { ListMyPlanillas } from "../src/application/use-cases/list-my-planillas.js";
import { UpsertVote } from "../src/application/use-cases/upsert-vote.js";
import { VoteValidator } from "../src/application/services/vote-validator.js";
import { loadConfig } from "../src/config.js";
import type { DbPool, QueryRunner } from "../src/db/pool.js";
import { createApplication } from "../src/application/index.js";
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
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../src/errors/app-error.js";
import {
  generateSessionToken,
  hashSessionToken,
} from "../src/infrastructure/crypto/tokens.js";
import { createApp } from "../src/server.js";

// ---------------------------------------------------------------------------
// Identificadores estables (UUIDs válidos)
// ---------------------------------------------------------------------------

const EDITION_ID = "11111111-1111-4111-8111-111111111111";
const NIGHT_A_ID = "21111111-1111-4111-8111-111111111111";
const NIGHT_B_ID = "31111111-1111-4111-8111-111111111111";
const SPECIALTY_ID_BAILE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SPECIALTY_ID_VESTUARIO = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const JUDGE_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_JUDGE_ID = "42222222-2222-4222-8222-222222222222";
const ADMIN_USER_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const CONFIG_ID = "88888888-8888-4888-8888-888888888888";
const RUBRO_ID = "55555555-5555-4555-8555-555555555555";
const VESTUARIO_RUBRO_ID = "65555555-5555-4555-8555-555555555555";
const ITEM_ID = "66666666-6666-4666-8666-666666666666";
const VESTUARIO_ITEM_ID = "76666666-6666-4666-8666-666666666666";
const CANDIDATE_ID = "77777777-7777-4777-8777-777777777777";
const VESTUARIO_CANDIDATE_ID = "87777777-7777-4777-8777-777777777777";
const COMPARSA_ID = "99999999-9999-4999-8999-999999999999";
const OTHER_COMPARSA_ID = "a9999999-9999-4999-8999-999999999999";
const PLANILLA_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const OTHER_PLANILLA_ID = "12345678-1234-4123-8123-123456789abc";
const VOTE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const VOTE2_ID = "b3b3b3b3-b3b3-4b3b-8b3b-b3b3b3b3b3b3";
const ASSIGNMENT_ID = "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION_ID = "session-flow-1";

const EDITION_CODE = "2027";

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

// Noches con ventana temporal definida para los tests de FASE B.
// `endsAt` en el pasado y `startsAt` en el futuro → ventana cerrada respecto
// del reloj real del servidor (el test no depende del tiempo: siempre cerrada).
const nightAClosed: Night = {
  id: NIGHT_A_ID,
  editionId: EDITION_ID,
  number: 1,
  status: "ABIERTA",
  startsAt: "2000-01-01T00:00:00Z",
  endsAt: "2001-01-01T00:00:00Z",
};
const nightANotStarted: Night = {
  id: NIGHT_A_ID,
  editionId: EDITION_ID,
  number: 1,
  status: "ABIERTA",
  startsAt: "2999-01-01T00:00:00Z",
  endsAt: "2999-02-01T00:00:00Z",
};
const nightAOpen: Night = {
  id: NIGHT_A_ID,
  editionId: EDITION_ID,
  number: 1,
  status: "ABIERTA",
  startsAt: "2000-01-01T00:00:00Z",
  endsAt: "2999-01-01T00:00:00Z",
};

const config: ConfigurationVersion = {
  id: CONFIG_ID,
  editionId: EDITION_ID,
  version: 1,
  status: "BORRADOR",
  rulesRef: "CARNAVAL_2027_RULES",
  contentRef: "ref-1",
};

const rubro: Rubro = { id: RUBRO_ID, editionId: EDITION_ID, specialty: "BAILE", name: "Baile", type: "NOMINATIVO" };
const vestuarioRubro: Rubro = { id: VESTUARIO_RUBRO_ID, editionId: EDITION_ID, specialty: "VESTUARIO", name: "Vestuario", type: "ALEATORIO" };

const item: RubroItem = { id: ITEM_ID, rubroId: RUBRO_ID, name: "Coreografía", orderIndex: 1 };
const vestuarioItem: RubroItem = { id: VESTUARIO_ITEM_ID, rubroId: VESTUARIO_RUBRO_ID, name: "Traje", orderIndex: 1 };

const candidate: Candidate = { id: CANDIDATE_ID, itemId: ITEM_ID, comparsaId: COMPARSA_ID, label: "Comparsa Uno" };
const vestuarioCandidate: Candidate = { id: VESTUARIO_CANDIDATE_ID, itemId: VESTUARIO_ITEM_ID, comparsaId: OTHER_COMPARSA_ID, label: "Comparsa Dos" };

const comparsa: Comparsa = { id: COMPARSA_ID, editionId: EDITION_ID, code: "C01", name: "Comparsa Uno" };
const otherComparsa: Comparsa = { id: OTHER_COMPARSA_ID, editionId: EDITION_ID, code: "C02", name: "Comparsa Dos" };

const assignmentBaileNightA = {
  id: ASSIGNMENT_ID,
  judgeId: JUDGE_ID,
  nightId: NIGHT_A_ID,
  nightNumber: 1,
  specialtyId: SPECIALTY_ID_BAILE,
  specialty: "BAILE" as Specialty,
  confirmed: true,
};

function validVotePayload(overrides?: Partial<VoteUpsertPayload>): VoteUpsertPayload {
  return {
    comparsaId: COMPARSA_ID,
    rubroId: RUBRO_ID,
    itemId: ITEM_ID,
    candidateId: CANDIDATE_ID,
    score: 8.5,
    idempotencyKey: "key-1",
    clientRef: "client-ref-1",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Fakes in-memory (tests de use-cases)
// ---------------------------------------------------------------------------

interface FakeAssignment {
  id: string;
  judgeId: string;
  nightId: string;
  nightNumber: number;
  specialtyId: string;
  specialty: Specialty;
  confirmed: boolean;
}

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

class FakeJudgeAssignmentRepository implements JudgeAssignmentRepository {
  constructor(private readonly assignments: FakeAssignment[]) {}
  async findEffectiveAssignments(judgeId: string) {
    return this.assignments.filter((a) => a.judgeId === judgeId && a.confirmed).map((a) => ({
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
  planilla: {
    id: string;
    judgeId: string;
    nightId: string;
    status: Planilla["status"];
    confirmedAt: Date | null;
    closedAt: Date | null;
    updatedAt: Date;
  };
  clientRef?: string;
}

interface VoteEntity {
  vote: Vote;
  clientRef?: string;
}

class FakePlanillaRepository implements PlanillaRepository {
  readonly planillas: PlanillaEntity[] = [];
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
    private readonly nights: FakeNightRepository,
  ) {}

  async withTransaction<T>(fn: (tx: UnitOfWorkRepositories) => Promise<T>): Promise<T> {
    // En memoria no hay commit/rollback reales: los repos comparten el mismo
    // estado subyacente, por lo que la transacción es transparente.
    return fn({
      planillas: this.planillas,
      votes: this.votes,
      audits: this.audits,
      nights: this.nights,
    });
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

function buildFakes(nights: Night[] = [nightA, nightB]): BuiltRepos {
  const repos: BuiltRepos = {
    editions: new FakeEditionRepository([edition]),
    nights: new FakeNightRepository(nights),
    configurations: new FakeConfigurationRepository([config]),
    assignments: new FakeJudgeAssignmentRepository([assignmentBaileNightA]),
    catalogue: new FakeCatalogueRepository(
      [
        { ...rubro, specialtyId: SPECIALTY_ID_BAILE },
        { ...vestuarioRubro, specialtyId: SPECIALTY_ID_VESTUARIO },
      ],
      [item, vestuarioItem],
      [candidate, vestuarioCandidate],
      [comparsa, otherComparsa],
    ),
    planillas: new FakePlanillaRepository(),
    votes: new FakeVoteRepository(),
    audits: new FakeAuditRepository(),
  };
  repos.planillas.linkVotes(repos.votes);
  repos.uow = new FakeUnitOfWork(repos.planillas, repos.votes, repos.audits, repos.nights);
  return repos;
}

function buildUpsert(repos: BuiltRepos): UpsertVote {
  return new UpsertVote(
    repos.editions,
    repos.configurations,
    repos.planillas,
    repos.votes,
    new VoteValidator(repos.nights, repos.assignments, repos.catalogue),
  );
}

function buildConfirm(repos: BuiltRepos): ConfirmPlanilla {
  return new ConfirmPlanilla(
    repos.editions,
    repos.configurations,
    repos.assignments,
    repos.catalogue,
    repos.nights,
    new FakeUnitOfWork(repos.planillas, repos.votes, repos.audits, repos.nights),
  );
}

// ---------------------------------------------------------------------------
// Use-cases: JudgeContext / ListMyPlanillas / CreatePlanilla / GetPlanilla
// ---------------------------------------------------------------------------

describe("JudgeContext use-case", () => {
  it("devuelve el contexto completo del juez", async () => {
    const repos = buildFakes();
    const uc = new JudgeContext(repos.editions, repos.nights, repos.configurations, repos.assignments, repos.catalogue);
    const ctx = await uc.execute({ judgeId: JUDGE_ID });

    expect(ctx.edition.code).toBe(EDITION_CODE);
    expect(ctx.edition.votingNights).toBe(3);
    expect(ctx.nights).toHaveLength(2);
    expect(ctx.assignments).toHaveLength(1);
    expect(ctx.assignments[0]).toMatchObject({ nightId: NIGHT_A_ID, specialty: "BAILE", confirmed: true });
    expect(ctx.rubros).toHaveLength(2);
    expect(ctx.candidates).toHaveLength(2);
    expect(ctx.comparsas).toHaveLength(2);
    expect(ctx.configuration).toMatchObject({ versionId: CONFIG_ID, version: 1 });
  });
});

describe("ListMyPlanillas use-case", () => {
  it("devuelve los resúmenes de las planillas del juez", async () => {
    const repos = buildFakes();
    await repos.planillas.create({ id: PLANILLA_ID, judgeId: JUDGE_ID, nightId: NIGHT_A_ID, status: "BORRADOR" });

    const uc = new ListMyPlanillas(repos.planillas);
    const rows = await uc.execute({ judgeId: JUDGE_ID });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: PLANILLA_ID, nightId: NIGHT_A_ID, status: "BORRADOR", votesCount: 0 });
    expect(rows[0]).not.toHaveProperty("confirmedAt");
  });
});

describe("CreatePlanilla use-case", () => {
  it("crea una planilla BORRADOR y audita PLANILLA_CREATED", async () => {
    const repos = buildFakes();
    const uc = new CreatePlanilla(repos.planillas, repos.votes, repos.assignments, repos.audits);
    const result = await uc.execute({ judgeId: JUDGE_ID, nightId: NIGHT_A_ID });

    expect(result.created).toBe(true);
    expect(result.planilla).toMatchObject({ judgeId: JUDGE_ID, nightId: NIGHT_A_ID, status: "BORRADOR" });
    expect(result.votes).toEqual([]);
    expect(repos.audits.events).toHaveLength(1);
    expect(repos.audits.events[0]).toMatchObject({ eventType: "PLANILLA_CREATED", actorUserId: JUDGE_ID });
  });

  it("es idempotente: devuelve la planilla existente para (juez, noche)", async () => {
    const repos = buildFakes();
    const uc = new CreatePlanilla(repos.planillas, repos.votes, repos.assignments, repos.audits);
    const first = await uc.execute({ judgeId: JUDGE_ID, nightId: NIGHT_A_ID });
    const second = await uc.execute({ judgeId: JUDGE_ID, nightId: NIGHT_A_ID });

    expect(second.created).toBe(false);
    expect(second.planilla.id).toBe(first.planilla.id);
    expect(repos.planillas.planillas).toHaveLength(1);
  });

  it("rechaza (403) si el juez no tiene asignación efectiva para la noche", async () => {
    const repos = buildFakes();
    const uc = new CreatePlanilla(repos.planillas, repos.votes, repos.assignments, repos.audits);
    await expect(uc.execute({ judgeId: JUDGE_ID, nightId: NIGHT_B_ID })).rejects.toThrow(ForbiddenError);
    expect(repos.planillas.planillas).toHaveLength(0);
  });
});

describe("GetPlanilla use-case", () => {
  it("devuelve la planilla propia con sus votos", async () => {
    const repos = buildFakes();
    await repos.planillas.create({ id: PLANILLA_ID, judgeId: JUDGE_ID, nightId: NIGHT_A_ID, status: "BORRADOR" });
    const uc = new GetPlanilla(repos.planillas, repos.votes);
    const detail = await uc.execute({ judgeId: JUDGE_ID, planillaId: PLANILLA_ID });
    expect(detail.planilla.id).toBe(PLANILLA_ID);
    expect(detail.votes).toEqual([]);
  });

  it("devuelve 404 (NotFound) para una planilla de otro juez", async () => {
    const repos = buildFakes();
    await repos.planillas.create({ id: PLANILLA_ID, judgeId: OTHER_JUDGE_ID, nightId: NIGHT_A_ID, status: "BORRADOR" });
    const uc = new GetPlanilla(repos.planillas, repos.votes);
    await expect(uc.execute({ judgeId: JUDGE_ID, planillaId: PLANILLA_ID })).rejects.toThrow(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// Use-cases: UpsertVote
// ---------------------------------------------------------------------------

describe("UpsertVote use-case", () => {
  const planillaId = PLANILLA_ID;

  async function withPlanilla(repos: BuiltRepos, status: Planilla["status"] = "BORRADOR", owner = JUDGE_ID): Promise<void> {
    await repos.planillas.create({
      id: planillaId,
      judgeId: owner,
      nightId: NIGHT_A_ID,
      status,
    });
  }

  it("crea el voto la primera vez (INSERT)", async () => {
    const repos = buildFakes();
    await withPlanilla(repos);
    const uc = buildUpsert(repos);

    const vote = await uc.execute({
      judgeId: JUDGE_ID,
      planillaId,
      voteId: VOTE_ID,
      payload: validVotePayload(),
    });

    expect(vote).toMatchObject({
      id: VOTE_ID,
      planillaId,
      judgeId: JUDGE_ID,
      nightId: NIGHT_A_ID,
      comparsaId: COMPARSA_ID,
      score: 8.5,
      scoreSource: "JUDGE",
      idempotencyKey: "key-1",
      versionId: CONFIG_ID,
      syncState: "PENDING",
    });
    expect(repos.votes.votes).toHaveLength(1);
  });

  it("actualiza el voto existente por el mismo voteId (PUT idempotente)", async () => {
    const repos = buildFakes();
    await withPlanilla(repos);
    const uc = buildUpsert(repos);

    const first = await uc.execute({ judgeId: JUDGE_ID, planillaId, voteId: VOTE_ID, payload: validVotePayload({ score: 8.5 }) });
    const second = await uc.execute({ judgeId: JUDGE_ID, planillaId, voteId: VOTE_ID, payload: validVotePayload({ score: 9.0 }) });

    expect(second.id).toBe(first.id);
    expect(second.score).toBe(9.0);
    expect(repos.votes.votes).toHaveLength(1);
  });

  it("es idempotente por idempotencyKey con el mismo payload", async () => {
    const repos = buildFakes();
    await withPlanilla(repos);
    const uc = buildUpsert(repos);

    const first = await uc.execute({ judgeId: JUDGE_ID, planillaId, voteId: VOTE_ID, payload: validVotePayload() });
    const replay = await uc.execute({ judgeId: JUDGE_ID, planillaId, voteId: VOTE2_ID, payload: validVotePayload() });

    expect(replay.id).toBe(first.id);
    expect(repos.votes.votes).toHaveLength(1);
  });

  it("rechaza con ConflictError (IDEMPOTENCY_CONFLICT) un idempotencyKey reutilizado con otro payload", async () => {
    const repos = buildFakes();
    await withPlanilla(repos);
    const uc = buildUpsert(repos);

    await uc.execute({ judgeId: JUDGE_ID, planillaId, voteId: VOTE_ID, payload: validVotePayload() });
    await expect(
      uc.execute({
        judgeId: JUDGE_ID,
        planillaId,
        voteId: VOTE2_ID,
        payload: validVotePayload({ comparsaId: OTHER_COMPARSA_ID }),
      }),
    ).rejects.toThrow(ConflictError);
  });

  it("reutiliza un voto existente por clave de negocio (actualiza conservando el id original)", async () => {
    const repos = buildFakes();
    await withPlanilla(repos);
    const uc = buildUpsert(repos);

    const first = await uc.execute({ judgeId: JUDGE_ID, planillaId, voteId: VOTE_ID, payload: validVotePayload({ idempotencyKey: "key-A" }) });
    // Mismo voto de negocio, otro client_vote id, otra idempotencyKey.
    const retry = await uc.execute({ judgeId: JUDGE_ID, planillaId, voteId: VOTE2_ID, payload: validVotePayload({ idempotencyKey: "key-B", score: 7.0 }) });

    expect(retry.id).toBe(first.id);
    expect(retry.score).toBe(7.0);
    expect(retry.idempotencyKey).toBe("key-B");
    expect(repos.votes.votes).toHaveLength(1);
  });

  it("deduplica por client_ref cuando ya existe (id / idempotency / business key difieren)", async () => {
    const repos = buildFakes();
    await withPlanilla(repos);
    const uc = buildUpsert(repos);

    const first = await uc.execute({
      judgeId: JUDGE_ID,
      planillaId,
      voteId: VOTE_ID,
      payload: validVotePayload({ idempotencyKey: "key-A" }),
    });
    const replay = await uc.execute({
      judgeId: JUDGE_ID,
      planillaId,
      voteId: VOTE2_ID,
      payload: validVotePayload({ idempotencyKey: "key-B", comparsaId: OTHER_COMPARSA_ID }),
    });

    expect(replay.id).toBe(first.id);
    expect(repos.votes.votes).toHaveLength(1);
  });

  it("rechaza un voto confirmado como inmutable (VOTE_CONFIRMED_IMMUTABLE)", async () => {
    const repos = buildFakes();
    await withPlanilla(repos);
    await repos.votes.create({
      id: VOTE_ID,
      planillaId,
      judgeId: JUDGE_ID,
      nightId: NIGHT_A_ID,
      editionId: EDITION_ID,
      comparsaId: COMPARSA_ID,
      rubroId: RUBRO_ID,
      itemId: ITEM_ID,
      candidateId: CANDIDATE_ID,
      score: 8.5,
      scoreSource: "JUDGE",
      idempotencyKey: "key-A",
      versionId: CONFIG_ID,
      confirmedAt: new Date(),
    });
    const uc = buildUpsert(repos);

    await expect(
      uc.execute({ judgeId: JUDGE_ID, planillaId, voteId: VOTE2_ID, payload: validVotePayload({ idempotencyKey: "key-B" }) }),
    ).rejects.toThrow(ConflictError);
  });

  it("rechaza votos sobre una planilla confirmada (PLANILLA_NOT_EDITABLE)", async () => {
    const repos = buildFakes();
    await withPlanilla(repos, "CONFIRMADA", JUDGE_ID);
    const uc = buildUpsert(repos);

    await expect(
      uc.execute({ judgeId: JUDGE_ID, planillaId, voteId: VOTE_ID, payload: validVotePayload() }),
    ).rejects.toThrow(ConflictError);
  });

  it("rechaza (404) votos sobre una planilla de otro juez", async () => {
    const repos = buildFakes();
    await withPlanilla(repos, "BORRADOR", OTHER_JUDGE_ID);
    const uc = buildUpsert(repos);

    await expect(
      uc.execute({ judgeId: JUDGE_ID, planillaId, voteId: VOTE_ID, payload: validVotePayload() }),
    ).rejects.toThrow(NotFoundError);
  });

  it("rechaza (Forbidden) si el juez no tiene asignación efectiva en la noche de la planilla", async () => {
    const repos = buildFakes();
    await repos.planillas.create({ id: planillaId, judgeId: JUDGE_ID, nightId: NIGHT_B_ID, status: "BORRADOR" });
    const uc = buildUpsert(repos);

    await expect(
      uc.execute({ judgeId: JUDGE_ID, planillaId, voteId: VOTE_ID, payload: validVotePayload() }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("rechaza un rubro de especialidad distinta a la asignación (ValidationError)", async () => {
    const repos = buildFakes();
    await withPlanilla(repos);
    const uc = buildUpsert(repos);

    await expect(
      uc.execute({
        judgeId: JUDGE_ID,
        planillaId,
        voteId: VOTE_ID,
        payload: validVotePayload({
          rubroId: VESTUARIO_RUBRO_ID,
          itemId: VESTUARIO_ITEM_ID,
          candidateId: VESTUARIO_CANDIDATE_ID,
        }),
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("rechaza payloads inválidos (score con más de un decimal)", async () => {
    const repos = buildFakes();
    await withPlanilla(repos);
    const uc = buildUpsert(repos);

    await expect(
      uc.execute({ judgeId: JUDGE_ID, planillaId, voteId: VOTE_ID, payload: validVotePayload({ score: 8.55 }) }),
    ).rejects.toThrow(ValidationError);
  });

  it("rechaza (NIGHT_WINDOW_CLOSED) escribir un voto cuando la ventana ya cerró (endsAt pasado)", async () => {
    const repos = buildFakes([nightAClosed]);
    await withPlanilla(repos);
    const uc = buildUpsert(repos);

    await expect(
      uc.execute({ judgeId: JUDGE_ID, planillaId, voteId: VOTE_ID, payload: validVotePayload() }),
    ).rejects.toMatchObject({ code: "NIGHT_WINDOW_CLOSED" });
    expect(repos.votes.votes).toHaveLength(0);
  });

  it("rechaza (NIGHT_WINDOW_CLOSED) escribir un voto cuando la ventana aún no abrió (startsAt futuro)", async () => {
    const repos = buildFakes([nightANotStarted]);
    await withPlanilla(repos);
    const uc = buildUpsert(repos);

    await expect(
      uc.execute({ judgeId: JUDGE_ID, planillaId, voteId: VOTE_ID, payload: validVotePayload() }),
    ).rejects.toMatchObject({ code: "NIGHT_WINDOW_CLOSED" });
    expect(repos.votes.votes).toHaveLength(0);
  });

  it("no bloquea (PEND-110) un voto cuando la noche no tiene fechas de ventana (startsAt/endsAt undefined)", async () => {
    // Regresión: sin fechas oficiales no hay ventana que aplicar.
    const repos = buildFakes();
    await withPlanilla(repos);
    const uc = buildUpsert(repos);

    const vote = await uc.execute({
      judgeId: JUDGE_ID,
      planillaId,
      voteId: VOTE_ID,
      payload: validVotePayload(),
    });
    expect(vote).toMatchObject({ id: VOTE_ID, score: 8.5 });
    expect(repos.votes.votes).toHaveLength(1);
  });

  it("permite escribir dentro de una ventana abierta (ventana cumplida)", async () => {
    const repos = buildFakes([nightAOpen]);
    await withPlanilla(repos);
    const uc = buildUpsert(repos);

    const vote = await uc.execute({
      judgeId: JUDGE_ID,
      planillaId,
      voteId: VOTE_ID,
      payload: validVotePayload(),
    });
    expect(vote).toMatchObject({ id: VOTE_ID, score: 8.5 });
    expect(repos.votes.votes).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Use-cases: ConfirmPlanilla
// ---------------------------------------------------------------------------

describe("ConfirmPlanilla use-case", () => {
  async function seedPlanilla(
    repos: BuiltRepos,
    status: Planilla["status"] = "BORRADOR",
    owner = JUDGE_ID,
  ): Promise<void> {
    await repos.planillas.create({
      id: PLANILLA_ID,
      judgeId: owner,
      nightId: NIGHT_A_ID,
      status,
    });
  }

  async function seedVote(
    repos: BuiltRepos,
    overrides?: Partial<Parameters<VoteRepository["create"]>[0]>,
  ): Promise<void> {
    await repos.votes.create({
      id: VOTE_ID,
      planillaId: PLANILLA_ID,
      judgeId: JUDGE_ID,
      nightId: NIGHT_A_ID,
      editionId: EDITION_ID,
      comparsaId: COMPARSA_ID,
      rubroId: RUBRO_ID,
      itemId: ITEM_ID,
      candidateId: CANDIDATE_ID,
      score: 8.5,
      scoreSource: "JUDGE",
      idempotencyKey: "seed-key",
      versionId: CONFIG_ID,
      ...overrides,
    });
  }

  it("confirma los votos y la planilla, auditando VOTE_CONFIRMED y PLANILLA_MODIFIED", async () => {
    const repos = buildFakes();
    await seedPlanilla(repos);
    await seedVote(repos);
    const uc = buildConfirm(repos);

    const result = await uc.execute({ judgeId: JUDGE_ID, planillaId: PLANILLA_ID });

    expect(result.votesConfirmed).toBe(1);
    expect(result.omissionsInserted).toBe(0);
    expect(result.planilla).toMatchObject({ id: PLANILLA_ID, status: "CONFIRMADA" });
    expect(result.planilla.confirmedAt).toBeDefined();

    const stored = await repos.planillas.findById(PLANILLA_ID);
    expect(stored?.status).toBe("CONFIRMADA");
    expect(stored?.confirmedAt).not.toBeNull();

    const vote = await repos.votes.findById(VOTE_ID);
    expect(vote?.confirmedAt).toBeDefined();

    const types = repos.audits.events.map((e) => e.eventType);
    expect(types).toContain("VOTE_CONFIRMED");
    expect(types).toContain("PLANILLA_MODIFIED");

    const voteEvent = repos.audits.events.find((e) => e.eventType === "VOTE_CONFIRMED");
    expect(voteEvent).toMatchObject({
      entityType: "VOTE",
      entityId: VOTE_ID,
      actorUserId: JUDGE_ID,
    });

    const planillaEvent = repos.audits.events.find((e) => e.eventType === "PLANILLA_MODIFIED");
    expect(planillaEvent?.payload).toMatchObject({
      action: "CONFIRMED",
      previousStatus: "BORRADOR",
      newStatus: "CONFIRMADA",
    });
  });

  it("subsana omisiones: inserta 5/OMISSION_CORRECTION para candidatos sin voto y audita", async () => {
    const repos = buildFakes();
    await seedPlanilla(repos);
    const uc = buildConfirm(repos);

    const result = await uc.execute({ judgeId: JUDGE_ID, planillaId: PLANILLA_ID });

    expect(result.votesConfirmed).toBe(0);
    expect(result.omissionsInserted).toBe(1);

    const votes = await repos.votes.findByPlanilla(PLANILLA_ID);
    expect(votes).toHaveLength(1);
    expect(votes[0]).toMatchObject({
      planillaId: PLANILLA_ID,
      nightId: NIGHT_A_ID,
      candidateId: CANDIDATE_ID,
      rubroId: RUBRO_ID,
      itemId: ITEM_ID,
      score: 5,
      scoreSource: "OMISSION_CORRECTION",
    });
    expect(votes[0].confirmedAt).toBeDefined();

    const types = repos.audits.events.map((e) => e.eventType);
    expect(types).toContain("OMISSION_CORRECTED");
    expect(types).not.toContain("VOTE_CONFIRMED");
  });

  it("es idempotente: reintentar la confirmación no muta ni audita de nuevo", async () => {
    const repos = buildFakes();
    await seedPlanilla(repos);
    const uc = buildConfirm(repos);

    const first = await uc.execute({ judgeId: JUDGE_ID, planillaId: PLANILLA_ID });
    expect(first.omissionsInserted).toBe(1);

    const eventsAfterFirst = repos.audits.events.length;

    const second = await uc.execute({ judgeId: JUDGE_ID, planillaId: PLANILLA_ID });
    expect(second.votesConfirmed).toBe(0);
    expect(second.omissionsInserted).toBe(0);
    expect(second.planilla.status).toBe("CONFIRMADA");
    expect(second.planilla.confirmedAt).toBeDefined();
    expect(repos.audits.events).toHaveLength(eventsAfterFirst);
  });

  it("rechaza (NotFound) una planilla de otro juez", async () => {
    const repos = buildFakes();
    await seedPlanilla(repos, "BORRADOR", OTHER_JUDGE_ID);
    const uc = buildConfirm(repos);

    await expect(uc.execute({ judgeId: JUDGE_ID, planillaId: PLANILLA_ID })).rejects.toThrow(NotFoundError);
  });

  it("rechaza (PLANILLA_NOT_EDITABLE) una planilla terminal sin confirmar", async () => {
    const repos = buildFakes();
    await seedPlanilla(repos, "CERRADA");
    const uc = buildConfirm(repos);

    await expect(uc.execute({ judgeId: JUDGE_ID, planillaId: PLANILLA_ID })).rejects.toThrow(ConflictError);
  });

  it("rechaza (NIGHT_WINDOW_CLOSED) confirmar cuando la ventana de la noche está cerrada", async () => {
    const repos = buildFakes([nightAClosed]);
    await seedPlanilla(repos);
    const uc = buildConfirm(repos);

    await expect(uc.execute({ judgeId: JUDGE_ID, planillaId: PLANILLA_ID })).rejects.toMatchObject({
      code: "NIGHT_WINDOW_CLOSED",
    });
    const stored = await repos.planillas.findById(PLANILLA_ID);
    expect(stored?.status).toBe("BORRADOR");
  });

  it("confirma con ventana cumplida o sin ventana (regresión)", async () => {
    // Sin ventana (startsAt/endsAt undefined): confirmación OK.
    const reposNoWindow = buildFakes();
    await seedPlanilla(reposNoWindow);
    const ucNoWindow = buildConfirm(reposNoWindow);
    const resultNoWindow = await ucNoWindow.execute({ judgeId: JUDGE_ID, planillaId: PLANILLA_ID });
    expect(resultNoWindow.planilla.status).toBe("CONFIRMADA");

    // Con ventana abierta (cumplida): confirmación OK.
    const reposOpen = buildFakes([nightAOpen]);
    await seedPlanilla(reposOpen);
    const ucOpen = buildConfirm(reposOpen);
    const resultOpen = await ucOpen.execute({ judgeId: JUDGE_ID, planillaId: PLANILLA_ID });
    expect(resultOpen.planilla.status).toBe("CONFIRMADA");
  });
});

// ---------------------------------------------------------------------------
// Capa HTTP: DbPool scripted que replica las queries SQL reales
// ---------------------------------------------------------------------------

interface DbUser {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  dni: string | null;
  password_hash: string | null;
}

interface DbSession {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
}

interface DbNight {
  id: string;
  edition_id: string;
  number: number;
  date: string | null;
  status: string;
  starts_at?: string | null;
  ends_at?: string | null;
}

interface DbConfig {
  id: string;
  edition_id: string;
  version: number;
  status: string;
  frozen_at: string | null;
  frozen_by: string | null;
  rules_ref: string;
  content_ref: string;
}

interface DbAssignment {
  id: string;
  judge_id: string;
  night_id: string;
  specialty_id: string;
  is_effective: boolean;
}

interface DbSpecialty {
  id: string;
  code: string;
}

interface DbRubro {
  id: string;
  edition_id: string;
  specialty_id: string;
  name: string;
  type: string;
}

interface DbItem {
  id: string;
  rubro_id: string;
  name: string;
  order_index: number;
}

interface DbCandidate {
  id: string;
  item_id: string;
  comparsa_id: string;
  label: string;
}

interface DbComparsa {
  id: string;
  edition_id: string;
  code: string;
  name: string;
}

interface DbPlanilla {
  id: string;
  judge_id: string;
  night_id: string;
  status: string;
  confirmed_at: Date | string | null;
  closed_at: Date | string | null;
  client_ref: string | null;
  updated_at: Date | string;
}

interface DbVote {
  id: string;
  edition_id: string;
  planilla_id: string;
  judge_id: string;
  night_id: string;
  comparsa_id: string;
  rubro_id: string;
  item_id: string;
  candidate_id: string;
  score: number;
  score_source: string;
  idempotency_key: string;
  version_id: string;
  sync_state: string;
  confirmed_at: Date | string | null;
  device_context: Record<string, unknown> | null;
  client_ref: string | null;
}

interface DbAudit {
  id: string;
  event_type: string;
  entity_type: string;
  entity_id: string | null;
  actor_user_id: string | null;
  occurred_at: Date;
}

interface DbStore {
  users: DbUser[];
  sessions: DbSession[];
  edition: { id: string; code: string; name: string; voting_nights: number; starts_on: string | null; ends_on: string | null };
  nights: DbNight[];
  configs: DbConfig[];
  assignments: DbAssignment[];
  specialties: DbSpecialty[];
  rubros: DbRubro[];
  items: DbItem[];
  candidates: DbCandidate[];
  comparsas: DbComparsa[];
  planillas: DbPlanilla[];
  votes: DbVote[];
  audits: DbAudit[];
}

function makeStore(): DbStore {
  return {
    users: [
      { id: ADMIN_USER_ID, email: "admin@goya2027.test", display_name: "Admin", role: "ADMIN", dni: null, password_hash: null },
      { id: JUDGE_ID, email: "juez.baile@goya2027.test", display_name: "Juez de prueba", role: "JUDGE", dni: null, password_hash: null },
    ],
    sessions: [],
    edition: { id: EDITION_ID, code: EDITION_CODE, name: "Carnavales Goya 2027", voting_nights: 3, starts_on: null, ends_on: null },
    nights: [
      { id: NIGHT_A_ID, edition_id: EDITION_ID, number: 1, date: null, status: "ABIERTA" },
      { id: NIGHT_B_ID, edition_id: EDITION_ID, number: 2, date: null, status: "ABIERTA" },
    ],
    configs: [
      { id: CONFIG_ID, edition_id: EDITION_ID, version: 1, status: "BORRADOR", frozen_at: null, frozen_by: null, rules_ref: "CARNAVAL_2027_RULES", content_ref: "ref-1" },
    ],
    assignments: [
      { id: ASSIGNMENT_ID, judge_id: JUDGE_ID, night_id: NIGHT_A_ID, specialty_id: SPECIALTY_ID_BAILE, is_effective: true },
    ],
    specialties: [
      { id: SPECIALTY_ID_BAILE, code: "BAILE" },
      { id: SPECIALTY_ID_VESTUARIO, code: "VESTUARIO" },
    ],
    rubros: [
      { id: RUBRO_ID, edition_id: EDITION_ID, specialty_id: SPECIALTY_ID_BAILE, name: "Baile", type: "NOMINATIVO" },
      { id: VESTUARIO_RUBRO_ID, edition_id: EDITION_ID, specialty_id: SPECIALTY_ID_VESTUARIO, name: "Vestuario", type: "ALEATORIO" },
    ],
    items: [
      { id: ITEM_ID, rubro_id: RUBRO_ID, name: "Coreografía", order_index: 1 },
      { id: VESTUARIO_ITEM_ID, rubro_id: VESTUARIO_RUBRO_ID, name: "Traje", order_index: 1 },
    ],
    candidates: [
      { id: CANDIDATE_ID, item_id: ITEM_ID, comparsa_id: COMPARSA_ID, label: "Comparsa Uno" },
      { id: VESTUARIO_CANDIDATE_ID, item_id: VESTUARIO_ITEM_ID, comparsa_id: OTHER_COMPARSA_ID, label: "Comparsa Dos" },
    ],
    comparsas: [
      { id: COMPARSA_ID, edition_id: EDITION_ID, code: "C01", name: "Comparsa Uno" },
      { id: OTHER_COMPARSA_ID, edition_id: EDITION_ID, code: "C02", name: "Comparsa Dos" },
    ],
    planillas: [],
    votes: [],
    audits: [],
  };
}

function specialtyCode(store: DbStore, specialtyId: string): string {
  return store.specialties.find((s) => s.id === specialtyId)?.code ?? "";
}

function nightNumber(store: DbStore, nightId: string): number {
  return store.nights.find((n) => n.id === nightId)?.number ?? 0;
}

/**
 * Pool que replica el comportamiento SQL de los repos Postgres sobre un store
 * en memoria. Cada rama identifica la consulta por su texto real, al igual que
 * el `scriptedDb` de auth.test.ts.
 */
function votingDb(store: DbStore): DbPool {
  const runner: QueryRunner = {
    async query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }> {
      const p = params ?? [];
      const str = (i: number): string => String(p[i]);

      // --- session (auth) ---
      if (text.includes("FROM session") && text.includes("WHERE token_hash")) {
        const row = store.sessions.find((s) => s.token_hash === str(0));
        return { rows: (row === undefined ? [] : [row]) as T[] };
      }
      // --- user (auth) ---
      if (text.includes("FROM user_account") && text.includes("WHERE email")) {
        const row = store.users.find((u) => u.email === str(0));
        return { rows: (row === undefined ? [] : [row]) as T[] };
      }
      if (text.includes("FROM user_account") && text.includes("WHERE id")) {
        const row = store.users.find((u) => u.id === str(0));
        return { rows: (row === undefined ? [] : [row]) as T[] };
      }
      // --- edition ---
      if (text.includes("FROM carnaval_edition") && text.includes("WHERE code")) {
        const row = store.edition.code === str(0) ? store.edition : undefined;
        return { rows: (row === undefined ? [] : [row]) as T[] };
      }
      if (text.includes("FROM carnaval_edition") && text.includes("WHERE id")) {
        const row = store.edition.id === str(0) ? store.edition : undefined;
        return { rows: (row === undefined ? [] : [row]) as T[] };
      }
      // --- night ---
      if (text.includes("FROM night") && text.includes("WHERE edition_id") && !text.includes("JOIN night")) {
        const rows = store.nights.filter((n) => n.edition_id === str(0)).sort((a, b) => a.number - b.number);
        return { rows: rows as T[] };
      }
      if (text.includes("FROM night") && text.includes("WHERE id") && !text.includes("JOIN night")) {
        const row = store.nights.find((n) => n.id === str(0));
        return { rows: (row === undefined ? [] : [row]) as T[] };
      }
      // --- configuration ---
      if (text.includes("FROM configuration_version")) {
        const rows = store.configs.filter((c) => c.edition_id === str(0)).sort((a, b) => b.version - a.version);
        return { rows: (text.includes("LIMIT 1") ? rows.slice(0, 1) : rows) as T[] };
      }
      // --- judge assignment ---
      if (text.includes("FROM judge_assignment") && text.includes("AND ja.night_id")) {
        const a = store.assignments.find(
          (x) => x.judge_id === str(0) && x.night_id === str(1) && x.is_effective,
        );
        return {
          rows: (a === undefined
            ? []
            : [{
                id: a.id,
                night_id: a.night_id,
                specialty_id: a.specialty_id,
                specialty_code: specialtyCode(store, a.specialty_id),
              }]) as T[],
        };
      }
      if (text.includes("FROM judge_assignment")) {
        const rows = store.assignments
          .filter((a) => a.judge_id === str(0) && a.is_effective)
          .sort((a, b) => nightNumber(store, a.night_id) - nightNumber(store, b.night_id))
          .map((a) => ({
            id: a.id,
            night_id: a.night_id,
            night_number: nightNumber(store, a.night_id),
            specialty_id: a.specialty_id,
            specialty_code: specialtyCode(store, a.specialty_id),
            confirmed: true,
          }));
        return { rows: rows as T[] };
      }
      // --- rubro ---
      if (text.includes("FROM rubro r") && text.includes("WHERE r.id")) {
        const r = store.rubros.find((x) => x.id === str(0));
        return {
          rows: (r === undefined
            ? []
            : [{ ...r, specialty_code: specialtyCode(store, r.specialty_id) }]) as T[],
        };
      }
      if (text.includes("FROM rubro r")) {
        const rows = store.rubros
          .filter((r) => r.edition_id === str(0))
          .map((r) => ({ ...r, specialty_code: specialtyCode(store, r.specialty_id) }));
        return { rows: rows as T[] };
      }
      // --- item ---
      if (text.includes("FROM rubro_item") && text.includes("WHERE id")) {
        const row = store.items.find((i) => i.id === str(0));
        return { rows: (row === undefined ? [] : [row]) as T[] };
      }
      if (text.includes("FROM rubro_item")) {
        const rubroIds = new Set(store.rubros.filter((r) => r.edition_id === str(0)).map((r) => r.id));
        const rows = store.items
          .filter((i) => rubroIds.has(i.rubro_id))
          .sort((a, b) => a.order_index - b.order_index);
        return { rows: rows as T[] };
      }
      // --- candidate ---
      if (text.includes("FROM candidate") && text.includes("WHERE id")) {
        const row = store.candidates.find((c) => c.id === str(0));
        return { rows: (row === undefined ? [] : [row]) as T[] };
      }
      if (text.includes("FROM candidate")) {
        const rubroIds = new Set(store.rubros.filter((r) => r.edition_id === str(0)).map((r) => r.id));
        const itemIds = new Set(store.items.filter((i) => rubroIds.has(i.rubro_id)).map((i) => i.id));
        const rows = store.candidates
          .filter((c) => itemIds.has(c.item_id))
          .sort((a, b) => a.label.localeCompare(b.label));
        return { rows: rows as T[] };
      }
      // --- comparsa ---
      if (text.includes("FROM comparsa") && text.includes("WHERE id")) {
        const row = store.comparsas.find((c) => c.id === str(0));
        return { rows: (row === undefined ? [] : [row]) as T[] };
      }
      if (text.includes("FROM comparsa")) {
        const rows = store.comparsas.filter((c) => c.edition_id === str(0)).sort((a, b) => a.code.localeCompare(b.code));
        return { rows: rows as T[] };
      }
      // --- planilla ---
      if (text.startsWith("UPDATE planilla")) {
        const planilla = store.planillas.find((x) => x.id === str(0));
        if (planilla === undefined) throw new Error("planilla not found in store");
        planilla.status = "CONFIRMADA";
        planilla.confirmed_at = p[1] as Date;
        planilla.updated_at = new Date();
        return { rows: [] as T[] };
      }
      if (text.startsWith("INSERT INTO planilla")) {
        const planilla: DbPlanilla = {
          id: str(0),
          judge_id: str(1),
          night_id: str(2),
          status: str(3),
          confirmed_at: null,
          closed_at: null,
          client_ref: p[4] === null || p[4] === undefined ? null : str(4),
          updated_at: new Date(),
        };
        store.planillas.push(planilla);
        return { rows: [planilla] as T[] };
      }
      if (text.includes("FROM planilla") && text.includes("WHERE judge_id = $1 AND night_id = $2 AND client_ref = $3")) {
        const row = store.planillas.find(
          (x) => x.judge_id === str(0) && x.night_id === str(1) && x.client_ref === str(2),
        );
        return { rows: (row === undefined ? [] : [row]) as T[] };
      }
      if (text.includes("FROM planilla") && text.includes("WHERE judge_id = $1 AND night_id = $2")) {
        const row = store.planillas.find((x) => x.judge_id === str(0) && x.night_id === str(1));
        return { rows: (row === undefined ? [] : [row]) as T[] };
      }
      if (text.includes("FROM planilla") && text.includes("WHERE judge_id = $1 AND client_ref = $2")) {
        const row = store.planillas.find((x) => x.judge_id === str(0) && x.client_ref === str(1));
        return { rows: (row === undefined ? [] : [row]) as T[] };
      }
      if (text.includes("FROM planilla p")) {
        const rows = store.planillas
          .filter((x) => x.judge_id === str(0))
          .sort((a, b) => nightNumber(store, a.night_id) - nightNumber(store, b.night_id))
          .map((x) => ({
            id: x.id,
            night_id: x.night_id,
            night_number: nightNumber(store, x.night_id),
            status: x.status,
            confirmed_at: x.confirmed_at,
            votes_count: store.votes.filter((v) => v.planilla_id === x.id).length,
            updated_at: x.updated_at,
          }));
        return { rows: rows as T[] };
      }
      if (text.includes("FROM planilla") && text.includes("FOR UPDATE")) {
        const row = store.planillas.find((x) => x.id === str(0));
        return { rows: (row === undefined ? [] : [row]) as T[] };
      }
      if (text.includes("FROM planilla") && text.includes("WHERE id")) {
        const row = store.planillas.find((x) => x.id === str(0));
        return { rows: (row === undefined ? [] : [row]) as T[] };
      }
      // --- vote ---
      if (text.startsWith("INSERT INTO vote")) {
        const vote: DbVote = {
          id: str(0),
          edition_id: str(1),
          planilla_id: str(2),
          judge_id: str(3),
          night_id: str(4),
          comparsa_id: str(5),
          rubro_id: str(6),
          item_id: str(7),
          candidate_id: str(8),
          score: p[9] as number,
          score_source: str(10),
          idempotency_key: str(11),
          version_id: str(12),
          sync_state: str(13),
          confirmed_at: p[14] ?? null,
          device_context: p[15] === null ? null : (JSON.parse(str(15)) as Record<string, unknown>),
          client_ref: p[16] === null || p[16] === undefined ? null : str(16),
        };
        store.votes.push(vote);
        return { rows: [vote] as T[] };
      }
      if (text.startsWith("UPDATE vote") && text.includes("SET confirmed_at")) {
        const vote = store.votes.find((v) => v.id === str(0));
        if (vote === undefined) throw new Error("vote not found in store");
        vote.confirmed_at = p[1] as Date;
        return { rows: [] as T[] };
      }
      if (text.startsWith("UPDATE vote")) {
        const vote = store.votes.find((v) => v.id === str(0));
        if (vote === undefined) throw new Error("vote not found in store");
        vote.score = p[1] as number;
        vote.idempotency_key = str(2);
        vote.client_ref = p[3] === null || p[3] === undefined ? null : str(3);
        vote.device_context = p[4] === null ? null : (JSON.parse(str(4)) as Record<string, unknown>);
        return { rows: [vote] as T[] };
      }
      if (text.includes("WHERE judge_id = $1 AND night_id = $2 AND comparsa_id")) {
        const row = store.votes.find(
          (v) =>
            v.judge_id === str(0) &&
            v.night_id === str(1) &&
            v.comparsa_id === str(2) &&
            v.rubro_id === str(3) &&
            v.item_id === str(4) &&
            v.candidate_id === str(5),
        );
        return { rows: (row === undefined ? [] : [row]) as T[] };
      }
      if (text.includes("WHERE judge_id = $1 AND idempotency_key = $2")) {
        const row = store.votes.find((v) => v.judge_id === str(0) && v.idempotency_key === str(1));
        return { rows: (row === undefined ? [] : [row]) as T[] };
      }
      if (text.includes("WHERE judge_id = $1 AND client_ref = $2")) {
        const row = store.votes.find((v) => v.judge_id === str(0) && v.client_ref === str(1));
        return { rows: (row === undefined ? [] : [row]) as T[] };
      }
      if (text.includes("WHERE planilla_id = $1")) {
        const rows = store.votes
          .filter((v) => v.planilla_id === str(0))
          .sort((a, b) =>
            [a.comparsa_id, a.rubro_id, a.item_id, a.candidate_id].join("/") >
            [b.comparsa_id, b.rubro_id, b.item_id, b.candidate_id].join("/")
              ? 1
              : -1,
          );
        return { rows: rows as T[] };
      }
      if (text.includes("FROM vote") && text.includes("WHERE id")) {
        const row = store.votes.find((v) => v.id === str(0));
        return { rows: (row === undefined ? [] : [row]) as T[] };
      }
      // --- audit ---
      if (text.startsWith("INSERT INTO audit_event")) {
        const audit: DbAudit = {
          id: `audit-${store.audits.length + 1}`,
          event_type: str(0),
          entity_type: str(1),
          entity_id: p[2] === null || p[2] === undefined ? null : str(2),
          actor_user_id: p[3] === null || p[3] === undefined ? null : str(3),
          occurred_at: new Date(),
        };
        store.audits.push(audit);
        return { rows: [audit] as T[] };
      }

      throw new Error(`Unexpected query in voting flow test: ${text}`);
    },
  };

  return {
    query: (text, params) => runner.query(text, params),
    withTransaction: (fn) => fn(runner),
    async end() {},
  };
}

function seedSession(store: DbStore, userId: string): string {
  const token = generateSessionToken();
  store.sessions.push({
    id: `session-${store.sessions.length + 1}`,
    user_id: userId,
    token_hash: hashSessionToken(token),
    created_at: new Date(),
    expires_at: new Date(Date.now() + 60 * 60 * 1000),
    revoked_at: null,
  });
  return token;
}

// ---------------------------------------------------------------------------
// Helpers HTTP
// ---------------------------------------------------------------------------

async function startApp(store: DbStore) {
  const app = createApp(
    loadConfig({ databaseUrl: "postgresql://mock@localhost/mock", nodeEnv: "test" }),
    votingDb(store),
  );
  await new Promise<void>((resolve) => app.server.listen(0, resolve));
  return app;
}

function httpRequest(
  server: Server,
  path: string,
  method = "GET",
  headers: Record<string, string> = {},
  body?: string,
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  const port = (server.address() as AddressInfo).port;
  return new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, path, method, headers },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk.toString()));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data }),
        );
      },
    );
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function jsonRequest(
  server: Server,
  path: string,
  headers: Record<string, string> = {},
  body?: unknown,
  method?: string,
): Promise<{ status: number; body: unknown }> {
  const resolvedMethod = method ?? (body === undefined ? "GET" : "POST");
  return httpRequest(
    server,
    path,
    resolvedMethod,
    { "content-type": "application/json", ...headers },
    body === undefined ? undefined : JSON.stringify(body),
  ).then((res) => ({
    status: res.status,
    body: res.body === "" ? undefined : (JSON.parse(res.body) as unknown),
  }));
}

function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function seedPlanilla(store: DbStore, overrides?: Partial<DbPlanilla>): DbPlanilla {
  const planilla: DbPlanilla = {
    id: PLANILLA_ID,
    judge_id: JUDGE_ID,
    night_id: NIGHT_A_ID,
    status: "BORRADOR",
    confirmed_at: null,
    closed_at: null,
    client_ref: null,
    updated_at: new Date().toISOString(),
    ...overrides,
  };
  store.planillas.push(planilla);
  return planilla;
}

function seedVote(store: DbStore, overrides?: Partial<DbVote>): DbVote {
  const vote: DbVote = {
    id: VOTE_ID,
    edition_id: EDITION_ID,
    planilla_id: PLANILLA_ID,
    judge_id: JUDGE_ID,
    night_id: NIGHT_A_ID,
    comparsa_id: COMPARSA_ID,
    rubro_id: RUBRO_ID,
    item_id: ITEM_ID,
    candidate_id: CANDIDATE_ID,
    score: 8.5,
    score_source: "JUDGE",
    idempotency_key: "seed-key",
    version_id: CONFIG_ID,
    sync_state: "PENDING",
    confirmed_at: null,
    device_context: null,
    client_ref: null,
    ...overrides,
  };
  store.votes.push(vote);
  return vote;
}

// ---------------------------------------------------------------------------
// HTTP: autenticación y autorización
// ---------------------------------------------------------------------------

describe("Voting Flow HTTP: autenticación y autorización", () => {
  async function run(cb: (store: DbStore, token: string) => Promise<void>): Promise<void> {
    const store = makeStore();
    const token = seedSession(store, JUDGE_ID);
    const app = await startApp(store);
    try {
      await cb(store, token);
    } finally {
      await app.close();
    }
  }

  it("rechaza 401 sin token", async () => {
    await run(async (_store, _token) => {
      const app = await startApp(makeStore());
      try {
        const res = await jsonRequest(app.server, "/judge/context");
        expect(res.status).toBe(401);
        expect(res.body).toMatchObject({ error: { code: "UNAUTHORIZED" } });
      } finally {
        await app.close();
      }
    });
  });

  it("rechaza 401 con token inválido", async () => {
    const store = makeStore();
    const app = await startApp(store);
    try {
      const res = await jsonRequest(app.server, "/judge/context", authHeaders("not-a-valid-token"));
      expect(res.status).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("rechaza 403 a un usuario autenticado que no es JUDGE", async () => {
    const store = makeStore();
    const adminToken = seedSession(store, ADMIN_USER_ID);
    const app = await startApp(store);
    try {
      const res = await jsonRequest(app.server, "/judge/context", authHeaders(adminToken));
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ error: { code: "FORBIDDEN" } });
    } finally {
      await app.close();
    }
  });

  it("expone 401 si la sesión está revocada", async () => {
    const store = makeStore();
    const token = generateSessionToken();
    store.sessions.push({
      id: "revoked-session",
      user_id: JUDGE_ID,
      token_hash: hashSessionToken(token),
      created_at: new Date(),
      expires_at: new Date(Date.now() + 60 * 60 * 1000),
      revoked_at: new Date(),
    });
    const app = await startApp(store);
    try {
      const res = await jsonRequest(app.server, "/judge/context", authHeaders(token));
      expect(res.status).toBe(401);
    } finally {
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// HTTP: contexto, planillas y votos
// ---------------------------------------------------------------------------

describe("Voting Flow HTTP: contexto del juez", () => {
  it("GET /judge/context devuelve la configuración completa de la noche", async () => {
    const store = makeStore();
    const token = seedSession(store, JUDGE_ID);
    const app = await startApp(store);
    try {
      const res = await jsonRequest(app.server, "/judge/context", authHeaders(token));
      expect(res.status).toBe(200);
      const body = res.body as {
        edition: { code: string; votingNights: number };
        nights: unknown[];
        assignments: unknown[];
        rubros: unknown[];
        items: unknown[];
        candidates: unknown[];
        comparsas: unknown[];
        configuration: { versionId: string; version: number } | null;
      };
      expect(body.edition).toMatchObject({ code: EDITION_CODE, votingNights: 3 });
      expect(body.nights).toHaveLength(2);
      expect(body.assignments).toHaveLength(1);
      expect(body.rubros).toHaveLength(2);
      expect(body.items).toHaveLength(2);
      expect(body.candidates).toHaveLength(2);
      expect(body.comparsas).toHaveLength(2);
      expect(body.configuration).toMatchObject({ versionId: CONFIG_ID, version: 1 });
    } finally {
      await app.close();
    }
  });

  it("404 en ruta de juez desconocida", async () => {
    const store = makeStore();
    const token = seedSession(store, JUDGE_ID);
    const app = await startApp(store);
    try {
      const res = await jsonRequest(app.server, "/judge/nope", authHeaders(token));
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: { code: "NOT_FOUND" } });
    } finally {
      await app.close();
    }
  });

  it("405 con Allow correcto en ruta existente con método no admitido", async () => {
    const store = makeStore();
    const token = seedSession(store, JUDGE_ID);
    const app = await startApp(store);
    try {
      const res = await httpRequest(
        app.server,
        `/judge/planillas/${PLANILLA_ID}/votes/${VOTE_ID}`,
        "GET",
        authHeaders(token),
      );
      expect(res.status).toBe(405);
      expect(res.headers["allow"]).toBe("PUT");
    } finally {
      await app.close();
    }
  });
});

describe("Voting Flow HTTP: planillas", () => {
  it("GET /judge/planillas devuelve las planillas del juez", async () => {
    const store = makeStore();
    const token = seedSession(store, JUDGE_ID);
    seedPlanilla(store);
    const app = await startApp(store);
    try {
      const res = await jsonRequest(app.server, "/judge/planillas", authHeaders(token));
      expect(res.status).toBe(200);
      const body = res.body as Array<Record<string, unknown>>;
      expect(body).toHaveLength(1);
      expect(body[0]).toMatchObject({ id: PLANILLA_ID, nightId: NIGHT_A_ID, nightNumber: 1, status: "BORRADOR", votesCount: 0 });
    } finally {
      await app.close();
    }
  });

  it("POST /judge/planillas crea la planilla (201) y es idempotente (200)", async () => {
    const store = makeStore();
    const token = seedSession(store, JUDGE_ID);
    const app = await startApp(store);
    try {
      const created = await jsonRequest(app.server, "/judge/planillas", authHeaders(token), { nightId: NIGHT_A_ID }, "POST");
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ created: true });
      const body = created.body as { planilla: Record<string, unknown>; votes: unknown[] };
      expect(body.planilla).toMatchObject({ judgeId: JUDGE_ID, nightId: NIGHT_A_ID, status: "BORRADOR" });
      expect(body.votes).toEqual([]);
      expect(store.audits).toHaveLength(1);
      expect(store.audits[0]).toMatchObject({ event_type: "PLANILLA_CREATED", actor_user_id: JUDGE_ID });

      const repeated = await jsonRequest(app.server, "/judge/planillas", authHeaders(token), { nightId: NIGHT_A_ID }, "POST");
      expect(repeated.status).toBe(200);
      expect(repeated.body).toMatchObject({ created: false });
      expect((repeated.body as { planilla: { id: string } }).planilla.id).toBe(body.planilla.id);
      expect(store.planillas).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it("POST /judge/planillas rechaza 403 si el juez no está asignado a la noche", async () => {
    const store = makeStore();
    const token = seedSession(store, JUDGE_ID);
    const app = await startApp(store);
    try {
      const res = await jsonRequest(app.server, "/judge/planillas", authHeaders(token), { nightId: NIGHT_B_ID }, "POST");
      expect(res.status).toBe(403);
    } finally {
      await app.close();
    }
  });

  it("POST /judge/planillas rechaza 400 por nightId inválido", async () => {
    const store = makeStore();
    const token = seedSession(store, JUDGE_ID);
    const app = await startApp(store);
    try {
      const res = await jsonRequest(app.server, "/judge/planillas", authHeaders(token), { nightId: "not-a-uuid" }, "POST");
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    } finally {
      await app.close();
    }
  });

  it("GET /judge/planillas/:id devuelve la planilla propia con votos", async () => {
    const store = makeStore();
    const token = seedSession(store, JUDGE_ID);
    seedPlanilla(store);
    seedVote(store);
    const app = await startApp(store);
    try {
      const res = await jsonRequest(app.server, `/judge/planillas/${PLANILLA_ID}`, authHeaders(token));
      expect(res.status).toBe(200);
      const body = res.body as { planilla: Record<string, unknown>; votes: unknown[] };
      expect(body.planilla).toMatchObject({ id: PLANILLA_ID, judgeId: JUDGE_ID, status: "BORRADOR" });
      expect(body.votes).toHaveLength(1);
      expect((body.votes[0] as { id: string }).id).toBe(VOTE_ID);
    } finally {
      await app.close();
    }
  });

  it("GET /judge/planillas/:id devuelve 404 para la planilla de otro juez", async () => {
    const store = makeStore();
    const token = seedSession(store, JUDGE_ID);
    seedPlanilla(store, { id: OTHER_PLANILLA_ID, judge_id: OTHER_JUDGE_ID });
    const app = await startApp(store);
    try {
      const res = await jsonRequest(app.server, `/judge/planillas/${OTHER_PLANILLA_ID}`, authHeaders(token));
      expect(res.status).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("GET /judge/planillas/:id devuelve 400 por planillaId inválido", async () => {
    const store = makeStore();
    const token = seedSession(store, JUDGE_ID);
    const app = await startApp(store);
    try {
      const res = await jsonRequest(app.server, "/judge/planillas/nope", authHeaders(token));
      expect(res.status).toBe(400);
    } finally {
      await app.close();
    }
  });

  it("POST /judge/planillas NO se bloquea por ventana cerrada (decisión técnica del borrador vacío)", async () => {
    const store = makeStore();
    const token = seedSession(store, JUDGE_ID);
    const night = store.nights.find((n) => n.id === NIGHT_A_ID)!;
    night.starts_at = "2000-01-01T00:00:00.000Z";
    night.ends_at = "2001-01-01T00:00:00.000Z";
    const app = await startApp(store);
    try {
      const res = await jsonRequest(app.server, "/judge/planillas", authHeaders(token), { nightId: NIGHT_A_ID }, "POST");
      // create-planilla no aplica la ventana (el borrador vacío no es una
      // escritura de votos): debe crearse aunque la ventana esté cerrada.
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ created: true });
      expect(store.planillas).toHaveLength(1);
    } finally {
      await app.close();
    }
  });
});

describe("Voting Flow HTTP: upsert de voto", () => {
  it("PUT voto: crea el voto (200) con scoreSource JUDGE y versión de configuración", async () => {
    const store = makeStore();
    const token = seedSession(store, JUDGE_ID);
    seedPlanilla(store);
    const app = await startApp(store);
    try {
      const res = await jsonRequest(
        app.server,
        `/judge/planillas/${PLANILLA_ID}/votes/${VOTE_ID}`,
        authHeaders(token),
        validVotePayload({ deviceContext: { deviceId: "dev-1", sessionId: SESSION_ID } }),
        "PUT",
      );
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: VOTE_ID,
        planillaId: PLANILLA_ID,
        judgeId: JUDGE_ID,
        nightId: NIGHT_A_ID,
        score: 8.5,
        scoreSource: "JUDGE",
        idempotencyKey: "key-1",
        versionId: CONFIG_ID,
        syncState: "PENDING",
        deviceContext: { deviceId: "dev-1", sessionId: SESSION_ID },
      });
      expect(store.votes).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it("PUT voto: actualiza el voto existente para el mismo voteId (sin duplicar)", async () => {
    const store = makeStore();
    const token = seedSession(store, JUDGE_ID);
    seedPlanilla(store);
    seedVote(store, { id: VOTE_ID, idempotency_key: "key-1" });
    const app = await startApp(store);
    try {
      const res = await jsonRequest(
        app.server,
        `/judge/planillas/${PLANILLA_ID}/votes/${VOTE_ID}`,
        authHeaders(token),
        validVotePayload({ score: 6.0 }),
        "PUT",
      );
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: VOTE_ID, score: 6.0 });
      expect(store.votes).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it("PUT voto: idempotencia por idempotencyKey reintegra el voto existente", async () => {
    const store = makeStore();
    const token = seedSession(store, JUDGE_ID);
    seedPlanilla(store);
    seedVote(store, { id: VOTE_ID, idempotency_key: "key-1" });
    const app = await startApp(store);
    try {
      const res = await jsonRequest(
        app.server,
        `/judge/planillas/${PLANILLA_ID}/votes/${VOTE2_ID}`,
        authHeaders(token),
        validVotePayload(),
        "PUT",
      );
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: VOTE_ID });
      expect(store.votes).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it("PUT voto: 409 IDEMPOTENCY_CONFLICT si el idempotencyKey se reutiliza con otro payload", async () => {
    const store = makeStore();
    const token = seedSession(store, JUDGE_ID);
    seedPlanilla(store);
    const app = await startApp(store);
    try {
      await jsonRequest(
        app.server,
        `/judge/planillas/${PLANILLA_ID}/votes/${VOTE_ID}`,
        authHeaders(token),
        validVotePayload(),
        "PUT",
      );
      const conflict = await jsonRequest(
        app.server,
        `/judge/planillas/${PLANILLA_ID}/votes/${VOTE2_ID}`,
        authHeaders(token),
        validVotePayload({ comparsaId: OTHER_COMPARSA_ID }),
        "PUT",
      );
      expect(conflict.status).toBe(409);
      expect(conflict.body).toMatchObject({ error: { code: "IDEMPOTENCY_CONFLICT" } });
      expect(store.votes).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it("PUT voto: deduplica por client_ref si id/idempotency/business key difieren", async () => {
    const store = makeStore();
    const token = seedSession(store, JUDGE_ID);
    seedPlanilla(store);
    seedVote(store, { id: VOTE_ID, client_ref: "client-ref-1", idempotency_key: "other-key" });
    const app = await startApp(store);
    try {
      const res = await jsonRequest(
        app.server,
        `/judge/planillas/${PLANILLA_ID}/votes/${VOTE2_ID}`,
        authHeaders(token),
        validVotePayload({ idempotencyKey: "key-1", comparsaId: OTHER_COMPARSA_ID }),
        "PUT",
      );
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: VOTE_ID });
      expect(store.votes).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it("PUT voto: 409 VOTE_CONFIRMED_IMMUTABLE para un voto confirmado", async () => {
    const store = makeStore();
    const token = seedSession(store, JUDGE_ID);
    seedPlanilla(store);
    seedVote(store, { id: VOTE_ID, idempotency_key: "other-key", confirmed_at: new Date().toISOString() });
    const app = await startApp(store);
    try {
      const res = await jsonRequest(
        app.server,
        `/judge/planillas/${PLANILLA_ID}/votes/${VOTE2_ID}`,
        authHeaders(token),
        validVotePayload(),
        "PUT",
      );
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ error: { code: "VOTE_CONFIRMED_IMMUTABLE" } });
    } finally {
      await app.close();
    }
  });

  it("PUT voto: 409 PLANILLA_NOT_EDITABLE sobre una planilla confirmada", async () => {
    const store = makeStore();
    const token = seedSession(store, JUDGE_ID);
    seedPlanilla(store, { status: "CONFIRMADA", confirmed_at: new Date().toISOString() });
    const app = await startApp(store);
    try {
      const res = await jsonRequest(
        app.server,
        `/judge/planillas/${PLANILLA_ID}/votes/${VOTE_ID}`,
        authHeaders(token),
        validVotePayload(),
        "PUT",
      );
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ error: { code: "PLANILLA_NOT_EDITABLE" } });
    } finally {
      await app.close();
    }
  });

  it("PUT voto: 404 para una planilla de otro juez", async () => {
    const store = makeStore();
    const token = seedSession(store, JUDGE_ID);
    seedPlanilla(store, { id: OTHER_PLANILLA_ID, judge_id: OTHER_JUDGE_ID });
    const app = await startApp(store);
    try {
      const res = await jsonRequest(
        app.server,
        `/judge/planillas/${OTHER_PLANILLA_ID}/votes/${VOTE_ID}`,
        authHeaders(token),
        validVotePayload(),
        "PUT",
      );
      expect(res.status).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("PUT voto: 403 sin asignación efectiva en la noche de la planilla", async () => {
    const store = makeStore();
    const token = seedSession(store, JUDGE_ID);
    seedPlanilla(store, { night_id: NIGHT_B_ID });
    const app = await startApp(store);
    try {
      const res = await jsonRequest(
        app.server,
        `/judge/planillas/${PLANILLA_ID}/votes/${VOTE_ID}`,
        authHeaders(token),
        validVotePayload(),
        "PUT",
      );
      expect(res.status).toBe(403);
    } finally {
      await app.close();
    }
  });

  it("PUT voto: 400 por score inválido (más de un decimal)", async () => {
    const store = makeStore();
    const token = seedSession(store, JUDGE_ID);
    seedPlanilla(store);
    const app = await startApp(store);
    try {
      const res = await jsonRequest(
        app.server,
        `/judge/planillas/${PLANILLA_ID}/votes/${VOTE_ID}`,
        authHeaders(token),
        validVotePayload({ score: 8.55 }),
        "PUT",
      );
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
      expect(store.votes).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it("PUT voto: 400 por campos requeridos faltantes del payload", async () => {
    const store = makeStore();
    const token = seedSession(store, JUDGE_ID);
    seedPlanilla(store);
    const app = await startApp(store);
    try {
      const payload = validVotePayload();
      delete (payload as Partial<VoteUpsertPayload>).itemId;
      const res = await jsonRequest(
        app.server,
        `/judge/planillas/${PLANILLA_ID}/votes/${VOTE_ID}`,
        authHeaders(token),
        payload,
        "PUT",
      );
      expect(res.status).toBe(400);
    } finally {
      await app.close();
    }
  });

  it("PUT voto: 400 por body no-objeto", async () => {
    const store = makeStore();
    const token = seedSession(store, JUDGE_ID);
    seedPlanilla(store);
    const app = await startApp(store);
    try {
      const res = await jsonRequest(
        app.server,
        `/judge/planillas/${PLANILLA_ID}/votes/${VOTE_ID}`,
        authHeaders(token),
        null,
        "PUT",
      );
      expect(res.status).toBe(400);
    } finally {
      await app.close();
    }
  });

  it("PUT voto: nombre de clave desconocida en el payload no rompe la validación de claves reales", async () => {
    const store = makeStore();
    const token = seedSession(store, JUDGE_ID);
    seedPlanilla(store);
    const app = await startApp(store);
    try {
      const res = await jsonRequest(
        app.server,
        `/judge/planillas/${PLANILLA_ID}/votes/${VOTE_ID}`,
        authHeaders(token),
        { ...validVotePayload(), extra: "ignored" },
        "PUT",
      );
      expect(res.status).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("PUT voto: 409 NIGHT_WINDOW_CLOSED con la ventana de la noche cerrada (endsAt pasado)", async () => {
    const store = makeStore();
    const token = seedSession(store, JUDGE_ID);
    const night = store.nights.find((n) => n.id === NIGHT_A_ID)!;
    night.starts_at = "2000-01-01T00:00:00.000Z";
    night.ends_at = "2001-01-01T00:00:00.000Z";
    seedPlanilla(store);
    const app = await startApp(store);
    try {
      const res = await jsonRequest(
        app.server,
        `/judge/planillas/${PLANILLA_ID}/votes/${VOTE_ID}`,
        authHeaders(token),
        validVotePayload(),
        "PUT",
      );
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ error: { code: "NIGHT_WINDOW_CLOSED" } });
      expect(store.votes).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it("PUT voto: 409 NIGHT_WINDOW_CLOSED con la ventana aún no abierta (startsAt futuro)", async () => {
    const store = makeStore();
    const token = seedSession(store, JUDGE_ID);
    const night = store.nights.find((n) => n.id === NIGHT_A_ID)!;
    night.starts_at = "2999-01-01T00:00:00.000Z";
    night.ends_at = "2999-02-01T00:00:00.000Z";
    seedPlanilla(store);
    const app = await startApp(store);
    try {
      const res = await jsonRequest(
        app.server,
        `/judge/planillas/${PLANILLA_ID}/votes/${VOTE_ID}`,
        authHeaders(token),
        validVotePayload(),
        "PUT",
      );
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ error: { code: "NIGHT_WINDOW_CLOSED" } });
      expect(store.votes).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it("PUT voto: 200 sin ventana (startsAt/endsAt null — PEND-110) — regresión sin bloqueo", async () => {
    const store = makeStore();
    const token = seedSession(store, JUDGE_ID);
    seedPlanilla(store);
    const app = await startApp(store);
    try {
      const res = await jsonRequest(
        app.server,
        `/judge/planillas/${PLANILLA_ID}/votes/${VOTE_ID}`,
        authHeaders(token),
        validVotePayload(),
        "PUT",
      );
      expect(res.status).toBe(200);
      expect(store.votes).toHaveLength(1);
    } finally {
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// HTTP: confirmación de planilla
// ---------------------------------------------------------------------------

describe("Voting Flow HTTP: confirmación de planilla", () => {
  it("POST confirm: confirma votos y planilla (200), audita VOTE_CONFIRMED + PLANILLA_MODIFIED", async () => {
    const store = makeStore();
    const token = seedSession(store, JUDGE_ID);
    seedPlanilla(store);
    seedVote(store);
    const app = await startApp(store);

    try {
      const res = await jsonRequest(
        app.server,
        `/judge/planillas/${PLANILLA_ID}/confirm`,
        authHeaders(token),
        undefined,
        "POST",
      );

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ votesConfirmed: 1, omissionsInserted: 0 });
      expect(res.body).toMatchObject({
        planilla: { id: PLANILLA_ID, status: "CONFIRMADA" },
      });
      const body = res.body as { planilla: { confirmedAt?: string } };
      expect(body.planilla.confirmedAt).toBeDefined();

      const stored = store.planillas.find((p) => p.id === PLANILLA_ID);
      expect(stored?.status).toBe("CONFIRMADA");
      expect(stored?.confirmed_at).not.toBeNull();

      const storedVote = store.votes.find((v) => v.id === VOTE_ID);
      expect(storedVote?.confirmed_at).not.toBeNull();

      const types = store.audits.map((a) => a.event_type);
      expect(types).toContain("VOTE_CONFIRMED");
      expect(types).toContain("PLANILLA_MODIFIED");
    } finally {
      await app.close();
    }
  });

  it("POST confirm: inserta omisiones (5 / OMISSION_CORRECTION) y audita", async () => {
    const store = makeStore();
    const token = seedSession(store, JUDGE_ID);
    seedPlanilla(store);
    const app = await startApp(store);

    try {
      const res = await jsonRequest(
        app.server,
        `/judge/planillas/${PLANILLA_ID}/confirm`,
        authHeaders(token),
        undefined,
        "POST",
      );

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ votesConfirmed: 0, omissionsInserted: 1 });

      const storedVote = store.votes.find((v) => v.planilla_id === PLANILLA_ID);
      expect(storedVote).toMatchObject({
        candidate_id: CANDIDATE_ID,
        score: 5,
        score_source: "OMISSION_CORRECTION",
      });
      expect(storedVote?.confirmed_at).not.toBeNull();

      expect(store.audits.map((a) => a.event_type)).toContain("OMISSION_CORRECTED");
    } finally {
      await app.close();
    }
  });

  it("POST confirm: es idempotente (200) y no audita dos veces el mismo reintento", async () => {
    const store = makeStore();
    const token = seedSession(store, JUDGE_ID);
    seedPlanilla(store);
    seedVote(store);
    const app = await startApp(store);

    try {
      const first = await jsonRequest(
        app.server,
        `/judge/planillas/${PLANILLA_ID}/confirm`,
        authHeaders(token),
        undefined,
        "POST",
      );
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({ votesConfirmed: 1, omissionsInserted: 0 });

      const auditsAfterFirst = store.audits.length;

      const second = await jsonRequest(
        app.server,
        `/judge/planillas/${PLANILLA_ID}/confirm`,
        authHeaders(token),
        undefined,
        "POST",
      );
      expect(second.status).toBe(200);
      expect(second.body).toMatchObject({ votesConfirmed: 0, omissionsInserted: 0 });
      expect(second.body).toMatchObject({ planilla: { status: "CONFIRMADA" } });
      expect(store.audits).toHaveLength(auditsAfterFirst);
    } finally {
      await app.close();
    }
  });

  it("POST confirm: 404 para la planilla de otro juez", async () => {
    const store = makeStore();
    const token = seedSession(store, JUDGE_ID);
    seedPlanilla(store, { judge_id: OTHER_JUDGE_ID });
    const app = await startApp(store);

    try {
      const res = await jsonRequest(
        app.server,
        `/judge/planillas/${PLANILLA_ID}/confirm`,
        authHeaders(token),
        undefined,
        "POST",
      );
      expect(res.status).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("POST confirm: 409 PLANILLA_NOT_EDITABLE sobre una planilla terminal", async () => {
    const store = makeStore();
    const token = seedSession(store, JUDGE_ID);
    seedPlanilla(store, { status: "CERRADA", confirmed_at: null });
    const app = await startApp(store);

    try {
      const res = await jsonRequest(
        app.server,
        `/judge/planillas/${PLANILLA_ID}/confirm`,
        authHeaders(token),
        undefined,
        "POST",
      );
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ error: { code: "PLANILLA_NOT_EDITABLE" } });
    } finally {
      await app.close();
    }
  });

  it("POST confirm: 403 si el juez perdió la asignación efectiva de la noche", async () => {
    const store = makeStore();
    const token = seedSession(store, JUDGE_ID);
    seedPlanilla(store);
    store.assignments = [];
    const app = await startApp(store);

    try {
      const res = await jsonRequest(
        app.server,
        `/judge/planillas/${PLANILLA_ID}/confirm`,
        authHeaders(token),
        undefined,
        "POST",
      );
      expect(res.status).toBe(403);
    } finally {
      await app.close();
    }
  });

  it("POST confirm: 401 sin token", async () => {
    const store = makeStore();
    seedPlanilla(store);
    const app = await startApp(store);

    try {
      const res = await jsonRequest(app.server, `/judge/planillas/${PLANILLA_ID}/confirm`, undefined, "POST");
      expect(res.status).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("POST confirm: 400 por planillaId inválido", async () => {
    const store = makeStore();
    const token = seedSession(store, JUDGE_ID);
    const app = await startApp(store);

    try {
      const res = await jsonRequest(app.server, "/judge/planillas/not-a-uuid/confirm", authHeaders(token), undefined, "POST");
      expect(res.status).toBe(400);
    } finally {
      await app.close();
    }
  });

  it("POST confirm: devuelve rubroTotals correctos tras subsanación (SVC2-64), ordenados por rubroId", async () => {
    const store = makeStore();
    const token = seedSession(store, JUDGE_ID);
    // Planilla con votos en 2 rubros: Baile 8.5 y Vestuario 7.0. Ambos
    // candidatos ya votados → sin omisiones; el total por rubro replica el
    // valor exacto persistido, ordenado por rubroId.
    seedPlanilla(store);
    seedVote(store, { id: VOTE_ID, rubro_id: RUBRO_ID, item_id: ITEM_ID, candidate_id: CANDIDATE_ID, score: 8.5 });
    seedVote(store, { id: VOTE2_ID, rubro_id: VESTUARIO_RUBRO_ID, item_id: VESTUARIO_ITEM_ID, candidate_id: VESTUARIO_CANDIDATE_ID, score: 7.0 });
    const app = await startApp(store);

    try {
      const res = await jsonRequest(
        app.server,
        `/judge/planillas/${PLANILLA_ID}/confirm`,
        authHeaders(token),
        undefined,
        "POST",
      );
      expect(res.status).toBe(200);
      const body = res.body as { votesConfirmed: number; omissionsInserted: number; rubroTotals: Array<{ rubroId: string; total: number }> };
      expect(body.votesConfirmed).toBe(2);
      expect(body.omissionsInserted).toBe(0);
      // Orden determinista por rubroId: "55555555..." < "65555555...".
      expect(body.rubroTotals).toEqual([
        { rubroId: RUBRO_ID, total: 8.5 },
        { rubroId: VESTUARIO_RUBRO_ID, total: 7.0 },
      ]);
    } finally {
      await app.close();
    }
  });

  it("POST confirm: rubroTotals computa omisión = 5 en el rubro correspondiente del ítem omitido", async () => {
    const store = makeStore();
    const token = seedSession(store, JUDGE_ID);
    // Sólo voto en Vestuario (7.0). El candidato de Baile es elegible (la
    // especialidad del juez es BAILE) y no tiene voto → en la subsanación se
    // inserta con 5 en su rubro. El Vestuario NO es especialidad asignada, no
    // se subsana (sólo se mantiene el voto cargado).
    seedPlanilla(store);
    seedVote(store, { id: VOTE2_ID, rubro_id: VESTUARIO_RUBRO_ID, item_id: VESTUARIO_ITEM_ID, candidate_id: VESTUARIO_CANDIDATE_ID, score: 7.0 });
    const app = await startApp(store);

    try {
      const res = await jsonRequest(
        app.server,
        `/judge/planillas/${PLANILLA_ID}/confirm`,
        authHeaders(token),
        undefined,
        "POST",
      );
      expect(res.status).toBe(200);
      const body = res.body as { votesConfirmed: number; omissionsInserted: number; rubroTotals: Array<{ rubroId: string; total: number }> };
      expect(body.votesConfirmed).toBe(1);
      expect(body.omissionsInserted).toBe(1);
      const omitted = store.votes.find((v) => v.score_source === "OMISSION_CORRECTION");
      expect(omitted).toMatchObject({ rubro_id: RUBRO_ID, score: 5, candidate_id: CANDIDATE_ID });
      expect(body.rubroTotals).toEqual([
        { rubroId: RUBRO_ID, total: 5 },
        { rubroId: VESTUARIO_RUBRO_ID, total: 7.0 },
      ]);
    } finally {
      await app.close();
    }
  });

  it("POST confirm: 409 NIGHT_WINDOW_CLOSED dentro de la transacción cuando la ventana cerró", async () => {
    const store = makeStore();
    const token = seedSession(store, JUDGE_ID);
    const night = store.nights.find((n) => n.id === NIGHT_A_ID)!;
    night.starts_at = "2000-01-01T00:00:00.000Z";
    night.ends_at = "2001-01-01T00:00:00.000Z";
    seedPlanilla(store);
    seedVote(store);
    const app = await startApp(store);

    try {
      const res = await jsonRequest(
        app.server,
        `/judge/planillas/${PLANILLA_ID}/confirm`,
        authHeaders(token),
        undefined,
        "POST",
      );
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ error: { code: "NIGHT_WINDOW_CLOSED" } });
      // Sin mutación: la planilla sigue BORRADOR y el voto sin confirmar.
      const stored = store.planillas.find((p) => p.id === PLANILLA_ID);
      expect(stored?.status).toBe("BORRADOR");
      const vote = store.votes.find((v) => v.id === VOTE_ID);
      expect(vote?.confirmed_at).toBeNull();
    } finally {
      await app.close();
    }
  });

  it("POST confirm: confirma OK con ventana cumplida o sin ventana (regresión)", async () => {
    const store = makeStore();
    const token = seedSession(store, JUDGE_ID);
    const night = store.nights.find((n) => n.id === NIGHT_A_ID)!;
    night.starts_at = "2000-01-01T00:00:00.000Z";
    night.ends_at = "2999-01-01T00:00:00.000Z";
    seedPlanilla(store);
    seedVote(store);
    const app = await startApp(store);
    try {
      const res = await jsonRequest(
        app.server,
        `/judge/planillas/${PLANILLA_ID}/confirm`,
        authHeaders(token),
        undefined,
        "POST",
      );
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ planilla: { status: "CONFIRMADA" } });
      expect(store.planillas.find((p) => p.id === PLANILLA_ID)?.status).toBe("CONFIRMADA");
    } finally {
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Integración del router: la app construida con createApplication (fakes)
// responde a los mismos endpoints vía las rutas reales.
// ---------------------------------------------------------------------------

describe("Voting Flow router integration (fakes en memoria)", () => {
  it("un juez autenticado puede crear planilla y votar usando la aplicación real", async () => {
    const repos = buildFakes();
    // Crear una sesión válida sobre fakes para simular la autenticación.
    // El flujo HTTP queda cubierto por los tests con votingDb; aquí se verifica
    // únicamente que los use-cases quedan expuestos en createApplication.
    const app = createApplication(repos, { sessionTtlHours: 12 });

    const context = await app.judgeContext.execute({ judgeId: JUDGE_ID });
    expect(context.edition.code).toBe(EDITION_CODE);

    const created = await app.createPlanilla.execute({ judgeId: JUDGE_ID, nightId: NIGHT_A_ID });
    expect(created.created).toBe(true);
    const planillaId = created.planilla.id;

    const vote = await app.upsertVote.execute({
      judgeId: JUDGE_ID,
      planillaId,
      voteId: VOTE_ID,
      payload: validVotePayload(),
    });
    expect(vote.planillaId).toBe(planillaId);

    const confirmed = await app.confirmPlanilla.execute({ judgeId: JUDGE_ID, planillaId });
    expect(confirmed.planilla.status).toBe("CONFIRMADA");
    expect(confirmed.votesConfirmed).toBe(1);
    expect(confirmed.omissionsInserted).toBe(0);

    const list = await app.listMyPlanillas.execute({ judgeId: JUDGE_ID });
    expect(list).toHaveLength(1);
  });
});