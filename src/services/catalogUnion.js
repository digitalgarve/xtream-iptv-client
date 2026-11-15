import { dbGet, dbPut, dbDelete, dbGetAllRange } from '../core/idb.js';
import { openProviderDb } from '../db/providerDb.js';

/**
 * Several providers active at once: one catalog made of all of them (the "unified" catalog).
 *
 * The database of the main active provider (the one of always, `providers.getActive()`) is the unified one: it keeps its own downloaded
 * lists (`items`, `categories`) and holds what the app reads (entries, categories of every provider, groups, genres, guide), worked out
 * from its lists and from the lists of the other active providers. Those keep only their downloaded lists in their own database
 * (`role: 'member'`: their sync writes no entries). With one provider active nothing changes: no sources, the catalog of always.
 *
 * Ids of the other providers are made unique in the unified catalog: a stream / series id becomes `slot * SLOT_BASE + id` (numbers stay
 * numbers: the whole app compares and sorts them as such), a category id `${id}@${slot}`. `slot` is a number fixed for each provider
 * (ProviderStore); the main provider's ids are left as they are, so everything saved against them (favourites, progress, pins, the guide
 * order, hidden categories, manual channel groups) keeps working.
 *
 * The record UNION_KEY in the `meta` store says what a database is: the main one `{ sources: [{ id, slot, name }] }` (empty: alone), a
 * member `{ role: 'member' }`.
 */
export const SLOT_BASE = 1e12;
export const UNION_KEY = 'union';

export const encodeId = (slot, id) => (slot ? slot * SLOT_BASE + Number(id) : Number(id));
/** { slot, id } of an id of the unified catalog (slot 0: the main provider). */
export function decodeId(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < SLOT_BASE) return { slot: 0, id: value };
  const slot = Math.floor(n / SLOT_BASE);
  return { slot, id: n - slot * SLOT_BASE };
}
export const encodeCategory = (slot, id) => (slot && id !== null && id !== undefined && id !== '' ? `${id}@${slot}` : id);
/** { slot, id } of a category id of the unified catalog. */
export function decodeCategory(value) {
  const text = String(value === null || value === undefined ? '' : value);
  const at = text.lastIndexOf('@');
  if (at < 0) return { slot: 0, id: text };
  const slot = Number(text.slice(at + 1));
  return Number.isFinite(slot) ? { slot, id: text.slice(0, at) } : { slot: 0, id: text };
}

/** An item of another provider as the unified catalog holds it (`slot` 0: unchanged). */
export function unionItem(item, slot) {
  if (!slot) return item;
  const id = encodeId(slot, item.id);
  return { ...item, key: `${item.type}:${id}`, id, categoryId: encodeCategory(slot, item.categoryId), slot };
}

/** A category row of another provider as the unified catalog holds it. */
export function unionCategory(row, slot) {
  if (!slot) return row;
  const id = encodeCategory(slot, row.id);
  return { ...row, key: `${row.type}:${id}`, id, parentId: row.parentId ? encodeCategory(slot, row.parentId) : null, slot };
}

export const readUnion = (db) => dbGet(db, 'meta', UNION_KEY).then((record) => record || null);
export const isMember = (record) => Boolean(record && record.role === 'member');
export const unionSources = (record) => (record && Array.isArray(record.sources) ? record.sources : []);

/** Writes what a database is (main with its sources, member, or alone: removed). */
export async function writeUnion(db, record) {
  if (!record || (!record.role && !record.pending && !unionSources(record).length)) await dbDelete(db, 'meta', UNION_KEY);
  else await dbPut(db, 'meta', { key: UNION_KEY, ...record });
}

const typeRange = (type) => IDBKeyRange.bound(`${type}:`, `${type}:￿`);

/**
 * The lists of the other active providers for one media type, as the unified catalog holds them: { items, categories } (the categories
 * only those that still have items: hidden ones are not kept, see the sync). Nothing when the database has no sources.
 */
export async function sourceLists(db, type, { openDb = openProviderDb } = {}) {
  const sources = unionSources(await readUnion(db));
  const items = [];
  const categories = [];
  for (const source of sources) {
    let other = null;
    try {
      other = await openDb(source.id);
      const own = await dbGetAllRange(other, 'items', typeRange(type));
      const used = new Set();
      own.forEach((item) => {
        items.push(unionItem(item, source.slot));
        if (item.categoryId !== null && item.categoryId !== undefined) used.add(String(item.categoryId));
      });
      (await dbGetAllRange(other, 'categories', typeRange(type))).forEach((row) => {
        if (used.has(String(row.id))) categories.push(unionCategory(row, source.slot));
      });
    } finally {
      if (other) other.close();
    }
  }
  return { items, categories };
}

/** The categories of the main provider itself (its rows of the unified catalog without those of the other providers). */
export const ownCategories = (rows) => rows.filter((row) => decodeCategory(row.id).slot === 0);
