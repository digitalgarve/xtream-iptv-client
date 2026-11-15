import { createDetailAudio } from '../../src/ui/pages/detail/audio.js';
import { readAudioTracks } from '../../src/services/audioTracks.js';

jest.mock('../../src/services/audioTracks.js', () => ({ readAudioTracks: jest.fn() }));
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
const movie = { id: 1, ext: 'mkv' };
const context = () => ({ active: { get: async () => ({ client: { streamUrl: (type, id) => `${type}/${id}` } }) }, dialogs: { choose: jest.fn().mockResolvedValue('de') } });

beforeEach(() => jest.clearAllMocks());

test('loads available languages before playback, deduplicates and returns the selection only for this version', async () => {
  readAudioTracks.mockResolvedValue([{ language: 'ger' }, { label: 'German AC3' }, { language: 'eng' }]);
  const ctx = context();
  const audio = createDetailAudio(ctx);
  audio.update('movie', movie);
  await flush();
  expect(audio.el.textContent).toContain('Deutsch · English');
  expect(audio.el.textContent).not.toContain('AC3');
  await audio.zone.onActivate();
  expect(ctx.dialogs.choose.mock.calls[0][0].options.map((o) => o.value)).toEqual(['', 'de', 'en']);
  expect(audio.selectionFor('movie', movie)).toBe('de');
  expect(audio.trackSelectionFor('movie', movie)).toEqual({ language: 'de', streamId: 1, ext: 'mkv', tracks: [{ language: 'ger' }, { label: 'German AC3' }, { language: 'eng' }] });
  expect(audio.trackSelectionFor('movie', { id: 2 })).toBeNull();
  expect(audio.selectionFor('movie', { id: 2 })).toBe('');
  audio.update('movie', movie);
  expect(readAudioTracks).toHaveBeenCalledTimes(1);
  audio.stop();
});

test('version changes cancel previous reads and discard their results', async () => {
  let finish;
  readAudioTracks.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValueOnce([{ language: 'eng' }]);
  const audio = createDetailAudio(context());
  audio.update('movie', movie);
  await flush();
  audio.update('movie', { id: 2 });
  await flush();
  finish([{ language: 'de' }]);
  await flush();
  expect(audio.el.textContent).toContain('English');
  expect(audio.el.textContent).not.toContain('Deutsch');
  audio.stop();
});

test('unreadable files show unknown, and episodes are explicitly identified', async () => {
  readAudioTracks.mockRejectedValue(new Error('no ranges'));
  const ctx = context();
  const audio = createDetailAudio(ctx);
  audio.update('series', { id: 3, season: 2, number: 5 });
  await audio.zone.onActivate();
  expect(audio.el.textContent).toContain('Language unknown (S2E5)');
  expect(ctx.dialogs.choose).not.toHaveBeenCalled();
  audio.stop();
});
