# SKILL: MODELO DE DOMINIO

## 1. Propósito

Definir criterios para modelar y revisar el dominio del MVP de **VOTACIONES2027**.

El modelo debe representar fielmente las reglas funcionales vigentes y mantener consistencia entre dominio, contratos, scoring, persistencia y pruebas.

> **El modelo representa el negocio; no inventa decisiones de negocio.**

---

## 2. Fuentes de referencia

Antes de modificar el modelo, consultar:

1. Reglamento y acuerdos aprobados.
2. `docs/product/REGLAS-MVP-2027.md`
3. `docs/product/PENDIENTES.md`
4. `docs/architecture/DOMAIN-MODEL.md`
5. `docs/architecture/DOMAIN-INVARIANTS.md`
6. `AGENTS.md` correspondiente al contexto.

`PENDIENTES.md` debe consultarse siempre de forma actualizada. No duplicar su lista dentro de esta Skill.

---

## 3. Alcance MVP

Modelar únicamente conceptos necesarios para el MVP.

Los conceptos principales definidos actualmente se encuentran en `DOMAIN-MODEL.md`.

No crear entidades, estados, relaciones o abstracciones únicamente para funcionalidades futuras.

---

## 4. Principios de modelado

### 4.1 Derivar, no inventar

Cada concepto, relación, estado e invariante debe poder justificarse mediante una fuente funcional o técnica válida.

El código existente, los tests o una decisión de conveniencia técnica no constituyen por sí mismos una regla de negocio.

### 4.2 Conceptos explícitos

Una entidad debe representar un concepto identificable del dominio y tener una responsabilidad clara.

Evitar:

* entidades genéricas innecesarias;
* duplicación de conceptos;
* relaciones implícitas;
* estados ambiguos.

### 4.3 Relaciones claras

Las relaciones entre conceptos deben ser explícitas y coherentes con `DOMAIN-MODEL.md`.

Los cambios en relaciones deben analizar su impacto sobre:

* `shared-types`;
* `scoring-engine`;
* API;
* persistencia;
* frontend;
* tests.

---

## 5. Invariantes

Los invariantes del dominio deben estar documentados en:

`docs/architecture/DOMAIN-INVARIANTS.md`

El modelo debe respetarlos y no crear invariantes nuevos sin respaldo.

Cuando un invariante sea ambiguo o dependa de una decisión pendiente:

**STOP → identificar → documentar → solicitar decisión.**

---

## 6. Estados

Distinguir:

### Estado de dominio

Describe una situación del negocio.

### Estado operativo

Describe el ciclo de una operación del sistema.

### Estado de sincronización

Describe la relación de una operación con el proceso offline/online.

No mezclar estos tres conceptos.

No crear estados o transiciones funcionales sin respaldo documental.

---

## 7. Votos y planillas

El modelo debe mantener claramente diferenciados:

* contexto de la planilla;
* voto;
* confirmación;
* sincronización;
* auditoría.

Un voto confirmado debe tratarse como **inmutable** según las reglas vigentes.

La sincronización técnica no equivale a confirmación funcional.

Los mecanismos excepcionales de corrección sólo pueden existir si están definidos y autorizados.

---

## 8. Resultados y scoring

El modelo debe proporcionar los datos necesarios para calcular los resultados.

La lógica de cálculo corresponde al `scoring-engine`.

No duplicar reglas de scoring en:

* entidades;
* repositorios;
* API;
* SQL;
* frontend;
* tests.

Si un resultado depende de una decisión pendiente, no inventar el comportamiento.

---

## 9. Penalizaciones

Las penalizaciones deben mantenerse conceptualmente separadas de los votos cuando así lo establezca el modelo funcional.

No inferir desde el modelo:

* alcance;
* momento de aplicación;
* acumulación;
* excepciones;

si esos aspectos no están definidos.

---

## 10. Candidatos y empates

Cuando el dominio contemple múltiples candidatos:

* conservar la información necesaria para la trazabilidad;
* representar el resultado según la regla vigente;
* conservar evidencia de candidatos no seleccionados cuando corresponda;
* representar situaciones pendientes cuando la regla no determine una resolución.

No introducir desempates por criterio técnico.

---

## 11. `shared-types`

Los conceptos utilizados entre componentes deben utilizar contratos compartidos cuando corresponda.

Evitar:

* interfaces duplicadas;
* estados incompatibles;
* nombres diferentes para el mismo concepto sin justificación;
* contratos paralelos que representen el mismo dato.

Todo cambio de contrato requiere análisis de impacto.

---

## 12. PENDIENTES

Si un cambio depende de un `PEND-*`:

* no asumir su resolución;
* no cerrarlo;
* no reinterpretarlo;
* no convertirlo en una regla implícita.

Cuando sea técnicamente posible, el modelo puede representar explícitamente el estado pendiente sin resolver la decisión.

> **Un pendiente puede representarse; no puede resolverse por iniciativa técnica.**

---

## 13. Criterios de STOP

Detener el trabajo ante:

* contradicción entre fuentes;
* concepto no definido;
* relación ambigua con impacto funcional;
* estado o transición no definida;
* invariante no decidido;
* `PEND-*` tratado como resuelto;
* necesidad de inventar una regla;
* cambio que amplíe el alcance del MVP.

> **STOP → documentar → consultar → continuar con decisión válida.**

---

## 14. Criterios de finalización

Un cambio de modelo está completo cuando:

* está respaldado por las fuentes vigentes;
* permanece dentro del MVP;
* mantiene consistencia con `DOMAIN-MODEL.md`;
* respeta `DOMAIN-INVARIANTS.md`;
* no introduce reglas nuevas;
* mantiene compatibilidad con los contratos;
* identifica su impacto técnico;
* puede ser verificado mediante pruebas.

---

## 15. Reporte

Toda intervención debe informar:

1. objetivo;
2. alcance;
3. fuentes consultadas;
4. conceptos afectados;
5. relaciones afectadas;
6. invariantes afectados;
7. contratos afectados;
8. `PEND-*` involucrados;
9. validaciones realizadas;
10. riesgos;
11. cambios fuera de alcance;
12. estado final.

---

## 16. Restricciones absolutas

Modelo de Dominio **NO debe**:

* inventar reglas de negocio;
* resolver `PEND-*`;
* modificar el Reglamento;
* decidir desempates;
* definir penalizaciones no aprobadas;
* implementar el scoring;
* crear estados sin respaldo;
* duplicar contratos innecesariamente;
* ampliar el dominio por funcionalidades futuras;
* modificar otros contextos silenciosamente;
* ejecutar operaciones Git prohibidas por `AGENTS.md`.

**Principio rector:**

> **Modelo de dominio mínimo, explícito y trazable, suficiente para implementar y verificar el MVP sin convertir el modelo técnico en autoridad del negocio.**
