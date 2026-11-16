import { h } from '../dom.js';
import { focusOnBar } from '../rowFocus.js';
import { createHint } from '../atoms/hint.js';
import { createTypedRows } from '../components/typedRows.js';
import { TOPBAR_ZONE } from '../components/topbar.js';

/*
 * Page templates: the focus behaviour each kind of page shares, so that every page of a kind behaves the same and only its content
 * is its own.
 *
 * - Sidebar pages (Movies, TV Series, Live TV, Collections, Settings): `sidebarNavigation`. Up from the first sidebar entry: the top
 *   bar; Down from the bar: the first entry; Right from the sidebar: the content on screen (sidebarModel); Left from the content
 *   (its first column, where nothing else is on that side): the sidebar; the bar entry of the page on screen only gives it the focus.
 * - Carousel pages (Home, Search, Favorites, Suggestions): Up from the first row: the top bar (the search field for Search); Down from
 *   the bar: back to that row, on the card it was left from. `createCarouselPage` is the whole page for a list of typed rows.
 * - Standard pages (Providers, Diagnostics): `standardNavigation`. Up from the first line: the top bar; Down from the bar: that line.
 */

/** Sidebar pages: the links between the bar, the sidebar and the content. Returns the page methods { enterFromBar, takeFocusFromBar }. */
export function sidebarNavigation(ctx, { sidebar, contents, hasEntries = () => true, entryOnScreen = () => 0 }) {
  return {
    /** To call once the zones are registered (mount). */
    link() {
      ctx.focus.link(sidebar, 'up', TOPBAR_ZONE);
      contents.forEach((id) => ctx.focus.link(id, 'left', sidebar));
    },
    /** Down from the top bar: the first entry of the sidebar. */
    enterFromBar: () => hasEntries() && ctx.focus.focus(sidebar, 0),
    /** The bar's entry of this page pressed again: the focus comes to the sidebar (its entry of the page), nothing is loaded again. */
    takeFocusFromBar: () => hasEntries() && ctx.focus.focus(sidebar, Math.max(0, entryOnScreen())),
  };
}

/** Standard pages: Up from the first line to the top bar, Down from it back. Returns { link, enterFromBar }. */
export function standardNavigation(ctx, { zone, hasLines = () => true }) {
  return {
    link: () => ctx.focus.link(zone, 'up', TOPBAR_ZONE),
    enterFromBar: () => hasLines() && ctx.focus.focus(zone, 0),
  };
}

/**
 * A carousel page made of typed rows (one carousel per kind of entry): the status line, the rows, the focus where it was when the page
 * comes back (a title opened from here, then Back), the bar left alone when the page was left from it, Up / Down with the bar.
 * `load()` resolves with { entries, status } (status: the text above the rows, '' for none); `onError(err)` gives the text shown when it
 * fails. `options` go to createTypedRows.
 */
export function createCarouselPage(ctx, { className, loadingText, load, onError = () => '', ...options }) {
  const status = createHint({ text: loadingText, className: 'search-status' });
  const rows = createTypedRows(ctx, { upZone: TOPBAR_ZONE, ...options });
  let destroyed = false;
  let restored = null;
  let onBar = false;

  async function fill() {
    const result = await load();
    if (destroyed || !result) return;
    rows.set(result.entries);
    status.textContent = result.status || '';
    if (onBar) onBar = false;
    else if (restored) rows.focusSaved(restored);
    else rows.focusFirst();
    restored = null;
  }

  return {
    el: h('section', { class: `page ${className}` }, status, rows.el),
    mount() {
      fill().catch((err) => {
        const text = onError(err);
        if (!destroyed && text) status.textContent = text;
      });
    },
    destroy() {
      destroyed = true;
      rows.destroy();
    },
    /** Down from the top bar: the first row, on the card it was left from. */
    enterFromBar: () => rows.focusTop(),
    saveState: () => ({ focus: rows.savedFocus(), onBar: focusOnBar(ctx.focus) }),
    restoreState(state) {
      restored = (state && state.focus) || null;
      onBar = Boolean(state && state.onBar); // left from the bar (the search): it keeps the focus
    },
  };
}
