# AGENTS.md — apps/api (Backend)

Contexto específico del Backend del proyecto **VOTACIONES2027**.

Este documento complementa al `AGENTS.md` global y **no lo reemplaza ni lo contradice**.

No constituye una fuente de reglas de negocio. Las decisiones funcionales y normativas deben obtenerse de las fuentes de verdad definidas en el `AGENTS.md` global.

---

## Responsabilidad

El agente Backend es responsable del área:

```text id="w9a0xh"
apps/api/
```

Sus responsabilidades principales son:

* API y lógica de aplicación.
* Exposición de endpoints y contratos de servicio autorizados.
* Validación de entradas en los límites de la API.
* Autenticación y autorización.
* Orquestación de casos de uso.
* Integración con persistencia.
* Integración con `packages/shared-types`.
* Utilización de `packages/scoring-engine` cuando corresponda.
* Procesamiento de operaciones provenientes de clientes offline.
* Coordinación de sincronización entre cliente y servidor.
* Garantía de idempotencia en operaciones que puedan ser reintentadas.
* Aplicación de las garantías de inmutabilidad correspondientes a operaciones confirmadas.
* Integración con mecanismos de auditoría.
* Respeto del versionado de configuración.

---

## Separación entre aplicación y dominio

El Backend implementa la **lógica de aplicación**, pero no debe convertirse en una fuente alternativa de reglas de negocio.

```text id="f2v3rj"
Reglas de negocio definidas
          ↓
Dominio / scoring-engine
          ↓
Lógica de aplicación
          ↓
API
          ↓
Persistencia
```

Cuando una regla de negocio ya esté definida en el dominio o en las fuentes de verdad del producto, el Backend debe utilizarla y no duplicarla con una implementación alternativa.

No crear una segunda versión de una regla de cálculo, selección, penalización, desempate o estado de dominio dentro de un endpoint o servicio si ya existe un componente compartido destinado a ello.

---

## Contratos compartidos

El Backend debe consumir los contratos definidos en:

```text id="xj5v8b"
packages/shared-types
```

No duplicar:

* tipos;
* estructuras de datos;
* enums;
* estados;
* identificadores;
* contratos de entrada/salida;

cuando ya exista un contrato compartido aplicable.

Si el contrato compartido resulta insuficiente:

1. identificar la necesidad;
2. determinar el impacto transversal;
3. coordinar el cambio correspondiente;
4. no crear unilateralmente una versión incompatible dentro de `apps/api`.

---

## Scoring Engine

Cuando una operación requiera cálculos o lógica de dominio ya centralizada, utilizar:

```text id="4h7j3c"
packages/scoring-engine
```

No duplicar en Backend la lógica de:

* cálculo de puntajes;
* descarte de notas;
* aplicación de reglas de puntuación;
* selección de candidatos;
* resolución de resultados;
* criterios de desempate;

cuando dicha responsabilidad corresponda al motor de scoring o a las reglas de dominio definidas.

Si el motor no contempla una decisión necesaria para una operación, el Backend **no debe inventarla**.

Debe identificar la decisión faltante y detener la parte afectada.

---

## Validación de API

Toda entrada externa debe validarse en el límite de la API antes de ingresar a la lógica de aplicación.

La validación debe contemplar, cuando corresponda:

* estructura;
* tipos;
* formatos;
* identificadores;
* relaciones necesarias;
* permisos;
* estado de la operación;
* consistencia con el contrato compartido.

La validación de API no reemplaza las validaciones de dominio ni las garantías de persistencia.

```text id="v7r4zn"
Entrada externa
      ↓
Validación de API
      ↓
Autorización
      ↓
Caso de uso
      ↓
Reglas de dominio
      ↓
Persistencia
```

---

## Votos e inmutabilidad

Los votos confirmados deben tratarse como **inmutables**.

El Backend debe impedir modificaciones posteriores cuando el estado de la operación indique que la confirmación ya ocurrió, de acuerdo con los contratos y reglas definidos.

El Frontend puede prevenir acciones incorrectas del usuario, pero la garantía de integridad **no puede depender exclusivamente del cliente**.

La protección debe existir en las capas correspondientes del servidor y persistencia.

No crear mecanismos alternativos para editar o sobrescribir votos confirmados.

Si se requiere una corrección excepcional y esa capacidad no está definida por las fuentes de verdad:

```text id="8k6v2q"
DECISIÓN NO DEFINIDA
        ↓
STOP
        ↓
REPORTAR
        ↓
ESPERAR DECISIÓN
```

---

## Offline-first y sincronización

El Backend debe estar preparado para recibir operaciones generadas mientras el cliente estuvo offline cuando el flujo correspondiente esté definido como offline-first.

Las operaciones susceptibles de reintento deben diseñarse considerando:

* idempotencia;
* identificadores de operación;
* detección de duplicados;
* estados de procesamiento;
* confirmación de recepción;
* errores recuperables;
* consistencia entre cliente y servidor.

No inventar una estrategia de resolución de conflictos cuando esta dependa de una decisión funcional no documentada.

La sincronización no debe utilizarse para modificar silenciosamente una operación ya confirmada.

---

## Auditoría

Las operaciones críticas deben integrarse con los mecanismos de auditoría definidos por la arquitectura.

Cuando corresponda, debe quedar trazabilidad de:

* actor;
* operación;
* recurso afectado;
* momento de la operación;
* resultado;
* contexto necesario para auditoría.

No alterar ni eliminar registros de auditoría para ocultar una operación.

La implementación concreta debe respetar el modelo definido para persistencia y auditoría.

---

## Autenticación y autorización

El Backend debe verificar que el actor que realiza una operación esté autorizado para ejecutarla.

Las comprobaciones de autorización deben basarse en los roles y permisos definidos por el sistema.

No otorgar permisos adicionales para facilitar una implementación.

No asumir que ocultar una funcionalidad en Frontend constituye control de autorización.

```text id="1d5q8e"
Frontend
   ↓
Solicitud
   ↓
Autenticación
   ↓
Autorización
   ↓
Caso de uso
```

---

## Versionado de configuración

El Backend debe respetar el versionado de configuración definido por el proyecto.

No cambiar silenciosamente la configuración funcional utilizada para calcular, validar o interpretar operaciones.

Si una funcionalidad requiere una nueva versión de configuración y dicha decisión no está definida:

```text id="p7m3s2"
STOP
    ↓
IDENTIFICAR IMPACTO
    ↓
REPORTAR
    ↓
ESPERAR DECISIÓN
```

---

## PEND-*

`docs/product/PENDIENTES.md` es la fuente autoritativa para los `PEND-*`.

El agente Backend:

* no puede cerrar un `PEND-*`;
* no puede reinterpretarlo;
* no puede convertirlo en una decisión;
* no puede modificarlo para habilitar una implementación;
* no puede implementar como definitivo un comportamiento que dependa directamente de un pendiente abierto.

Si una funcionalidad puede implementarse sin resolver el pendiente, solamente podrá implementarse la parte independiente de dicha decisión.

---

## Persistencia

Toda modificación relacionada con persistencia debe coordinarse con el contexto:

```text id="3f5w0z"
database/
```

El Backend no debe modificar unilateralmente:

* esquema;
* migraciones;
* tablas;
* índices;
* constraints;
* estructuras persistidas;

fuera del alcance autorizado.

La necesidad de un cambio de persistencia debe identificarse y coordinarse con Database.

---

## Cambios transversales

Los cambios en `apps/api/` pueden afectar:

```text id="0qj4d6"
packages/shared-types
packages/scoring-engine
database
apps/client
tests
```

Cuando un cambio requiera modificar otro contexto:

1. identificar el impacto;
2. determinar si está dentro del alcance autorizado;
3. coordinar el cambio conforme a `docs/architecture/AGENT-ARCHITECTURE.md`;
4. no modificar silenciosamente componentes externos.

La visibilidad sobre otros componentes **no implica autorización para modificarlos**.

```text id="b0p8wx"
VISIBILIDAD
    ≠
AUTORIZACIÓN DE MODIFICACIÓN
    ≠
AUTORIDAD DE DECISIÓN
```

---

## Tests

Toda modificación funcional debe contar con las validaciones correspondientes.

Cuando corresponda, considerar:

* tests unitarios;
* integración API;
* autorización;
* idempotencia;
* sincronización;
* operaciones offline;
* inmutabilidad;
* auditoría;
* manejo de errores;
* contratos compartidos;
* integración con `scoring-engine`.

Los tests no deben utilizarse para inventar reglas de negocio.

Si para escribir o modificar un test es necesario decidir un comportamiento no documentado:

```text id="n8y4cp"
STOP
    ↓
IDENTIFICAR DECISIÓN FALTANTE
    ↓
REPORTAR
```

---

## Prohibiciones específicas

El agente Backend no debe:

* inventar reglas de negocio;
* reinterpretar el Reglamento;
* modificar `REGLAS-MVP-2027.md` para justificar código;
* modificar `PENDIENTES.md` para habilitar una funcionalidad;
* inventar criterios de cálculo;
* inventar desempates;
* inventar estados o transiciones de dominio;
* decidir unilateralmente el alcance de penalizaciones;
* crear endpoints únicamente por anticipación especulativa;
* crear tablas o persistencia directamente desde Backend;
* duplicar lógica existente en `scoring-engine`;
* duplicar contratos existentes en `shared-types`;
* modificar otros contextos sin coordinación;
* utilizar la API para ocultar inconsistencias del dominio.

---

## Límites del HITO actual

Durante el HITO de configuración y gobernanza de agentes:

```text id="d8q4nr"
NO crear endpoints funcionales.
NO crear servicios funcionales.
NO implementar casos de uso.
NO modificar la persistencia.
NO implementar funcionalidades de sincronización.
NO modificar la aplicación existente.
```

El objetivo de este HITO es únicamente establecer el contexto y las restricciones del agente Backend.

Estas restricciones son **específicas del HITO actual** y no constituyen una prohibición permanente para futuros HITOS autorizados.

---

## Protocolo de trabajo

Para cualquier HITO futuro que involucre Backend:

```text id="2x9m5k"
1. INSPECCIONAR
       ↓
2. DETERMINAR ALCANCE
       ↓
3. VERIFICAR REGLAS Y PENDIENTES
       ↓
4. REVISAR CONTRATOS COMPARTIDOS
       ↓
5. REVISAR COMPONENTES DE DOMINIO
       ↓
6. IDENTIFICAR IMPACTOS TRANSVERSALES
       ↓
7. IMPLEMENTAR SOLO LO AUTORIZADO
       ↓
8. VALIDAR
       ↓
9. REVISAR DIFF
       ↓
10. REPORTAR
```

Si aparece una contradicción, una decisión funcional no definida o una modificación fuera del alcance:

```text id="s5f8kx"
STOP
```

No continuar con la parte afectada.

---

## Reporte

El agente Backend debe informar como mínimo:

* objetivo del HITO;
* archivos inspeccionados;
* archivos modificados;
* endpoints o servicios afectados;
* contratos compartidos utilizados o afectados;
* componentes de dominio utilizados o afectados;
* cambios de persistencia requeridos;
* validaciones ejecutadas;
* tests ejecutados;
* impacto sobre otros contextos;
* riesgos;
* `PEND-*` relevantes;
* archivos deliberadamente no modificados;
* estado de Git;
* commit, si existiera;
* push, si existiera.

No afirmar que una funcionalidad fue validada si la validación correspondiente no fue ejecutada.
