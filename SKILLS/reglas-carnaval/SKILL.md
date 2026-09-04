# SKILL: REGLAS DE CARNAVAL

## 1. Propósito

Definir cómo analizar, interpretar y aplicar las reglas funcionales del MVP de **VOTACIONES2027**.

Esta Skill establece un procedimiento de trabajo para los agentes.

> **La Skill interpreta las reglas; no crea reglas de negocio.**

---

## 2. Fuentes de referencia

Consultar:

1. Reglamento y acuerdos humanos aprobados.
2. `docs/product/REGLAS-MVP-2027.md`
3. `docs/product/PENDIENTES.md`

La documentación de arquitectura y el código sirven para comprender la implementación, pero no sustituyen una decisión funcional.

---

## 3. Procedimiento obligatorio

Ante cualquier comportamiento funcional:

```text
Identificar comportamiento
          ↓
Localizar fuente
          ↓
Verificar contradicciones
          ↓
Verificar pendientes
          ↓
Determinar regla aplicable
          ↓
Implementar / verificar
```

La contradicción debe analizarse **antes** de considerar una decisión como pendiente.

---

## 4. Clasificación

Una regla puede encontrarse en alguno de estos estados:

| Estado             | Significado                                                    |
| ------------------ | -------------------------------------------------------------- |
| **CERRADA**        | Decisión expresamente fijada para el MVP.                      |
| **PERMITIDA**      | Regla definida y vigente, aunque no esté marcada como cerrada. |
| **PENDIENTE**      | Depende de una decisión abierta registrada en `PENDIENTES.md`. |
| **AMBIGUA**        | Permite más de una interpretación razonable.                   |
| **CONTRADICTORIA** | Existen fuentes aplicables con comportamientos incompatibles.  |

**CONTRADICTORIA tiene prioridad sobre PENDIENTE.**

---

## 5. Reglamento y acuerdos

El Reglamento y los acuerdos humanos aprobados constituyen la referencia funcional principal.

`REGLAS-MVP-2027.md` funciona como especificación operativa de las decisiones adoptadas para el MVP.

Si existe una contradicción material:

> **STOP → documentar la contradicción → solicitar decisión humana.**

No seleccionar unilateralmente una interpretación.

---

## 6. `REGLAS-MVP-2027.md`

Antes de implementar una regla:

* localizarla;
* verificar su alcance;
* verificar excepciones;
* comprobar dependencias;
* comprobar posibles contradicciones;
* determinar si existe un pendiente relacionado.

No considerar válida una regla únicamente porque aparezca en código, tests o documentación técnica.

---

## 7. `PENDIENTES.md`

`docs/product/PENDIENTES.md` identifica decisiones funcionales abiertas.

Cuando una implementación dependa de un pendiente:

* no resolverlo técnicamente;
* no reinterpretarlo;
* no cerrarlo;
* no asumir un resultado;
* informar el bloqueo.

La lista de pendientes debe consultarse directamente en el documento vigente.

No mantener una lista duplicada dentro de esta Skill.

---

## 8. Ausencia o ambigüedad

La ausencia de una regla no autoriza a inventarla.

Si existen varias interpretaciones posibles y la elección tiene impacto funcional:

**STOP → documentar las alternativas → solicitar decisión.**

Esto es especialmente importante para:

* desempates;
* penalizaciones;
* excepciones;
* correcciones;
* estados;
* transiciones;
* límites;
* conflictos de sincronización.

---

## 9. Aplicación transversal

Una regla definida debe mantenerse consistente en todas las capas:

```text
Regla funcional
      │
      ▼
Modelo de dominio
      │
      ├── Scoring
      ├── Backend
      ├── Frontend
      ├── Database
      └── Tests
```

Una capa técnica no puede crear una variante de la regla por conveniencia de implementación.

---

## 10. Scoring y resultados

Las reglas de puntuación deben derivarse de las fuentes funcionales vigentes.

El cálculo debe centralizarse en el componente definido por la arquitectura, actualmente `scoring-engine`.

Esta Skill no debe duplicar:

* fórmulas;
* valores;
* criterios de selección;
* reglas de descarte;
* desempates;
* penalizaciones.

Si el comportamiento no está definido:

**STOP.**

---

## 11. Penalizaciones

Las penalizaciones sólo deben aplicarse conforme a reglas funcionales vigentes.

No asumir por iniciativa técnica:

* alcance;
* momento de aplicación;
* acumulación;
* prioridad;
* excepciones.

Si alguno de estos aspectos permanece abierto, debe respetarse el pendiente correspondiente.

---

## 12. Empates

Los empates deben resolverse únicamente mediante un mecanismo expresamente definido.

Si no existe un mecanismo aprobado:

* no inventar desempate;
* no elegir arbitrariamente un ganador;
* representar el estado pendiente cuando corresponda;
* informar la necesidad de decisión.

---

## 13. Cambios de reglas

Una modificación funcional requiere revisar su impacto sobre:

* modelo de dominio;
* scoring;
* API;
* frontend;
* persistencia;
* tests;
* documentación relacionada.

No modificar solamente el código dejando documentación o contratos desactualizados.

---

## 14. Trazabilidad

Las reglas relevantes utilizadas durante una implementación deben poder rastrearse hasta su fuente.

Cuando corresponda, registrar:

* fuente;
* sección o referencia;
* interpretación;
* comportamiento derivado;
* componentes afectados.

Los tests verifican las reglas; no son fuente normativa.

---

## 15. Criterios de STOP

Detener el trabajo ante:

* contradicción entre fuentes;
* regla inexistente;
* ambigüedad con impacto funcional;
* `PEND-*` tratado como resuelto;
* necesidad de inventar una excepción;
* necesidad de inventar un desempate;
* cambio de alcance del MVP;
* decisión que corresponda al negocio.

> **STOP → documentar → consultar → continuar con decisión válida.**

---

## 16. Criterios de finalización

El análisis de una regla está completo cuando:

* se identificó la fuente;
* se verificaron contradicciones;
* se verificaron pendientes;
* se determinó su clasificación;
* se identificó el comportamiento aplicable;
* se identificaron impactos;
* no se inventaron decisiones;
* los bloqueos quedaron documentados.

---

## 17. Reporte

Toda intervención debe informar:

1. regla o comportamiento analizado;
2. fuente;
3. clasificación;
4. interpretación;
5. pendientes relacionados;
6. contradicciones detectadas;
7. impacto en el MVP;
8. componentes afectados;
9. validaciones realizadas;
10. bloqueos;
11. riesgos;
12. estado final.

---

## 18. Restricciones absolutas

Reglas de Carnaval **NO debe**:

* inventar reglas;
* resolver `PEND-*`;
* modificar el Reglamento;
* decidir desempates no definidos;
* definir penalizaciones no aprobadas;
* crear estados funcionales sin respaldo;
* modificar el alcance del MVP;
* utilizar código o tests como autoridad funcional;
* convertir una interpretación propia en decisión oficial;
* modificar otros contextos silenciosamente;
* ejecutar operaciones Git prohibidas por `AGENTS.md`.

**Principio rector:**

> **Aplicar lo definido, detectar contradicciones, señalar ambigüedades y detenerse ante toda decisión que el negocio todavía no haya tomado.**
