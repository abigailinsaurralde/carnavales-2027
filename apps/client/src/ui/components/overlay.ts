import { h } from "../dom.js";
import type { Child } from "../dom.js";
import { button, type ButtonVariant } from "./controls.js";

/** Tonos de notice: coinciden con las clases `.notice-<tone>` existentes. */
export type NoticeTone = "info" | "success" | "error";

/** Clase de notice (función pura, comprobable). */
export function noticeClass(tone: NoticeTone): string {
  return `notice notice-${tone}`;
}

export interface NoticeOptions {
  text: string;
  tone?: NoticeTone;
}

/**
 * Toast de notificación fijo en el footer. Markup idéntico al que ya usaba la
 * app (`<div class="notice notice-*" role="status"><span class="notice-text">`);
 * ver `renderNotice` en `screens.ts`.
 */
export function notice(options: NoticeOptions): HTMLElement {
  return h(
    "div",
    { className: noticeClass(options.tone ?? "info"), role: "status" },
    [h("span", { className: "notice-text" }, options.text)],
  );
}

export interface DialogOptions {
  title: string;
  body?: Child;
  actions: HTMLElement[];
  ariaLabel: string;
}

/** Diálogo modal genérico sobre `.overlay`, con card, título, cuerpo y acciones. */
export function dialog(options: DialogOptions): HTMLElement {
  return h("div", { className: "overlay" }, [
    h(
      "section",
      { className: "dialog card", role: "dialog", ariaLabel: options.ariaLabel },
      [
        h("h3", { className: "dialog-title" }, options.title),
        options.body === undefined
          ? null
          : h("div", { className: "dialog-body" }, options.body),
        h("div", { className: "dialog-actions" }, options.actions),
      ],
    ),
  ]);
}

export interface ConfirmDialogOptions {
  title?: string;
  text: Child;
  confirmLabel: string;
  cancelLabel?: string;
  confirmVariant?: ButtonVariant;
  ariaLabel?: string;
  onConfirm(): void;
  onCancel(): void;
}

/**
 * Diálogo de confirmación anti-error para acciones irreversibles
 * (confirmación de planillas, envíos, limpiezas). Reutiliza `.overlay`,
 * `.confirm`, `.confirm-title` y `.confirm-text` ya existentes para no
 * alterar el estilo actual de la app.
 */
export function confirmDialog(options: ConfirmDialogOptions): HTMLElement {
  return h("div", { className: "overlay" }, [
    h(
      "section",
      {
        className: "confirm card",
        role: "dialog",
        ariaLabel:
          options.ariaLabel ?? options.title ?? "Confirmación requerida",
      },
      [
        h("h3", { className: "confirm-title" }, options.title ?? "Confirmación"),
        h("p", { className: "confirm-text" }, options.text),
        h("div", { className: "confirm-actions" }, [
          button({
            label: options.cancelLabel ?? "Cancelar",
            variant: "secondary",
            onClick: () => options.onCancel(),
          }),
          button({
            label: options.confirmLabel,
            variant: options.confirmVariant ?? "primary",
            onClick: () => options.onConfirm(),
          }),
        ]),
      ],
    ),
  ]);
}