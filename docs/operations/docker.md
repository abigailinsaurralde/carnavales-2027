# Docker — Entorno de desarrollo local (PostgreSQL 18.4)

VOTACIONES2027 · Carnavales Goya 2027 · HITO DOCKER, FASES 1-4.

Este documento describe el entorno Docker **de desarrollo** autorizado para el
proyecto. Alcance actual: **PostgreSQL 18.4** + runner reproducible de
migraciones + conexión del Backend local + tests E2E. **No** incluye
dockerización del Backend/Frontend, CI/CD ni despliegue (fuera del alcance del
HITO).

---

## 1. Requisitos

- Docker con plugin Compose v2 (`docker compose version`).
- Node.js >= 20 y npm (workspaces del monorepo).
- No se necesita ningún `psql` local: el `psql` se ejecuta dentro del contenedor.

> Nota de compatibilidad: la suite E2E admite un fallback explícito a PostgreSQL
> local (`E2E_PSQL_MODE=local`), documentado en la sección 8.

## 2. Quickstart

```bash
npm run docker:up     # levanta PostgreSQL 18.4 (healthcheck incluido)
docker compose ps     # verificar estado "healthy"
npm run db:init       # crea la base de desarrollo votaciones2027 y migra 001-007
cp .env.example .env  # (opcional) ajusta DATABASE_URL si cambiaste credenciales
npm run dev -w @votaciones2027/api      # Backend local contra localhost:5433
npm run dev -w @votaciones2027/client    # Frontend Vite
npm run test:e2e      # E2E contra PostgreSQL Docker (BD exclusiva votaciones2027_e2e)
```

## 3. Puerto y networking

| Contexto | Conexión |
| --- | --- |
| Desde el **host** (Backend local, scripts, E2E) | `localhost:5433` |
| **Dentro** de la red Compose (futuro Backend dockerizado) | `postgres:5432` |

El contenedor sigue escuchando en su puerto estándar **5432**; el host lo
expone como **5433** (el 5432 del host suele estar ocupado por otra
instalación). El Backend local DEBE usar `localhost:5433`
(`DATABASE_URL=postgresql://postgres:postgres@localhost:5433/votaciones2027`).
Si algún día se dockeriza el Backend, deberá usar `postgres:5432` — eso NO está
implementado en este HITO.

## 4. Credenciales y variables

`docker/.env.example` documenta los valores por defecto **de desarrollo**
(usuario `postgres`, contraseña `postgres`, BD `votaciones2027`). Para
cambiarlos: copiar a `docker/.env` (no versionado) y ajustar. Las plantillas
autorizadas versionadas son `.env.example` (raíz) y `apps/api/.env.example`,
alineadas con el contrato real de `apps/api/src/config.ts`
(`DATABASE_URL`, `PORT`, `NODE_ENV`, `CORS_ORIGINS`, `SESSION_TTL_HOURS`,
`RATE_LIMIT_*`). **Nunca** poner credenciales reales en el repositorio.

## 5. Bases de datos

| Base | Uso |
| --- | --- |
| `votaciones2027` | Desarrollo (creada por `db:init`). |
| `votaciones2027_e2e` | Exclusiva de E2E: se DROP/CREATE sola en cada corrida. Nunca se toca la de desarrollo. |

## 6. Persistencia (volumen)

Los datos viven en el volumen nombrado `votaciones2027_pgdata`
(red `votaciones2027-net`).

```bash
docker compose down    # detiene el contenedor; CONSERVA los datos (seguro)
docker compose down -v # ELIMINA el volumen con todos los datos de desarrollo (DESTRUCTIVO)
```

`down -v` **no** debe ejecutarse automáticamente ni por costumbre; si se
ejecutó, la base se regenera con `npm run db:init`.

## 7. Migraciones y seeds

Las migraciones viven en `database/migrations/` (001 → 007) y se ejecutan
**en orden** con `ON_ERROR_STOP=1` vía `psql` del contenedor. No se reescriben
las migraciones ni se duplica SQL en `docker/` (`.gitignore` lo impide).

```bash
npm run db:migrate            # aplica 001-007 sobre votaciones2027
npm run db:init [--seed]      # crea BD si falta + migra; --seed aplica el seed 002 (TEST ONLY)
npm run db:reset -- --yes     # DESTRUYE votaciones2027, la recrea y migra (requiere --yes)
```

- `pgcrypto` (migración 001): la inicialización usa el rol superusuario del
  contenedor (`POSTGRES_USER`), por lo que `CREATE EXTENSION` funciona sin
  alterar la migración.
- `database/seeds/002_seed_test_users.sql` es **TEST ONLY** (usuarios con
  contraseña conocida). Solo se aplica con `db:init --seed`; jamás en
  producción.

## 8. Tests

| Suite | Requiere PG | Modo |
| --- | --- | --- |
| `npm run typecheck` | No | — |
| `npm run test` (API/Client/Scoring) | No | mocks/fakes |
| `npm run test:e2e` | Sí | PostgreSQL Docker (default) |

E2E por defecto (modo `docker`): `tests/e2e/infra.ts` ejecuta `psql` dentro del
contenedor (`docker compose exec -T postgres psql ...`), sin ningún binario
local. La suite usa su propia base `votaciones2027_e2e` (DROP/CREATE aislado).

Fallback local (sin Docker), documentado y explícito:

```bash
# PowerShell:
$env:E2E_PSQL_MODE="local"; $env:E2E_DB_PORT="5432"; npm run test:e2e
# bash:
E2E_PSQL_MODE=local E2E_DB_PORT=5432 npm run test:e2e
```

Variables E2E overrideables (`tests/e2e/fixtures.ts`): `E2E_DB_URL`,
`E2E_ADMIN_DB_URL`, `E2E_DB_HOST`, `E2E_DB_PORT` (default 5433), `E2E_DB_NAME`
(default `votaciones2027_e2e`), `E2E_DB_USER`, `E2E_DB_PASSWORD`,
`E2E_PSQL_MODE` (default `docker`), `E2E_PSQL_BIN` (modo local).

## 9. Troubleshooting

- **`docker: command not found`**: Docker no está instalado/en PATH. Instalar
  Docker Desktop (Windows) u otro motor compatible, o usar el fallback local
  de E2E (§8) con un PostgreSQL local.
- **`5433 EN USO`**: otro proceso ocupa el puerto. Detenerlo o cambiar el
  mapeo `5433:5432` en `docker/compose.yaml` (y en `.env.example`).
- **`container is unhealthy`**: revisar `docker compose ps` y
  `docker compose logs postgres`.
- **`db:init` falla con ERROR**: revisar `docker compose ps` (¿está healthy?).
  Las migraciones requieren el contenedor arriba.
- **E2E falla al conectar**: `npm run docker:up` primero; el default de E2E es
  Docker en `localhost:5433`.
- **psql no encontrado en modo local**: E2E_PSQL_MODE=local requiere psql en
  PATH o `E2E_PSQL_BIN`.

## 10. Restricciones del HITO

- No se creó ni modificó la migración 007 (pertenece al estado previo del
  proyecto; sin commit).
- NO se creó la migración 008 ni se tocaron grants de `session`/`access_token`
  (pendiente F1/B1, fuera de alcance).
- NO se modificó `ORDER BY s.code LIMIT 1` ni nada de PEND-112.
- No se dockerizó Frontend, no hay Dockerfile de Backend, no hay CI/CD.