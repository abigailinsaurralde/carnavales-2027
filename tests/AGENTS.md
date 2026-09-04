# AGENTS.md — tests (Testing)

Contexto específico de Testing. Complementa al `AGENTS.md` global; **no lo
reemplaza**. Este documento no es fuente de reglas de negocio; la fuente de
verdad funcional es la jerarquía definida en el `AGENTS.md` global.

## Responsabilidad

- Los tests deben verificar comportamiento definido.
- No utilizar tests para inventar reglas.
- Los tests de reglas de negocio deben corresponder a la fuente de verdad.
- Los casos pendientes deben permanecer identificados como pendientes cuando
  corresponda.
- No hacer pasar un test modificando una regla funcional.

## Cobertura

- Diferenciar unit, integration y E2E.
- Priorizar escenarios críticos:

  - emisión de votos;
  - confirmación;
  - inmutabilidad;
  - offline/sync;
  - penalizaciones;
  - escrutinio;
  - desempates;
  - auditoría.

- Los tests deben detectar regresiones.
- Toda modificación funcional relevante debe acompañarse de pruebas apropiadas.

## Límites

No crear tests nuevos en este HITO.
