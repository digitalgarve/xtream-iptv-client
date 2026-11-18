import { kvGet, kvSet } from '../db/kv.js';
import { deleteDb } from '../core/idb.js';
import { openAppDb, APP_DB_NAME } from '../db/appDb.js';
import { hashPin } from './parental.js';

/**
 * Profiles (Netflix style). The first profile names the existing user; until another is created there is none to choose. That user is the
 * main profile (`MAIN_ID`), whose data stays where it always was (the app database). Every other profile has a database of its own with
 * the same stores (`profileDbName`), where its per-profile data lives: progress and watched titles, favourites, collections, pinned
 * entries, scheduled viewing, its Trakt account, its parental PIN, the order of the guide rows. Shared by all: providers and catalog,
 * API keys (TMDB, OpenSubtitles, Trakt's), the other settings. The language of the app is per profile (the main one keeps the setting).
 *
 * A profile: { id, name, avatar, kids, admin, language, pin: { salt, hash } | null }. Kept in the app database (`kv` PROFILES_KEY).
 * The profile in use lives in sessionStorage for this run only (a switch reloads the page): with more than one profile the app asks at
 * every start.
 */
export const MAIN_ID = 'main';
export const PROFILES_KEY = 'profiles';
export const SESSION_KEY = 'xi.profile';
export const PROFILE_DB_PREFIX = `${APP_DB_NAME}-profile-`;
export const profileDbName = (id) => `${PROFILE_DB_PREFIX}${id}`;

/** The avatars to choose from: an icon on a gradient (src/ui/atoms/avatar.js draws them). */
export const AVATARS = [
  'paw', 'cat', 'dog', 'otter', 'frog', 'hippo', 'dragon', 'horse', 'kiwi', 'fish',
  'dove', 'crow', 'spider', 'cow', 'robot', 'ghost', 'astronaut', 'ninja', 'rocket', 'gamepad',
];

const session = () => {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
};

export function createProfiles({ db, openDb = openAppDb, removeDb = deleteDb, random = Math.random, storage = session() }) {
  let list = null;
  const load = async () => {
    if (list === null) list = (await kvGet(db, PROFILES_KEY, null)) || [];
    return list;
  };
  const save = async (next) => {
    list = next;
    await kvSet(db, PROFILES_KEY, next);
  };
  const newId = () => `p${Date.now().toString(36)}${Math.floor(random() * 1e6).toString(36)}`;
  const pinRecord = (pin) => {
    if (!pin) return null;
    const salt = String(Math.floor(random() * 1e9));
    return { salt, hash: hashPin(pin, salt) };
  };
  const clean = (p) => ({ id: p.id, name: String(p.name || '').trim(), avatar: AVATARS.indexOf(p.avatar) >= 0 ? p.avatar : AVATARS[0], kids: Boolean(p.kids), admin: Boolean(p.admin) && !p.kids, language: p.language || null, pin: p.pin || null });

  const service = {
    /** Every profile; empty until the existing user creates their main profile. */
    list: () => load().then((all) => all.slice()),
    async get(id) {
      return (await load()).find((p) => p.id === id) || null;
    },
    /** More than one profile: the app asks which one at start. */
    async needsChoice() {
      return (await load()).length > 1;
    },
    /**
     * Adds one profile ({ name, avatar, kids, admin, pin }). The first is the main profile (the existing user, always an adult admin).
     * Resolves with the new profile.
     */
    async add(data) {
      const all = (await load()).slice();
      const profile = clean({ ...data, ...(!all.length ? { id: MAIN_ID, admin: true, kids: false } : { id: newId() }), pin: pinRecord(data.pin) });
      all.push(profile);
      await save(all);
      return profile;
    },
    /** Changes a profile (`pin`: a new PIN, '' to remove it, undefined to keep it). The last admin cannot stop being one. */
    async update(id, patch) {
      const all = (await load()).slice();
      const i = all.findIndex((p) => p.id === id);
      if (i < 0) return null;
      const next = { ...all[i], ...patch };
      next.pin = patch.pin === undefined ? all[i].pin : pinRecord(patch.pin);
      const cleaned = clean(next);
      if (all[i].admin && !cleaned.admin && !all.some((p, n) => n !== i && p.admin)) throw Object.assign(new Error('The last admin'), { code: 'LAST_ADMIN' });
      all[i] = cleaned;
      await save(all);
      return cleaned;
    },
    /** Deletes a profile and its data (never the main one, nor the last admin). Keeps the main profile when the last additional profile is removed. */
    async remove(id) {
      if (id === MAIN_ID) return false;
      const all = await load();
      const gone = all.find((p) => p.id === id);
      if (!gone) return false;
      const rest = all.filter((p) => p.id !== id);
      if (gone.admin && !rest.some((p) => p.admin)) throw Object.assign(new Error('The last admin'), { code: 'LAST_ADMIN' });
      await save(rest);
      await removeDb(profileDbName(id)).catch(() => undefined);
      return true;
    },
    /** True when `pin` opens the profile (a profile without a PIN opens without one). */
    verifyAccess(profile, pin) {
      return !profile.pin || hashPin(pin, profile.pin.salt) === profile.pin.hash;
    },
    /** True when `pin` is the parental PIN of one of the profiles that are not for kids (leaving a kids profile). */
    async verifyParentalAny(pin, { mainDb = db } = {}) {
      const all = await load();
      const adults = all.length ? all.filter((p) => !p.kids) : [{ id: MAIN_ID }];
      for (const p of adults) {
        const pdb = p.id === MAIN_ID ? mainDb : await openDb(profileDbName(p.id));
        const record = await kvGet(pdb, 'parental', null);
        if (p.id !== MAIN_ID && pdb.close) pdb.close();
        if (record && hashPin(pin, record.salt) === record.hash) return true;
      }
      return false;
    },
    /** The database of a profile's own data: the app database for the main one. */
    dbFor: (profile) => (!profile || profile.id === MAIN_ID ? Promise.resolve(db) : openDb(profileDbName(profile.id))),
    /** The profile chosen in this run (sessionStorage), or null. */
    chosenId() {
      try {
        return (storage && storage.getItem(SESSION_KEY)) || null;
      } catch {
        return null;
      }
    },
    choose(id) {
      try {
        if (storage) {
          if (id) storage.setItem(SESSION_KEY, id);
          else storage.removeItem(SESSION_KEY);
        }
      } catch {
        /* storage unavailable: the next start asks again */
      }
    },
    /** The profile in use: the chosen one; without profiles the main one (a synthetic admin). */
    async current() {
      const all = await load();
      if (!all.length) return { id: MAIN_ID, name: '', avatar: AVATARS[0], kids: false, admin: true, language: null, pin: null, implicit: true };
      return all.find((p) => p.id === service.chosenId()) || (all.length === 1 && !all[0].pin ? all[0] : null);
    },
  };
  return service;
}

/**
 * The settings as a profile sees them: all shared, except the language of the app, which a profile other than the main one keeps in its
 * own record (`language`; none yet: the shared setting). The main profile reads and writes the shared one, as always.
 */
export function profileSettings(settings, profile, profiles) {
  if (!profile || profile.id === MAIN_ID) return settings;
  const view = Object.create(settings);
  let language = profile.language || null;
  view.get = async () => {
    const all = await settings.get();
    return language ? { ...all, language } : all;
  };
  view.update = async (patch) => {
    const rest = { ...patch };
    if ('language' in rest) {
      language = rest.language;
      delete rest.language;
      await profiles.update(profile.id, { language });
    }
    const all = Object.keys(rest).length ? await settings.update(rest) : await settings.get();
    return language ? { ...all, language } : all;
  };
  return view;
}
