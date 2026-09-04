import { createHash, randomBytes } from "node:crypto";

const SESSION_TOKEN_BYTES = 32;

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