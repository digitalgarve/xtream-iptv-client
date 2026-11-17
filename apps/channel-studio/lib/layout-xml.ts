import { SaxesParser } from 'saxes';
export type Channel = { ref: string; name: string; visible: boolean; categories?: string[] };
export const MAX_BYTES = 10 * 1024 * 1024;
export function parseLayout(xml: string): Channel[] {
  if (new TextEncoder().encode(xml).length > MAX_BYTES)
    throw new Error('Die Datei ist zu groß (maximal 10 MB).');
  const rows: Channel[] = [];
  const stack: string[] = [];
  const refs = new Set<string>();
  let name = '';
  let current: Channel | null = null;
  const fail = () => {
    throw new Error('Keine gültige Channel-Studio-Datei. Bitte aus dem IPTV-Client exportieren.');
  };
  const parser = new SaxesParser();
  parser.on('error', fail);
  parser.on('doctype', fail);
  parser.on('comment', fail);
  parser.on('processinginstruction', fail);
  parser.on('opentag', (tag) => {
    const attrs = tag.attributes as Record<string, string>;
    if (!stack.length) {
      if (tag.name !== 'channel-layout' || attrs.version !== '1' || Object.keys(attrs).length !== 1)
        fail();
    } else if (stack.length === 1) {
      if (
        tag.name !== 'channel' ||
        !/^[a-f0-9]{32}$/.test(attrs.ref) ||
        refs.has(attrs.ref) ||
        !['true', 'false'].includes(attrs.visible) ||
        Object.keys(attrs).length !== 2
      )
        fail();
      refs.add(attrs.ref);
      current = { ref: attrs.ref, name: '', visible: attrs.visible === 'true', categories: [] };
    } else if (
      stack.length === 2 &&
      ['name', 'category'].includes(tag.name) &&
      !Object.keys(attrs).length &&
      current &&
      (tag.name !== 'name' || !current.name)
    ) {
      name = '';
    } else fail();
    stack.push(tag.name);
  });
  const text = (value: string) => {
    if (stack.length === 3) name += value;
    else if (value.trim()) fail();
  };
  parser.on('text', text);
  parser.on('cdata', text);
  parser.on('closetag', () => {
    const tag = stack.pop();
    if ((tag === 'name' || tag === 'category') && current) {
      if (!name.trim() || name.length > 300 || /(?:[a-z][a-z0-9+.-]*:\/\/|www\.|\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b)/i.test(name))
        fail();
      if (tag === 'name') current.name = name;
      else { if (current.categories!.includes(name) || current.categories!.length >= 100) fail(); current.categories!.push(name); }
    }
    if (tag === 'channel' && current) {
      if (!current.name) fail();
      rows.push(current);
      current = null;
    }
  });
  parser.write(xml).close();
  if (!rows.length || rows.length > 20000) fail();
  return rows;
}
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
  );
export function serializeLayout(rows: Channel[]) {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n<channel-layout version="1">\n' +
    rows
      .map(
        (r) =>
          `  <channel ref="${r.ref}" visible="${r.visible}"><name>${escape(r.name)}</name>${(r.categories || []).map(name => `<category>${escape(name)}</category>`).join('')}</channel>`,
      )
      .join('\n') +
    '\n</channel-layout>\n'
  );
}
