import { createDetailPage } from '../../src/ui/pages/detailPage.js';
import { FocusManager } from '../../src/ui/focus/FocusManager.js';
import { getEntry, listCategories, listNetworks } from '../../src/services/catalogQuery.js';
import { readAudioTracks } from '../../src/services/audioTracks.js';

jest.mock('../../src/services/catalogQuery.js', () => ({ getEntry: jest.fn(), listCategories: jest.fn(), listNetworks: jest.fn() }));
jest.mock('../../src/services/audioTracks.js', () => ({ readAudioTracks: jest.fn() }));
const flush = async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); };

test('movie Play is present and usable while description and audio metadata are still loading', async () => {
  let describe;
  getEntry.mockResolvedValue({ key: 'movie:1', type: 'movie', name: 'Movie', defaultId: 1, members: [{ id: 1, ext: 'mkv' }], categoryIds: [] });
  listCategories.mockResolvedValue([]);
  readAudioTracks.mockImplementation(() => new Promise(() => {}));
  const ctx = {
    active: { get: async () => ({ provider: { id: 'p' }, db: {}, client: { streamUrl: () => 'movie.mkv' } }) },
    details: { vod: () => new Promise((resolve) => { describe = resolve; }) },
    favorites: { has: async () => false },
    watch: { get: async () => null },
    focus: new FocusManager(),
    router: { push: jest.fn() },
  };
  const page = createDetailPage(ctx, { entryKey: 'movie:1' });
  page.mount();
  await flush();
  expect(page.el.querySelector('button[aria-label="Play"]')).not.toBeNull();
  ctx.focus.zones.get('detailActions').onActivate(0);
  expect(ctx.router.push).toHaveBeenCalledWith('player', expect.objectContaining({ type: 'movie', playlist: [{ id: 1, ext: 'mkv', title: '' }] }));
  describe({ plot: 'Description loaded later.' });
  await flush();
  expect(page.el.querySelector('.detail-plot').textContent).toBe('Description loaded later.');
  expect(page.el.querySelector('button[aria-label="Play"]')).not.toBeNull();
  page.destroy();
});


test.each([[true, false], [false, false], [true, true]])('live alternatives: group exists %s, parental gate required %s', async (hasGroup, restricted) => {
  const alternatives = hasGroup && !restricted;
  const channel = { key: 'live:i2', type: 'live', name: 'News SD', defaultId: 2, groupKey: 'live:gNews', members: [{ id: 2, ext: '' }], categoryIds: [] };
  const group = { key: 'live:gNews', type: 'live', isGroup: true, name: 'News', defaultId: 1, members: [{ id: 1, name: 'News HD', ext: '' }, { id: 2, name: 'News SD', ext: '' }], categoryIds: [] };
  getEntry.mockImplementation(async (db, key) => key === channel.key ? channel : hasGroup ? group : null);
  listCategories.mockResolvedValue([]);
  listNetworks.mockResolvedValue([]);
  const ctx = {
    active: { get: async () => ({ provider: { id: 'p' }, db: {} }) },
    favorites: { has: jest.fn(async () => false) },
    parental: { isAdult: (entry) => restricted && entry.isGroup },
    watch: { get: async () => null },
    focus: new FocusManager(),
    dialogs: { choose: jest.fn(async () => 1) },
    router: { push: jest.fn() },
  };
  const page = createDetailPage(ctx, { entryKey: channel.key });
  page.mount();
  await flush();
  try {
    expect(page.el.querySelector('button[aria-label="Play"]')).not.toBeNull();
    expect(ctx.favorites.has).toHaveBeenCalledWith('p', channel.key);
    if (alternatives) {
      expect(page.el.querySelector('.select-value').textContent).toContain('News SD');
      ctx.focus.zones.get('detailVersion').onActivate(0);
      await flush();
      expect(ctx.dialogs.choose).toHaveBeenCalledWith(expect.objectContaining({ selected: 2, options: [{ label: 'News HD', value: 1 }, { label: 'News SD', value: 2 }] }));
      expect(page.el.querySelector('.select-value').textContent).toContain('News HD');
    } else expect(ctx.focus.zones.has('detailVersion')).toBe(false);
    ctx.focus.zones.get('detailActions').onActivate(0);
    expect(ctx.router.push).toHaveBeenCalledWith('player', expect.objectContaining({ entryKey: alternatives ? group.key : channel.key, playlist: [{ id: alternatives ? 1 : 2, ext: '', title: '' }] }));
  } finally { page.destroy(); }
});
