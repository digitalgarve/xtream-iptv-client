import { openProviderDb } from '../../src/db/providerDb.js';
import { dbGetAll } from '../../src/core/idb.js';
import { createActiveProvider } from '../../src/services/activeProvider.js';

test('changing a saved format refreshes the client, including providers in a unified catalog', async () => {
  let providers = [
    { id: 'a', baseUrl: 'http://a', username: 'u', password: 'p' },
    { id: 'b', baseUrl: 'http://b', username: 'u', password: 'p', slot: 2 },
  ];
  const { encodeId } = require('../../src/services/catalogUnion.js');
  const db = await openProviderDb('active-format-refresh');
  const close = jest.spyOn(db, 'close');
  const active = createActiveProvider({ providers: { listActive: async () => providers }, openDb: async () => db });
  const initial = await active.get();
  expect(initial.client.streamUrl('live', encodeId(2, 5))).toBe('http://b/live/u/p/5.m3u8');
  providers = [providers[0], { ...providers[1], liveFormat: 'ts' }];
  const changed = await active.get();
  expect(changed.client.streamUrl('live', encodeId(2, 5))).toBe('http://b/live/u/p/5.ts');
  expect(changed).not.toBe(initial);
  providers = [{ ...providers[0], allowedFormats: ['ts'] }, providers[1]];
  expect((await active.get()).client.streamUrl('live', 3)).toBe('http://a/live/u/p/3.ts');
  expect(changed.db).toBe(initial.db);
  expect(close).not.toHaveBeenCalled();
  await expect(dbGetAll(initial.db, 'entries')).resolves.toEqual([]);
  expect(await active.get()).toBe(await active.get());
  active.release();
  expect(close).toHaveBeenCalledTimes(1);
});

test('changing credentials still replaces the database handle', async () => {
  let provider = { id: 'a', baseUrl: 'http://a', username: 'u', password: 'p' };
  const firstDb = { close: jest.fn() };
  const nextDb = { close: jest.fn() };
  const openDb = jest.fn().mockResolvedValueOnce(firstDb).mockResolvedValueOnce(nextDb);
  const active = createActiveProvider({ providers: { getActive: async () => provider }, openDb });
  await active.get();
  provider = { ...provider, password: 'new' };
  expect((await active.get()).db).toBe(nextDb);
  expect(firstDb.close).toHaveBeenCalledTimes(1);
  expect(openDb).toHaveBeenCalledTimes(2);
  active.release();
  expect(nextDb.close).toHaveBeenCalledTimes(1);
});
