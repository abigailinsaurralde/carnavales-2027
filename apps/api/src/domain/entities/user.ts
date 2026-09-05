import type { AuthenticatedUser, UserRole } from "@votaciones2027/shared-types";

export interface UserAccount {
  id: string;
  email: string;
  displayName?: string;
  role: UserRole;
  /**
   * DNI del usuario (identificación de persona física, SVC2-24).
   * Solo lo poseen las cuentas cargadas con el alta de jurados; los roles
   * operativos (ADMIN / ESCRIBANO_VEEDOR) pueden no tenerlo.
   */
  dni?: string;
  /**
   * Hash scrypt de la contraseña (formato `scrypt$<salt>$<hash>`).
   * Solo lo poseen las cuentas con inicio de sesión. NUNCA se expone en
   * respuestas API.
   */
  passwordHash?: string;
}

export function toAuthenticatedUser(user: UserAccount): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    ...(user.displayName === undefined ? {} : { displayName: user.displayName }),
    ...(user.dni === undefined ? {} : { dni: user.dni }),
    role: user.role,
  };
}