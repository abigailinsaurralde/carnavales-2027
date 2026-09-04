-- =============================================================================
-- 003_voting_flow.sql
-- VOTACIONES2027 · Carnavales Goya 2027
--
-- Tercera migración: flujo de votación de jurado (capacidades 2-10 del PMV).
--
-- Alcance: SOLO persistencia e integridad técnica del flujo de votación
-- (idempotencia de planilla, idempotencia offline/sync, inmutabilidad
-- persistente de votos confirmados y de auditoría).
-- NO implementa API, lógica de confirmación, sincronización, validación de
-- ventanas temporales, correcciones, scoring ni desempates (eso corresponde a
-- la capa de aplicación / Backend / scoring-engine).
--
-- Reglas de negocio NO resueltas (PEND-*), se dejan sin tocar:
--   - PEND-102 desempate / sorteo oficial  -> NO se toca scrutiny ni winner.
--   - PEND-112 incompatibilidades de jurados -> NO CHECK/trigger de incompatibilidad.
--   - PEND-103 origen del "no presentado" (0) -> NO se toca.
--   - PEND-104 carga fuera de tiempo / cierre de noches -> NO validación de
--     ventana temporal vía DB.
--   - PEND-105 correcciones excepcionales a planillas confirmadas -> NO se modela.
--   - PEND-113 algoritmo de hash -> content_hash sigue nullable.
--
-- Inmutabilidad: esta migración refuerza técnicamente la inmutabilidad de los
-- votos confirmados y de los eventos de auditoría mediante triggers de
-- protección (mecanismo efectivo de control de escritura; el entorno dev opera
-- con el rol duenio, por lo que NO se ejecuta REVOKE aquí). Las transiciones de
-- estado de la planilla (CONFIRMADA/CERRADA) son gobernadas por la API y NO se
-- modelan triggers sobre planilla (evita inventar regla de negocio).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Idempotencia de planilla
-- ---------------------------------------------------------------------------
-- Decisión técnica de integridad (NO regla de negocio): el flujo operativo usa
-- una planilla por juez y noche. La UNIQUE refuerza la idempotencia de creación
-- desde API/sync: reintentar la creación de una planilla para el mismo
-- (judge_id, night_id) no puede producir filas duplicadas.
ALTER TABLE planilla ADD CONSTRAINT uq_planilla_per_judge_night
    UNIQUE (judge_id, night_id);

-- ---------------------------------------------------------------------------
-- 2. Idempotencia offline/sincronización
-- ---------------------------------------------------------------------------
-- client_ref: clave estable generada por el cliente (offline-first) para
-- deduplicar reintentos en la sincronización. Distinta de idempotency_key del
-- voto (que garantiza no-duplicación de negocio): client_ref permite al servidor
-- reconocer de forma idempotente una operación reenviada por red/timeout.
-- NULL-able: sólo los registros creados por un cliente offline lo portan.
-- Índices únicos parciales: garantizan unicidad SÓLO entre filas que tienen
-- client_ref, sin imponer NOT NULL.
ALTER TABLE planilla ADD COLUMN client_ref TEXT;
CREATE UNIQUE INDEX uq_planilla_client_ref
    ON planilla (client_ref) WHERE client_ref IS NOT NULL;

ALTER TABLE vote ADD COLUMN client_ref TEXT;
CREATE UNIQUE INDEX uq_vote_client_ref
    ON vote (client_ref) WHERE client_ref IS NOT NULL;

-- NOTA: no se añaden índices especulativos adicionales. La columna client_ref
-- queda cubierta por índice único parcial de cada tabla, y las consultas de
-- votos/planillas por entidades ya disponen de los índices creados en 001
-- (idx_vote_planilla, idx_vote_idempotency_key, idx_planilla_judge,
-- idx_planilla_night, etc.).

-- ---------------------------------------------------------------------------
-- 3. Inmutabilidad persistente (capacidades 7 y 8)
-- ---------------------------------------------------------------------------
-- La nota final de 001 postergaba permisos/control de escritura a una etapa
-- posterior: ESTA es esa etapa. El mecanismo efectivo en este entorno (rol
-- duenio, sin separación de roles operativos) es el trigger de protección,
-- no un REVOKE que el rol duenio podría eludir.
--
-- voto: un voto confirmado (confirmed_at NOT NULL) es inmutable por dominio
-- (§10, §22): no puede modificarse ni eliminarse. Un voto NO confirmado (estado
-- de borrador) permanece modificable/anulable, conforme al dominio. El bloqueo
-- se implementa levantando una excepción en UPDATE/DELETE de filas confirmadas;
-- NO modela PEND-105 (corrección excepcional) pues ello requeriría decisión.

CREATE FUNCTION fn_vote_protect_confirmed() RETURNS trigger AS $$
BEGIN
    IF OLD.confirmed_at IS NOT NULL THEN
        RAISE EXCEPTION 'voto confirmado es inmutable';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_vote_protect_confirmed
    BEFORE UPDATE OR DELETE ON vote
    FOR EACH ROW
    EXECUTE FUNCTION fn_vote_protect_confirmed();

-- audit_event: es APPEND-ONLY/inmutable por dominio (§19); sólo se agregan
-- filas, nunca se editan ni eliminan. Se bloquea cualquier UPDATE/DELETE.

CREATE FUNCTION fn_audit_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_event es append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_append_only
    BEFORE UPDATE OR DELETE ON audit_event
    FOR EACH ROW
    EXECUTE FUNCTION fn_audit_append_only();

-- NOTA: NO se crean triggers sobre planilla: las transiciones de estado
-- CONFIRMADA/CERRADA son gobernadas por la API; un trigger aquí inventaría regla
-- de negocio. NO se ejecuta REVOKE de permisos (rol duenio en entorno dev). NO
-- se crea trigger de configuration_snapshot.

-- ---------------------------------------------------------------------------
-- Nota de inmutabilidad conceptual
--
-- La confirmación del voto (confirmed_at) y la append-only de auditoría son
-- ahora garantías de persistencia efectivas. La corrección excepcional de
-- votos/planillas confirmadas permanece ABIERTA (PEND-105): NO se introduce
-- ningún mecanismo de corrección aquí. Un voto confirmado no se modifica; si el
-- negocio aprobara una corrección, deberá expresarse como evento auditable, no
-- como UPDATE/DELETE del registro original.
-- =============================================================================

COMMIT;
