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


test('Live categories keep their preview and EPG categories show programmes separately', async () => {
  const { ctx, db } = await setup('browse-live-category-epg');
  await syncType({ db, client: { getCategories: async () => [{ category_id: '1', category_name: 'General' }, { category_id: '2', category_name: 'Sport' }], getStreams: async () => [{ ...film(1, '1'), epg_channel_id: 'one' }, film(2, '1'), { ...film(3, '2'), epg_channel_id: 'sport' }] }, type: 'live' });
  let updated;
  const programmes = jest.fn(async ids => new Map(ids.map(id => [id, [{ start: Date.now() - 60000, stop: Date.now() + 3600000, title: id === 'one' ? 'News now' : 'Sport now' }]])));
  ctx.epg = { programmesBetween: programmes, onUpdated: callback => { updated = callback; return () => {}; } };
  const page = createBrowsePage(ctx, { type: 'live', section: 'live', fromBar: true });
  document.body.appendChild(page.el); page.mount();
  try {
    await tick(200);
    expect(Array.from(page.el.querySelectorAll('.browse-cat-name'), node => node.textContent)).toEqual(['Categories', 'General', 'Sport', 'EPG by category', 'Show all']);
    expect(catName(page, ctx)).toBe('General');
    expect(page.el.querySelector('.live-preview')).not.toBeNull();
    expect(page.el.querySelector('.epg-guide')).toBeNull();
    const { Action } = await import('../../src/core/input.js');
    ctx.focus.focus('browseCategories', 3); ctx.focus.handle(Action.ENTER);
    ctx.focus.focus('browseCategories', 4); ctx.focus.handle(Action.ENTER);
    await tick(150);
    expect(page.el.querySelector('.epg-guide').textContent).toContain('News now');
    expect(page.el.querySelector('.epg-guide').textContent).toContain('No programme information');
    expect(page.el.querySelectorAll('.guide-row')).toHaveLength(2);
    expect(page.el.querySelector('.live-preview').style.display).toBe('none');
    ctx.focus.focus('browseCategories', 5); ctx.focus.handle(Action.ENTER);
    await tick(150);
    expect(page.el.querySelector('.epg-guide').textContent).toContain('Sport now');
    expect(page.el.querySelector('.epg-guide').textContent).not.toContain('News now');
    const calls = programmes.mock.calls.length; updated(); await tick(100);
    expect(programmes.mock.calls.length).toBeGreaterThan(calls);
  } finally { page.destroy(); page.el.remove(); }
});

test('large Live category EPG loads a window and restores its row after returning', async () => {
  const query = await import('../../src/services/catalogQuery.js');
  const { ctx, db } = await setup('browse-live-category-window');
  await syncType({ db, client: { getCategories: async () => [{ category_id: '1', category_name: 'General' }], getStreams: async () => Array.from({ length: 500 }, (_, i) => film(i + 1, '1')) }, type: 'live' });
  const read = jest.spyOn(query, 'pageEntries');
  const page = createBrowsePage(ctx, { type: 'live', section: 'live', filter: { kind: 'epgCategory', id: '1' } }); page.mount();
  try {
    await tick(200);
    expect(read.mock.calls[0][1]).toMatchObject({ type: 'live', categoryId: '1', offset: 0 });
    expect(read.mock.calls[0][1].limit).toBeLessThan(100);
    const zone = ctx.focus.zones.get('browseGuide');
    expect(page.el.querySelector('.browse-count').textContent).toBe('500');
    zone.model.navigate('down', 0); zone.model.navigate('down', 0);
    const state = page.saveState();
    expect(state.item).toMatchObject({ kind: 'epgCategory', id: '1' });
    expect(state.guide.row).toBe(2);
  } finally { page.destroy(); read.mockRestore(); }
});

test('Live without channels keeps show all and displays an empty view', async () => {
  const { ctx } = await setup('browse-no-live-categories');
  const page = createBrowsePage(ctx, { type: 'live' }); page.mount();
  try { await tick(150); expect(page.el.querySelectorAll('.browse-cat')).toHaveLength(1); expect(page.el.querySelector('.browse-empty').style.display).toBe(''); }
  finally { page.destroy(); }
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

test('category guide shares XMLTV data by EPG ID across HD/SD, retaining channels without data', async () => {
  const { ctx, db } = await setup('browse-shared-xmltv');
  await syncType({ db, client: {
    getCategories: async () => [{ category_id: '1', category_name: 'General' }],
    getStreams: async () => [
      { ...film(1, '1'), epg_channel_id: 'shared' },
      { ...film(2, '1'), epg_channel_id: 'shared' },
      film(3, '1'),
    ],
  }, type: 'live' });
  const { dbPutMany } = require('../../src/core/idb.js');
  const { createEpgService } = require('../../src/services/epgService.js');
  await dbPutMany(db, 'epg', [{ channelId: 'shared', start: Date.now() - 1000, stop: Date.now() + 3600000, title: 'Shared programme' }]);
  const short = jest.fn();
  ctx.active.get = async () => ({ provider: { id: 'p' }, db, client: { getShortEpg: short } });
  ctx.epg = createEpgService({ active: ctx.active, providers: {} });
  const read = jest.spyOn(ctx.epg, 'programmesBetween');
  const page = createBrowsePage(ctx, { type: 'live', filter: { kind: 'epgCategory', id: '1' } });
  page.mount();
  try {
    await tick(200);
    const rows = Array.from(page.el.querySelectorAll('.guide-row'));
    expect(rows).toHaveLength(3);
    expect(rows.filter(row => row.textContent.includes('Shared programme'))).toHaveLength(2);
    const emptyRow = rows.find(row => row.textContent.includes('Film 3'));
    expect(emptyRow.textContent).toContain('No programme information');
    expect(emptyRow.querySelectorAll('.epg-prog:not(.empty)')).toHaveLength(0);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0][0]).toEqual(['shared']);
    expect(short).not.toHaveBeenCalled();
    const zone = ctx.focus.zones.get('browseGuide');
    zone.model.navigate('down', 0);
    const { Action } = await import('../../src/core/input.js');
    ctx.focus.handle(Action.ENTER);
    expect(ctx.openEntry).toHaveBeenCalledWith(expect.objectContaining({ type: 'live', epgChannelId: 'shared' }), expect.objectContaining({ play: true }));
  } finally { page.destroy(); }
});

test.each([false, true])('show all exposes uncategorized live channels (provider categories: %s)', async (hasCategories) => {
  const { ctx, db } = await setup(`browse-uncategorized-${hasCategories}`);
  await syncType({ db, client: {
    getCategories: async () => hasCategories ? [{ category_id: '1', category_name: 'General' }] : [],
    getStreams: async () => [film(10, undefined), ...(hasCategories ? [film(20, '1')] : [])],
  }, type: 'live' });
  const page = createBrowsePage(ctx, { type: 'live', filter: { kind: 'all' }, fromBar: true });
  page.mount();
  try {
    await tick(150);
    expect(catName(page, ctx)).toBe('Show all');
    expect(page.el.textContent).toContain('Film 10');
    ctx.focus.zones.get('browseGrid').onLongActivate(hasCategories ? 1 : 0);
    expect(ctx.openEntry).toHaveBeenCalledWith(expect.objectContaining({ key: 'live:i10' }), expect.anything());
  } finally { page.destroy(); }
});
