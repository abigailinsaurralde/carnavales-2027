import type { IncomingMessage } from "node:http";
import { AppError, ValidationError } from "../errors/app-error.js";

export const MAX_BODY_BYTES = 1024 * 1024;

/**
 * Lee el body de una petición y lo interpreta como JSON.
 * Limita el tamaño acumulado a MAX_BODY_BYTES (defensa extra al control de
 * Content-Length existente en el server).
 */
export function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    req.on("data", (chunk: Buffer) => {
      if (settled) return;
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        settled = true;
        req.destroy();
        reject(new AppError("Request body too large", 413, "PAYLOAD_TOO_LARGE"));
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (settled) return;
      settled = true;
      if (chunks.length === 0) {
        reject(new ValidationError("Request body is required"));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
      } catch {
        reject(new ValidationError("Invalid JSON body"));
      }
    });

    req.on("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}