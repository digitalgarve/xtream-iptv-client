import { EventBus } from '../core/eventBus.js';
import { createGate } from '../core/gate.js';
import { log } from '../core/logger.js';
import { openProviderDb } from '../db/providerDb.js';
import { MediaType } from './mediaType.js';
import { SYNC_ORDER, getSyncStatus } from './syncMeta.js';
import { readUnion, writeUnion, unionSources } from './catalogUnion.js';

/** The sync on the main thread (when no worker can be made): its code is loaded only then, not with the start-up bundle. */
const runSyncForProvider = (args) => import(/* webpackChunkName: "catalog-local" */ './catalogSync.js').then((m) => m.runSyncForProvider(args));

const emptyState = () => ({
  running: false,
  startedAt: 0,
  paused: false,
  mode: null, // 'worker' | 'main'
  providerId: null,
  error: null,
  types: Object.fromEntries(SYNC_ORDER.map((type) => [type, { phase: 'idle' }])),
});

/**
 * Main-thread side of the catalog sync. It prefers a Web Worker; when the worker cannot be created or
 * does not report ready in time (e.g. blocked by the CSP of a remote page) it runs the very same
 * code on the main thread instead.
 */
export class CatalogSyncService {
  constructor({ providers, settings, createWorker, getCleanTitles = () => true, getGrouping = async () => undefined, getTitleSearch = async () => null, runLocal = runSyncForProvider, readyTimeoutMs = 4000 }) {
    /** `getTitleSearch()`: { tmdbKey, language } when the titles without a TMDB id are looked for on TMDB by title, otherwise null. */
    this.getTitleSearch = getTitleSearch;
    this.providers = providers;
    this.settings = settings;
    this.createWorker = createWorker;
    this.getCleanTitles = getCleanTitles;
    this.getGrouping = getGrouping;
    this.runLocal = runLocal;
    this.readyTimeoutMs = readyTimeoutMs;
    this.bus = new EventBus();
    this.gate = createGate();
    this.state = emptyState();
    this.job = null;
    this.worker = null;
    this.controller = null;
    this.cancelWorkerRun = null;
  }

  onChange(handler) {
    return this.bus.on('change', handler);
  }

  getState() {
    return this.state;
  }

  /** Counts and timings saved by previous syncs, read straight from the provider database. */
  async readStatus(providerId) {
    const db = await openProviderDb(providerId);
    try {
      return await getSyncStatus(db);
    } finally {
      db.close();
    }
  }

  /**
   * Says to every active provider's database what it is in the unified catalog (catalogUnion.js): the main one gets the list of the other
   * active providers, they are members. Resolves true when the main one's list changed (its catalog must be worked out again).
   */
  async writeUnionRoles(active) {
    const [main, ...others] = active;
    const sources = others.map((p) => ({ id: p.id, slot: p.slot, name: p.name }));
    const db = await openProviderDb(main.id);
    let changed = false;
    try {
      const before = await readUnion(db);
      changed = JSON.stringify(unionSources(before).map((s) => [s.id, s.slot])) !== JSON.stringify(sources.map((s) => [s.id, s.slot])) || Boolean(before && before.role);
      // `pending`: the catalog is still to be worked out with these sources (kept until a run of the main one ends well, even if this
      // run is cancelled by a new one).
      const pending = changed || Boolean(before && before.pending);
      await writeUnion(db, sources.length || pending ? { sources, ...(pending ? { pending: true } : {}) } : null);
      changed = pending;
    } finally {
      db.close();
    }
    for (const other of others) {
      const odb = await openProviderDb(other.id);
      try {
        await writeUnion(odb, { role: 'member' });
      } finally {
        odb.close();
      }
    }
    return changed;
  }

  async payloadFor(provider, { types, force, rewrite, rebuildTypes = [] }) {
    const excluded = {};
    for (const type of Object.values(MediaType)) {
      excluded[type] = Array.from(await this.settings.getExcluded(provider.id, type));
    }
    return {
      provider: { id: provider.id, type: provider.type || 'xtream', baseUrl: provider.baseUrl, username: provider.username, password: provider.password, playlistUrl: provider.playlistUrl || '', epgUrl: provider.epgUrl || '' },
      types,
      excluded,
      cleanTitles: Boolean(await this.getCleanTitles()),
      grouping: await this.getGrouping(provider.id),
      force,
      rewrite,
      rebuildTypes,
      search: (await this.getTitleSearch().catch(() => null)) || null,
    };
  }

  /**
   * Starts (or restarts) a sync of the active providers. Resolves with the final `done` event of the main one, or null.
   * With several active, the others are synced first (their lists only), then the main one, whose catalog is worked out from all of them;
   * when only another provider's list changed (or the active ones changed) the main one's catalog is worked out again without a download.
   * `rewrite`: every row written again, not only what changed (the forced update of one type from Settings). `only`: one provider.
   */
  async start({ force = false, types = SYNC_ORDER, rewrite = false, only = null } = {}) {
    const active = this.providers.listActive ? await this.providers.listActive() : [await this.providers.getActive()].filter(Boolean);
    if (!active.length) return null;
    this.cancel();
    const job = {};
    this.job = job;
    this.state = { ...emptyState(), running: true, startedAt: Date.now(), paused: this.gate.isPaused(), providerId: active[0].id };
    types.forEach((type) => {
      this.state.types[type] = { phase: 'queued' };
    });
    this.notify();

    // (A provider store without several active ones, as in tests, has no unified catalog to describe.)
    let unionDirty = !this.providers.listActive ? false : await this.writeUnionRoles(active).catch((err) => {
      log.warn('Unified catalog roles failed', err && err.message);
      return false;
    });
    job.final = false; // the runs of the other providers do not end the job
    for (const member of active.slice(1)) {
      if (only && only !== member.id) continue;
      if (this.job !== job) return null;
      this.state.providerId = member.id;
      const outcome = await this.runOne(job, await this.payloadFor(member, { types, force, rewrite }));
      if (outcome && (outcome.results || []).some((r) => r.meta && r.meta.changes)) unionDirty = true;
    }
    if (this.job !== job) return null;
    job.final = true;
    if (only && only !== active[0].id && !unionDirty) {
      this.state.running = false;
      this.job = null;
      this.notify();
      return { event: 'done', results: [], error: null };
    }
    this.state.providerId = active[0].id;
    const mainForce = only && only !== active[0].id ? false : force;
    const outcome = await this.runOne(job, await this.payloadFor(active[0], { types, force: mainForce, rewrite, rebuildTypes: unionDirty ? types : [] }));
    // Done with the main one: the unified catalog is up to date with its sources.
    if (outcome && !outcome.cancelled && !outcome.error && this.providers.listActive) {
      const db = await openProviderDb(active[0].id).catch(() => null);
      if (db) {
        try {
          const record = await readUnion(db);
          if (record && record.pending) await writeUnion(db, { sources: unionSources(record) });
        } finally {
          db.close();
        }
      }
    }
    return outcome;
  }

  async runOne(job, payload) {
    let outcome = null;
    try {
      outcome = await this.runInWorker(job, payload);
    } catch (err) {
      log.warn('Catalog worker unavailable, using the main thread:', err.message);
    }
    if (!outcome && this.job === job) outcome = await this.runOnMain(job, payload);
    return outcome;
  }

  runInWorker(job, payload) {
    return new Promise((resolve, reject) => {
      let worker;
      try {
        worker = this.createWorker();
      } catch (err) {
        reject(err);
        return;
      }
      this.worker = worker;
      let ready = false;
      const finish = () => {
        clearTimeout(timer);
        worker.terminate();
        if (this.worker === worker) {
          this.worker = null;
          this.cancelWorkerRun = null;
        }
      };
      // cancel() uses this to end the pending promise of a worker that is being terminated.
      this.cancelWorkerRun = () => {
        finish();
        resolve({ event: 'done', results: [], error: null, cancelled: true });
      };
      const timer = setTimeout(() => {
        if (ready) return;
        finish();
        reject(new Error('worker did not report ready'));
      }, this.readyTimeoutMs);

      worker.onmessage = (event) => {
        const message = event.data || {};
        if (message.event === 'ready') {
          ready = true;
          clearTimeout(timer);
          this.state.mode = 'worker';
          worker.postMessage({ op: 'start', ...payload });
          if (this.gate.isPaused()) worker.postMessage({ op: 'pause' });
          this.notify();
        } else if (message.event === 'done') {
          this.handle(job, message);
          finish();
          resolve(message);
        } else {
          this.handle(job, message);
        }
      };
      worker.onerror = (event) => {
        finish();
        reject(new Error((event && event.message) || 'worker error'));
      };
    });
  }

  async runOnMain(job, payload) {
    this.state.mode = 'main';
    this.controller = new AbortController();
    const excluded = Object.fromEntries(Object.entries(payload.excluded).map(([type, ids]) => [type, new Set(ids)]));
    return this.runLocal({
      provider: payload.provider,
      types: payload.types,
      excluded,
      cleanTitles: payload.cleanTitles,
      grouping: payload.grouping || undefined,
      force: payload.force,
      rewrite: payload.rewrite,
      rebuildTypes: payload.rebuildTypes || [],
      search: payload.search,
      signal: this.controller.signal,
      emit: (message) => this.handle(job, message),
      gate: this.gate.wait,
    });
  }

  handle(job, message) {
    if (this.job !== job) return; // stale event from a cancelled run
    if (message.event === 'account') {
      if (this.state.providerId && this.providers.update) this.providers.update(this.state.providerId, { expiresAt: message.expiresAt || null }).catch(() => undefined);
      return;
    }
    if (message.event === 'info') {
      log.info(message.message);
      return;
    }
    if (message.event === 'done') {
      this.state.error = message.error || null;
      // The run of another active provider ends: the job goes on with the next one (the main one ends it).
      if (job.final !== false) {
        this.state.running = false;
        this.job = null;
      }
    } else if (message.event === 'progress') {
      if (message.mediaType) {
        this.state.types[message.mediaType] = { ...message };
        const m = message.meta;
        if (message.phase === 'done' && m) log.info(`Catalog ${message.mediaType}: ${m.itemCount} items, ${m.entryCount} entries, ${m.categoryCount} categories, ${m.changes === undefined ? "?" : m.changes} rows changed; fetch ${m.fetchMs} ms, write ${m.writeMs} ms, total ${m.durationMs} ms`);
        else if (message.phase === 'error') log.warn(`Catalog ${message.mediaType} failed: ${message.code || ''} ${message.message || ''}`);
      } else if (message.phase === 'error') this.state.error = { code: message.code, message: message.message };
    }
    this.notify();
  }

  /** Background work must not compete with a playing stream: call pause() when playback starts. */
  pause() {
    this.gate.pause();
    this.state.paused = true;
    if (this.worker) this.worker.postMessage({ op: 'pause' });
    this.notify();
  }

  resume() {
    this.gate.resume();
    this.state.paused = false;
    if (this.worker) this.worker.postMessage({ op: 'resume' });
    this.notify();
  }

  cancel() {
    if (!this.job && !this.worker) return;
    this.job = null;
    if (this.controller) this.controller.abort();
    this.controller = null;
    if (this.worker) {
      this.worker.postMessage({ op: 'cancel' });
      if (this.cancelWorkerRun) this.cancelWorkerRun();
      this.worker = null;
    }
    this.gate.release();
    this.state = { ...this.state, running: false, cancelled: true };
    this.notify();
  }

  notify() {
    this.bus.emit('change', this.state);
  }
}
