import type { Child } from "./dom.js";
import { h } from "./dom.js";
import { nightLabel, planillaStatusLabel, SPECIALTY_LABELS } from "./vocab.js";
import {
  syncBadgeForVote,
  type Cell,
  type DisplayVote,
  type SheetModel,
} from "./sheet.js";
import type { AppViewState, DetailView, PlanillaCard } from "../app/app.js";

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
  const hasWork = state.snapshot.pending > 0 || state.snapshot.syncing > 0 || state.snapshot.failed > 0;
  return [
    h("div", { className: "nav" }, [
      h("span", { className: `dot ${state.online ? "dot-online" : "dot-offline"}` }),
      h("span", { className: "nav-conn" }, state.online ? "Conectado" : "Desconectado"),
      ...(state.snapshot.syncing > 0
        ? [h("span", { className: "nav-badge" }, "Sincronizando…")]
        : state.snapshot.pending > 0
          ? [h("span", { className: "nav-badge" }, `${state.snapshot.pending} pendiente(s)`)]
          : state.snapshot.failed > 0
            ? [h("span", { className: "nav-badge tone-error" }, "Con errores")]
            : []),
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
  return [
    h("div", { className: `notice notice-${tone}`, role: "status" }, [
      h("span", { className: "notice-text" }, state.notice?.text ?? ""),
    ]),
  ];
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
  const syncLabel = chipForSync(d.planillaSync);

  return [
    h("section", { className: "screen planilla" }, [
      h("div", { className: "planilla-head" }, [
        h("div", { className: "planilla-head-titles" }, [
          h("h2", { className: "planilla-title" }, `${nightLabel(d.nightNumber)} · ${specialty}`),
          h("div", { className: "planilla-badges" }, [
            h("span", { className: `badge ${STATUS_TONE[d.status] ?? ""}` }, statusLabel),
            ...(syncLabel === null ? [] : [h("span", { className: `badge ${syncLabel.tone}` }, syncLabel.label)]),
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
  ];
}

function chipForSync(sync: string): { label: string; tone: string } | null {
  switch (sync) {
    case "pending":
      return { label: "Por sincronizar", tone: "tone-warn" };
    case "syncing":
      return { label: "Sincronizando", tone: "tone-info" };
    case "error":
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