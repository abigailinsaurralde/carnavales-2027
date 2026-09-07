import { describe, expect, it, vi } from "vitest";
import { registerPwa, type PwaManager } from "../src/pwa/register.js";

/**
 * Mocks mínimos del entorno de Service Worker para comprobar el registro y el
 * flujo de actualización del `PwaManager` sin un navegador real.
 */

interface MockWorkerLike {
  state: string;
  postMessage: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
}

function makeEnvironment(options?: { controller?: object | null }) {
  const installing: MockWorkerLike = {
    state: "installing",
    postMessage: vi.fn(),
    addEventListener: vi.fn(),
  };
  const registration = {
    update: vi.fn().mockResolvedValue(undefined),
    installing,
    addEventListener: vi.fn(),
  };

  const serviceWorker = {
    controller: options?.controller ?? null,
    register: vi.fn().mockResolvedValue(registration),
    addEventListener: vi.fn(),
  };

  return {
    nav: { serviceWorker } as unknown as Navigator,
    sw: serviceWorker,
    win: { location: { reload: vi.fn() } } as unknown as Window,
    registration,
    installing,
  };
}

async function getStateChangeHandler(
  env: ReturnType<typeof makeEnvironment>,
): Promise<() => void> {
  await vi.waitFor(() => {
    expect(
      env.registration.addEventListener.mock.calls.some((c) => c[0] === "updatefound"),
    ).toBe(true);
  });
  const updatefound = env.registration.addEventListener.mock.calls.find(
    (c) => c[0] === "updatefound",
  )![1] as () => void;
  updatefound();

  await vi.waitFor(() => {
    expect(
      env.installing.addEventListener.mock.calls.some((c) => c[0] === "statechange"),
    ).toBe(true);
  });
  const statechange = env.installing.addEventListener.mock.calls.find(
    (c) => c[0] === "statechange",
  )![1] as () => void;
  return statechange;
}

describe("registerPwa", () => {
  it("retorna null cuando no hay soporte de service worker", () => {
    const pwa = registerPwa({
      nav: {} as Navigator,
      win: { location: { reload: vi.fn() } } as unknown as Window,
      isProd: true,
    });
    expect(pwa).toBeNull();
  });

  it("registra el SW sobre el scope por defecto en producción", async () => {
    const env = makeEnvironment({ controller: {} });
    const pwa = registerPwa({ nav: env.nav, win: env.win, isProd: true });
    expect(pwa).not.toBeNull();
    await vi.waitFor(() => {
      expect(env.sw.register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
    });
  });

  it("no registra el SW en desarrollo", () => {
    const env = makeEnvironment({ controller: {} });
    registerPwa({ nav: env.nav, win: env.win, isProd: false });
    expect(env.sw.register).not.toHaveBeenCalled();
  });

  it("notifica update disponible cuando hay un SW nuevo instalado con controlador activo", async () => {
    const env = makeEnvironment({ controller: {} });
    const pwa = registerPwa({ nav: env.nav, win: env.win, isProd: true });
    expect(pwa).not.toBeNull();
    expect(pwa!.isUpdateAvailable()).toBe(false);

    const onChange = await getStateChangeHandler(env);
    const callback = vi.fn();
    const unsubscribe = pwa!.onUpdateAvailable(callback);

    env.installing.state = "installed";
    onChange();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(pwa!.isUpdateAvailable()).toBe(true);

    unsubscribe();
  });

  it("applyUpdate envía SKIP_WAITING y limpia la espera", async () => {
    const env = makeEnvironment({ controller: {} });
    const pwa = registerPwa({ nav: env.nav, win: env.win, isProd: true });
    expect(pwa).not.toBeNull();

    const onChange = await getStateChangeHandler(env);
    env.installing.state = "installed";
    onChange();

    expect(pwa!.isUpdateAvailable()).toBe(true);
    pwa!.applyUpdate();
    expect(env.installing.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(pwa!.isUpdateAvailable()).toBe(false);
  });

  it("flujo completo: update disponible → applyUpdate → controllerchange recarga", async () => {
    const env = makeEnvironment({ controller: {} });
    const pwa = registerPwa({ nav: env.nav, win: env.win, isProd: true });
    expect(pwa).not.toBeNull();

    const callback = vi.fn();
    pwa!.onUpdateAvailable(callback);

    const onChange = await getStateChangeHandler(env);
    env.installing.state = "installed";
    onChange();
    expect(callback).toHaveBeenCalled();

    pwa!.applyUpdate();
    expect(env.installing.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });

    const controllerChange = env.sw.addEventListener.mock.calls.find(
      (c) => c[0] === "controllerchange",
    );
    expect(controllerChange?.[1]).toBeTypeOf("function");
    (controllerChange![1] as () => void)();
    expect(env.win.location.reload).toHaveBeenCalled();
  });
});