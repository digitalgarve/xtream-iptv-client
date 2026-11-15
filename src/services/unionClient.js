import { decodeId, encodeId } from './catalogUnion.js';

/**
 * The API client of the unified catalog (catalogUnion.js): every call about a title or a channel goes to the provider it comes from (the
 * slot of its id) with that provider's own id. The episodes of a series of another provider get ids of the unified catalog, so their
 * streams go to it as well. `main`: the client of the main provider; `others`: [{ slot, client }].
 */
export function createUnionClient(main, others) {
  const bySlot = new Map(others.map((o) => [o.slot, o.client]));
  const route = (id) => {
    const { slot, id: own } = decodeId(id);
    return { client: (slot && bySlot.get(slot)) || main, id: own, slot: bySlot.has(slot) ? slot : 0 };
  };
  const recodeEpisodes = (info, slot) => {
    if (!slot || !info || !info.episodes) return info;
    const recode = (list) => (list || []).map((ep) => (ep && ep.id !== undefined ? { ...ep, id: String(encodeId(slot, ep.id)) } : ep));
    if (Array.isArray(info.episodes)) return { ...info, episodes: recode(info.episodes) };
    const episodes = {};
    Object.keys(info.episodes).forEach((season) => {
      episodes[season] = recode(info.episodes[season]);
    });
    return { ...info, episodes };
  };
  return {
    union: true,
    get detailsInLists() {
      return main.detailsInLists;
    },
    authenticate: () => main.authenticate(),
    prepare: () => Promise.all([main, ...others.map((o) => o.client)].map((c) => (c.prepare ? c.prepare().catch(() => undefined) : undefined))),
    getCategories: (...args) => main.getCategories(...args),
    getStreams: (...args) => main.getStreams(...args),
    getVodInfo(id) {
      const r = route(id);
      return r.client.getVodInfo(r.id);
    },
    async getSeriesInfo(id) {
      const r = route(id);
      return recodeEpisodes(await r.client.getSeriesInfo(r.id), r.slot);
    },
    getShortEpg(id, ...rest) {
      const r = route(id);
      return r.client.getShortEpg ? r.client.getShortEpg(r.id, ...rest) : Promise.resolve([]);
    },
    streamUrl(type, id, ext) {
      const r = route(id);
      return r.client.streamUrl(type, r.id, ext);
    },
  };
}
