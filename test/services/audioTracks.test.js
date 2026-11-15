import fs from 'fs';
import path from 'path';
import { TextDecoder as NodeTextDecoder } from 'util';
import { readAudioTracks } from '../../src/services/audioTracks.js';

if (typeof global.TextDecoder === 'undefined') global.TextDecoder = NodeTextDecoder;

test.each(['mkv', 'mp4'])('reads all audio language headers in %s without decoding samples or requiring audio codecs', async (ext) => {
  // Reclassify the two fixture subtitle tracks as audio: metadata reading must ignore sample format and cues.
  const source = fs.readFileSync(path.join(__dirname, `../fixtures/subs.${ext}`));
  const from = ext === 'mkv' ? Buffer.from([0x83, 0x81, 0x11]) : Buffer.from('sbtl');
  const to = ext === 'mkv' ? Buffer.from([0x83, 0x81, 2]) : Buffer.from('soun');
  const file = Buffer.from(source);
  for (let at = file.indexOf(from); at >= 0; at = file.indexOf(from, at + to.length)) to.copy(file, at);
  const doFetch = jest.fn(async (url, init) => {
    const [start, end] = /bytes=(\d+)-(\d+)/.exec(init.headers.Range).slice(1).map(Number);
    const bytes = file.subarray(start, end + 1);
    return { status: 206, headers: { get: () => `bytes ${start}-${start + bytes.length - 1}/${file.length}` }, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) };
  });
  const tracks = await readAudioTracks(`movie.${ext}`, doFetch);
  expect(tracks.map((track) => track.language)).toEqual(ext === 'mkv' ? ['it', 'en'] : ['ita', 'eng']);
  expect(tracks.every((track) => !track.cues && !track.readEntry)).toBe(true);
});

test('a server that ignores Range is cancelled, not downloaded as a full movie', async () => {
  const cancel = jest.fn().mockResolvedValue();
  await expect(readAudioTracks('movie', async () => ({ status: 200, body: { cancel } }))).rejects.toThrow('no ranges');
  expect(cancel).toHaveBeenCalled();
});
