import type { IncomingMessage, ServerResponse } from "node:http";
import { writeJson } from "../errors/handler.js";
import { requireUuid } from "../validation/index.js";
import type { RouteContext } from "./router.js";

export async function handleGetEdition(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
  params: Record<string, string>,
): Promise<void> {
  const editionId = requireUuid(params["editionId"], "editionId");
  const edition = await ctx.app.getEdition.execute({ editionId });
  writeJson(res, 200, edition);
}
