/**
 * Almacenamiento clave-valor simple y síncrono.
 *
 * Abstrae la capa de persistencia local para que el motor offline no dependa
 * directamente de una API de plataforma. Implementaciones reales de
 * `KVStorage`:
 *  - `IndexedDbAdapter` (`./idb-adapter.ts`): persistencia sobre IndexedDB,
 *    la que usa la aplicación en `main.ts` (espejo en memoria + escrituras
 *    encoladas + hidratación en `ready()`).
 *  - `createLocalStorageAdapter`: adaptador sobre localStorage, conservado
 *    como alternativa para entornos donde IndexedDB no esté disponible.
 *  - `MemoryStorage`: solo en memoria (tests).
 */
export interface KVStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  /** Devuelve las claves que empiezan con `prefix`, SIN el prefijo. */
  list(prefix: string): string[];
}

export class MemoryStorage implements KVStorage {
  private readonly data: Map<string, string>;

  constructor(backing?: Map<string, string>) {
    this.data = backing ?? new Map<string, string>();
  }

  get(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  set(key: string, value: string): void {
    this.data.set(key, value);
  }

  remove(key: string): void {
    this.data.delete(key);
  }

  list(prefix: string): string[] {
    return Array.from(this.data.keys())
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length));
  }
}

export function createLocalStorageAdapter(namespace: string): KVStorage {
  const prefixKey = (key: string): string => `${namespace}.${key}`;

  return {
    get(key) {
      const raw = localStorage.getItem(prefixKey(key));
      return raw === null ? null : raw;
    },
    set(key, value) {
      localStorage.setItem(prefixKey(key), value);
    },
    remove(key) {
      localStorage.removeItem(prefixKey(key));
    },
    list(prefix) {
      const out: string[] = [];
      const fullPrefix = prefixKey(prefix);
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key !== null && key.startsWith(fullPrefix)) {
          out.push(key.slice(fullPrefix.length));
        }
      }
      return out;
    },
  };
}