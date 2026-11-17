# The 30 Seconds Challenge

Deutschsprachiges Statistiklabor mit Teilnehmeransicht, Administration und öffentlicher Projektion. Entwickelt für eine Lehrveranstaltung zu Signifikanztests. Kein vorhandener Quellcode war verfügbar.

## Schnellstart

Voraussetzung: **Node.js 24** (inklusive `node:sqlite`) und npm.

```sh
npm ci
npm start
```

Öffne `http://localhost:3000`. Beim ersten Start schreibt der Server einen **einmaligen Einrichtungsschlüssel** ins Terminal. Öffne den dort angegebenen Link, lege ein Passwort mit mindestens 12 Zeichen fest und melde dich an. Passwörter liegen ausschließlich als gesalzene scrypt-Hashes in SQLite. Alternativ `ADMIN_PASSWORD` beim ersten Start über die Secret-Verwaltung des Hosters setzen; es wird bei einer bereits eingerichteten Datenbank ignoriert. Niemals ein Passwort in den Quellcode schreiben. Für reproduzierbare Erstinstallation kann `SETUP_TOKEN` als Secret vorgegeben werden.

Der SQLite-Speicher wird automatisch unter `data/challenge.sqlite` angelegt. Diesen Ordner persistent halten. `PORT`, `DATA_DIR` und `PUBLIC_URL` sind konfigurierbar. `PUBLIC_URL` muss bei Hosting hinter einem Reverse Proxy die tatsächlich erreichbare HTTPS-Basis-URL enthalten, damit QR-Codes korrekt sind.

## Ablauf einer Veranstaltung

1. Administrationsbereich → Einstellungen → neue Veranstaltung. Für Übungen ausdrücklich **Demo-Veranstaltung** wählen. Reale und Demo-Veranstaltungen sind serverseitig getrennt. Demo-Daten können ausschließlich in einer Demo-Veranstaltung erzeugt werden.
2. Anmeldung und Experimentierphase öffnen; Versuchsgrenze bei Bedarf setzen (`0` = unbegrenzt).
3. „Teilnehmen lassen“ zeigt Link und echten, lokal erzeugten QR-Code. Auf Smartphones wird ausschließlich die Teilnehmeransicht geöffnet. Pseudonym und Gruppe reichen aus.
4. START und STOPP messen lokal mit `performance.now()`. Es gibt weder Uhr noch Zeitfortschrittsanimation. Verlust des Fokus oder Wechsel in den Hintergrund bricht den Versuch ab. Ein Neuladen stellt eine laufende Messung niemals als gültig wieder her. Bereits abgeschlossene Messungen werden vor dem Senden in einer lokalen Warteschlange gespeichert.
5. Daten aktualisieren sich über SSE; native Wiederverbindung plus periodischer Abruf nach 20 Sekunden. Doppelte Messungs-IDs erzeugen keine zweite Speicherung. Zeitpunkte sind Server-Eingangszeitpunkte, keine behaupteten Offline-Messzeitpunkte.
6. Datengrundlage direkt oberhalb der Auswertung wählen – auch in den Präsentationsreitern Statistik, Punktdiagramm, Boxplots, Toleranz und Vierfeldertafel. Fünf Modi: alle Messungen, beste, schlechteste, erste gültige oder neueste gültige Messung pro Person. Primär für den Signifikanztest: **erste gültige Messung pro Person**. Beste/schlechteste beziehen sich auf die kleinste/größte absolute Abweichung von 30 Sekunden; bei Gleichstand zählt der frühere Versuch. Die Auswahl gilt zentral für Kennzahlen, Diagramme, Vierfeldertafeln und Exporte. Die Statistik nennt die ausgewertete Personen- und Messungszahl je Gruppe. Wenn nur eine Messung pro Gruppe einbezogen wird, sind Mittelwert, Median, Minimum und Maximum identisch; ein Hinweis erklärt dies.
7. Toleranz vor Sichtung der Daten festlegen und fixieren. Explorative Änderungen verändern den fixierten Testwert nicht. Die Oberfläche weist auf Unterschiede hin. Eine datenabhängige Festlegung ist keine Präregistrierung.
8. Einzelne Messungen lassen sich ausschließen. Einfrieren sichert die Messungsdaten; neu eintreffende Daten bleiben gespeichert. Live-/Snapshot-Umschalter betrifft Auswertungen und Exporte. Teilnehmerzahlen und die Wettbewerbs-Bestenliste beziehen sich weiterhin auf die laufende Veranstaltung.
9. Die **Bestenliste ist immer live verfügbar**, für Administration, Teilnehmende und die freigegebene Projektion. Pro Person zählt ausschließlich die beste gültige Messung, unabhängig von der Datengrundlage der Statistik. Nur das Simulationsmodul wird gesondert freigegeben; es blendet Inhalte in neun Schritten ein. Die Testentscheidung wird anhand des exakten Fisher-Tests getroffen.
10. Präsentationsmodus für den Beamer öffnen; Pfeiltasten wechseln die Folien. Für ein getrenntes Gerät in den Einstellungen **öffentliche Projektion** freigeben und `/?e=EXPERIMENT-ID&view=presentation` öffnen. Gäste sehen nur lesend die vom Administrator gewählte Folie. Freigabe ermöglicht Zugriff auf pseudonyme gültige Messwerte; Teilnehmer vorher informieren. Die Testentscheidung behält ihre didaktische Freigabeschranke. Die Reiter „Experiment“ und „Relative Häufigkeiten“ entfallen. Im Reiter Vierfeldertafel wird zwischen absoluten, gesamt-, spalten- und zeilenrelativen Häufigkeiten sowie einer kombinierten Darstellung umgeschaltet. Diese Einstellung wird ebenfalls mit der Projektion synchronisiert. Der Toleranzbereich kann direkt in Live-Messungen und Vierfeldertafel geändert werden und gilt zentral.
11. Datenexport: Excel enthält Rohdaten, Kennzahlen und Metadaten; JSON enthält zusätzlich die Veranstaltungseinstellungen und den Snapshot. CSV gibt es getrennt für Rohdaten und Kennzahlen. SVG/PNG über die jeweilige Diagrammkarte.
12. **Experiment neu starten** ist in der Übersicht, den Einstellungen und oben in der Admin-Präsentation erreichbar. Der Dialog verlangt `NEUSTART EXPERIMENT-ID`. Erst nach Bestätigung werden alle Messungen (auch ausgeschlossene), Simulationen und der eingefrorene Stand dieser Veranstaltung gelöscht. Teilnehmende, Gruppen, Teilnahmelink, Toleranz und übrige Auswertungseinstellungen bleiben erhalten; Anmeldung und Messphase öffnen wieder, die didaktische Stufe geht auf 1 und die Präsentation auf Willkommen. Auf verbundenen Geräten wird eine laufende Messung abgebrochen und der alte Ergebnisbildschirm geleert. Eine neue Rundenkennung verhindert, dass alte Offline-Ergebnisse wieder eingespielt werden. Andere Veranstaltungen bleiben unberührt. Alternativ lässt sich in den Einstellungen der **gesamte Datenbestand inklusive Teilnehmenden** mit `LÖSCHEN EXPERIMENT-ID` entfernen. Beide Aktionen sind endgültig; vorher bei Bedarf exportieren.

Ein Demo-Datensatz ist eine Übung, keine wissenschaftliche Referenzpopulation: pro Person ein normalverteilter Messwert mit gruppenabhängiger Streuung. Anzahl und Gruppenverteilung sind einstellbar.

## Architektur

- `server.mjs`: HTTP-API, SQLite-Schema, gesalzene Passworthashes, serverseitige Autorisierung, Cookie-Sitzungen (12 h), Live-Ereignisse, QR und Exporte.
- `public/app.js`: Benutzeroberfläche, lokale Timer, Offline-Warteschlange und SVG-Diagramme.
- `public/stats.js`: reine, von UI und Datenhaltung getrennte Statistikfunktionen. Frontend und Tests nutzen dieselbe Berechnungslogik.
- `public/style.css`: responsives Designsystem (Dunkelblau, Petrol, Gold).
- `test/`: automatisierte Mathematik-, Mehrbenutzer-API- und DOM-Integrationstests. Die DOM-Tests verwenden LinkeDOM als reine Entwicklungsabhängigkeit, keinen echten Browser.

Der Server nutzt synchrones SQLite mit WAL-Modus und kurze atomare Schreibzugriffe. In einem Node-Prozess kann zwischen Prüfung und Speicherung keine zweite Anfrage dazwischentreten; zusätzliche UNIQUE-Constraints sichern Messungs-IDs und Versuchsnummern. Für die vorgesehene Größenordnung ist ein einzelner Server angemessen. **Nicht mit mehreren Prozessen auf ein gemeinsames Netzwerk-Dateisystem skalieren.** Für deutlich größere Last PostgreSQL und verteilte Ereigniszustellung einsetzen.

Teilnehmer erhalten zufällige Bearer-Tokens, deren Hashes serverseitig gespeichert werden. Fremde Versuchshistorien sind nicht abrufbar. Die Live-Bestenliste enthält keine Teilnehmer-Tokens; die Teilnahmeinformation erläutert die öffentliche Anzeige von Pseudonym, Gruppe und Bestleistung. Einstellungen, Ausschlüsse, Exporte und Löschoperationen erfordern eine Administrationssitzung. Login wird nach acht Fehlversuchen pro IP für 15 Minuten begrenzt. Die lokale Identität ist geräte- und browsergebunden, kein wiederherstellbares Benutzerkonto. Die Warteschlange kann vom Nutzer über Browserdaten gelöscht werden.

Für Offline-Messungen gilt bewusst die aktuelle serverseitige Veranstaltungssteuerung bei Eingang: nach Beendigung der Experimentierphase oder Erreichen der Versuchsgrenze wird kein Versuch stillschweigend akzeptiert. Die lokal gesicherten Daten bleiben erhalten; eine Fehlermeldung erklärt die ausstehende Übertragung. Bei einem Gruppenwechsel ist eine neue Teilnahme-ID nötig; die einmal gewählte Gruppe ist nicht nachträglich manipulierbar.

## Mathematik und Didaktik

- Zeit `x`, vorzeichenbehaftete Abweichung `x − 30` und absolute Abweichung `|x − 30|` werden unterschieden.
- „Gut“ bedeutet `|x − 30| ≤ t`; beide Intervallgrenzen sind eingeschlossen.
- Quartile: R-7, lineare Interpolation. Standardabweichung mit Nenner `n − 1`; bei n < 2 undefiniert. Leere Statistiken erscheinen als „–“, nicht als Null.
- Boxplots: Q1/Q3, Median; Whisker bis zu den äußersten Werten innerhalb von 1,5 IQR, Ausreißer separat.
- Punktdiagramme stapeln nahe Messungen ohne vollständige Überdeckung. Tooltip enthält Pseudonym, Messwert und Versuchsnummer.
- Permutation: Hypergeometrisches Ziehen ohne Zurücklegen, fixe Gruppengrößen und fixe Gesamtzahl guter Schätzungen. Teststatistik `p_Studierende − p_Mitarbeitende`.
- Monte Carlo: relativer Anteil `k/B` wird getrennt von `(k+1)/(B+1)` ausgewiesen. Extreme Werte werden entsprechend der gewählten Richtung inklusive Gleichheit gezählt.
- Fisher zweiseitig: Summe der Wahrscheinlichkeiten aller höchstens so wahrscheinlichen Tafeln bei fixierten Rändern. Dies kann von einem Test nach absoluter Anteilsdifferenz abweichen.
- Signifikanzniveau standardmäßig 5 %. Testentscheidung basiert auf Fisher; ein nicht signifikantes Ergebnis beweist H0 nicht.
- Permutationslogik benötigt Austauschbarkeit unter H0. Gruppenzugehörigkeit ist nicht randomisiert; Gelegenheitsstichprobe begrenzt Kausalität und Generalisierbarkeit.

## Deployment: empfohlen Render oder eigener Docker-Server

Die App benötigt einen langlaufenden Node-Prozess und ein persistentes lokales Volume. Ein rein statischer Hoster oder ein kurzlebiges Serverless-Dateisystem genügt nicht. Die Bereitstellung erfolgt über das verknüpfte GitHub-Repository und Render (Docker).

### Render

1. Quellcode in ein eigenes privates Git-Repository übernehmen.
2. Neuer Web Service, Runtime **Docker**, Dockerfile in diesem Ordner.
3. Persistent Disk auf `/app/data` einrichten. Ein kostenpflichtiger Dienst mit persistentem Speicher ist für Veranstaltungen empfehlenswert; keine schlafende Gratis-Instanz.
4. `PUBLIC_URL=https://DEIN-DIENST.onrender.com` setzen. Optional `ADMIN_PASSWORD` über die Secret-Einstellungen nur zur Erstinstallation. `PORT` setzt Render selbst.
5. Instanzzahl **1**. Healthcheck `/api/status`.
6. Einmalig Administration einrichten, neue Veranstaltung erzeugen und QR-Code mit zwei echten Smartphones prüfen.

**Render Free ist ausschließlich zum Ausprobieren geeignet:** Ohne persistente Disk können Datenbank, Veranstaltungen, Admin-Einrichtung und Sitzungen bei Neustarts oder Deployments verloren gehen. Das GitHub-Update kann bei aktiviertem Auto-Deploy einen solchen Neustart auslösen. Benötigte Testdaten vorher exportieren; gegebenenfalls danach erneut mit dem aktuellen Einrichtungsschlüssel aus den Render-Logs einrichten.

### Docker lokal / auf VPS

```sh
docker build -t seconds-challenge .
docker volume create seconds-data
docker run -d --name seconds-challenge --restart unless-stopped \
  -p 3000:3000 -v seconds-data:/app/data \
  -e PUBLIC_URL=https://labor.example.org seconds-challenge
docker logs seconds-challenge
```

Für öffentlichen Betrieb TLS über einen Reverse Proxy (z. B. Caddy) terminieren, Host und `X-Forwarded-Proto` korrekt weitergeben und fremde Forwarded-Header überschreiben. SSE-Pufferung abschalten; Timeout > 60 s. App nicht zusätzlich ungeschützt über einen zweiten Port veröffentlichen. Secure-Cookies werden bei weitergereichtem HTTPS gesetzt. Ohne vorgeschaltetes TLS ist lokaler Betrieb auf HTTP möglich, für externe Nutzung HTTPS erforderlich (`crypto.randomUUID`, Zwischenablage und Vollbild benötigen je nach Browser einen sicheren Kontext).

### Sicherung und Wiederherstellung

Vor der Lehrprobe eine Sicherung anlegen. Bei laufendem SQLite nicht allein die Hauptdatei kopieren: `sqlite3 /pfad/challenge.sqlite ".backup '/sicherungen/challenge.sqlite'"` verwenden oder den Dienst sauber stoppen und den gesamten Datenordner kopieren. Zum Wiederherstellen Dienst stoppen, Sicherung einspielen, Eigentümerrechte kontrollieren und neu starten. Aufbewahrungs- und Löschfrist legt die Veranstaltungsleitung fest; die App löscht nicht automatisch.

## Qualitätssicherung und aktuelle Grenzen

```sh
npm test
```

Durchgeführt (`npm test`, 16 Tests): mathematische Referenz- und Randfalltests; 100 parallele API-Anmeldungen und Messungen; SSE-Ereigniszustellung; alle fünf Datengrundlagen mit unabhängig festgelegten Kennzahlen für beide Gruppen und Gesamtstichprobe; bestes/schlechtestes Ergebnis anhand absoluter Abweichung inklusive Gleichständen; Idempotenz; personenbezogene Zugriffstrennung; Versuchsgrenze; Freeze/Live; Toleranzfixierung; Demo-Trennung; Excel-Rücklesen; QR-Erzeugung; unzulässige Löschbestätigung; Pausieren des Experiments; öffentliche Freigabeprüfung; CSV-Formelinjektion und Wiederanlauf mit persistierter Datenbank; relative Häufigkeiten und leere Ränder; bestätigungspflichtiger Neustart inklusive Rundenschutz gegen alte Offline-Ergebnisse, Teilnehmererhalt, Snapshot-/Simulationslöschung und unveränderter zweiter Veranstaltung; Kompatibilität zu alten gespeicherten Einstellungen. DOM-Tests prüfen die tatsächlich ausgeführten UI-Ereignisse für die bereinigten Präsentationsreiter, fünf Dropdown-Optionen, angezeigte Kennzahlen, gemeinsam genutzte Toleranz-/Häufigkeitseinstellungen, den Neustart auf einem verbundenen Teilnehmergerät und den Seitenwechsel nach der Anmeldung.

**Noch nicht durchgeführt:** Browser-End-to-End-Tests mit mehreren Endgeräten, Smartphone-/Safari-Prüfung, Prüfung der realen Zeitmessung inklusive Hintergrundwechsel, tatsächliche Offline-/Reconnect-Bedienung, PNG-Download und visueller Beamer-Test. Die verwaltete Vorschau scheiterte beim Start des Browser-Relays. Automatisierte API-Tests sind kein Ersatz für diese Prüfungen oder eine längere Lastmessung. Docker-/Render-Deployment und Backup-Restore wurden hier nicht ausgeführt.

**Funktionale Grenzen:** Die Diagrammwahl außerhalb der Präsentation bleibt im jeweiligen Browser. Simulationsergebnisse werden serverseitig persistiert und mit der Projektion synchronisiert; je Auswertungsstand sind maximal 200.000 Simulationen möglich. Ein eingefrorener Messungsstand ist eine gespeicherte Kopie pro Veranstaltung, kein versioniertes Archiv mehrerer Zwischenstände. Keine Passwort-zurücksetzen-Oberfläche; vorhandene Datenbank sichern und Passwort administrativ über eine gesicherte Betreiberaktion erneuern. Für einen öffentlichen Lehrprobeneinsatz zuerst die noch offenen Browser- und Betriebstests durchführen.
