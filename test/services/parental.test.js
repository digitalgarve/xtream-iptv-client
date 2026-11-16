import { dbPut } from '../../src/core/idb.js';
import { openAppDb } from '../../src/db/appDb.js';
import { openProviderDb } from '../../src/db/providerDb.js';
import { dbPutMany } from '../../src/core/idb.js';
import { createParentalService, hashPin, isAdultCategoryName } from '../../src/services/parental.js';
import { createPinsService } from '../../src/services/pins.js';
import { getEntry, pageEntries, setHidden } from '../../src/services/catalogQuery.js';
import { writeEntries } from '../../src/services/catalogSync.js';
import { subscriptionStatus } from '../../src/services/subscription.js';

let n = 0;
const newDb = () => openAppDb(`parental-test-${(n += 1)}`);

test('adult category names', () => {
  ['XXX', 'Adult Movies', 'Film per adulti', 'Porn HD', '18+', 'Erotic', 'Sexy Italia'].forEach((name) => expect(isAdultCategoryName(name)).toBe(true));
  ['Action', 'Sussex Cricket', 'Documentari', 'Kids 18 months'].forEach((name) => expect(isAdultCategoryName(name)).toBe(false));
});

test('the PIN is stored hashed and verified', async () => {
  const db = await newDb();
  const svc = createParentalService({ db, random: () => 0.5 });
  expect(await svc.hasPin()).toBe(false);
  await svc.setPin('1234');
  expect(await svc.hasPin()).toBe(true);
  expect(await svc.verify('1234')).toBe(true);
  expect(await svc.verify('4321')).toBe(false);
  const stored = await db.transaction('kv').objectStore('kv').get('parental');
  const raw = await new Promise((resolve) => { stored.onsuccess = () => resolve(JSON.stringify(stored.result)); });
  expect(raw).not.toContain('1234');
  expect(hashPin('1234', 's')).toBe(hashPin('1234', 's'));
  expect(hashPin('1234', 's')).not.toBe(hashPin('1235', 's'));
  // another service on the same database sees the PIN
  expect(await createParentalService({ db }).verify('1234')).toBe(true);
});

test('adult entries come from the category names', async () => {
  const db = await newDb();
  const providerDb = await openProviderDb(`parental-provider-${n}`);
  await dbPutMany(providerDb, 'categories', [
    { key: 'movie:1', type: 'movie', id: '1', name: 'Azione' },
    { key: 'movie:2', type: 'movie', id: '2', name: 'Adult XXX' },
    { key: 'live:5', type: 'live', id: '5', name: 'Sky 18+' },
  ]);
  const svc = createParentalService({ db });
  await svc.loadCategories(providerDb);
  expect(svc.isAdult({ type: 'movie', categoryIds: ['1'] })).toBe(false);
  expect(svc.isAdult({ type: 'movie', categoryIds: ['1', 2] })).toBe(true);
  expect(svc.isAdult({ type: 'series', categoryIds: ['2'] })).toBe(false);
  expect(svc.isAdult({ type: 'live', categoryIds: ['5'] })).toBe(true);
  expect(svc.isAdult({ type: 'movie' })).toBe(false);
});

test('pins: shared by all providers, categories by folded name, toggle, order of addition', async () => {
  const db = await newDb();
  let clock = 0;
  const pins = createPinsService({ db, now: () => (clock += 1) });
  expect(await pins.toggle('p', { kind: 'genre', type: 'movie', id: 'drama', name: 'Drama' })).toBe(true);
  await pins.toggle('p', { kind: 'category', type: 'movie', id: 7, name: 'Premiere' });
  await pins.toggle('p', { kind: 'genre', type: 'series', id: 'drama', name: 'Drama' });
  expect((await pins.list('p', 'movie')).map((x) => x.name)).toEqual(['Drama', 'Premiere']);
  expect(await pins.has('p', 'category', 'movie', '7', 'Premiere')).toBe(true);
  // Another provider: its own id for the same category, but the same name — and the pin is there, with the folded name as id.
  expect(await pins.has('q', 'category', 'movie', '99', ' premiére ')).toBe(true);
  expect((await pins.list('q', 'movie')).map((x) => [x.kind, x.id])).toEqual([['genre', 'drama'], ['category', 'premiere']]);
  expect(await pins.toggle('p', { kind: 'genre', type: 'movie', id: 'drama' })).toBe(false);
  expect((await pins.list('p', 'movie')).map((x) => x.name)).toEqual(['Premiere']);
  await pins.removeProvider('p'); // removing a provider deletes no pin
  expect((await pins.list('q', 'movie')).length).toBe(1);
});

test('pins saved per provider and by category id are moved to the shared form (names folded, duplicates merged)', async () => {
  const db = await newDb();
  await dbPut(db, 'kv', { key: 'pins', value: [
    { providerId: 'a', kind: 'category', type: 'live', id: '5', name: 'Sport', addedAt: 1 },
    { providerId: 'b', kind: 'category', type: 'live', id: '88', name: 'SPORT', addedAt: 2 },
    { providerId: 'b', kind: 'genre', type: 'movie', id: 'drama', name: 'Drama', addedAt: 3 },
  ] });
  const pins = createPinsService({ db });
  expect((await pins.list('z', 'live')).map((x) => [x.id, x.providerId])).toEqual([['sport', undefined]]);
  expect((await pins.list('z', 'movie')).map((x) => x.id)).toEqual(['drama']);
  expect((await createPinsService({ db }).list('a', 'live')).length).toBe(1); // saved in the new form
});

test('subscription notice: only under 10 days, error once ended', () => {
  const day = 24 * 3600 * 1000;
  const now = 1_000_000_000_000;
  expect(subscriptionStatus({ expiresAt: null }, now)).toBeNull();
  expect(subscriptionStatus({ expiresAt: now + 10 * day }, now)).toBeNull();
  expect(subscriptionStatus({ expiresAt: now + 9.5 * day }, now)).toMatchObject({ type: 'warning', days: 9 });
  expect(subscriptionStatus({ expiresAt: now + 0.5 * day }, now)).toMatchObject({ type: 'warning', days: 0 });
  expect(subscriptionStatus({ expiresAt: now - 1 }, now)).toMatchObject({ type: 'error', expired: true });
});

test('admin marks: either way, shared by every profile, a mark equal to the app own check removed; what a kids profile must not see', async () => {
  const db = await newDb();
  const appDb = await newDb();
  const providerDb = await openProviderDb(`parental-provider-marks-${n}`);
  await dbPutMany(providerDb, 'categories', [{ key: 'movie:2', type: 'movie', id: '2', name: 'Adult XXX' }, { key: 'movie:1', type: 'movie', id: '1', name: 'Azione' }]);
  const plain = { key: 'movie:t1', type: 'movie', categoryIds: ['1'] };
  const auto = { key: 'movie:t2', type: 'movie', categoryIds: ['2'] };
  const flagged = { key: 'movie:t3', type: 'movie', categoryIds: ['1'], adult: true };
  await dbPutMany(providerDb, 'entries', [plain, auto, flagged]);
  await dbPutMany(providerDb, 'groups', [{ key: 'live:n1', isNetwork: true, type: 'live', memberKeys: ['movie:t2'] }, { key: 'live:n2', isNetwork: true, type: 'live', memberKeys: ['movie:t1', 'movie:t2'] }]);
  const svc = createParentalService({ db, appDb });
  await svc.loadCategories(providerDb, 'p1');
  expect([plain, auto, flagged].map((e) => svc.isAdult(e))).toEqual([false, true, true]);
  await svc.mark(plain, true);
  await svc.mark(auto, false);
  expect([plain, auto, flagged].map((e) => svc.isAdult(e))).toEqual([true, false, true]);
  // Another profile (its own database), same app database: the same marks.
  const other = createParentalService({ db: await newDb(), appDb });
  await other.loadCategories(providerDb, 'p1');
  expect([plain, auto].map((e) => other.isAdult(e))).toEqual([true, false]);
  const hidden = await other.hiddenFor(providerDb);
  expect(Array.from(hidden.keys).sort()).toEqual(['movie:t1', 'movie:t3']);
  expect(Array.from(hidden.categories)).toEqual(['movie:2']);
  // Back to what the app finds: the marks go away; another provider has none.
  await svc.mark(plain, false);
  await svc.mark(auto, true);
  const raw = await new Promise((resolve) => { const q = appDb.transaction('kv').objectStore('kv').get('adultMarks'); q.onsuccess = () => resolve(q.result); });
  expect(JSON.stringify(raw)).not.toContain('movie:t');
  await svc.loadCategories(providerDb, 'p2');
  expect(svc.isAdult(plain)).toBe(false);
  const all = await svc.hiddenFor(providerDb);
  expect(Array.from(all.keys).sort()).toEqual(['live:n1', 'movie:t2', 'movie:t3']); // n1: its only channel hidden
});

test.each([false, true])('adult group restrictions cover category channels and survive reload (automatic group flag: %s)', async (adult) => {
  const db = await newDb();
  const providerDb = await openProviderDb(`parental-group-${n}`);
  const group = { key: 'live:g:channel', type: 'live', isGroup: true, adult, added: 2, memberIds: [1, 2], categoryIds: ['1'], members: [{ entryKey: 'live:i1' }, { entryKey: 'live:i2' }] };
  const channels = [1, 2].map((id) => ({ key: `live:i${id}`, type: 'live', defaultId: id, groupKey: group.key, adult: id === 1, categoryIds: ['1'], added: id }));
  const unrelated = { key: 'live:i3', type: 'live', defaultId: 3, categoryIds: ['1'], added: 3 };
  await writeEntries(providerDb, 'live', [...channels, unrelated], { groups: [group] });
  const svc = createParentalService({ db });
  await svc.loadCategories(providerDb, 'p');
  await svc.mark(channels[0], false);
  await svc.mark(group, true);
  expect(channels.map(svc.isAdult)).toEqual([true, true]);
  expect(svc.isAdult(unrelated)).toBe(false);
  const reloaded = createParentalService({ db });
  await reloaded.loadCategories(providerDb, 'p');
  expect(channels.map(reloaded.isAdult)).toEqual([true, true]);
  try {
    setHidden(await reloaded.hiddenFor(providerDb));
    expect(await getEntry(providerDb, channels[0].key)).toBeUndefined();
    const page = await pageEntries(providerDb, { type: 'live', categoryId: '1' });
    expect(page.entries.map((entry) => entry.key)).toEqual([unrelated.key]);
  } finally {
    setHidden(null);
  }
  await reloaded.mark(group, false);
  expect(channels.map(reloaded.isAdult)).toEqual([false, false]);
  expect((await reloaded.hiddenFor(providerDb)).keys.size).toBe(0);
  db.close();
  providerDb.close();
});
