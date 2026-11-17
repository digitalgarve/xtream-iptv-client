import 'fake-indexeddb/auto';
import { openAppDb } from '../../src/db/appDb.js';
import { kvSet, kvGet } from '../../src/db/kv.js';
import { createProfiles, profileSettings, MAIN_ID, AVATARS, profileDbName } from '../../src/services/profiles.js';
import { hashPin } from '../../src/services/parental.js';
import { SettingsService } from '../../src/services/settings.js';

const memoryStorage = () => {
  const data = {};
  return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: (k) => { delete data[k]; } };
};
async function setup() {
  const db = await openAppDb(`profiles-${Math.random()}`);
  const opened = [];
  const openDb = async (name) => {
    const pdb = await openAppDb(`${name}-${Math.random()}`);
    opened.push(name);
    return pdb;
  };
  const removed = [];
  const profiles = createProfiles({ db, openDb, removeDb: async (name) => removed.push(name), storage: memoryStorage() });
  return { db, profiles, opened, removed };
}

test('without profiles: the user of always (main, admin), nothing to choose, the app database', async () => {
  const { db, profiles } = await setup();
  expect(await profiles.list()).toEqual([]);
  expect(await profiles.needsChoice()).toBe(false);
  const me = await profiles.current();
  expect(me).toMatchObject({ id: MAIN_ID, admin: true, kids: false, implicit: true });
  expect(await profiles.dbFor(me)).toBe(db);
  expect(AVATARS).toHaveLength(20);
});

test('adding another profile asks for a choice at start; access PIN', async () => {
  const { profiles, opened } = await setup();
  await profiles.add({ name: 'Andrea', avatar: 'cat' });
  const kid = await profiles.add({ name: 'Leo', avatar: 'robot', kids: true, admin: true, pin: '1234' });
  const all = await profiles.list();
  expect(all.map((p) => p.name)).toEqual(['Andrea', 'Leo']);
  expect(all[0]).toMatchObject({ id: MAIN_ID, admin: true, kids: false, avatar: 'cat' });
  expect(kid).toMatchObject({ kids: true, admin: false }); // a kids profile is never an admin
  expect(kid.pin.hash).not.toBe('1234'); // hashed
  expect(profiles.verifyAccess(kid, '1234')).toBe(true);
  expect(profiles.verifyAccess(kid, '0000')).toBe(false);
  expect(profiles.verifyAccess(all[0], '')).toBe(true); // no PIN
  expect(await profiles.needsChoice()).toBe(true);
  expect(await profiles.current()).toBeNull(); // nothing chosen in this run
  profiles.choose(kid.id);
  expect((await profiles.current()).id).toBe(kid.id);
  await profiles.dbFor(kid);
  expect(opened).toEqual([profileDbName(kid.id)]);
});

test('update keeps or changes the PIN; the last admin stays one; removing deletes its database and keeps the main profile', async () => {
  const { profiles, removed } = await setup();
  await profiles.add({ name: 'Me' });
  const other = await profiles.add({ name: 'Sara', avatar: 'fish', pin: '1111' });
  const kept = await profiles.update(other.id, { name: 'Sara B', pin: undefined });
  expect(kept.name).toBe('Sara B');
  expect(profiles.verifyAccess(kept, '1111')).toBe(true);
  const noPin = await profiles.update(other.id, { pin: '' });
  expect(noPin.pin).toBeNull();
  await expect(profiles.update(MAIN_ID, { admin: false })).rejects.toMatchObject({ code: 'LAST_ADMIN' });
  await profiles.update(other.id, { admin: true });
  await profiles.update(MAIN_ID, { admin: false }); // another admin exists now
  await expect(profiles.remove(other.id)).rejects.toMatchObject({ code: 'LAST_ADMIN' });
  await profiles.update(MAIN_ID, { admin: true });
  expect(await profiles.remove(MAIN_ID)).toBe(false); // never the main one
  expect(await profiles.remove(other.id)).toBe(true);
  expect(removed).toEqual([profileDbName(other.id)]);
  expect(await profiles.list()).toEqual([await profiles.get(MAIN_ID)]);
  expect((await profiles.current()).name).toBe('Me');
});

test('leaving a kids profile: the parental PIN of any profile not for kids', async () => {
  const { db, profiles } = await setup();
  await profiles.add({ name: 'Dad' });
  const parent = await profiles.add({ name: 'Mum', avatar: 'dove' });
  await profiles.add({ name: 'Kid', avatar: 'frog', kids: true });
  await kvSet(db, 'parental', { salt: 's', hash: hashPin('1111', 's') }); // Dad (main)
  expect(parent.kids).toBe(false);
  const name = `parent-${Math.random()}`;
  const parentDb = await openAppDb(name);
  await kvSet(parentDb, 'parental', { salt: 't', hash: hashPin('2222', 't') });
  // Each check opens (and closes) the database of the profile again.
  const verify = createProfiles({ db, openDb: () => openAppDb(name), storage: memoryStorage() });
  expect(await verify.verifyParentalAny('1111')).toBe(true);
  expect(await verify.verifyParentalAny('2222')).toBe(true);
  expect(await verify.verifyParentalAny('3333')).toBe(false);
});

test.each(['it-IT', 'de-DE'])('settings of a profile: its own language (%s), everything else shared; the main profile writes the shared one', async (language) => {
  const { db, profiles } = await setup();
  const settings = new SettingsService(db);
  await settings.update({ language: 'en-US', bufferSeconds: 10 });
  await profiles.add({ name: 'Me' });
  const other = await profiles.add({ name: 'Sara', avatar: 'fish' });
  const view = profileSettings(settings, other, profiles);
  expect((await view.get()).language).toBe('en-US'); // none of its own yet
  await view.update({ language, bufferSeconds: 20 });
  expect((await view.get())).toMatchObject({ language, bufferSeconds: 20 });
  expect((await settings.get())).toMatchObject({ language: 'en-US', bufferSeconds: 20 }); // shared stays
  expect((await profiles.get(other.id)).language).toBe(language);
  expect(profileSettings(settings, await profiles.get(MAIN_ID), profiles)).toBe(settings);
  expect(await kvGet(db, 'profiles', null)).toHaveLength(2);
});

test.each(['', '1234'])('first save creates only the main profile and preserves its data and PIN (%s)', async (pin) => {
  const { db, profiles } = await setup();
  await kvSet(db, 'existing-data', { favorite: 'channel-1' });
  const main = await profiles.add({ name: 'Thomas', avatar: 'cat', kids: true, admin: false, pin });
  expect(main).toMatchObject({ id: MAIN_ID, name: 'Thomas', avatar: 'cat', kids: false, admin: true });
  expect(await profiles.list()).toEqual([main]);
  expect(await kvGet(db, 'profiles')).toEqual([main]);
  expect(await profiles.dbFor(main)).toBe(db);
  expect(await kvGet(db, 'existing-data')).toEqual({ favorite: 'channel-1' });
  expect(await profiles.needsChoice()).toBe(false);
  const restarted = createProfiles({ db, storage: memoryStorage() });
  expect(await restarted.current()).toEqual(pin ? null : main);
  expect(restarted.verifyAccess(main, pin)).toBe(true);
  if (pin) expect(restarted.verifyAccess(main, '0000')).toBe(false);
  restarted.choose(main.id);
  expect(await restarted.current()).toEqual(main);
});
