import type { JudgeAssignmentView } from "@votaciones2027/shared-types";

/**
 * Habilitación de jueces (Slice 1): asignación por noche y especialidad.
 *
 * - `create`: alta de habilitación. `isEffective` permite crear directamente
 *   una asignación NO efectiva.
 * - `update`: solo cambia `isEffective` (habilitar/deshabilitar). El reemplazo
 *   de jurados (S3) usa otro flujo (judge_replacement) y NO se modela aquí.
 * - La unicidad técnica (juez/noche/especialidad y una efectiva por
 *   noche+especialidad) es responsabilidad de la persistencia: cualquier
 *   duplicado se reporta como conflicto (409), no se resuelve por criterio.
 */
export interface AdminAssignmentRepository {
  listByEdition(editionId: string): Promise<JudgeAssignmentView[]>;
  create(input: {
    judgeId: string;
    nightId: string;
    specialtyId: string;
    isEffective: boolean;
  }): Promise<JudgeAssignmentView>;
  update(
    id: string,
    input: { isEffective: boolean },
  ): Promise<JudgeAssignmentView | null>;
}