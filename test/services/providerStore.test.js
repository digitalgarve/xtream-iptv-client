import { openAppDb } from '../../src/db/appDb.js';
import { ProviderStore } from '../../src/services/providerStore.js';
import { SettingsService, DEFAULT_SETTINGS } from '../../src/services/settings.js';

const data = { name: 'Main', baseUrl: 'http://h', username: 'u', password: 'p' };

describe('ProviderStore', () => {
  test('add, list, activate, remove', async () => {
    const db = await openAppDb('store-test');
    const removed = [];
    const store = new ProviderStore(db, { removeProviderDb: async (id) => removed.push(id) });

    const a = await store.add(data);
    const b = await store.add({ ...data, name: 'Second' });
    expect((await store.list()).map((p) => p.name)).toEqual(['Main', 'Second']);

    await store.setActiveId(a.id);
    expect((await store.getActive()).name).toBe('Main');

    await store.remove(a.id);
    expect(removed).toEqual([a.id]);
    expect(await store.getActiveId()).toBe(b.id);

    await store.remove(b.id);
    expect(await store.getActive()).toBeNull();
    db.close();
  });

  test('rejects incomplete providers', async () => {
    const db = await openAppDb('store-test-2');
    await expect(new ProviderStore(db).add({ name: 'x' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    db.close();
  });
});

describe('SettingsService', () => {
  test('defaults, validation and per-provider exclusions', async () => {
    const db = await openAppDb('settings-test');
    const settings = new SettingsService(db);
    expect(await settings.get()).toEqual(DEFAULT_SETTINGS);

    expect(DEFAULT_SETTINGS.cleanTitles).toBe(true); // titles are cleaned by default, with or without TMDB
    await settings.update({ cleanTitles: 'no' });
    expect((await settings.get()).cleanTitles).toBe(true);
    await settings.update({ cleanTitles: false });
    expect((await settings.get()).cleanTitles).toBe(false);
    await settings.update({ bufferSeconds: 20, gridItems: 13, language: 'xx' });
    expect(await settings.get()).toMatchObject({ bufferSeconds: 20, gridItems: 24, language: 'auto' });

    await settings.setExcluded('p1', 'movie', [3, '4', 3]);
    const excluded = await settings.getExcluded('p1', 'movie');
    expect(Array.from(excluded).sort()).toEqual(['3', '4']);
    expect((await settings.getExcluded('p2', 'movie')).size).toBe(0);
    db.close();
  });
});

describe('several active providers', () => {
  test('every provider has a fixed slot; the main one and the others; at least one stays on; the main one switched off hands over', async () => {
    const { openAppDb } = await import('../../src/db/appDb.js');
    const { ProviderStore } = await import('../../src/services/providerStore.js');
    const db = await openAppDb(`providers-active-${Math.random()}`);
    const store = new ProviderStore(db, { removeProviderDb: async () => undefined });
    const a = await store.add({ name: 'A', baseUrl: 'http://a', username: 'u', password: 'p' });
    const b = await store.add({ name: 'B', baseUrl: 'http://b', username: 'u', password: 'p' });
    const c = await store.add({ name: 'C', baseUrl: 'http://c', username: 'u', password: 'p' });
    expect([a.slot, b.slot, c.slot]).toEqual([1, 2, 3]);
    await store.setActiveId(a.id);
    expect((await store.listActive()).map((p) => p.name)).toEqual(['A']);
    expect(await store.setActive(c.id, true)).toEqual([a.id, c.id]);
    expect(await store.setActive(b.id, true)).toEqual([a.id, b.id, c.id]); // the list order after the main one
    expect((await store.getActive()).id).toBe(a.id);
    expect(await store.setActive(a.id, false)).toEqual([b.id, c.id]); // the next one becomes the main one
    expect((await store.getActive()).id).toBe(b.id);
    await store.setActive(c.id, false);
    expect(await store.setActive(b.id, false)).toEqual([b.id]); // the last one stays on
    await store.setActive(c.id, true);
    await store.remove(b.id); // the main one removed: the next active one takes over
    expect((await store.listActive()).map((p) => p.name)).toEqual(['C']);
  });
});
