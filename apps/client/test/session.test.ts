import { describe, expect, it } from "vitest";
import { createSessionStore } from "../src/api/session.js";
import type { AuthenticatedUser } from "@votaciones2027/shared-types";

const user: AuthenticatedUser = {
  id: "juez-1",
  email: "juez.baile.1@goya2027.test",
  role: "JUDGE",
};

describe("session store (token en memoria)", () => {
  it("arranca sin sesión", () => {
    const store = createSessionStore();
    expect(store.isSignedIn()).toBe(false);
    expect(store.getToken()).toBeNull();
    expect(store.getUser()).toBeNull();
  });

  it("guarda y devuelve la sesión activa", () => {
    const store = createSessionStore();
    store.set("tok-1", user);
    expect(store.getToken()).toBe("tok-1");
    expect(store.getUser()).toBe(user);
    expect(store.isSignedIn()).toBe(true);
  });

  it("clear cierra la sesión por completo", () => {
    const store = createSessionStore();
    store.set("tok-1", user);
    store.clear();
    expect(store.getToken()).toBeNull();
    expect(store.getUser()).toBeNull();
    expect(store.isSignedIn()).toBe(false);
  });

  it("notifica a los suscriptores al cambiar la sesión", () => {
    const store = createSessionStore();
    const events: boolean[] = [];
    store.subscribe(() => events.push(store.isSignedIn()));
    store.set("tok-1", user);
    store.clear();
    expect(events).toEqual([true, false]);
  });
});