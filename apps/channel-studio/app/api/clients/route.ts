import { bucket, readXml, errorResponse, headers } from '@/lib/store';
export async function POST(request: Request) {
  try {
    const xml = await readXml(request);
    const id = Array.from(crypto.getRandomValues(new Uint8Array(32)), (n) =>
      n.toString(16).padStart(2, '0'),
    ).join('');
    const stored = await bucket().put(`layouts/${id}`, xml, {
      httpMetadata: { contentType: 'application/xml; charset=utf-8' },
    });
    return Response.json(
      { id, editPath: `/client/${id}`, xmlPath: `/api/clients/${id}`, etag: stored.httpEtag },
      { status: 201, headers },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export { OPTIONS } from '@/lib/store';
