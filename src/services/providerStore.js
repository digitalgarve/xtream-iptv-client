import { dbGet, dbGetAll, dbPut, dbDelete } from '../core/idb.js';
import { kvGet, kvSet, kvDelete } from '../db/kv.js';
import { deleteProviderDb } from '../db/providerDb.js';
import { AppError, ErrorCode } from '../core/errors.js';

const ACTIVE_KEY = 'activeProviderId';
const ALSO_ACTIVE_KEY = 'alsoActiveProviderIds'; // the other active providers (catalogUnion.js), besides the main one

let lastCreatedAt = 0;

/** Strictly increasing, so providers added within the same millisecond keep their insertion order. */
function nextCreatedAt() {
  lastCreatedAt = Math.max(Date.now(), lastCreatedAt + 1);
  return lastCreatedAt;
}

function generateId() {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** CRUD for configured providers plus the "active provider" pointer. */
export class ProviderStore {
  constructor(db, { removeProviderDb = deleteProviderDb } = {}) {
    this.db = db;
    this.removeProviderDb = removeProviderDb;
  }

  async list() {
    const all = await dbGetAll(this.db, 'providers');
    all.sort((a, b) => a.createdAt - b.createdAt);
    // Every provider has a fixed number (`slot`, from 1): its ids in a catalog shared with other providers (catalogUnion.js).
    let next = all.reduce((max, p) => Math.max(max, p.slot || 0), 0);
    for (const provider of all) {
      if (provider.slot) continue;
      next += 1;
      provider.slot = next;
      await dbPut(this.db, 'providers', provider);
    }
    return all;
  }

  get(id) {
    return dbGet(this.db, 'providers', id);
  }

  /** An Xtream account ({ name, baseUrl, username, password }) or an M3U playlist ({ type: 'm3u', name, playlistUrl, epgUrl? }). */
  async add({ type = 'xtream', name, baseUrl, username, password, playlistUrl, epgUrl = '', expiresAt = null }) {
    const m3u = type === 'm3u';
    if (!name || (m3u ? !playlistUrl : !baseUrl || !username || !password)) {
      throw new AppError(ErrorCode.INVALID_INPUT, 'Missing provider fields');
    }
    const slot = (await this.list()).reduce((max, p) => Math.max(max, p.slot || 0), 0) + 1;
    const provider = m3u
      ? { id: generateId(), type: 'm3u', name, playlistUrl, epgUrl: epgUrl || '', baseUrl: playlistUrl, username: '', password: '', createdAt: nextCreatedAt(), slot }
      : { id: generateId(), name, baseUrl, username, password, ...(expiresAt ? { expiresAt } : {}), createdAt: nextCreatedAt(), slot };
    await dbPut(this.db, 'providers', provider);
    return provider;
  }

  async update(id, patch) {
    const current = await this.get(id);
    if (!current) throw new AppError(ErrorCode.INVALID_INPUT, 'Unknown provider');
    const next = { ...current, ...patch, id };
    await dbPut(this.db, 'providers', next);
    return next;
  }

  async remove(id) {
    await dbDelete(this.db, 'providers', id);
    await this.removeProviderDb(id);
    const also = (await kvGet(this.db, ALSO_ACTIVE_KEY, [])).filter((other) => other !== id);
    await kvSet(this.db, ALSO_ACTIVE_KEY, also);
    if ((await this.getActiveId()) === id) {
      // The next active one becomes the main one; with none, the first provider.
      const [first] = await this.list();
      const next = also[0] || (first && first.id);
      if (next) {
        await this.setActiveId(next);
        await kvSet(this.db, ALSO_ACTIVE_KEY, also.filter((other) => other !== next));
      } else await kvDelete(this.db, ACTIVE_KEY);
    }
  }

  /** The active providers: the main one first, then the others in the order of the list. */
  async listActive() {
    const all = await this.list();
    const mainId = await this.getActiveId();
    const also = new Set(await kvGet(this.db, ALSO_ACTIVE_KEY, []));
    const main = all.find((p) => p.id === mainId);
    return (main ? [main] : []).concat(all.filter((p) => p.id !== mainId && also.has(p.id)));
  }

  /**
   * Switches a provider on or off. At least one stays on; the main one switched off hands over to the next active one. Resolves with the
   * ids of the active providers.
   */
  async setActive(id, on) {
    const all = await this.list();
    const active = (await this.listActive()).map((p) => p.id);
    const next = on ? all.map((p) => p.id).filter((pid) => pid === id || active.includes(pid)) : active.filter((pid) => pid !== id);
    if (!next.length) return active;
    const mainId = active[0] && next.includes(active[0]) ? active[0] : next[0];
    await this.setActiveId(mainId);
    await kvSet(this.db, ALSO_ACTIVE_KEY, next.filter((pid) => pid !== mainId));
    return [mainId].concat(next.filter((pid) => pid !== mainId));
  }

  getActiveId() {
    return kvGet(this.db, ACTIVE_KEY, null);
  }

  /** Makes `id` the main active provider (the others active stay on). */
  async setActiveId(id) {
    await kvSet(this.db, ACTIVE_KEY, id);
    const also = await kvGet(this.db, ALSO_ACTIVE_KEY, []);
    if (also.includes(id)) await kvSet(this.db, ALSO_ACTIVE_KEY, also.filter((other) => other !== id));
  }

  async getActive() {
    const id = await this.getActiveId();
    return id ? (await this.get(id)) || null : null;
  }
}
