-- =============================================================================
-- 005_night_voting_window.sql
-- VOTACIONES2027 · Carnavales Goya 2027
--
-- Quinta migración: ventana de votación por noche (inicio/fin del estado
-- ABIERTA de la tabla `night`).
--
-- Alcance: SOLO persistencia e integridad técnica.
-- NO implementa lógica temporal de apertura/cierre automático de las noches,
-- ni validación de ventanas temporales, ni rechazo de votos fuera de horario
-- (eso corresponde a la capa de aplicación / Backend).
--
-- Reglas de negocio NO resueltas (PEND-*), se dejan sin tocar:
--   - PEND-110 fechas reales de las 3 noches 2027 -> columns NULL: no se
--     inventan fechas oficiales. `starts_at` / `ends_at` permanecen NULL.
--   - PEND-114 fecha/duración del periodo de votación por noche (inicio y fin
--     de ABIERTA) -> la capacidad técnica de expresar la ventana se habilita,
--     pero ningún valor se fija en esta migración. No se cierra ni reinterpreta
--     el pendiente.
--
-- NOTA TÉCNICA: ambas columnas son NULL-able y NO llevan CHECK, DEFAULT ni
-- NOT NULL. Mientras `starts_at`/`ends_at` sean NULL, el servidor (Backend) es
-- la autoridad temporal y NO aplica ventana de votación. Cuando existan fechas
-- oficiales (PEND-110), se rellenarán por vía de aplicación, no por constraint
-- de base de datos (evita inventar regla de negocio en el esquema).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Ventana de votación por noche
-- ---------------------------------------------------------------------------
-- El servidor es la autoridad temporal: estas columnas son la capacidad
-- técnica de la base de datos para expresar cuándo comienza y termina el
-- estado ABIERTA de una noche, pero la evaluación de la ventana corresponde a
-- la capa de aplicación (Backend), NO a constraints ni triggers de SQL.
--
-- starts_at: momento de inicio de la ventana de votación de la noche (inicio
-- del estado ABIERTA). NULL mientras no existan fechas oficiales (PEND-110):
-- mientras sea NULL el servidor no aplica ventana. Sin CHECK, DEFAULT ni
-- NOT NULL.
ALTER TABLE night ADD COLUMN starts_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN night.starts_at IS
    'Inicio de la ventana de votación de la noche (inicio del estado ABIERTA). '
    'NULL mientras no existan fechas oficiales (PEND-110). El servidor es la '
    'autoridad temporal: la evaluación de la ventana corresponde a la capa de '
    'aplicación (Backend), no a constraints ni triggers de BD.';

-- ---------------------------------------------------------------------------
-- 2. Fin de la ventana de votación
-- ---------------------------------------------------------------------------
-- ends_at: momento de fin de la ventana de votación de la noche (fin del
-- estado ABIERTA). NULL mientras no existan fechas oficiales (PEND-110):
-- mientras sea NULL el servidor no aplica ventana. Sin CHECK, DEFAULT ni
-- NOT NULL.
ALTER TABLE night ADD COLUMN ends_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN night.ends_at IS
    'Fin de la ventana de votación de la noche (fin del estado ABIERTA). '
    'NULL mientras no existan fechas oficiales (PEND-110). El servidor es la '
    'autoridad temporal: la evaluación de la ventana corresponde a la capa de '
    'aplicación (Backend), no a constraints ni triggers de BD.';

-- ---------------------------------------------------------------------------
-- Nota conceptual
--
-- Esta migración habilita únicamente la CAPACIDAD de persistencia para
-- expresar la ventana de votación por noche. No fija valores, no referencia
-- fechas reales, y no introduce ninguna regla funcional de apertura/cierre.
-- La lógica temporal (cuándo abre/cierra una noche, qué se hace si no hay
-- ventana definida) es responsabilidad del Backend y depende de decisiones
-- (PEND-110, PEND-114) que esta migración NO decide.
-- =============================================================================

COMMIT;
