import type { IncomingMessage, ServerResponse } from "node:http";
import { writeJson } from "../errors/handler.js";

export function handleHealth(
  _req: IncomingMessage,
  res: ServerResponse,
): void {
  writeJson(res, 200, {
    status: "ok",
    timestamp: new Date().toISOString(),
  });
}
