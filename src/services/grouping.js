import { MediaType } from './mediaType.js';
import { mergeGenres } from './genres.js';
import { normalizeTitle, normalizeChannelName, makeSearchKey, versionTags } from './titleNormalizer.js';

/**
 * Builds the entries shown in grids.
 * - Items sharing a provider tmdb id (same type) become ONE entry with several members (stream ids).
 * - Items without tmdb id are never merged: each is its own entry.
 * - Items in excluded categories are dropped before grouping.
 * - Several providers active (items with a `slot`, see catalogUnion.js): a title of one provider without a tmdb id joins the title of
 *   another provider with the same clean name and year (with or without tmdb id): no title twice. Within one provider nothing changes.
 * Output is sorted by `added` (newest first), where a group's `added` is the max of its members.
 * The card takes from its versions what they have: the first poster, rating, year, tmdb id and guide channel found.
 */
export function buildEntries(type, items, { excludedCategories = new Set(), cleanTitles = true } = {}) {
  let normalize = type === MediaType.LIVE ? normalizeChannelName : normalizeTitle;
  // With the "clean titles" preference off the movie / series titles stay as the provider wrote them.
  if (type !== MediaType.LIVE && !cleanTitles) {
    normalize = (raw) => {
      const cleanTitle = String(raw == null ? '' : raw).trim();
      return { cleanTitle, year: null, searchKey: makeSearchKey(cleanTitle) };
    };
  }
  const groups = new Map();

  for (const item of items) {
    if (excludedCategories.has(item.categoryId)) continue;
    const groupKey = item.tmdbId ? `${type}:t${item.tmdbId}` : `${type}:i${item.id}`;
    const norm = normalize(item.name);
    const member = { item, norm };
    const group = groups.get(groupKey);
    if (group) group.push(member);
    else groups.set(groupKey, [member]);
  }

  if (type !== MediaType.LIVE && items.some((item) => item.slot)) mergeAcrossProviders(groups);

  const entries = [];
  for (const [key, members] of groups) {
    members.sort((a, b) => a.item.id - b.item.id);
    const base = members[0]; // lowest id is the default stream
    const ratings = members.map((m) => m.item.rating).filter((r) => r);
    const first = (field) => (members.find((m) => m.item[field]) || base).item[field];
    entries.push({
      key,
      type,
      tmdbId: base.item.tmdbId || first('tmdbId'),
      name: base.norm.cleanTitle,
      year: members.map((m) => m.norm.year || m.item.year).find(Boolean) || null,
      rating: base.item.rating || (ratings.length ? Math.max(...ratings) : null),
      added: Math.max(...members.map((m) => m.item.added)),
      defaultId: base.item.id,
      memberIds: members.map((m) => m.item.id),
      // `tags`: what each version is, from its own name (HD, FHD, ITA, CAM...): the label of the version (streamLabel).
      members: members.map((m) => {
        const tags = type === MediaType.LIVE ? [] : versionTags(m.item.name);
        return { id: m.item.id, ext: m.item.ext, categoryId: m.item.categoryId, ...(tags.length ? { tags } : {}), ...(m.item.slot ? { slot: m.item.slot } : {}) };
      }),
      categoryIds: Array.from(new Set(members.map((m) => m.item.categoryId))),
      searchKeys: Array.from(new Set(members.map((m) => m.norm.searchKey))),
      genres: type === MediaType.LIVE ? [] : mergeGenres(members.map((m) => m.item.genre)),
      icon: base.item.icon || first('icon'),
      epgChannelId: base.item.epgChannelId || first('epgChannelId'),
      ...(members.some((m) => m.item.adult) ? { adult: true } : {}), // the provider's own flag
    });
  }

  entries.sort((a, b) => b.added - a.added || (a.key < b.key ? -1 : 1));
  return entries;
}

/**
 * Titles of different providers that are the same: a group of one provider without a tmdb id goes into the group of another provider with
 * the same clean name and year (a tmdb group first). Groups of one provider are never merged with each other (that is the provider's own
 * catalog, as always).
 */
function mergeAcrossProviders(groups) {
  const slotsOf = (members) => new Set(members.map((m) => m.item.slot || 0));
  const keyOf = (members) => {
    const m = members[0];
    return `${m.norm.searchKey}|${m.norm.year || m.item.year || ''}`;
  };
  const byName = new Map(); // name|year → group keys, tmdb groups first
  const ordered = Array.from(groups.keys()).sort((a, b) => (a.indexOf(':t') > 0 ? 0 : 1) - (b.indexOf(':t') > 0 ? 0 : 1));
  ordered.forEach((key) => {
    const members = groups.get(key);
    const name = keyOf(members);
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(key);
  });
  byName.forEach((keys) => {
    if (keys.length < 2) return;
    keys.forEach((key) => {
      if (key.indexOf(':t') > 0 || !groups.has(key)) return; // only groups without a tmdb id move
      const members = groups.get(key);
      const mine = slotsOf(members);
      const target = keys.find((other) => other !== key && groups.has(other) && !Array.from(slotsOf(groups.get(other))).some((slot) => mine.has(slot)));
      if (!target) return;
      groups.get(target).push(...members);
      groups.delete(key);
    });
  });
}

/** One row per (entry, category) so IndexedDB can page "category + newest first" with a single index. */
export function buildEntryCategoryRows(entries) {
  const rows = [];
  for (const entry of entries) {
    for (const categoryId of entry.categoryIds) {
      rows.push({
        key: `${entry.key}|${categoryId}`,
        entryKey: entry.key,
        type: entry.type,
        categoryId,
        added: entry.added,
      });
    }
  }
  return rows;
}

/** One row per (entry, genre) so a genre can be paged "newest first" with a single index. */
export function buildEntryGenreRows(entries) {
  const rows = [];
  for (const entry of entries) {
    for (const genre of entry.genres || []) {
      rows.push({ key: `${entry.key}|${genre.key}`, entryKey: entry.key, type: entry.type, genreKey: genre.key, name: genre.name, added: entry.added });
    }
  }
  return rows;
}
