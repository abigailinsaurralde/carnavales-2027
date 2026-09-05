import { describe, expect, it } from "vitest";
import { makeContext } from "./fixtures.js";
import {
  buildSheet,
  canConfirmPlanilla,
  isEditable,
  syncBadgeForVote,
  toLocalVote,
  voteKey,
  type DisplayVote,
} from "../src/ui/sheet.js";
import type { LocalPlanilla, LocalVote } from "../src/offline/types.js";

const context = makeContext();
const assignment = context.assignments[0]!;

describe("voteKey", () => {
  it("compone una clave única con las claves de negocio", () => {
    const key = voteKey({
      comparsaId: "cmp-1",
      rubroId: "r-baile",
      itemId: "i-1",
      candidateId: "can-1-1",
    });
    expect(key).toBe("cmp-1\u0001r-baile\u0001i-1\u0001can-1-1");
  });
});

describe("eligibleCandidatesFor / buildSheet", () => {
  it("elige los candidatos de los ítems de la especialidad asignada", () => {
    const sheet = buildSheet(context, assignment, [], []);
    // 2 comparsas × 2 ítems de Baile = 4 candidatos; el ítem de Batería no entra.
    expect(sheet.eligibleCandidates).toHaveLength(4);
    expect(sheet.items.map((i) => i.id)).toEqual(["i-1", "i-2"]);
  });

  it("arma una fila por comparsa con una celda por ítem elegible", () => {
    const sheet = buildSheet(context, assignment, [], []);
    expect(sheet.rows).toHaveLength(2);
    for (const row of sheet.rows) {
      expect(row.cells).toHaveLength(2);
      expect(row.cells.every((c) => c !== null)).toBe(true);
      expect(row.cells[0]!.candidateId).not.toBeNull();
    }
    expect(sheet.rows[0]!.cells[0]!.candidateId).toBe("can-1-1");
  });

  it("inicia sin notas: scoredCount 0 y omissionsCount = candidatos elegibles", () => {
    const sheet = buildSheet(context, assignment, [], []);
    expect(sheet.scoredCount).toBe(0);
    expect(sheet.omissionsCount).toBe(4);
    expect(sheet.rubroByItem.get("i-1")).toBe("r-baile");
  });

  it("la copia local pendiente gana sobre el voto del servidor en la misma celda", () => {
    const serverVotes = [
      makeServerVote("can-1-1", "cmp-1", "r-baile", "i-1", 7),
    ];
    const localVotes: LocalVote[] = [
      makeLocalVote("can-1-1", "cmp-1", "r-baile", "i-1", 9, "PENDING"),
    ];
    const sheet = buildSheet(context, assignment, serverVotes, localVotes);

    const cell = sheet.rows[0]!.cells[0]!;
    expect(cell.vote?.score).toBe(9);
    expect(cell.vote?.syncState).toBe("PENDING");
    expect(cell.vote?.fromLocal).toBe(true);
    expect(sheet.scoredCount).toBe(1);
    expect(sheet.omissionsCount).toBe(3);
  });

  it("refleja el voto del servidor cuando no hay copia local", () => {
    const serverVotes = [makeServerVote("can-1-1", "cmp-1", "r-baile", "i-1", 7)];
    const sheet = buildSheet(context, assignment, serverVotes, []);
    const cell = sheet.rows[0]!.cells[0]!;
    expect(cell.vote?.score).toBe(7);
    expect(cell.vote?.fromLocal).toBe(false);
  });
});

describe("rubroTotals (FASE B) — totales informativos por rubro", () => {
  it("suma los puntajes cargados por rubro y cuenta los pendientes", () => {
    const serverVotes = [
      makeServerVote("can-1-1", "cmp-1", "r-baile", "i-1", 7),
      makeServerVote("can-2-1", "cmp-2", "r-baile", "i-1", 3),
    ];
    const sheet = buildSheet(context, assignment, serverVotes, []);

    // Un único rubro de la especialidad (r-baile); 4 candidatos elegibles en
    // 2 ítems × 2 comparsas. Los 2 votos suman 10 → total=10, pending=2.
    expect(sheet.rubroTotals).toHaveLength(1);
    expect(sheet.rubroTotals[0]).toMatchObject({
      rubroId: "r-baile",
      rubroName: "Baile",
      total: 10,
      pending: 2,
    });
  });

  it("sin notas: total 0 y todos los ítems pendientes", () => {
    const sheet = buildSheet(context, assignment, [], []);
    expect(sheet.rubroTotals[0]).toMatchObject({
      rubroId: "r-baile",
      total: 0,
      pending: 4,
    });
  });

  it("NO imputa omisiones: un ítem sin nota queda como pending y NO suma 5", () => {
    // Sólo una nota cargada (7). El resto de los ítems queda sin nota y debe
    // permanecer como pending (sin imputar 5). El total informativo refleja
    // únicamente la suma de notas cargadas del jurado.
    const serverVotes = [makeServerVote("can-1-1", "cmp-1", "r-baile", "i-1", 7)];
    const sheet = buildSheet(context, assignment, serverVotes, []);
    expect(sheet.rubroTotals[0]).toMatchObject({
      rubroId: "r-baile",
      total: 7,
      pending: 3,
    });
    // El total NO debe incluir imputación de omisiones (no suma 5 por pendiente).
    expect(sheet.rubroTotals[0]!.total).toBe(7);
  });
});

describe("toLocalVote", () => {
  it("convierte una nota de presentación a copia local pendiente", () => {
    const planilla: LocalPlanilla = {
      id: "p-1",
      nightId: "n-1",
      clientRef: "planilla-p-1",
      status: "BORRADOR",
      updatedAt: "2027-01-01T00:00:00.000Z",
    };
    const display: DisplayVote = {
      id: "v-1",
      comparsaId: "cmp-1",
      rubroId: "r-baile",
      itemId: "i-1",
      candidateId: "can-1-1",
      score: 8,
      syncState: "SYNCED",
      fromLocal: true,
    };
    const local = toLocalVote(planilla, display, "key-1", "2027-01-01T01:00:00.000Z");
    expect(local).toMatchObject({
      id: "v-1",
      planillaId: "p-1",
      nightId: "n-1",
      candidateId: "can-1-1",
      score: 8,
      idempotencyKey: "key-1",
      syncState: "PENDING",
    });
  });
});

describe("isEditable / canConfirmPlanilla", () => {
  it("solo considera editables BORRADOR y EN_EVALUACION", () => {
    expect(isEditable("BORRADOR")).toBe(true);
    expect(isEditable("EN_EVALUACION")).toBe(true);
    expect(isEditable("CONFIRMADA")).toBe(false);
    expect(isEditable("SINCRONIZADA")).toBe(false);
    expect(isEditable("CERRADA")).toBe(false);
  });

  it("permite confirmar cuando todo está sincronizado", () => {
    expect(
      canConfirmPlanilla({
        planillaStatus: "BORRADOR",
        online: true,
        hasPendingSync: false,
        confirmedAlready: false,
      }),
    ).toBe(true);
  });

  it("bloquea si la planilla ya está confirmada", () => {
    expect(
      canConfirmPlanilla({
        planillaStatus: "CONFIRMADA",
        online: true,
        hasPendingSync: false,
        confirmedAlready: true,
      }),
    ).toBe(false);
  });

  it("bloquea si el dispositivo está offline", () => {
    expect(
      canConfirmPlanilla({
        planillaStatus: "BORRADOR",
        online: false,
        hasPendingSync: false,
        confirmedAlready: false,
      }),
    ).toBe(false);
  });

  it("bloquea mientras haya notas por sincronizar", () => {
    expect(
      canConfirmPlanilla({
        planillaStatus: "BORRADOR",
        online: true,
        hasPendingSync: true,
        confirmedAlready: false,
      }),
    ).toBe(false);
  });

  it("bloquea cuando la planilla no es editable", () => {
    expect(
      canConfirmPlanilla({
        planillaStatus: "CERRADA",
        online: true,
        hasPendingSync: false,
        confirmedAlready: false,
      }),
    ).toBe(false);
  });
});

describe("syncBadgeForVote", () => {
  it("mapea cada estado a una etiqueta y tono", () => {
    const vote = (syncState: DisplayVote["syncState"]): DisplayVote => ({
      id: "v",
      comparsaId: "cmp-1",
      rubroId: "r-baile",
      itemId: "i-1",
      candidateId: "can-1-1",
      score: 5,
      syncState,
      fromLocal: true,
    });
    expect(syncBadgeForVote(vote("PENDING")).tone).toBe("pending");
    expect(syncBadgeForVote(vote("SYNCING")).tone).toBe("syncing");
    expect(syncBadgeForVote(vote("FAILED")).tone).toBe("error");
    expect(syncBadgeForVote(vote("SYNCED")).tone).toBe("ok");
  });
});

// ---- Helpers de fixture ----

function makeServerVote(
  candidateId: string,
  comparsaId: string,
  rubroId: string,
  itemId: string,
  score: number,
): Parameters<typeof buildSheet>[2][number] {
  return {
    id: `sv-${candidateId}`,
    planillaId: "p-1",
    judgeId: "juez-1",
    nightId: "n-1",
    comparsaId,
    rubroId,
    itemId,
    candidateId,
    score,
    scoreSource: "JUDGE",
    idempotencyKey: `skey-${candidateId}`,
    syncState: "SYNCED",
  };
}

function makeLocalVote(
  candidateId: string,
  comparsaId: string,
  rubroId: string,
  itemId: string,
  score: number,
  syncState: LocalVote["syncState"],
): LocalVote {
  return {
    id: `lv-${candidateId}`,
    planillaId: "p-1",
    nightId: "n-1",
    comparsaId,
    rubroId,
    itemId,
    candidateId,
    score,
    idempotencyKey: `lkey-${candidateId}`,
    syncState,
    updatedAt: "2027-01-01T00:00:00.000Z",
  };
}