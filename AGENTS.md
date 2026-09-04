# AGENTS.md

Documento de gobernanza para el desarrollo asistido por agentes del proyecto **VOTACIONES2027**.

Define las fuentes de verdad, los límites de autonomía, las reglas de modificación, los protocolos de trabajo y los criterios de seguridad que deben respetar OpenCode y todos los agentes que trabajen sobre este repositorio.

Este documento **no define reglas de negocio ni decisiones funcionales**. Esas decisiones pertenecen a las fuentes de verdad del producto indicadas en este documento.

---

## Estructura del repositorio

```text
apps/api        → Backend
apps/client     → Frontend
database        → Persistencia / migraciones
packages        → Contratos y lógica compartida
tests           → Testing
docs            → Documentación
SKILLS          → Conocimiento especializado
```

Los `AGENTS.md` locales agregan contexto específico al presente documento global.

Los `AGENTS.md` locales **no reemplazan ni contradicen** las reglas establecidas aquí.

---

## Separación conceptual

```text
AGENTS.md
    ↓
Gobernanza, límites, alcance y reglas de operación de agentes

AGENTS.md locales
    ↓
Restricciones y contexto específico de cada área

SKILLS/
    ↓
Conocimiento especializado y procedimientos reutilizables

docs/product/
    ↓
Reglas funcionales y decisiones de negocio

docs/architecture/
    ↓
Arquitectura y decisiones técnicas derivadas

packages/
    ↓
Contratos y lógica de dominio implementada

apps/
    ↓
Aplicaciones y lógica de aplicación

database/
    ↓
Persistencia y migraciones

tests/
    ↓
Verificación automatizada
```

No duplicar innecesariamente contenido entre estas capas.

Cuando una regla ya está definida en una capa superior, las capas inferiores deben referenciarla y aplicarla, no redefinirla.

---

## Fuentes de verdad

Las decisiones del proyecto siguen esta jerarquía:

```text
1. Reglamento y acuerdos humanos aprobados
            ↓
2. docs/product/REGLAS-MVP-2027.md
            ↓
3. docs/product/PENDIENTES.md
            ↓
4. docs/architecture/**
            ↓
5. AGENTS.md y AGENTS.md locales
            ↓
6. Agentes configurados
            ↓
7. Código y tests
```

### Interpretación de la jerarquía

Las fuentes superiores establecen las decisiones que las capas inferiores deben respetar.

`docs/product/PENDIENTES.md` tiene una función particular:

* identifica decisiones que todavía están abiertas;
* impide que una decisión inexistente sea inventada durante el desarrollo;
* no constituye autorización para implementar una decisión pendiente.

Un `PEND-*` abierto significa:

```text
DECISIÓN NO DEFINIDA
        ↓
NO INVENTAR
        ↓
NO IMPLEMENTAR UNA DECISIÓN DEFINITIVA
```

La arquitectura, los agentes, el código y los tests son derivados de las decisiones funcionales y normativas.

---

## Regla crítica sobre contradicciones

OpenCode y sus agentes **NO pueden**:

* cerrar un `PEND-*`;
* reinterpretar un `PEND-*`;
* convertir una hipótesis en una decisión;
* inventar un desempate;
* asumir una regla no documentada;
* modificar `REGLAS-MVP-2027.md` para hacer coincidir el código;
* modificar `PENDIENTES.md` para justificar una implementación;
* crear una regla de negocio para resolver un error técnico;
* alterar una decisión funcional para facilitar una implementación.

Ante una contradicción material entre el Reglamento o acuerdo humano aprobado y `docs/product/REGLAS-MVP-2027.md`:

```text
CONTRADICCIÓN
      ↓
DETENER LA IMPLEMENTACIÓN AFECTADA
      ↓
IDENTIFICAR EL CONFLICTO
      ↓
REPORTARLO
      ↓
SOLICITAR DECISIÓN HUMANA
```

No resolver unilateralmente la contradicción.

---

## Pendientes

`docs/product/PENDIENTES.md` es la fuente autoritativa para determinar:

* qué `PEND-*` existen;
* cuáles permanecen abiertos;
* cuál es su descripción;
* qué impacto tienen;
* qué decisiones siguen pendientes.

**No replicar aquí una lista de `PEND-*`.**

Esto evita que `AGENTS.md` y `PENDIENTES.md` puedan quedar desincronizados.

Mientras un `PEND-*` permanezca abierto:

* no debe cerrarse automáticamente;
* no debe reinterpretarse;
* no debe eliminarse;
* no debe marcarse como resuelto;
* no debe implementarse una decisión definitiva inexistente.

Si el desarrollo puede continuar sin resolver el pendiente, solamente puede implementarse la parte que **no dependa de resolverlo**, manteniendo claramente separadas ambas cuestiones.

Si una implementación depende directamente de resolver un `PEND-*`:

```text
PENDIENTE BLOQUEANTE
        ↓
STOP
        ↓
REPORTAR
        ↓
ESPERAR DECISIÓN
```

---

## Límites de autonomía

Los agentes pueden:

* inspeccionar el repositorio;
* analizar código y documentación;
* implementar decisiones ya definidas;
* crear código dentro del alcance autorizado;
* crear tests;
* corregir errores;
* refactorizar sin alterar comportamiento;
* ejecutar validaciones;
* documentar decisiones ya tomadas;
* proponer alternativas técnicas cuando no impliquen decidir una regla de negocio.

Los agentes **NO pueden decidir unilateralmente**:

* reglas de negocio;
* interpretación del Reglamento;
* criterios de desempate;
* alcance de penalizaciones;
* comportamiento de casos excepcionales;
* contratos incompatibles;
* cambios arquitectónicos mayores;
* nuevos estados de dominio;
* nuevas transiciones de estados;
* nuevos invariantes de negocio;
* nuevos criterios de cálculo;
* cambios de persistencia con impacto funcional;
* cierre de pendientes;
* cambios de alcance del PMV.

Ante una decisión no documentada:

```text
NO INVENTAR
NO ASUMIR
NO COMPLETAR POR CRITERIO PROPIO
        ↓
DETENER LA PARTE AFECTADA
        ↓
INFORMAR
        ↓
PROPONER OPCIONES SI CORRESPONDE
        ↓
ESPERAR DECISIÓN
```

---

## Gobernanza de agentes

La arquitectura inicial de agentes está definida en:

```text
docs/architecture/AGENT-ARCHITECTURE.md
```

La arquitectura aprobada contempla:

```text
ORCHESTRATOR
├── BACKEND
├── FRONTEND
├── DATABASE
└── TESTING
```

El Orchestrator coordina el trabajo, pero **no adquiere autoridad sobre las reglas de negocio por el hecho de coordinar agentes**.

Los agentes especialistas trabajan dentro de sus contextos autorizados.

La visibilidad sobre un área no implica autorización para modificarla.

```text
VISIBILIDAD
    ≠
AUTORIZACIÓN DE MODIFICACIÓN
    ≠
AUTORIDAD DE DECISIÓN
```

Los cambios que involucren múltiples contextos deben coordinarse conforme a la arquitectura de agentes aprobada.

---

## Componentes transversales

Los siguientes componentes tienen carácter transversal:

```text
packages/shared-types
packages/scoring-engine
```

Los cambios sobre ellos pueden afectar simultáneamente a Backend, Frontend, Database y Testing.

Ningún especialista debe duplicar contratos o lógica de dominio que ya pertenezca a estos componentes.

Los cambios transversales deben identificarse y coordinarse antes de implementarse.

---

## Git

Los agentes deben preservar la seguridad y trazabilidad del trabajo.

Está prohibido:

* ejecutar `git push` automáticamente;
* ejecutar `git merge` automáticamente;
* ejecutar `git rebase` automáticamente;
* ejecutar `git reset` destructivo;
* ejecutar `git clean`;
* hacer commits sin autorización explícita;
* utilizar `git add .` como mecanismo automático de staging.

Reglas adicionales:

* trabajar por HITOS;
* inspeccionar el estado Git antes de modificar staging;
* no tocar cambios ajenos al HITO actual;
* utilizar rutas explícitas cuando corresponda;
* informar siempre qué archivos fueron modificados;
* distinguir cambios propios de cambios preexistentes.

---

## Protocolo de trabajo

Todo trabajo realizado por un agente debe seguir este ciclo:

```text
1. INSPECCIONAR
       ↓
2. DETERMINAR ALCANCE
       ↓
3. VERIFICAR REGLAS Y PENDIENTES
       ↓
4. IMPLEMENTAR SOLO LO AUTORIZADO
       ↓
5. VALIDAR
       ↓
6. REVISAR DIFF
       ↓
7. REPORTAR
```

Si durante cualquiera de estas etapas aparece una contradicción de negocio, una decisión no definida o un conflicto que requiera autoridad humana:

```text
STOP
```

No continuar con la parte afectada.

---

## Cambios fuera del alcance

Si durante un HITO se detecta una modificación necesaria pero fuera del alcance autorizado:

1. no realizarla automáticamente;
2. identificarla;
3. explicar por qué sería necesaria;
4. indicar qué componentes afectaría;
5. solicitar autorización o establecer el HITO correspondiente.

No ampliar silenciosamente el alcance de un HITO.

---

## Reporte obligatorio

Todo HITO ejecutado por OpenCode o por un agente debe terminar con un reporte que indique:

1. Objetivo.
2. Archivos inspeccionados.
3. Archivos modificados.
4. Cambios realizados.
5. Validaciones ejecutadas.
6. Resultado de las validaciones.
7. Riesgos detectados.
8. Decisiones pendientes.
9. Archivos deliberadamente NO modificados.
10. Estado de Git.
11. Si hubo o no commit.
12. Si hubo o no push.

No afirmar que algo fue validado si realmente no se ejecutó la validación.

---

## Regla de integridad

Los agentes deben privilegiar:

```text
TRAZABILIDAD
    >
AUTOMATIZACIÓN

CORRECCIÓN
    >
VELOCIDAD

DECISIÓN DOCUMENTADA
    >
SUPOSICIÓN

SEGURIDAD DEL CAMBIO
    >
ALCANCE IMPROVISADO
```

Cuando exista incertidumbre sobre una decisión funcional, arquitectónica o de alcance, el comportamiento correcto es **detenerse y reportar**, no completar la incertidumbre mediante criterio propio.
