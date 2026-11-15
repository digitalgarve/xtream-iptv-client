import { createActiveProvider } from '../../src/services/activeProvider.js';

test('changing a saved format refreshes the client, including providers in a unified catalog', async () => {
  let providers = [
    { id: 'a', baseUrl: 'http://a', username: 'u', password: 'p' },
    { id: 'b', baseUrl: 'http://b', username: 'u', password: 'p', slot: 2 },
  ];
  const { encodeId } = require('../../src/services/catalogUnion.js');
  const db = { close: jest.fn() };
  const active = createActiveProvider({ providers: { listActive: async () => providers }, openDb: async () => db });
  const initial = await active.get();
  expect(initial.client.streamUrl('live', encodeId(2, 5))).toBe('http://b/live/u/p/5.m3u8');
  providers = [providers[0], { ...providers[1], liveFormat: 'ts' }];
  const changed = await active.get();
  expect(changed.client.streamUrl('live', encodeId(2, 5))).toBe('http://b/live/u/p/5.ts');
  expect(changed).not.toBe(initial);
  providers = [{ ...providers[0], allowedFormats: ['ts'] }, providers[1]];
  expect((await active.get()).client.streamUrl('live', 3)).toBe('http://a/live/u/p/3.ts');
  active.release();
});
