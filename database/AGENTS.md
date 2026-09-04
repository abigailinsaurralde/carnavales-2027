# AGENTS.md — Database

Contexto específico para el área de persistencia del proyecto **VOTACIONES2027**.

Este documento complementa al `AGENTS.md` global y **no lo reemplaza ni lo contradice**.

No constituye una fuente de reglas de negocio. Las decisiones funcionales y normativas deben obtenerse de las fuentes de verdad definidas en el `AGENTS.md` global.

---

## Responsabilidad

El agente Database es responsable del área:

```text
database/
```

Sus responsabilidades principales son:

* PostgreSQL como tecnología de persistencia objetivo.
* Diseño y evolución del esquema de base de datos.
* Migraciones versionadas.
* Cambios de esquema explícitos y trazables.
* Integridad referencial.
* Constraints de integridad técnica.
* Índices y estructuras necesarias para persistencia.
* Transacciones atómicas cuando corresponda.
* Idempotencia para operaciones de persistencia y sincronización cuando corresponda.
* Persistencia de mecanismos de auditoría e inmutabilidad definidos por la arquitectura.
* Coordinación con Backend cuando un cambio de persistencia afecte contratos o comportamiento de aplicación.

---

## Reglas de implementación

El agente Database debe:

* respetar las reglas e invariantes de dominio ya definidos;
* implementar únicamente decisiones funcionales que estén documentadas;
* mantener los cambios de esquema versionados;
* evitar modificaciones destructivas de datos existentes sin autorización explícita;
* garantizar integridad referencial cuando corresponda;
* utilizar transacciones para operaciones que requieran atomicidad;
* diseñar operaciones idempotentes cuando el caso de uso lo requiera;
* preservar la trazabilidad de cambios de persistencia;
* validar toda migración antes de considerarla terminada;
* considerar compatibilidad y efectos sobre datos existentes antes de modificar estructuras persistidas.

---

## Integridad e inmutabilidad

La base de datos debe proporcionar mecanismos de integridad técnica que respalden las garantías definidas por el dominio y la arquitectura.

En particular:

* los datos que deban ser inmutables por regla del sistema no deben quedar expuestos a modificaciones accidentales;
* los mecanismos de auditoría deben preservar la trazabilidad requerida;
* las restricciones de base de datos deben utilizarse para garantizar **integridad técnica**, no para inventar reglas funcionales;
* no utilizar constraints, triggers, procedimientos o mecanismos equivalentes para introducir decisiones de negocio que no hayan sido aprobadas.

La implementación de persistencia no debe alterar el significado de las reglas del dominio.

---

## Pendientes

`docs/product/PENDIENTES.md` es la fuente autoritativa para los `PEND-*`.

El agente Database aplica íntegramente el tratamiento de `PEND-*` definido en el `AGENTS.md` global (no cerrar, no reinterpretar, no convertir en decisión, no implementar decisión definitiva dependiente de un pendiente abierto). Si un cambio de esquema depende directamente de una decisión pendiente, se aplica el flujo `PENDIENTE BLOQUEANTE → STOP → REPORTAR IMPACTO → ESPERAR DECISIÓN`. Si el esquema puede prepararse sin tomar la decisión pendiente, solamente podrá implementarse la parte que no dependa de ella y deberá quedar claramente documentado el límite.

---

## Cambios transversales

Los cambios dentro de `database/` pueden afectar:

```text
packages/shared-types
packages/scoring-engine
apps/api
apps/client
tests
```

Cuando un cambio de persistencia tenga impacto fuera de `database/`, debe identificarse antes de implementarlo y coordinarse conforme a la arquitectura de agentes definida en:

```text
docs/architecture/AGENT-ARCHITECTURE.md
```

La visibilidad sobre otros componentes **no implica autorización para modificarlos** (ver `AGENTS.md` global, "Gobernanza de agentes").

---

## Migraciones

Toda modificación estructural debe realizarse mediante migraciones versionadas cuando corresponda.

Una migración debe:

* tener un propósito claramente identificado;
* modificar únicamente el alcance autorizado;
* ser reproducible;
* ser revisable mediante diff;
* contemplar el impacto sobre datos existentes;
* evitar pérdida de información salvo autorización explícita;
* ser validada antes de considerarse terminada.

No crear migraciones únicamente por anticipación especulativa.

No introducir tablas, columnas, índices, relaciones o estructuras que no tengan una necesidad justificada por el alcance actual.

---

## Prohibiciones específicas

Las prohibiciones globales definidas en `AGENTS.md` (no inventar reglas de negocio, no reinterpretar el Reglamento, no modificar `REGLAS-MVP-2027.md` ni `PENDIENTES.md` para justificar código, no cerrar decisiones pendientes) se aplican íntegramente al agente Database.

Además, el agente Database no debe:

* inventar reglas de negocio mediante el esquema;
* crear entidades funcionales únicamente por anticipación;
* realizar cambios destructivos sin autorización;
* modificar áreas fuera de su alcance sin coordinación;
* utilizar constraints o triggers para resolver decisiones funcionales no definidas.

---

## Límites del HITO actual

Durante el HITO de configuración y gobernanza de agentes:

```text
NO crear migraciones funcionales.
NO crear esquema funcional.
NO modificar datos.
NO implementar persistencia de funcionalidades.
```

El objetivo de este HITO es únicamente establecer el contexto y las restricciones del agente Database.

Estas restricciones son **específicas del HITO actual** y no constituyen una prohibición permanente para futuros HITOS autorizados.

---

## Protocolo de trabajo

Para cualquier HITO futuro que involucre Database, se aplica el ciclo `INSPECCIONAR → DETERMINAR ALCANCE → VERIFICAR REGLAS Y PENDIENTES → IMPLEMENTAR → VALIDAR → REVISAR DIFF → REPORTAR` definido en el `AGENTS.md` global ("Protocolo de trabajo").

Además, para el contexto Database, el agente debe incorporar en la etapa de análisis:

```text
IDENTIFICAR IMPACTO EN PERSISTENCIA
       ↓
VALIDAR MIGRACIONES Y DATOS
```

Si durante el trabajo aparece una decisión funcional no definida, una contradicción o un cambio fuera del alcance:

```text
STOP
```

No continuar con la parte afectada.

---

## Reporte

El agente Database aplica el formato de reporte obligatorio definido en el `AGENTS.md` global ("Reporte obligatorio") y debe informar además los aspectos específicos de su contexto:

* migraciones creadas o modificadas;
* cambios de esquema realizados;
* impacto detectado sobre otros componentes.

No afirmar que una migración o cambio de esquema fue validado si la validación no fue ejecutada.
