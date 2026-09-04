/**
 * Código de la edición única del PMV.
 *
 * DECISIÓN TÉCNICA (no de negocio): la aplicación no posee un concepto de
 * "edición activa" definido. La edición se resuelve buscando la
 * carnaval_edition con `code = '2027'`. La columna `code` es UNIQUE en el
 * esquema, por lo que no hay ambigüedad posible: ausencia → 404.
 */
export const EDITION_CODE_2027 = "2027";