'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Upload, ArrowUpRight, ShieldCheck, ListOrdered, Trash2 } from 'lucide-react';
export default function Home() {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function upload(file?: File) {
    if (!file) return;
    setBusy(true);
    setMessage('Datei wird geprüft …');
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('Die Datei darf maximal 10 MB groß sein.');
      const response = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/xml' },
        body: await file.text(),
      });
      const result = (await response.json()) as { error?: string; editPath: string };
      if (!response.ok) throw new Error(result.error || 'Upload fehlgeschlagen');
      window.location.assign(result.editPath);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Upload fehlgeschlagen');
      setBusy(false);
    }
  }
  return (
    <main className="shell">
      <header>
        <Link className="brand" href="/">
          <span className="mark">≋</span> Channel Studio
        </Link>
        <span className="pill">Deine Sender. Deine Reihenfolge.</span>
      </header>
      <section className="hero">
        <p className="eyebrow">DEIN TV, GUT SORTIERT</p>
        <h1>
          Ein guter Abend
          <br />
          beginnt mit <em>Ordnung.</em>
        </h1>
        <p className="intro">
          Bring deine Sender im Browser in die richtige Reihenfolge.
          <br />
          Übernimm sie auf deinem TV. Danach wird die Datei gelöscht.
        </p>
      </section>
      <section
        className="upload"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!busy) void upload(e.dataTransfer.files[0]);
        }}
      >
        <div className="upload-icon">
          <Upload size={28} />
        </div>
        <h2>Deine Senderliste ist der Anfang.</h2>
        <p>Ziehe den XML-Export aus deinem IPTV-Client hierher.</p>
        <label className="button primary">
          {busy ? 'Wird geladen …' : 'XML-Datei auswählen'}
          <ArrowUpRight size={18} />
          <input
            type="file"
            accept=".xml,application/xml"
            disabled={busy}
            onChange={(e) => void upload(e.target.files?.[0])}
          />
        </label>
        <small>Channel-Studio-Format · maximal 10 MB · keine XMLTV-Datei</small>
        <p role="status">{message}</p>
      </section>
      <section className="features">
        <article>
          <ShieldCheck />
          <h3>Nur das Nötige</h3>
          <p>Sendernamen, Kategorien, Reihenfolge und Sichtbarkeit. Keine Stream-URLs oder Zugangsdaten.</p>
        </article>
        <article>
          <ListOrdered />
          <h3>Einfach umsortieren</h3>
          <p>
            Sender ziehen, an eine Position setzen oder ausblenden. Alles in einer übersichtlichen
            Liste.
          </p>
        </article>
        <article>
          <Trash2 />
          <h3>Ein kurzer Zwischenstopp</h3>
          <p>
            Nach erfolgreicher Übernahme löscht der Client die Datei. Du kannst sie auch jederzeit
            verwerfen.
          </p>
        </article>
      </section>
      <footer>
        CHANNEL STUDIO <span>Ein Werkzeug. Kein Senderarchiv.</span>
      </footer>
    </main>
  );
}
