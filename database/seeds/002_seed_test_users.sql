-- =============================================================================
-- 002_seed_test_users.sql
-- VOTACIONES2027 · Carnavales Goya 2027
--
-- Seed TÉCNICO DE PRUEBA.
-- TEST ONLY — no usar en producción; eliminar o regenerar credenciales antes
-- de producción.
--
-- Este seed NO reemplaza el alta de jurados reales (llega con SVC2-24, fuera
-- de alcance). Solo inserta usuarios fixture con contraseña conocida para
-- poder probar el login durante el desarrollo/QA.
--
-- Contraseña de prueba de AMBOS usuarios: 'ChangeMe-2027!'
-- (documentada aquí a propósito; es SOLO para entornos de prueba).
-- En producción estas cuentas NO deben existir.
--
-- Orden de aplicación:
--   1. 001_initial_schema.sql
--   2. 002_auth_baseline.sql
--   3. 002_seed_test_users.sql
--
-- Los ids los genera la BD (gen_random_uuid). NO se fijan ids.
-- =============================================================================

BEGIN;

-- Usuario fixture 1: juez de BAILE.
INSERT INTO user_account (email, display_name, role, password_hash) VALUES
(
    'juez.baile.1@goya2027.test',
    'Juez de prueba BAILE',
    'JUDGE',
    'scrypt$0a404e3a38ee0c2bab4f5beb2add347c$e8818deb0344ba6548f749b1df168e62d460949556d2bcae4858d3055fae9623db761988d2677bb9bc28a45d86d1c29993c26355d85182b13635ed8b8b4a3dd4'
);

-- Usuario fixture 2: juez de VESTUARIO.
INSERT INTO user_account (email, display_name, role, password_hash) VALUES
(
    'juez.vestuario.1@goya2027.test',
    'Juez de prueba VESTUARIO',
    'JUDGE',
    'scrypt$6c82f0b4f4ed10b6fc1c5119f341b4ad$f1c933cf62977f64343f7d95c2c789295007339df0fcbcc03841a7e1a75bbdc620325421bfe69e145cc80696ae2f6aa1de22ad2c428999e6c273d4840538ec84'
);

COMMIT;
