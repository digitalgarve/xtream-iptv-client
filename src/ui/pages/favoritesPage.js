import { visibleFavorites } from '../../services/favoriteEntries.js';
import { t } from '../../i18n/index.js';
import { openFilter } from '../../services/favoriteFilters.js';
import { log } from '../../core/logger.js';
import { createCarouselPage } from './templates.js';

/** Titles, categories and genres the user marked with the heart, one carousel per type (categories and genres first). */
export function createFavoritesPage(ctx) {
  return createCarouselPage(ctx, {
    className: 'favorites',
    loadingText: t('player.loading'),
    hideFavorite: true, // everything here is a favourite: the heart would say nothing
    prefix: 'favorites',
    onOpen: (entry) => {
      if (entry.collectionId) ctx.router.push('collection', { id: entry.collectionId, section: 'favorites' });
      else if (entry.filterKind) openFilter(ctx, entry, { push: true });
      else ctx.openEntry(entry, { section: 'favorites' });
    },
    async load() {
      const current = await ctx.active.get();
      if (!current) return null;
      const entries = await visibleFavorites(ctx, current);
      return { entries, status: entries.length ? '' : t('common.empty') };
    },
    onError: (err) => log.warn('Favorites failed', err && err.message) || '',
  });
}
