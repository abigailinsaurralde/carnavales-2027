import type { IncomingMessage, ServerResponse } from "node:http";
import { UnauthorizedError, ValidationError } from "../errors/app-error.js";
import { writeJson } from "../errors/handler.js";
import { readJsonBody } from "../http/body.js";
import type { RouteContext } from "./router.js";

const MAX_EMAIL_LENGTH = 254;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;
const MAX_ACCESS_TOKEN_LENGTH = 256;

/**
 * Validación técnica de FORMATO del DNI (identificador de persona física del
 * juez, SVC2-24): 6 a 8 dígitos, sin puntos ni espacios. NO es una regla de
 * negocio: es normalización de formato en el límite de la API para comparar
 * contra `user_account.dni` de forma determinista.
 */
const DNI_PATTERN = /^\d{6,8}$/;

function readBearerToken(req: IncomingMessage): string | null {
  const header = req.headers["authorization"];
  if (typeof header !== "string") return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match === null ? null : match[1]!;
}

export { readBearerToken };

function validateEmail(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.length > MAX_EMAIL_LENGTH ||
    !value.includes("@")
  ) {
    throw new ValidationError("Invalid email");
  }
  return value;
}

function validatePassword(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < MIN_PASSWORD_LENGTH ||
    value.length > MAX_PASSWORD_LENGTH
  ) {
    throw new ValidationError("Invalid password");
  }
  return value;
}

function validateDni(value: unknown): string {
  if (typeof value !== "string") throw new ValidationError("Invalid dni");
  const dni = value.trim();
  if (!DNI_PATTERN.test(dni)) throw new ValidationError("Invalid dni");
  return dni;
}

function validateAccessToken(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.length > MAX_ACCESS_TOKEN_LENGTH
  ) {
    throw new ValidationError("Invalid token");
  }
  return value;
}

export async function handleLogin(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
): Promise<void> {
  const body = (await readJsonBody(req)) as {
    email?: unknown;
    password?: unknown;
  };
  const email = validateEmail(body.email);
  const password = validatePassword(body.password);

  const session = await ctx.app.login.execute({ email, password });
  writeJson(res, 200, session);
}

export async function handleGetSessionUser(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
): Promise<void> {
  const token = readBearerToken(req);
  if (token === null) throw new UnauthorizedError();

  const user = await ctx.app.getSessionUser.execute({ token });
  writeJson(res, 200, user);
}

export async function handleLogout(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
): Promise<void> {
  const token = readBearerToken(req);
  if (token === null) throw new UnauthorizedError();

  await ctx.app.logout.execute({ token });
  writeJson(res, 204, undefined);
}

/**
 * Emisión de access token temporal de un solo uso (correo + DNI).
 * El token plano se devuelve UNA única vez en esta respuesta (entrega fuera
 * de banda, mesa de votación); nunca se persiste ni se vuelve a exponer.
 */
export async function handleIssueAccessToken(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
): Promise<void> {
  const body = (await readJsonBody(req)) as {
    email?: unknown;
    dni?: unknown;
  };
  const email = validateEmail(body.email);
  const dni = validateDni(body.dni);

  const result = await ctx.app.issueAccessToken.execute({ email, dni });
  writeJson(res, 200, result);
}

/**
 * Canje del access token temporal (correo + DNI + token) por una sesión
 * server-side estándar. Respuesta idéntica a POST /auth/login (AuthSession).
 */
export async function handleLoginWithAccessToken(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
): Promise<void> {
  const body = (await readJsonBody(req)) as {
    email?: unknown;
    dni?: unknown;
    token?: unknown;
  };
  const email = validateEmail(body.email);
  const dni = validateDni(body.dni);
  const token = validateAccessToken(body.token);

  const session = await ctx.app.loginWithAccessToken.execute({
    email,
    dni,
    token,
  });
  writeJson(res, 200, session);
}