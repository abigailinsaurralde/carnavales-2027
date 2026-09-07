import type { KVStorage } from "./storage.js";

const IDB_STORE = "kv";
const IDB_VERSION = 1;

export interface IndexedDbAdapterOptions {
  /** Fábrica IndexedDB inyectable (tests). Default: `indexedDB` global. */
  dbFactory?: IDBFactory;
  /** Callback ante errores de persistencia (quota, transacción abortada...). */
  onError?: (error: unknown) => void;
}

/**
 * Adaptador de `KVStorage` sobre IndexedDB.
 *
 * Mantiene la interfaz SÍNCRONA que exige el motor offline (OfflineStore /
 * SyncManager no cambian): un espejo en memoria sirve las lecturas y recibe
 * las escrituras de inmediato; la persistencia real a IndexedDB ocurre por
 * detrás, encolada de forma serializada.
 *
 * Garantías:
 *  - WRITE-THROUGH: cada `set`/`remove` se refleja al instante en el espejo y
 *    se encola la operación real a IndexedDB. `flush()` resuelve cuando todas
 *    las escrituras encoladas terminaron.
 *  - HIDRATACIÓN: `ready()` carga el estado persistido al iniciar, de modo que
 *    un reinicio del dispositivo recupera la cola offline y las planillas.
 *  - VERSIONADO: el schema del object store se versiona (`IDB_VERSION`); las
 *    migraciones son acumulativas y no destructivas.
 *  - TOLERANCIA A ERRORES: si IndexedDB falla (quota, modo privado), el espejo
 *    sigue sirviendo el estado de la sesión y el error se reporta por
 *    `onError`; la operación local aceptada no se pierde en memoria.
 */
export class IndexedDbAdapter implements KVStorage {
  private readonly memory = new Map<string, string>();
  private readonly namespace: string;
  private readonly dbFactory: IDBFactory | undefined;
  private readonly onError: ((error: unknown) => void) | undefined;
  private dbPromise: Promise<IDBDatabase> | undefined;
  private writeChain: Promise<void> = Promise.resolve();
  private hydrationPromise: Promise<void>;
  private closed = false;

  constructor(namespace: string, options?: IndexedDbAdapterOptions) {
    this.namespace = namespace;
    this.dbFactory =
      options?.dbFactory ??
      (typeof indexedDB !== "undefined" ? indexedDB : undefined);
    this.onError = options?.onError;
    this.hydrationPromise = this.hydrate();
  }

  // -------------------------------------------------------------- KVStorage

  get(key: string): string | null {
    return this.memory.get(key) ?? null;
  }

  set(key: string, value: string): void {
    this.memory.set(key, value);
    this.enqueue({ type: "put", key, value });
  }

  remove(key: string): void {
    this.memory.delete(key);
    this.enqueue({ type: "delete", key });
  }

  list(prefix: string): string[] {
    return Array.from(this.memory.keys())
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length));
  }

  // ----------------------------------------------------------- Aplicación

  /** Espera a que el estado persistido esté hidratado en el espejo. */
  ready(): Promise<void> {
    return this.hydrationPromise;
  }

  /** Resuelve cuando todas las escrituras encoladas terminaron en IndexedDB. */
  flush(): Promise<void> {
    return this.writeChain;
  }

  /** Cierra la conexión y descarta la cola de escrituras pendientes. */
  close(): Promise<void> {
    this.closed = true;
    return (this.dbPromise ?? Promise.resolve(undefined)).then((db) => {
      if (db !== undefined) db.close();
    });
  }

  // ---------------------------------------------------------------- Internos

  private enqueue(op: {
    type: "put" | "delete";
    key: string;
    value?: string;
  }): void {
    this.writeChain = this.writeChain
      .then(() => this.applyOp(op))
      .catch((error) => {
        this.onError?.(error);
      });
  }

  private async hydrate(): Promise<void> {
    if (this.dbFactory === undefined) return;
    try {
      const db = await this.openDb();
      const entries = await readAll(db);
      for (const entry of entries) {
        this.memory.set(entry.key, entry.value);
      }
    } catch (error) {
      this.onError?.(error);
    }
  }

  private async applyOp(op: {
    type: "put" | "delete";
    key: string;
    value?: string;
  }): Promise<void> {
    if (this.closed || this.dbFactory === undefined) return;
    const db = await this.openDb();
    if (op.type === "put") {
      await writePut(db, op.key, op.value!);
    } else {
      await writeDelete(db, op.key);
    }
  }

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise === undefined) {
      this.dbPromise = openDatabase(this.dbFactory!, this.namespace, IDB_VERSION);
    }
    return this.dbPromise;
  }
}

export function createIndexedDbAdapter(
  namespace: string,
  options?: IndexedDbAdapterOptions,
): IndexedDbAdapter {
  return new IndexedDbAdapter(namespace, options);
}

// ---------------------------------------------------------------- IndexedDB

function openDatabase(
  dbFactory: IDBFactory,
  name: string,
  version: number,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = dbFactory.open(name, version);
    request.addEventListener("upgradeneeded", (event) => {
      const db = request.result;
      migrate(db, (event as IDBVersionChangeEvent).oldVersion);
    });
    request.addEventListener("success", () => {
      resolve(request.result);
    });
    request.addEventListener("error", () => {
      reject(request.error ?? new Error("Error al abrir IndexedDB"));
    });
    request.addEventListener("blocked", () => {
      reject(new Error("IndexedDB bloqueado por otra conexión abierta"));
    });
  });
}

/**
 * Migraciones acumulativas y no destructivas del schema.
 *
 * `oldVersion` es la versión anterior a la apertura. Cada migración se aplica
 * solo si la versión previa la requiere; nunca se eliminan ramas históricas.
 */
function migrate(db: IDBDatabase, oldVersion: number): void {
  if (oldVersion < 1) {
    if (!db.objectStoreNames.contains(IDB_STORE)) {
      db.createObjectStore(IDB_STORE, { keyPath: "key" });
    }
  }
}

function transactionOf(
  db: IDBDatabase,
  mode: IDBTransactionMode,
): IDBTransaction {
  return db.transaction(IDB_STORE, mode);
}

function writePut(db: IDBDatabase, key: string, value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = transactionOf(db, "readwrite");
    transaction.objectStore(IDB_STORE).put({ key, value });
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("error", () =>
      reject(transaction.error ?? new Error("Transacción IDB fallida")),
    );
    transaction.addEventListener("abort", () =>
      reject(transaction.error ?? new Error("Transacción IDB abortada")),
    );
  });
}

function writeDelete(db: IDBDatabase, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = transactionOf(db, "readwrite");
    transaction.objectStore(IDB_STORE).delete(key);
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("error", () =>
      reject(transaction.error ?? new Error("Transacción IDB fallida")),
    );
    transaction.addEventListener("abort", () =>
      reject(transaction.error ?? new Error("Transacción IDB abortada")),
    );
  });
}

function readAll(
  db: IDBDatabase,
): Promise<Array<{ key: string; value: string }>> {
  return new Promise((resolve, reject) => {
    const request = transactionOf(db, "readonly")
      .objectStore(IDB_STORE)
      .getAll();
    request.addEventListener("success", () => {
      resolve((request.result ?? []) as Array<{ key: string; value: string }>);
    });
    request.addEventListener("error", () =>
      reject(request.error ?? new Error("Error al leer IndexedDB")),
    );
  });
}