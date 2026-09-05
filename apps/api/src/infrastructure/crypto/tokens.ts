import { createHash, randomBytes } from "node:crypto";

const SESSION_TOKEN_BYTES = 32;
const ACCESS_TOKEN_BYTES = 32;

/** Token de sesión opaco, aleatorio. Se devuelve una sola vez al cliente. */
export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
}

/**
 * Hash del token tal como se persiste. Nunca se almacena el token plano:
 * si la base se compromete, los tokens no son reutilizables.
 */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Access token temporal de un solo uso (entrega fuera de banda, mesa de
 * votación). Aleatorio seguro de 32 bytes en hex; se devuelve una única vez
 * en la respuesta de emisión y nunca se persiste en claro.
 */
export function generateAccessToken(): string {
  return randomBytes(ACCESS_TOKEN_BYTES).toString("hex");
}

/**
 * Hash del access token tal como se persiste en `access_token.token_hash`
 * (mismo patrón SHA-256 que `hashSessionToken`).
 */
export function hashAccessToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}