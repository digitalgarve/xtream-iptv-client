import { kvGet, kvSet } from '../db/kv.js';
import { readStudioChannels, studioLayoutKey } from './studioCatalog.js';
import { readGuideIndex } from './guideIndex.js';
import { listCategories } from './catalogQuery.js';
import { bumpCatalogRev } from './derivedStore.js';
import { applyGuideLayout } from './guideLayout.js';

const randomRef = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');

export const EXCHANGE_LIMIT = 10 * 1024 * 1024;
const STATE_KEY = 'guide:exchange';
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c],
  );

/** Only random exchange references leave the device; the provider and catalog keys stay in its local mapping. */
export async function exportGuideExchange(ctx) {
  const current = await ctx.active.get();
  if (!current) throw new Error('No active provider');
  const rows = await readStudioChannels(current.db);
  if (!rows.length) throw new Error('No live channels');
  const layout = await ctx.guideLayout.read(current.provider.id, current.db);
  const ordered = applyGuideLayout(rows, { ...layout, hidden: [] });
  const keys = ordered.map((row) => row.key);
  const refs = keys.map(() => randomRef());
  const secrets = (current.active || [current.provider]).flatMap((provider) => [provider.id, provider.name, provider.username, provider.password]).filter(Boolean).map((value) => String(value).toLowerCase());
  const cleanName = (value, fallback) => {
    const name = String(value || '').replace(/(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/\S*)?/gi, '').slice(0, 300).trim();
    return !name || secrets.some((secret) => name.toLowerCase().includes(secret)) ? fallback : name;
  };
  const categories = new Map((await listCategories(current.db, 'live')).map((category, i) => [String(category.id), cleanName(category.name, `Kategorie ${i + 1}`)]));
  const hidden = new Set(layout.hidden);
  const slots = ordered.map((row, index) => ({
    ref: refs[index], name: cleanName(row.name, `Sender ${index + 1}`),
    categories: Array.from(new Set((row.categoryIds || []).map((id) => categories.get(String(id))).filter(Boolean))),
    visible: !hidden.has(row.key) && !hidden.has(row.groupKey),
  }));
  await kvSet(ctx.db, STATE_KEY, { providerId: current.provider.id, keys, refs, scope: 'live' });
  const xml = (
    '<?xml version="1.0" encoding="UTF-8"?>\n<channel-layout version="1">\n' +
    slots
      .map(
        ({ ref, name, categories, visible }) =>
          `  <channel ref="${ref}" visible="${visible}"><name>${escape(name)}</name>${categories.map((name) => `<category>${escape(name)}</category>`).join('')}</channel>`,
      )
      .join('\n') +
    '\n</channel-layout>\n'
  );
  if (new Blob([xml]).size > EXCHANGE_LIMIT || slots.length > 20000) throw new Error('Channel list too large');
  return xml;
}

export function parseGuideExchange(xml) {
  if (typeof xml !== 'string' || xml.length > EXCHANGE_LIMIT || /<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error('Invalid XML');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const root = doc.documentElement;
  if (
    doc.querySelector('parsererror') ||
    root.nodeName !== 'channel-layout' ||
    root.getAttribute('version') !== '1'
  )
    throw new Error('Invalid channel layout');
  const seen = new Set();
  const rows = Array.from(root.children).map((node) => {
    const ref = node.getAttribute('ref');
    const visible = node.getAttribute('visible');
    if (
      node.nodeName !== 'channel' ||
      !/^[a-f0-9]{32}$/.test(ref || '') ||
      seen.has(ref) ||
      !['true', 'false'].includes(visible)
    )
      throw new Error('Invalid channel');
    seen.add(ref);
    return { ref, visible: visible === 'true' };
  });
  if (!rows.length) throw new Error('Empty channel layout');
  return rows;
}

export async function importGuideExchange(ctx, xml) {
  const rows = parseGuideExchange(xml);
  const current = await ctx.active.get();
  const state = await kvGet(ctx.db, STATE_KEY, null);
  const mapping = new Map((state ? state.refs : []).map((ref, i) => [ref, state.keys[i]]));
  if (
    !current ||
    !state ||
    state.providerId !== current.provider.id ||
    rows.some((row) => !mapping.has(row.ref))
  )
    throw new Error('No matching local export');
  const channels = state.scope === 'live' ? await readStudioChannels(current.db) : await readGuideIndex(current.db);
  const available = new Set(channels.map((row) => row.key));
  const previous = await ctx.guideLayout.read(current.provider.id, current.db);
  const edited = rows
    .map((row) => ({ key: mapping.get(row.ref), visible: row.visible }))
    .filter((row) => available.has(row.key));
  if (!edited.length) throw new Error('No matching channels');
  const changed = new Set(edited.map((row) => row.key));
  const inheritedHidden = new Set(previous.hidden);
  channels.forEach((row) => { if (previous.hidden.includes(row.groupKey)) inheritedHidden.add(row.key); });
  const next = {
    order: edited.map((row) => row.key).concat(previous.order.filter((key) => !changed.has(key))),
    hidden: Array.from(inheritedHidden)
      .filter((key) => !changed.has(key))
      .concat(edited.filter((row) => !row.visible).map((row) => row.key)),
  };
  if (state.scope !== 'live') { await ctx.guideLayout.save(current.provider.id, next); return edited.length; }
  // Guide rows collapse variants. Their order follows the first variant; hide only when all variants are hidden.
  const byKey = new Map(channels.map((row) => [row.key, row]));
  const groups = new Map();
  channels.forEach((row) => { if (row.groupKey) { if (!groups.has(row.groupKey)) groups.set(row.groupKey, []); groups.get(row.groupKey).push(row.key); } });
  const hidden = new Set(next.hidden);
  const projected = [];
  const seen = new Set();
  next.order.forEach((key) => { const group = byKey.get(key)?.groupKey; for (const candidate of [key, group].filter(Boolean)) { if (!seen.has(candidate)) { seen.add(candidate); projected.push(candidate); } } });
  groups.forEach((members, key) => { if (!members.some((member) => changed.has(member))) return; if (members.every((member) => hidden.has(member))) hidden.add(key); else hidden.delete(key); });
  await ctx.guideLayout.save(current.provider.id, { order: projected, hidden: Array.from(hidden) });
  await kvSet(ctx.db, studioLayoutKey(current.provider.id), true);
  await bumpCatalogRev(current.db);
  return edited.length;
}
