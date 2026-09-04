-- =============================================================================
-- 001_initial_schema.sql
-- VOTACIONES2027 · Carnavales Goya 2027
--
-- Primera migración: esquema físico PostgreSQL del modelo lógico de
-- persistencia aprobado.
--
-- Alcance: SOLO persistencia. No implementa API, auth, frontend, offline/sync,
-- flujo de votación, scoring, escrutinio, actas ni automatizaciones.
--
-- Decisiones abiertas (PEND-*) NO se resuelven ni se congelan:
--   - PEND-102 desempate del ganador  -> winner / tie_break_* son NULL-ables
--   - PEND-112 incompatibilidades de jurados -> NO hay CHECK de incompatibilidad
--   - PEND-113 algoritmo de hash -> content_hash / input_fingerprint NULL-ables
--   - Alcance de penalizaciones (global vs por noche) -> night_id NULL-able,
--     sin CHECK/UNIQUE que defina el alcance
--
-- Inmutabilidad conceptual: se contempla en el diseño de permisos/persistencia
-- (ver nota final). NO se crean triggers complejos.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Carnaval / configuración
-- ---------------------------------------------------------------------------

CREATE TABLE carnaval_edition (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code          TEXT NOT NULL,
    name          TEXT NOT NULL,
    voting_nights INTEGER NOT NULL CHECK (voting_nights > 0),
    starts_on     DATE,
    ends_on       DATE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_carnaval_edition_code UNIQUE (code)
);

CREATE TABLE specialty (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code       TEXT NOT NULL,
    "order"    INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_specialty_code UNIQUE (code),
    -- Conjunto cerrado de especialidades por noche (REGLAS 2027).
    CONSTRAINT ck_specialty_code CHECK (code IN ('BAILE', 'VESTUARIO', 'BATERIA'))
);

CREATE TABLE night (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    edition_id UUID NOT NULL REFERENCES carnaval_edition (id),
    number     INTEGER NOT NULL,
    date       DATE,
    status     TEXT NOT NULL DEFAULT 'PLANIFICADA',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_night_per_edition_number UNIQUE (edition_id, number),
    CONSTRAINT ck_night_number CHECK (number >= 1 AND number <= 3),
    CONSTRAINT ck_night_status CHECK (status IN ('PLANIFICADA', 'ABIERTA', 'CERRADA'))
);

CREATE TABLE configuration_version (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    edition_id  UUID NOT NULL REFERENCES carnaval_edition (id),
    version     INTEGER NOT NULL,
    status      TEXT NOT NULL DEFAULT 'BORRADOR',
    frozen_at   TIMESTAMPTZ,
    frozen_by   UUID,
    rules_ref   TEXT NOT NULL,
    content_ref TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_configuration_version_per_edition UNIQUE (edition_id, version),
    CONSTRAINT ck_configuration_version_status CHECK (status IN ('BORRADOR', 'CONGELADA'))
);

CREATE TABLE configuration_snapshot (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    configuration_version_id UUID NOT NULL REFERENCES configuration_version (id),
    -- Documento JSON autocontenido e inmutable con los IDs y valores efectivos
    -- necesarios para reconstruir la configuración utilizada (mínimo: edición,
    -- versión, noches, especialidades, comparsas, rubros, ítems, candidatos,
    -- asignaciones efectivas).
    content                  JSONB NOT NULL,
    -- Hash de integridad. Algoritmo/alcance PEND-113 -> permanece nullable.
    content_hash             TEXT,
    materialized_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Relación 1:1 con configuration_version.
    CONSTRAINT uq_configuration_snapshot_per_version UNIQUE (configuration_version_id)
);

-- ---------------------------------------------------------------------------
-- 2. Organización
-- ---------------------------------------------------------------------------

CREATE TABLE user_account (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT NOT NULL,
    display_name  TEXT,
    role          TEXT NOT NULL DEFAULT 'USER',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_user_account_email UNIQUE (email)
);

CREATE TABLE comparsa (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    edition_id UUID NOT NULL REFERENCES carnaval_edition (id),
    code       TEXT NOT NULL,
    name       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_comparsa_per_edition_code UNIQUE (edition_id, code)
);

CREATE TABLE judge_assignment (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    judge_id     UUID NOT NULL REFERENCES user_account (id),
    night_id     UUID NOT NULL REFERENCES night (id),
    specialty_id UUID NOT NULL REFERENCES specialty (id),
    is_effective BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Conserva la asignación original y permite crear una nueva asignación
    -- efectiva en caso de reemplazo (DOMAIN-MODEL §6.5).
    CONSTRAINT uq_judge_assignment_per_judge_night_specialty
        UNIQUE (judge_id, night_id, specialty_id),
    -- Exactamente un juez efectivo por noche + especialidad (REGLAS 2027 §3.1).
    CONSTRAINT uq_judge_assignment_effective_per_night_specialty
        UNIQUE (night_id, specialty_id) WHERE is_effective = TRUE
);

CREATE TABLE judge_replacement (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    night_id            UUID NOT NULL REFERENCES night (id),
    original_judge_id   UUID NOT NULL REFERENCES user_account (id),
    replacement_judge_id UUID NOT NULL REFERENCES user_account (id),
    specialty_id        UUID NOT NULL REFERENCES specialty (id),
    reason              TEXT,
    authorized_by       UUID REFERENCES user_account (id),
    occurred_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 3. Estructura de votación
-- ---------------------------------------------------------------------------

CREATE TABLE rubro (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    edition_id    UUID NOT NULL REFERENCES carnaval_edition (id),
    specialty_id  UUID NOT NULL REFERENCES specialty (id),
    name          TEXT NOT NULL,
    type          TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_rubro_type CHECK (type IN ('NOMINATIVO', 'ALEATORIO'))
);

CREATE TABLE rubro_item (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rubro_id    UUID NOT NULL REFERENCES rubro (id),
    name        TEXT NOT NULL,
    order_index INTEGER NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE candidate (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id     UUID NOT NULL REFERENCES rubro_item (id),
    comparsa_id UUID NOT NULL REFERENCES comparsa (id),
    label       TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE planilla (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    judge_id     UUID NOT NULL REFERENCES user_account (id),
    night_id     UUID NOT NULL REFERENCES night (id),
    status       TEXT NOT NULL DEFAULT 'BORRADOR',
    confirmed_at TIMESTAMPTZ,
    closed_at    TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_planilla_status CHECK (status IN
        ('BORRADOR', 'EN_EVALUACION', 'CONFIRMADA', 'SINCRONIZADA', 'CERRADA'))
);

CREATE TABLE vote (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    edition_id        UUID NOT NULL REFERENCES carnaval_edition (id),
    planilla_id       UUID NOT NULL REFERENCES planilla (id),
    judge_id          UUID NOT NULL REFERENCES user_account (id),
    night_id          UUID NOT NULL REFERENCES night (id),
    comparsa_id       UUID NOT NULL REFERENCES comparsa (id),
    rubro_id          UUID NOT NULL REFERENCES rubro (id),
    item_id           UUID NOT NULL REFERENCES rubro_item (id),
    candidate_id      UUID NOT NULL REFERENCES candidate (id),
    score             NUMERIC(3, 1) NOT NULL,
    score_source      TEXT NOT NULL,
    idempotency_key   TEXT NOT NULL,
    version_id        UUID NOT NULL REFERENCES configuration_version (id),
    sync_state        TEXT NOT NULL DEFAULT 'PENDING',
    confirmed_at      TIMESTAMPTZ,
    device_context    JSONB,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- No hay updated_at: no existe en el contrato del dominio y el voto es
    -- inmutable tras la confirmación.
    CONSTRAINT ck_vote_score CHECK (score >= 0 AND score <= 10),
    CONSTRAINT ck_vote_score_source CHECK (score_source IN ('JUDGE', 'OMISSION_CORRECTION')),
    CONSTRAINT ck_vote_sync_state CHECK (sync_state IN ('PENDING', 'SYNCED', 'FAILED')),
    -- No-duplicación del voto (REGLAS §22).
    CONSTRAINT uq_vote_per_judge_night_comparsa_rubro_item_candidate
        UNIQUE (judge_id, night_id, comparsa_id, rubro_id, item_id, candidate_id)
);

-- ---------------------------------------------------------------------------
-- 4. Penalizaciones
-- ---------------------------------------------------------------------------

CREATE TABLE penalizacion (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    edition_id    UUID NOT NULL REFERENCES carnaval_edition (id),
    comparsa_id   UUID NOT NULL REFERENCES comparsa (id),
    -- Alcance global vs por noche permanece ABIERTO (PEND): por eso night_id es
    -- NULL-able y NO hay CHECK/UNIQUE que defina el alcance ni la acumulación.
    night_id      UUID REFERENCES night (id),
    motivo        TEXT NOT NULL,
    regla_articulo TEXT NOT NULL,
    cantidad      NUMERIC NOT NULL,
    evidencia     TEXT,
    estado        TEXT NOT NULL DEFAULT 'PENDIENTE_APROBACION',
    registered_by UUID NOT NULL REFERENCES user_account (id),
    approved_by   UUID REFERENCES user_account (id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_penalizacion_estado CHECK (estado IN
        ('PENDIENTE_APROBACION', 'APROBADA', 'RECHAZADA'))
);

-- ---------------------------------------------------------------------------
-- 5. Auditoría
-- ---------------------------------------------------------------------------

CREATE TABLE audit_event (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type  TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id   UUID,
    actor_user_id UUID REFERENCES user_account (id),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    payload     JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    -- Append-only conceptual: no UPDATE/DELETE de filas de auditoría.
    -- entity_id sin FK: referencia polimórfica por entity_type + entity_id.
);

CREATE INDEX idx_audit_event_entity ON audit_event (entity_type, entity_id);
CREATE INDEX idx_audit_event_actor ON audit_event (actor_user_id);
CREATE INDEX idx_audit_event_occurred_at ON audit_event (occurred_at);

-- ---------------------------------------------------------------------------
-- 6. Escrutinio / acta
-- ---------------------------------------------------------------------------

CREATE TABLE scrutiny (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    configuration_snapshot_id UUID NOT NULL REFERENCES configuration_snapshot (id),
    edition_id               UUID NOT NULL REFERENCES carnaval_edition (id),
    status                   TEXT NOT NULL DEFAULT 'NO_INICIADO',
    executed_by              UUID REFERENCES user_account (id),
    input_fingerprint        TEXT,
    -- Resultado derivado como snapshot de ejecución (sin tablas maestras de
    -- rankings/resultados).
    result                   JSONB,
    tie_break_stage          INTEGER,
    tie_break_detail         JSONB,
    -- PEND-102: si el desempate queda pendiente, winner_comparsa_id es NULL.
    winner_comparsa_id       UUID REFERENCES comparsa (id),
    started_at               TIMESTAMPTZ,
    finished_at              TIMESTAMPTZ,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_scrutiny_status CHECK (status IN
        ('NO_INICIADO', 'EN_PROCESO', 'CERTIFICADO')),
    CONSTRAINT ck_scrutiny_tie_break_stage CHECK (tie_break_stage IS NULL OR
        tie_break_stage IN (1, 2, 3))
);

CREATE TABLE act (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scrutiny_id  UUID NOT NULL REFERENCES scrutiny (id),
    edition_id   UUID NOT NULL REFERENCES carnaval_edition (id),
    document_ref TEXT,
    generated_by UUID REFERENCES user_account (id),
    generated_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_act_per_scrutiny UNIQUE (scrutiny_id)
);

-- Índices de apoyo (claves foráneas y filtros frecuentes).

CREATE INDEX idx_night_edition ON night (edition_id);
CREATE INDEX idx_comparsa_edition ON comparsa (edition_id);
CREATE INDEX idx_rubro_edition ON rubro (edition_id);
CREATE INDEX idx_rubro_specialty ON rubro (specialty_id);
CREATE INDEX idx_rubro_item_rubro ON rubro_item (rubro_id);
CREATE INDEX idx_candidate_item ON candidate (item_id);
CREATE INDEX idx_candidate_comparsa ON candidate (comparsa_id);
CREATE INDEX idx_planilla_judge ON planilla (judge_id);
CREATE INDEX idx_planilla_night ON planilla (night_id);
CREATE INDEX idx_judge_assignment_night ON judge_assignment (night_id);
CREATE INDEX idx_judge_assignment_specialty ON judge_assignment (specialty_id);
CREATE INDEX idx_judge_replacement_night ON judge_replacement (night_id);
CREATE INDEX idx_vote_edition ON vote (edition_id);
CREATE INDEX idx_vote_planilla ON vote (planilla_id);
CREATE INDEX idx_vote_night ON vote (night_id);
CREATE INDEX idx_vote_version ON vote (version_id);
CREATE INDEX idx_vote_idempotency_key ON vote (idempotency_key);
CREATE INDEX idx_penalizacion_edition ON penalizacion (edition_id);
CREATE INDEX idx_penalizacion_comparsa ON penalizacion (comparsa_id);
CREATE INDEX idx_configuration_version_edition ON configuration_version (edition_id);
CREATE INDEX idx_scrutiny_snapshot ON scrutiny (configuration_snapshot_id);
CREATE INDEX idx_scrutiny_edition ON scrutiny (edition_id);

-- ---------------------------------------------------------------------------
-- Nota de permisos / inmutabilidad conceptual
--
-- Las tablas conceptualmente inmutables (vote, audit_event,
-- configuration_snapshot) NO deben quedar expuestas a UPDATE/DELETE
-- accidentales. La aplicación de permisos (REVOKE UPDATE/DELETE) y el control
-- de escritura de configuration_snapshot se ejecuta en una etapa posterior de
-- configuración de permisos/roles; NO se implementan triggers complejos en
-- esta migración (directriz del HITO).
--
-- La modificación destructiva de un voto confirmado NO se modela aquí
-- (PEND-105 abierto). Una corrección quedará expresada como evento auditable,
-- no como UPDATE del voto original.
-- =============================================================================

COMMIT;
