# Channel Studio

Temporäre Sortieroberfläche für die Programmübersicht des Xtream-IPTV-Clients.

## Im WLAN starten

Voraussetzung: Node.js ab 22.13.0. Abhängigkeiten einmalig installieren:

```sh
npm --prefix apps/channel-studio ci
```

Dann aus dem Hauptverzeichnis des IPTV-Projekts starten:

```sh
npm run studio
```

Der Server lauscht auf IPv4-Port **5173**, auch für andere Geräte im WLAN. Er weicht bei belegtem Port nicht auf einen anderen aus. Die ausgegebene **Network-Adresse** (z. B. `http://192.168.1.10:5173`) im Browser öffnen und im IPTV-Client unter **Einstellungen → Live-TV → Channel Studio: Serveradresse** eintragen. Den aktuellen Client-Build verwenden: ältere installierte TV-Versionen enthalten diese Einstellungen noch nicht.

Mac und TV müssen im selben erreichbaren WLAN sein. Falls macOS nach eingehenden Verbindungen für Node fragt, diese für den WLAN-Test zulassen. Der Mac muss während des Tests eingeschaltet und wach bleiben. Stoppen mit **Ctrl+C** im Terminal. `localhost` am TV bezeichnet den TV, nicht den Mac; die lokale IP-Adresse des Macs verwenden. Es werden keine Router-Portfreigaben benötigt.

XML-Dateien bleiben in der lokalen Speicheremulation auf dem Mac (`.wrangler/state`, nicht in Git). Es wird weder bei IONOS noch in Cloudflare veröffentlicht. Verwende den Entwicklungsserver nur im vertrauenswürdigen lokalen Netzwerk.

Für einen Test nur auf dem Mac: `npm --prefix apps/channel-studio run dev -- --hostname 127.0.0.1`.

## Ablauf

1. Im Client „Sender im Browser sortieren“ wählen. Datenschutztext bestätigen und die Sendernamen in der fokussierbaren Liste prüfen. OK markiert einen Sender als vom Export ausgeschlossen; die lokale Senderliste wird dadurch nicht verändert.
2. Senden. Der Client zeigt einen privaten Bearbeitungslink als QR-Code. Die lokale Zuordnung zwischen Zufallsreferenzen und echten Katalogschlüsseln bleibt ausschließlich in der Datenbank des exportierenden Profils.
3. Im Browser suchen, Sender ziehen, Position eingeben oder ausblenden. Speichern.
4. Im Client „Sortierung übernehmen und Serverdatei löschen“ wählen. Erst nach erfolgreichem Schreiben des lokalen Layouts wird die Serverdatei gelöscht. Ein zwischenzeitlich geänderter Serverstand wird nicht stillschweigend gelöscht.
5. Alternativ im Browser oder Client „Verwerfen und löschen“. Der Löschaufruf ist wiederholbar. Wenn der Browser bereits gelöscht hat, mit „Verwerfen“ die lokale Austauschverknüpfung zurücksetzen.

Exportiert werden alle lokal geladenen Live-Sender einschließlich Qualitätsvarianten und Sender ohne EPG. Die Live-TV-Navigation trennt „Kategorien“ mit Sendervorschau und „EPG nach Kategorie“ mit Zeitleiste. Die Tagesansicht verwendet wie Upstream die heruntergeladenen XMLTV-Daten anhand der EPG-ID. HD-/SD-Varianten mit derselben EPG-ID teilen denselben Programmplan; zusätzliche Abfragen oder Tagescaches je Stream entfallen. Bereits vergangene Sendungen des heutigen Tages bleiben bis zum nächsten Tag erhalten. Fehlende Daten beim Anbieter können nicht ergänzt werden. Ein Klick auf eine Sendung startet den Sender live über die vorhandene Jugendschutzprüfung. Über „EPG erneut herunterladen“ in den Einstellungen lassen sich die gemeinsamen XMLTV-Daten aktualisieren. Sender ohne Programmdaten bleiben sichtbar. Nach der Übernahme verwenden diese Kategorien die bearbeitete Reihenfolge und Sichtbarkeit. Streams und XMLTV-Programmdaten bleiben unverändert. Nicht heruntergeladene oder vom Profil gesperrte Sender werden nicht exportiert. Neue oder vom Export ausgeschlossene Sender behalten ihre vorhandene Sichtbarkeit. Fremde Austauschdateien werden anhand der ausschließlich lokal bekannten Zufallsreferenzen abgewiesen.

Austausch und Studio-Aktivierung sind je Profil getrennt. Übernahme und Verwerfen im Client erfolgen im exportierenden Profil; andere Profile behalten ihre eigene Senderdarstellung.

## XML-Vertrag v1

```xml
<?xml version="1.0" encoding="UTF-8"?>
<channel-layout version="1">
  <channel ref="0123456789abcdef0123456789abcdef" visible="true">
    <name>Beispielsender</name>
  </channel>
</channel-layout>
```

Die Elementreihenfolge ist die gewünschte Reihenfolge. `ref` ist ein zufälliger 128-Bit-Zuordnungswert, keine Sender-/Anbieter-/EPG-ID. Er wird für jeden neuen Austausch neu erzeugt. Keine Anbieterkennungen, Logos, URLs, Stream-Adressen, Kategorie-IDs, Zugangsdaten oder Programminhalte werden exportiert. Bekannte Anbieterbezeichnungen/Zugangsdaten in Namen werden durch neutrale Namen ersetzt; URL-Muster werden entfernt. Namen zusätzlich vor dem Versand prüfen: unbekannte Anbieterzusätze lassen sich nicht zuverlässig automatisch erkennen.

Serverseitige Positivliste: nur dieses Schema, maximal 10 MB und 20.000 Sender. Kommentare, DTDs, externe Entitäten, zusätzliche Attribute, doppelte Referenzen und URL-Muster in Namen werden abgewiesen. Der Server speichert eine XML-Datei pro zufälligem 256-Bit-Arbeitslink in R2; keine Kopie des Originals, keine Historie und keine XML-Inhalte in eigenen Logs. Antworten sind `no-store`. Der Arbeitslink erlaubt Lesen, Ändern und Löschen und darf nicht weitergegeben werden.

## API

- `POST /api/clients`: XML erzeugt einen temporären Arbeitsbereich; Antwort enthält `id`, `editPath`, `xmlPath` und `etag`.
- `GET /api/clients/:id`: gespeichertes XML mit `ETag`.
- `PUT /api/clients/:id`: XML mit `If-Match`; nur Sortierung/Sichtbarkeit bei unveränderter Menge von Referenzen. HTTP 412 bei Konflikten.
- `DELETE /api/clients/:id`: entfernt den Arbeitsbereich. Mit `If-Match` wird nur der zuvor gelesene Stand beansprucht und gelöscht.

Der Editor speichert keine Kopie im Browser-Storage. Ein geöffneter Editor prüft alle zehn Sekunden auf Löschung und leert dann auch seine Anzeige (bei unterbrochener Verbindung erst nach Wiederverbindung); ein manuell heruntergeladenes XML bleibt beim Nutzer. Abgebrochene Sitzungen werden derzeit **nicht zeitgesteuert** gelöscht; dafür „Verwerfen und löschen“ verwenden.

## Prüfung und Hosting

```sh
npx tsc --noEmit
npm run build
# Bei laufendem lokalen Entwicklungsserver:
node test/exchange.mjs
```

Die Integrationstests erzeugen ausschließlich synthetische Daten und löschen sie danach. Clienttests liegen im Hauptprojekt unter `test/services/guideExchange.test.js` und `guideStudio.test.js`.

Hosting ist noch offen. Die vorhandene Sites-Registrierung ist privat und noch nicht veröffentlicht. Private Sites verlangen einen zusätzlichen Dienstzugang für native Geräte; die aktuelle Clientanbindung ist deshalb zunächst für den lokalen Server vorgesehen. Für öffentlichen Betrieb muss das Hosting inklusive Upload-Zugriff und Ablauf/Löschung abgebrochener Sitzungen festgelegt werden. Keine Zugangsdaten in Quellcode oder XML eintragen.

Nach einem Update von der ursprünglichen EPG-Auswahl auf den vollständigen Katalog muss eine bestehende kleine Sitzung zuerst übernommen oder verworfen und anschließend neu exportiert werden. Bereits hochgeladene Dateien werden nicht automatisch erweitert.
