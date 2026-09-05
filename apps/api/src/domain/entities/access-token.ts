/**
 * Access token temporal de un solo uso para el acceso del juez
 * (correo + DNI + token, SVC2-31/SVC2-10/SVC2-24).
 *
 * Modelo de seguridad (derivado de la sesión server-side existente):
 * el token plano NUNCA se persiste; la base conserva solo su SHA-256 en hex
 * (token_hash). El token se entrega una única vez, fuera de banda, y se marca
 * como usado al primer canje exitoso (used_at). `revoked_at` permite anular
 * un token emitido antes de su uso (p. ej. emisión errónea).
 */
export interface AccessToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
}