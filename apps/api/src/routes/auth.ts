import type { IncomingMessage, ServerResponse } from "node:http";
import { UnauthorizedError, ValidationError } from "../errors/app-error.js";
import { writeJson } from "../errors/handler.js";
import { readJsonBody } from "../http/body.js";
import type { RouteContext } from "./router.js";

const MAX_EMAIL_LENGTH = 254;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

function readBearerToken(req: IncomingMessage): string | null {
  const header = req.headers["authorization"];
  if (typeof header !== "string") return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match === null ? null : match[1]!;
}

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