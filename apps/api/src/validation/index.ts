import { ValidationError } from "../errors/app-error.js";
import { isUuid } from "./uuid.js";

export function requireUuid(value: string | undefined, name: string): string {
  if (value === undefined || !isUuid(value)) {
    throw new ValidationError(`Invalid ${name}: expected a valid UUID`);
  }
  return value;
}
