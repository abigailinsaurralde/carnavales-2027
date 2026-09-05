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
  /**
   * DNI del usuario (identificación de persona física, SVC2-24).
   * Solo se expone cuando la cuenta lo tiene cargado; nunca es obligatorio
   * en el contrato para no romper los roles operativos (ADMIN / ESCRIBANO_VEEDOR).
   */
  dni?: string;
}

/**
 * Solicitud de emisión de access token temporal (un solo uso) para el
 * acceso del juez: correo + DNI. El token se entrega UNA vez, fuera de banda
 * (mesa de votación), y nunca se vuelve a exponer ni se persiste en claro.
 */
export interface IssueAccessTokenRequest {
  email: string;
  dni: string;
}

/**
 * Respuesta de emisión: token plano + expiración. Es el ÚNICO punto del
 * sistema en el que el token plano abandona el servidor.
 */
export interface IssueAccessTokenResponse {
  token: string;
  expiresAt: string;
}

/**
 * Canje del access token temporal: correo + DNI + token de un solo uso.
 * La respuesta reutiliza AuthSession (misma forma exacta que /auth/login).
 */
export interface LoginWithAccessTokenRequest {
  email: string;
  dni: string;
  token: string;
}

export interface AuthSession {
  token: string;
  expiresAt: string;
  user: AuthenticatedUser;
}