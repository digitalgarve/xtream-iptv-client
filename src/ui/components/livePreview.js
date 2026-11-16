import { h } from '../dom.js';
import { t } from '../../i18n/index.js';
import { formatClockTime } from '../../core/clock.js';
import { log } from '../../core/logger.js';

/** One embedded player: expanding it changes only the video rectangle, never opens a second stream. */
export function createLivePreview(ctx, { onChannelChange = () => {} } = {}) {
  const video = h('div', { class: 'live-preview-video' });
  const title = h('h2', { text: t('livePreview.select') });
  const programmes = h('div', { class: 'live-preview-programmes' });
  const hint = h('p', { class: 'muted', text: t('livePreview.help') });
  const el = h('aside', { class: 'live-preview', 'aria-label': t('settings.liveView.list') }, video, title, programmes, hint);
  let player = null;
  let entry = null;
  let timer = null;
  let refresh = null;
  let generation = 0;
  let epgRequest = 0;
  let fullscreen = false;
  let timeFormat = 'auto';
  let unsupported = false;

  function rectangle() {
    const r = video.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), width: Math.max(1, Math.round(r.width)), height: Math.max(1, Math.round(r.height)) };
  }

  function resize() {
    if (player) {
      try { player.setViewport(fullscreen ? null : rectangle()); }
      catch (err) { log.warn('Preview resize failed', err && err.message); }
    }
  }

  function expand(on) {
    fullscreen = on;
    el.classList.toggle('is-fullscreen', on);
    document.body.classList.toggle('live-preview-fullscreen', on);
    resize();
  }

  function stop() {
    generation += 1;
    clearTimeout(timer);
    clearInterval(refresh);
    expand(false);
    if (player) { player.destroy(); player.el.remove(); player = null; }
    entry = null;
    title.textContent = t('livePreview.select');
    programmes.textContent = '';
    if (ctx.screensaver) ctx.screensaver.setSuspended(false);
    if (ctx.notices && ctx.notices.setPlayback) ctx.notices.setPlayback(false);
    document.body.classList.remove('live-preview-active');
  }

  async function updateEpg(token) {
    const request = ++epgRequest;
    try {
      const result = ctx.epg && entry.epgChannelId ? await ctx.epg.nowNext(entry.epgChannelId) : {};
      if (token !== generation || request !== epgRequest) return;
      programmes.textContent = '';
      const rows = [result.now, result.next].filter(Boolean);
      if (!rows.length) programmes.textContent = t('livePreview.noEpg');
      rows.forEach((p, i) => {
        const time = `${formatClockTime(new Date(p.start), timeFormat)} – ${formatClockTime(new Date(p.stop), timeFormat)}`;
        const block = h('div', { class: 'live-preview-programme' }, h('div', { class: 'muted', text: time }), h('strong', { text: p.title }));
        if (i === 0 && p.start <= Date.now()) {
          block.appendChild(h('progress', { max: 1, value: Math.max(0, Math.min(1, (Date.now() - p.start) / (p.stop - p.start))), 'aria-label': p.title }));
          if (p.desc) block.appendChild(h('p', { class: 'live-preview-description', text: p.desc }));
        }
        programmes.appendChild(block);
      });
    } catch {
      if (token === generation && request === epgRequest) programmes.textContent = t('livePreview.noEpg');
    }
  }

  async function start(token, immediatelyFullscreen) {
    try {
      const { createPlayerPage } = await import('../pages/playerPage.js');
      if (token !== generation) return;
      const selected = entry;
      const next = createPlayerPage({ ...ctx, router: { ...ctx.router, back: () => expand(false) } }, {
        type: 'live', entryKey: selected.key, title: selected.name, icon: selected.icon,
        onChannelChange: (row) => {
          entry = row;
          title.textContent = row.name;
          updateEpg(generation);
          Promise.resolve(onChannelChange(row)).catch((err) => log.warn('Preview selection failed', err && err.message));
        },
        playlist: [{ id: selected.defaultId, ext: '', title: '' }], epgChannelId: selected.epgChannelId,
      });
      // Engines without an embedded viewport keep their existing full-screen playback via OK.
      if (!next.setViewport(rectangle())) {
        unsupported = true;
        hint.textContent = t('livePreview.unavailable');
        if (immediatelyFullscreen) ctx.openEntry(selected, { section: 'live' });
        return;
      }
      player = next;
      video.appendChild(player.el);
      document.body.classList.add('live-preview-active');
      player.mount();
      if (ctx.screensaver) ctx.screensaver.setSuspended(true);
      if (ctx.notices && ctx.notices.setPlayback) ctx.notices.setPlayback(true);
      if (immediatelyFullscreen) expand(true);
    } catch (err) {
      if (token === generation) hint.textContent = t('livePreview.unavailable');
      log.warn('Preview start failed', err && err.message);
    }
  }

  const canPreview = (row) => row && !row.isNetwork && !row.filterKind && row.defaultId !== undefined && !(ctx.parental && ctx.parental.isAdult(row));
  function select(row, clockFormat = 'auto') {
    if (entry && row && entry.key === row.key) return;
    stop();
    entry = row;
    timeFormat = clockFormat;
    title.textContent = row ? row.name : t('livePreview.select');
    programmes.textContent = '';
    hint.textContent = t(canPreview(row) ? 'livePreview.help' : 'livePreview.unavailable');
    if (!canPreview(row)) return;
    const token = generation;
    updateEpg(token);
    refresh = setInterval(() => updateEpg(token), 30000);
    timer = setTimeout(() => start(token, false), 500);
  }

  window.addEventListener('resize', resize);
  return {
    el, select, stop,
    activate(row) {
      if (!canPreview(row) || unsupported) return false;
      if (!entry || entry.key !== row.key) select(row, timeFormat);
      if (player) expand(true);
      else {
        clearTimeout(timer);
        // Invalidate an import still in flight before starting the selected channel immediately.
        generation += 1;
        const token = generation;
        clearInterval(refresh);
        refresh = setInterval(() => updateEpg(token), 30000);
        start(token, true);
      }
      return true;
    },
    onAction: (action) => fullscreen && player ? player.onAction(action) : false,
    onBack() {
      if (!fullscreen) return false;
      if (!player.onBack()) expand(false);
      return true;
    },
    destroy() { stop(); window.removeEventListener('resize', resize); },
  };
}
