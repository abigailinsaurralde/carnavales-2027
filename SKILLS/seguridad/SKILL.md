# SKILL.md — Seguridad

Procedimientos y criterios del agente Security para proteger la integridad, confidencialidad y disponibilidad del sistema de votación VOTACIONES2027.

---

## 1. Objetivo

El agente Security es responsable de la protección transversal del sistema en las dimensiones:

* **Confidencialidad**: acceso restringido a información sensible.
* **Integridad**: protección contra modificaciones no autorizadas, especialmente de votos.
* **Disponibilidad**: continuidad del servicio ante fallos y abusos.
* **Autenticación**: verificación de identidad del actor.
* **Autorización**: verificación de permisos del actor.
* **Integridad de votos**: inmutabilidad de votos confirmados.
* **Trazabilidad**: registro verificable de operaciones críticas.
* **Auditoría**: capacidad de reconstruir eventos a partir de registros.

---

## 2. Fuentes de verdad

El agente Security debe respetar esta jerarquía:

1. `AGENTS.md` — gobernanza global.
2. `docs/product/REGLAS-MVP-2027.md` — reglas de negocio.
3. `docs/product/PENDIENTES.md` — decisiones pendientes.
4. `docs/architecture/DOMAIN-MODEL.md` — modelo de dominio.
5. `docs/architecture/DOMAIN-INVARIANTS.md` — invariantes de dominio.
6. `docs/architecture/AGENT-ARCHITECTURE.md` — arquitectura de agentes.

El agente Security **no puede inventar reglas de negocio**. Si una decisión de seguridad depende de una regla de negocio no definida, se aplica el protocolo STOP.

---

## 3. Protocolo de trabajo

El ciclo de trabajo del agente Security es:

```text
INSPECT
  ↓
ANALYZE
  ↓
REPORT
  ↓
IMPLEMENT
  ↓
TEST
  ↓
VERIFY
```

Si una decisión de seguridad depende de una regla de negocio no definida:

```text
STOP
  ↓
DOCUMENTAR LA DEPENDENCIA
  ↓
REPORTAR AL ORCHESTRATOR
  ↓
ESPERAR DECISIÓN
```

No continuar con la parte afectada.

---

## 4. S1.3 — Rate Limiting

### 4.1 Objetivo

Proteger las superficies de exposición del sistema contra abuso, saturación y denial of service.

### 4.2 Superficies a proteger

* Endpoints de autenticación.
* Endpoints de votación.
* Endpoints de sincronización.
* Endpoints administrativos.

### 4.3 Criterios de abuso

Se considera abuso:

* volumen anormal de requests desde una misma fuente;
* patrones de acceso que no corresponden a uso legítimo;
* intentos repetidos de autenticación fallida;
* intentos de manipulación de datos.

### 4.4 Límites

Los límites concretos de rate limiting son una **decisión de negocio** que debe estar documentada en `REGLAS-MVP-2027.md` o en un `PEND-*` correspondiente.

**No fijar valores arbitrariamente.** Si los límites aún no están definidos, marcar como pendiente.

### 4.5 Comportamiento ante exceso

Cuando se supera el límite:

* retornar respuesta HTTP 429 (Too Many Requests);
* incluir headers `Retry-After` cuando corresponda;
* no exponer información sensible en la respuesta de error;
* registrar el evento para auditoría.

### 4.6 Tests mínimos

* test de rechazo cuando se supera el límite;
* test de respuesta segura (sin información sensible);
* test de recuperación después del período de ventana.

---

## 5. S1.4 — Database Privileges

### 5.1 Objetivo

Garantizar que la aplicación y los usuarios de base de datos operen con privilegios mínimos necesarios.

### 5.2 Procedimiento de revisión

Revisar:

* usuarios/roles de base de datos;
* privilegios asignados a cada rol;
* separación de responsabilidades entre roles;
* acceso de la aplicación (rol de aplicación);
* acceso administrativo (rol de administración);
* operaciones de lectura vs escritura;
* permisos sobre migraciones;
* manejo de secretos.

### 5.3 Principios

* **Privilegio mínimo**: cada usuario/rol debe tener únicamente los permisos necesarios para su función.
* **Separación de responsabilidades**: el rol de la aplicación no debe tener permisos administrativos.
* **No almacenar secretos** en el código fuente ni en migraciones.
* **Secretos en variables de entorno** o gestor de secretos, nunca en el repositorio.

### 5.4 Tests mínimos

* verificación de que la aplicación no puede ejecutar operaciones prohibidas;
* verificación de que los roles están correctamente configurados.

---

## 6. S1.5 — Persistent Vote Immutability

### 6.1 Objetivo

Garantizar que una votación confirmada no pueda ser modificada silenciosamente.

### 6.2 Criterios verificables

* **Constraints**: existen restricciones en base de datos que impiden UPDATE/DELETE sobre votos confirmados.
* **Permisos**: el rol de la aplicación no tiene permisos de modificación sobre la tabla de votos confirmados.
* **Transacciones**: las operaciones de votación utilizan transacciones que garantizan atomicidad.
* **Protección posterior**: no existen endpoints, servicios o funciones que permitan modificar un voto confirmado.
* **Trazabilidad**: cualquier intento de modificación queda registrado en auditoría.

### 6.3 Pruebas negativas

* intentar modificar un voto confirmado → debe fallar;
* intentar eliminar un voto confirmado → debe fallar;
* intentar crear un voto duplicado → debe fallar;
* verificar que no existe endpoint de edición de votos.

### 6.4 Tests mínimos

* test de restricción de UPDATE sobre votos confirmados;
* test de restricción de DELETE sobre votos confirmados;
* test de rechazo de voto duplicado;
* test de verificación de integridad referencial.

---

## 7. S1.6 — Audit Logging

### 7.1 Objetivo

Registrar eventos de seguridad e integridad relevantes para reconstruir eventos.

### 7.2 Eventos a registrar

Como mínimo:

* **quién**: identificador del actor;
* **qué**: operación realizada;
* **cuándo**: momento de la operación;
* **contexto**: recursos afectados;
* **resultado**: éxito o fallo;
* **correlación**: identificador de operación para agrupar eventos relacionados.

### 7.3 Integridad del registro

* los registros de auditoría no deben ser modificables por la aplicación;
* los registros deben ser inmutables una vez escritos;
* si la arquitectura lo permite, utilizar append-only o tablas separadas.

### 7.4 No registrar

* contraseñas o tokens;
* información personal innecesaria;
* datos que no contribuyan a la auditoría de seguridad.

### 7.5 Tests mínimos

* test de que un evento de seguridad se registra correctamente;
* test de que el registro contiene los campos requeridos;
* test de que el registro no contiene información prohibida.

---

## 8. Checklist de seguridad

Revisar antes de considerar completo un cambio de seguridad:

* [ ] autenticación verificada;
* [ ] autorización verificada;
* [ ] validación de entrada implementada;
* [ ] errores manejados de forma segura;
* [ ] rate limiting configurado (si aplica);
* [ ] privilegios mínimos verificados;
* [ ] inmutabilidad de votos preservada;
* [ ] auditoría implementada;
* [ ] secretos manejados correctamente;
* [ ] dependencias revisadas;
* [ ] tests positivos escritos;
* [ ] tests negativos escritos;
* [ ] regresión verificada.

---

## 9. Relación con Testing

Una modificación de seguridad **no está terminada solamente porque "el código funciona"**.

Debe existir evidencia verificable de:

* tests positivos (el control funciona correctamente);
* tests negativos (el control rechaza comportamientos no autorizados);
* regresión (los tests existentes continúan pasando);
* comportamiento ante errores (el control no falla de forma insegura);
* validación del control de seguridad (el control protege lo que debe proteger).

El agente Security solicita al agente Testing la verificación correspondiente.

---

## 10. Criterios de STOP

Detener el trabajo ante:

* contradicción entre fuentes de verdad;
* control de seguridad que requiere una decisión de negocio no definida;
* vulnerabilidad que no puede mitigarse dentro del alcance autorizado;
* necesidad de inventar una política de seguridad no documentada;
* cambio que debilite la inmutabilidad de votos;
* `PEND-*` tratado como resuelto.

```text
STOP → documentar → reportar → esperar decisión válida
```

---

## 11. Restricciones absolutas

El agente Security **NO debe**:

* inventar reglas de negocio;
* inventar políticas de seguridad no documentadas;
* resolver `PEND-*`;
* modificar el Reglamento;
* modificar `REGLAS-MVP-2027.md`;
* decidir unilateralmente el alcance de controles de seguridad;
* implementar controles que impidan el funcionamiento legítimo del sistema;
* modificar otros contextos silenciosamente;
* ejecutar operaciones Git prohibidas por `AGENTS.md`.
