import { requestToPromise } from '../core/idb.js';
import { isHidden } from './catalogQuery.js';
import { kvGet } from '../db/kv.js';
import { applyGuideLayout } from './guideLayout.js';

/** Every downloaded live stream, including quality variants and channels without EPG. Profile restrictions still apply. */
export async function readStudioChannels(db) {
  const tx = db.transaction(['entries', 'groups'], 'readonly');
  const [rows, groups] = await Promise.all([
    requestToPromise(tx.objectStore('entries').getAll(IDBKeyRange.bound('live:', 'live:\uffff'))),
    requestToPromise(tx.objectStore('groups').getAll()),
  ]);
  const names = new Map();
  groups.filter((group) => group.isGroup).forEach((group) => (group.members || []).forEach((member) => { if (member.name) names.set(member.entryKey || `live:i${member.id}`, member.name); }));
  return rows.filter((row) => !isHidden(row.key)).map((row) => names.has(row.key) ? { ...row, name: names.get(row.key) } : row);
}
export const studioLayoutKey = (providerId) => `studio:live-layout:${providerId}`;

/** After a Studio import, the all/category views use the same individual streams that were edited. */
export async function readStudioLiveLayout(ctx, providerId, db) {
  if (!ctx.db) return null;
  if (!(await kvGet(ctx.db, studioLayoutKey(providerId), false))) return null;
  return applyGuideLayout(await readStudioChannels(db), await ctx.guideLayout.read(providerId, db));
}
