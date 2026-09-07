import {
  createBrowserConnectivity,
  createHttpTransport,
  createId,
  createLocalStorageAdapter,
  OfflineStore,
  SyncManager,
  systemClock,
  type Clock,
  type SyncSnapshot,
} from "./offline/index.js";
import { ApiClient } from "./api/client.js";
import { createSessionStore, type SessionStore } from "./api/session.js";
import { JudgeApp, type AppServices, type SyncSource } from "./app/app.js";
import { mount } from "./ui/dom.js";
import { renderApp, type ScreenActions } from "./ui/screens.js";
import { createRouter } from "./ui/router.js";
import { registerPwa } from "./pwa/register.js";
import "./styles.css";

function apiBaseUrl(): string {
  const envBase = (
    import.meta as { env?: { VITE_API_URL?: string } }
  ).env?.VITE_API_URL;
  return envBase ?? "/api";
}

function main(): void {
  const root = document.getElementById("app");
  if (root === null) throw new Error("Missing #app element");

  const kv = createLocalStorageAdapter("votaciones2027");
  const session: SessionStore = createSessionStore();
  const store = new OfflineStore(kv);
  const connectivity = createBrowserConnectivity();
  const clock: Clock = systemClock;

  const api = new ApiClient({
    baseUrl: apiBaseUrl(),
    getToken: () => session.getToken(),
  });

  const transport = createHttpTransport({
    baseUrl: apiBaseUrl(),
    getToken: () => session.getToken(),
  });

  let statusListener: ((snapshot: SyncSnapshot) => void) | undefined;
  const sync = new SyncManager({
    store,
    transport,
    connectivity,
    clock,
    backoff: { baseMs: 1000, maxMs: 60000 },
    onStatusChange: (snapshot) => statusListener?.(snapshot),
  });
  sync.start();

  const syncSource: SyncSource = {
    getSnapshot: () => sync.getSnapshot(),
    whenStatusChanges: (listener) => {
      statusListener = listener;
      return () => {
        if (statusListener === listener) statusListener = undefined;
      };
    },
    syncAllOnce: () => sync.syncAllOnce(),
    enqueuePlanilla: (planilla, votes) => sync.enqueuePlanilla(planilla, votes),
  };

  const services: AppServices = {
    api,
    store,
    sync: syncSource,
    connectivity,
    session,
    router: createRouter(),
    cache: kv,
    clock: { nowIso: () => clock.nowIso() },
    createId,
  };

  const app = new JudgeApp(services);
  const actions: ScreenActions = {
    login: (email, password) => void app.login(email, password),
    requestAccessToken: (email, dni) => void app.requestAccessToken(email, dni),
    loginWithAccessToken: (email, dni, token) =>
      void app.loginWithAccessToken(email, dni, token),
    setLoginMode: (mode) => app.setLoginMode(mode),
    logout: () => void app.logout(),
    openPlanilla: (id) => void app.openPlanilla(id),
    createPlanilla: (nightId) => void app.createPlanilla(nightId),
    retrySync: () => void app.retrySync(),
    setScore: (planillaId, cell, candidateId, score) =>
      void app.setScore(planillaId, cell, candidateId, score),
    setReviewing: (on) => app.setReviewing(on),
    setConfirmOpen: (on) => app.setConfirmOpen(on),
    setPickedVoteKey: (key) => app.setPickedVoteKey(key),
    confirmPlanilla: () => void app.confirmPlanilla(),
    adminNavigation: (section) => app.openAdmin(section),
    adminRefresh: () => void app.adminRefresh(),
    adminSaveComparsa: (id, input) => void app.adminSaveComparsa(id, input),
    adminSaveRubro: (id, input) => void app.adminSaveRubro(id, input),
    adminSaveRubroItem: (rubroId, id, input) =>
      void app.adminSaveRubroItem(rubroId, id, input),
    adminSaveCandidate: (id, input) => void app.adminSaveCandidate(id, input),
    adminSaveAssignment: (id, input) => void app.adminSaveAssignment(id, input),
    adminSaveNight: (nightId, input) => void app.adminSaveNight(nightId, input),
  };

  app.subscribe(() => mount(root, renderApp(app.getState(), actions)));
  void app.boot();

  registerPwa();
}

main();