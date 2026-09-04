import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthenticatedUser, VoteUpsertPayload } from "@votaciones2027/shared-types";
import { ForbiddenError, UnauthorizedError, ValidationError } from "../errors/app-error.js";
import { writeJson } from "../errors/handler.js";
import { readJsonBody } from "../http/body.js";
import { requireUuid } from "../validation/index.js";
import { readBearerToken } from "./auth.js";
import type { RouteContext } from "./router.js";

/**
 * Resuelve la sesión del Bearer token y exige el rol JUDGE.
 *
 * Modelo de seguridad (sin middleware propio):
 *   session válida → user → role → (las asignaciones se validan en cada
 *   use-case vía JudgeAssignmentRepository). Nunca se confía en IDs enviados
 *   por el cliente: `judgeId` siempre proviene del usuario autenticado.
 */
async function requireJudgeSession(
  ctx: RouteContext,
  req: IncomingMessage,
): Promise<AuthenticatedUser> {
  const token = readBearerToken(req);
  if (token === null) throw new UnauthorizedError();

  const user = await ctx.app.getSessionUser.execute({ token });
  if (user.role !== "JUDGE") {
    throw new ForbiddenError("Judge role required");
  }
  return user;
}

export async function handleGetJudgeContext(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
): Promise<void> {
  const user = await requireJudgeSession(ctx, req);
  const context = await ctx.app.judgeContext.execute({ judgeId: user.id });
  writeJson(res, 200, context);
}

export async function handleListMyPlanillas(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
): Promise<void> {
  const user = await requireJudgeSession(ctx, req);
  const planillas = await ctx.app.listMyPlanillas.execute({ judgeId: user.id });
  writeJson(res, 200, planillas);
}

export async function handleCreatePlanilla(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
): Promise<void> {
  const user = await requireJudgeSession(ctx, req);
  const body = (await readJsonBody(req)) as { nightId?: unknown };
  const rawNightId = typeof body.nightId === "string" ? body.nightId : undefined;
  const nightId = requireUuid(rawNightId, "nightId");

  const result = await ctx.app.createPlanilla.execute({
    judgeId: user.id,
    nightId,
  });
  writeJson(res, result.created ? 201 : 200, result);
}

export async function handleGetPlanilla(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
  params: Record<string, string>,
): Promise<void> {
  const user = await requireJudgeSession(ctx, req);
  const planillaId = requireUuid(params["planillaId"], "planillaId");

  const detail = await ctx.app.getPlanilla.execute({
    judgeId: user.id,
    planillaId,
  });
  writeJson(res, 200, detail);
}

export async function handleUpsertVote(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
  params: Record<string, string>,
): Promise<void> {
  const user = await requireJudgeSession(ctx, req);
  const planillaId = requireUuid(params["planillaId"], "planillaId");
  const voteId = requireUuid(params["voteId"], "voteId");

  const body = await readJsonBody(req);
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new ValidationError("Invalid request body: expected an object");
  }

  const vote = await ctx.app.upsertVote.execute({
    judgeId: user.id,
    planillaId,
    voteId,
    payload: body as VoteUpsertPayload,
  });
  writeJson(res, 200, vote);
}

export async function handleConfirmPlanilla(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
  params: Record<string, string>,
): Promise<void> {
  const user = await requireJudgeSession(ctx, req);
  const planillaId = requireUuid(params["planillaId"], "planillaId");

  const result = await ctx.app.confirmPlanilla.execute({
    judgeId: user.id,
    planillaId,
  });
  writeJson(res, 200, result);
}