# PENDIENTES — Decisiones requeridas no definidas en el MVP

> Regla 1 del documento `REGLAS-MVP-2027.md`: cuando una regla no este definida,
> se identifica como pendiente, no se inventa comportamiento y se deja constancia tecnica.

Los ítems siguientes NO estan definidos en las reglas congeladas. Su implementacion
queda **bloqueada hasta que se tome una decision explicita**. No fueron incorporados
al codigo.

| ID        | Tema | Referencia en reglas | Estado | Impacto si se implementa sin decision |
| --------- | ---- | -------------------- | ------ | ------------------------------------- |
| PEND-102  | Mecanismo del paso **"Sorteo/desempate oficial"** (quien opera, como se registra como evidencia). | §16.3 | Pendiente decision | Desempate no auditado o no ejecutable |
| PEND-103  | Quien y como consigna **"No presentado" (nota 0)**: si es decision del juez o registro administrativo. | §7 | Pendiente decision | Ambiguo el origen del 0 |
| PEND-104  | **Cargas fuera de tiempo**: politica para recibir votos/planillas luego del cierre de la noche. | §14.1 | Pendiente decision | Proceso de cierre bloqueado o inconsistente |
| PEND-105  | **Correcciones excepcionales** a planillas CONFIRMADAS (procedimiento, autorizacion, trazabilidad). | §10, §14 | Pendiente decision | Contradice inmutabilidad si se hace mal |
| PEND-106  | **Contingencias de energia/conectividad** dentro del corsodromo (procedimiento especifico de la mesa de votacion). | §11 | Pendiente decision | Fluxo offline sin respaldo operativo |
| PEND-107  | **Categorias de comparsas**: las reglas congeladas no las definen; el modelo no las agrega. | - | Fuera de alcance MVP hasta definir | Modelo incompleto si sucede |
| PEND-108  | **Rol Comisario**: las reglas congeladas definen ADMIN, JUEZ y ESCRIBANO_VEEDOR. No se incorpora ningun rol adicional. | - | Fuera de alcance MVP hasta definir | Sin autorizaciones de Comisario |
| PEND-109  | **Rol autorizante de un reemplazo de jurado** (el §12 exige "usuario_autorizante" pero no fija que rol). | §12 | Pendiente decision | Reemplazos sin control de autorizacion |
| PEND-110  | **Fechas reales de las 3 noches 2027** (el modelo permite fecha nula; no se inventan fechas). | §2.1 | Pendiente dato | Query/UX de noches sin fecha |
| PEND-111  | **Rubros/items/candidatos oficiales** (catalogo real de la edicion: nombres, orden, especialidad). No se seedean valores inventados. | §4-§6 | Pendiente dato | Seeds sin catalogo de evaluacion |
| PEND-112  | **Alcance de "asignaciones incompatibles"** de un juez: el §3.2 prohibe dos asignaciones incompatibles sin definir el conjunto de incompatibilidades (misma noche / mismo dia / especialidad cruzada). | §3.2 | Pendiente decision | Validacion de asignacion incompleta |
| PEND-113  | **Hash de integridad**: que datos componen el hash de una planilla/acta (alcance, algoritmo). | §18, §20 | Pendiente tecnica | Trazabilidad sin evidencia criptografica |
| PEND-114  | **Fecha/duracion del periodo de votacion por noche** (inicio y fin de ABIERTA). | §14 | Pendiente tecnica | Cierre de recepcion indefinido |

**Regla operativa**: mientras un PEND-xxx este abierto, no se implementara el
comportamiento asociado. Si una decision falsa se incorporase, se detiene la
implementacion de esa regla y se reporta (ver §22).