export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 500,
    public readonly code: string = "INTERNAL_ERROR",
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, 404, "NOT_FOUND");
    this.name = "NotFoundError";
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400, "VALIDATION_ERROR");
    this.name = "ValidationError";
  }
}

export class DatabaseError extends AppError {
  constructor(internalMessage: string) {
    super("Database operation failed", 500, "DATABASE_ERROR");
    this.name = "DatabaseError";
    this.internalMessage = internalMessage;
  }

  readonly internalMessage: string;
}

export function isInternalSensitiveError(error: unknown): error is DatabaseError {
  return error instanceof DatabaseError;
}
