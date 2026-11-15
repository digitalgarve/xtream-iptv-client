import { createDetailPage } from '../../src/ui/pages/detailPage.js';
import { FocusManager } from '../../src/ui/focus/FocusManager.js';
import { getEntry, listCategories } from '../../src/services/catalogQuery.js';
import { readAudioTracks } from '../../src/services/audioTracks.js';

jest.mock('../../src/services/catalogQuery.js', () => ({ getEntry: jest.fn(), listCategories: jest.fn() }));
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
