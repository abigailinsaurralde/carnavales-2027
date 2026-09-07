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
  /**
   * @param internalMessage Mensaje técnico (SQL/driver). Nunca se expone al
   *   cliente (handler.ts): solo se registra en logs.
   * @param pgCode SQLSTATE (p. ej. "23505") conservado para que repositorios y
   *   casos de uso puedan mapear violaciones de persistencia a errores de
   *   negocio (409/404) sin depender de mensajes localizados.
   * @param constraint Nombre del constraint de PostgreSQL violado (solo en
   *   violaciones de unicidad/FK/CHECK). Independiente del locale, a
   *   diferencia de internalMessage: permite distinguir QUÉ constraint disparó
   *   un 23505 sin parsear texto.
   */
  constructor(
    internalMessage: string,
    readonly pgCode?: string,
    readonly constraint?: string,
  ) {
    super("Database operation failed", 500, "DATABASE_ERROR");
    this.name = "DatabaseError";
    this.internalMessage = internalMessage;
  }

  readonly internalMessage: string;
}

export class UnauthorizedError extends AppError {
  constructor() {
    super("Unauthorized", 401, "UNAUTHORIZED");
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(message, 403, "FORBIDDEN");
    this.name = "ForbiddenError";
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict", code = "CONFLICT") {
    super(message, 409, code);
    this.name = "ConflictError";
  }
}

/**
 * Credenciales inválidas. Mensaje genérico e idéntico para "usuario inexistente"
 * y "contraseña incorrecta", para impedir la enumeración de cuentas.
 */
export class InvalidCredentialsError extends AppError {
  constructor() {
    super("Invalid email or password", 401, "INVALID_CREDENTIALS");
    this.name = "InvalidCredentialsError";
  }
}

export function isInternalSensitiveError(error: unknown): error is DatabaseError {
  return error instanceof DatabaseError;
}
