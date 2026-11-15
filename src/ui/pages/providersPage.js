import { h } from '../dom.js';
import { createButton } from '../atoms/button.js';
import { createHeading } from '../atoms/heading.js';
import { t, i18n } from '../../i18n/index.js';
import { formatDate, formatDateTime, formatNumber, formatSeconds } from '../../core/format.js';
import { createToggle, setToggle } from '../atoms/toggle.js';
import { createCountsTable } from '../atoms/countsTable.js';
import { pairText } from '../components/syncPanel.js';
import { openProviderDb } from '../../db/providerDb.js';
import { removeCatalogType } from '../../services/catalogSync.js';
import { FocusZone } from '../focus/FocusManager.js';
import { ensureVisible } from '../scroll.js';
import { log } from '../../core/logger.js';
import { openProviderDialog } from './providerSetupPage.js';

const ZONE_ID = 'providers';
export const ProviderAction = Object.freeze({ USE: 'use', CATEGORIES: 'categories', EDIT: 'edit', REMOVE: 'remove', ADD: 'add', REFRESH_LISTS: 'refreshLists', REMOVE_LISTS: 'removeLists' });

/** Host part of a server URL, for display (never shows credentials). */
export function hostOf(baseUrl) {
  return String(baseUrl || '').replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '');
}

/**
 * Focusable cells, line by line: per provider its toggle (active or not), categories, edit, remove; under an active one its table's
 * update / remove buttons (its downloaded lists); then "add a provider". `line` and `col` place each cell (see linesModel).
 * `activeIds`: the active providers (a string: the only one).
 */
export function buildCells(providers, activeIds) {
  const active = new Set(Array.isArray(activeIds) ? activeIds : activeIds ? [activeIds] : []);
  const cells = [];
  let line = 0;
  providers.forEach((provider) => {
    const on = active.has(provider.id);
    [ProviderAction.USE, ProviderAction.CATEGORIES, ProviderAction.EDIT, ProviderAction.REMOVE].forEach((action, col) => cells.push({ action, provider, line, col, ...(action === ProviderAction.USE ? { on } : {}) }));
    line += 1;
    if (on) {
      cells.push({ action: ProviderAction.REFRESH_LISTS, provider, line, col: 0 });
      cells.push({ action: ProviderAction.REMOVE_LISTS, provider, line, col: 1 });
      line += 1;
    }
  });
  cells.push({ action: ProviderAction.ADD, line, col: 0 });
  return cells;
}

/** Up / Down from line to line (to the cell of the nearest column), Left / Right along a line. */
export function linesModel(getCells) {
  return {
    getCount: () => getCells().length,
    navigate(dir, index) {
      const cells = getCells();
      const here = cells[index];
      if (!here) return { type: 'exit', dir };
      if (dir === 'left' || dir === 'right') {
        const next = cells[index + (dir === 'left' ? -1 : 1)];
        return next && next.line === here.line ? { type: 'move', index: index + (dir === 'left' ? -1 : 1) } : { type: 'exit', dir };
      }
      const line = here.line + (dir === 'up' ? -1 : 1);
      const options = cells.map((c, i) => ({ c, i })).filter(({ c }) => c.line === line);
      if (!options.length) return { type: 'exit', dir };
      const best = options.reduce((a, b) => (Math.abs(b.c.col - here.col) < Math.abs(a.c.col - here.col) ? b : a));
      return { type: 'move', index: best.i };
    },
  };
}

/** "Expires on 22/10/2026" / "Expired on ..." from the expiry date saved with the provider, or null when unknown. */
export function validity(provider, now = Date.now()) {
  const at = provider && Number(provider.expiresAt);
  if (!at) return null;
  const date = formatDate(at, i18n.getLocale());
  const expired = at < now;
  return { expired, text: t(expired ? 'providers.expired' : 'providers.validUntil', { date }) };
}

export function createProvidersPage(ctx, params = {}) {
  const list = h('div', { class: 'provider-list' });
  let cells = [];
  let nodes = [];
  let destroyed = false;
  let activeAtOpen = null; // the active providers when the page opened: leaving with others syncs (see destroy)
  let tables = []; // { providerId, table } of the active providers

  /** The table under an active provider: its downloaded lists (counts, categories shown (all), last update and how long it took). */
  function providerTable(provider, refreshBtn, removeBtn) {
    const table = createCountsTable({
      columns: [t('nav.movies'), t('nav.series'), t('nav.live'), t('providers.count.movieCategories'), t('providers.count.seriesCategories'), t('providers.count.liveCategories'), t('providers.count.updated')],
      buttons: [refreshBtn, removeBtn],
      className: 'provider-table',
    });
    tables.push({ providerId: provider.id, table });
    return table;
  }

  async function fillTables() {
    const locale = i18n.getLocale();
    for (const { providerId, table } of tables) {
      const status = await ctx.catalog.readStatus(providerId).catch(() => ({}));
      if (destroyed) return;
      const n = (m) => (m && m.itemCount !== undefined ? formatNumber(m.itemCount, locale) : '');
      // Categories: the ones shown (not hidden on the Visible categories page) and, in brackets, all those the provider gives.
      const cats = (m) => (m && m.categoryCount !== undefined ? pairText(Math.max(0, m.categoryCount - (m.excludedCount || 0)), m.categoryCount, locale) : '');
      const types = ['movie', 'series', 'live'].map((type) => status[type]).filter(Boolean);
      const last = Math.max(0, ...types.map((m) => m.lastSync || 0));
      const took = types.reduce((sum, m) => sum + (m.durationMs || 0), 0);
      table.set([n(status.movie), n(status.series), n(status.live), cats(status.movie), cats(status.series), cats(status.live), last ? `${formatDateTime(last, locale)} · ${formatSeconds(took)} s` : t('common.never')]);
    }
  }

  function render(focusIndex) {
    return Promise.all([ctx.providers.list(), ctx.providers.listActive()]).then(([providers, active]) => {
      if (destroyed) return;
      const activeIds = active.map((p) => p.id);
      if (activeAtOpen === null) activeAtOpen = activeIds.join(',');
      cells = buildCells(providers, activeIds);
      tables = [];
      nodes = cells.map((cell) => {
        if (cell.action === ProviderAction.ADD) {
          return createButton({ label: t('setup.title'), icon: 'add', variant: 'primary', iconOnly: false, className: 'provider-add' }); // icon and label
        }
        if (cell.action === ProviderAction.USE) {
          // Active or not: a toggle (at least one stays on).
          const toggle = createToggle();
          setToggle(toggle, cell.on);
          const el = createButton({ label: t(cell.on ? 'providers.active' : 'providers.inactive'), className: 'provider-action provider-toggle' });
          el.appendChild(toggle);
          return el;
        }
        if (cell.action === ProviderAction.REFRESH_LISTS) return createButton({ label: t('providers.listsUpdate'), icon: 'refresh', variant: 'primary', iconOnly: true, className: 'panel-button' });
        if (cell.action === ProviderAction.REMOVE_LISTS) return createButton({ label: t('providers.listsRemove'), icon: 'remove', variant: 'danger', iconOnly: true, className: 'panel-button' });
        const iconName = { [ProviderAction.CATEGORIES]: 'categories', [ProviderAction.EDIT]: 'edit', [ProviderAction.REMOVE]: 'remove' }[cell.action];
        return createButton({ label: t(`providers.${cell.action}`), icon: iconName, iconOnly: true, ariaLabel: t(`providers.${cell.action}`), variant: cell.action === ProviderAction.REMOVE ? 'danger' : '', className: 'provider-action' });
      });
      while (list.firstChild) list.removeChild(list.firstChild);
      providers.forEach((provider) => {
        const on = activeIds.includes(provider.id);
        const mine = cells.map((c, i) => ({ c, i })).filter(({ c }) => c.provider === provider);
        const actions = mine.filter(({ c }) => c.col !== undefined && c.action !== ProviderAction.REFRESH_LISTS && c.action !== ProviderAction.REMOVE_LISTS).map(({ i }) => nodes[i]);
        const row = h(
          'div',
          { class: `provider-row${on ? ' is-active' : ''}` },
          h('div', { class: 'provider-info' },
            h('span', { class: 'provider-name', text: provider.name }, validity(provider) ? h('span', { class: `provider-valid${validity(provider).expired ? ' expired' : ''}`, text: validity(provider).text }) : null),
            h('span', { class: 'provider-meta', text: provider.type === 'm3u' ? `${hostOf(provider.playlistUrl)} · M3U` : `${hostOf(provider.baseUrl)} · ${provider.username}` })),
          h('div', { class: 'provider-actions' }, actions),
        );
        const refresh = mine.find(({ c }) => c.action === ProviderAction.REFRESH_LISTS);
        const remove = mine.find(({ c }) => c.action === ProviderAction.REMOVE_LISTS);
        // Attached to the row of an active provider: the table of its downloaded lists.
        list.appendChild(on && refresh && remove ? h('div', { class: 'provider-block' }, row, providerTable(provider, nodes[refresh.i], nodes[remove.i]).el) : row);
      });
      list.appendChild(nodes[nodes.length - 1]);
      fillTables().catch(() => undefined);
      if (typeof focusIndex === 'number') ctx.focus.focus(ZONE_ID, Math.max(0, Math.min(focusIndex, cells.length - 1)));
    });
  }

  /** The index of a provider's cell after a render (the cells move when a table appears or goes). */
  const indexOf = (providerId, action) => Math.max(0, cells.findIndex((c) => c.provider && c.provider.id === providerId && c.action === action));

  async function activate(cell) {
    const { provider } = cell;
    switch (cell.action) {
      case ProviderAction.USE: {
        // On / off; the sync of what changed starts when the page is left (destroy).
        const ids = await ctx.providers.setActive(provider.id, !cell.on);
        if (cell.on && ids.includes(provider.id)) ctx.notices.info(t('providers.lastActive'), { key: 'provider' }); // the last one stays on
        await render();
        ctx.focus.focus(ZONE_ID, indexOf(provider.id, ProviderAction.USE));
        break;
      }
      case ProviderAction.CATEGORIES:
        ctx.router.push('categories', { providerId: provider.id, section: 'provider' });
        break;
      case ProviderAction.EDIT:
        if (await openProviderDialog(ctx, { providerId: provider.id })) await render(cells.indexOf(cell));
        break;
      case ProviderAction.REFRESH_LISTS:
        // Its lists downloaded again now; the unified catalog is worked out with them.
        if (!ctx.jobs || ctx.jobs.add(`catalog:${provider.id}`, `${t('operations.catalog')} · ${provider.name}`, () => ctx.catalog.start({ force: true, only: provider.id }).then(() => fillTables()))) ctx.notices.info(t('notice.started'), { key: 'provider' });
        break;
      case ProviderAction.REMOVE_LISTS: {
        const ok = await ctx.dialogs.confirm({ title: t('providers.listsRemove'), message: t('providers.listsRemoveConfirm', { name: provider.name }), confirmLabel: t('settings.confirmRemove'), cancelLabel: t('setup.cancel') });
        if (!ok) return;
        ctx.catalog.cancel();
        const db = await openProviderDb(provider.id);
        try {
          for (const type of ['movie', 'series', 'live']) await removeCatalogType(db, type);
        } finally {
          db.close();
        }
        // The unified catalog without them (it keeps the other providers' titles).
        await ctx.rebuildCatalog(['movie', 'series', 'live']).catch(() => undefined);
        ctx.catalogChanged();
        await fillTables();
        ctx.notices.success(t('notice.removed'), { key: 'provider' });
        break;
      }
      case ProviderAction.REMOVE: {
        const ok = await ctx.dialogs.confirm({
          title: t('providers.removeTitle'),
          message: t('providers.removeMessage', { name: provider.name }),
          confirmLabel: t('settings.confirmRemove'),
          cancelLabel: t('setup.cancel'),
        });
        if (!ok) return;
        const wasActive = (await ctx.providers.listActive()).some((p) => p.id === provider.id);
        ctx.active.release(); // an open connection would block deleting the provider's database
        ctx.catalog.cancel();
        await ctx.providers.remove(provider.id);
        if (ctx.favorites) await ctx.favorites.removeProvider(provider.id);
        if (ctx.liveGrouping) await ctx.liveGrouping.removeProvider(provider.id);
        if (ctx.pins) await ctx.pins.removeProvider(provider.id);
        if (ctx.collections) await ctx.collections.removeProvider(provider.id);
        if (wasActive) {
          const next = await ctx.providers.getActive();
          if (!next) {
            ctx.router.reset('providerSetup', { firstRun: true });
            return;
          }
          activeAtOpen = ''; // the active ones changed: leaving the page syncs
        }
        await render(0);
        ctx.notices.success(t('notice.removed'), { key: 'provider' });
        break;
      }
      default:
        // Added: it joins the active providers (synced when the page is left).
        if (await openProviderDialog(ctx)) await render(cells.length - 1);
    }
  }

  const zone = new FocusZone({
    id: ZONE_ID,
    nodes: () => nodes,
    model: linesModel(() => cells),
    onFocus: (i) => {
      if (!nodes[i]) return;
      nodes[i].classList.add('focused');
      ensureVisible(nodes[i], { first: i < 4 });
    },
    onBlur: (i) => nodes[i] && nodes[i].classList.remove('focused'),
    onActivate: (i) => {
      if (cells[i]) activate(cells[i]).catch((err) => log.warn('Provider action failed', err && err.message));
    },
  });

  return {
    el: h('section', { class: 'page framed providers' }, h('div', { class: 'page-container' }, createHeading({ level: 1, text: t('nav.provider') }), list)),
    mount() {
      ctx.focus.register(zone);
      // Opens on the provider list: the first thing to do here is pick or edit a provider.
      render(params.focusIndex || 0);
    },
    destroy() {
      destroyed = true;
      ctx.focus.unregister(ZONE_ID);
      // Leaving the page: when the active providers changed, the catalog is made again with them (downloads only what is out of date).
      ctx.providers.listActive().then(async (active) => {
        if (activeAtOpen === null || active.map((p) => p.id).join(',') === activeAtOpen) return;
        ctx.active.release();
        if (ctx.refreshAdult) await ctx.refreshAdult();
        ctx.catalogChanged();
        ctx.catalog.start().then(() => ctx.epg && ctx.epg.maybeSync({ force: true })).catch(() => undefined);
      }).catch(() => undefined);
    },
  };
}
