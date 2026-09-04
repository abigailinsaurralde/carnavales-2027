import type { OutboxOperation } from "./types.js";
import type { KVStorage } from "./storage.js";
import type { LocalPlanilla, LocalVote } from "./types.js";

const KEY_PREFIX = "v2027";
const planillaKey = (id: string): string => `${KEY_PREFIX}.planilla.${id}`;
const votesKey = (planillaId: string): string => `${KEY_PREFIX}.votes.${planillaId}`;
const opKey = (id: string): string => `${KEY_PREFIX}.op.${id}`;
const OP_LIST_PREFIX = `${KEY_PREFIX}.op.`;
const PLANILLA_LIST_PREFIX = `${KEY_PREFIX}.planilla.`;

function readJson<T>(raw: string | null): T | null {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Capa offline local: planillas, votos y cola de sincronización (outbox)
 * persistidos en un `KVStorage`. Síncrona y tolerante a datos corruptos
 * (una entrada ilegible se ignora, no rompe la cola).
 *
 * El token de sesión NO se persiste aquí (requisito de seguridad): el gestor
 * obtiene el token en vuelo vía transporte, nunca lo almacena.
 */
export class OfflineStore {
  constructor(private readonly kv: KVStorage) {}

  // ---- Planillas ----

  savePlanilla(planilla: LocalPlanilla): void {
    this.kv.set(planillaKey(planilla.id), JSON.stringify(planilla));
  }

  loadPlanilla(id: string): LocalPlanilla | null {
    return readJson<LocalPlanilla>(this.kv.get(planillaKey(id)));
  }

  removePlanilla(id: string): void {
    this.kv.remove(planillaKey(id));
  }

  listPlanillaIds(): string[] {
    return this.kv.list(PLANILLA_LIST_PREFIX);
  }

  // ---- Votos ----

  saveVote(vote: LocalVote): void {
    const votes = this.loadVotesByPlanilla(vote.planillaId);
    const index = votes.findIndex((v) => v.id === vote.id);
    if (index >= 0) {
      votes[index] = vote;
    } else {
      votes.push(vote);
    }
    this.kv.set(votesKey(vote.planillaId), JSON.stringify(votes));
  }

  loadVote(planillaId: string, voteId: string): LocalVote | null {
    return (
      this.loadVotesByPlanilla(planillaId).find((v) => v.id === voteId) ?? null
    );
  }

  loadVotesByPlanilla(planillaId: string): LocalVote[] {
    const raw = this.kv.get(votesKey(planillaId));
    const votes = readJson<LocalVote[]>(raw);
    return Array.isArray(votes) ? votes : [];
  }

  removeVote(planillaId: string, voteId: string): void {
    const votes = this.loadVotesByPlanilla(planillaId);
    const next = votes.filter((v) => v.id !== voteId);
    if (next.length === 0) {
      this.kv.remove(votesKey(planillaId));
    } else {
      this.kv.set(votesKey(planillaId), JSON.stringify(next));
    }
  }

  // ---- Outbox (cola de sincronización) ----

  saveOperation(op: OutboxOperation): void {
    this.kv.set(opKey(op.id), JSON.stringify(op));
  }

  loadOperation(id: string): OutboxOperation | null {
    return readJson<OutboxOperation>(this.kv.get(opKey(id)));
  }

  listOperations(): OutboxOperation[] {
    return this.kv
      .list(OP_LIST_PREFIX)
      .map((id) => this.loadOperation(id))
      .filter((op): op is OutboxOperation => op !== null);
  }

  findOperationByPlanilla(planillaId: string): OutboxOperation | null {
    return (
      this.listOperations().find((op) => op.planillaId === planillaId) ?? null
    );
  }

  clear(): void {
    for (const key of this.kv.list(KEY_PREFIX)) {
      this.kv.remove(key);
    }
  }
}