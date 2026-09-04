# SKILL: BASE DE DATOS

## 1. Propósito

Definir criterios mínimos para diseñar, implementar y revisar la persistencia del MVP de **VOTACIONES2027**.

La base de datos debe garantizar integridad técnica, consistencia, trazabilidad y persistencia segura.

> **La base de datos protege los datos; no inventa las reglas del negocio.**

---

## 2. Fuentes de referencia

Antes de realizar cambios, consultar:

1. Reglamento y acuerdos humanos aprobados.
2. `docs/product/REGLAS-MVP-2027.md`
3. `docs/product/PENDIENTES.md`
4. `docs/architecture/DOMAIN-MODEL.md`
5. `docs/architecture/DOMAIN-INVARIANTS.md`
6. `docs/architecture/AGENT-ARCHITECTURE.md`
7. `AGENTS.md`
8. `database/AGENTS.md`

Las decisiones de negocio no deben derivarse únicamente del esquema SQL.

---

## 3. Alcance MVP

La persistencia debe contemplar las necesidades reales del MVP, incluyendo cuando estén implementadas:

* edición del carnaval;
* noches;
* comparsas;
* rubros e ítems;
* jueces;
* asignaciones;
* planillas;
* votos;
* penalizaciones;
* resultados;
* auditoría;
* operaciones offline/sincronización;
* actas y datos necesarios para contingencia.

No crear tablas, estados o relaciones únicamente por anticipar funcionalidades futuras.

---

## 4. Principios de diseño

### 4.1 Integridad

Utilizar los mecanismos adecuados de PostgreSQL:

* `PRIMARY KEY`;
* `FOREIGN KEY`;
* `UNIQUE`;
* `NOT NULL`;
* `CHECK`;
* índices;
* transacciones.

Las restricciones deben proteger invariantes técnicos claramente definidos.

### 4.2 Modelo consistente

El esquema debe representar el modelo de dominio vigente.

Evitar:

* duplicación de entidades;
* relaciones ambiguas;
* columnas sin propósito;
* datos derivados almacenados innecesariamente;
* nombres incompatibles con los contratos existentes.

### 4.3 No inventar reglas

Una restricción SQL no debe utilizarse para resolver una decisión funcional que permanezca abierta.

Si una regla necesaria no está definida:

**STOP → informar → solicitar decisión.**

---

## 5. Votos

Los votos son datos críticos.

La persistencia debe permitir:

* registrar el voto;
* asociarlo correctamente con su contexto;
* validar su integridad;
* confirmar la planilla;
* impedir modificaciones normales después de la confirmación;
* soportar reintentos idempotentes;
* mantener trazabilidad.

La protección de inmutabilidad debe coordinarse con Backend.

No implementar mecanismos excepcionales de modificación sin respaldo en las reglas vigentes.

---

## 6. Transacciones

Las operaciones críticas deben ser atómicas.

Especialmente cuando involucren varias escrituras relacionadas:

```text id="z6n2rt"
Operación
   │
   ├── validar
   ├── persistir datos
   ├── registrar auditoría
   └── confirmar
          │
       COMMIT
```

Si una parte falla, no debe quedar un estado parcialmente persistido.

---

## 7. Idempotencia

Las operaciones provenientes de clientes offline o reintentos de red deben poder procesarse sin generar duplicados cuando el contrato lo requiera.

El diseño debe considerar:

* identificador de operación;
* restricciones de unicidad;
* detección de operaciones ya procesadas;
* resultado consistente ante reintento.

No asumir que una solicitud de red será recibida una sola vez.

---

## 8. Offline y sincronización

La base de datos debe soportar el modelo de sincronización definido por Backend.

Debe preservarse:

* integridad de la operación;
* identificación de duplicados;
* orden lógico cuando sea requerido;
* estado de confirmación;
* trazabilidad.

No definir desde la base de datos una estrategia de resolución de conflictos que no haya sido aprobada.

---

## 9. Auditoría

Cuando corresponda, las operaciones críticas deben dejar registro auditable.

Distinguir:

**Datos de auditoría**

* quién;
* qué operación;
* sobre qué entidad;
* cuándo;
* resultado de la operación.

**Logs técnicos**

* errores;
* diagnóstico;
* rendimiento.

La auditoría no debe depender exclusivamente de logs técnicos.

---

## 10. Resultados

La base de datos debe almacenar los datos fuente necesarios para reproducir o verificar resultados.

El cálculo de reglas de puntuación pertenece al `scoring-engine` y/o a la capa de aplicación correspondiente.

No duplicar la lógica del scoring en SQL, triggers o procedimientos almacenados salvo decisión arquitectónica explícita.

Los datos derivados deben poder relacionarse con sus datos de origen.

---

## 11. Penalizaciones

Las penalizaciones deben mantenerse separadas de las notas de los jueces cuando así lo establezca el modelo funcional.

La base de datos debe permitir distinguir:

* penalización;
* estado;
* contexto;
* trazabilidad.

No asumir mediante constraints un alcance temporal o funcional que permanezca pendiente.

---

## 12. Migraciones

Todo cambio estructural debe realizarse mediante migraciones versionadas.

Una migración debe ser:

* reproducible;
* revisable;
* consistente;
* compatible con el estado esperado del proyecto.

Evitar cambios manuales no registrados.

Las operaciones destructivas requieren autorización explícita.

---

## 13. Seeds

Los datos iniciales deben utilizarse únicamente cuando estén definidos y sean necesarios para el entorno correspondiente.

Los seeds no deben convertirse en mecanismo para introducir reglas de negocio.

Datos temporales o de prueba deben distinguirse de datos oficiales.

---

## 14. Seguridad

La persistencia debe aplicar mínimo privilegio y proteger especialmente:

* votos;
* datos de autenticación/autorización;
* auditoría;
* resultados;
* configuraciones sensibles.

No almacenar secretos en código, migraciones o seeds.

---

## 15. Coordinación con Backend

Los cambios de base de datos que afecten contratos o comportamiento de aplicación deben coordinarse con `apps/api`.

```text id="xq8c1k"
Modelo / Regla
      │
      ▼
Backend ───────► Database
   │                 │
   └──── contrato ───┘
```

No modificar silenciosamente contratos consumidos por otros componentes.

---

## 16. Criterios de STOP

Detener el trabajo cuando exista:

* contradicción entre fuentes;
* entidad o relación no definida;
* `PEND-*` utilizado como si estuviera resuelto;
* necesidad de inventar un estado;
* necesidad de modificar datos confirmados sin regla autorizada;
* migración destructiva no autorizada;
* cambio que exceda el alcance del MVP.

> **STOP → documentar → consultar → continuar con decisión válida.**

---

## 17. Criterios de finalización

Un cambio de persistencia debe quedar:

* alineado con el modelo vigente;
* limitado al MVP;
* íntegro desde el punto de vista técnico;
* transaccional cuando corresponda;
* idempotente cuando corresponda;
* compatible con la inmutabilidad;
* migrable y reproducible;
* cubierto por pruebas apropiadas.

---

## 18. Reporte

Toda intervención debe informar:

1. objetivo;
2. alcance;
3. fuentes consultadas;
4. tablas/relaciones afectadas;
5. migraciones realizadas;
6. restricciones e índices agregados;
7. impacto en Backend;
8. pruebas ejecutadas;
9. riesgos;
10. pendientes involucrados;
11. cambios fuera de alcance;
12. estado final.

---

## 19. Restricciones absolutas

Base de Datos **NO debe**:

* inventar reglas de negocio;
* resolver `PEND-*`;
* modificar el Reglamento;
* decidir desempates;
* definir penalizaciones;
* duplicar el scoring;
* convertir decisiones pendientes en constraints obligatorios;
* introducir lógica funcional arbitraria mediante triggers;
* modificar datos productivos sin autorización;
* realizar cambios destructivos sin autorización;
* modificar otros contextos silenciosamente;
* ampliar el alcance del MVP;
* ejecutar operaciones Git prohibidas por `AGENTS.md`.

**Principio rector:**

> **Persistencia mínima, íntegra, transaccional y trazable para sostener el MVP sin convertir la base de datos en autoridad del negocio.**
