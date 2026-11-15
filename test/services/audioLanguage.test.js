import { audioLabel, isLanguage, preferredAudioTrack } from '../../src/services/playerController.js';

test('a track language matches the app language in any spelling', () => {
  ['it', 'IT', 'ita', 'it-IT', 'Italian', 'italiano'].forEach((code) => expect(isLanguage(code, 'it-IT')).toBe(true));
  ['eng', 'en', '', 'und', 'iti'].forEach((code) => expect(isLanguage(code, 'it-IT')).toBe(false));
  expect(isLanguage('ger', 'de-DE')).toBe(true);
  expect(isLanguage('en-US', 'en-GB')).toBe(true);
});

test('the track in the language of the app: switched to only when another one plays', () => {
  const tracks = [{ index: 3, language: 'eng', current: true }, { index: 5, language: 'ita', current: false }];
  expect(preferredAudioTrack(tracks, 'it-IT')).toBe(5);
  expect(preferredAudioTrack(tracks, 'en-US')).toBeNull(); // already in English
  expect(preferredAudioTrack(tracks, 'de-DE')).toBeNull(); // none in German: the file's default
  expect(preferredAudioTrack([{ index: 0, language: 'ita', current: true }], 'en-US')).toBeNull(); // one track only
  expect(preferredAudioTrack([{ index: 0, language: 'und' }, { index: 1, language: 'it' }], 'it-IT')).toBe(1); // none marked current
});

test.each([
  [{ label: 'German AC3' }, 'Deutsch'],
  [{ language: 'und', label: '[DEU] 5.1' }, 'Deutsch'],
  [{ label: 'Deutsch' }, 'Deutsch'],
  [{ label: 'English / Deutsch' }, 'English / Deutsch'],
  [{ label: 'Commentary' }, 'Commentary'],
  [{ label: 'Made in Italy' }, 'Made in Italy'],
  [{ label: 'Audio de director' }, 'Audio de director'],
  [{ language: 'eng', label: 'German AC3' }, 'English'],
  [{ language: 'und', label: '  ' }, 'Track 2'],
  [{ language: 'ger' }, 'Deutsch'],
])('audio menu uses names without overriding explicit language: %j', (track, expected) => {
  expect(audioLabel(track, 2, 'Track {n}')).toBe(expected);
});

test('names alone do not trigger an automatic audio switch', () => {
  expect(preferredAudioTrack([{ index: 0, current: true }, { index: 1, label: 'Deutsch' }], 'de-DE')).toBeNull();
});
