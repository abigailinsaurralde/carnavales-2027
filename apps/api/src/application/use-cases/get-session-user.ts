import type { AuthenticatedUser } from "@votaciones2027/shared-types";
import { toAuthenticatedUser } from "../../domain/entities/user.js";
import type { SessionRepository } from "../../domain/repositories/session-repository.js";
import type { UserRepository } from "../../domain/repositories/user-repository.js";
import { UnauthorizedError } from "../../errors/app-error.js";
import { hashSessionToken } from "../../infrastructure/crypto/tokens.js";
import type { UseCase } from "../types.js";

export interface GetSessionUserInput {
  token: string;
}

export class GetSessionUser
  implements UseCase<GetSessionUserInput, AuthenticatedUser>
{
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
  ) {}

  async execute(input: GetSessionUserInput): Promise<AuthenticatedUser> {
    const tokenHash = hashSessionToken(input.token);
    const session = await this.sessions.findByTokenHash(tokenHash);

    if (
      session === null ||
      session.revokedAt !== null ||
      session.expiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedError();
    }

    const user = await this.users.findById(session.userId);
    if (user === null) {
      throw new UnauthorizedError();
    }

    return toAuthenticatedUser(user);
  }
}