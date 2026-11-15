import 'fake-indexeddb/auto';
import { openProviderDb } from '../../src/db/providerDb.js';
import { dbGetAll, dbGetAllRange } from '../../src/core/idb.js';
import { syncType, rebuildEntries, removeUnifiedCatalog } from '../../src/services/catalogSync.js';
import { writeUnion, encodeId, decodeId, encodeCategory, decodeCategory, SLOT_BASE } from '../../src/services/catalogUnion.js';
import { createUnionClient } from '../../src/services/unionClient.js';
import { getSyncMeta } from '../../src/services/syncMeta.js';

const client = (categories, streams) => ({ getCategories: async () => categories, getStreams: async () => streams });
const range = (type) => IDBKeyRange.bound(`${type}:`, `${type}:￿`);
let n = 0;

async function twoProviders() {
  n += 1;
  const main = await openProviderDb(`union-main-${n}`);
  const other = await openProviderDb(`union-other-${n}`);
  await writeUnion(main, { sources: [{ id: `union-other-${n}`, slot: 2, name: 'B' }] });
  await writeUnion(other, { role: 'member' });
  return { main, other };
}

test('ids of another provider: numbers and category ids made unique, and back', () => {
  expect(encodeId(0, 55)).toBe(55);
  expect(encodeId(3, 55)).toBe(3 * SLOT_BASE + 55);
  expect(decodeId(3 * SLOT_BASE + 55)).toEqual({ slot: 3, id: 55 });
  expect(decodeId(55)).toEqual({ slot: 0, id: 55 });
  expect(encodeCategory(2, '7')).toBe('7@2');
  expect(decodeCategory('7@2')).toEqual({ slot: 2, id: '7' });
  expect(decodeCategory('7')).toEqual({ slot: 0, id: '7' });
});

test('two providers: one catalog, the same titles once (tmdb id, or the same name without one), the member keeps only its lists', async () => {
  const { main, other } = await twoProviders();
  await syncType({ db: other, type: 'movie', client: client([{ category_id: '1', category_name: 'Azione' }], [
    { stream_id: 5, name: 'Film X', tmdb: '100', category_id: '1', added: '10' },
    { stream_id: 6, name: 'Only B', category_id: '1', added: '11' },
    { stream_id: 7, name: 'Same Name', category_id: '1', added: '12' },
  ]) });
  expect(await dbGetAll(other, 'entries')).toEqual([]); // a member: no entries of its own
  expect((await dbGetAll(other, 'items')).length).toBe(3);
  await syncType({ db: main, type: 'movie', client: client([{ category_id: '1', category_name: 'Film' }, { category_id: '2', category_name: 'Drama' }], [
    { stream_id: 5, name: 'Film X', tmdb: '100', category_id: '1', added: '20' },
    { stream_id: 9, name: 'Same Name', category_id: '2', added: '21' },
  ]) });
  const entries = await dbGetAll(main, 'entries');
  const byName = Object.fromEntries(entries.map((e) => [e.name, e]));
  expect(Object.keys(byName).sort()).toEqual(['Film X', 'Only B', 'Same Name']); // nothing twice
  expect(byName['Film X'].memberIds).toEqual([5, encodeId(2, 5)]);
  expect(byName['Film X'].members[1].slot).toBe(2);
  expect(byName['Same Name'].memberIds).toEqual([9, encodeId(2, 7)]); // no tmdb id: joined by name across providers
  expect(byName['Only B'].key).toBe(`movie:i${encodeId(2, 6)}`);
  const cats = (await dbGetAllRange(main, 'categories', range('movie'))).map((c) => `${c.id}:${c.name}`).sort();
  expect(cats).toEqual(['1:Film', '1@2:Azione', '2:Drama']);
  const meta = await getSyncMeta(main, 'movie');
  expect(meta).toMatchObject({ itemCount: 2, unionItemCount: 5, entryCount: 3, versionGroups: 2, versionedCount: 4 });
  // Removed and worked out again from the lists, no download.
  await removeUnifiedCatalog(main);
  expect(await dbGetAll(main, 'entries')).toEqual([]);
  expect((await dbGetAllRange(main, 'categories', range('movie'))).map((c) => c.id).sort()).toEqual(['1', '2']); // its own stay
  await rebuildEntries({ db: main, type: 'movie' });
  expect((await dbGetAll(main, 'entries')).length).toBe(3);
  expect((await dbGetAllRange(main, 'categories', range('movie'))).map((c) => c.id).sort()).toEqual(['1', '1@2', '2']);
});

test('one provider alone: the catalog of always (ids, keys and categories unchanged)', async () => {
  n += 1;
  const db = await openProviderDb(`union-alone-${n}`);
  await syncType({ db, type: 'movie', client: client([{ category_id: '1', category_name: 'Film' }], [
    { stream_id: 5, name: 'Film X', tmdb: '100', category_id: '1', added: '20' },
    { stream_id: 9, name: 'Same Name', category_id: '1', added: '21' },
  ]) });
  const keys = (await dbGetAll(db, 'entries')).map((e) => e.key).sort();
  expect(keys).toEqual(['movie:i9', 'movie:t100']);
  expect((await dbGetAll(db, 'entries')).every((e) => e.members.every((m) => !m.slot))).toBe(true);
});

test('the union client sends each title to its provider, with its own id; episodes of another provider get unified ids', async () => {
  const calls = [];
  const fake = (name) => ({
    streamUrl: (type, id, ext) => `${name}/${type}/${id}.${ext}`,
    getVodInfo: async (id) => calls.push([name, id]) && { info: {} },
    getSeriesInfo: async (id) => ({ episodes: { 1: [{ id: '44', episode_num: 1 }] }, id }),
    authenticate: async () => ({}),
  });
  const union = createUnionClient(fake('A'), [{ slot: 2, client: fake('B') }]);
  expect(union.streamUrl('movie', 5, 'mkv')).toBe('A/movie/5.mkv');
  expect(union.streamUrl('movie', encodeId(2, 5), 'mkv')).toBe('B/movie/5.mkv');
  await union.getVodInfo(encodeId(2, 8));
  expect(calls).toEqual([['B', 8]]);
  const info = await union.getSeriesInfo(encodeId(2, 3));
  expect(info.episodes[1][0].id).toBe(String(encodeId(2, 44)));
  expect(union.streamUrl('series', Number(info.episodes[1][0].id), 'mp4')).toBe('B/series/44.mp4');
  const mine = await union.getSeriesInfo(3);
  expect(mine.episodes[1][0].id).toBe('44'); // the main provider's: as they are
});

test('live: the same channel of two providers becomes one group with both versions', async () => {
  const { main, other } = await twoProviders();
  await syncType({ db: other, type: 'live', client: client([{ category_id: '3', category_name: 'Italia' }], [{ stream_id: 1, name: 'Rai 1 HD', category_id: '3', epg_channel_id: 'rai1.it', added: '1' }]) });
  await syncType({ db: main, type: 'live', client: client([{ category_id: '3', category_name: 'Generalisti' }], [{ stream_id: 1, name: 'Rai 1 FHD', category_id: '3', epg_channel_id: 'rai1.it', added: '1' }, { stream_id: 2, name: 'Rai 2', category_id: '3', added: '2' }]) });
  const groups = (await dbGetAll(main, 'groups')).filter((g) => g.isGroup);
  expect(groups).toHaveLength(1);
  expect(groups[0].members.map((m) => m.id).sort()).toEqual([1, encodeId(2, 1)].sort());
});
