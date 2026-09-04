import type { UserRole } from "./roles.js";

/**
 * Contrato de autenticación del PMV.
 *
 * Decisión de implementación (reversible, pendiente de aprobación de negocio):
 * sesión server-side con token opaco. El token plano NUNCA se persiste: la base
 * de datos conserva solo su SHA-256.
 */

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName?: string;
  role: UserRole;
}

export interface AuthSession {
  token: string;
  expiresAt: string;
  user: AuthenticatedUser;
}