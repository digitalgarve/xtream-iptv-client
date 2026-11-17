import { env } from 'cloudflare:workers';
import { MAX_BYTES, parseLayout } from './layout-xml';
export const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, If-Match, OAI-Sites-Authorization',
  'Access-Control-Expose-Headers': 'ETag',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};
export function bucket() {
  if (!env.BUCKET) throw new Error('Speicher nicht verfügbar');
  return env.BUCKET;
}
export function key(id: string) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Ungültiger Link');
  return `layouts/${id}`;
}
export async function readXml(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/xml'))
    throw new Error('XML-Datei erwartet');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Datei fehlt');
  let size = 0;
  let xml = '';
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) throw new Error('Maximal 10 MB');
      xml += decoder.decode(value, { stream: true });
    }
    xml += decoder.decode();
  } finally {
    await reader.cancel();
  }
  parseLayout(xml);
  return xml;
}
export function errorResponse(error: unknown) {
  return Response.json(
    { error: error instanceof Error ? error.message : 'Anfrage fehlgeschlagen' },
    { status: 400, headers },
  );
}
export function OPTIONS() {
  return new Response(null, { status: 204, headers });
}
