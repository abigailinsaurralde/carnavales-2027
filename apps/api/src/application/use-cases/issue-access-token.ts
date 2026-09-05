import { randomUUID } from "node:crypto";
import type {
  IssueAccessTokenRequest,
  IssueAccessTokenResponse,
} from "@votaciones2027/shared-types";
import type { AccessTokenRepository } from "../../domain/repositories/access-token-repository.js";
import type { AuditRepository } from "../../domain/repositories/audit-repository.js";
import type { UserRepository } from "../../domain/repositories/user-repository.js";
import { InvalidCredentialsError } from "../../errors/app-error.js";
import {
  DUMMY_PASSWORD_HASH,
  verifyPassword,
} from "../../infrastructure/crypto/passwords.js";
import {
  generateAccessToken,
  hashAccessToken,
} from "../../infrastructure/crypto/tokens.js";
import type { UseCase } from "../types.js";

/**
 * TTL del access token temporal de un solo uso.
 *
 * Constante técnica de seguridad (parámetro reversible y documentado, no es
 * regla de negocio): ventana corta entre la emisión (mesa de votación) y el
 * canje, para acotar la ventana de reuso si el token se filtra durante la
 * entrega fuera de banda.
 */
export const ACCESS_TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutos

/**
 * Emite un access token temporal de un solo uso para el acceso del juez
 * (correo + DNI → token). SVC2-31 / SVC2-10 / SVC2-24.
 *
 * - El token plano se devuelve UNA única vez en esta respuesta y NUNCA se
 *   persiste: la base conserva solo su SHA-256 (token_hash).
 * - La auditoría registra la emisión con su expiración, pero NUNCA el token
 *   plano.
 * - Anti-enumeración: cuenta inexistente, DNI ausente, DNI incorrecto o rol
 *   no-JUDGE producen el mismo error genérico con igualación de timing
 *   (scrypt dummy), igual que Login.
 */
export class IssueAccessToken
  implements UseCase<IssueAccessTokenRequest, IssueAccessTokenResponse>
{
  constructor(
    private readonly users: UserRepository,
    private readonly accessTokens: AccessTokenRepository,
    private readonly audits: AuditRepository,
  ) {}

  async execute(input: IssueAccessTokenRequest): Promise<IssueAccessTokenResponse> {
    const email = input.email.trim().toLowerCase();
    const dni = input.dni.trim();
    const user = await this.users.findByEmail(email);

    if (user === null || user.dni === undefined || user.role !== "JUDGE") {
      // Igualar el coste temporal de scrypt para no revelar si la cuenta
      // existe (anti-enumeración por timing) y devolver el mismo error.
      await verifyPassword(dni, DUMMY_PASSWORD_HASH);
      throw new InvalidCredentialsError();
    }

    if (user.dni !== dni) {
      // DNI incorrecto: mismo error genérico e igualación de timing.
      await verifyPassword(dni, DUMMY_PASSWORD_HASH);
      throw new InvalidCredentialsError();
    }

    // Igualación de timing (anti-enumeración, NO validación): el camino de
    // ÉXITO ejecuta una verificación scrypt dummy para que su latencia sea
    // indistinguible de los caminos de fallo; así un atacante no puede
    // distinguir un par (email, dni) válido por el tiempo de respuesta.
    await verifyPassword("access-token-success", DUMMY_PASSWORD_HASH);

    const token = generateAccessToken();
    const tokenHash = hashAccessToken(token);
    const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_MS);

    await this.accessTokens.create({
      id: randomUUID(),
      userId: user.id,
      tokenHash,
      expiresAt,
    });

    await this.audits.create({
      eventType: "ACCESS_TOKEN_ISSUED",
      entityType: "USER",
      entityId: user.id,
      actorUserId: user.id,
      payload: { expiresAt: expiresAt.toISOString() },
    });

    return {
      token,
      expiresAt: expiresAt.toISOString(),
    };
  }
}