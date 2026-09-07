import { randomUUID } from "node:crypto";
import type {
  ConfirmPlanillaResult,
  RubroTotal,
  Vote,
} from "@votaciones2027/shared-types";
import { CARNAVAL_2027_RULES } from "@votaciones2027/shared-types";
import { EDITION_CODE_2027 } from "../constants.js";
import { isEditablePlanilla, toSharedPlanilla } from "../../domain/entities/planilla.js";
import type { CatalogueRepository } from "../../domain/repositories/catalogue-repository.js";
import type { ConfigurationRepository } from "../../domain/repositories/configuration-repository.js";
import type { EditionRepository } from "../../domain/repositories/edition-repository.js";
import type { JudgeAssignmentRepository } from "../../domain/repositories/judge-assignment-repository.js";
import type { NightRepository } from "../../domain/repositories/night-repository.js";
import type { UnitOfWork } from "../../domain/repositories/unit-of-work.js";
import {
  ConflictError,
  DatabaseError,
  ForbiddenError,
  NotFoundError,
} from "../../errors/app-error.js";
import { requireUuid } from "../../validation/index.js";
import type { UseCase } from "../types.js";
import { assertNightWindowOpen } from "../services/night-window.js";

export interface ConfirmPlanillaInput {
  judgeId: string;
  planillaId: string;
}

/**
 * SVC2-64: el servidor es autoridad del total por rubro de la planilla.
 * Bookkeeping de valores YA materializados (votos confirmados + omisiones
 * insertadas): agrupa por rubroId, suma scores y ordena de forma determinista
 * por rubroId. NO duplica lógica de scoring-engine (no calcula nada: solo
 * agrega puntajes persistidos).
 */
function computeRubroTotals(votes: Vote[]): RubroTotal[] {
  const totalsByRubro = new Map<string, number>();
  for (const vote of votes) {
    totalsByRubro.set(vote.rubroId, (totalsByRubro.get(vote.rubroId) ?? 0) + vote.score);
  }
  return [...totalsByRubro.entries()]
    .map(([rubroId, total]) => ({ rubroId, total }))
    .sort((a, b) => (a.rubroId < b.rubroId ? -1 : a.rubroId > b.rubroId ? 1 : 0));
}

/**
 * Confirmación OPERATIVA de una planilla (BORRADOR/EN_EVALUACION → CONFIRMADA).
 *
 * Efectos (todos sobre el mismo timestamp confirmedAt):
 * 1. Cada voto no confirmado de la planilla pasa a confirmed_at (inmutable,
 *    §10) y se audita `VOTE_CONFIRMED` (§19 "confirmación de votos").
 * 2. Se SUBSANAN las omisiones (§7, §8): todo candidato de la especialidad
 *    asignada al juez en la noche sin voto en la planilla se inserta con
 *    score = omissionScore y scoreSource = OMISSION_CORRECTION, ya confirmado,
 *    auditado como `OMISSION_CORRECTED`.
 * 3. La planilla pasa a CONFIRMADA con confirmedAt (no regresa jamás a
 *    BORRADOR, §21) y la transición se audita como `PLANILLA_MODIFIED`
 *    (modificación de datos permitida, §19).
 *
 * ATOMICIDAD: todos los efectos se ejecutan dentro de la misma transacción
 * (UnitOfWork). La planilla se bloquea con SELECT ... FOR UPDATE para
 * serializar confirmaciones concurrentes: la segunda transacción re-evalúa la
 * fila ya confirmada y devuelve el estado actual sin mutar ni auditar
 * (reintento idempotente). Ante cualquier error, ROLLBACK (sin estado parcial).
 */
export class ConfirmPlanilla
  implements UseCase<ConfirmPlanillaInput, ConfirmPlanillaResult>
{
  constructor(
    private readonly editions: EditionRepository,
    private readonly configurations: ConfigurationRepository,
    private readonly assignments: JudgeAssignmentRepository,
    private readonly catalogue: CatalogueRepository,
    private readonly nights: NightRepository,
    private readonly uow: UnitOfWork,
  ) {}

  async execute(input: ConfirmPlanillaInput): Promise<ConfirmPlanillaResult> {
    const planillaId = requireUuid(input.planillaId, "planillaId");

    // Edición y versión de configuración vigente (necesaria para versionar los
    // votos por omisión, igual que en upsert-vote). Lecturas estables: no son
    // mutadas por esta operación.
    const edition = await this.editions.findByCode(EDITION_CODE_2027);
    if (edition === null) {
      throw new NotFoundError(`Edition with code '${EDITION_CODE_2027}'`);
    }

    const configuration = await this.configurations.findLatestByEdition(edition.id);
    if (configuration === null) {
      throw new DatabaseError(
        `No configuration version found for edition '${EDITION_CODE_2027}': cannot assign version_id to omission votes`,
      );
    }

    const confirmedAt = new Date();

    return this.uow.withTransaction(async (tx) => {
      // Planilla bajo lock: existe, es del juez (ajena → 404, no revelar
      // existencia) y sigue en estado editable. Este bloqueo serializa
      // confirmaciones concurrentes.
      const planilla = await tx.planillas.findByIdForUpdate(planillaId);
      if (planilla === null || planilla.judgeId !== input.judgeId) {
        throw new NotFoundError("Planilla");
      }

      // Reintento idempotente: ya confirmada (visible ahora por el lock) →
      // estado actual, sin mutar ni auditar. El servidor sigue siendo autoridad
      // del total por rubro (SVC2-64): se recalculan los rubroTotals actuales.
      if (planilla.confirmedAt !== null) {
        const retryVotes = await tx.votes.findByPlanilla(planilla.id);
        return {
          planilla: toSharedPlanilla(planilla),
          votesConfirmed: 0,
          omissionsInserted: 0,
          rubroTotals: computeRubroTotals(retryVotes),
        };
      }

      if (!isEditablePlanilla(planilla.status)) {
        throw new ConflictError(
          "Planilla is not editable (confirmed or closed planillas are immutable)",
          "PLANILLA_NOT_EDITABLE",
        );
      }

      // Ventana de votación: último gate antes de confirmar. El servidor es la
      // autoridad temporal (reloj del servidor); sin fechas oficiales
      // (startsAt/endsAt undefined) no hay ventana que aplicar.
      const night = await this.nights.findById(planilla.nightId);
      if (night === null) {
        throw new NotFoundError("Night");
      }
      assertNightWindowOpen(night, new Date());

      // Asignación efectiva: define los candidatos de la especialidad que el
      // juez debía evaluar en la noche de la planilla (§6).
      const assignment = await this.assignments.findEffectiveByJudgeAndNight(
        input.judgeId,
        planilla.nightId,
      );
      if (assignment === null) {
        throw new ForbiddenError("Judge has no effective assignment for this night");
      }

      // Catálogo elegible: rubros de la especialidad → items → candidatos.
      const [rubros, items, candidates] = await Promise.all([
        this.catalogue.findRubrosByEdition(edition.id),
        this.catalogue.findItemsByEdition(edition.id),
        this.catalogue.findCandidatesByEdition(edition.id),
      ]);

      const specialtyRubroIds = new Set(
        rubros.filter((r) => r.specialty === assignment.specialty).map((r) => r.id),
      );
      const specialtyItemIds = new Set(
        items.filter((i) => specialtyRubroIds.has(i.rubroId)).map((i) => i.id),
      );
      const eligibleCandidates = candidates.filter((c) =>
        specialtyItemIds.has(c.itemId),
      );

      // Confirmar votos del juez (VOTE_CONFIRMED por cada uno).
      const existingVotes = await tx.votes.findByPlanilla(planilla.id);

      let votesConfirmed = 0;
      for (const vote of existingVotes) {
        if (vote.confirmedAt !== undefined) continue;
        await tx.votes.confirm(vote.id, confirmedAt);
        votesConfirmed += 1;
        await tx.audits.create({
          eventType: "VOTE_CONFIRMED",
          entityType: "VOTE",
          entityId: vote.id,
          actorUserId: input.judgeId,
          payload: {
            planillaId: planilla.id,
            nightId: planilla.nightId,
            candidateId: vote.candidateId,
            score: vote.score,
            scoreSource: vote.scoreSource,
          },
        });
      }

      // Subsanación de omisiones (§7, §8): candidato elegible sin voto → 5.
      const votedCandidateIds = new Set(existingVotes.map((v) => v.candidateId));
      const omittedCandidates = eligibleCandidates.filter(
        (c) => !votedCandidateIds.has(c.id),
      );

      let omissionsInserted = 0;
      for (const candidate of omittedCandidates) {
        const item = items.find((i) => i.id === candidate.itemId);
        if (item === undefined) continue;
        const rubroId = item.rubroId;

        const vote = await tx.votes.create({
          id: randomUUID(),
          planillaId: planilla.id,
          judgeId: input.judgeId,
          nightId: planilla.nightId,
          editionId: edition.id,
          comparsaId: candidate.comparsaId,
          rubroId,
          itemId: candidate.itemId,
          candidateId: candidate.id,
          score: CARNAVAL_2027_RULES.omissionScore,
          scoreSource: "OMISSION_CORRECTION",
          idempotencyKey: randomUUID(),
          versionId: configuration.id,
          confirmedAt,
        });
        omissionsInserted += 1;

        await tx.audits.create({
          eventType: "OMISSION_CORRECTED",
          entityType: "VOTE",
          entityId: vote.id,
          actorUserId: input.judgeId,
          payload: {
            planillaId: planilla.id,
            nightId: planilla.nightId,
            candidateId: candidate.id,
            score: CARNAVAL_2027_RULES.omissionScore,
          },
        });
      }

      // SVC2-64: el servidor es autoridad del total por rubro. Se agrupan TODOS
      // los votos de la planilla tras la subsanación (los confirmados + los
      // OMISSION_CORRECTION insertados), se suman sus scores y se ordena por
      // rubroId. Bookkeeping de valores ya materializados: no duplica lógica
      // de scoring-engine.
      const finalVotes = await tx.votes.findByPlanilla(planilla.id);
      const rubroTotals = computeRubroTotals(finalVotes);

      // Transición de la planilla a CONFIRMADA (§21) + auditoría. Se ejecuta
      // SIEMPRE en la transición BORRADOR/EN_EVALUACION → CONFIRMADA, incluso
      // cuando no hubo votos que confirmar ni omisiones que subsanar (caso
      // 0/0: planilla vacía y sin candidatos elegibles para la especialidad
      // asignada — p. ej. catálogo vacío). La respuesta siempre declara
      // status CONFIRMADA con confirmedAt (efecto 3 del contrato); el guard
      // anterior dejaba la planilla persistida como BORRADOR sin auditoría en
      // ese caso (inconsistencia real verificada por probe).
      await tx.planillas.confirm(planilla.id, confirmedAt);
      await tx.audits.create({
        eventType: "PLANILLA_MODIFIED",
        entityType: "PLANILLA",
        entityId: planilla.id,
        actorUserId: input.judgeId,
        payload: {
          action: "CONFIRMED",
          previousStatus: planilla.status,
          newStatus: "CONFIRMADA" as const,
          confirmedAt: confirmedAt.toISOString(),
        },
      });

      return {
        planilla: toSharedPlanilla({
          ...planilla,
          status: "CONFIRMADA",
          confirmedAt,
        }),
        votesConfirmed,
        omissionsInserted,
        rubroTotals,
      };
    });
  }
}
