import { describe, expect, it } from "vitest";
import type {
  AdminCatalogCounts,
  Candidate,
  CarnavalEdition,
  Comparsa,
  JudgeAssignmentView,
  Night,
  Rubro,
  RubroItem,
  Specialty,
} from "@votaciones2027/shared-types";
import type { AdminAssignmentRepository } from "../src/domain/repositories/admin-assignment-repository.js";
import type { AdminCatalogueRepository, SpecialtyRecord } from "../src/domain/repositories/admin-catalogue-repository.js";
import type { AdminNightRepository, NightPatch } from "../src/domain/repositories/admin-night-repository.js";
import type { AdminUserRepository } from "../src/domain/repositories/admin-user-repository.js";
import { ConflictError, NotFoundError } from "../src/errors/app-error.js";
import type { EditionRepository } from "../src/domain/repositories/edition-repository.js";
import type { NightRepository } from "../src/domain/repositories/night-repository.js";
import type { UserAccount } from "../src/domain/entities/user.js";
import type { AuditRepository, CreateAuditEventInput } from "../src/domain/repositories/audit-repository.js";
import type { AuditEvent } from "@votaciones2027/shared-types";
import { AdminGetContext } from "../src/application/use-cases/admin/admin-get-context.js";
import { CreateComparsa } from "../src/application/use-cases/admin/admin-comparsa.js";
import { UpdateComparsa } from "../src/application/use-cases/admin/admin-update-comparsa.js";
import { UpsertRubro } from "../src/application/use-cases/admin/admin-rubro.js";
import { UpsertRubroItem } from "../src/application/use-cases/admin/admin-rubro-item.js";
import { UpsertCandidate } from "../src/application/use-cases/admin/admin-candidate.js";
import { UpdateNight } from "../src/application/use-cases/admin/admin-night.js";
import { UpsertAssignment } from "../src/application/use-cases/admin/admin-assignment.js";
import {
  AdminListAssignments,
  AdminListCandidates,
  AdminListComparsas,
  AdminListRubroItems,
  AdminListRubros,
} from "../src/application/use-cases/admin/admin-catalog-lists.js";

const EDITION_ID = "e2e00001-0000-4000-8000-000000000001";
const ADMIN_ID = "e2e00002-0000-4000-8000-000000000002";
const JUDGE_ID = "e2e00002-0000-4000-8000-000000000001";
const NIGHT1_ID = "e2e00001-0000-4000-8000-000000000005";
const NIGHT2_ID = "e2e00001-0000-4000-8000-000000000006";
const SPECIALTY_ID = "e2e00001-0000-4000-8000-000000000002";
const RUBRO_ID = "e2e00001-0000-4000-8000-000000000010";
const ITEM_ID = "e2e00001-0000-4000-8000-000000000011";
const COMPARSA_ID = "e2e00001-0000-4000-8000-000000000009";

const EDITION: CarnavalEdition = {
  id: EDITION_ID,
  code: "2027",
  name: "Carnavales Goya 2027",
  votingNights: 3,
};

const NIGHTS: Night[] = [
  { id: NIGHT1_ID, editionId: EDITION_ID, number: 1, date: "2027-01-15", status: "ABIERTA" },
  { id: NIGHT2_ID, editionId: EDITION_ID, number: 2, date: "2027-01-22", status: "ABIERTA" },
];

const SPECIALTIES: SpecialtyRecord[] = [{ id: SPECIALTY_ID, code: "BAILE", order: 1 }];

const ADMINS: UserAccount[] = [
  { id: ADMIN_ID, email: "admin@goya2027.test", displayName: "Admin", role: "ADMIN" },
];

const JUDGES: UserAccount[] = [
  { id: JUDGE_ID, email: "juez@goya2027.test", displayName: "Juez", role: "JUDGE" },
];

class FakeEditionRepository implements EditionRepository {
  constructor(private readonly edition: CarnavalEdition | null) {}

  async findById(id: string): Promise<CarnavalEdition | null> {
    return this.edition !== null && this.edition.id === id ? this.edition : null;
  }

  async findByCode(code: string): Promise<CarnavalEdition | null> {
    return this.edition !== null && this.edition.code === code ? this.edition : null;
  }
}

class FakeAuditRepository implements AuditRepository {
  readonly events: CreateAuditEventInput[] = [];
  async create(input: CreateAuditEventInput): Promise<AuditEvent> {
    this.events.push(input);
    return {
      id: `audit-${this.events.length}`,
      eventType: input.eventType,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      ...(input.actorUserId === undefined ? {} : { actorUserId: input.actorUserId }),
      occurredAt: new Date().toISOString(),
      payload: input.payload,
    };
  }
}

class FakeCatalogueRepository implements AdminCatalogueRepository {
  comparsas: Comparsa[] = [];
  rubros: Rubro[] = [];
  items: RubroItem[] = [];
  candidates: Candidate[] = [];
  private readonly baseSpecialties = SPECIALTIES;

  async listComparsas(): Promise<Comparsa[]> {
    return this.comparsas;
  }
  async listRubros(): Promise<Rubro[]> {
    return this.rubros;
  }
  async listItemsByRubro(rubroId: string): Promise<RubroItem[]> {
    return this.items.filter((i) => i.rubroId === rubroId);
  }
  async listCandidates(): Promise<Candidate[]> {
    return this.candidates;
  }
  async catalogCounts(): Promise<AdminCatalogCounts> {
    return {
      comparsas: this.comparsas.length,
      rubros: this.rubros.length,
      items: this.items.length,
      candidates: this.candidates.length,
      assignments: 0,
    };
  }
  async listSpecialties(): Promise<SpecialtyRecord[]> {
    return this.baseSpecialties;
  }
  async findSpecialtyByCode(code: Specialty): Promise<SpecialtyRecord | null> {
    return this.baseSpecialties.find((s) => s.code === code) ?? null;
  }
  async findSpecialtyById(id: string): Promise<SpecialtyRecord | null> {
    return this.baseSpecialties.find((s) => s.id === id) ?? null;
  }
  async createComparsa(editionId: string, input: { code: string; name: string }): Promise<Comparsa> {
    if (this.comparsas.some((c) => c.code === input.code)) {
      throw new ConflictError(
        "A comparsa with this code already exists in the edition",
        "COMPARSA_CODE_CONFLICT",
      );
    }
    const comparsa: Comparsa = { id: COMPARSA_ID, editionId, code: input.code, name: input.name };
    this.comparsas.push(comparsa);
    return comparsa;
  }
  async updateComparsa(id: string, input: { code: string; name: string }): Promise<Comparsa | null> {
    const idx = this.comparsas.findIndex((c) => c.id === id);
    if (idx === -1) return null;
    if (this.comparsas.some((c) => c.id !== id && c.code === input.code)) {
      throw new ConflictError(
        "A comparsa with this code already exists in the edition",
        "COMPARSA_CODE_CONFLICT",
      );
    }
    const updated: Comparsa = { ...this.comparsas[idx], ...input };
    this.comparsas[idx] = updated;
    return updated;
  }
  async createRubro(
    editionId: string,
    input: { specialtyId: string; name: string; type: Rubro["type"] },
  ): Promise<Rubro> {
    const specialty = this.baseSpecialties.find((s) => s.id === input.specialtyId);
    const rubro: Rubro = {
      id: RUBRO_ID,
      editionId,
      specialty: (specialty?.code ?? "BAILE") as Specialty,
      name: input.name,
      type: input.type,
    };
    this.rubros.push(rubro);
    return rubro;
  }
  async updateRubro(
    id: string,
    input: { specialtyId: string; name: string; type: Rubro["type"] },
  ): Promise<Rubro | null> {
    const idx = this.rubros.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    const specialty = this.baseSpecialties.find((s) => s.id === input.specialtyId);
    this.rubros[idx] = {
      ...this.rubros[idx],
      specialty: (specialty?.code ?? "BAILE") as Specialty,
      name: input.name,
      type: input.type,
    };
    return this.rubros[idx];
  }
  async createItem(input: { rubroId: string; name: string; orderIndex: number }): Promise<RubroItem> {
    const item: RubroItem = { id: ITEM_ID, rubroId: input.rubroId, name: input.name, orderIndex: input.orderIndex };
    this.items.push(item);
    return item;
  }
  async updateItem(id: string, input: { name: string; orderIndex: number }): Promise<RubroItem | null> {
    const idx = this.items.findIndex((i) => i.id === id);
    if (idx === -1) return null;
    this.items[idx] = { ...this.items[idx], name: input.name, orderIndex: input.orderIndex };
    return this.items[idx];
  }
  async createCandidate(input: { itemId: string; comparsaId: string; label: string }): Promise<Candidate> {
    const candidate: Candidate = {
      id: "e2e00001-0000-4000-8000-000000000012",
      itemId: input.itemId,
      comparsaId: input.comparsaId,
      label: input.label,
    };
    this.candidates.push(candidate);
    return candidate;
  }
  async updateCandidate(
    id: string,
    input: { itemId: string; comparsaId: string; label: string },
  ): Promise<Candidate | null> {
    const idx = this.candidates.findIndex((c) => c.id === id);
    if (idx === -1) return null;
    this.candidates[idx] = { ...this.candidates[idx], ...input };
    return this.candidates[idx];
  }
}

class FakeNightRepository implements NightRepository, AdminNightRepository {
  constructor(private nights: Night[]) {}
  async findById(id: string): Promise<Night | null> {
    return this.nights.find((n) => n.id === id) ?? null;
  }
  async findByEdition(editionId: string): Promise<Night[]> {
    return this.nights.filter((n) => n.editionId === editionId);
  }
  async updateNight(id: string, patch: NightPatch): Promise<Night | null> {
    const idx = this.nights.findIndex((n) => n.id === id);
    if (idx === -1) return null;
    const current = this.nights[idx];
    const updated: Night = { ...current };
    if (patch.date !== undefined) {
      if (patch.date === null) delete updated.date;
      else updated.date = patch.date;
    }
    if (patch.startsAt !== undefined) {
      if (patch.startsAt === null) delete updated.startsAt;
      else updated.startsAt = patch.startsAt;
    }
    if (patch.endsAt !== undefined) {
      if (patch.endsAt === null) delete updated.endsAt;
      else updated.endsAt = patch.endsAt;
    }
    this.nights[idx] = updated;
    return updated;
  }
}

class FakeAdminUserRepository implements AdminUserRepository {
  async listByRole(role: "ADMIN" | "JUDGE"): Promise<UserAccount[]> {
    return role === "ADMIN" ? ADMINS : JUDGES;
  }
}

class FakeAssignmentRepository implements AdminAssignmentRepository {
  assignments: JudgeAssignmentView[] = [];
  async listByEdition(): Promise<JudgeAssignmentView[]> {
    return this.assignments;
  }
  async create(input: {
    judgeId: string;
    nightId: string;
    specialtyId: string;
    isEffective: boolean;
  }): Promise<JudgeAssignmentView> {
    if (this.assignments.some((a) => a.judgeId === input.judgeId && a.nightId === input.nightId)) {
      throw new ConflictError("A judge assignment already exists for this combination");
    }
    const assignment: JudgeAssignmentView = {
      id: "assign-1",
      judgeId: input.judgeId,
      nightId: input.nightId,
      specialtyId: input.specialtyId,
      isEffective: input.isEffective,
    };
    this.assignments.push(assignment);
    return assignment;
  }
  async update(id: string, input: { isEffective: boolean }): Promise<JudgeAssignmentView | null> {
    const idx = this.assignments.findIndex((a) => a.id === id);
    if (idx === -1) return null;
    this.assignments[idx] = { ...this.assignments[idx], isEffective: input.isEffective };
    return this.assignments[idx];
  }
}

describe("admin use-cases", () => {
  describe("AdminGetContext", () => {
    it("returns edition, nights, specialties, judges and counts", async () => {
      const catalogue = new FakeCatalogueRepository();
      catalogue.comparsas.push({
        id: COMPARSA_ID,
        editionId: EDITION_ID,
        code: "COMP-1",
        name: "Comparsa 1",
      });
      const useCase = new AdminGetContext(
        new FakeEditionRepository(EDITION),
        new FakeNightRepository(NIGHTS),
        catalogue,
        new FakeAdminUserRepository(),
      );
      const context = await useCase.execute({});
      expect(context.edition.code).toBe("2027");
      expect(context.nights).toHaveLength(2);
      expect(context.specialties).toEqual([{ id: SPECIALTY_ID, code: "BAILE" }]);
      expect(context.judges).toHaveLength(1);
      expect(context.judges[0]?.role).toBe("JUDGE");
      expect(context.counts.comparsas).toBe(1);
    });

    it("throws NotFoundError when the 2027 edition is missing", async () => {
      const useCase = new AdminGetContext(
        new FakeEditionRepository(null),
        new FakeNightRepository(NIGHTS),
        new FakeCatalogueRepository(),
        new FakeAdminUserRepository(),
      );
      await expect(useCase.execute({})).rejects.toThrowError(NotFoundError);
    });
  });

  describe("Comparsas", () => {
    it("creates a comparsa and audits it", async () => {
      const catalogue = new FakeCatalogueRepository();
      const audits = new FakeAuditRepository();
      const useCase = new CreateComparsa(
        new FakeEditionRepository(EDITION),
        catalogue,
        audits,
      );
      const result = await useCase.execute({ code: "COMP-1", name: "Comparsa 1", actorUserId: ADMIN_ID });
      expect(result.created).toBe(true);
      expect(result.item.code).toBe("COMP-1");
      expect(audits.events.at(-1)?.eventType).toBe("ADMIN_ACTION");
      expect(audits.events.at(-1)?.entityType).toBe("COMPARSA");
      expect(audits.events.at(-1)?.actorUserId).toBe(ADMIN_ID);
    });

    it("rejects duplicate comparsa code with ConflictError", async () => {
      const catalogue = new FakeCatalogueRepository();
      const useCase = new CreateComparsa(
        new FakeEditionRepository(EDITION),
        catalogue,
        new FakeAuditRepository(),
      );
      await useCase.execute({ code: "COMP-1", name: "A", actorUserId: ADMIN_ID });
      await expect(useCase.execute({ code: "COMP-1", name: "B", actorUserId: ADMIN_ID })).rejects.toThrowError(
        ConflictError,
      );
    });

    it("updates a comparsa and returns created=false", async () => {
      const catalogue = new FakeCatalogueRepository();
      await catalogue.createComparsa(EDITION_ID, { code: "COMP-1", name: "Original" });
      const useCase = new UpdateComparsa(catalogue, new FakeAuditRepository());
      const result = await useCase.execute({ id: COMPARSA_ID, code: "COMP-1", name: "Renamed", actorUserId: ADMIN_ID });
      expect(result.created).toBe(false);
      expect(result.item.name).toBe("Renamed");
    });

    it("throws NotFoundError when updating an unknown comparsa", async () => {
      const useCase = new UpdateComparsa(new FakeCatalogueRepository(), new FakeAuditRepository());
      await expect(
        useCase.execute({ id: COMPARSA_ID, code: "COMP-1", name: "X", actorUserId: ADMIN_ID }),
      ).rejects.toThrowError(NotFoundError);
    });
  });

  describe("Rubros / items / candidates", () => {
    it("creates a rubro resolving the specialty by code", async () => {
      const catalogue = new FakeCatalogueRepository();
      const audits = new FakeAuditRepository();
      const useCase = new UpsertRubro(new FakeEditionRepository(EDITION), catalogue, audits);
      const result = await useCase.execute({ specialty: "BAILE", name: "Menor de Estilo", type: "NOMINATIVO", actorUserId: ADMIN_ID });
      expect(result.created).toBe(true);
      expect(result.item.specialty).toBe("BAILE");
      expect(audits.events.at(-1)?.entityType).toBe("RUBRO");
      expect(audits.events.at(-1)?.actorUserId).toBe(ADMIN_ID);
    });

    it("rejects an unknown specialty with NotFoundError", async () => {
      const useCase = new UpsertRubro(
        new FakeEditionRepository(EDITION),
        new FakeCatalogueRepository(),
        new FakeAuditRepository(),
      );
      await expect(
        useCase.execute({ specialty: "VESTUARIO", name: "X", type: "NOMINATIVO", actorUserId: ADMIN_ID }),
      ).rejects.toThrowError(NotFoundError);
    });

    it("creates a rubro item only with a rubroId", async () => {
      const catalogue = new FakeCatalogueRepository();
      const useCase = new UpsertRubroItem(catalogue, new FakeAuditRepository());
      const result = await useCase.execute({ rubroId: RUBRO_ID, name: "Item 1", orderIndex: 1, actorUserId: ADMIN_ID });
      expect(result.created).toBe(true);
      expect(result.item.rubroId).toBe(RUBRO_ID);
    });

    it("throws NotFoundError creating an item without rubroId and id", async () => {
      const useCase = new UpsertRubroItem(new FakeCatalogueRepository(), new FakeAuditRepository());
      await expect(useCase.execute({ rubroId: undefined, name: "Item", orderIndex: 1, actorUserId: ADMIN_ID })).rejects.toThrowError(
        NotFoundError,
      );
    });

    it("updates an item", async () => {
      const catalogue = new FakeCatalogueRepository();
      const created = await catalogue.createItem({ rubroId: RUBRO_ID, name: "Item 1", orderIndex: 1 });
      const useCase = new UpsertRubroItem(catalogue, new FakeAuditRepository());
      const result = await useCase.execute({ id: created.id, name: "Item 1B", orderIndex: 2, actorUserId: ADMIN_ID });
      expect(result.created).toBe(false);
      expect(result.item.orderIndex).toBe(2);
    });

    it("creates a candidate", async () => {
      const catalogue = new FakeCatalogueRepository();
      const useCase = new UpsertCandidate(catalogue, new FakeAuditRepository());
      const result = await useCase.execute({
        itemId: ITEM_ID,
        comparsaId: COMPARSA_ID,
        label: "Candidato A",
        actorUserId: ADMIN_ID,
      });
      expect(result.created).toBe(true);
      expect(result.item.label).toBe("Candidato A");
    });
  });

  describe("nights", () => {
    it("patches a night window and audits it", async () => {
      const nights = new FakeNightRepository(NIGHTS.map((n) => ({ ...n })));
      const audits = new FakeAuditRepository();
      const useCase = new UpdateNight(nights, nights, audits);
      const result = await useCase.execute({
        id: NIGHT1_ID,
        date: "2027-01-15",
        startsAt: "2027-01-15T20:00:00.000Z",
        actorUserId: ADMIN_ID,
      });
      expect(result.startsAt).toBe("2027-01-15T20:00:00.000Z");
      expect(audits.events.at(-1)?.entityType).toBe("NIGHT");
      expect(audits.events.at(-1)?.actorUserId).toBe(ADMIN_ID);
    });

    it("clears the window with null", async () => {
      const nights = new FakeNightRepository(NIGHTS.map((n) => ({ ...n })));
      const useCase = new UpdateNight(nights, nights, new FakeAuditRepository());
      const result = await useCase.execute({ id: NIGHT1_ID, startsAt: null, endsAt: null, actorUserId: ADMIN_ID });
      expect(result.startsAt).toBeUndefined();
      expect(result.endsAt).toBeUndefined();
    });

    it("clears a single field with null (contrato del frontend)", async () => {
      const nights = new FakeNightRepository(NIGHTS.map((n) => ({ ...n })));
      const useCase = new UpdateNight(nights, nights, new FakeAuditRepository());
      const result = await useCase.execute({ id: NIGHT1_ID, startsAt: null, actorUserId: ADMIN_ID });
      expect(result.startsAt).toBeUndefined();
      expect(result.endsAt).toBe(NIGHTS[0]?.endsAt);
    });

    it("throws NotFoundError for unknown night", async () => {
      const nights = new FakeNightRepository(NIGHTS);
      const useCase = new UpdateNight(nights, nights, new FakeAuditRepository());
      await expect(
        useCase.execute({ id: "unknown", date: "2027-02-01", actorUserId: ADMIN_ID }),
      ).rejects.toThrowError(NotFoundError);
    });
  });

  describe("assignments", () => {
    it("creates an assignment for an effective judge", async () => {
      const assignments = new FakeAssignmentRepository();
      const useCase = new UpsertAssignment(
        assignments,
        new FakeAdminUserRepository(),
        new FakeNightRepository(NIGHTS),
        new FakeAuditRepository(),
        new FakeCatalogueRepository(),
      );
      const result = await useCase.execute({
        judgeId: JUDGE_ID,
        nightId: NIGHT1_ID,
        specialtyId: SPECIALTY_ID,
        isEffective: true,
        actorUserId: ADMIN_ID,
      });
      expect(result.created).toBe(true);
      expect(result.item.isEffective).toBe(true);
    });

    it("rejects an unknown judge with NotFoundError", async () => {
      const useCase = new UpsertAssignment(
        new FakeAssignmentRepository(),
        new FakeAdminUserRepository(),
        new FakeNightRepository(NIGHTS),
        new FakeAuditRepository(),
        new FakeCatalogueRepository(),
      );
      await expect(
        useCase.execute({
          judgeId: "unknown",
          nightId: NIGHT1_ID,
          specialtyId: SPECIALTY_ID,
          isEffective: true,
          actorUserId: ADMIN_ID,
        }),
      ).rejects.toThrowError(NotFoundError);
    });

    it("rejects an unknown specialty with NotFoundError, without inserting or auditing", async () => {
      const assignments = new FakeAssignmentRepository();
      const audits = new FakeAuditRepository();
      const useCase = new UpsertAssignment(
        assignments,
        new FakeAdminUserRepository(),
        new FakeNightRepository(NIGHTS),
        audits,
        new FakeCatalogueRepository(),
      );
      await expect(
        useCase.execute({
          judgeId: JUDGE_ID,
          nightId: NIGHT1_ID,
          specialtyId: "00000000-0000-4000-8000-000000000000",
          isEffective: true,
          actorUserId: ADMIN_ID,
        }),
      ).rejects.toThrowError(NotFoundError);
      expect(assignments.assignments).toHaveLength(0);
      expect(audits.events).toHaveLength(0);
    });

    it("rejects duplicate assignment with ConflictError", async () => {
      const assignments = new FakeAssignmentRepository();
      const useCase = new UpsertAssignment(
        assignments,
        new FakeAdminUserRepository(),
        new FakeNightRepository(NIGHTS),
        new FakeAuditRepository(),
        new FakeCatalogueRepository(),
      );
      const input = {
        judgeId: JUDGE_ID,
        nightId: NIGHT1_ID,
        specialtyId: SPECIALTY_ID,
        isEffective: true,
        actorUserId: ADMIN_ID,
      };
      await useCase.execute(input);
      await expect(useCase.execute(input)).rejects.toThrowError(ConflictError);
    });

    it("disables an assignment via update", async () => {
      const assignments = new FakeAssignmentRepository();
      const create = new UpsertAssignment(
        assignments,
        new FakeAdminUserRepository(),
        new FakeNightRepository(NIGHTS),
        new FakeAuditRepository(),
        new FakeCatalogueRepository(),
      );
      const created = await create.execute({
        judgeId: JUDGE_ID,
        nightId: NIGHT1_ID,
        specialtyId: SPECIALTY_ID,
        isEffective: true,
        actorUserId: ADMIN_ID,
      });
      const useCase = new UpsertAssignment(
        assignments,
        new FakeAdminUserRepository(),
        new FakeNightRepository(NIGHTS),
        new FakeAuditRepository(),
        new FakeCatalogueRepository(),
      );
      const result = await useCase.execute({
        id: created.item.id,
        judgeId: JUDGE_ID,
        nightId: NIGHT1_ID,
        specialtyId: SPECIALTY_ID,
        isEffective: false,
        actorUserId: ADMIN_ID,
      });
      expect(result.created).toBe(false);
      expect(result.item.isEffective).toBe(false);
    });
  });

  describe("lists", () => {
    it("lists comparsas, rubros, candidates and assignments for the edition", async () => {
      const catalogue = new FakeCatalogueRepository();
      const audits = new FakeAuditRepository();
      await new CreateComparsa(new FakeEditionRepository(EDITION), catalogue, audits).execute({
        code: "COMP-1",
        name: "A",
        actorUserId: ADMIN_ID,
      });
      await new UpsertRubro(new FakeEditionRepository(EDITION), catalogue, audits).execute({
        specialty: "BAILE",
        name: "Menor",
        type: "NOMINATIVO",
        actorUserId: ADMIN_ID,
      });
      await new UpsertCandidate(catalogue, audits).execute({
        itemId: ITEM_ID,
        comparsaId: COMPARSA_ID,
        label: "Cand",
        actorUserId: ADMIN_ID,
      });

      expect(await new AdminListComparsas(new FakeEditionRepository(EDITION), catalogue).execute({})).toHaveLength(1);
      expect(await new AdminListRubros(new FakeEditionRepository(EDITION), catalogue).execute({})).toHaveLength(1);
      expect(await new AdminListRubroItems(catalogue).execute({ rubroId: RUBRO_ID })).toEqual([]);
      expect(await new AdminListCandidates(new FakeEditionRepository(EDITION), catalogue).execute({})).toHaveLength(1);
    });

    it("lists assignments by edition", async () => {
      const assignments = new FakeAssignmentRepository();
      await assignments.create({
        judgeId: JUDGE_ID,
        nightId: NIGHT1_ID,
        specialtyId: SPECIALTY_ID,
        isEffective: true,
      });
      const list = await new AdminListAssignments(new FakeEditionRepository(EDITION), assignments).execute({});
      expect(list).toHaveLength(1);
    });
  });
});

