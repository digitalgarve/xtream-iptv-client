import { kvGet, kvSet } from '../db/kv.js';
import { requestToPromise } from '../core/idb.js';
import { listCategories } from './catalogQuery.js';
import { isNetworkKey } from './liveGrouping.js';

const KEY = 'parental';
const MARKS_KEY = 'adultMarks'; // app database: { [providerId]: { [entryKey]: true (adult) | false (not adult) } }, set by an admin
export const PIN_LENGTH = 4;
const TYPES = ['movie', 'series', 'live'];

// Category names that mark adult content (English and Italian); the provider gives no other signal.
const ADULT_NAME = /(^|[^a-z0-9])(adults?|adulti|xxx|porn\w*|erotic\w*|erotico|sex\w*|hentai|18\s*\+|\+\s*18)($|[^a-z0-9])/i;

export const isAdultCategoryName = (name) => ADULT_NAME.test(String(name || ''));

/** cyrb53: a small salted hash. It keeps the PIN from sitting in the database as plain text (it is not strong crypto). */
export function hashPin(pin, salt) {
  let h1 = 0xdeadbeef ^ 0;
  let h2 = 0x41c6ce57 ^ 0;
  const text = `${salt}:${pin}`;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return String(4294967296 * (2097151 & h2) + (h1 >>> 0));
}

/**
 * Parental control: one PIN for the app (stored hashed in the app database) and the adult check of
 *  titles: what an admin marked by hand (either way) first, then the flag the provider puts on a title (`is_adult`) and, as a fallback,
 *  the names of its categories (the provider gives no flag on categories).
 * `appDb`: the database shared by every profile, where the marks of the admins are kept (they apply to everyone).
 */
export function createParentalService({ db, appDb = db, random = Math.random }) {
  let record = null; // { salt, hash }
  let adultIds = { movie: new Set(), series: new Set(), live: new Set() };
  let providerId = null;
  let marks = {}; // the marks of the active provider

  function autoAdult(entry) {
    if (entry && entry.adult) return true;
    const ids = entry && entry.categoryIds;
    if (!ids || !adultIds[entry.type]) return false;
    return ids.some((id) => adultIds[entry.type].has(String(id)));
  }
  function isAdultEntry(entry) {
    if (entry && entry.key && Object.prototype.hasOwnProperty.call(marks, entry.key)) return marks[entry.key];
    return autoAdult(entry);
  }

  async function load() {
    if (record === null) record = (await kvGet(db, KEY, null)) || false;
    return record;
  }

  return {
    async hasPin() {
      return Boolean(await load());
    },
    async setPin(pin) {
      const salt = String(Math.floor(random() * 1e9));
      record = { salt, hash: hashPin(pin, salt) };
      await kvSet(db, KEY, record);
    },
    async verify(pin) {
      const stored = await load();
      return Boolean(stored) && hashPin(pin, stored.salt) === stored.hash;
    },
    /** Reads the categories of the active provider and remembers which ones are adult; and the marks of the admins for it. */
    async loadCategories(providerDb, id = null) {
      const next = { movie: new Set(), series: new Set(), live: new Set() };
      const lists = await Promise.all(TYPES.map((type) => listCategories(providerDb, type, { all: true })));
      TYPES.forEach((type, i) => lists[i].filter((c) => isAdultCategoryName(c.name)).forEach((c) => next[type].add(String(c.id))));
      adultIds = next;
      providerId = id;
      const all = id ? await kvGet(appDb, MARKS_KEY, {}) : {};
      marks = (all && all[id]) || {};
    },
    /** Adult title? A mark of an admin first; then the provider's own flag (`is_adult`); then a category whose name marks it. */
    isAdult: isAdultEntry,
    /** An admin marks a title as adult (`adult` true) or not: a mark equal to what the app finds by itself is simply removed. */
    async mark(entry, adult) {
      if (!providerId || !entry || !entry.key) return;
      const all = (await kvGet(appDb, MARKS_KEY, {})) || {};
      const mine = { ...(all[providerId] || {}) };
      if (autoAdult(entry) === adult) delete mine[entry.key];
      else mine[entry.key] = adult;
      all[providerId] = mine;
      await kvSet(appDb, MARKS_KEY, all);
      marks = mine;
    },
    /**
     * What a kids profile must not see in this catalog: { keys, categories }. Keys: every adult title and channel group, every network
     * left without a channel; categories (`type:id`): those whose name marks them as adult.
     */
    async hiddenFor(providerDb) {
      const keys = new Set();
      const categories = new Set();
      TYPES.forEach((type) => adultIds[type].forEach((id) => categories.add(`${type}:${id}`)));
      const [entries, groups] = await Promise.all([
        requestToPromise(providerDb.transaction('entries', 'readonly').objectStore('entries').getAll()),
        requestToPromise(providerDb.transaction('groups', 'readonly').objectStore('groups').getAll()),
      ]);
      entries.concat(groups.filter((g) => !isNetworkKey(g.key))).forEach((entry) => {
        if (isAdultEntry(entry)) keys.add(entry.key);
      });
      groups.filter((g) => isNetworkKey(g.key)).forEach((network) => {
        const members = network.memberKeys || [];
        if ((members.length && members.every((key) => keys.has(key))) || isAdultEntry(network)) keys.add(network.key);
      });
      return { keys, categories };
    },
  };
}
