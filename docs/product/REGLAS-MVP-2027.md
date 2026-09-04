# VOTACIONES2027 — REGLAS CONGELADAS DEL MVP

## Sistema de Votación Digital — Carnavales Goya 2027

**Version:** MVP 1.0
**Edicion:** Carnavales Goya 2027
**Estado:** REGLAS CONGELADAS PARA IMPLEMENTACION
**Fuente primaria:** Reglamento de Carnavales Goya 2027 + decisiones funcionales adoptadas para el proyecto.

> Este documento es la FUENTE DE VERDAD FUNCIONAL del MVP.
> No debe ser reinterpretado, modificado ni completado por inferencia.

---

## 1. Principio rector

El sistema debera implementar las reglas definidas en este documento.

No se debera reinterpretar, modificar ni completar reglas de negocio por inferencia.

Cuando una regla no este definida, se debera:

1. identificarla como pendiente;
2. no inventar un comportamiento;
3. no incorporarla silenciosamente al codigo;
4. dejar constancia tecnica de la decision requerida.

---

## 2. Estructura de la competencia

### 2.1 Noches de votacion

Para la edicion 2027 se establecen:

**3 noches de votacion y competencia.**

No se deben implementar cuatro noches de votacion ni permitir configurar arbitrariamente una cantidad diferente para la edicion 2027.

```text
Carnavales Goya 2027
│
├── Noche 1 de votacion
├── Noche 2 de votacion
└── Noche 3 de votacion
```

La entidad `Noche` debera existir en el modelo para identificar cada jornada, pero la edicion 2027 debera contener exactamente **3 noches de votacion**.

---

## 3. Jurados

### 3.1 Cantidad

Total:

**9 jueces.**

Distribucion:

**3 jueces por noche.**

Cada noche tendra:

* 1 juez de Baile;
* 1 juez de Vestuario;
* 1 juez de Bateria.

```text
9 JUECES
│
├── NOCHE 1 → Baile + Vestuario + Bateria
├── NOCHE 2 → Baile + Vestuario + Bateria
└── NOCHE 3 → Baile + Vestuario + Bateria
```

### 3.2 Asignacion

El servidor debera validar que:

* un juez no tenga dos asignaciones incompatibles;
* una noche tenga exactamente un juez por especialidad;
* el juez solamente pueda votar los rubros/items correspondientes a su especialidad;
* una asignacion confirmada quede auditada.

---

## 4. Estructura de evaluacion

La unidad fundamental de evaluacion sera:

```text
Juez
  ↓
Noche
  ↓
Comparsa
  ↓
Rubro
  ↓
Item
  ↓
Candidato / elemento evaluado
  ↓
Nota
```

El sistema no debe reducir la evaluacion a:

```text
Juez → Rubro → Nota
```

cuando el reglamento exige identificar un item o candidato especifico.

---

## 5. Tipos de rubros

Los rubros se clasifican en:

### 5.1 Rubros nominativos

Participan en el calculo de:

**Comparsa Ganadora.**

Sus resultados deben formar parte del escrutinio general.

### 5.2 Rubros aleatorios

No participan del calculo de:

**Comparsa Ganadora.**

Se conservan igualmente para:

* evaluacion;
* determinacion del ganador individual del rubro;
* auditoria;
* estadisticas;
* actas y reportes correspondientes.

---

## 6. Evaluacion por jurado

Cada juez debera evaluar unicamente:

* la especialidad que le fue asignada;
* los rubros correspondientes;
* los items habilitados;
* los candidatos correctamente identificados.

El sistema debera impedir votar fuera de estas restricciones.

---

## 7. Escala de puntuacion

La escala valida es:

```text
0 → No presentado
1..10 → Evaluacion del jurado
```

Existe ademas una regla especial:

**Si el jurado omite puntuar un item que correspondia evaluar, se asigna 5.**

Por lo tanto:

|         Valor | Significado                                   |
| ------------: | --------------------------------------------- |
|             0 | El elemento/rubro no fue presentado           |
|          1–10 | Nota otorgada por el jurado                   |
| 5 por omision | Valor aplicado por subsanacion de una omision |

**No debe confundirse un 5 otorgado por el jurado con un 5 aplicado por omision.**

El sistema debera conservar la procedencia del valor.

Ejemplo:

```text
score = 5
score_source = JUDGE
```

versus:

```text
score = 5
score_source = OMISSION_CORRECTION
```

---

## 8. Prohibicion de omision voluntaria

El juez no puede decidir voluntariamente dejar un item sin puntuar.

Si corresponde evaluacion y no se registro la nota:

```text
OMISION
   ↓
DETECTAR
   ↓
SUBSANAR
   ↓
ASIGNAR 5
   ↓
AUDITAR
```

---

## 9. Descarte de notas

## Regla definitiva del MVP

**NO existe descarte de nota alta ni baja.**

No se debera implementar:

```text
descartar nota maxima
descartar nota minima
descartar una noche
descartar un juez
promediar eliminando extremos
```

El resultado del rubro sera:

```text
TOTAL_RUBRO =
NOCHE_1
+
NOCHE_2
+
NOCHE_3
```

Siempre que las tres evaluaciones correspondan a noches computables conforme a las reglas oficiales aplicables.

La nota original nunca debera modificarse para realizar calculos.

---

## 10. Inmutabilidad

Una vez confirmado un voto por el juez:

**el voto no puede ser editado ni eliminado mediante operacion normal del sistema.**

Debera conservar:

* juez;
* noche;
* comparsa;
* rubro;
* item;
* candidato;
* puntuacion;
* fecha/hora;
* dispositivo/contexto tecnico cuando corresponda;
* estado de sincronizacion;
* identificador unico;
* informacion de auditoria.

---

## 11. Offline-First

La aplicacion debera poder operar sin conexion.

El flujo sera:

```text
JUEZ
 ↓
CAPTURA
 ↓
PERSISTENCIA LOCAL
 ↓
CONFIRMACION
 ↓
VOTO INMUTABLE
 ↓
COLA DE SINCRONIZACION
 ↓
SERVIDOR
 ↓
VALIDACION
 ↓
AUDITORIA
```

La perdida de Wi-Fi o Internet no debera provocar perdida de votos ya confirmados localmente.

La sincronizacion debera ser:

* reintentable;
* idempotente;
* auditable;
* resistente a duplicados;
* capaz de recuperarse despues de una interrupcion.

---

## 12. Reemplazo de jurado

## Antes del inicio de la noche

Se podra registrar un reemplazo autorizado.

El sistema debera conservar:

```text
jurado_original
jurado_reemplazante
especialidad
noche
motivo
usuario_autorizante
fecha_hora
```

## Durante la noche

Los votos ya confirmados por el jurado original:

**NO se transfieren ni se modifican.**

El reemplazante solamente podra emitir las evaluaciones que legal/operativamente correspondan desde el momento de su incorporacion.

Todo reemplazo debera generar un evento de auditoria.

---

## 13. Penalizaciones

Las penalizaciones se deberan almacenar separadamente de los votos.

No se debera modificar la nota original del jurado.

Ejemplo:

```text
Nota artistica:       8.00
Penalizacion:         -0.50
Resultado computable:  7.50
```

Nunca:

```text
Nota original: 7.50
```

El sistema debera permitir identificar:

* motivo;
* articulo/regla aplicable;
* comparsa;
* noche;
* cantidad;
* usuario que registro la penalizacion;
* fecha/hora;
* evidencia/observacion;
* estado de aprobacion.

---

## 14. Escrutinio

El escrutinio debera ejecutarse en un orden deterministico.

```text
1. Cerrar recepcion de informacion
        ↓
2. Incorporar informes correspondientes
        ↓
3. Determinar penalizaciones
        ↓
4. Aplicar penalizaciones
        ↓
5. Procesar votos validos
        ↓
6. Calcular totales por rubro
        ↓
7. Determinar ganadores
        ↓
8. Calcular Comparsa Ganadora
        ↓
9. Resolver empates
        ↓
10. Generar acta
```

El calculo debera ser reproducible.

Con los mismos datos de entrada debera producir exactamente el mismo resultado.

---

## 15. Comparsa Ganadora

La Comparsa Ganadora se determinara utilizando los resultados de los **rubros nominativos**.

Los rubros aleatorios quedan excluidos.

Cuando un rubro permita multiples candidatos de una misma comparsa, se debera aplicar la regla correspondiente para determinar el resultado computable de esa comparsa.

Los candidatos descartados para el calculo deberan conservarse para auditoria.

---

## 16. Desempate

El desempate seguira este orden:

```text
1. Mayor cantidad de rubros nominativos ganados
        ↓
2. Ganador de Mejor Bateria
        ↓
3. Sorteo/desempate oficial
```

Todo desempate debera quedar registrado como evento auditable.

No podra alterarse manualmente el resultado final sin dejar trazabilidad.

---

## 17. Separacion de datos

El sistema debera mantener separadas:

### Evidencia original

```text
VOTO
```

### Reglas/calculos

```text
CALCULO
```

### Resultado

```text
RESULTADO
```

### Auditoria

```text
AUDIT_EVENT
```

### Penalizaciones

```text
PENALIZACION
```

Nunca se debera sobrescribir la evidencia original para producir un resultado.

---

## 18. Firma y certificacion

El MVP debera implementar:

* autenticacion;
* identificacion del usuario;
* confirmacion inequivoca;
* timestamp;
* auditoria;
* integridad/hash cuando corresponda;
* generacion del acta;
* trazabilidad de quien confirmo cada operacion.

La implementacion de una firma digital con certificado reconocido queda como decision juridica/tecnica posterior.

**No se debera afirmar que una confirmacion interna del sistema equivale juridicamente a una firma digital certificada.**

---

## 19. Auditoria

Deberan quedar auditados como minimo:

* inicio de sesion;
* asignacion de jurados;
* reemplazo de jurados;
* creacion de planillas;
* modificacion de datos permitidos;
* confirmacion de votos;
* sincronizacion;
* correcciones por omision;
* cierre de planillas;
* registro de penalizaciones;
* ejecucion de escrutinio;
* desempates;
* generacion de actas;
* acciones administrativas criticas.

Los eventos de auditoria no deberan poder modificarse mediante las operaciones normales del sistema.

---

## 20. Principio de no mutacion del resultado

El sistema debera poder reconstruir:

```text
VOTOS ORIGINALES
       +
PENALIZACIONES
       +
REGLAS DE CALCULO
       ↓
RESULTADO
```

Esto permitira que el Escribano/Veedor pueda verificar el escrutinio.

---

## 21. Estados de una planilla

Conceptualmente:

```text
BORRADOR
   ↓
EN_EVALUACION
   ↓
CONFIRMADA
   ↓
SINCRONIZADA
   ↓
CERRADA
```

Una planilla confirmada no debera regresar a `BORRADOR`.

---

## 22. Regla de oro

Este documento debe tratarse como **FUENTE DE VERDAD FUNCIONAL DEL MVP**.

No se debera:

* inventar reglas;
* agregar descarte de notas;
* modificar notas originales;
* asumir mas de 3 noches de votacion;
* permitir mas de 3 jueces por noche;
* permitir que un juez vote fuera de su especialidad;
* permitir votos duplicados;
* eliminar votos confirmados;
* calcular Comparsa Ganadora con rubros aleatorios;
* modificar resultados sin auditoria.

Ante una contradiccion entre implementacion propuesta y esta especificacion:

**detener la implementacion de esa regla y reportar la contradiccion.**

---

## 23. Parametros congelados del MVP

```typescript
const CARNAVAL_2027_RULES = {
  votingNights: 3,
  totalJudges: 9,
  judgesPerNight: 3,
  specialtiesPerNight: [
    "BAILE",
    "VESTUARIO",
    "BATERIA",
  ],
  judgesPerSpecialtyPerNight: 1,
  scoreMin: 0,
  scoreMax: 10,
  omissionScore: 5,
  discardHighest: 0,
  discardLowest: 0,
  randomRubrosCountTowardComparsaWinner: false,
  confirmedVotesMutable: false,
};
```

Estos parametros deberan estar centralizados y no dispersos en multiples componentes.

---

## 24. Estado de pendientes

| ID       | Tema                     | Estado                                          |
| -------- | ------------------------ | ----------------------------------------------- |
| PEND-001 | 3 noches de votacion     | **CERRADO**                                     |
| PEND-002 | Rubro → Item → candidato | **CERRADO**                                     |
| PEND-003 | Descarte de notas        | **CERRADO: NO EXISTE**                          |
| PEND-004 | Granularidad del voto    | **CERRADO**                                     |
| PEND-005 | Firma digital            | **MVP CERRADO / definicion juridica posterior** |
| PEND-006 | Reemplazo de jurado      | **CERRADO**                                     |

---

## 25. Proxima fase

Con estas reglas congeladas, la implementacion debera continuar en este orden:

```text
REGLAS CONGELADAS
        ↓
MODELO DE DOMINIO
        ↓
TIPOS COMPARTIDOS
        ↓
MODELO PostgreSQL
        ↓
SCORING ENGINE
        ↓
API
        ↓
OFFLINE-FIRST
        ↓
FRONTEND
        ↓
AUDITORIA
        ↓
TESTS
        ↓
E2E
```

**No comenzar directamente por las pantallas.**

El nucleo del sistema es el modelo de dominio + reglas de calculo + inmutabilidad + auditoria.