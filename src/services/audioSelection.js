import { audioLanguage, isLanguage } from './playerController.js';

/** Resolve a preview against native audio tracks, returning the native index (never a container track number). */
export function resolveAudioSelection(tracks, selection) {
  if (!selection || !selection.language || !tracks.length) return null;
  const matches = (track) => isLanguage(audioLanguage(track), selection.language);
  const named = tracks.find((track) => track.current && matches(track)) || tracks.find(matches);
  if (named) return named;
  const source = selection.tracks || [];
  const candidates = source.filter(matches);
  for (const candidate of candidates) {
    const identified = tracks.filter((track) => candidate.id && track.containerId === candidate.id);
    if (identified.length === 1 && !audioLanguage(identified[0])) return identified[0];
  }
  // Native audio lists follow stream order. Only align complete lists whose known languages agree.
  if (!source.length || source.length !== tracks.length) return null;
  if (tracks.some((track, i) => {
    if (track.containerId && source[i].id && track.containerId !== source[i].id) return true;
    const language = audioLanguage(track);
    const expected = audioLanguage(source[i]);
    return language && expected && !isLanguage(language, expected);
  })) return null;
  const position = source.findIndex(matches);
  if (position < 0 || audioLanguage(tracks[position])) return null;
  return tracks[position];
}
