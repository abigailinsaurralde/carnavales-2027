import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  AssignmentInput,
  CandidateInput,
  ComparsaInput,
  RubroInput,
  RubroItemInput,
  NightUpdateInput,
} from "@votaciones2027/shared-types";
import { SPECIALTIES } from "@votaciones2027/shared-types";
import {
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
} from "../errors/app-error.js";
import { writeJson } from "../errors/handler.js";
import { readJsonBody } from "../http/body.js";
import {
  requireBoolean,
  requireCode,
  requireIsoDateOpt,
  requireName,
  requireOrderIndex,
  requireUuid,
  requireUuidOpt,
} from "../validation/index.js";
import { readBearerToken } from "./auth.js";
import type { RouteContext } from "./router.js";

const RUBRO_TYPES = ["NOMINATIVO", "ALEATORIO"] as const;

type RubroType = (typeof RUBRO_TYPES)[number];

async function requireAdminSession(
  ctx: RouteContext,
  req: IncomingMessage,
): Promise<{ token: string; id: string; email: string; role: string }> {
  const token = readBearerToken(req);
  if (token === null) throw new UnauthorizedError();

  const user = await ctx.app.getSessionUser.execute({ token });
  if (user.role !== "ADMIN") {
    throw new ForbiddenError("Admin role required");
  }
  return { token, id: user.id, email: user.email, role: user.role };
}

function requireObjectBody(body: unknown): void {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new ValidationError("Invalid request body: expected an object");
  }
}

function parseComparsaInput(body: Record<string, unknown>): ComparsaInput {
  return {
    code: requireCode(body.code),
    name: requireName(body.name, "name"),
  };
}

function parseRubroInput(body: Record<string, unknown>): RubroInput {
  const specialty = body.specialty;
  if (
    typeof specialty !== "string" ||
    !(SPECIALTIES as readonly string[]).includes(specialty)
  ) {
    throw new ValidationError("Invalid specialty");
  }
  const type = body.type;
  if (typeof type !== "string" || !(RUBRO_TYPES as readonly string[]).includes(type)) {
    throw new ValidationError("Invalid rubro type");
  }
  return {
    specialty: specialty as RubroInput["specialty"],
    name: requireName(body.name, "name"),
    type: type as RubroType as RubroInput["type"],
  };
}

function parseItemInput(body: Record<string, unknown>): RubroItemInput {
  return {
    name: requireName(body.name, "name"),
    orderIndex: requireOrderIndex(body.orderIndex),
  };
}

function parseCandidateInput(body: Record<string, unknown>): CandidateInput {
  return {
    itemId: requireUuid(body.itemId as string | undefined, "itemId"),
    comparsaId: requireUuid(body.comparsaId as string | undefined, "comparsaId"),
    label: requireName(body.label, "label"),
  };
}

function parseNightInput(body: Record<string, unknown>): NightUpdateInput {
  const toNullableString = (value: unknown, name: string): string | null | undefined => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const parsed = requireIsoDateOpt(value, name);
    if (parsed === undefined) throw new ValidationError(`Invalid ${name}`);
    return parsed;
  };
  const date = toNullableString(body.date, "date");
  const startsAt = toNullableString(body.startsAt, "startsAt");
  const endsAt = toNullableString(body.endsAt, "endsAt");

  if (date === undefined && startsAt === undefined && endsAt === undefined) {
    throw new ValidationError(
      "Invalid request body: at least one of date, startsAt, endsAt must be provided",
    );
  }
  if (startsAt !== undefined && endsAt !== undefined && startsAt !== null && endsAt !== null) {
    if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
      throw new ValidationError("Invalid window: endsAt must be after startsAt");
    }
  }

  const result: NightUpdateInput = {};
  if (date !== undefined) result.date = date;
  if (startsAt !== undefined) result.startsAt = startsAt;
  if (endsAt !== undefined) result.endsAt = endsAt;
  return result;
}

function parseAssignmentInput(body: Record<string, unknown>): AssignmentInput {
  return {
    judgeId: requireUuid(body.judgeId as string | undefined, "judgeId"),
    nightId: requireUuid(body.nightId as string | undefined, "nightId"),
    specialtyId: requireUuid(body.specialtyId as string | undefined, "specialtyId"),
    isEffective: requireBoolean(body.isEffective, "isEffective"),
  };
}

export async function handleGetAdminContext(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
): Promise<void> {
  await requireAdminSession(ctx, req);
  const context = await ctx.app.adminGetContext.execute({});
  writeJson(res, 200, context);
}

export async function handleListComparsas(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
): Promise<void> {
  await requireAdminSession(ctx, req);
  const items = await ctx.app.adminListComparsas.execute({});
  writeJson(res, 200, items);
}

export async function handleListRubros(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
): Promise<void> {
  await requireAdminSession(ctx, req);
  const items = await ctx.app.adminListRubros.execute({});
  writeJson(res, 200, items);
}

export async function handleListRubroItems(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
  params: Record<string, string>,
): Promise<void> {
  await requireAdminSession(ctx, req);
  const rubroId = requireUuid(params["rubroId"], "rubroId");
  const items = await ctx.app.adminListRubroItems.execute({ rubroId });
  writeJson(res, 200, items);
}

export async function handleListCandidates(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
): Promise<void> {
  await requireAdminSession(ctx, req);
  const items = await ctx.app.adminListCandidates.execute({});
  writeJson(res, 200, items);
}

export async function handleListAssignments(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
): Promise<void> {
  await requireAdminSession(ctx, req);
  const items = await ctx.app.adminListAssignments.execute({});
  writeJson(res, 200, items);
}

export async function handleCreateComparsa(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
): Promise<void> {
  const admin = await requireAdminSession(ctx, req);
  const body = await readJsonBody(req);
  requireObjectBody(body);
  const input = parseComparsaInput(body as Record<string, unknown>);
  const result = await ctx.app.adminCreateComparsa.execute({
    ...input,
    actorUserId: admin.id,
  });
  writeJson(res, 201, result);
}

export async function handleUpdateComparsa(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
  params: Record<string, string>,
): Promise<void> {
  const admin = await requireAdminSession(ctx, req);
  const comparsaId = requireUuid(params["comparsaId"], "comparsaId");
  const body = await readJsonBody(req);
  requireObjectBody(body);
  const input = parseComparsaInput(body as Record<string, unknown>);
  const result = await ctx.app.adminUpdateComparsa.execute({
    id: comparsaId,
    ...input,
    actorUserId: admin.id,
  });
  writeJson(res, 200, result);
}

export async function handleUpsertRubro(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
  params: Record<string, string>,
): Promise<void> {
  const admin = await requireAdminSession(ctx, req);
  const rubroId = requireUuidOpt(params["rubroId"], "rubroId");
  const body = await readJsonBody(req);
  requireObjectBody(body);
  const input = parseRubroInput(body as Record<string, unknown>);
  const result = await ctx.app.adminUpsertRubro.execute(
    rubroId === undefined
      ? { ...input, actorUserId: admin.id }
      : { ...input, id: rubroId, actorUserId: admin.id },
  );
  writeJson(res, result.created ? 201 : 200, result);
}

export async function handleUpsertRubroItem(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
  params: Record<string, string>,
): Promise<void> {
  const admin = await requireAdminSession(ctx, req);
  const rubroId = requireUuidOpt(params["rubroId"], "rubroId");
  const itemId = requireUuidOpt(params["itemId"], "itemId");
  const body = await readJsonBody(req);
  requireObjectBody(body);
  const input = parseItemInput(body as Record<string, unknown>);
  const result = await ctx.app.adminUpsertRubroItem.execute(
    itemId !== undefined
      ? { ...input, id: itemId, actorUserId: admin.id }
      : rubroId !== undefined
        ? { ...input, rubroId, actorUserId: admin.id }
        : { ...input, actorUserId: admin.id },
  );
  writeJson(res, result.created ? 201 : 200, result);
}

export async function handleUpsertCandidate(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
  params: Record<string, string>,
): Promise<void> {
  const admin = await requireAdminSession(ctx, req);
  const candidateId = requireUuidOpt(params["candidateId"], "candidateId");
  const body = await readJsonBody(req);
  requireObjectBody(body);
  const input = parseCandidateInput(body as Record<string, unknown>);
  const result = await ctx.app.adminUpsertCandidate.execute(
    candidateId === undefined
      ? { ...input, actorUserId: admin.id }
      : { ...input, id: candidateId, actorUserId: admin.id },
  );
  writeJson(res, result.created ? 201 : 200, result);
}

export async function handleUpdateNight(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
  params: Record<string, string>,
): Promise<void> {
  const admin = await requireAdminSession(ctx, req);
  const nightId = requireUuid(params["nightId"], "nightId");
  const body = await readJsonBody(req);
  requireObjectBody(body);
  const input = parseNightInput(body as Record<string, unknown>);
  const result = await ctx.app.adminUpdateNight.execute({
    id: nightId,
    ...input,
    actorUserId: admin.id,
  });
  writeJson(res, 200, result);
}

export async function handleUpsertAssignment(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
  params: Record<string, string>,
): Promise<void> {
  const admin = await requireAdminSession(ctx, req);
  const assignmentId = requireUuidOpt(params["assignmentId"], "assignmentId");
  const body = await readJsonBody(req);
  requireObjectBody(body);
  const input = parseAssignmentInput(body as Record<string, unknown>);
  const result = await ctx.app.adminUpsertAssignment.execute(
    assignmentId === undefined
      ? { ...input, actorUserId: admin.id }
      : { ...input, id: assignmentId, actorUserId: admin.id },
  );
  writeJson(res, result.created ? 201 : 200, result);
}