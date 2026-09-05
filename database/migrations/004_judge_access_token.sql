-- =============================================================================
-- 004_judge_access_token.sql
-- VOTACIONES2027 · Carnavales Goya 2027
--
-- Cuarta migración: identificación única del jurado (DNI) y token temporal de
-- acceso de un solo uso para la autenticación del juez en el PMV.
--
-- Alcance: SOLO persistencia e integridad técnica.
-- NO implementa lógica de emisión, entrega, validación ni canje del token, ni
-- la generación de la sesión (eso corresponde a la capa de aplicación /
-- Backend). La sesión server-side por token opaco ya existente (002, tabla
-- session) se REUTILIZA tal cual para el flujo correo + DNI + token temporal;
-- NO se crea aquí un mecanismo paralelo de sesión.
--
-- Contexto funcional aprobado (Sprint 2, EPIC 1):
--   - SVC2-24 Datos mínimos del jurado y su identificación: correo + DNI.
--     El DNI es NULL-able a propósito: solo las cuentas de jueces (JUDGE) lo
--     portan; las cuentas ADMIN / ESCRIBANO_VEEDOR lo dejan en NULL (el PMV no
--     se autentica con DNI para esos roles). No se añade NOT NULL ni default.
--   - SVC2-10 Identificación única: email UNIQUE existente (001) + dni UNIQUE
--     nuevo. La identificación del juez se compone de ambos datos.
--   - SVC2-31 Autenticación mediante correo, DNI y token temporal de un solo
--     uso: el token temporal habilita la EMISIÓN de una sesión; la sesión
--     resultante es la misma tabla `session` de 002. El token plano NUNCA se
--     persiste: solo su SHA-256 en hex (token_hash), mismo criterio que
--     `session`.
--   - SVC2-47 (contraseña inicial de jueces) FUERA DE ALCANCE del Sprint 2:
--     NO se modela nada al respecto; la columna password_hash de 002 permanece
--     sin cambios.
--
-- Decisiones abiertas (PEND-*) NO se resuelven:
--   - docs/product/PENDIENTES.md NO contiene ningún PEND-* sobre autenticación
--     ni sobre identificación del jurado (verificado al implementar). Esta
--     migración no cierra ni reinterpreta ningún PEND-*.
--   - Canal de entrega del token temporal (mesa de votación): FUERA del
--     sistema y FUERA de esta migración; no se modela.
--
-- Inmutabilidad: un voto confirmado no se modifica aquí (ver 001/003).
-- access_token es estado técnico de seguridad (credencial de acceso de un solo
-- uso), NO entidad de dominio electoral; tiene el mismo tratamiento conceptual
-- que `session` en 002. Su uso/revocación no introduce correcciones sobre datos
-- inmutables. La confirmación de planillas/votos, la append-only de auditoría
-- y los triggers de protección de 003 permanecen intactos.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Identificación única del jurado: DNI
-- ---------------------------------------------------------------------------

-- SVC2-24 (datos mínimos del jurado): el DNI complementa al correo como dato
-- de identificación. SVC2-10 (identificación única): la unicidad queda
-- garantizada por el email UNIQUE existente (001) más este dni UNIQUE nuevo.
--
-- dni es NULL-able a propósito: solo las cuentas de jueces (JUDGE) lo portan.
-- ADMIN y ESCRIBANO_VEEDOR dejan dni en NULL. NO se añade NOT NULL ni default
-- (mismo criterio técnico que password_hash en 002).
--
-- NOTA TÉCNICA (semántica PostgreSQL verificada): una constraint UNIQUE
-- admite múltiples filas con valor NULL. Por lo tanto uq_user_account_dni
-- garantiza unicidad SÓLO entre DNIs no nulos: varias cuentas con dni = NULL
-- (ADMIN / ESCRIBANO_VEEDOR) pueden coexistir sin violarla, mientras que un
-- mismo DNI presente no puede repetirse.
ALTER TABLE user_account ADD COLUMN dni TEXT;

ALTER TABLE user_account ADD CONSTRAINT uq_user_account_dni UNIQUE (dni);

-- ---------------------------------------------------------------------------
-- 2. Token temporal de acceso de un solo uso (SVC2-31)
-- ---------------------------------------------------------------------------

-- access_token es la credencial de acceso temporal que el juez presenta (con
-- correo + DNI) para que el Backend EMITA una sesión en la tabla `session` de
-- 002. La sesión resultante es la existente; NO se crea una segunda sesión.
--
-- Características técnicas (estado de seguridad, NO entidad de dominio
-- electoral — mismo tratamiento conceptual que `session` en 002):
--   - token_hash: SHA-256 en hex del token plano. El token plano NUNCA se
--     persiste; el hash permite validar el token presentado sin almacenarlo.
--   - used_at: NULL = no usado; NOT NULL = ya consumido (single-use). Un token
--     usado no puede volver a emitir sesión.
--   - expires_at: caducidad temporal del token (vigencia limitada).
--   - revoked_at: NULL = vigente; NOT NULL = invalidación previa del token.
--
-- Canal de entrega del token (mesa de votación): FUERA del sistema; no se
-- modela aquí. PEND-* NO se resuelven.
CREATE TABLE access_token (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES user_account (id),
    -- SHA-256 en hex del token plano. El token plano NUNCA se persiste,
    -- idéntico criterio al token opaco de la tabla `session` (002).
    token_hash  TEXT NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    -- NULL = no usado; not null = consumido (single-use).
    used_at     TIMESTAMPTZ,
    -- NULL = vigente; not null = invalidado antes de su uso.
    revoked_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_access_token_token_hash UNIQUE (token_hash)
);

CREATE INDEX idx_access_token_user ON access_token (user_id);
CREATE INDEX idx_access_token_expires ON access_token (expires_at);

-- ---------------------------------------------------------------------------
-- Nota de permisos / inmutabilidad conceptual
--
-- La tabla access_token NO es de dominio electoral: es estado técnico de
-- seguridad. Puede marcarse como usada (UPDATE used_at) o invalidarse (UPDATE
-- revoked_at) por diseño, sin violar la inmutabilidad de votos/planillas/actas
-- ni la append-only de auditoría (003). La revocación es un UPDATE, NUNCA un
-- DELETE (preserva trazabilidad; mismo criterio que `session` en 002).
-- No se modela aquí ninguna corrección de votos.
-- =============================================================================

COMMIT;