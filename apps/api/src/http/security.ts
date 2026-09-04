import type { IncomingMessage, ServerResponse } from "node:http";

export const ALLOWED_METHODS = ["GET", "HEAD", "POST", "OPTIONS"] as const;

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

export function applySecurityHeaders(res: ServerResponse): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(name, value);
  }
}

export function resolveCorsOrigin(
  corsOrigins: readonly string[],
  req: IncomingMessage,
): string | null {
  if (corsOrigins.includes("*")) {
    return "*";
  }
  const origin = req.headers["origin"];
  if (typeof origin === "string" && corsOrigins.includes(origin)) {
    return origin;
  }
  return null;
}

export function applyCorsHeaders(
  res: ServerResponse,
  origin: string | null,
  credentials: boolean,
): void {
  if (origin === null) {
    return;
  }
  res.setHeader("Access-Control-Allow-Origin", origin);
  if (origin !== "*") {
    res.setHeader("Vary", "Origin");
  }
  if (credentials) {
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
}

export function sendPreflight(res: ServerResponse, origin: string | null): void {
  if (origin !== null) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    if (origin !== "*") {
      res.setHeader("Vary", "Origin");
    }
  }
  res.setHeader("Access-Control-Allow-Methods", ALLOWED_METHODS.join(", "));
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Idempotency-Key",
  );
  res.statusCode = 204;
  res.end();
}
