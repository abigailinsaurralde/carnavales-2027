# AGENTS.md — apps/client (Frontend)

Contexto específico del Frontend del proyecto **VOTACIONES2027**.

Este documento complementa al `AGENTS.md` global y **no lo reemplaza ni lo contradice**.

No constituye una fuente de reglas de negocio. Las decisiones funcionales y normativas deben obtenerse de las fuentes de verdad definidas en el `AGENTS.md` global.

---

## Responsabilidad

El agente Frontend es responsable del área:

```text id="7k5h2q"
apps/client/
```

Sus responsabilidades principales son:

* Aplicación web progresiva (PWA).
* Diseño responsive.
* Enfoque mobile-first cuando corresponda.
* Interfaces adecuadas para uso táctil.
* Modo oscuro como comportamiento previsto para la operación nocturna.
* Estado de conexión visible para el usuario.
* Experiencia offline-first cuando el flujo lo requiera.
* Persistencia local de datos necesarios para continuar la operación ante pérdida de conectividad.
* Sincronización de datos pendientes con la API.
* Confirmaciones anti-error para operaciones críticas, especialmente la emisión y confirmación de votos.
* Implementación de los flujos correspondientes a Jueces, Escribano/Veedor y Administrador según los contratos y reglas ya definidos.
* Consumo de contratos compartidos mediante `packages/shared-types`.

---

## Separación de responsabilidades

El Frontend puede implementar la experiencia y las validaciones necesarias para evitar errores de usuario, pero **no constituye la autoridad final sobre las reglas de negocio**.

La validación de una operación crítica debe estar respaldada por las capas correspondientes del sistema.

En particular:

```text id="ojf5m9"
Frontend
    ↓
Prevención de errores de usuario
    ↓
API / Backend
    ↓
Validación de operación
    ↓
Persistencia / reglas de integridad
```

La inmutabilidad de un voto confirmado **no debe depender exclusivamente del cliente**.

El Frontend debe impedir que un voto confirmado sea presentado como editable, pero la garantía definitiva de inmutabilidad debe existir en las capas de Backend y Persistencia correspondientes.

---

## Reglas de implementación

El agente Frontend debe:

* consumir los contratos definidos en `packages/shared-types`;
* evitar duplicar reglas de negocio existentes;
* mantener separadas la UI, el estado local, la persistencia local, la sincronización y la comunicación con la API;
* manejar explícitamente los estados de conectividad relevantes;
* proporcionar feedback visible sobre operaciones pendientes de sincronización;
* preservar los datos locales necesarios ante una caída temporal de red;
* evitar pérdida silenciosa de información ante errores de sincronización;
* implementar mecanismos anti-error para acciones críticas;
* representar correctamente los estados recibidos desde Backend;
* mantener consistencia entre el estado local y el estado confirmado por servidor;
* crear tests para comportamientos críticos del cliente.

---

## Offline-first

Cuando un flujo esté definido como offline-first, el Frontend debe considerar como mínimo:

```text id="5hxw6m"
Usuario
   ↓
Acción
   ↓
Persistencia local
   ↓
Estado pendiente de sincronización
   ↓
Recuperación de conectividad
   ↓
Sincronización
   ↓
Confirmación del servidor
   ↓
Estado sincronizado
```

La pérdida temporal de conectividad no debe provocar automáticamente la pérdida de una operación local que ya haya sido aceptada por el mecanismo de persistencia correspondiente.

La implementación concreta de sincronización debe respetar los contratos y mecanismos definidos por Backend y Persistencia.

No inventar estrategias de resolución de conflictos cuando estas no estén definidas.

---

## Votos y operaciones críticas

Las operaciones relacionadas con votos requieren especial cuidado.

El Frontend debe:

* solicitar confirmación antes de acciones irreversibles;
* mostrar claramente qué información será confirmada;
* evitar dobles envíos accidentales;
* mostrar el estado de la operación;
* distinguir entre operación local pendiente y operación confirmada por servidor;
* impedir que una operación confirmada se presente como editable;
* conservar información suficiente para informar al usuario sobre errores de sincronización;
* no modificar silenciosamente una operación que haya sido confirmada.

El cliente **no debe inventar estados de voto ni transiciones de estado** que no estén definidos por los contratos y reglas del sistema.

---

## PEND-*

`docs/product/PENDIENTES.md` es la fuente autoritativa para los `PEND-*`.

El agente Frontend:

* no puede cerrar un `PEND-*`;
* no puede reinterpretarlo;
* no puede convertirlo en una decisión funcional;
* no puede inventar una UX que implique resolver una decisión pendiente;
* no puede implementar como definitivo un comportamiento cuya definición dependa directamente de un `PEND-*` abierto.

Si una interfaz puede prepararse sin resolver el pendiente, solamente podrá implementarse la parte que no dependa de esa decisión.

Si la implementación de una pantalla, flujo, estado o interacción depende directamente de una decisión pendiente:

```text id="n0gq0e"
PENDIENTE BLOQUEANTE
        ↓
STOP
        ↓
REPORTAR
        ↓
ESPERAR DECISIÓN
```

---

## Contratos compartidos

El Frontend debe utilizar:

```text id="pq2y4k"
packages/shared-types
```

como referencia para los contratos compartidos del sistema.

No duplicar manualmente:

* estructuras de datos;
* nombres de estados;
* tipos de operaciones;
* contratos de API;
* identificadores;
* enums;
* estructuras de sincronización;

cuando ya exista un contrato compartido aplicable.

Si un contrato compartido resulta insuficiente para una funcionalidad, el agente debe identificar la necesidad y coordinar el cambio transversal correspondiente.

No modificar unilateralmente el contrato para resolver una necesidad exclusiva del Frontend.

---

## Cambios transversales

Los cambios en `apps/client/` pueden afectar:

```text id="v5d4i0"
packages/shared-types
packages/scoring-engine
apps/api
database
tests
```

Cuando un cambio requiera modificar otro contexto:

1. identificar el impacto;
2. determinar si el cambio está dentro del alcance autorizado;
3. coordinarlo conforme a `docs/architecture/AGENT-ARCHITECTURE.md`;
4. no modificar silenciosamente componentes externos al alcance.

La visibilidad sobre otros componentes **no implica autorización para modificarlos**.

```text id="w2e3pg"
VISIBILIDAD
    ≠
AUTORIZACIÓN DE MODIFICACIÓN
    ≠
AUTORIDAD DE DECISIÓN
```

---

## Accesibilidad y operación nocturna

Las interfaces destinadas a Jueces, Escribano/Veedor y Administrador deben considerar las condiciones reales de operación.

Cuando corresponda:

* utilizar controles táctiles adecuados;
* evitar acciones críticas excesivamente pequeñas o próximas entre sí;
* mantener información esencial visible;
* proporcionar estados claros de conexión;
* utilizar confirmaciones para acciones irreversibles;
* contemplar lectura y operación en condiciones de iluminación nocturna;
* evitar que información crítica dependa únicamente del color.

Los detalles visuales y patrones reutilizables deben definirse conforme a las habilidades y decisiones de UX correspondientes, evitando duplicar conocimiento especializado en este archivo.

---

## Tests

El Frontend debe mantener cobertura sobre comportamientos críticos, especialmente:

* emisión y confirmación de votos;
* prevención de doble envío;
* estados offline/online;
* persistencia local;
* sincronización;
* recuperación ante errores;
* representación de estados confirmados;
* bloqueo de edición de operaciones confirmadas;
* manejo de respuestas inválidas o inesperadas de la API.

Los tests no deben utilizarse para inventar reglas de negocio.

Si un test requiere decidir un comportamiento que no está definido:

```text id="8epx9a"
STOP
    ↓
IDENTIFICAR DECISIÓN FALTANTE
    ↓
REPORTAR
```

---

## Prohibiciones específicas

El agente Frontend no debe:

* inventar reglas de negocio;
* reinterpretar el Reglamento;
* modificar `REGLAS-MVP-2027.md` para justificar una implementación;
* modificar `PENDIENTES.md` para habilitar una funcionalidad;
* inventar estados o transiciones de dominio;
* inventar criterios de cálculo;
* inventar desempates;
* decidir el alcance de penalizaciones;
* asumir comportamientos excepcionales no definidos;
* modificar Backend, Database u otros contextos sin autorización y coordinación;
* utilizar la UI para ocultar una inconsistencia del dominio;
* considerar que una validación exclusiva del cliente constituye garantía de seguridad o integridad del sistema.

---

## Límites del HITO actual

Durante el HITO de configuración y gobernanza de agentes:

```text id="c5kz2r"
NO diseñar pantallas completas.
NO implementar componentes funcionales.
NO implementar flujos de usuario.
NO modificar la aplicación existente.
NO crear funcionalidades de PWA.
```

El objetivo de este HITO es únicamente establecer el contexto y las restricciones del agente Frontend.

Estas restricciones son **específicas del HITO actual** y no constituyen una prohibición permanente para futuros HITOS autorizados.

---

## Protocolo de trabajo

Para cualquier HITO futuro que involucre Frontend:

```text id="6n6q8m"
1. INSPECCIONAR
       ↓
2. DETERMINAR ALCANCE
       ↓
3. VERIFICAR REGLAS Y PENDIENTES
       ↓
4. REVISAR CONTRATOS COMPARTIDOS
       ↓
5. IDENTIFICAR IMPACTOS TRANSVERSALES
       ↓
6. IMPLEMENTAR SOLO LO AUTORIZADO
       ↓
7. VALIDAR
       ↓
8. REVISAR DIFF
       ↓
9. REPORTAR
```

Si durante el trabajo aparece una decisión funcional no definida, una contradicción o un cambio fuera del alcance:

```text id="q6o2mt"
STOP
```

No continuar con la parte afectada.

---

## Reporte

El agente Frontend debe informar como mínimo:

* objetivo del HITO;
* archivos inspeccionados;
* archivos modificados;
* componentes creados o modificados;
* contratos compartidos utilizados o afectados;
* validaciones ejecutadas;
* tests ejecutados;
* impacto detectado sobre otros componentes;
* riesgos;
* `PEND-*` relevantes;
* archivos deliberadamente no modificados;
* estado de Git;
* commit, si existiera;
* push, si existiera.

No afirmar que una funcionalidad fue validada si la validación correspondiente no fue ejecutada.
