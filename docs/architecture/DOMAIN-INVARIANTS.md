# VOTACIONES2027 — MATRIZ DE INVARIANTES DEL DOMINIO

**Sistema de Votación Digital — Carnavales Goya 2027**

> Este es el anexo de invariantes del modelo de dominio. Complementa a
> `docs/architecture/DOMAIN-MODEL.md`. Se mantiene separado para no recargar el documento
> principal; aquí se listan **todas** las invariantes relevantes y dónde deben garantizarse.

Leyenda de tipo:

- **Negocio**: regla derivada del reglamento o decisión funcional del MVP.
- **Integridad**: garantía estructural/consistencia de datos.
- **Seguridad**: control de acceso / inmutabilidad.
- **Auditoría**: trazabilidad.

---

## Competencia

| Invariante | Tipo | Dónde debe garantizarse | Consecuencia si falla |
| --- | --- | --- | --- |
| La competencia tiene exactamente 3 noches | Negocio | Dominio/Servidor | Rechazo de edición inválida |
| No aceptar 4ª noche | Negocio | Dominio/Servidor | Rechazo |
| Existen 9 jueces en total | Negocio | Servidor | Asignación incompleta |
| Exactamente 3 jueces por noche | Negocio | Servidor | Rechazo de asignación |
| Exactamente 3 especialidades definidas (BAILE/VESTUARIO/BATERIA) | Negocio | Dominio/Servidor | Especialidad inexistente |
| Una especialidad única por juez/noche | Negocio | Servidor | Confusión de evaluación |
| Reemplazo de juez no transfiere ni modifica votos confirmados | Negocio | Servidor | Voto mal atribuido |

## Votos

| Invariante | Tipo | Dónde debe garantizarse | Consecuencia si falla |
| --- | --- | --- | --- |
| Nota dentro de 0..10 | Negocio | Dominio/Servidor | Rechazo del voto |
| 0 = no presentado | Negocio | Dominio | Interpretación incorrecta |
| Omitido → 5 (con procedencia conservada `JUDGE` vs `OMISSION_CORRECTION`) | Negocio | Scoring Engine | Corrección no auditable |
| No confundir 5 del juez con 5 por omisión | Auditoría | Scoring Engine/Persistencia | Pérdida de trazabilidad |
| No descarte de nota alta/baja | Negocio | Scoring Engine | Resultado incorrecto |
| Las tres noches cuentan en el total | Negocio | Scoring Engine | Resultado incorrecto |
| Voto confirmado inmutable | Seguridad | Persistencia/Servidor | Corrupción de evidencia |
| No duplicación de voto `(judge, night, comparsa, rubro, item, candidate)` | Integridad | Persistencia/Servidor | Doble voto |
| Voto vinculado a `ConfigurationVersion` (`versionId`) | Integridad | Persistencia | Histórico no reconstruible |
| `syncState` no redefine regla de negocio | Arquitectura | Dominio/Servidor | Semántica contaminada |

## Candidatos

| Invariante | Tipo | Dónde debe garantizarse | Consecuencia si falla |
| --- | --- | --- | --- |
| MAX del candidato sobre el total de 3 noches | Negocio | Scoring Engine | Resultado incorrecto |
| No sumar A+B de candidatos | Negocio | Scoring Engine | Resultado inflado |
| Candidatos no seleccionados conservados | Auditoría | Persistencia | Pérdida de trazabilidad |
| Empate de candidatos no resuelto por `candidateId`/alfabético | Negocio (pendiente) | Scoring Engine | Regla de negocio inventada |
| Empate representado explícitamente | Negocio (pendiente) | Scoring Engine | Resultado falsamente resuelto |

## Rubros

| Invariante | Tipo | Dónde debe garantizarse | Consecuencia si falla |
| --- | --- | --- | --- |
| Rubros nominativos única base de Comparsa Ganadora | Negocio | Scoring Engine | Clasificación incorrecta |
| Rubros aleatorios conservan ganador individual | Negocio | Scoring Engine | Pérdida de resultado de rubro |
| Rubros aleatorios no participan del ranking general | Negocio | Scoring Engine | Clasificación incorrecta |

## Especialidad (Specialty)

| Invariante | Tipo | Dónde debe garantizarse | Consecuencia si falla |
| --- | --- | --- | --- |
| `Specialty` es entidad separada de `Rubro` | Arquitectura | Modelo | Relación conceptual incorrecta |
| Cada `JudgeAssignment` fija exactamente una `Specialty` | Integridad | Servidor | Voto fuera de dominio |
| Un juez evalúa únicamente rubros/ítems de su especialidad asignada | Negocio | Servidor | Voto fuera de dominio |

## Configuración versionada

| Invariante | Tipo | Dónde debe garantizarse | Consecuencia si falla |
| --- | --- | --- | --- |
| Todo voto confirmado se vincula a `ConfigurationVersion` (`versionId`) | Integridad | Persistencia | Histórico no reconstruible |
| Configuración versionada se congela al iniciar la competencia | Negocio | Servidor | Modificación no trazable |
| Configuración `CONGELADA` no se modifica; un cambio crea nueva versión | Integridad | Servidor | Datos históricos corrompidos |
| Intento de modificar versión `CONGELADA` se rechaza y audita | Seguridad/Auditoría | Servidor | Modificación no autorizada |
| Escrutinio se referencia a `ConfigurationVersion` congelada | Integridad | Persistencia | Reconstrucción imposible |

## Penalizaciones

| Invariante | Tipo | Dónde debe garantizarse | Consecuencia si falla |
| --- | --- | --- | --- |
| Penalización separada de la nota artística | Seguridad | Persistencia/Modelo | Contaminación de evidencia |
| Penalización aplicada solo si APROBADA | Negocio | Servidor/Scoring Engine | Descuento indebido |
| Nota original nunca modificada por penalización | Seguridad | Persistencia/Scoring Engine | Corrupción de evidencia |
| Alcance de penalización explícito (nightId presente → por noche; ausente → nivel comparas) | Integridad | Modelo/Servidor | Ambigüedad de aplicación |
| Semántica de cálculo del alcance de penalización confirmada por negocio | Negocio (pendiente) | Servidor/Scoring Engine | Aplicación incorrecta |

## Auditoría

| Invariante | Tipo | Dónde debe garantizarse | Consecuencia si falla |
| --- | --- | --- | --- |
| Eventos de auditoría son `APPEND-ONLY` e inmutables | Seguridad | Persistencia | Trazabilidad corrupta |
| Cada evento tiene `entityType` + `entityId` (multi-entidad) | Arquitectura | Modelo | Auditoría incompleta |
| Cada evento tiene `actorId` | Auditoría | Persistencia | Responsabilidad no atribuida |
| Cada evento tiene `occurredAt` (timestamp) | Auditoría | Persistencia | Orden temporal perdido |
| Eventos críticos auditables: voto, confirmación, omisión, reemplazo, penalización, escrutinio | Auditoría | Persistencia/Servidor | Trazabilidad insuficiente |
| Auditoría es capa transversal; no depende exclusivamente de `Vote` | Arquitectura | Modelo | Auditoría parcial |

## Escrutinio

| Invariante | Tipo | Dónde debe garantizarse | Consecuencia si falla |
| --- | --- | --- | --- |
| Resultados del escrutinio son derivados, no primarios | Arquitectura | Modelo/Persistencia | Fuente de verdad confundida |
| Escrutinio reproducible (mismos datos → mismo resultado) | Negocio | Scoring Engine | Resultado no auditable |
| Escrutinio reconstruible contra `ConfigurationVersion` congelada | Negocio | Persistencia | Histórico irrecuperable |
| Computado ≠ certificado | Arquitectura | Modelo | Confusión de etapas |
| `PEND-102` permanece abierto | Negocio (pendiente) | Dominio/Servidor | Sorteo falso |

---

## Propiedad de cada invariante

Las invariantes de **negocio** y de **cálculo** se garantizan hoy en el núcleo de dominio
(`packages/scoring-engine`) y en las reglas centralizadas de `packages/shared-types/rules.ts`.

Las invariantes de **persistencia/seguridad** (unicidad física, inmutabilidad de voto y de
auditoría, no duplicación a nivel de datos, penalización separada, vinculación a
`ConfigurationVersion`) se garantizarán en la capa de **persistencia/servidor** al implementar
PostgreSQL y la API; quedan documentadas aquí como requisito, no como implementación.

---

**Fin del anexo.**
