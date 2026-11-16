import { t } from '../../i18n/index.js';
import { log } from '../../core/logger.js';
import { createCarouselPage } from './templates.js';

/** Suggested titles available in the provider catalog (TMDB recommendations from the watch history). */
export function createSuggestionsPage(ctx) {
  return createCarouselPage(ctx, {
    className: 'suggestions',
    loadingText: t('suggestions.loading'),
    prefix: 'suggestions',
    onOpen: (entry) => ctx.openEntry(entry, { section: 'suggestions' }),
    async load() {
      const result = await ctx.suggestions.build({ limit: 500 });
      const status = !result.entries.length ? t('common.empty') : result.source === 'history' ? t('suggestions.fromHistory') : t('suggestions.trending');
      return { entries: result.entries, status };
    },
    onError: (err) => {
      log.warn('Suggestions failed', err && err.message);
      return t('error.NETWORK');
    },
  });
}
