import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

export const PASSWORD_KEY_LENGTH = 64;
export const PASSWORD_SALT_LENGTH = 16;

/**
 * Hash de contraseña con scrypt (formato `scrypt$<salt hex>$<hash hex>`).
 * No es una regla de negocio: es el mecanismo técnico mínimo y seguro de
 * credenciales para el PMV (reversible, pendiente de aprobación formal).
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(PASSWORD_SALT_LENGTH);
  const derivedKey = (await scrypt(password, salt, PASSWORD_KEY_LENGTH)) as Buffer;
  return `scrypt$${salt.toString("hex")}$${derivedKey.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const parts = storedHash.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;

  const salt = Buffer.from(parts[1]!, "hex");
  const expectedKey = Buffer.from(parts[2]!, "hex");
  if (expectedKey.length !== PASSWORD_KEY_LENGTH) return false;

  const derivedKey = (await scrypt(password, salt, PASSWORD_KEY_LENGTH)) as Buffer;
  return timingSafeEqual(derivedKey, expectedKey);
}

/**
 * Hash dummy (NO es una credencial, no es un secreto): se usa para igualar el
 * coste temporal de scrypt cuando el email no existe en la base, de modo que un
 * atacante no pueda distinguir "usuario inexistente" de "contraseña inválida".
 */
export const DUMMY_PASSWORD_HASH = `scrypt$${"00".repeat(PASSWORD_SALT_LENGTH)}$${"00".repeat(PASSWORD_KEY_LENGTH)}`;