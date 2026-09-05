-- =============================================================================
-- 006_roles_privileges.sql
-- VOTACIONES2027 · Carnavales Goya 2027
--
-- Sexta migración: privilegios mínimos de base de datos (S1.4).
--
-- Alcance: SOLO permisos/roles. NO agrega tablas, ni constraints, ni lógica
-- funcional. NO modifica las migraciones 001–005.
--
-- Objetivo: que la aplicación pueda ejecutarse con un rol dedicado de
-- privilegio mínimo (`votaciones_app`) en lugar de un superusuario, sin
-- inventar reglas de negocio:
--   - SELECT global (toda lectura autorizada).
--   - INSERT/UPDATE (SIN DELETE) en las entidades de catálogo y operación que
--     S1 y los flujos existentes escriben: comparsa, rubro, rubro_item,
--     candidate, night, judge_assignment, planilla, vote.
--   - INSERT-only en audit_event (la auditoría es append-only; los triggers de
--     003 bloquean UPDATE/DELETE).
--   - SELECT-only en las tablas que pertenecen a flujos posteriores (S2–S4):
--     penalizacion, judge_replacement, scrutiny, act, configuration_version,
--     configuration_snapshot, edition, specialty, user_account.
--
-- La inmutabilidad conceptual de vote/audit_event/configuration_snapshot se
-- respalda por permisos (sin UPDATE/DELETE) además de los triggers existentes.
--
-- Enfoque (decisión aprobada): el runtime actual de desarrollo/E2E NO cambia
-- de rol; la verificación de estos privilegios se ejecuta en tests mediante
-- `SET ROLE votaciones_app`. En producción la aplicación se conectará con este
-- rol dedicado.
--
-- NOTA TÉCNICA: CREATE ROLE no puede ejecutarse dentro de una transacción;
-- se crea el rol (si no existe) mediante \gexec de psql ANTES de la transacción
-- de permisos.
-- =============================================================================

SELECT 'CREATE ROLE votaciones_app NOLOGIN'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'votaciones_app') \gexec

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Esquema y refuerzo del principio de privilegio mínimo
-- ---------------------------------------------------------------------------
-- Las tablas no se comparten con PUBLIC por defecto (PG ≥ 15); el REVOKE es un
-- refuerzo explícito de que NINGÚN rol público toca las tablas del sistema.
GRANT USAGE ON SCHEMA public TO votaciones_app;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 2. Lectura global para el rol de aplicación
-- ---------------------------------------------------------------------------
GRANT SELECT ON ALL TABLES IN SCHEMA public TO votaciones_app;

-- ---------------------------------------------------------------------------
-- 3. Escrituras acotadas al flujo existente + S1 (catálogo administrado)
-- ---------------------------------------------------------------------------
-- Catálogo (S1): create/update, SIN delete (la eliminación no está definida).
GRANT INSERT, UPDATE ON TABLE comparsa, rubro, rubro_item, candidate, night TO votaciones_app;

-- Operación existente: planillas (borrador/confirmación) y votos (insert previo
-- y stamp de confirmación). NUNCA DELETE: la inmutabilidad tras la confirmación
-- está respaldada por permisos y por los triggers de 003.
GRANT INSERT, UPDATE ON TABLE planilla, vote TO votaciones_app;

-- Habilitación (S1): asignación de juez por noche/especialidad.
GRANT INSERT, UPDATE ON TABLE judge_assignment TO votaciones_app;

-- ---------------------------------------------------------------------------
-- 4. Auditoría: INSERT-only (append-only)
-- ---------------------------------------------------------------------------
GRANT INSERT ON TABLE audit_event TO votaciones_app;

-- ---------------------------------------------------------------------------
-- 5. Flujos posteriores (S2–S4): SOLO lectura.
--    penalizacion / judge_replacement / scrutiny / act / configuration_* /
--    edition / specialty / user_account / session / access_token.
--    Las escrituras legítimas de esos flujos llegarán con sus propios slices.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Nota conceptual
-- ---------------------------------------------------------------------------
-- El rol `votaciones_app` NO posee las tablas: solo las usa. La propiedad y la
-- evolución del esquema siguen perteneciendo al rol que ejecuta las migraciones.
-- Los DDL (0XX) y los seeds siguen ejecutándose con el rol de administración.
-- =============================================================================

COMMIT;