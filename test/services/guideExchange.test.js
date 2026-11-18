import 'fake-indexeddb/auto';
import { webcrypto } from 'crypto';
import { openAppDb } from '../../src/db/appDb.js';
import { openProviderDb } from '../../src/db/providerDb.js';
import { dbPut } from '../../src/core/idb.js';
import { writeGuideIndex } from '../../src/services/guideIndex.js';
import { createGuideLayoutStore } from '../../src/services/guideLayout.js';
import {
  exportGuideExchange,
  importGuideExchange,
  parseGuideExchange,
} from '../../src/services/guideExchange.js';

beforeAll(() => {
  Object.defineProperty(global, 'crypto', { value: webcrypto });
});
async function fixture() {
  const id = `exchange-${Math.random()}`;
  const db = await openAppDb(id);
  const providerDb = await openProviderDb(id);
  await dbPut(providerDb, 'entries', {
    key: 'live:i12',
    name: 'Das Erste',
    epgChannelId: 'provider-secret-epg',
  });
  await dbPut(providerDb, 'entries', {
    key: 'live:i15',
    name: 'ZDF https://secret.example/pass',
    epgChannelId: 'private-epg',
  });
  await writeGuideIndex(providerDb, [
    ['live:i12', 'provider-secret-epg'],
    ['live:i15', 'private-epg'],
  ]);
  const guideLayout = createGuideLayoutStore({ db });
  const ctx = {
    db,
    pdb: db,
    guideLayout,
    active: {
      get: async () => ({
        db: providerDb,
        provider: {
          id: 'secret-provider',
          username: 'private-user',
          password: 'private-password',
          baseUrl: 'https://private-host',
        },
      }),
    },
  };
  return { ctx, providerDb };
}
test('exports only allowed data and imports order and visibility using device-local mapping', async () => {
  const { ctx, providerDb } = await fixture();
  try {
    const xml = await exportGuideExchange(ctx);
    expect(xml).toContain('Das Erste');
    expect(xml).toContain('ZDF');
    for (const secret of [
      'live:i',
      'provider-secret',
      'private-',
      'secret-provider',
      'secret.example',
      'https:',
      'password',
    ])
      expect(xml).not.toContain(secret);
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const nodes = doc.querySelectorAll('channel');
    nodes[0].setAttribute('visible', 'false');
    doc.documentElement.insertBefore(nodes[1], nodes[0]);
    await importGuideExchange(ctx, new XMLSerializer().serializeToString(doc));
    expect(await ctx.guideLayout.read('secret-provider', providerDb)).toEqual({
      order: ['live:i15', 'live:i12'],
      hidden: ['live:i12'],
    });
    const other = await fixture();
    try {
      await exportGuideExchange(other.ctx);
      await expect(importGuideExchange(other.ctx, xml)).rejects.toThrow('No matching local export');
    } finally {
      other.ctx.db.close();
      other.providerDb.close();
    }
  } finally {
    ctx.db.close();
    providerDb.close();
  }
});
test('rejects malformed XML, entities, duplicate references and unknown references without changing the layout', async () => {
  const { ctx, providerDb } = await fixture();
  try {
    const xml = await exportGuideExchange(ctx);
    const ref = parseGuideExchange(xml)[0].ref;
    expect(() => parseGuideExchange('<tv/>')).toThrow();
    expect(() => parseGuideExchange('<!DOCTYPE x><channel-layout version="1"/>')).toThrow();
    expect(() => parseGuideExchange(xml.replace(/ref="[a-f0-9]{32}"/g, `ref="${ref}"`))).toThrow();
    await expect(importGuideExchange(ctx, xml.replace(ref, 'f'.repeat(32)))).rejects.toThrow();
    expect((await ctx.guideLayout.read('secret-provider', providerDb)).order).toEqual([]);
  } finally {
    ctx.db.close();
    providerDb.close();
  }
});

test('exports thousands of individual streams, categories and channels without EPG; imports their actual Live TV order', async () => {
  const { dbPutMany } = require('../../src/core/idb.js');
  const { readStudioLiveLayout } = require('../../src/services/studioCatalog.js');
  const { setHidden } = require('../../src/services/catalogQuery.js');
  const { ctx, providerDb } = await fixture();
  try {
    await dbPutMany(providerDb, 'categories', [{ key: 'live:provider-category-secret', id: 'provider-category-secret', type: 'live', name: 'Nachrichten' }]);
    const channels = Array.from({ length: 3000 }, (_, i) => ({ key: `live:i${10000 + i}`, type: 'live', name: `Testsender ${i}`, categoryIds: ['provider-category-secret'], groupKey: i < 2 ? 'live:gtest' : null }));
    await dbPutMany(providerDb, 'entries', channels);
    await dbPut(providerDb, 'groups', { key: 'live:gtest', isGroup: true, members: [{ id: 10000, entryKey: 'live:i10000', name: 'Testsender 0 HD' }, { id: 10001, entryKey: 'live:i10001', name: 'Testsender 1 FHD' }] });
    setHidden({ keys: new Set(['live:i12999']), categories: new Set() });
    const xml = await exportGuideExchange(ctx);
    const rows = parseGuideExchange(xml);
    expect(rows).toHaveLength(3001); // 2999 allowed new streams plus the two original ones
    expect(xml).toContain('<category>Nachrichten</category>');
    expect(xml).toContain('Testsender 0 HD');
    expect(xml).toContain('Testsender 1 FHD');
    expect(xml).not.toContain('provider-category-secret');
    expect(xml).not.toContain('live:gtest');
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const nodes = Array.from(doc.querySelectorAll('channel'));
    const first = nodes.find(node => node.querySelector('name').textContent === 'Testsender 0 HD');
    const second = nodes.find(node => node.querySelector('name').textContent === 'Testsender 1 FHD');
    first.setAttribute('visible', 'false');
    doc.documentElement.insertBefore(second, doc.documentElement.firstChild);
    await importGuideExchange(ctx, new XMLSerializer().serializeToString(doc));
    const live = await readStudioLiveLayout(ctx, 'secret-provider', providerDb);
    expect(live[0].key).toBe('live:i10001');
    expect(live.some(row => row.key === 'live:i10000')).toBe(false);
    expect(live).toHaveLength(3000);
    const layout = await ctx.guideLayout.read('secret-provider', providerDb);
    expect(layout.order.indexOf('live:gtest')).toBe(1);
    expect(layout.hidden).not.toContain('live:gtest'); // another variant is still visible
  } finally { setHidden(null); ctx.db.close(); providerDb.close(); }
});

test('profile mappings and Studio activation do not affect other profiles on the same provider', async () => {
  const { ctx, providerDb } = await fixture();
  const { readStudioLiveLayout } = require('../../src/services/studioCatalog.js');
  const aDb = await openAppDb(`studio-profile-a-${Math.random()}`);
  const bDb = await openAppDb(`studio-profile-b-${Math.random()}`);
  const a = { ...ctx, pdb: aDb, guideLayout: createGuideLayoutStore({ db: aDb }) };
  const b = { ...ctx, pdb: bDb, guideLayout: createGuideLayoutStore({ db: bDb }) };
  try {
    await b.guideLayout.save('secret-provider', { order: ['live:i12'], hidden: [] });
    const xmlA = await exportGuideExchange(a);
    await expect(importGuideExchange(b, xmlA)).rejects.toThrow('No matching local export');
    const xmlB = await exportGuideExchange(b);
    const doc = new DOMParser().parseFromString(xmlA, 'application/xml');
    doc.querySelector('channel').setAttribute('visible', 'false');
    await importGuideExchange(a, new XMLSerializer().serializeToString(doc));
    expect((await readStudioLiveLayout(a, 'secret-provider', providerDb)).map(row => row.key)).toEqual(['live:i15']);
    expect(await readStudioLiveLayout(b, 'secret-provider', providerDb)).toBeNull();
    expect(await readStudioLiveLayout(ctx, 'secret-provider', providerDb)).toBeNull();
    expect(await b.guideLayout.read('secret-provider', providerDb)).toEqual({ order: ['live:i12'], hidden: [] });
    await expect(importGuideExchange(b, xmlA)).rejects.toThrow('No matching local export');
    await importGuideExchange(b, xmlB);
    expect(await readStudioLiveLayout(b, 'secret-provider', providerDb)).toHaveLength(2);
    expect(await readStudioLiveLayout(a, 'secret-provider', providerDb)).toHaveLength(1);
  } finally { aDb.close(); bDb.close(); ctx.db.close(); providerDb.close(); }
});
