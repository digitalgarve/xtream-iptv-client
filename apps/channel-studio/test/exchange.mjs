import assert from 'node:assert/strict';
const base = process.env.STUDIO_TEST_URL || 'http://127.0.0.1:5173';
const refs = ['a'.repeat(32), 'b'.repeat(32)];
const xml = '<?xml version="1.0"?><channel-layout version="1">' + refs.map((ref, i) => `<channel ref="${ref}" visible="true"><name>Testsender ${i + 1}</name><category>Nachrichten</category></channel>`).join('') + '</channel-layout>';
const paths = [];
const send = (path, method, body, extra = {}) => fetch(base + path, { method, headers: { 'Content-Type': 'application/xml', ...extra }, body });
try {
  assert.equal((await fetch(base)).status, 200);
  for (const bad of ['<tv/>', xml.replace('version="1"', 'version="1" password="secret"'), xml.replace('Testsender 1', 'https://private.example'), xml.replace('Nachrichten', 'https://private.example'), '<!DOCTYPE channel-layout [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + xml, xml.replace(refs[1], refs[0]), xml.replace('Testsender 1', 'private.example'), xml.replace('<channel-layout', '<!-- secret --><channel-layout')]) {
    const response = await send('/api/clients', 'POST', bad); assert.equal(response.status, 400, await response.text());
  }
  const create = await send('/api/clients', 'POST', xml); assert.equal(create.status, 201, await create.clone().text());
  const created = await create.json(); paths.push(created.xmlPath);
  const read = await fetch(base + created.xmlPath); assert.equal(await read.text(), xml); assert.equal(read.headers.get('cache-control'), 'no-store');
  const etag = read.headers.get('etag'); assert.ok(etag);
  const edited = xml.replace('visible="true"', 'visible="false"');
  const update = await send(created.xmlPath, 'PUT', edited, { 'If-Match': etag }); assert.equal(update.status, 200, await update.clone().text());
  const nextEtag = (await update.json()).etag;
  assert.equal((await send(created.xmlPath, 'PUT', xml, { 'If-Match': etag })).status, 412);
  assert.equal((await send(created.xmlPath, 'DELETE', undefined, { 'If-Match': etag })).status, 412);
  assert.equal(await (await fetch(base + created.xmlPath)).text(), edited);
  assert.equal((await send(created.xmlPath, 'PUT', edited.replace(refs[0], 'c'.repeat(32)), { 'If-Match': nextEtag })).status, 400);
  assert.equal((await send(created.xmlPath, 'DELETE', undefined, { 'If-Match': nextEtag })).status, 204);
  assert.equal((await fetch(base + created.xmlPath)).status, 404);
  assert.equal((await fetch(base + created.xmlPath, { method: 'HEAD' })).status, 404);
  assert.equal((await send(created.xmlPath, 'PUT', xml, { 'If-Match': nextEtag })).status, 404);
  console.log('PASS: upload, XML validation, roundtrip, version conflict, deletion and no resurrection');
} finally { for (const path of paths) await send(path, 'DELETE'); }
