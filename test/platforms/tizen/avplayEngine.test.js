import { createAvPlayEngine } from '../../../platforms/tizen/avplayEngine.js';

afterEach(() => {
  delete global.webapis;
});

test('aspect ratio: letterbox, full screen, cropped; only setDisplayMethod; false when AVPlay refuses the mode', () => {
  const calls = [];
  let refuse = false;
  global.webapis = {
    avplay: {
      open() {},
      prepareAsync() {},
      setDisplayRect: (...a) => calls.push(['rect', ...a]),
      setDisplayMethod: (m) => {
        if (refuse) throw new Error('InvalidValuesError');
        calls.push(['method', m]);
      },
    },
  };
  const engine = createAvPlayEngine();
  expect(engine.aspectModes).toBeUndefined(); // all three modes of the player
  expect(['fit', 'fill', 'zoom'].map((mode) => engine.setAspect(mode))).toEqual([true, true, true]);
  expect(calls).toEqual([
    ['method', 'PLAYER_DISPLAY_MODE_LETTER_BOX'],
    ['method', 'PLAYER_DISPLAY_MODE_FULL_SCREEN'],
    ['method', 'PLAYER_DISPLAY_MODE_CROPPED_FULL'],
  ]);
  refuse = true;
  expect(engine.setAspect('zoom')).toBe(false);
});

test('subtitles: the track is chosen while playing, without reopening; off only stops drawing', () => {
  const calls = [];
  let listener = null;
  global.webapis = {
    avplay: {
      open: (url) => calls.push(`open ${url}`),
      setDisplayRect() {},
      setBufferingParam() {},
      setListener: (l) => {
        listener = l;
      },
      prepareAsync: (ok) => ok(),
      getCurrentTime: () => 61000,
      seekTo: (ms, ok) => {
        calls.push(`seek ${ms}`);
        ok();
      },
      play: () => calls.push('play'),
      getState: () => 'PLAYING',
      setSilentSubtitle: (v) => calls.push(`silent ${v}`),
      setSelectTrack: (type, i) => calls.push(`select ${type} ${i}`),
      stop: () => calls.push('stop'),
      close: () => calls.push('close'),
    },
  };
  const lines = [];
  const prepared = jest.fn();
  const engine = createAvPlayEngine();
  engine.start('http://x/movie.mkv', { bufferSeconds: 5, handlers: { onPrepared: prepared, onBuffering() {}, onSubtitle: (text, ms) => lines.push([text, ms]) } });
  expect(prepared).toHaveBeenCalledTimes(1);
  expect(calls).not.toContain('silent true'); // silent mode is never turned on
  listener.onsubtitlechange('1000', 'auto-selected', 'text');
  expect(lines).toEqual([]); // no lines drawn before a track is chosen
  calls.length = 0;
  engine.setSubtitleTrack(3);
  expect(calls).toEqual(['silent false', 'select TEXT 3']);
  expect(prepared).toHaveBeenCalledTimes(1); // the page is not told the video started again
  listener.onsubtitlechange('2500', 'Ciao<br>mondo', 'text');
  expect(lines).toEqual([['Ciao<br>mondo', 2500]]);
  calls.length = 0;
  engine.setSubtitleTrack(null);
  expect(calls).toEqual([]);
  listener.onsubtitlechange('1000', 'hidden', 'text');
  expect(lines).toHaveLength(1);
  engine.stop();
});

test('audio selection reports AVPlay success and failure to the caller', () => {
  const setSelectTrack = jest.fn();
  global.webapis = { avplay: { open() {}, prepareAsync() {}, setDisplayRect() {}, setSelectTrack } };
  const engine = createAvPlayEngine();
  expect(engine.setAudioTrack(3)).toBe(true);
  expect(setSelectTrack).toHaveBeenCalledWith('AUDIO', 3);
  setSelectTrack.mockImplementation(() => { throw new Error('InvalidStateError'); });
  expect(engine.setAudioTrack(3)).toBe(false);
});

test('preview rectangle survives stream changes and expands without reopening AVPlay', () => {
  const api = { open: jest.fn(), setDisplayRect: jest.fn(), prepareAsync: jest.fn(), setListener: jest.fn(), setBufferingParam: jest.fn(), stop: jest.fn(), close: jest.fn() };
  global.webapis = { avplay: api };
  const engine = createAvPlayEngine();
  const small = { x: 1210, y: 225, width: 650, height: 366 };
  engine.setDisplayRect(small);
  engine.start('https://example.test/1.ts', { bufferSeconds: 5, handlers: {} });
  expect(api.setDisplayRect).toHaveBeenLastCalledWith(1210, 225, 650, 366);
  engine.setDisplayRect({ x: 0, y: 0, width: 1920, height: 1080 });
  expect(api.open).toHaveBeenCalledTimes(1);
  expect(api.setDisplayRect).toHaveBeenLastCalledWith(0, 0, 1920, 1080);
  engine.setDisplayRect(small);
  engine.start('https://example.test/2.ts', { bufferSeconds: 5, handlers: {} });
  expect(api.setDisplayRect).toHaveBeenLastCalledWith(1210, 225, 650, 366);
  engine.stop();
});
