import 'fake-indexeddb/auto';
import { openAppDb } from '../../src/db/appDb.js';
import { kvSet } from '../../src/db/kv.js';
import { importGuideExchange } from '../../src/services/guideExchange.js';
import { sendGuideStudio, receiveGuideStudio, studioSession, STUDIO_URL, studioOrigin } from '../../src/services/guideStudio.js';
jest.mock('../../src/services/guideExchange.js', () => ({ EXCHANGE_LIMIT: 2097152, importGuideExchange: jest.fn() }));
const id = 'c'.repeat(64);
const reply = (text, etag = '"v1"', status = 200) => ({ ok: status < 400, status, headers: { get: () => etag }, text: async () => text });
let ctx;
beforeEach(async () => {
  jest.clearAllMocks();
  ctx = { db: await openAppDb(`studio-${Math.random()}`), active: { get: async () => ({ provider: { id: 'local-only' } }) }, catalogChanged: jest.fn() };
  await kvSet(ctx.db, STUDIO_URL, 'https://studio.example');
  global.fetch = jest.fn().mockResolvedValue(reply(JSON.stringify({ id })));
  importGuideExchange.mockResolvedValue(2);
});
afterEach(() => { ctx.db.close(); delete global.fetch; });
test('applies before deleting and sends no provider data', async () => {
  const url = await sendGuideStudio(ctx, '<channel-layout/>');
  expect(url).toBe(`https://studio.example/client/${id}`);
  expect(JSON.stringify(fetch.mock.calls)).not.toContain('local-only');
  fetch.mockResolvedValueOnce(reply('<layout/>')).mockImplementationOnce(async () => {
    expect(importGuideExchange).toHaveBeenCalledWith(ctx, '<layout/>'); return reply('');
  });
  await receiveGuideStudio(ctx);
  expect(fetch.mock.calls[2][1]).toMatchObject({ method: 'DELETE', headers: { 'If-Match': '"v1"' } });
  expect(await studioSession(ctx)).toBeNull();
});
test('failed import never deletes; failed deletion keeps the link for retry', async () => {
  await sendGuideStudio(ctx, '<layout/>'); fetch.mockResolvedValue(reply('<layout/>'));
  importGuideExchange.mockRejectedValueOnce(new Error('local disk failure'));
  await expect(receiveGuideStudio(ctx)).rejects.toThrow('local disk failure');
  expect(fetch).toHaveBeenCalledTimes(2); expect(await studioSession(ctx)).not.toBeNull();
  fetch.mockResolvedValueOnce(reply('<layout/>')).mockResolvedValueOnce(reply('', '', 503));
  await expect(receiveGuideStudio(ctx)).rejects.toThrow('503');
  expect(await studioSession(ctx)).not.toBeNull();
});
test('rejects URL credentials and foreign origins on return', async () => {
  expect(() => studioOrigin('https://user:password@studio.example')).toThrow();
  await sendGuideStudio(ctx, '<layout/>');
  await kvSet(ctx.db, STUDIO_URL, 'https://different.example');
  await expect(receiveGuideStudio(ctx)).rejects.toThrow('No matching exchange');
  expect(fetch).toHaveBeenCalledTimes(1);
});
