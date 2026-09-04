import type { UserAccount } from "../entities/user.js";

export interface UserRepository {
  findByEmail(email: string): Promise<UserAccount | null>;
  findById(id: string): Promise<UserAccount | null>;
}