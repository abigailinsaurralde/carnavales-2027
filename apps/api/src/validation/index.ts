import { ValidationError } from "../errors/app-error.js";
import { isUuid } from "./uuid.js";

export function requireUuid(value: string | undefined, name: string): string {
  if (value === undefined || !isUuid(value)) {
    throw new ValidationError(`Invalid ${name}: expected a valid UUID`);
  }
  return value;
}

export function requireUuidOpt(
  value: string | undefined,
  name: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (!isUuid(value)) {
    throw new ValidationError(`Invalid ${name}: expected a valid UUID`);
  }
  return value;
}

const MAX_SHORT_TEXT = 200;
const MAX_CODE_LENGTH = 32;
const MAX_REF_LENGTH = 512;

/**
 * Validación técnica (límite de la API) para campos `ShortText` del catálogo
 * administrativo (nombres de rubros, ítems, candidatos, comparsas). No es una
 * regla de negocio: es el límite de formato definido por el contrato del PMV.
 */
export function requireName(
  value: unknown,
  name: string,
  max = MAX_SHORT_TEXT,
): string {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.length > max
  ) {
    throw new ValidationError(
      `Invalid ${name}: expected a non-empty string up to ${max} characters`,
    );
  }
  return value.trim();
}

/** Código de comparsa: texto corto normalizado en el límite de la API. */
export function requireCode(value: unknown, name = "code"): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > MAX_CODE_LENGTH) {
    throw new ValidationError(
      `Invalid ${name}: expected a non-empty string up to ${MAX_CODE_LENGTH} characters`,
    );
  }
  return value.trim();
}

/** Índice de orden de un ítem: entero no negativo. */
export function requireOrderIndex(value: unknown, name = "orderIndex"): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new ValidationError(`Invalid ${name}: expected a non-negative integer`);
  }
  return value;
}

/** Booleano estricto para habilitación de asignaciones. */
export function requireBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") {
    throw new ValidationError(`Invalid ${name}: expected a boolean`);
  }
  return value;
}

export function requireRef(value: unknown, name: string): string {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.length > MAX_REF_LENGTH
  ) {
    throw new ValidationError(
      `Invalid ${name}: expected a non-empty string up to ${MAX_REF_LENGTH} characters`,
    );
  }
  return value;
}

export function requireRefOpt(
  value: unknown,
  name: string,
): string | undefined {
  if (value === undefined) return undefined;
  return requireRef(value, name);
}

export function requireIsoDateOpt(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new ValidationError(`Invalid ${name}: expected a valid ISO date string`);
  }
  return value;
}

/**
 * Valida un puntaje de voto (escala 0..10 con a lo sumo 1 decimal, es decir
 * múltiplo de 0.1). Números finitos únicamente.
 *
 * Precisión: `Math.round(score * 10) === score * 10` descarta decimales
 * inválidos (0.05, 8.35, 0.07, ...). Para valores JSON con un solo decimal
 * el producto por 10 retorna un entero exacto en IEEE-754.
 */
export function validateScore(value: unknown, name = "score"): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ValidationError(`Invalid ${name}: expected a finite number`);
  }
  const scaled = value * 10;
  if (Math.round(scaled) !== scaled) {
    throw new ValidationError(`Invalid ${name}: expected at most one decimal`);
  }
  const normalized = Number(value.toFixed(1));
  if (normalized < 0 || normalized > 10) {
    throw new ValidationError(`Invalid ${name}: expected a value between 0 and 10`);
  }
  return normalized;
}