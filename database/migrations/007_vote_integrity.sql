-- =============================================================================
-- 007_vote_integrity.sql
-- VOTACIONES2027 · Carnavales Goya 2027
--
-- Séptima migración: cierre de brechas de integridad técnica detectadas en la
-- auditoría del área Database sobre la persistencia del voto.
--
-- Alcance: SOLO integridad estructural e idempotencia técnica. NO introduce
-- reglas de negocio (no scoring, no estados, no ventanas temporales, no
-- penalizaciones, no desempates, no correcciones excepcionales, no validación
-- de planilla).
--
-- Brechas confirmadas con probes sobre la BD real (antes de esta migración):
--   (a) idempotencia: la API trata (judge_id, idempotency_key) como único por
--       juez (upsert-vote: findByIdempotencyKey + IDEMPOTENCY_CONFLICT), pero la
--       base permitía dos votos del mismo juez con la misma idempotency_key y
--       distinta clave de negocio (ventana check-then-insert ante concurrencia
--       o escrituras directas).
--   (b) referencia cruzada voto→planilla: la base permitía un voto cuyo
--       night_id difería del night_id de su planilla y cuyo judge_id podría
--       diferir del judge_id de su planilla.
--   (c) referencia cruzada voto→noche: la base permitía un voto cuyo
--       edition_id difería del edition_id de su noche.
--
-- La API ya garantiza estas consistencias en el flujo normal (upsert-vote usa
-- planilla.judgeId / planilla.nightId / edition.id). Estas constraints cierran
-- la ventana de inconsistencia a nivel de persistencia, respaldando las
-- relaciones estructurales del modelo de dominio (Vote → Planilla agrupado por
-- juez/noche; Night → Edition).
--
-- PEND-* no resueltos, se dejan sin tocar (ver docs/product/PENDIENTES.md):
--   - PEND-105 correcciones excepcionales -> NO se modela ningún mecanismo.
--   - PEND-112 incompatibilidades de jurados -> NO CHECK/trigger aquí.
--   - PEND-102 desempate/sorteo -> NO se toca scrutiny ni winner.
--   - PEND-113 algoritmo de hash -> content_hash sigue nullable.
--
-- Compatibilidad con datos existentes: los datos creados por la API ya
-- satisfacen estas garantías; el ADD CONSTRAINT fallaría ruidosamente ante una
-- violación existente (comportamiento deseado: no se silencian inconsistencias).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Idempotencia del par (judge_id, idempotency_key) en vote
-- ---------------------------------------------------------------------------
-- Respaldo en persistencia del contrato de idempotencia del Backend
-- (upsert-vote): un voto reenviado con la misma clave por el mismo juez no
-- puede materializarse dos veces, aunque la clave de negocio difiera por un
-- payload alterado. La UNIQUE es por juez (mismos jueces distintos pueden
-- reutilizar claves; cada juez genera las suyas).
ALTER TABLE vote
    ADD CONSTRAINT uq_vote_idempotency_per_judge
        UNIQUE (judge_id, idempotency_key);

-- ---------------------------------------------------------------------------
-- 2. Consistencia referencial compuesta voto → planilla → noche
-- ---------------------------------------------------------------------------
-- Las FKs simples existentes (vote.planilla_id → planilla.id,
-- vote.night_id → night.id, vote.edition_id → carnaval_edition.id) no
-- garantizan que el voto describa la MISMA planilla/juez/noche/edición que sus
-- padres. Las FKs compuestas cierran esa brecha:
--   vote(planilla_id, judge_id)  → planilla(id, judge_id)   (el voto es del
--                                     juez dueño de la planilla)
--   vote(planilla_id, night_id)  → planilla(id, night_id)   (el voto pertenece
--                                     a la noche de su planilla)
--   vote(night_id, edition_id)   → night(id, edition_id)    (el voto pertenece
--                                     a la edición de su noche)
-- PostgreSQL exige una UNIQUE explícita sobre las columnas referenciadas
-- (la PK id sola no alcanza); id ya es PK, por lo que las UNIQUE añadidas son
-- redundantes en contenido pero necesarias como objetivo de las FKs.

ALTER TABLE planilla
    ADD CONSTRAINT uq_planilla_id_judge UNIQUE (id, judge_id);

ALTER TABLE planilla
    ADD CONSTRAINT uq_planilla_id_night UNIQUE (id, night_id);

ALTER TABLE night
    ADD CONSTRAINT uq_night_id_edition UNIQUE (id, edition_id);

-- FKs compuestas (nombre explícito: el auto-naming de PostgreSQL usaría la
-- primera columna y colisionaría con vote_planilla_id_fkey existente).
ALTER TABLE vote
    ADD CONSTRAINT vote_planilla_judge_fkey
        FOREIGN KEY (planilla_id, judge_id) REFERENCES planilla (id, judge_id);

ALTER TABLE vote
    ADD CONSTRAINT vote_planilla_night_fkey
        FOREIGN KEY (planilla_id, night_id) REFERENCES planilla (id, night_id);

ALTER TABLE vote
    ADD CONSTRAINT vote_night_edition_fkey
        FOREIGN KEY (night_id, edition_id) REFERENCES night (id, edition_id);

-- NOTA: no se elimina idx_vote_idempotency_key (001): sigue siendo útil para
-- consultas por idempotency_key sin judge_id. No se añaden índices
-- especulativos adicionales.
-- =============================================================================

COMMIT;