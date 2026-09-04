import type { IncomingMessage, ServerResponse } from "node:http";
import { writeJson } from "../errors/handler.js";
import { requireUuid } from "../validation/index.js";
import type { RouteContext } from "./router.js";

export async function handleGetConfigurationVersion(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
  params: Record<string, string>,
): Promise<void> {
  const editionId = requireUuid(params["editionId"], "editionId");
  const config = await ctx.app.getConfigurationVersion.execute({ editionId });
  writeJson(res, 200, config);
}
