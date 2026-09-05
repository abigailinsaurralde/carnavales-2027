import type {
  AdminAssignmentResult,
  AdminCandidateResult,
  AdminComparsaResult,
  AdminContextResponse,
  AdminRubroItemResult,
  AdminRubroResult,
  AssignmentInput,
  AuthenticatedUser,
  AuthSession,
  Candidate,
  CandidateInput,
  Comparsa,
  ComparsaInput,
  ConfirmPlanillaResult,
  IssueAccessTokenRequest,
  IssueAccessTokenResponse,
  JudgeAssignmentView,
  JudgeContextResponse,
  LoginRequest,
  LoginWithAccessTokenRequest,
  Night,
  NightUpdateInput,
  PlanillaDetail,
  PlanillaSummary,
  Rubro,
  RubroInput,
  RubroItem,
  RubroItemInput,
  Vote,
  VoteUpsertPayload,
} from "@votaciones2027/shared-types";

/**
 * Contrato de resultados de las operaciones de red.
 *
 * La capa de UI aísla el error crudo (estado HTTP, cuerpo) y lo traduce al
 * idioma del usuario. `kind` distingue fallos de red/timeout de respuestas
 * HTTP de error; `body` (cuando existe) sigue el shape del backend:
 * `{ error: { code, message } }`.
 */
export type ApiResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      kind: "NETWORK" | "TIMEOUT" | "HTTP" | "UNAUTHORIZED" | "FORBIDDEN";
      status?: number;
      body?: unknown;
    };

/** Patrón del cuerpo de error estándar del backend. */
export interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

export interface ApiClientOptions {
  baseUrl: string;
  getToken: () => string | null;
  timeoutMs?: number;
  fetchFn?: FetchLike;
}

interface FetchLike {
  (url: string, init: RequestInit): Promise<Response>;
}

interface RawResponse {
  response?: Response;
  transport?: "NETWORK" | "TIMEOUT";
}

/**
 * Cliente HTTP tipado de la API, sin dependencias externas.
 *
 * - Nunca persiste el token: lo obtiene en cada llamada vía `getToken`.
 * - Normaliza los fallos de red/timeout/HTTP en `ApiResult`.
 */
export class ApiClient {
  private readonly baseUrl: string;
  private readonly getToken: () => string | null;
  private readonly timeoutMs: number;
  private readonly fetchFn: FetchLike;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl;
    this.getToken = options.getToken;
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.fetchFn =
      options.fetchFn ?? ((url: string, init: RequestInit) => fetch(url, init));
  }

  /** POST /auth/login — roles operativos (ADMIN / ESCRIBANO_VEEDOR). */
  async login(request: LoginRequest): Promise<ApiResult<AuthSession>> {
    return this.send("POST", "/auth/login", { body: request });
  }

  /**
   * POST /auth/access-token — emisión del access token temporal de un solo
   * uso para el acceso del juez (correo + DNI).
   *
   * REGLA DE SEGURIDAD: el token plano que devuelve esta respuesta se entrega
   * UNA única vez (fuera de banda, mesa de votación). El cliente NO debe
   * persistirlo ni exponerlo en la UI.
   */
  async issueAccessToken(
    request: IssueAccessTokenRequest,
  ): Promise<ApiResult<IssueAccessTokenResponse>> {
    return this.send("POST", "/auth/access-token", { body: request });
  }

  /**
   * POST /auth/access-token/login — canje del access token temporal por una
   * sesión server-side estándar. Respuesta idéntica a POST /auth/login.
   */
  async loginWithAccessToken(
    request: LoginWithAccessTokenRequest,
  ): Promise<ApiResult<AuthSession>> {
    return this.send("POST", "/auth/access-token/login", { body: request });
  }

  /** POST /auth/logout — no exige sesión válida para cerrar la sesión local. */
  async logout(): Promise<ApiResult<void>> {
    const raw = await this.request("POST", "/auth/logout");
    if (raw.response !== undefined && raw.response.status === 204) {
      return { ok: true, data: undefined };
    }
    return this.failure(raw);
  }

  /** GET /auth/me */
  async me(): Promise<ApiResult<AuthenticatedUser>> {
    return this.send("GET", "/auth/me");
  }

  /** GET /judge/context */
  async judgeContext(): Promise<ApiResult<JudgeContextResponse>> {
    return this.send("GET", "/judge/context");
  }

  /** GET /judge/planillas */
  async listPlanillas(): Promise<ApiResult<PlanillaSummary[]>> {
    return this.send("GET", "/judge/planillas");
  }

  /** GET /judge/planillas/:planillaId */
  async planilla(id: string): Promise<ApiResult<PlanillaDetail>> {
    return this.send("GET", `/judge/planillas/${encodeURIComponent(id)}`);
  }

  /** PUT /judge/planillas/:planillaId/votes/:voteId */
  async upsertVote(
    planillaId: string,
    voteId: string,
    payload: VoteUpsertPayload,
  ): Promise<ApiResult<Vote>> {
    return this.send(
      "PUT",
      `/judge/planillas/${encodeURIComponent(planillaId)}/votes/${encodeURIComponent(
        voteId,
      )}`,
      { body: payload },
    );
  }

  /** POST /judge/planillas/:planillaId/confirm */
  async confirmPlanilla(
    planillaId: string,
  ): Promise<ApiResult<ConfirmPlanillaResult>> {
    return this.send(
      "POST",
      `/judge/planillas/${encodeURIComponent(planillaId)}/confirm`,
    );
  }

  /** GET /auth/me renovado — gestión de sesión vía POST /auth/logout. */
  // Nota: no existe endpoint de "extender sesión"; la extensión del TTL ocurre
  // por actividad en el servidor ante cualquier request autenticada.

  // ---- Consola de administración (/admin/*, rol ADMIN) ----

  /** GET /admin/context */
  async adminContext(): Promise<ApiResult<AdminContextResponse>> {
    return this.send("GET", "/admin/context");
  }

  /** GET /admin/comparsas */
  async adminListComparsas(): Promise<ApiResult<Comparsa[]>> {
    return this.send("GET", "/admin/comparsas");
  }

  /** POST /admin/comparsas */
  async adminCreateComparsa(input: ComparsaInput): Promise<ApiResult<AdminComparsaResult>> {
    return this.send("POST", "/admin/comparsas", { body: input });
  }

  /** PUT /admin/comparsas/:comparsaId */
  async adminUpdateComparsa(
    comparsaId: string,
    input: ComparsaInput,
  ): Promise<ApiResult<AdminComparsaResult>> {
    return this.send("PUT", `/admin/comparsas/${encodeURIComponent(comparsaId)}`, {
      body: input,
    });
  }

  /** GET /admin/rubros */
  async adminListRubros(): Promise<ApiResult<Rubro[]>> {
    return this.send("GET", "/admin/rubros");
  }

  /** POST /admin/rubros */
  async adminCreateRubro(input: RubroInput): Promise<ApiResult<AdminRubroResult>> {
    return this.send("POST", "/admin/rubros", { body: input });
  }

  /** PUT /admin/rubros/:rubroId */
  async adminUpdateRubro(
    rubroId: string,
    input: RubroInput,
  ): Promise<ApiResult<AdminRubroResult>> {
    return this.send("PUT", `/admin/rubros/${encodeURIComponent(rubroId)}`, {
      body: input,
    });
  }

  /** GET /admin/rubros/:rubroId/items */
  async adminListRubroItems(rubroId: string): Promise<ApiResult<RubroItem[]>> {
    return this.send("GET", `/admin/rubros/${encodeURIComponent(rubroId)}/items`);
  }

  /** POST /admin/rubros/:rubroId/items */
  async adminCreateRubroItem(
    rubroId: string,
    input: RubroItemInput,
  ): Promise<ApiResult<AdminRubroItemResult>> {
    return this.send("POST", `/admin/rubros/${encodeURIComponent(rubroId)}/items`, {
      body: input,
    });
  }

  /** PUT /admin/items/:itemId */
  async adminUpdateRubroItem(
    itemId: string,
    input: RubroItemInput,
  ): Promise<ApiResult<AdminRubroItemResult>> {
    return this.send("PUT", `/admin/items/${encodeURIComponent(itemId)}`, {
      body: input,
    });
  }

  /** GET /admin/candidates */
  async adminListCandidates(): Promise<ApiResult<Candidate[]>> {
    return this.send("GET", "/admin/candidates");
  }

  /** POST /admin/candidates */
  async adminCreateCandidate(input: CandidateInput): Promise<ApiResult<AdminCandidateResult>> {
    return this.send("POST", "/admin/candidates", { body: input });
  }

  /** PUT /admin/candidates/:candidateId */
  async adminUpdateCandidate(
    candidateId: string,
    input: CandidateInput,
  ): Promise<ApiResult<AdminCandidateResult>> {
    return this.send("PUT", `/admin/candidates/${encodeURIComponent(candidateId)}`, {
      body: input,
    });
  }

  /** GET /admin/assignments */
  async adminListAssignments(): Promise<ApiResult<JudgeAssignmentView[]>> {
    return this.send("GET", "/admin/assignments");
  }

  /** POST /admin/assignments */
  async adminCreateAssignment(
    input: AssignmentInput,
  ): Promise<ApiResult<AdminAssignmentResult>> {
    return this.send("POST", "/admin/assignments", { body: input });
  }

  /** PUT /admin/assignments/:assignmentId */
  async adminUpdateAssignment(
    assignmentId: string,
    input: AssignmentInput,
  ): Promise<ApiResult<AdminAssignmentResult>> {
    return this.send("PUT", `/admin/assignments/${encodeURIComponent(assignmentId)}`, {
      body: input,
    });
  }

  /** PUT /admin/nights/:nightId */
  async adminUpdateNight(
    nightId: string,
    input: NightUpdateInput,
  ): Promise<ApiResult<Night>> {
    return this.send("PUT", `/admin/nights/${encodeURIComponent(nightId)}`, {
      body: input,
    });
  }

  // ---- Internos ----

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const token = this.getToken();
    if (token !== null) headers["authorization"] = `Bearer ${token}`;
    return headers;
  }

  private async send<T>(
    method: string,
    path: string,
    init?: { body?: unknown },
  ): Promise<ApiResult<T>> {
    const raw = await this.request(method, path, init);
    if (raw.response === undefined) return this.failure(raw);
    return this.parse<T>(raw.response);
  }

  private async request(
    method: string,
    path: string,
    init?: { body?: unknown },
  ): Promise<RawResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchFn(`${this.baseUrl}${path}`, {
        method,
        headers: this.headers(),
        ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        signal: controller.signal,
      });
      return { response };
    } catch (error) {
      if (
        typeof DOMException !== "undefined" &&
        error instanceof DOMException &&
        error.name === "AbortError"
      ) {
        return { transport: "TIMEOUT" };
      }
      return { transport: "NETWORK" };
    } finally {
      clearTimeout(timer);
    }
  }

  private async parse<T>(res: Response): Promise<ApiResult<T>> {
    if (res.status >= 200 && res.status < 300) {
      if (res.status === 204 || res.status === 200) {
        const text = await res.text();
        if (text === "") return { ok: true, data: undefined as T };
        return { ok: true, data: JSON.parse(text) as T };
      }
      const data = (await res.json()) as T;
      return { ok: true, data };
    }
    return this.toFailure(res);
  }

  private failure<T>(raw: RawResponse): ApiResult<T> {
    if (raw.transport === "TIMEOUT") {
      return { ok: false, kind: "TIMEOUT" };
    }
    return { ok: false, kind: "NETWORK" };
  }

  private async toFailure<T>(res: Response): Promise<ApiResult<T>> {
    const status = res.status;
    let body: unknown = undefined;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }
    if (status === 401) {
      return { ok: false, kind: "UNAUTHORIZED", status, body };
    }
    if (status === 403) {
      return { ok: false, kind: "FORBIDDEN", status, body };
    }
    return { ok: false, kind: "HTTP", status, body };
  }
}

/** Lee el código de error del cuerpo estándar del backend. */
export function errorCode(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const err = (body as ApiErrorBody).error;
  return err?.code;
}

/** Lee el mensaje crudo del backend (solo para diagnóstico, no para UI). */
export function errorMessage(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const err = (body as ApiErrorBody).error;
  return err?.message;
}