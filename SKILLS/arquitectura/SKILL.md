# SKILL: ARQUITECTURA

## 1. Propósito

Definir criterios mínimos para diseñar y revisar la arquitectura del MVP de **VOTACIONES2027**.

La arquitectura debe traducir las reglas y decisiones existentes a una solución técnica mantenible, segura y verificable.

> **La arquitectura implementa las decisiones; no las inventa.**

---

## 2. Fuentes de referencia

Antes de tomar una decisión arquitectónica, consultar:

1. Reglamento y acuerdos humanos aprobados.
2. `docs/product/REGLAS-MVP-2027.md`
3. `docs/product/PENDIENTES.md`
4. `docs/architecture/DOMAIN-MODEL.md`
5. `docs/architecture/DOMAIN-INVARIANTS.md`
6. `docs/architecture/AGENT-ARCHITECTURE.md`
7. `AGENTS.md` y `AGENTS.md` locales.

Las Skills no constituyen una fuente adicional de reglas de negocio.

---

## 3. Alcance MVP

La arquitectura debe cubrir como mínimo:

* PWA responsive;
* frontend;
* API/backend;
* modelo de dominio;
* `shared-types`;
* `scoring-engine`;
* persistencia PostgreSQL;
* operación offline;
* sincronización;
* autenticación y autorización;
* inmutabilidad de votos confirmados;
* auditoría;
* cálculo de resultados;
* contingencia mediante actas.

No incorporar infraestructura o componentes que no sean necesarios para el MVP sin justificación.

---

## 4. Separación de responsabilidades

Arquitectura base:

```text
┌──────────────────────┐
│     apps/client      │
│       PWA/UI         │
└──────────┬───────────┘
           │ API
           ▼
┌──────────────────────┐
│       apps/api       │
│ aplicación / auth    │
└──────────┬───────────┘
           │
     ┌─────┴──────┐
     ▼            ▼
┌──────────┐ ┌───────────────┐
│ shared-  │ │ scoring-      │
│ types    │ │ engine        │
└──────────┘ └───────────────┘
                    │
                    ▼
             ┌─────────────┐
             │  database   │
             │ PostgreSQL  │
             └─────────────┘
```

### Frontend

Responsable de:

* interfaz;
* experiencia táctil;
* estado de conexión;
* persistencia local;
* operaciones offline;
* sincronización;
* feedback y prevención de errores.

No debe ser la autoridad final para reglas críticas ni inmutabilidad.

### Backend

Responsable de:

* API;
* autenticación;
* autorización;
* validación;
* casos de uso;
* coordinación con persistencia;
* idempotencia;
* protección de votos confirmados;
* auditoría.

### `shared-types`

Contiene contratos compartidos entre componentes.

No debe contener lógica dependiente de infraestructura.

### `scoring-engine`

Debe concentrar los cálculos de puntuación y resultados definidos para el MVP.

Debe ser:

* determinista;
* testeable;
* independiente de UI;
* independiente de HTTP;
* independiente de PostgreSQL.

### Database

Responsable de:

* persistencia;
* relaciones;
* integridad técnica;
* transacciones;
* índices;
* restricciones;
* protección de datos inmutables;
* almacenamiento de auditoría.

La base de datos no debe convertirse en fuente autónoma de reglas de negocio no documentadas.

---

## 5. Contratos

Los límites entre componentes deben utilizar contratos explícitos.

Evitar:

* tipos duplicados;
* estructuras incompatibles;
* acceso directo entre capas;
* dependencia innecesaria de detalles internos.

Los cambios de contrato deben analizar impacto en todos los consumidores.

---

## 6. Offline-first

El sistema debe poder continuar operaciones permitidas cuando exista pérdida de conectividad.

La arquitectura debe contemplar:

```text
Usuario
   │
   ▼
Persistencia local
   │
   ▼
Cola de operaciones
   │
   ├── sin conexión ──► esperar
   │
   └── conexión ──────► sincronizar
                           │
                           ▼
                         API
```

Las operaciones sincronizables deben ser identificables e idempotentes.

No inventar una estrategia de resolución de conflictos si ésta no está definida por las reglas del proyecto.

---

## 7. Inmutabilidad

Los votos confirmados constituyen información crítica.

La arquitectura debe garantizar que:

* una confirmación sea persistida correctamente;
* los reintentos no generen duplicados;
* un voto confirmado no pueda modificarse mediante operaciones normales;
* cualquier mecanismo excepcional respete las reglas aprobadas;
* exista trazabilidad suficiente.

La protección debe existir en el servidor y persistencia, no solamente en el frontend.

---

## 8. Auditoría

Separar:

**Auditoría funcional**

* acciones relevantes de usuarios;
* confirmaciones;
* operaciones críticas;
* cambios autorizados.

**Logs técnicos**

* errores;
* excepciones;
* rendimiento;
* diagnóstico.

No utilizar logs técnicos como sustituto de auditoría funcional.

---

## 9. Resultados

El cálculo debe utilizar `scoring-engine` y respetar las reglas vigentes.

No duplicar cálculos en:

* frontend;
* SQL;
* repositorios;
* reportes.

Los resultados derivados deben poder trazarse hasta los datos que los originaron.

Si una decisión de resultado permanece pendiente en `PENDIENTES.md`, no debe implementarse un comportamiento inventado.

---

## 10. Configuración y versionado

Cuando una funcionalidad dependa de una configuración reglamentaria versionada, su diseño debe considerar:

* identificación de la configuración;
* trazabilidad;
* reproducibilidad del resultado;
* compatibilidad entre datos y configuración.

No convertir decisiones pendientes sobre versionado en contratos obligatorios sin aprobación.

---

## 11. Seguridad

Priorizar:

* autenticación;
* autorización por rol;
* validación server-side;
* protección de operaciones críticas;
* mínimo privilegio;
* separación de responsabilidades;
* trazabilidad.

Nunca confiar exclusivamente en controles del cliente.

---

## 12. Cambios transversales

Antes de modificar un componente compartido, analizar:

```text
Cambio
  │
  ├── shared-types
  ├── scoring-engine
  ├── API
  ├── frontend
  ├── database
  └── tests
```

Si el cambio afecta varios contextos, coordinar con los responsables correspondientes.

No realizar cambios silenciosos fuera del alcance asignado.

---

## 13. PENDIENTES

Consultar siempre `docs/product/PENDIENTES.md`.

Los elementos `PEND-*` representan decisiones aún abiertas.

La arquitectura debe:

* identificar dependencias con pendientes;
* evitar asumir su resolución;
* documentar bloqueos;
* permitir evolución posterior cuando sea posible.

La lista de pendientes no debe copiarse dentro de esta Skill.

---

## 14. Criterios de STOP

Detener el trabajo y solicitar decisión cuando exista:

* contradicción entre fuentes;
* regla funcional indefinida;
* comportamiento dependiente de un `PEND-*`;
* contrato incompatible;
* cambio de alcance del MVP;
* necesidad de inventar un estado o transición de dominio;
* necesidad de inventar una estrategia de conflicto;
* decisión que corresponda al negocio y no a arquitectura.

> **STOP → documentar → consultar → continuar con decisión válida.**

---

## 15. Criterios de finalización

Una decisión o cambio arquitectónico debe quedar:

* alineado con las reglas vigentes;
* limitado al MVP;
* con responsabilidades claras;
* sin duplicación innecesaria;
* con dependencias identificadas;
* compatible con offline-first;
* compatible con inmutabilidad;
* verificable mediante pruebas;
* documentado cuando corresponda.

---

## 16. Reporte

Toda intervención arquitectónica debe informar:

1. objetivo;
2. alcance;
3. fuentes consultadas;
4. decisión o cambio realizado;
5. componentes afectados;
6. contratos afectados;
7. riesgos;
8. pendientes involucrados;
9. validaciones realizadas;
10. cambios fuera de alcance;
11. estado final.

---

## 17. Restricciones absolutas

Arquitectura **NO debe**:

* inventar reglas de negocio;
* resolver `PEND-*`;
* modificar el Reglamento;
* decidir desempates;
* definir penalizaciones;
* introducir estados de dominio sin respaldo;
* duplicar el scoring;
* imponer infraestructura innecesaria para el MVP;
* modificar otros contextos silenciosamente;
* ampliar el alcance sin autorización;
* ejecutar operaciones Git prohibidas por `AGENTS.md`.

**Principio rector:**

> **Arquitectura mínima suficiente para un MVP seguro, trazable, offline-first y preparado para evolucionar sin romper las reglas.**
