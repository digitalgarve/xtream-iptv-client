import { bucket, key, readXml, errorResponse, headers } from '@/lib/store';
import { parseLayout } from '@/lib/layout-xml';
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    const object = await bucket().get(key((await context.params).id));
    if (!object)
      return new Response('Datei wurde gelöscht oder existiert nicht.', { status: 404, headers });
    return new Response(object.body, {
      headers: {
        ...headers,
        'Content-Type': 'application/xml; charset=utf-8',
        ETag: object.httpEtag,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function PUT(request: Request, context: Context) {
  try {
    const path = key((await context.params).id);
    const match = request.headers.get('if-match');
    if (!match) return new Response('Version fehlt.', { status: 428, headers });
    const xml = await readXml(request);
    const old = await bucket().get(path);
    if (!old) return new Response(null, { status: 404, headers });
    const before = parseLayout(await old.text());
    const after = parseLayout(xml);
    const refs = new Set(before.map((row) => row.ref));
    if (before.length !== after.length || after.some((row) => !refs.has(row.ref)))
      throw new Error('Sender dürfen nicht hinzugefügt oder entfernt werden. Nutze Ausblenden.');
    const saved = await bucket().put(path, xml, {
      onlyIf: request.headers,
      httpMetadata: { contentType: 'application/xml; charset=utf-8' },
    });
    if (!saved)
      return new Response('Inzwischen geändert. Bitte neu laden.', { status: 412, headers });
    return Response.json({ etag: saved.httpEtag }, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function DELETE(request: Request, context: Context) {
  try {
    const path = key((await context.params).id);
    if (request.headers.has('if-match')) {
      // Claim the downloaded version before deleting; a concurrent edit must not be lost.
      const claimed = await bucket().put(path, '', { onlyIf: request.headers });
      if (!claimed)
        return new Response('Inzwischen geändert. Erneut übernehmen.', { status: 412, headers });
    }
    await bucket().delete(path);
    return new Response(null, { status: 204, headers });
  } catch (error) {
    return errorResponse(error);
  }
}

export { OPTIONS } from '@/lib/store';

export async function HEAD(_request: Request, context: Context) {
  try {
    const object = await bucket().head(key((await context.params).id));
    return new Response(null, { status: object ? 200 : 404, headers });
  } catch (error) { return errorResponse(error); }
}
