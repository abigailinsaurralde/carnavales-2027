import type { AuthenticatedUser } from "@votaciones2027/shared-types";

/**
 * Estado de sesión del juez.
 *
 * REGLA DE SEGURIDAD: el token de sesión NUNCA se persiste (ni en
 * localStorage ni en cookies). Vive únicamente en memoria durante la sesión
 * del dispositivo; al recargar la página el juez debe volver a autenticarse.
 */
export interface SessionStore {
  getToken(): string | null;
  getUser(): AuthenticatedUser | null;
  isSignedIn(): boolean;
  set(token: string, user: AuthenticatedUser): void;
  clear(): void;
  subscribe(listener: () => void): () => void;
}

export function createSessionStore(): SessionStore {
  let token: string | null = null;
  let user: AuthenticatedUser | null = null;
  const listeners = new Set<() => void>();

  const emit = (): void => {
    for (const listener of Array.from(listeners)) listener();
  };

  return {
    getToken() {
      return token;
    },
    getUser() {
      return user;
    },
    isSignedIn() {
      return token !== null && user !== null;
    },
    set(nextToken, nextUser) {
      token = nextToken;
      user = nextUser;
      emit();
    },
    clear() {
      token = null;
      user = null;
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}