-- =============================================================================
-- 002_auth_baseline.sql
-- VOTACIONES2027 · Carnavales Goya 2027
--
-- Segunda migración: baseline de autenticación del PMV.
--
-- Alcance: SOLO persistencia de credenciales y sesión server-side mínima.
-- NO implementa lógica de login, token opaco, expiración automática, revocación
-- automática ni autorización funcional (eso corresponde a la capa de
-- aplicación / Backend).
--
-- Contexto funcional aprobado:
--   - Backend implementará login con token opaco.
--   - El token plano NUNCA se persiste: solo se guarda su SHA-256 en hex en
--     table session (token_hash).
--   - Contraseñas con scrypt, formato scrypt$<salt hex>$<hash hex>
--     (salt 16 bytes, key 64 bytes).
--
-- Decisiones abiertas (PEND-*) NO se resuelven:
--   - PEND-105 correcciones excepcionales de votos confirmados: NO se introduce
--     ningún mecanismo de corrección; la revocación de sesión es un estado de
--     sesión, no una corrección de voto.
--   - Sesión como estado técnico de sesión; no es entidad de dominio electoral.
--
-- Inmutabilidad: un voto confirmado no se modifica aquí (ver 001). La sesión
-- es revocable por diseño (revoked_at) porque no es un voto; no introduce
-- correcciones sobre datos inmutables.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Usuario: credenciales y roles
-- ---------------------------------------------------------------------------

-- password_hash es NULL-able: solo las cuentas con login lo tienen. El PMV
-- solo provee login para roles operativos del sistema; el alta de jurados
-- reales llegará con SVC2-24 (fuera de alcance). No se inventan aquí.
ALTER TABLE user_account ADD COLUMN password_hash TEXT;

-- El default 'USER' en la columna role NO corresponde a ningún rol del
-- sistema (los roles del PMV son ADMIN, JUDGE, ESCRIBANO_VEEDOR). Se elimina
-- el default en lugar de inventar uno: así, un INSERT sin role explícito
-- fallará de forma explícita (integridad técnica) en lugar de asignar un rol
-- inexistente.
ALTER TABLE user_account ALTER COLUMN role DROP DEFAULT;

-- Conjunto cerrado de roles del PMV (PEND-108: NO se incorpora rol adicional).
ALTER TABLE user_account ADD CONSTRAINT ck_user_account_role
    CHECK (role IN ('ADMIN', 'JUDGE', 'ESCRIBANO_VEEDOR'));

-- NOTA DE MIGRACIÓN:
-- Si existieran filas preexistentes con role = 'USER', el CHECK anterior
-- fallará a propósito durante la migración, abortando la transacción.
-- Esto es intencional: NO se mutan datos existentes para ocultarlas.
-- Si la migración falla por esta causa, reportar la existencia de dichas
-- filas y resolverlo mediante decisión humana; no silenciarlo.

-- ---------------------------------------------------------------------------
-- 2. Sesión server-side mínima
-- ---------------------------------------------------------------------------

CREATE TABLE session (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES user_account (id),
    -- SHA-256 en hex del token opaco emitido por el Backend. El token plano
    -- NUNCA se persiste en base de datos.
    token_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    -- NULL = sesión activa; no nulo = sesión revocada.
    revoked_at TIMESTAMPTZ,
    -- Sesión server-side mínima para el PMV.
    -- Revocación = UPDATE session SET revoked_at = now() WHERE ...; NUNCA
    -- DELETE (preserva trazabilidad de la sesión y evita reuso de token).
    CONSTRAINT uq_session_token_hash UNIQUE (token_hash)
);

CREATE INDEX idx_session_user ON session (user_id);
CREATE INDEX idx_session_expires ON session (expires_at);

-- ---------------------------------------------------------------------------
-- Nota de permisos / inmutabilidad conceptual
--
-- La tabla session NO es de dominio electoral: es estado técnico de sesión.
-- Puede revocarse (UPDATE revoked_at) por diseño, sin violar la inmutabilidad
-- de votos/planillas/actas. No se modela aquí ninguna corrección de votos.
-- =============================================================================

COMMIT;
