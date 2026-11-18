import { kvGet, kvSet } from '../db/kv.js';
import { EXCHANGE_LIMIT, importGuideExchange } from './guideExchange.js';

const SESSION = 'guide:studio:session';
export const STUDIO_URL = 'guide:studio:url';
export function studioOrigin(value) {
  const url = new URL(value);
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('Invalid Studio address');
  return url.origin;
}
async function request(ctx, path, options = {}) {
  const origin = studioOrigin(await kvGet(ctx.db, STUDIO_URL, 'http://localhost:5173'));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(origin + path, {
      ...options,
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        ...options.headers,
      },
    });
    if (!response.ok) throw new Error(`Channel Studio: HTTP ${response.status}`);
    const reader = response.body && response.body.getReader ? response.body.getReader() : null;
    if (!reader) {
      const text = await response.text();
      if (text.length > EXCHANGE_LIMIT) throw new Error('Response too large');
      return { text, etag: response.headers.get('etag') };
    }
    const decoder = new TextDecoder();
    let size = 0;
    let text = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > EXCHANGE_LIMIT) throw new Error('Response too large');
        text += decoder.decode(value, { stream: true });
      }
      return { text: text + decoder.decode(), etag: response.headers.get('etag') };
    } finally {
      await reader.cancel();
    }
  } finally {
    clearTimeout(timer);
  }
}
export async function sendGuideStudio(ctx, xml) {
  if (await kvGet(ctx.pdb, SESSION, null)) throw new Error('An exchange is already open');
  const current = await ctx.active.get();
  if (!current) throw new Error('No active provider');
  const result = JSON.parse(
    (
      await request(ctx, '/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/xml' },
        body: xml,
      })
    ).text,
  );
  if (!/^[a-f0-9]{64}$/.test(result.id)) throw new Error('Invalid Studio response');
  const origin = studioOrigin(await kvGet(ctx.db, STUDIO_URL, 'http://localhost:5173'));
  await kvSet(ctx.pdb, SESSION, { id: result.id, providerId: current.provider.id, origin });
  return `${origin}/client/${result.id}`;
}
export async function studioSession(ctx) {
  return kvGet(ctx.pdb, SESSION, null);
}
export async function receiveGuideStudio(ctx) {
  const session = await studioSession(ctx);
  const current = await ctx.active.get();
  const origin = studioOrigin(await kvGet(ctx.db, STUDIO_URL, 'http://localhost:5173'));
  if (
    !session ||
    !current ||
    session.providerId !== current.provider.id ||
    session.origin !== origin
  )
    throw new Error('No matching exchange');
  const response = await request(ctx, `/api/clients/${session.id}`);
  if (!response.etag) throw new Error('Missing version');
  await importGuideExchange(ctx, response.text);
  ctx.catalogChanged();
  // Delete only after the local layout write succeeded. A failed delete retains the session for retry.
  try {
    await request(ctx, `/api/clients/${session.id}`, { method: 'DELETE', headers: { 'If-Match': response.etag } });
  } catch (error) {
    error.studioDeletePending = true;
    throw error;
  }
  await kvSet(ctx.pdb, SESSION, null);
}
export async function discardGuideStudio(ctx) {
  const session = await studioSession(ctx);
  if (!session) return;
  const origin = studioOrigin(await kvGet(ctx.db, STUDIO_URL, 'http://localhost:5173'));
  if (session.origin !== origin) throw new Error('Studio address changed');
  await request(ctx, `/api/clients/${session.id}`, { method: 'DELETE' });
  await kvSet(ctx.pdb, SESSION, null);
}
