'use client';
import Link from 'next/link';
import { use, useEffect, useState, useMemo } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Eye,
  EyeOff,
  GripVertical,
  Save,
  Search,
  Trash2,
  Download,
  Copy,
} from 'lucide-react';
import { parseLayout, serializeLayout, type Channel } from '@/lib/layout-xml';
export default function Editor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const endpoint = `/api/clients/${id}`;
  const [rows, setRows] = useState<Channel[]>([]);
  const [etag, setEtag] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(0);
  const [message, setMessage] = useState('Lade Senderliste …');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    let active = true;
    fetch(endpoint)
      .then(async (response) => {
        if (!response.ok) throw new Error('Datei wurde gelöscht oder der Link ist ungültig.');
        const xml = await response.text();
        if (active) {
          setRows(parseLayout(xml));
          setEtag(response.headers.get('etag') || '');
          setMessage('Bereit zum Sortieren');
        }
      })
      .catch((error) => {
        if (active) setMessage(error.message);
      });
    return () => {
      active = false;
    };
  }, [endpoint]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => {
    if (gone) return;
    let active = true;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(endpoint, { method: 'HEAD', cache: 'no-store' });
        if (active && response.status === 404) {
          setRows([]); setDirty(false); setGone(true);
          setMessage('Die Datei wurde übernommen oder verworfen und vom Server gelöscht.');
        }
      } catch { /* An offline device does not mean the file was deleted. */ }
    }, 10000);
    return () => { active = false; window.clearInterval(timer); };
  }, [endpoint, gone]);
  function move(ref: string, to: number) {
    setRows((previous) => {
      const from = previous.findIndex((r) => r.ref === ref);
      if (from < 0 || !Number.isInteger(to) || to < 0 || to >= previous.length || from === to)
        return previous;
      const next = [...previous];
      next.splice(to, 0, next.splice(from, 1)[0]);
      setDirty(true);
      return next;
    });
  }
  async function save() {
    setBusy(true);
    try {
      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/xml', 'If-Match': etag },
        body: serializeLayout(rows),
      });
      if (!response.ok)
        throw new Error(
          response.status === 412
            ? 'Eine andere Sitzung hat gespeichert. Lade die Seite neu, bevor du weiterarbeitest.'
            : 'Speichern fehlgeschlagen. Deine Änderungen bleiben hier erhalten.',
        );
      const result = (await response.json()) as { etag: string };
      setEtag(result.etag);
      setDirty(false);
      setMessage('Gespeichert. Jetzt im IPTV-Client übernehmen.');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (
      !window.confirm(
        'Senderliste endgültig vom Server löschen? Noch nicht übernommene Änderungen gehen verloren.',
      )
    )
      return;
    setBusy(true);
    try {
      const response = await fetch(endpoint, { method: 'DELETE' });
      if (!response.ok) throw new Error('Löschen fehlgeschlagen. Bitte erneut versuchen.');
      setRows([]);
      setGone(true);
      setDirty(false);
      setMessage('Die Senderliste wurde vom Server gelöscht.');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(new URL(endpoint, location.origin).href);
      setMessage('Abruflink kopiert. Behandle ihn wie einen privaten Schlüssel.');
    } catch {
      setMessage('Kopieren nicht möglich. Nutze den Abruflink unten.');
    }
  }
  const categories = useMemo(() => Array.from(new Set(rows.flatMap(row => row.categories || []))).sort((a, b) => a.localeCompare(b)), [rows]);
  const positions = useMemo(() => new Map(rows.map((row, index) => [row.ref, index])), [rows]);
  const filtered = rows.filter(row => (!category || (row.categories || []).includes(category)) && row.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const lastPage = Math.max(0, Math.ceil(filtered.length / 100) - 1);
  const currentPage = Math.min(page, lastPage);
  const shown = filtered.slice(currentPage * 100, (currentPage + 1) * 100);
  return (
    <main className="shell editor">
      <header>
        <Link className="brand" href="/">
          <span className="mark">≋</span> Channel Studio
        </Link>
        <span className="pill">Temporärer Arbeitsbereich</span>
      </header>
      <section className="editor-heading">
        <div>
          <p className="eyebrow">DEINE PERSÖNLICHE REIHENFOLGE</p>
          <h1>
            Mach’s dir <em>übersichtlich.</em>
          </h1>
          <p>Sortieren, speichern, auf dem TV übernehmen. Fertig.</p>
        </div>
        <button className="primary" disabled={!dirty || busy || gone} onClick={save}>
          <Save size={18} />
          Änderungen speichern
        </button>
      </section>
      <div className="workspace">
        <section className="panel">
          <div className="toolbar">
            <label className="search">
              <Search size={18} />
              <input
                placeholder="Sender suchen …"
                aria-label="Sender suchen"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setPage(0); }}
              />
            </label>
            <span>
              {rows.filter((r) => r.visible).length} von {rows.length} sichtbar
            </span>
          </div>
          <div className="category-toolbar">
            <label>Kategorie <select aria-label="Kategorie" value={category} onChange={e => { setCategory(e.target.value); setPage(0); }}><option value="">Alle Kategorien ({categories.length})</option>{categories.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
            <span>{filtered.length} Sender · Positionen beziehen sich auf die gesamte Liste</span>
          </div>
          <div className="table-head">
            <span>POSITION</span>
            <span>SENDER</span>
            <span>ANORDNEN</span>
          </div>
          <div className="channels">
            {shown.map((row) => {
              const index = positions.get(row.ref)!;
              return (
                <div
                  className={`channel ${row.visible ? '' : 'hidden-channel'}`}
                  key={row.ref}
                  draggable={!query && !busy}
                  onDragStart={(e) => e.dataTransfer.setData('text/plain', row.ref)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (!query && !busy) move(e.dataTransfer.getData('text/plain'), index);
                  }}
                >
                  <label className="position">
                    <GripVertical size={16} />
                    <input
                      aria-label={`Position für ${row.name}`}
                      type="number"
                      min="1"
                      max={rows.length}
                      key={`${row.ref}-${index}`}
                      defaultValue={index + 1}
                      disabled={busy}
                      onBlur={(e) => {
                        move(row.ref, Number(e.target.value) - 1);
                        e.target.value = String(index + 1);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                      }}
                    />
                  </label>
                  <div className="channel-name">
                    <span className="avatar">{row.name.slice(0, 2).toUpperCase()}</span>
                    <div><strong>{row.name}</strong><small className="channel-category">{(row.categories || []).join(' · ')}</small></div>
                  </div>
                  <div className="actions">
                    <button
                      aria-label={`${row.name} nach oben`}
                      disabled={index === 0 || busy}
                      onClick={() => move(row.ref, index - 1)}
                    >
                      <ArrowUp size={17} />
                    </button>
                    <button
                      aria-label={`${row.name} nach unten`}
                      disabled={index === rows.length - 1 || busy}
                      onClick={() => move(row.ref, index + 1)}
                    >
                      <ArrowDown size={17} />
                    </button>
                    <button
                      aria-label={`${row.name} ${row.visible ? 'ausblenden' : 'einblenden'}`}
                      disabled={busy}
                      onClick={() => {
                        setRows(
                          rows.map((r) => (r.ref === row.ref ? { ...r, visible: !r.visible } : r)),
                        );
                        setDirty(true);
                      }}
                    >
                      {row.visible ? <Eye size={18} /> : <EyeOff size={18} />}
                    </button>
                  </div>
                </div>
              );
            })}
            {!filtered.length && (
              <p className="empty">
                {gone
                  ? 'Dieser Arbeitsbereich ist jetzt leer.'
                  : rows.length
                    ? 'Keine passenden Sender.'
                    : message}
              </p>
            )}
          </div>
          <nav className="pagination" aria-label="Senderseiten"><button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Zurück</button><span>Seite {currentPage + 1} von {lastPage + 1}</span><button disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>Weiter</button></nav>
        </section>
        <aside>
          <div className="side-card">
            <span className="step">01 — 02 — 03</span>
            <h2>
              Vom Browser
              <br />
              zurück zum TV.
            </h2>
            <p>Speichere deine Reihenfolge. Wähle dann im IPTV-Client „Sortierung übernehmen“.</p>
            <p>Erst nach erfolgreicher Übernahme wird die Serverkopie gelöscht.</p>
            <div className="status" role="status">
              <Check size={18} />
              {message}
              {dirty && <span> · Ungespeicherte Änderungen</span>}
            </div>
          </div>
          <div className="side-card">
            <h3>Dein privater Abruflink</h3>
            <p>Der Link erlaubt Zugriff auf diese Liste. Gib ihn nicht weiter.</p>
            <button disabled={gone || !rows.length} onClick={copy}>
              <Copy size={16} />
              Abruflink kopieren
            </button>
            {!gone && rows.length > 0 && (
              <a className="download" href={endpoint} download="channel-layout.xml">
                <Download size={16} />
                Gespeicherte XML herunterladen
              </a>
            )}
            <button className="danger" disabled={busy || gone || !rows.length} onClick={remove}>
              <Trash2 size={16} />
              Verwerfen und löschen
            </button>
          </div>
        </aside>
      </div>
      <footer>
        CHANNEL STUDIO<span>Keine URLs. Keine Zugangsdaten. Nur deine Sender.</span>
      </footer>
    </main>
  );
}
