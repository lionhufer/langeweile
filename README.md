# Kairo – Krypto-Portfolio-Tracker

Privater Portfolio-Tracker im Stil einer modernen Wallet-App. Du trägst ein, welche Coins du hältst,
Kairo zeigt den aktuellen Wert mit Live-Kursen, Gewinn/Verlust, Verteilung und Charts.

## Funktionen

- **Live-Kurse in Euro** über die öffentliche CoinGecko-API, automatische Aktualisierung jede Minute
- **Portfolio-Chart** für 24 Std., 7 Tage, 1 Monat, 3 Monate und 1 Jahr (zum Antippen bzw. Hovern)
- **Gewinn/Verlust** auf Basis deines Ø-Kaufpreises; Nachkäufe bilden automatisch einen gewichteten Durchschnitt
- **Verteilung** des Portfolios nach Coins
- **Detailansicht** je Coin mit eigenem Chart, Bestand, Wert und Performance
- **Suche** über tausende Coins (Top 250 lokal, der Rest über CoinGecko)
- **Beträge ausblenden** (Auge-Symbol) für unterwegs
- **Export/Import** als JSON, um Daten zu sichern oder aufs Handy zu übertragen
- **Installierbar** als App auf dem Home-Bildschirm (PWA, funktioniert auch offline mit den letzten Daten)

Alle Bestände werden ausschließlich lokal im Browser gespeichert (`localStorage`). Es gibt keinen Server und keinen Account.

## Starten

Kein Build nötig, nur ein statischer Webserver:

```bash
python3 -m http.server 8000
# dann http://localhost:8000 öffnen
```

Aufs Handy bekommst du die App am einfachsten über **GitHub Pages**
(Repo → Settings → Pages → Branch auswählen). Danach die Seite im Browser öffnen und
„Zum Home-Bildschirm hinzufügen“ wählen.

## Dateien

| Datei | Inhalt |
| --- | --- |
| `index.html` | Grundgerüst |
| `styles.css` | Design (dunkles Theme, mobil zuerst) |
| `app.js` | Logik: Kurse, Berechnungen, Charts, Formulare |
| `sw.js` | Service Worker für Offline-Nutzung |
| `manifest.webmanifest`, `icons/` | App-Icon und PWA-Einstellungen |

## Hinweis zur API

Die kostenlose CoinGecko-API hat ein Anfrage-Limit. Kairo stellt Anfragen deshalb nacheinander,
wiederholt sie bei Drosselung automatisch und speichert Chartdaten zwischen. Falls ein Chart kurz nicht lädt,
einfach nach ein paar Sekunden oben auf „Aktualisieren“ tippen.
