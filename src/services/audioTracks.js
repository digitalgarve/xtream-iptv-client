import { createRangeReader, probeMkv } from './mkvSubtitles.js';
import { probeMp4 } from './mp4Subtitles.js';

/** Read container metadata only, never start a player or download the movie. Null means unreadable. */
// shortcut: MKV/MP4 with HTTP ranges only; add a manifest reader when HLS language previews are needed.
export async function readAudioTracks(url, doFetch = (...args) => fetch(...args)) {
  const reader = createRangeReader(url, doFetch);
  const read = reader.read.bind(reader);
  let remaining = 8 * 1024 * 1024;
  reader.read = (from, to) => {
    remaining -= to - from + 1;
    if (remaining < 0) throw new Error('Audio metadata exceeds read budget');
    return read(from, to);
  };
  let reason = '';
  let result = await probeMkv(reader, (value) => { reason = value; }, { audioOnly: true });
  if (!result && reason === 'not an MKV') result = await probeMp4(reader, undefined, { audioOnly: true });
  return result ? result.tracks : null;
}
