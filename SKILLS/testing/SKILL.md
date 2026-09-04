# SKILL: TESTING

## 1. Propósito

Definir criterios mínimos para diseñar, ejecutar y revisar pruebas del MVP de **VOTACIONES2027**.

Testing verifica que la implementación respete las reglas, invariantes y contratos existentes.

> **Testing verifica; no define reglas de negocio.**

---

## 2. Fuentes de referencia

Antes de definir o modificar pruebas, consultar:

1. Reglamento y acuerdos aprobados.
2. `docs/product/REGLAS-MVP-2027.md`
3. `docs/product/PENDIENTES.md`
4. `docs/architecture/DOMAIN-MODEL.md`
5. `docs/architecture/DOMAIN-INVARIANTS.md`
6. `docs/architecture/AGENT-ARCHITECTURE.md`
7. `AGENTS.md` correspondiente al contexto.

`PENDIENTES.md` debe consultarse dinámicamente. No duplicar su lista dentro de esta Skill.

---

## 3. Alcance MVP

Priorizar pruebas de:

* gestión y asignación de jueces;
* carga de votos;
* validación de notas;
* confirmación de planillas;
* inmutabilidad;
* scoring y resultados;
* penalizaciones;
* selección de candidatos;
* empates pendientes;
* persistencia;
* idempotencia;
* offline y sincronización;
* autorización por rol;
* auditoría;
* actas cuando estén implementadas.

No ampliar el alcance del MVP mediante tests.

---

## 4. Principios

### 4.1 No inventar reglas

Una prueba sólo puede verificar un comportamiento respaldado por una fuente válida.

Si el comportamiento esperado no está definido:

**STOP → documentar → solicitar decisión.**

### 4.2 Las pruebas no crean reglas

Si una prueba falla:

1. revisar la regla esperada;
2. revisar la implementación;
3. revisar el test;
4. corregir el elemento incorrecto.

No modificar una regla sólo para hacer pasar una prueba.

### 4.3 No duplicar lógica

Los tests no deben implementar una segunda versión del scoring o de las reglas de negocio.

### 4.4 Determinismo

Los mismos datos y configuración deben producir el mismo resultado, salvo valores legítimamente variables.

### 4.5 Trazabilidad

Las pruebas relevantes deben poder relacionarse con:

* una regla;
* un invariante;
* un contrato;
* o un comportamiento técnico definido.

---

## 5. Niveles de prueba

### Unitarias

Para lógica aislada, especialmente:

* validaciones;
* scoring;
* transformaciones;
* selección;
* idempotencia.

### Integración

Para verificar interacción entre:

* API;
* persistencia;
* scoring;
* autenticación/autorización;
* auditoría;
* sincronización.

### E2E

Para flujos críticos completos:

* juez → carga → confirmación;
* veedor → supervisión;
* administrador → escrutinio;
* offline → sincronización.

### Regresión

Las correcciones de defectos deben incorporar pruebas de regresión cuando corresponda.

---

## 6. Scoring

Cuando el `scoring-engine` esté implementado, las pruebas deben cubrir las reglas efectivamente vigentes.

Especial atención a:

* validación de notas;
* valores especiales definidos por las reglas;
* cálculo por noches;
* penalizaciones;
* selección de candidatos;
* conservación de evidencia;
* empates;
* resultados pendientes.

No inventar comportamientos para resolver casos no definidos.

---

## 7. Votos e inmutabilidad

Debe existir cobertura para verificar:

* persistencia de votos válidos;
* confirmación;
* comportamiento ante confirmación repetida;
* inmutabilidad después de confirmar;
* ausencia de duplicados ante reintentos;
* tratamiento de correcciones excepcionales cuando estén definidas.

La inmutabilidad debe verificarse especialmente en Backend y persistencia.

El frontend no constituye la única barrera de protección.

---

## 8. Offline y sincronización

Cuando esté implementado, probar:

* operación local;
* pérdida de conexión;
* recuperación;
* reintento;
* idempotencia;
* sincronización;
* duplicación de operaciones;
* operación recibida después de una confirmación;
* conservación de integridad.

No inventar mecanismos de resolución de conflictos.

---

## 9. Roles y autorización

Verificar que cada rol sólo pueda ejecutar las operaciones autorizadas.

Como mínimo:

* Juez;
* Escribano/Veedor;
* Administrador.

Distinguir visibilidad de autorización para modificar.

---

## 10. Auditoría

Cuando exista auditoría funcional, verificar:

* actor;
* operación;
* entidad afectada;
* fecha/hora;
* resultado;
* protección de registros cuando corresponda.

No utilizar logs técnicos como sustituto de auditoría funcional.

---

## 11. Base de datos

Cuando corresponda, las pruebas de integración deben verificar:

* relaciones;
* unicidad;
* restricciones;
* transacciones;
* atomicidad;
* idempotencia;
* protección de datos confirmados.

No acoplar los tests innecesariamente a detalles internos de PostgreSQL.

---

## 12. Contratos compartidos

Cuando existan contratos en `packages/shared-types`, verificar:

* compatibilidad entre consumidores;
* ausencia de duplicaciones incompatibles;
* detección de cambios incompatibles.

No crear tests para contratos aún inexistentes.

---

## 13. PENDIENTES

Si una prueba depende de un `PEND-*`:

* no resolverlo;
* no reinterpretarlo;
* no cerrarlo;
* verificar el comportamiento pendiente sólo cuando exista una representación técnica definida.

> **Verificar un pendiente no significa resolverlo.**

---

## 14. Criterios de STOP

Detener el trabajo ante:

* contradicción entre fuentes;
* regla funcional inexistente;
* comportamiento ambiguo;
* `PEND-*` tratado como resuelto;
* necesidad de inventar una regla;
* necesidad de inventar un desempate;
* cambio de alcance del MVP.

> **STOP → documentar → consultar → continuar con decisión válida.**

---

## 15. Criterios de finalización

Testing está completo cuando:

* se cubrieron los comportamientos definidos;
* las pruebas nuevas pasan;
* la regresión continúa pasando;
* no se introdujeron reglas nuevas;
* los pendientes no fueron resueltos artificialmente;
* los cambios son trazables;
* los riesgos conocidos fueron informados.

---

## 16. Reporte

Toda intervención debe informar:

1. objetivo;
2. alcance;
3. archivos revisados/modificados;
4. pruebas agregadas;
5. pruebas ejecutadas;
6. resultado;
7. regresiones;
8. reglas verificadas;
9. pendientes o bloqueos;
10. riesgos;
11. cambios fuera de alcance;
12. estado final.

---

## 17. Restricciones absolutas

Testing **NO debe**:

* inventar reglas;
* resolver `PEND-*`;
* modificar el Reglamento;
* decidir desempates;
* definir penalizaciones;
* crear estados de dominio;
* duplicar el scoring;
* modificar otras capas silenciosamente;
* ampliar el alcance del MVP;
* realizar cambios destructivos;
* ejecutar operaciones Git prohibidas por `AGENTS.md`.

**Principio rector:**

> **Verificar el MVP con pruebas reproducibles, trazables y suficientes, sin convertir Testing en una fuente de decisiones de negocio.**
