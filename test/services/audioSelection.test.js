import { resolveAudioSelection } from '../../src/services/audioSelection.js';
import { createAvPlayEngine } from '../../platforms/tizen/avplayEngine.js';
import { createHtml5Engine } from '../../src/services/playerEngines.js';
import { createExoEngine } from '../../platforms/android/exoEngine.js';

const selection = { language: 'de', tracks: [{ id: '2', language: 'eng' }, { id: '5', language: 'und', label: 'German AC3' }] };

afterEach(() => { delete global.webapis; jest.restoreAllMocks(); });

test('Samsung: name-derived choice maps to the native audio index, not the container number', () => {
  let active = 4;
  global.webapis = { avplay: {
    open() {}, setDisplayRect() {}, prepareAsync() {},
    getTotalTrackInfo: () => [
      { type: 'VIDEO', index: 0 },
      { type: 'AUDIO', index: 4, extra_info: '{"language":"eng"}' },
      { type: 'TEXT', index: 6 },
      { type: 'AUDIO', index: 9, extra_info: '{"language":"und"}' },
    ],
    getCurrentStreamInfo: () => [{ type: 'AUDIO', index: active }],
    setSelectTrack: jest.fn((type, index) => { active = index; }),
  } };
  const engine = createAvPlayEngine();
  const target = resolveAudioSelection(engine.getAudioTracks(), selection);
  expect(target.index).toBe(9);
  expect(engine.setAudioTrack(target.index)).toBe(true);
  expect(engine.getAudioTracks().find((track) => track.current).index).toBe(9);
});

test.each(['LG/webOS', 'Desktop'])('%s: HTML audio tracks preserve IDs and confirm the selected track', () => {
  jest.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  const engine = createHtml5Engine({ demux: false });
  engine.start('movie.mp4', { handlers: {} });
  const video = document.querySelector('video');
  // Native order differs: the container ID identifies the requested track.
  const tracks = [{ id: '5', language: 'und', enabled: false }, { id: '2', language: 'eng', enabled: true }];
  Object.defineProperty(video, 'audioTracks', { value: tracks });
  const target = resolveAudioSelection(engine.getAudioTracks(), selection);
  expect(target.index).toBe(0);
  expect(engine.setAudioTrack(target.index)).toBe(true);
  expect(tracks.map((track) => track.enabled)).toEqual([true, false]);
  expect(engine.setAudioTrack(8)).toBe(false);
  engine.stop();
});

test.each(['Android TV', 'Fire TV'])('%s: resolve through the actual JS bridge and send its native index', async () => {
  let emit;
  const cap = {
    addListener: (plugin, event, callback) => { emit = callback; return { remove() {} }; },
    nativePromise: jest.fn().mockResolvedValue({}),
  };
  const engine = createExoEngine({ Capacitor: cap });
  engine.start('movie.mkv', { handlers: {} });
  emit({ type: 'tracks', audio: [{ index: 8, id: '5', language: 'und' }, { index: 3, id: '2', language: 'eng', current: true }] });
  const target = resolveAudioSelection(engine.getAudioTracks(), selection);
  expect(target.index).toBe(8);
  await engine.setAudioTrack(target.index);
  expect(cap.nativePromise).toHaveBeenLastCalledWith('ExoPlayer', 'selectAudio', { index: 8 });
  cap.nativePromise.mockRejectedValueOnce(new Error('selection rejected'));
  expect(await engine.setAudioTrack(8)).toBe(false);
  engine.stop();
});

test('incomplete or inconsistent native lists must not use positional fallback', () => {
  expect(resolveAudioSelection([{ index: 9, language: '' }], selection)).toBeNull();
  expect(resolveAudioSelection([{ index: 4, language: 'fra' }, { index: 9, language: '' }], selection)).toBeNull();
  expect(resolveAudioSelection([{ index: 4, language: '' }, { index: 9, language: 'fra' }], selection)).toBeNull();
});

test('complete unnamed lists use audio order, including a first track with index zero', () => {
  const tracks = [{ index: 0 }, { index: 7 }];
  expect(resolveAudioSelection(tracks, selection).index).toBe(7);
  expect(resolveAudioSelection(tracks, { ...selection, language: 'en' }).index).toBe(0);
});
