import type { AuthenticatedUser, UserRole } from "@votaciones2027/shared-types";

export interface UserAccount {
  id: string;
  email: string;
  displayName?: string;
  role: UserRole;
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
    role: user.role,
  };
}