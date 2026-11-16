import { createLivePreview } from '../../src/ui/components/livePreview.js';
import { createPlayerPage } from '../../src/ui/pages/playerPage.js';
import { Action } from '../../src/core/input.js';

jest.mock('../../src/ui/pages/playerPage.js', () => ({ createPlayerPage: jest.fn() }));
const flush = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };
const channel = (id) => ({ key: `live:${id}`, name: `Channel ${id}`, defaultId: id, epgChannelId: String(id) });
let ctx;
let players;
let preview;
beforeEach(() => {
  jest.useFakeTimers();
  players = [];
  createPlayerPage.mockImplementation(() => {
    const page = { el: document.createElement('section'), setViewport: jest.fn(() => true), mount: jest.fn(), destroy: jest.fn(), onAction: jest.fn(() => true), onBack: jest.fn(() => false) };
    players.push(page);
    return page;
  });
  ctx = {
    parental: { isAdult: (row) => Boolean(row.adult) },
    epg: { nowNext: jest.fn(async () => ({ now: { title: 'News', desc: 'Current news', start: Date.now() - 60000, stop: Date.now() + 60000 }, next: { title: 'Weather', start: Date.now() + 60000, stop: Date.now() + 120000 } })) },
    screensaver: { setSuspended: jest.fn() }, notices: { setPlayback: jest.fn() }, router: {}, openEntry: jest.fn(),
  };
  preview = createLivePreview(ctx);
  document.body.appendChild(preview.el);
});
afterEach(() => { preview.destroy(); document.body.innerHTML = ''; jest.clearAllMocks(); jest.useRealTimers(); });

test('fast navigation starts only the last channel; fullscreen and Back reuse the same player', async () => {
  preview.select(channel(1));
  jest.advanceTimersByTime(300);
  preview.select(channel(2));
  jest.advanceTimersByTime(500);
  await flush();
  expect(createPlayerPage).toHaveBeenCalledTimes(1);
  expect(createPlayerPage.mock.calls[0][1].playlist[0].id).toBe(2);
  expect(preview.el.textContent).toContain('Current news');
  expect(preview.el.textContent).toContain('Weather');
  expect(preview.onAction(Action.DOWN)).toBe(false);
  preview.activate(channel(2));
  expect(players[0].setViewport).toHaveBeenLastCalledWith(null);
  expect(preview.onAction(Action.DOWN)).toBe(true);
  expect(preview.onBack()).toBe(true);
  expect(document.body.classList.contains('live-preview-fullscreen')).toBe(false);
  expect(players[0].mount).toHaveBeenCalledTimes(1);
  expect(players[0].destroy).not.toHaveBeenCalled();
});

test('blocked channels and networks never autoplay; leaving cancels pending work', async () => {
  preview.select({ ...channel(1), adult: true });
  jest.advanceTimersByTime(1000);
  await flush();
  expect(ctx.epg.nowNext).not.toHaveBeenCalled();
  expect(preview.activate({ ...channel(1), adult: true })).toBe(false);
  preview.select({ ...channel(2), isNetwork: true });
  jest.advanceTimersByTime(1000);
  await flush();
  preview.select(channel(3));
  jest.advanceTimersByTime(500);
  preview.stop();
  await flush();
  expect(createPlayerPage).not.toHaveBeenCalled();
});

test('stale EPG results cannot replace the selected channel', async () => {
  let resolve;
  ctx.epg.nowNext.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  preview.select(channel(1));
  preview.select(channel(2));
  await flush();
  resolve({ now: { title: 'Old programme' } });
  await flush();
  expect(preview.el.textContent).toContain('News');
  expect(preview.el.textContent).not.toContain('Old programme');
});

test('OK during a pending preview starts once; destroying stops playback and timers', async () => {
  preview.select(channel(1));
  jest.advanceTimersByTime(500);
  preview.activate(channel(1));
  await flush();
  expect(players).toHaveLength(1);
  expect(players[0].mount).toHaveBeenCalledTimes(1);
  expect(document.body.classList.contains('live-preview-fullscreen')).toBe(true);
  preview.destroy();
  expect(players[0].destroy).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test('engines without viewport support fall back to the existing entry flow', async () => {
  createPlayerPage.mockImplementation(() => ({ setViewport: () => false }));
  preview.select(channel(1));
  preview.activate(channel(1));
  await flush();
  expect(ctx.openEntry).toHaveBeenCalledWith(channel(1), { section: 'live' });
  expect(preview.activate(channel(1))).toBe(false);
});

test('fullscreen consumes long OK without forwarding it to the hidden list; dialogs retain input', async () => {
  ctx.dialogs = { isOpen: jest.fn(() => false) };
  preview.select(channel(1));
  expect(preview.onAction(Action.LONG_ENTER)).toBe(false);
  preview.activate(channel(1));
  await flush();
  players[0].onAction.mockReturnValue(false);
  expect(preview.onAction(Action.LONG_ENTER)).toBe(true);
  expect(players[0].onAction).not.toHaveBeenCalled();
  expect(players[0].destroy).not.toHaveBeenCalled();
  ctx.dialogs.isOpen.mockReturnValue(true);
  expect(preview.onAction(Action.LONG_ENTER)).toBe(false);
  ctx.dialogs.isOpen.mockReturnValue(false);
  preview.onBack();
  expect(preview.onAction(Action.LONG_ENTER)).toBe(false);
});

test('fullscreen only remembers the latest channel; Back restores the list without restarting playback', async () => {
  preview.destroy();
  const changed = jest.fn();
  preview = createLivePreview(ctx, { onReturn: changed });
  preview.select(channel(1), '24h', { categoryId: 'sports', offset: 2 });
  preview.activate(channel(1));
  await flush();
  const params = createPlayerPage.mock.calls[0][1];
  expect(params.live).toEqual({ categoryId: 'sports', offset: 2 });
  params.onChannelChange(channel(2), { categoryId: 'sports', offset: 3 });
  params.onChannelChange(channel(3), { categoryId: 'sports', offset: 4 });
  expect(changed).not.toHaveBeenCalled();
  expect(players[0].destroy).not.toHaveBeenCalled();
  preview.onBack();
  expect(changed).toHaveBeenCalledTimes(1);
  expect(changed).toHaveBeenCalledWith(channel(3), { categoryId: 'sports', offset: 4 }, expect.any(Function));
  preview.select(channel(3), '24h', { categoryId: 'sports', offset: 4 });
  preview.activate(channel(3));
  expect(players[0].destroy).not.toHaveBeenCalled();
  expect(createPlayerPage).toHaveBeenCalledTimes(1);
});

test.each(['selection', 'fullscreen', 'destroy'])('a pending return cannot restore stale focus after %s', async (action) => {
  preview.destroy();
  let isCurrent;
  preview = createLivePreview(ctx, { onReturn: (row, context, current) => { isCurrent = current; } });
  preview.select(channel(1));
  preview.activate(channel(1));
  await flush();
  // Pointer Back and Stop use the embedded router's Back handler too.
  createPlayerPage.mock.calls[0][0].router.back();
  expect(isCurrent()).toBe(true);
  if (action === 'selection') preview.select(channel(2));
  else if (action === 'fullscreen') preview.activate(channel(1));
  else preview.destroy();
  expect(isCurrent()).toBe(false);
});
