import { createPlayerPage } from '../../src/ui/pages/playerPage.js';
import { createNoticeService } from '../../src/ui/components/notice.js';
import { Action } from '../../src/core/input.js';
import { openProviderDb } from '../../src/db/providerDb.js';
import { dbPutMany } from '../../src/core/idb.js';
import { LIVE_ALL } from '../../src/services/catalogQuery.js';
import { t } from '../../src/i18n/index.js';

const wait = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
let counter = 0;

async function setup() {
  const db = await openProviderDb(`player-live-${(counter += 1)}`);
  const row = (entryKey, added) => ({ key: `${entryKey}|${LIVE_ALL}`, entryKey, type: 'live', categoryId: LIVE_ALL, added });
  await dbPutMany(db, 'entries', [
    { key: 'live:i1', type: 'live', name: 'Sky Uno', defaultId: 1, networkKey: 'live:nSky', epgChannelId: 'c1' },
    { key: 'live:i3', type: 'live', name: 'Sky Due', defaultId: 3, networkKey: 'live:nSky' },
    { key: 'live:i2', type: 'live', name: 'Cielo', defaultId: 2 },
  ]);
  await dbPutMany(db, 'groups', [
    { key: 'live:nSky', type: 'live', name: 'Sky', memberKeys: ['live:i1', 'live:i3'] },
    { key: 'live:gRai', type: 'live', name: 'Rai 1', isGroup: true, defaultId: 11, members: [{ id: 11, name: 'Rai 1 HD' }, { id: 12, name: 'Rai 1 SD' }] },
  ]);
  await dbPutMany(db, 'entry_cat', [row('live:nSky', 30), row('live:gRai', 20), row('live:i2', 10)]);
  const engine = { available: () => true, start: jest.fn((url, opts) => (engine.handlers = opts.handlers)), play: jest.fn(), pause: jest.fn(), seekTo: jest.fn(), stop: jest.fn(), getTime: () => 0, getDuration: () => 0 };
  const now = Date.now();
  const client = { streamUrl: (type, id) => `http://h/${type}/${id}` };
  const ctx = {
    createEngine: () => engine,
    notices: createNoticeService({ root: document.body }),
    catalog: { pause() {}, resume() {} },
    settings: { get: async () => ({ bufferSeconds: 5, timeFormat: '24h' }) },
    active: { get: async () => ({ provider: { id: 'p' }, client, db }), authenticatedClient: jest.fn(() => new Promise(() => {})) },
    epg: { maybeSync: async () => null, nowNext: async (id) => (id === 'c1' ? { now: { title: 'News', start: now - 60000, stop: now + 3600000 }, next: null } : { now: null, next: null }) },
    dialogs: { isOpen: () => false, choose: jest.fn() },
    router: { back: jest.fn() },
  };
  const page = createPlayerPage(ctx, { type: 'live', entryKey: 'live:i1', title: 'Sky Uno', playlist: [{ id: 1, ext: '', title: '' }], index: 0, epgChannelId: 'c1' });
  document.body.appendChild(page.el);
  page.mount();
  await wait();
  return { page, ctx, engine };
}

const visible = (page) => Array.from(page.el.querySelectorAll('.player-btn')).filter((b) => b.style.display !== 'none').map((b) => b.getAttribute('aria-label'));
const focusedTip = (page) => (page.el.querySelector('.player-btn.focused') || { getAttribute: () => null }).getAttribute('data-tip');

afterEach(() => {
  document.body.innerHTML = '';
});

test('live starts without waiting for an account lookup', async () => {
  const { page, ctx, engine } = await setup();
  try {
    expect(ctx.active.authenticatedClient).not.toHaveBeenCalled();
    expect(engine.start).toHaveBeenCalledWith('http://h/live/1', expect.any(Object));
    expect(document.body.textContent).not.toContain(t('error.PLAYER'));
  } finally { page.destroy(); }
});

test('live: end of the programme after LIVE; network, previous and next before it; next goes over "show all" with networks opened up', async () => {
  const { page, ctx, engine } = await setup();
  expect(page.el.querySelector('.player-time').textContent).toMatch(/^LIVE · ends at \d\d:\d\d$/);
  expect(page.el.querySelector('.player-now').textContent).toBe('News');
  expect(visible(page).slice(0, 4)).toEqual(['Pause', 'Open the network', 'Previous channel', 'Next channel']); // Versions hidden: not a group
  expect(visible(page)).not.toContain('Subtitles'); // the stream has no subtitle tracks
  page.onAction(Action.ENTER); // focus on the controls: play / pause
  expect(focusedTip(page)).toBe('Pause');
  page.onAction(Action.RIGHT); // the network
  page.onAction(Action.RIGHT); // previous channel: the last of "show all" (wraps)
  await wait();
  expect(focusedTip(page)).toBe('Cielo');
  page.onAction(Action.RIGHT); // next channel: the other channel of the network
  await wait();
  expect(focusedTip(page)).toBe('Sky Due');
  page.onAction(Action.ENTER);
  await wait();
  expect(engine.start.mock.calls[engine.start.mock.calls.length - 1][0]).toBe('http://h/live/3');
  expect(page.el.querySelector('.player-title').textContent).toBe('Sky Due');
  expect(page.el.querySelector('.player-time').textContent).toMatch(/^LIVE$/); // no guide for this one
  // The network button lists its channels, titled with its name.
  ctx.dialogs.choose.mockResolvedValueOnce('live:i1');
  page.onAction(Action.LEFT);
  page.onAction(Action.LEFT);
  page.onAction(Action.ENTER);
  await wait();
  expect(ctx.dialogs.choose.mock.calls[0][0]).toMatchObject({ title: 'Sky', options: [{ label: 'Sky Uno', value: 'live:i1' }, { label: 'Sky Due', value: 'live:i3' }], selected: 'live:i3' });
  expect(engine.start.mock.calls[engine.start.mock.calls.length - 1][0]).toBe('http://h/live/1');
  page.destroy();
});

test('live group: "Versions" lists its streams and plays the chosen one', async () => {
  const { page, ctx, engine } = await setup();
  page.onAction(Action.CHANNEL_UP); // CH+ without a category: next channel over "show all" → the network's second channel
  await wait();
  page.onAction(Action.CHANNEL_UP); // → the group
  await wait();
  expect(page.el.querySelector('.player-title').textContent).toBe('Rai 1');
  expect(engine.start.mock.calls[engine.start.mock.calls.length - 1][0]).toBe('http://h/live/11');
  ctx.dialogs.choose.mockResolvedValueOnce(12);
  page.onAction(Action.ENTER); // focus on play / pause, then Versions (the group is in no network)
  page.onAction(Action.RIGHT);
  page.onAction(Action.ENTER);
  await wait();
  expect(ctx.dialogs.choose.mock.calls[0][0]).toMatchObject({ options: [{ label: 'Rai 1 HD', value: 11 }, { label: 'Rai 1 SD', value: 12 }], selected: 11 });
  expect(engine.start.mock.calls[engine.start.mock.calls.length - 1][0]).toBe('http://h/live/12');
  page.destroy();
});

test('live: the arrows do not change channel, they bring the controls with the focus on the first button on the left', async () => {
  const { page, engine } = await setup();
  const starts = engine.start.mock.calls.length;
  page.onAction(Action.DOWN);
  await wait();
  expect(engine.start.mock.calls.length).toBe(starts); // same channel
  expect(page.el.querySelector('.player-btn.focused').getAttribute('aria-label')).toBe('Pause'); // the first one: play / pause
  page.onBack(); // out of the controls
  page.onAction(Action.UP);
  await wait();
  expect(engine.start.mock.calls.length).toBe(starts);
  expect(page.el.querySelector('.player-btn.focused')).not.toBeNull();
  page.onBack();
  page.onAction(Action.CHANNEL_DOWN); // CH- changes channel: the last of "show all" (wraps)
  await wait();
  expect(engine.start.mock.calls[engine.start.mock.calls.length - 1][0]).toBe('http://h/live/2');
  page.destroy();
});

test('live: Subtitles only when the stream carries subtitle tracks; play after a pause goes on from there, "Back to live" goes to now', async () => {
  const { page, engine } = await setup();
  engine.getSubtitleTracks = () => [{ index: 0, language: 'ita' }];
  engine.handlers.onPrepared();
  engine.handlers.onBufferingDone();
  await wait();
  expect(visible(page)).toContain('Subtitles');
  const starts = engine.start.mock.calls.length;
  const plays = engine.play.mock.calls.length;
  expect(visible(page)).not.toContain('Back to live');
  page.onAction(Action.PLAY_PAUSE);
  expect(engine.pause).toHaveBeenCalledTimes(1);
  expect(visible(page).slice(0, 2)).toEqual(['Play', 'Back to live']); // next to play / pause
  page.onAction(Action.PLAY_PAUSE);
  await wait();
  expect(engine.play.mock.calls.length).toBe(plays + 1); // goes on from where it was paused
  expect(engine.start.mock.calls.length).toBe(starts);
  expect(visible(page)).toContain('Back to live'); // still behind live
  page.onAction(Action.ENTER); // the controls, on play / pause
  page.onAction(Action.RIGHT);
  expect(page.el.querySelector('.player-btn.focused').getAttribute('aria-label')).toBe('Back to live');
  page.onAction(Action.ENTER);
  await wait();
  expect(engine.start.mock.calls.length).toBe(starts + 1); // opened again: live
  expect(visible(page)).not.toContain('Back to live');
  expect(page.el.querySelector('.player-btn.focused').getAttribute('aria-label')).toBe('Pause');
  page.destroy();
});

test('audio listed late: looked at again after the start; the language of the app is chosen once, a choice of the user stays', async () => {
  const { page, ctx, engine } = await setup();
  let tracks = [];
  engine.getAudioTracks = () => tracks;
  engine.setAudioTrack = jest.fn((index) => { tracks = tracks.map((track) => ({ ...track, current: track.index === index })); });
  engine.handlers.onPrepared();
  engine.handlers.onBufferingDone();
  await wait();
  expect(visible(page)).toContain('Audio');
  // The stream lists its audio later (an HLS audio group): seen at the next look; the app speaks English: the English one is chosen.
  tracks = [{ index: 0, language: 'ita', current: true }, { index: 1, language: 'eng', current: false }];
  const realNow = Date.now;
  const start = realNow();
  Date.now = () => start + 6000;
  await wait(700);
  expect(visible(page)).toContain('Audio');
  expect(engine.setAudioTrack).toHaveBeenCalledWith(1);
  // The user goes back to Italian: the next looks leave it.
  ctx.dialogs.choose.mockResolvedValueOnce(0);
  openAudioWithRemote(page);
  await wait(200);
  Date.now = () => start + 12000;
  await wait(700);
  expect(engine.setAudioTrack).toHaveBeenCalledTimes(2);
  expect(tracks.find((track) => track.current).language).toBe('ita');
  Date.now = realNow;
  page.destroy();
});

function openAudioWithRemote(page) {
  page.onBack();
  page.onAction(Action.ENTER);
  for (let i = 0; i < 20; i += 1) {
    const focused = page.el.querySelector('.player-btn.focused');
    if (focused && focused.getAttribute('aria-label') === 'Audio') {
      page.onAction(Action.ENTER);
      return;
    }
    page.onAction(Action.RIGHT);
  }
  throw new Error('Audio button is not reachable with the remote');
}

test.each(['empty', 'throws'])('audio button remains reachable with %s track information', async (mode) => {
  const { page, engine, ctx } = await setup();
  engine.getAudioTracks = () => { if (mode === 'throws') throw new Error('not ready'); return []; };
  const warning = jest.spyOn(ctx.notices, 'warning');
  try {
    expect(visible(page)).toContain('Audio');
    openAudioWithRemote(page);
    await wait();
    expect(warning).toHaveBeenCalledWith('No audio track information available', expect.any(Object));
    expect(ctx.dialogs.choose).not.toHaveBeenCalled();
  } finally { page.destroy(); }
});

test('opening audio after the polling window reads a single unnamed track and marks it current', async () => {
  const { page, engine, ctx } = await setup();
  const now = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 120000);
  engine.getAudioTracks = jest.fn(() => [{ index: 7, language: '', current: true }]);
  ctx.dialogs.choose.mockResolvedValueOnce(null);
  try {
    openAudioWithRemote(page);
    await wait();
    expect(engine.getAudioTracks).toHaveBeenCalled();
    expect(ctx.dialogs.choose).toHaveBeenCalledWith({ title: 'Audio', options: [{ label: 'Audio track 1', value: 7 }], selected: 7 });
  } finally { now.mockRestore(); page.destroy(); }
});

test.each(['false', 'reject'])('failed audio switch (%s) never reports success', async (mode) => {
  const { page, engine, ctx } = await setup();
  engine.getAudioTracks = () => [{ index: 0, language: 'eng', current: true }, { index: 2, language: 'deu' }];
  engine.setAudioTrack = mode === 'false' ? jest.fn(() => false) : jest.fn(async () => { throw new Error('refused'); });
  ctx.dialogs.choose.mockResolvedValueOnce(2);
  const info = jest.spyOn(ctx.notices, 'info');
  const warning = jest.spyOn(ctx.notices, 'warning');
  try {
    openAudioWithRemote(page);
    await wait(220);
    expect(engine.setAudioTrack).toHaveBeenCalledWith(2);
    expect(warning).toHaveBeenCalledWith('Could not switch audio track', expect.any(Object));
    expect(info).not.toHaveBeenCalled();
  } finally { page.destroy(); }
});


test('audio without current metadata remembers success, prefers player metadata, and resets on a new stream', async () => {
  const { page, engine, ctx } = await setup();
  let tracks = [{ index: 0, current: false }, { index: 2, current: false }];
  engine.getAudioTracks = () => tracks;
  engine.setAudioTrack = jest.fn(() => true);
  ctx.dialogs.choose.mockResolvedValue(null).mockResolvedValueOnce(2);
  try {
    openAudioWithRemote(page);
    await wait(220);
    openAudioWithRemote(page);
    await wait();
    expect(ctx.dialogs.choose).toHaveBeenLastCalledWith(expect.objectContaining({ selected: 2 }));
    tracks[0].current = true;
    openAudioWithRemote(page);
    await wait();
    expect(ctx.dialogs.choose).toHaveBeenLastCalledWith(expect.objectContaining({ selected: 0 }));
    tracks[0].current = false;
    tracks = [tracks[0]];
    openAudioWithRemote(page);
    await wait();
    expect(ctx.dialogs.choose).toHaveBeenLastCalledWith(expect.objectContaining({ selected: 0 }));
    tracks.push({ index: 2, current: false });
    page.onAction(Action.CHANNEL_UP);
    await wait();
    expect(engine.start).toHaveBeenLastCalledWith('http://h/live/3', expect.any(Object));
    openAudioWithRemote(page);
    await wait();
    expect(ctx.dialogs.choose).toHaveBeenLastCalledWith(expect.objectContaining({ selected: 0 }));
  } finally { page.destroy(); }
});

test.each(['false', 'reject'])('failed audio switch (%s) preserves the last successful fallback', async (mode) => {
  const { page, engine, ctx } = await setup();
  engine.getAudioTracks = () => [{ index: 0 }, { index: 2 }, { index: 3 }];
  engine.setAudioTrack = jest.fn().mockReturnValueOnce(true);
  ctx.dialogs.choose.mockResolvedValue(null).mockResolvedValueOnce(2).mockResolvedValueOnce(3);
  try {
    openAudioWithRemote(page);
    await wait(220);
    if (mode === 'false') engine.setAudioTrack.mockReturnValueOnce(false);
    else engine.setAudioTrack.mockRejectedValueOnce(new Error('refused'));
    openAudioWithRemote(page);
    await wait(220);
    openAudioWithRemote(page);
    await wait();
    expect(ctx.dialogs.choose).toHaveBeenLastCalledWith(expect.objectContaining({ selected: 2 }));
  } finally { page.destroy(); }
});

test.each(['success', 'false', 'reject'])('automatic audio selection (%s) only remembers an applied track', async (mode) => {
  const { page, engine, ctx } = await setup();
  engine.getAudioTracks = () => [{ index: 0, language: 'ita' }, { index: 2, language: 'eng' }];
  engine.setAudioTrack = mode === 'reject' ? jest.fn().mockRejectedValue(new Error('refused')) : jest.fn().mockResolvedValue(mode !== 'false');
  ctx.dialogs.choose.mockResolvedValue(null);
  try {
    engine.handlers.onPrepared();
    engine.handlers.onBufferingDone();
    await wait();
    expect(engine.setAudioTrack).toHaveBeenCalledWith(2);
    openAudioWithRemote(page);
    await wait();
    expect(ctx.dialogs.choose).toHaveBeenLastCalledWith(expect.objectContaining({ selected: mode === 'success' ? 2 : 0 }));
  } finally { page.destroy(); }
});

test.each(['manual', 'automatic'])('a delayed %s audio switch cannot set the fallback for a new stream', async (mode) => {
  const { page, engine, ctx } = await setup();
  engine.getAudioTracks = () => [{ index: 0, language: 'ita' }, { index: 2, language: 'eng' }];
  let finish;
  engine.setAudioTrack = jest.fn(() => new Promise((resolve) => { finish = resolve; }));
  ctx.dialogs.choose.mockResolvedValue(null);
  try {
    if (mode === 'manual') {
      ctx.dialogs.choose.mockResolvedValueOnce(2);
      openAudioWithRemote(page);
      await wait(220);
    } else {
      engine.handlers.onPrepared();
      engine.handlers.onBufferingDone();
      await wait();
    }
    expect(engine.setAudioTrack).toHaveBeenCalledWith(2);
    page.onAction(Action.CHANNEL_UP);
    await wait();
    finish(true);
    await wait();
    openAudioWithRemote(page);
    await wait();
    expect(ctx.dialogs.choose).toHaveBeenLastCalledWith(expect.objectContaining({ selected: 0 }));
  } finally { page.destroy(); }
});

test('a preview destroyed while settings load cannot start a stale stream', async () => {
  const { page, ctx, engine } = await setup();
  page.destroy();
  engine.start.mockClear();
  let resolve;
  ctx.settings.get = () => new Promise((done) => { resolve = done; });
  const preview = createPlayerPage(ctx, { type: 'live', entryKey: 'live:i1', title: 'Sky Uno', playlist: [{ id: 1, ext: '', title: '' }] });
  preview.mount();
  await wait();
  preview.destroy();
  resolve({ bufferSeconds: 5 });
  await wait();
  expect(engine.start).not.toHaveBeenCalled();
});

test('CH+/CH− stays inside the selected category and reports the new list position', async () => {
  const { page, ctx, engine } = await setup();
  page.destroy();
  const { db } = await ctx.active.get();
  await dbPutMany(db, 'entry_cat', [
    { key: 'live:i1|sports', entryKey: 'live:i1', type: 'live', categoryId: 'sports', added: 30 },
    { key: 'live:i2|sports', entryKey: 'live:i2', type: 'live', categoryId: 'sports', added: 20 },
  ]);
  const changed = jest.fn();
  const player = createPlayerPage(ctx, { type: 'live', entryKey: 'live:i1', title: 'Sky Uno', playlist: [{ id: 1, ext: '', title: '' }], live: { categoryId: 'sports', offset: 0 }, onChannelChange: changed });
  player.mount();
  try {
    await wait();
    player.onAction(Action.CHANNEL_UP);
    await wait();
    expect(engine.start).toHaveBeenLastCalledWith('http://h/live/2', expect.any(Object));
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ key: 'live:i2' }), { categoryId: 'sports', offset: 1 });
    const starts = engine.start.mock.calls.length;
    player.onAction(Action.CHANNEL_UP);
    await wait();
    expect(engine.start).toHaveBeenCalledTimes(starts);
    player.onAction(Action.CHANNEL_DOWN);
    await wait();
    expect(engine.start).toHaveBeenLastCalledWith('http://h/live/1', expect.any(Object));
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ key: 'live:i1' }), { categoryId: 'sports', offset: 0 });
  } finally { player.destroy(); }
});

test.each([false, true])('Studio order and visibility apply to player controls (category: %s)', async (category) => {
  const { page, ctx, engine } = await setup();
  page.destroy();
  const { openAppDb } = require('../../src/db/appDb.js');
  const { kvSet } = require('../../src/db/kv.js');
  const { createGuideLayoutStore } = require('../../src/services/guideLayout.js');
  const { studioLayoutKey } = require('../../src/services/studioCatalog.js');
  ctx.db = await openAppDb(`player-studio-${counter}`);
  ctx.guideLayout = createGuideLayoutStore({ db: ctx.db });
  const { db } = await ctx.active.get();
  await dbPutMany(db, 'entries', [1, 2, 3].map(id => ({ key: `live:i${id}`, type: 'live', name: `Channel ${id}`, defaultId: id, categoryIds: ['sports'] })));
  await dbPutMany(db, 'entry_cat', [1, 2, 3].map(id => ({ key: `live:i${id}|sports`, entryKey: `live:i${id}`, type: 'live', categoryId: 'sports', added: id })));
  await ctx.guideLayout.save('p', { order: ['live:i3', 'live:i1'], hidden: ['live:i2'] });
  await kvSet(ctx.db, studioLayoutKey('p'), true);
  const changed = jest.fn();
  const player = createPlayerPage(ctx, { type: 'live', entryKey: 'live:i3', title: 'Channel 3', playlist: [{ id: 3, ext: '' }], live: category ? { categoryId: 'sports', offset: 0 } : null, onChannelChange: changed });
  player.mount();
  try {
    await wait();
    player.onAction(Action.CHANNEL_UP); await wait();
    expect(engine.start).toHaveBeenLastCalledWith('http://h/live/1', expect.any(Object));
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ key: 'live:i1' }), category ? { categoryId: 'sports', offset: 1 } : null);
    player.onAction(Action.CHANNEL_DOWN); await wait();
    expect(engine.start).toHaveBeenLastCalledWith('http://h/live/3', expect.any(Object));
    player.onAction(Action.ENTER);
    player.onAction(Action.RIGHT); // Previous channel
    await wait();
    expect(focusedTip(player)).toBe('Channel 1');
    player.onAction(Action.RIGHT); // Next channel
    await wait();
    expect(focusedTip(player)).toBe('Channel 1');
    player.onAction(Action.ENTER); await wait();
    expect(engine.start).toHaveBeenLastCalledWith('http://h/live/1', expect.any(Object));
    player.onAction(Action.CHANNEL_DOWN); await wait();
    expect(engine.start).toHaveBeenLastCalledWith('http://h/live/3', expect.any(Object));
    expect(engine.start.mock.calls.slice(1).some(([url]) => url === 'http://h/live/2')).toBe(false);
  } finally { player.destroy(); ctx.db.close(); }
});
