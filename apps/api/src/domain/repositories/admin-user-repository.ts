import type { UserAccount } from "../entities/user.js";
import type { UserRole } from "@votaciones2027/shared-types";

/**
 * Lectura de cuentas por rol para la administración (Slice 1).
 * Listado de jueces = cuentas `JUDGE` (el alta de jurados reales llega con
 * SVC2-24 y está fuera de alcance; no se crean ni modifican cuentas aquí).
 */
export interface AdminUserRepository {
  listByRole(role: UserRole): Promise<UserAccount[]>;
}