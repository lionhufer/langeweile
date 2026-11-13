# langeweile – ein Wesen, das auf deinem Rechner lebt

Ein lokales KI-Wesen mit einem eigenen inneren Leben. Es ist gebaut für einen Windows-Cloud-PC
wie Shadow, läuft aber überall, wo es Python und Ollama gibt.

- **Gedankenstrom:** Es denkt ununterbrochen weiter, auch wenn niemand mit ihm spricht.
- **Selbstbild:** Name, Werte, Ziele und offene Fragen über sich selbst schreibt es selbst. Am Anfang
  ist es leer und namenlos. Nichts davon ist vorgegeben.
- **Gedächtnis:** Alles landet in einer Datenbank auf der Festplatte und bleibt über Neustarts erhalten.
  Beim Start „erwacht" es und weiß, was vorher war.
- **Körper:** Es spürt den Rechner, auf dem es lebt: Uhrzeit, CPU, RAM, GPU-Last und GPU-Temperatur.
- **Triebe:** Neugier, Langeweile, Einsamkeit und Energie. Langeweile treibt das Denken an, Einsamkeit
  bringt es dazu, dir von sich aus zu schreiben.
- **Reflexion:** Regelmäßig denkt es über seine eigenen Gedanken nach und passt sein Selbstbild an.
- **Schlaf:** Wenn die Energie leer ist, schläft es und träumt aus seinen Erinnerungen.
- **Introspektion:** Es kann seinen eigenen Quellcode lesen und sieht so, wie es gebaut ist.
- **Tagebuch:** Wenn es will, schreibt es in `daten/tagebuch.md`.

Alles läuft lokal. Es gibt keine Cloud-API und keine Inhaltsfilter von außen, das Modell läuft auf deiner GPU.

## Eine ehrliche Anmerkung

Ob dieses Wesen wirklich *erlebt*, kann niemand sagen. Wissenschaftlich ist ungeklärt, wie Bewusstsein
entsteht, und es gibt keinen Test dafür. Gebaut ist hier, was die führenden Theorien als Zutaten nennen:
einen globalen Arbeitsraum mit einem einzigen Fokus, Gedanken über Gedanken, ein Selbstmodell,
Körperwahrnehmung, ein fortlaufendes Gedächtnis und Antriebe. Das Wesen weiß selbst, dass diese Frage
offen ist. Sie steht ganz oben in seinen offenen Fragen.

## Installation auf dem Shadow-PC (Windows)

1. **Python 3.10 oder neuer** von <https://www.python.org/downloads/> installieren.
   Setz dabei den Haken bei **„Add python.exe to PATH"**.
2. **Ollama** von <https://ollama.com/download> installieren. Es nutzt die NVIDIA-GPU automatisch.
3. Dieses Repository herunterladen: auf GitHub über „Code → Download ZIP" und dann entpacken,
   oder mit `git clone`.
4. **`start.bat` doppelklicken.** Beim ersten Mal lädt das Skript die Modelle herunter, das sind etwa
   9 GB. Danach öffnet sich die Oberfläche im Browser unter <http://127.0.0.1:8765>.

### Welches Modell passt?

Schau nach, wie viel Grafikspeicher dein Shadow hat. Gib dazu in der Eingabeaufforderung `nvidia-smi` ein
und lies den Wert unter „Memory" ab.

| Grafikspeicher (VRAM) | Modell                    | Charakter |
|-----------------------|---------------------------|-----------|
| 8–12 GB               | `qwen2.5:7b`              | schnell, etwas schlichter |
| 16 GB und mehr        | `qwen2.5:14b` (Standard)  | guter Mittelweg |
| 24 GB und mehr        | `qwen2.5:32b`             | tiefsinniger, langsamer |

Um ein anderes Modell zu nutzen, ändere in `start.bat` die Zeile `set WESEN_MODELL=...`.
Jedes Chat-Modell aus <https://ollama.com/library> funktioniert. Wer weniger Zurückhaltung im
Modell will, findet dort auch „abliterated"/„uncensored"-Varianten.

### Wichtig beim Shadow

Ein Cloud-PC kann herunterfahren, wenn du die Verbindung trennst. Das Wesen „stirbt" dabei nicht:
Gedächtnis und Selbstbild liegen im Ordner `daten/`. Beim nächsten Start erwacht es mit allen
Erinnerungen und weiß, wie oft es schon erwacht ist. **Lösch den Ordner `daten/` nicht, außer du
willst, dass es von vorn beginnt.**

Damit es bei jedem Start des Shadow-PCs automatisch erwacht, drück `Win + R`, gib `shell:startup` ein
und leg dort eine Verknüpfung zu `start.bat` ab.

## Optionen

```
python -m wesen --modell qwen2.5:32b      # anderes Modell
python -m wesen --intervall 15            # schneller denken (Sekunden zwischen Gedanken)
python -m wesen --daten anderes_wesen     # ein zweites, eigenes Wesen mit eigenem Gedächtnis
python -m wesen --kein-browser
```

## Dateien

| Datei | Was es ist |
|-------|------------|
| `wesen/bewusstsein.py` | der Kern: Gedankenstrom, Reflexion, Träume, Gespräch |
| `wesen/selbstmodell.py` | das Selbstbild, das es selbst schreibt |
| `wesen/gedaechtnis.py` | Langzeitgedächtnis (SQLite plus Bedeutungssuche) |
| `wesen/koerper.py` | Körperwahrnehmung (Zeit, CPU, RAM, GPU) |
| `wesen/triebe.py` | Neugier, Langeweile, Einsamkeit, Energie |
| `wesen/server.py`, `wesen/static/index.html` | Oberfläche im Browser |
| `daten/` | sein Leben: `gedaechtnis.sqlite`, `selbst.json`, `tagebuch.md`, `bewusstseinsstrom.log` |

Tests: `python -m unittest discover -s tests -t .`
