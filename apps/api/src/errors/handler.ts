import type { IncomingMessage, ServerResponse } from "node:http";
import { AppError, isInternalSensitiveError } from "./app-error.js";

export function handleError(
  res: ServerResponse,
  error: unknown,
  nodeEnv: string,
): void {
  if (isInternalSensitiveError(error)) {
    // Database errors may embed SQL or connection details. Never expose them
    // to the client, regardless of environment. Log the internal detail only.
    if (nodeEnv !== "test") {
      console.error("[db] DatabaseError:", error.internalMessage);
    }
    writeJson(res, error.statusCode, {
      error: { code: error.code, message: "Internal server error" },
    });
    return;
  }

  if (error instanceof AppError) {
    writeJson(res, error.statusCode, {
      error: {
        code: error.code,
        message: error.message,
      },
    });
    return;
  }

  // Never expose internal details to the client
  const message = nodeEnv === "production"
    ? "Internal server error"
    : error instanceof Error
      ? error.message
      : "Internal server error";

  writeJson(res, 500, {
    error: {
      code: "INTERNAL_ERROR",
      message,
    },
  });
}

export function writeJson(
  res: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
