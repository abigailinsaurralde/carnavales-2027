export type Child = Node | string | number | null | undefined | false;

export interface TagProps {
  className?: string;
  textContent?: string;
  dataset?: Record<string, string>;
  onClick?: (event: MouseEvent) => void;
  onInput?: (event: Event) => void;
  onKeydown?: (event: KeyboardEvent) => void;
  onChange?: (event: Event) => void;
  onSubmit?: (event: SubmitEvent) => void;
  disabled?: boolean;
  value?: string | number;
  type?: string;
  placeholder?: string;
  autocomplete?: string;
  inputmode?: string;
  title?: string;
  role?: string;
  ariaLabel?: string;
  min?: number | string;
  max?: number | string;
  step?: number | string;
}

/**
 * Helper mínimalista para crear elementos DOM tipados. Sin framework:
 * `h("div", { className: "x", onClick }, [h("button", ..., "Hola")])`.
 */
export function h(
  tag: string,
  props?: TagProps | null,
  children?: Child | Child[],
): HTMLElement {
  const el = document.createElement(tag);
  if (props !== null && props !== undefined) {
    if (props.className !== undefined) el.className = props.className;
    if (props.textContent !== undefined) el.textContent = props.textContent;
    if (props.title !== undefined) el.title = props.title;
    if (props.role !== undefined) el.setAttribute("role", props.role);
    if (props.ariaLabel !== undefined) el.setAttribute("aria-label", props.ariaLabel);
    if (props.dataset !== undefined) {
      for (const [key, value] of Object.entries(props.dataset)) {
        el.dataset[key] = value;
      }
    }
    if (props.onClick !== undefined) el.addEventListener("click", props.onClick);
    if (props.onInput !== undefined) el.addEventListener("input", props.onInput);
    if (props.onKeydown !== undefined) el.addEventListener("keydown", props.onKeydown);
    if (props.onChange !== undefined) el.addEventListener("change", props.onChange);
    if (props.onSubmit !== undefined) {
      el.addEventListener("submit", props.onSubmit as EventListener);
    }
    if (props.disabled !== undefined) {
      patchBoolean(el, "disabled", props.disabled);
    }
    if (props.type !== undefined) patchAttr(el, "type", props.type);
    if (props.placeholder !== undefined) patchAttr(el, "placeholder", props.placeholder);
    if (props.autocomplete !== undefined) patchAttr(el, "autocomplete", props.autocomplete);
    if (props.inputmode !== undefined) patchAttr(el, "inputmode", props.inputmode);
    if (props.min !== undefined) patchAttr(el, "min", String(props.min));
    if (props.max !== undefined) patchAttr(el, "max", String(props.max));
    if (props.step !== undefined) patchAttr(el, "step", String(props.step));
    if (props.value !== undefined) patchValue(el, props.value);
  }
  appendChildren(el, children);
  return el;
}

export function text(value: Child): Text | null {
  return value === null || value === undefined || value === false
    ? null
    : document.createTextNode(String(value));
}

function appendChildren(el: HTMLElement, children: Child | Child[] | undefined): void {
  if (children === undefined) return;
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    if (typeof child === "number" || typeof child === "string") {
      el.appendChild(document.createTextNode(String(child)));
    } else {
      el.appendChild(child);
    }
  }
}

function patchAttr(el: HTMLElement, name: string, value: string): void {
  el.setAttribute(name, value);
}

function patchBoolean(el: HTMLElement, name: string, value: boolean): void {
  if (value) {
    el.setAttribute(name, "");
  } else {
    el.removeAttribute(name);
  }
}

function patchValue(el: HTMLElement, value: string | number): void {
  if (el instanceof HTMLInputElement) {
    el.value = String(value);
  } else if (el instanceof HTMLTextAreaElement) {
    el.value = String(value);
  } else if (el instanceof HTMLSelectElement) {
    el.value = String(value);
  } else {
    el.dataset.value = String(value);
  }
}

export function clearNode(el: HTMLElement): void {
  while (el.firstChild !== null) el.removeChild(el.firstChild);
}

export function mount(root: HTMLElement, node: Child | Child[]): void {
  clearNode(root);
  const list = Array.isArray(node) ? node : [node];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    root.appendChild(
      typeof child === "string" || typeof child === "number"
        ? document.createTextNode(String(child))
        : child,
    );
  }
}