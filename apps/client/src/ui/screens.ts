import type { Child } from "./dom.js";
import { h } from "./dom.js";
import { notice } from "./components/index.js";
import {
  ADMIN_SECTION_LABELS,
  nightLabel,
  planillaStatusLabel,
  NIGHT_STATUS_LABELS,
  RUBRO_TYPE_LABELS,
  SPECIALTY_LABELS,
} from "./vocab.js";
import { SPECIALTIES } from "@votaciones2027/shared-types";
import type {
  Candidate,
  CandidateInput,
  Comparsa,
  ComparsaInput,
  Night,
  NightUpdateInput,
  Rubro,
  RubroInput,
  RubroItem,
  RubroItemInput,
  RubroType,
  Specialty,
} from "@votaciones2027/shared-types";
import {
  syncBadgeForVote,
  type Cell,
  type DisplayVote,
  type SheetModel,
} from "./sheet.js";
import type { AdminSection } from "./router.js";
import type {
  AdminView,
  AppViewState,
  DetailView,
  PlanillaCard,
} from "../app/app.js";

export interface ScreenActions {
  login(email: string, password: string): void;
  requestAccessToken(email: string, dni: string): void;
  loginWithAccessToken(email: string, dni: string, token: string): void;
  setLoginMode(mode: "judge" | "operator"): void;
  logout(): void;
  openPlanilla(planillaId: string): void;
  createPlanilla(nightId: string): void;
  retrySync(): void;
  setScore(
    planillaId: string,
    cell: { comparsaId: string; rubroId: string; itemId: string },
    candidateId: string,
    score: number,
  ): void;
  setReviewing(on: boolean): void;
  setConfirmOpen(on: boolean): void;
  setPickedVoteKey(key: string | undefined): void;
  confirmPlanilla(): void;
  adminNavigation(section: AdminSection): void;
  adminRefresh(): void;
  adminSaveComparsa(comparsaId: string | undefined, input: ComparsaInput): void;
  adminSaveRubro(rubroId: string | undefined, input: RubroInput): void;
  adminSaveRubroItem(
    rubroId: string,
    itemId: string | undefined,
    input: RubroItemInput,
  ): void;
  adminSaveCandidate(
    candidateId: string | undefined,
    input: CandidateInput,
  ): void;
  adminSaveAssignment(
    assignmentId: string | undefined,
    input: {
      judgeId: string;
      nightId: string;
      specialtyId: string;
      isEffective: boolean;
    },
  ): void;
  adminSaveNight(nightId: string, input: NightUpdateInput): void;
}

const STATUS_TONE: Record<string, string> = {
  BORRADOR: "tone-neutral",
  EN_EVALUACION: "tone-info",
  CONFIRMADA: "tone-ok",
  SINCRONIZADA: "tone-ok",
  CERRADA: "tone-error",
  NO_PLANILLA: "",
};

const SYNC_TONE: Record<PlanillaCard["localSync"], string> = {
  ok: "tone-ok",
  pending: "tone-warn",
  syncing: "tone-info",
  error: "tone-error",
  none: "tone-neutral",
};

const SYNC_LABEL: Record<PlanillaCard["localSync"], string> = {
  ok: "Sincronizado",
  pending: "Por sincronizar",
  syncing: "Sincronizando",
  error: "Error de sincronización",
  none: "",
};

export function renderApp(
  state: AppViewState,
  actions: ScreenActions,
): Child[] {
  return [
    h("header", { className: "app" }, [
      ...renderTopBar(state, actions),
      ...(routeIs(state, "login") ? [] : [...renderNav(state, actions)]),
      ...renderMain(state, actions),
      ...(state.notice === null ? [] : [...renderNotice(state)]),
    ]),
  ];
}

function routeIs(state: AppViewState, name: string): boolean {
  return state.route.name === name;
}

function renderTopBar(state: AppViewState, actions: ScreenActions): Child[] {
  const online = state.online;
  return [
    h("div", { className: "topbar" }, [
      h("div", { className: "brand" }, "Carnavales Goya 2027"),
      h(
        "div",
        { className: "topbar-right" },
        state.user === null
          ? []
          : [
              h("span", { className: "topbar-user" }, state.user.displayName ?? state.user.email),
              h("button", {
                className: "btn btn-ghost topbar-logout",
                onClick: () => actions.logout(),
                ariaLabel: "Salir de la sesión",
              }, "Salir"),
            ],
      ),
    ]),
  ];
}

function renderNav(state: AppViewState, actions: ScreenActions): Child[] {
  const pending = state.snapshot.pending;
  const syncing = state.snapshot.syncing;
  const recoverable = state.snapshot.retryableFailed;
  const blocked = state.snapshot.blocked;
  const hasWork = pending > 0 || syncing > 0 || recoverable > 0 || blocked > 0;
  const badges: Child[] = [];
  if (syncing > 0) {
    badges.push(h("span", { className: "nav-badge" }, "Sincronizando…"));
  }
  if (pending > 0) {
    badges.push(
      h("span", { className: "nav-badge" }, `${pending} pendiente(s)`),
    );
  }
  if (recoverable > 0) {
    badges.push(
      h(
        "span",
        { className: "nav-badge tone-warn", title: "Error recuperable agotado. Usá \"Sincronizar ahora\"." },
        "Error recuperable",
      ),
    );
  }
  if (blocked > 0) {
    badges.push(
      h("span", { className: "nav-badge tone-error" }, "Operación bloqueada"),
    );
  }
  return [
    h("div", { className: "nav" }, [
      h("span", { className: `dot ${state.online ? "dot-online" : "dot-offline"}` }),
      h("span", { className: "nav-conn" }, state.online ? "Conectado" : "Desconectado"),
      ...badges,
      ...(hasWork
        ? [
            h("button", {
              className: "nav-retry btn btn-ghost",
              onClick: () => actions.retrySync(),
            }, "Sincronizar ahora"),
          ]
        : []),
      h("span", { className: "nav-spacer" }),
    ]),
  ];
}

function renderMain(state: AppViewState, actions: ScreenActions): Child[] {
  if (routeIs(state, "login")) return renderLogin(state, actions);
  if (routeIs(state, "admin")) return renderAdmin(state, actions);
  if (routeIs(state, "planilla")) {
    if (state.detail === null) {
      return [h("div", { className: "screen" }, [h("p", { className: "muted" }, "Cargando planilla…")])];
    }
    return renderPlanilla(state, actions);
  }
  return renderHome(state, actions);
}

function renderNotice(state: AppViewState): Child[] {
  const tone = state.notice?.tone ?? "info";
  return [notice({ text: state.notice?.text ?? "", tone })];
}

// ---- Login ----
//
// Acceso del juez (SVC2-31): correo + DNI + código temporal de un solo uso.
//   Paso 1 (identify): correo + DNI → "Pedir código de acceso" (emisión).
//   Paso 2 (awaiting-token): código temporal → "Entrar" (canje por sesión).
// El acceso por contraseña se conserva para roles operativos (operator).

function renderLogin(state: AppViewState, actions: ScreenActions): Child[] {
  if (state.login.mode === "operator") {
    return renderOperatorLogin(state, actions);
  }
  if (state.login.judgeStep === "awaiting-token") {
    return renderTokenStep(state, actions);
  }
  return renderIdentifyStep(state, actions);
}

function loginCard(children: Child[]): Child[] {
  return [
    h("section", { className: "screen login" }, [
      h("div", { className: "login-card" }, [
        h("h1", { className: "login-title" }, "Votación de Carnavales"),
        h("p", { className: "login-sub muted" }, "Comparsas de Goya, edición 2027"),
        ...children,
      ]),
    ]),
  ];
}

/** Paso 1 del acceso del juez: identificación (correo + DNI). */
function renderIdentifyStep(
  state: AppViewState,
  actions: ScreenActions,
): Child[] {
  let email = "";
  let dni = "";
  const onEmail = (e: Event): void => {
    email = (e.target as HTMLInputElement).value;
  };
  const onDni = (e: Event): void => {
    dni = (e.target as HTMLInputElement).value;
  };
  const submit = (e: SubmitEvent): void => {
    e.preventDefault();
    if (email === "" || dni === "") return;
    actions.requestAccessToken(email, dni);
  };
  return loginCard([
    h("form", { className: "login-form", onSubmit: submit }, [
      h("label", { className: "field" }, [
        h("span", { className: "field-label" }, "Email"),
        h("input", {
          type: "email",
          autocomplete: "email",
          inputmode: "email",
          placeholder: "tumail@ejemplo.com",
          onInput: onEmail,
        }),
      ]),
      h("label", { className: "field" }, [
        h("span", { className: "field-label" }, "DNI"),
        h("input", {
          type: "text",
          inputmode: "numeric",
          autocomplete: "off",
          placeholder: "Número de documento",
          onInput: onDni,
        }),
      ]),
      h("button", { type: "submit", className: "btn btn-primary btn-block" },
        "Pedir código de acceso"),
    ]),
    h("div", { className: "login-alt" }, [
      h("button", {
        className: "btn btn-ghost btn-block",
        onClick: () => actions.setLoginMode("operator"),
      }, "Acceso operativo con contraseña"),
    ]),
  ]);
}

/** Paso 2 del acceso del juez: canje del código temporal por sesión. */
function renderTokenStep(
  state: AppViewState,
  actions: ScreenActions,
): Child[] {
  let token = "";
  const onToken = (e: Event): void => {
    token = (e.target as HTMLInputElement).value;
  };
  const email = state.login.judgeEmail;
  const dni = state.login.judgeDni;
  const submit = (e: SubmitEvent): void => {
    e.preventDefault();
    if (token === "") return;
    actions.loginWithAccessToken(email, dni, token);
  };
  return loginCard([
    h("p", { className: "login-sub muted" }, [
      "Código de acceso emitido. Ingresá el código que te entrega la mesa de votación.",
    ]),
    h("p", { className: "login-identity muted" }, `${email} · DNI ${dni}`),
    h("form", { className: "login-form", onSubmit: submit }, [
      h("label", { className: "field" }, [
        h("span", { className: "field-label" }, "Código de acceso"),
        h("input", {
          type: "text",
          autocomplete: "one-time-code",
          placeholder: "Código de un solo uso",
          onInput: onToken,
        }),
      ]),
      h("button", { type: "submit", className: "btn btn-primary btn-block" }, "Entrar"),
    ]),
    h("div", { className: "login-alt" }, [
      h("button", {
        className: "btn btn-ghost btn-block",
        onClick: () => actions.setLoginMode("judge"),
      }, "Pedir otro código"),
      h("button", {
        className: "btn btn-ghost btn-block",
        onClick: () => actions.setLoginMode("operator"),
      }, "Acceso operativo con contraseña"),
    ]),
  ]);
}

/** Acceso por contraseña, conservado para roles operativos. */
function renderOperatorLogin(
  _state: AppViewState,
  actions: ScreenActions,
): Child[] {
  let email = "";
  let password = "";
  const onEmail = (e: Event): void => {
    email = (e.target as HTMLInputElement).value;
  };
  const onPassword = (e: Event): void => {
    password = (e.target as HTMLInputElement).value;
  };
  const submit = (e: SubmitEvent): void => {
    e.preventDefault();
    if (email === "" || password === "") return;
    actions.login(email, password);
  };
  return loginCard([
    h("form", { className: "login-form", onSubmit: submit }, [
      h("label", { className: "field" }, [
        h("span", { className: "field-label" }, "Email"),
        h("input", {
          type: "email",
          autocomplete: "email",
          inputmode: "email",
          placeholder: "tumail@ejemplo.com",
          onInput: onEmail,
        }),
      ]),
      h("label", { className: "field" }, [
        h("span", { className: "field-label" }, "Contraseña"),
        h("input", {
          type: "password",
          autocomplete: "current-password",
          placeholder: "••••••••",
          onInput: onPassword,
        }),
      ]),
      h("button", { type: "submit", className: "btn btn-primary btn-block" }, "Entrar"),
    ]),
    h("div", { className: "login-alt" }, [
      h("button", {
        className: "btn btn-ghost btn-block",
        onClick: () => actions.setLoginMode("judge"),
      }, "Volver al acceso con código"),
    ]),
  ]);
}

// ---- Home ----

function renderHome(state: AppViewState, actions: ScreenActions): Child[] {
  const context = state.context;
  const edition =
    context === null ? "Carnavales Goya 2027" : `${context.edition.name} 2027`;
  return [
    h("section", { className: "screen home" }, [
      h("div", { className: "home-head" }, [
        h("p", { className: "home-kicker muted" }, edition),
        h("h2", { className: "home-title" }, "Mis planillas"),
        h("p", { className: "muted" }, "Tocá una planilla para cargar o revisar tus notas."),
      ]),
      ...(!state.online
        ? [
            h("div", { className: "banner banner-offline" }, [
              "Estás sin conexión. Podés seguir cargando notas: se guardan en este dispositivo y se sincronizan al reconectar.",
            ]),
          ]
        : []),
      h("div", { className: "plist" }, renderPlanillaCards(state, actions)),
    ]),
  ];
}

function renderPlanillaCards(
  state: AppViewState,
  actions: ScreenActions,
): Child[] {
  if (state.planillas.length === 0) {
    return [h("p", { className: "muted empty-state" }, "No tenés planillas asignadas todavía.")];
  }
  return state.planillas.map((card) => {
    if (card.planillaId === "") {
      return renderCreateCard(card, actions);
    }
    const statusLabel = planillaStatusLabel(card.status);
    const specialty = SPECIALTY_LABELS[card.specialty as keyof typeof SPECIALTY_LABELS] ?? card.specialty;
    return h("button", {
      className: "card planilla-card",
      onClick: () => actions.openPlanilla(card.planillaId),
      ariaLabel: `Abrir planilla ${nightLabel(card.nightNumber)} · ${specialty}`,
    }, [
      h("div", { className: "planilla-card-head" }, [
        h("span", { className: "planilla-night" }, nightLabel(card.nightNumber)),
        h("span", { className: "planilla-specialty" }, specialty),
      ]),
      h("div", { className: "planilla-card-row" }, [
        h("span", { className: `badge ${STATUS_TONE[card.status] ?? ""}` }, statusLabel),
        `${card.votesCount} nota(s)`,
      ]),
h("div", { className: "planilla-card-row meta" }, [
      ...(SYNC_TONE[card.localSync] !== SYNC_TONE.ok
        ? [
            h(
              "span",
              { className: `badge ${SYNC_TONE[card.localSync]}` },
              SYNC_LABEL[card.localSync],
            ),
          ]
        : []),
      ...(card.isLocalOnly
        ? [h("span", { className: "muted" }, "Guardada en este dispositivo")]
        : []),
    ]),
    ]);
  });
}

function renderCreateCard(card: PlanillaCard, actions: ScreenActions): HTMLElement {
  const specialty =
    SPECIALTY_LABELS[card.specialty as keyof typeof SPECIALTY_LABELS] ?? card.specialty;
  return h("div", { className: "card create-card" }, [
    h("div", { className: "planilla-card-head" }, [
      h("span", { className: "planilla-night" }, nightLabel(card.nightNumber)),
      h("span", { className: "planilla-specialty" }, specialty),
    ]),
    h("p", { className: "muted" }, "Todavía no creaste la planilla para esta noche."),
    h("button", {
      className: "btn btn-primary",
      onClick: () => actions.createPlanilla(card.nightId),
    }, "Crear planilla"),
  ]);
}

// ---- Detalle / hoja de notas ----

function renderPlanilla(state: AppViewState, actions: ScreenActions): Child[] {
  const d = state.detail;
  if (d === null) return [];
  const editable = d.status === "BORRADOR" || d.status === "EN_EVALUACION";
  const specialty =
    SPECIALTY_LABELS[d.specialty as keyof typeof SPECIALTY_LABELS] ?? d.specialty;
  const statusLabel = planillaStatusLabel(d.status);
  const syncLabel = chipForSync(d.planillaSync, d.planillaFailure);
  const failureTitle =
    d.planillaFailure?.message === undefined
      ? {}
      : { title: d.planillaFailure.message };

  return [
    h("section", { className: "screen planilla" }, [
      h("div", { className: "planilla-head" }, [
        h("div", { className: "planilla-head-titles" }, [
          h("h2", { className: "planilla-title" }, `${nightLabel(d.nightNumber)} · ${specialty}`),
          h("div", { className: "planilla-badges" }, [
            h("span", { className: `badge ${STATUS_TONE[d.status] ?? ""}` }, statusLabel),
            ...(syncLabel === null
              ? []
              : [
                  h(
                    "span",
                    { className: `badge ${syncLabel.tone}`, ...failureTitle },
                    syncLabel.label,
                  ),
                ]),
          ]),
        ]),
        h(
          "button",
          {
            className: "btn btn-ghost",
            onClick: () => actions.setReviewing(true),
            disabled: !editable,
          },
          "Revisar planilla",
        ),
      ]),
      h("div", { className: "planilla-summary muted" }, [
        `${d.sheet.scoredCount} nota(s) cargadas`,
        d.sheet.omissionsCount > 0 ? ` · ${d.sheet.omissionsCount} ítem(s) sin nota` : "",
      ]),
      ...renderRubroTotalsInfo(d),
      ...(d.nightWindow !== undefined ? renderNightWindow(d) : []),
      ...(d.blockedReasons.length > 0
        ? [h("div", { className: "banner banner-warn" }, d.blockedReasons.join(" "))]
        : []),
      ...(editable ? renderSheet(d, actions) : renderReadonlyNote(d)),
      ...renderFooter(d, actions),
      ...(d.pickedVoteKey !== undefined ? renderPicker(d, actions) : []),
      ...(d.confirmOpen ? renderConfirmDialog(d, actions) : []),
      ...(d.reviewing ? renderReview(d, actions) : []),
    ]),
  ];
}

function renderReadonlyNote(d: DetailView): Child[] {
  return [
    h("div", { className: "readonly-note" }, [
      "Esta planilla ya está confirmada. Las notas que figuran son las definitivas y no pueden modificarse.",
    ]),
    ...renderAuthoritativeRubroTotals(d),
  ];
}

/**
 * Líneas informativas (no oficiales) por rubro de la fase de carga/revisión:
 * subtotal cargado por el jurado y conteo de pendientes de ese rubro.
 * Solo lectura, no destacadas como resultado oficial.
 */
function renderRubroTotalsInfo(d: DetailView): Child[] {
  if (d.sheet.rubroTotals.length === 0) return [];
  return [
    h("div", { className: "rubro-totals muted", role: "note" }, [
      ...d.sheet.rubroTotals.map(
        (r) =>
          h("div", { className: "rubro-total" }, [
            h("span", { className: "rubro-total-name" }, r.rubroName),
            h("span", { className: "rubro-total-value" },
              `subtotal ${r.total}` +
              (r.pending > 0 ? ` · ${r.pending} sin nota` : "")),
          ]),
      ),
    ]),
  ];
}

/**
 * Totales por rubro AUTORITATIVOS post-confirmación, devueltos por el
 * servidor en `ConfirmPlanillaResult.rubroTotals`. Se muestran como resultado
 * oficial cuando la confirmación ocurrió desde este dispositivo.
 */
function renderAuthoritativeRubroTotals(d: DetailView): Child[] {
  if (d.confirmedRubroTotals === null || d.confirmedRubroTotals.length === 0) {
    return [];
  }
  return [
    h("div", { className: "rubro-totals rubro-totals-confirmed" }, [
      h("p", { className: "rubro-totals-title" }, "Totales por rubro (oficial)"),
      ...d.confirmedRubroTotals.map(
        (t) =>
          h("div", { className: "rubro-total" }, [
            h("span", { className: "rubro-total-name" }, t.rubroName),
            h("span", { className: "rubro-total-value" }, `total ${t.total}`),
          ]),
      ),
    ]),
  ];
}

/**
 * Totales por rubro en la vista de revisión: informativos durante la carga
 * (subtotal del jurado + pendientes) y autoritativos post-confirmación.
 */
function renderReviewRubroTotals(d: DetailView): Child[] {
  if (d.confirmedRubroTotals !== null && d.confirmedRubroTotals.length > 0) {
    return renderAuthoritativeRubroTotals(d);
  }
  return renderRubroTotalsInfo(d);
}

/** Ventana de votación de la noche como texto informativo NO autoritativo. */
function renderNightWindow(d: DetailView): Child[] {
  return [
    h("div", { className: "night-window muted" },
      `Ventana de votación: ${formatWindow(d.nightWindow!)}`),
  ];
}

function formatWindow(w: {
  startsAt: string | undefined;
  endsAt: string | undefined;
}): string {
  const start = w.startsAt === undefined ? "—" : shortDateTime(w.startsAt);
  const end = w.endsAt === undefined ? "—" : shortDateTime(w.endsAt);
  return `${start} → ${end}`;
}

function shortDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function chipForSync(
  sync: string,
  failure: { retryable: boolean; message: string } | null | undefined,
): { label: string; tone: string } | null {
  switch (sync) {
    case "pending":
      return { label: "Por sincronizar", tone: "tone-warn" };
    case "syncing":
      return { label: "Sincronizando", tone: "tone-info" };
    case "error":
      // F4: un error con diagnóstico retryable=false es una operación
      // BLOQUEADA; retryable=true un error recuperable agotado. Nunca se
      // etiqueta un error recuperable como "bloqueado".
      if (failure != null && failure.retryable) {
        return { label: "Error recuperable", tone: "tone-warn" };
      }
      if (failure != null) {
        return { label: "Operación bloqueada", tone: "tone-error" };
      }
      return { label: "Error de sincronización", tone: "tone-error" };
    default:
      return null;
  }
}

function renderSheet(
  d: DetailView,
  actions: ScreenActions,
): Child[] {
  const editable = d.status === "BORRADOR" || d.status === "EN_EVALUACION";
  return [
    h("div", { className: "sheet" }, [
      h("p", { className: "sheet-help muted" },
        "Notas de 0 a 10. 0 = no se presentó. Tocá la nota para cambiarla."),
      ...d.sheet.rows.map((row) =>
        h("div", { className: "card comparsa-card" }, [
          h("div", { className: "comparsa-name" }, row.comparsa.name),
          ...row.cells.map((cell) => {
            if (cell === null) return null;
            const vote = cell.vote;
            const label = vote === null ? "—" : String(vote.score);
            const tone =
              vote === null
                ? ""
                : vote.syncState === "PENDING"
                  ? "pill-pending"
                  : vote.syncState === "FAILED"
                    ? "pill-error"
                    : "pill-ok";
            return h("div", { className: "item-row" }, [
              h("span", { className: "item-name" },
                d.sheet.items.find((i) => i.id === cell!.itemId)?.name ?? itemLabel(d.sheet, cell!.itemId)),
              editable
                ? h("button", {
                    className: `btn score-btn ${tone}`,
                    onClick: () => actions.setPickedVoteKey(cell!.candidateId!),
                    ariaLabel: `Cambiar nota de ${row.comparsa.name} · ${itemLabel(d.sheet, cell!.itemId)}`,
                  }, label)
                : h("span", {
                    className: `score-static ${tone}`,
                  }, label),
              ...(vote !== null && vote.syncState !== "SYNCED" && editable
                ? [
                    h("span", { className: "item-sync muted", title: syncBadgeForVote(vote).label },
                      syncBadgeForVote(vote).label),
                  ]
                : []),
            ]);
          }),
        ]),
      ),
    ]),
  ];
}

function itemLabel(sheet: SheetModel, itemId: string): string {
  const item = sheet.items.find((i) => i.id === itemId);
  if (item !== undefined) return item.name;
  return "Ítem";
}

function renderFooter(
  d: DetailView,
  actions: ScreenActions,
): Child[] {
  const editable = d.status === "BORRADOR" || d.status === "EN_EVALUACION";
  if (!editable) {
    return [
      h("div", { className: "footer-note" }, [
        "Esta planilla está confirmada y no puede modificarse.",
      ]),
    ];
  }
  return [
    h("div", { className: "detail-actions" }, [
      h("button", {
        className: "btn btn-danger",
        onClick: () => actions.setConfirmOpen(true),
        disabled: !d.canConfirm,
        ...(d.canConfirm ? {} : { title: d.blockedReasons.join(" ") }),
      }, "Confirmar planilla"),
    ]),
  ];
}

// ---- Picker de notas ----

function renderPicker(
  d: DetailView,
  actions: ScreenActions,
): Child[] {
  const cell = findCellByCandidate(d.sheet, d.pickedVoteKey!);
  const current = cell?.vote?.score ?? null;
  const comparsaName = cell
    ? d.sheet.comparsas.find((c) => c.id === cell.comparsaId)?.name ?? ""
    : "";
  const itemName = cell
    ? d.sheet.items.find((i) => i.id === cell.itemId)?.name ?? ""
    : "";

  const scores = Array.from({ length: 11 }, (_, i) => i);
  return [
    h("div", { className: "overlay" }, [
      h("section", { className: "picker card", role: "dialog", ariaLabel: "Elegir nota" }, [
        h("div", { className: "picker-head" }, [
          h("p", { className: "picker-title" }, `${comparsaName} · ${itemName}`),
          h("p", { className: "muted" }, current === null ? "Sin nota todavía" : `Nota actual: ${current}`),
        ]),
        h("div", { className: "picker-grid" }, [
          ...scores.map((score) =>
            h("button", {
              className: `picker-score ${score === current ? "selected" : ""}`,
              onClick: () => {
                actions.setScore(
                  d.planillaId,
                  { comparsaId: cell!.comparsaId, rubroId: cell!.rubroId, itemId: cell!.itemId },
                  cell!.candidateId!,
                  score,
                );
                actions.setPickedVoteKey(undefined);
              },
              ariaLabel: `Nota ${score}`,
            }, String(score)),
          ),
        ]),
        h("div", { className: "picker-actions" }, [
          h("button", {
            className: "btn btn-ghost",
            onClick: () => actions.setPickedVoteKey(undefined),
          }, "Cerrar"),
          h("span", { className: "picker-help muted" }, "0 = no se presentó · Sin nota = se computa 5"),
        ]),
      ]),
    ]),
  ];
}

function findCellByCandidate(
  sheet: SheetModel,
  candidateId: string,
): Cell | null {
  for (const row of sheet.rows) {
    for (const cell of row.cells) {
      if (cell !== null && cell.candidateId === candidateId) {
        return cell;
      }
    }
  }
  return null;
}

// ---- Revisión ----

function renderReview(
  d: DetailView,
  actions: ScreenActions,
): Child[] {
  const scored = d.sheet.votes.filter((v) => v.score !== null);
  return [
    h("div", { className: "overlay" }, [
      h("section", { className: "review card", role: "dialog", ariaLabel: "Revisión de la planilla" }, [
        h("div", { className: "review-head" }, [
          h("h3", { className: "review-title" }, "Revisión de la planilla"),
          h("p", { className: "muted" }, `${scored.length} nota(s) · ${d.sheet.omissionsCount} ítem(s) sin nota`),
        ]),
        h("div", { className: "review-list" }, [
          ...scored.map((v) => {
            const comparsa = d.sheet.comparsas.find((c) => c.id === v.comparsaId);
            const item = d.sheet.items.find((i) => i.id === v.itemId);
            return h("div", { className: "review-item" }, [
              h("span", { className: "review-name" }, `${comparsa?.name ?? ""} · ${item?.name ?? ""}`),
              h("span", { className: "review-score" }, String(v.score)),
            ]);
          }),
        ]),
        ...(d.sheet.omissionsCount > 0
          ? [
              h("p", { className: "review-omissions muted" },
                `${d.sheet.omissionsCount} ítem(s) quedaron sin nota: al confirmar se computan con 5 por omisión.`),
            ]
          : []),
        ...renderReviewRubroTotals(d),
        h("div", { className: "review-actions" }, [
          h("button", { className: "btn btn-secondary", onClick: () => actions.setReviewing(false) },
            "Volver a las notas"),
          h("button", {
            className: "btn btn-danger",
            onClick: () => {
              actions.setReviewing(false);
              actions.setConfirmOpen(true);
            },
            disabled: !d.canConfirm,
          }, "Confirmar planilla"),
        ]),
      ]),
    ]),
  ];
}

// ---- Diálogo de confirmación ----

function renderConfirmDialog(
  d: DetailView,
  actions: ScreenActions,
): Child[] {
  const scored = d.sheet.votes.filter((v) => v.score !== null).length;
  return [
    h("div", { className: "overlay" }, [
      h("section", { className: "confirm card", role: "dialog", ariaLabel: "Confirmación de la planilla" }, [
        h("h3", { className: "confirm-title" }, "¿Confirmar la planilla?"),
        h("p", { className: "confirm-text" }, [
          "Al confirmar, ",
          h("strong", {}, `${scored} nota(s)`),
          " quedarán fijas de forma definitiva y ",
          h("strong", {}, "no podrás modificarlas"),
          d.sheet.omissionsCount > 0
            ? ` (además se completarán ${d.sheet.omissionsCount} ítem(s) con nota 5 por omisión).`
            : ".",
        ]),
        h("div", { className: "confirm-actions" }, [
          h("button", {
            className: "btn btn-secondary",
            onClick: () => actions.setConfirmOpen(false),
            disabled: d.busy,
          }, "Volver"),
          h("button", {
            className: "btn btn-danger",
            onClick: () => actions.confirmPlanilla(),
            disabled: d.busy,
          }, d.busy ? "Confirmando…" : "Confirmar definitivamente"),
        ]),
      ]),
    ]),
  ];
}

// ---- Admin ----

const RUBRO_TYPES: readonly RubroType[] = ["NOMINATIVO", "ALEATORIO"];

function renderAdmin(state: AppViewState, actions: ScreenActions): Child[] {
  const section =
    state.route.name === "admin" ? state.route.section : "overview";
  const admin = state.admin;
  return [
    h("section", { className: "screen admin" }, [
      h("div", { className: "home-head" }, [
        h("p", { className: "home-kicker muted" }, "Administración · Carnavales Goya 2027"),
        h("h2", { className: "home-title" }, "Panel de administración"),
      ]),
      h("nav", { className: "admin-tabs" }, [
        ...(Object.keys(ADMIN_SECTION_LABELS) as AdminSection[]).map((s) =>
          h("button", {
            className: `admin-tab ${section === s ? "active" : ""}`,
            onClick: () => actions.adminNavigation(s),
            ariaLabel: ADMIN_SECTION_LABELS[s],
          }, ADMIN_SECTION_LABELS[s]),
        ),
      ]),
      ...(admin.busy ? [h("div", { className: "banner banner-warn" }, "Guardando…")] : []),
      ...renderAdminSection(admin, section, actions),
    ]),
  ];
}

function renderAdminSection(
  admin: AdminView,
  section: AdminSection,
  actions: ScreenActions,
): Child[] {
  if (admin.context === null && section !== "overview") {
    return [h("p", { className: "muted" }, "Cargando datos…")];
  }
  switch (section) {
    case "comparsas":
      return renderAdminComparsas(admin, actions);
    case "rubros":
      return renderAdminRubros(admin, actions);
    case "candidates":
      return renderAdminCandidates(admin, actions);
    case "nights":
      return renderAdminNights(admin, actions);
    case "assignments":
      return renderAdminAssignments(admin, actions);
    case "overview":
    default:
      return renderAdminOverview(admin, actions);
  }
}

function renderAdminOverview(
  admin: AdminView,
  actions: ScreenActions,
): Child[] {
  const context = admin.context;
  if (context === null) {
    return [h("p", { className: "muted" }, "Cargando datos…")];
  }
  const counts = context.counts;
  const stats: Array<{ label: string; value: number; section: AdminSection }> = [
    { label: "Comparsas", value: counts.comparsas, section: "comparsas" },
    { label: "Rubros", value: counts.rubros, section: "rubros" },
    { label: "Candidatos", value: counts.candidates, section: "candidates" },
    { label: "Asignaciones", value: counts.assignments, section: "assignments" },
  ];
  return [
    h("div", { className: "admin-stats" }, [
      ...stats.map((s) =>
        h("button", {
          className: "card admin-stat",
          onClick: () => actions.adminNavigation(s.section),
          ariaLabel: `Abrir sección ${s.label}`,
        }, [
          h("span", { className: "admin-stat-value" }, String(s.value)),
          h("span", { className: "admin-stat-label" }, s.label),
        ]),
      ),
    ]),
    h("div", { className: "admin-panel" }, [
      h("h3", { className: "admin-panel-title" }, "Jueces"),
      h("ul", { className: "admin-plain-list" }, [
        ...context.judges.map((j) =>
          h("li", { className: "admin-plain-row" }, [
            h("span", { className: "admin-plain-main" }, j.displayName ?? j.email),
            h("span", { className: "muted" }, j.email),
          ]),
        ),
      ]),
      h("p", { className: "muted" },
        "El alta de jurados reales llega con SVC2-24 (fuera del alcance de este panel)."),
    ]),
    h("div", { className: "admin-panel" }, [
      h("h3", { className: "admin-panel-title" }, "Noches"),
      h("ul", { className: "admin-plain-list" }, [
        ...context.nights.map((n) =>
          h("li", { className: "admin-plain-row" }, [
            nightLabel(n.number),
            h("span", { className: "muted" },
              NIGHT_STATUS_LABELS[n.status] ?? n.status),
          ]),
        ),
      ]),
    ]),
    h("div", { className: "admin-panel" }, [
      h("h3", { className: "admin-panel-title" }, "Especialidades"),
      h("ul", { className: "admin-plain-list" }, [
        ...context.specialties.map((s) =>
          h("li", { className: "admin-plain-row" }, [
            h("span", { className: "admin-plain-main" }, SPECIALTY_LABELS[s.code] ?? s.code),
          ]),
        ),
      ]),
    ]),
  ];
}

function renderAdminComparsas(
  admin: AdminView,
  actions: ScreenActions,
): Child[] {
  return [
    ...admin.comparsas.map((c) => comparsaCard(admin.busy, actions, c)),
    ...(admin.comparsas.length === 0
      ? [h("p", { className: "muted empty-state" }, "Todavía no hay comparsas.")]
      : []),
    comparsaCard(admin.busy, actions, null),
  ];
}

function comparsaCard(
  busy: boolean,
  actions: ScreenActions,
  item: Comparsa | null,
): Child {
  let code = item?.code ?? "";
  let name = item?.name ?? "";
  return adminCard(
    item === null ? "Nueva comparsa" : `Comparsa · ${item.code}`,
    [
      adminForm(
        [
          field("Código", textControl(code, "Código (ej: L03)", (v) => { code = v; })),
          field("Nombre", textControl(name, "Nombre de la comparsa", (v) => { name = v; })),
        ],
        item === null ? "Crear comparsa" : "Guardar cambios",
        () => actions.adminSaveComparsa(item === null ? undefined : item.id, { code, name }),
        busy,
      ),
    ],
  );
}

function renderAdminRubros(
  admin: AdminView,
  actions: ScreenActions,
): Child[] {
  return [
    ...admin.rubros.map((r) => rubroCard(admin, actions, r)),
    ...(admin.rubros.length === 0
      ? [h("p", { className: "muted empty-state" }, "Todavía no hay rubros.")]
      : []),
    rubroCard(admin, actions, null),
  ];
}

function rubroCard(
  admin: AdminView,
  actions: ScreenActions,
  rubro: Rubro | null,
): Child {
  let specialty = (rubro?.specialty ?? "BAILE") as Specialty;
  let name = rubro?.name ?? "";
  let type = (rubro?.type ?? "NOMINATIVO") as RubroType;
  const specialtyOptions = SPECIALTIES.map((s) => ({
    value: s,
    label: SPECIALTY_LABELS[s],
  }));
  const typeOptions = RUBRO_TYPES.map((t) => ({
    value: t,
    label: RUBRO_TYPE_LABELS[t],
  }));

  const children: Child[] = [
    adminForm(
      [
        field("Especialidad", selectControl(specialtyOptions, rubro?.specialty ?? "", (v) => { specialty = v as Specialty; })),
        field("Nombre", textControl(rubro?.name ?? "", "Nombre del rubro", (v) => { name = v; })),
        field("Tipo", selectControl(typeOptions, rubro?.type ?? "", (v) => { type = v as RubroType; })),
      ],
      rubro === null ? "Crear rubro" : "Guardar rubro",
      () => actions.adminSaveRubro(rubro === null ? undefined : rubro.id, { specialty, name, type }),
      admin.busy,
    ),
  ];

  if (rubro !== null) {
    const items = admin.itemsByRubro[rubro.id] ?? [];
    if (items.length > 0) {
      children.push(h("p", { className: "admin-subhead" }, "Ítems del rubro"));
      for (const item of items) {
        children.push(itemCard(admin.busy, actions, rubro.id, item));
      }
    }
    children.push(itemCard(admin.busy, actions, rubro.id, null));
  }

  return adminCard(rubro === null ? "Nuevo rubro" : `Rubro · ${rubro?.name ?? ""}`, children);
}

function itemCard(
  busy: boolean,
  actions: ScreenActions,
  rubroId: string,
  item: RubroItem | null,
): Child {
  let name = item?.name ?? "";
  let orderIndex = String(item?.orderIndex ?? 0);
  return adminCard(item === null ? "Nuevo ítem" : item.name, [
    adminForm(
      [
        field("Nombre", textControl(item?.name ?? "", "Nombre del ítem", (v) => { name = v; })),
        field("Orden", h("input", {
          type: "number",
          min: 0,
          step: 1,
          ...(orderIndex === "" ? {} : { value: orderIndex }),
          onInput: (e) => { orderIndex = (e.target as HTMLInputElement).value; },
        })),
      ],
      item === null ? "Agregar ítem" : "Guardar ítem",
      () => actions.adminSaveRubroItem(rubroId, item?.id, { name, orderIndex: Number(orderIndex) }),
      busy,
    ),
  ]);
}

function renderAdminCandidates(
  admin: AdminView,
  actions: ScreenActions,
): Child[] {
  return [
    ...admin.candidates.map((c) => candidateCard(admin, actions, c)),
    ...(admin.candidates.length === 0
      ? [h("p", { className: "muted empty-state" }, "Todavía no hay candidatos.")]
      : []),
    candidateCard(admin, actions, null),
  ];
}

function candidateCard(
  admin: AdminView,
  actions: ScreenActions,
  candidate: Candidate | null,
): Child {
  let comparsaId = candidate?.comparsaId ?? "";
  let itemId = candidate?.itemId ?? "";
  let label = candidate?.label ?? "";
  const comparsaOptions = admin.comparsas.map((c) => ({
    value: c.id,
    label: c.name,
  }));
  const itemOptions = Object.entries(admin.itemsByRubro).flatMap(
    ([rubroId, items]) => {
      const rubroName =
        admin.rubros.find((r) => r.id === rubroId)?.name ?? rubroId;
      return items.map((i) => ({ value: i.id, label: `${rubroName} · ${i.name}` }));
    },
  );
  return adminCard(
    candidate === null ? "Nuevo candidato" : candidate.label,
    [
      adminForm(
        [
          field("Comparsa", selectControl(comparsaOptions, candidate?.comparsaId ?? "", (v) => { comparsaId = v; })),
          field("Ítem del rubro", selectControl(itemOptions, candidate?.itemId ?? "", (v) => { itemId = v; })),
          field("Etiqueta", textControl(candidate?.label ?? "", "Etiqueta del candidato", (v) => { label = v; })),
        ],
        candidate === null ? "Crear candidato" : "Guardar candidato",
        () => actions.adminSaveCandidate(candidate?.id, { itemId, comparsaId, label }),
        admin.busy,
      ),
    ],
  );
}

function renderAdminNights(
  admin: AdminView,
  actions: ScreenActions,
): Child[] {
  const nights = admin.context?.nights ?? [];
  return [
    h("p", { className: "muted" },
      "Las transiciones de estado (ABIERTA/CERRADA) están pendientes de definición; acá se edita la fecha y la ventana de votación."),
    ...nights.map((n) => nightCard(admin.busy, actions, n)),
    ...(nights.length === 0
      ? [h("p", { className: "muted empty-state" }, "Sin noches cargadas.")]
      : []),
  ];
}

function nightCard(
  busy: boolean,
  actions: ScreenActions,
  night: Night,
): Child {
  let date = toDateInput(night.date ?? "");
  let startsAt = toDatetimeLocal(night.startsAt ?? "");
  let endsAt = toDatetimeLocal(night.endsAt ?? "");

  const temporal = (
    value: string,
    current: string | undefined,
  ): string | null | undefined => {
    if (value !== "") return value;
    return current === undefined ? undefined : null;
  };

  return adminCard(
    `${nightLabel(night.number)} · ${NIGHT_STATUS_LABELS[night.status] ?? night.status}`,
    [
      adminForm(
        [
          field("Fecha", h("input", {
            type: "date",
            ...(date === "" ? {} : { value: date }),
            onInput: (e) => { date = (e.target as HTMLInputElement).value; },
          })),
          field("Inicio de votación", h("input", {
            type: "datetime-local",
            ...(startsAt === "" ? {} : { value: startsAt }),
            onInput: (e) => { startsAt = (e.target as HTMLInputElement).value; },
          })),
          field("Fin de votación", h("input", {
            type: "datetime-local",
            ...(endsAt === "" ? {} : { value: endsAt }),
            onInput: (e) => { endsAt = (e.target as HTMLInputElement).value; },
          })),
        ],
        "Guardar noche",
        () => actions.adminSaveNight(night.id, {
          ...(temporal(date, night.date) === undefined ? {} : { date: temporal(date, night.date) }),
          ...(temporal(startsAt, night.startsAt) === undefined ? {} : { startsAt: temporal(startsAt, night.startsAt) }),
          ...(temporal(endsAt, night.endsAt) === undefined ? {} : { endsAt: temporal(endsAt, night.endsAt) }),
        }),
        busy,
      ),
    ],
  );
}

function renderAdminAssignments(
  admin: AdminView,
  actions: ScreenActions,
): Child[] {
  return [
    h("p", { className: "muted admin-note" },
      "Las asignaciones habilitan a un juez por noche y especialidad. Usá el formulario inferior para crear una combinación nueva; el identificador de especialidad que se envía proviene del contexto de la consola."),
    ...admin.assignments.map((a) => assignmentCard(admin, actions, a)),
    ...(admin.assignments.length === 0
      ? [h("p", { className: "muted empty-state" }, "Sin asignaciones todavía.")]
      : []),
    assignmentCard(admin, actions, null),
  ];
}

function assignmentCard(
  admin: AdminView,
  actions: ScreenActions,
  assignment: { id: string; judgeId: string; nightId: string; specialtyId: string; isEffective: boolean } | null,
): Child {
  const context = admin.context;
  const judgeOptions = (context?.judges ?? []).map((j) => ({
    value: j.id,
    label: j.displayName ?? j.email,
  }));
  const nightOptions = (context?.nights ?? []).map((n) => ({
    value: n.id,
    label: nightLabel(n.number),
  }));
  // La especialidad se selecciona por id real del contexto; la UI etiqueta
  // con el código de dominio. Esto permite construir un AssignmentInput válido.
  const specialtyOptions = (context?.specialties ?? []).map((s) => ({
    value: s.id,
    label: SPECIALTY_LABELS[s.code] ?? s.code,
  }));
  // En una creación nueva el estado interno arranca con el primer elemento
  // disponible de cada selector (ids reales del contexto), evitando el envío
  // de un valor vacío que la UI ya no ofrece.
  let judgeId = assignment?.judgeId ?? (judgeOptions[0]?.value ?? "");
  let nightId = assignment?.nightId ?? (nightOptions[0]?.value ?? "");
  let specialtyId = assignment?.specialtyId ?? (specialtyOptions[0]?.value ?? "");
  let isEffective = assignment?.isEffective ?? true;
  const judge = context?.judges.find((j) => j.id === assignment?.judgeId);
  const night = context?.nights.find((n) => n.id === assignment?.nightId);
  const title =
    assignment === null
      ? "Nueva asignación"
      : `${judge?.displayName ?? judge?.email ?? assignment.judgeId} · ${nightLabel(night?.number ?? 0)}`;
  return adminCard(title, [
    adminForm(
      [
        field("Juez", selectControl(judgeOptions, judgeId, (v) => { judgeId = v; })),
        field("Noche", selectControl(nightOptions, nightId, (v) => { nightId = v; })),
        field("Especialidad", selectControl(specialtyOptions, specialtyId, (v) => { specialtyId = v; })),
        field("Habilitada", checkboxControl(assignment?.isEffective ?? true, (v) => { isEffective = v; })),
      ],
      assignment === null ? "Crear asignación" : "Guardar asignación",
      () => actions.adminSaveAssignment(assignment?.id, { judgeId, nightId, specialtyId, isEffective }),
      admin.busy,
    ),
  ]);
}

// ---- Admin: primitivas de formulario ----

function adminCard(title: string, children: Child[]): Child {
  return h("div", { className: "card admin-card" }, [
    h("div", { className: "admin-card-title" }, title),
    ...children,
  ]);
}

function adminForm(
  fields: Child[],
  submitLabel: string,
  onSubmit: () => void,
  busy: boolean,
): Child {
  return h("form", {
    className: "admin-form",
    onSubmit: (e) => {
      e.preventDefault();
      onSubmit();
    },
  }, [
    ...fields,
    h("div", { className: "admin-form-actions" }, [
      h("button", { type: "submit", className: "btn btn-primary", disabled: busy }, submitLabel),
    ]),
  ]);
}

function field(label: string, control: Child): Child {
  return h("label", { className: "field" }, [
    h("span", { className: "field-label" }, label),
    control,
  ]);
}

function textControl(
  initial: string,
  placeholder: string,
  onChange: (value: string) => void,
): Child {
  return h("input", {
    ...(initial === "" ? {} : { value: initial }),
    placeholder,
    onInput: (e) => onChange((e.target as HTMLInputElement).value),
  });
}

function selectControl(
  options: Array<{ value: string; label: string }>,
  initial: string,
  onChange: (value: string) => void,
): Child {
  const el = document.createElement("select");
  el.addEventListener("change", () => onChange(el.value));
  for (const option of options) {
    const node = document.createElement("option");
    node.value = option.value;
    node.textContent = option.label;
    el.appendChild(node);
  }
  if (initial !== "") el.value = initial;
  return el;
}

function checkboxControl(
  initial: boolean,
  onChange: (value: boolean) => void,
): Child {
  const el = document.createElement("input");
  el.type = "checkbox";
  el.checked = initial;
  el.addEventListener("change", () => onChange(el.checked));
  return el;
}

function toDateInput(iso: string): string {
  if (iso === "") return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}

function toDatetimeLocal(iso: string): string {
  if (iso === "") return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}