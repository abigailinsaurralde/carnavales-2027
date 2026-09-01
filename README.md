# VOTACIONES2027

Sistema de Votación Digital para Comparsas de Carnaval Goya 2027.

## 1. Nombre

**VOTACIONES2027 — Sistema de Votación Digital para Comparsas de Carnaval Goya 2027.**

## 2. Estado

Proyecto en fase de arquitectura e implementación inicial.

## 3. Objetivo

Sistema PWA/responsive para digitalizar la evaluación de comparsas durante los carnavales.

## 4. Principios críticos

- **Offline-first**: la aplicación debe funcionar y permitir registrar votos sin conexión a la red.
- **Votos inmutables**: una vez confirmado un voto, no puede modificarse.
- **Auditoría**: cada acción relevante debe quedar registrada y verificable.
- **Trazabilidad**: debe ser posible reconstruir el origen y la historia de cada voto.
- **Cálculo automático**: el escrutinio y los puntajes se calculan de forma automática y reproducible.
- **Aplicación de penalizaciones**: el sistema debe soportar la aplicación de penalizaciones según las reglas establecidas.
- **Escrutinio reproducible**: los resultados deben poder recalcularse de forma idéntica a partir de los datos originales.
- **Contingencia mediante actas PDF**: el sistema debe contemplar la emisión de actas PDF como respaldo.
- **Seguridad**: protección de datos, autenticación y control de acceso.
- **Integridad de datos**: los datos registrados deben permanecer íntegros y consistentes.

## 5. Actores

- **Administrador**: responsable de la configuración y del sistema.
- **Juez**: emite votaciones sobre las comparsas.
- **Escribano/Veedor**: supervisa y certifica el proceso.

> Nota: los permisos detallados de cada actor se definirán en una etapa posterior, de acuerdo con el reglamento.

## 6. Arquitectura prevista

| Capa | Tecnología |
| --- | --- |
| Frontend | React + TypeScript + Vite + PWA |
| Backend | Node.js + TypeScript + Express |
| Autenticación | Better Auth |
| Base de datos | PostgreSQL |
| Validación | Zod |
| Persistencia offline | IndexedDB + Service Worker |
| Testing | Vitest + Playwright |
| Infraestructura | Docker |

## 7. Estructura del repositorio

```
carnavales-2027/
├── apps/
│   ├── api/          # Backend (Express, Node.js + TypeScript)
│   └── client/       # Frontend (React + Vite + PWA)
├── packages/
│   ├── shared-types/ # Tipos y contratos compartidos entre cliente y API
│   └── scoring-engine/ # Motor de cálculo de puntajes y escrutinio
├── database/
│   ├── migrations/   # Migraciones de esquema
│   ├── seeds/        # Datos iniciales de desarrollo
│   └── schema/       # Definición del esquema de base de datos
├── docs/
│   ├── product/      # Documentación de producto
│   ├── architecture/ # Documentación de arquitectura
│   ├── database/     # Documentación de base de datos
│   ├── security/     # Documentación de seguridad
│   └── operations/   # Documentación operativa
├── tests/
│   ├── integration/  # Pruebas de integración
│   └── e2e/          # Pruebas end-to-end
├── docker/           # Configuración e infraestructura Docker
├── .github/
│   └── workflows/    # Pipelines de CI/CD
├── .env.example      # Plantilla de variables de entorno
├── .gitignore
├── .editorconfig
├── .gitattributes
├── package.json
└── README.md
```

## 8. Regla de seguridad

Nunca subir al repositorio:

- `.env` (ni cualquier archivo de entorno con valores reales);
- contraseñas;
- tokens;
- claves privadas;
- certificados privados;
- dumps de bases de datos;
- datos personales reales;
- datos reales de jueces o usuarios.

El archivo `.env.example` es la única plantilla autorizada para versionar.

## 9. Fuente de verdad

La cadena de decisión es la siguiente:

```
Reglamento aprobado
→ Matriz de reglas digital
→ Especificación funcional
→ Tests
→ Implementación
```

El **Reglamento del Carnaval Goya 2027** será la fuente de verdad funcional. Cualquier regla relativa a votación, puntajes, penalizaciones y escrutinio debe derivarse de él y no inventarse.
