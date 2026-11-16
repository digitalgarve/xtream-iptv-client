import { openProviderDb } from '../../src/db/providerDb.js';
import { openAppDb } from '../../src/db/appDb.js';
import { syncType } from '../../src/services/catalogSync.js';
import { FocusManager } from '../../src/ui/focus/FocusManager.js';
import { createBrowsePage } from '../../src/ui/pages/browsePage.js';
import { createPinsService } from '../../src/services/pins.js';
import { createFavoritesService } from '../../src/services/favorites.js';
import { derivedVersion, writeDerived } from '../../src/services/derivedStore.js';
import { setHidden } from '../../src/services/catalogQuery.js';
import { i18n } from '../../src/i18n/index.js';
import { createNavCounts } from '../../src/services/navCounts.js';

Element.prototype.scrollIntoView = () => undefined;
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
const film = (id, cat) => ({ stream_id: id, name: `Film ${id}`, category_id: cat, added: String(1000 + id), stream_icon: '', container_extension: 'mkv' });

async function setup(name) {
  const db = await openProviderDb(name);
  await syncType({ db, client: { getCategories: async () => [{ category_id: '1', category_name: 'Action' }, { category_id: '2', category_name: 'Drama' }], getStreams: async () => [film(1, '1'), film(2, '1'), film(3, '2')] }, type: 'movie' });
  const appDb = await openAppDb(`${name}-app`);
  const navCounts = createNavCounts({ db: appDb, saveDelayMs: 0 });
  await navCounts.load();
  const refreshTopbar = jest.fn(async () => undefined);
  const ctx = {
    focus: new FocusManager(),
    active: { get: async () => ({ provider: { id: 'p' }, db }) },
    settings: { get: async () => ({}), getExcluded: async () => new Set() },
    pins: createPinsService({ db: appDb }),
    favorites: createFavoritesService({ db: appDb }),
    navCounts,
    refreshTopbar,
    suggestions: { build: () => new Promise(() => undefined), enabled: false },
    notices: { success: jest.fn() },
    openEntry: jest.fn(),
  };
  return { ctx, refreshTopbar, db };
}


const active = (ctx) => `${ctx.focus.activeId}:${ctx.focus.active ? ctx.focus.active.index : ''}`;
const catName = (page, ctx) => page.el.querySelectorAll('.browse-cat')[ctx.focus.active.index].querySelector('.browse-cat-name').textContent;

test.each(['category', 'genre'])('long OK on a favourite %s opens its browse filter', async (kind) => {
  const { Action } = await import('../../src/core/input.js');
  const { ctx } = await setup(`browse-long-filter-${kind}`);
  ctx.router = { push: jest.fn() };
  await ctx.favorites.toggleFilter('p', { kind, type: 'movie', id: '1', name: 'Action' });
  const page = createBrowsePage(ctx, { type: 'movie', section: 'movies', filter: { kind: 'favorites' } });
  page.mount();
  await tick(150);
  ctx.focus.focus('browseGrid', 0);
  ctx.focus.handle(Action.LONG_ENTER);
  expect(ctx.router.push).toHaveBeenCalledWith('browse', {
    type: 'movie', section: 'movies', filter: { kind, id: '1' },
  });
  expect(ctx.openEntry).not.toHaveBeenCalled();
  page.destroy();
});

test('opened from the top bar: the focus goes to the sidebar entry of the page, not to the grid', async () => {
  const { ctx } = await setup('browse-focus-bar');
  const page = createBrowsePage(ctx, { type: 'movie', section: 'movies', fromBar: true });
  page.mount();
  await tick(150);
  expect(ctx.focus.activeId).toBe('browseCategories');
  expect(catName(page, ctx)).toBe('Show all');
  page.destroy();
});

test('opened from elsewhere (a link to a category): the grid, as before', async () => {
  const { ctx } = await setup('browse-focus-link');
  const page = createBrowsePage(ctx, { type: 'movie', section: 'movies', filter: { kind: 'category', id: '1' } });
  page.mount();
  await tick(150);
  expect(ctx.focus.activeId).toBe('browseGrid');
  page.destroy();
});

test('Back from the grid goes to the sidebar first; from the sidebar of the main entry the page is left', async () => {
  const { ctx } = await setup('browse-focus-back');
  const page = createBrowsePage(ctx, { type: 'movie', section: 'movies' });
  page.mount();
  await tick(150);
  ctx.focus.focus('browseGrid', 2);
  expect(page.onBack()).toBe(true);
  expect(ctx.focus.activeId).toBe('browseCategories');
  expect(catName(page, ctx)).toBe('Show all');
  expect(page.onBack()).toBe(false); // the main entry: the app goes back (Home)
  page.destroy();
});

test('back from a title: the focus returns to its card in the grid', async () => {
  const { ctx } = await setup('browse-focus-return');
  const page = createBrowsePage(ctx, { type: 'movie', section: 'movies', fromBar: true });
  page.mount();
  await tick(150);
  ctx.focus.focus('browseGrid', 2);
  const state = page.saveState();
  page.destroy();
  const again = createBrowsePage(ctx, { type: 'movie', section: 'movies', fromBar: true });
  again.restoreState(state);
  again.mount();
  await tick(150);
  expect(active(ctx)).toBe('browseGrid:2');
  again.destroy();
});

test('the sidebar moves Up / Down, Right only moves the focus into the grid on screen; Left from the first column back to the sidebar', async () => {
  const { Action } = await import('../../src/core/input.js');
  const { ctx } = await setup('browse-focus-moves');
  const page = createBrowsePage(ctx, { type: 'movie', section: 'movies', fromBar: true });
  page.mount();
  await tick(150);
  const title = () => page.el.querySelector('.browse-title').textContent;
  const shown = title();
  ctx.focus.handle(Action.DOWN); // another entry has the focus, the grid on screen is still the first one's
  ctx.focus.handle(Action.RIGHT); // Right: into that grid, nothing opened
  await tick(60);
  expect(ctx.focus.activeId).toBe('browseGrid');
  expect(title()).toBe(shown);
  expect(page.onBack()).toBe(true);
  expect(ctx.focus.activeId).toBe('browseCategories');
  ctx.focus.handle(Action.UP);
  ctx.focus.handle(Action.ENTER); // OK does the same
  await tick(60);
  expect(ctx.focus.activeId).toBe('browseGrid');
  ctx.focus.handle(Action.LEFT);
  expect(ctx.focus.activeId).toBe('browseCategories'); // the first column: Left goes to the sidebar
  ctx.focus.handle(Action.RIGHT);
  expect(ctx.focus.activeId).toBe('browseGrid');
  ctx.focus.handle(Action.UP);
  expect(ctx.focus.activeId).toBe('browseGrid'); // "Show all" has no buttons in its head: nowhere up (not the top bar)
  expect(page.onBack()).toBe(true);
  expect(ctx.focus.activeId).toBe('browseCategories');
  page.destroy();
});

test('Up from the first sidebar entry: the top bar; Down from the bar (enterFromBar): the first sidebar entry', async () => {
  const { Action } = await import('../../src/core/input.js');
  const { FocusZone } = await import('../../src/ui/focus/FocusManager.js');
  const { ListModel } = await import('../../src/ui/focus/models.js');
  const { TOPBAR_ZONE } = await import('../../src/ui/components/topbar.js');
  const { ctx } = await setup('browse-focus-bar');
  ctx.focus.register(new FocusZone({ id: TOPBAR_ZONE, model: new ListModel({ orientation: 'horizontal', getCount: () => 3 }) }));
  const page = createBrowsePage(ctx, { type: 'movie', section: 'movies', fromBar: true });
  page.mount();
  await tick(150);
  ctx.focus.handle(Action.DOWN);
  ctx.focus.handle(Action.UP); // back on the first entry
  expect(ctx.focus.activeId).toBe('browseCategories');
  ctx.focus.handle(Action.UP);
  expect(ctx.focus.activeId).toBe(TOPBAR_ZONE);
  page.enterFromBar();
  expect(ctx.focus.activeId).toBe('browseCategories');
  expect(ctx.focus.active.index).toBe(0);
  page.destroy();
});


test('live list is one column, opens show all, and keeps the tile option', async () => {
  const { ctx, db } = await setup('browse-live-list');
  await syncType({ db, client: { getCategories: async () => [{ category_id: '1', category_name: 'TV' }], getStreams: async () => [film(1, '1'), film(2, '1'), film(3, '1')] }, type: 'live' });
  ctx.settings.get = async () => ({ liveView: 'list' });
  const page = createBrowsePage(ctx, { type: 'live', section: 'live', fromBar: true });
  document.body.appendChild(page.el);
  page.mount();
  await tick(150);
  expect(page.el.classList.contains('live-list')).toBe(true);
  expect(catName(page, ctx)).toBe('Show all');
  const zone = ctx.focus.zones.get('browseGrid');
  expect(zone.model.navigate('down', 0)).toEqual({ type: 'move', index: 1 });
  expect(page.el.querySelector('.live-channel-number').textContent).toBe('1');
  expect(page.el.querySelector('.live-preview')).not.toBeNull();
  page.destroy();
  page.el.remove();
  ctx.settings.get = async () => ({ liveView: 'grid' });
  const tiles = createBrowsePage(ctx, { type: 'live', section: 'live' });
  tiles.mount();
  await tick(150);
  expect(tiles.el.classList.contains('live-list')).toBe(false);
  expect(tiles.el.querySelector('.live-preview')).toBeNull();
  tiles.destroy();
});

test('a large live catalog reads only visible channel records and continues in order', async () => {
  const query = await import('../../src/services/catalogQuery.js');
  const { ctx, db } = await setup('browse-live-window');
  await syncType({ db, client: { getCategories: async () => [{ category_id: '1', category_name: 'TV' }], getStreams: async () => Array.from({ length: 500 }, (_, i) => film(i + 1, '1')) }, type: 'live' });
  ctx.settings.get = async () => ({ liveView: 'list' });
  const keys = await query.liveSequence(db);
  const read = jest.spyOn(query, 'getEntry');
  const page = createBrowsePage(ctx, { type: 'live', section: 'live', fromBar: true });
  page.mount();
  try {
    const zone = ctx.focus.zones.get('browseGrid');
    for (let i = 0; i < 100 && !zone.count; i += 1) await tick(20);
    const initial = zone.count;
    expect(initial).toBeGreaterThan(0);
    expect(initial).toBeLessThan(30);
    expect(read.mock.calls.map((args) => args[1])).toEqual(keys.slice(0, initial));
    expect(page.el.querySelector('.browse-count').textContent).toBe('500');
    zone.model.navigate('down', initial - 1);
    for (let i = 0; i < 100 && zone.count === initial; i += 1) await tick(20);
    expect(zone.count).toBeGreaterThan(initial);
    expect(read.mock.calls.map((args) => args[1])).toEqual(keys.slice(0, zone.count));
  } finally { page.destroy(); read.mockRestore(); }
});

test('returning to the category restores the playing channel beyond the loaded window', async () => {
  const previewModule = await import('../../src/ui/components/livePreview.js');
  const query = await import('../../src/services/catalogQuery.js');
  const { ctx, db } = await setup('browse-live-category-context');
  await syncType({ db, client: { getCategories: async () => [{ category_id: '1', category_name: 'Sport' }], getStreams: async () => Array.from({ length: 40 }, (_, i) => film(i + 1, '1')) }, type: 'live' });
  ctx.settings.get = async () => ({ liveView: 'list' });
  const preview = { el: document.createElement('aside'), select: jest.fn(), stop: jest.fn(), destroy: jest.fn() };
  const create = jest.spyOn(previewModule, 'createLivePreview').mockReturnValue(preview);
  const page = createBrowsePage(ctx, { type: 'live', filter: { kind: 'category', id: '1' }, fromBar: true });
  page.mount();
  try {
    await tick(200);
    ctx.focus.focus('browseGrid', 2);
    expect(preview.select).toHaveBeenLastCalledWith(expect.any(Object), 'auto', { categoryId: '1', offset: 2 });
    const later = (await query.pageEntries(db, { type: 'live', categoryId: '1', offset: 25, limit: 1 })).entries[0];
    await tick(50);
    const original = query.pageEntries;
    let release;
    const waiting = new Promise((resolve) => { release = resolve; });
    const read = jest.spyOn(query, 'pageEntries').mockImplementationOnce(async (...args) => {
      await waiting;
      return original(...args);
    });
    let current = true;
    const pending = create.mock.calls[0][1].onReturn(later, { categoryId: '1', offset: 25 }, () => current);
    await tick(20);
    expect(read).toHaveBeenCalled();
    current = false; // The user moved again while Back was loading the list.
    release();
    await pending;
    read.mockRestore();
    expect(ctx.focus.active.index).toBe(2);
    await create.mock.calls[0][1].onReturn(later, { categoryId: '1', offset: 25 }, () => true);
    expect(ctx.focus.active.index).toBe(25);
    expect(preview.select).toHaveBeenLastCalledWith(later, 'auto', { categoryId: '1', offset: 25 });
  } finally { page.destroy(); create.mockRestore(); }
});


test('sidebar caches do not cross adult and kids visibility or retain old parental marks', async () => {
  const { ctx, db } = await setup('browse-parental-sidebar-cache');
  ctx.genres = { list: async () => [], counts: async () => new Map() };
  const version = await derivedVersion(db, { genres: true, locale: i18n.getLocale() });
  // A previous app version could have saved a child's filtered sidebar under the shared key.
  await writeDerived(db, 'sidebar:p:movie', { categories: [{ id: '1', name: 'Action' }], networks: [], genres: [], counts: [['all:', 2]] }, version);
  let page;
  async function open(kids, hiddenCategory = null) {
    if (page) page.destroy();
    ctx.profile = { kids };
    ctx.pageCache = new Map(); // Switching profiles reloads the app.
    setHidden(hiddenCategory ? { categories: new Set([`movie:${hiddenCategory}`]), keys: new Set(hiddenCategory === '2' ? ['movie:i3'] : ['movie:i1', 'movie:i2']) } : null);
    page = createBrowsePage(ctx, { type: 'movie', section: 'movies', filter: { kind: 'category', id: '1' } });
    page.mount();
    await tick(150);
    return Array.from(page.el.querySelectorAll('.browse-cat-name'), (el) => el.textContent);
  }
  try {
    expect(await open(false)).toEqual(expect.arrayContaining(['Action', 'Drama']));
    const kids = await open(true, '2');
    expect(kids).toContain('Action');
    expect(kids).not.toContain('Drama');
    // A later kids session must use the new classification, not its previous persisted result.
    const changed = await open(true, '1');
    expect(changed).not.toContain('Action');
    expect(changed).toContain('Drama');
    expect(await open(false)).toEqual(expect.arrayContaining(['Action', 'Drama']));
  } finally {
    if (page) page.destroy();
    setHidden(null);
    db.close();
  }
});
