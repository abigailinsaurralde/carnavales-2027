import type { IncomingMessage, ServerResponse } from "node:http";
import { writeJson } from "../errors/handler.js";
import { requireUuid } from "../validation/index.js";
import type { RouteContext } from "./router.js";

export async function handleGetNight(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
  params: Record<string, string>,
): Promise<void> {
  const nightId = requireUuid(params["nightId"], "nightId");
  const night = await ctx.app.getNight.execute({ nightId });
  writeJson(res, 200, night);
}
