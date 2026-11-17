import { openAppDb } from '../../src/db/appDb.js';
import { openProviderDb } from '../../src/db/providerDb.js';
import { syncType } from '../../src/services/catalogSync.js';
import { FocusManager } from '../../src/ui/focus/FocusManager.js';
import { createBrowsePage } from '../../src/ui/pages/browsePage.js';
import { createCollectionsPage } from '../../src/ui/pages/collectionsPage.js';
import { createCollectionsService } from '../../src/services/collections.js';
import { createFavoritesService } from '../../src/services/favorites.js';
import { createPinsService } from '../../src/services/pins.js';
import { createCard } from '../../src/ui/components/card.js';
import { Action } from '../../src/core/input.js';

Element.prototype.scrollIntoView = () => undefined;
const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
const ch = (id, name) => ({ stream_id: id, name, category_id: '1', added: String(1000 + id), stream_icon: `l${id}.png`, epg_channel_id: '' });

test('Live TV page: after opening a title and coming back, the same sidebar entry, page and card are there', async () => {
  const db = await openProviderDb('restore-live');
  const client = { getCategories: async () => [{ category_id: '1', category_name: 'All' }], getStreams: async () => [ch(1, 'Rai 1'), ch(2, 'Rai 2'), ch(3, 'Rai 3'), ch(4, 'Zeta')] };
  await syncType({ db, client, type: 'live' });
  const appDb = await openAppDb('restore-live-app');
  const ctx = {
    focus: new FocusManager(),
    active: { get: async () => ({ provider: { id: 'p' }, db }) },
    settings: { get: async () => ({ gridItems: 24 }), getExcluded: async () => new Set() },
    pins: createPinsService({ db: appDb }),
    favorites: createFavoritesService({ db: appDb }),
    notices: { success: jest.fn() },
    openEntry: jest.fn(),
  };
  const first = createBrowsePage(ctx, { type: 'live', section: 'live', filter: { kind: 'epgCategory', id: '1' } });
  first.mount();
  await tick();
  const names = Array.from(first.el.querySelectorAll('.browse-cat-name')).map((n) => n.textContent);
  expect(names).toEqual(['Categories', 'All', 'EPG by category', 'All']);
  ctx.focus.focus('browseCategories', names.lastIndexOf('All'));
  ctx.focus.handle(Action.ENTER); // open the category EPG
  await tick();
  ctx.focus.focus('browseGuide', 0);
  ctx.focus.zones.get('browseGuide').model.navigate('down', 0);
  const state = first.saveState();
  expect(state).toMatchObject({ zone: 'browseGuide', item: { kind: 'epgCategory', id: '1' }, guide: { row: 1 } });
  first.destroy();

  const again = createBrowsePage(ctx, { type: 'live', section: 'live' });
  again.mount();
  again.restoreState(state);
  await tick(60);
  expect(again.el.querySelector('.browse-cat.current .browse-cat-name').textContent).toBe('All');
  expect(again.el.querySelector('.browse-title').textContent).toBe('All');
  expect(ctx.focus.activeId).toBe('browseGuide');
  expect(again.saveState().guide.row).toBe(1);
  again.destroy();
});

test('Collections page restores its sidebar entry too', async () => {
  const appDb = await openAppDb('restore-collections');
  const ctx = {
    focus: new FocusManager(),
    active: { get: async () => ({ provider: { id: 'p' }, db: appDb }) },
    collections: createCollectionsService({ db: appDb }),
    favorites: createFavoritesService({ db: appDb }),
    pins: createPinsService({ db: appDb }),
    notices: { success: jest.fn() },
    router: { push: jest.fn() },
  };
  const made = await ctx.collections.create('p', 'A', []);
  await ctx.favorites.toggle('p', `collection:${made.id}`, 'collection'); // the Favourites entry is there only with a favourite collection
  const first = createCollectionsPage(ctx, {});
  first.mount();
  await tick();
  ctx.focus.focus('collectionsCategories', 1); // Favourites
  ctx.focus.handle(Action.ENTER);
  const state = first.saveState();
  expect(state.item.kind).toBe('favorites');
  first.destroy();
  const again = createCollectionsPage(ctx, {});
  again.mount();
  again.restoreState(state);
  await tick();
  expect(again.el.querySelector('.browse-cat.current .browse-cat-name').textContent).toBe('Favorites');
  expect(ctx.focus.activeId).toBe('collectionsCategories');
  again.destroy();
});

test('a network card says how many channels and groups it holds', () => {
  const card = createCard({ name: 'Rai', icon: '', isNetwork: true, memberKeys: ['a', 'b', 'c'] }, 'live');
  expect(card.el.querySelector('.card-meta').textContent).toBe('3 items');
});
