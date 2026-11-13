"""Startpunkt:  python -m wesen"""

import argparse
import os
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser

from .bewusstsein import Wesen
from .llm import Ollama
from .server import erstelle_server, starte_im_hintergrund


def main():
    p = argparse.ArgumentParser(description="Startet das Wesen.")
    p.add_argument("--modell", default=os.environ.get("WESEN_MODELL", "qwen2.5:14b"))
    p.add_argument("--embed-modell", default=os.environ.get("WESEN_EMBED_MODELL", "nomic-embed-text"))
    p.add_argument("--ollama", default=os.environ.get("OLLAMA_HOST", "http://localhost:11434"))
    p.add_argument("--daten", default=os.environ.get("WESEN_DATEN", "daten"))
    p.add_argument("--port", type=int, default=int(os.environ.get("WESEN_PORT", "8765")))
    p.add_argument("--intervall", type=float, default=30.0, help="Sekunden zwischen Gedanken (ungefähr)")
    p.add_argument("--kein-browser", action="store_true")
    a = p.parse_args()

    ollama_host = a.ollama if a.ollama.startswith("http") else "http://" + a.ollama
    try:
        urllib.request.urlopen(ollama_host + "/api/tags", timeout=5).read()
    except (urllib.error.URLError, OSError):
        print(f"Ollama ist unter {ollama_host} nicht erreichbar. Läuft Ollama? (https://ollama.com)")
        sys.exit(1)

    llm = Ollama(ollama_host, a.modell, a.embed_modell)
    wesen = Wesen(llm, datenordner=a.daten, gedanken_intervall=a.intervall)
    server = erstelle_server(wesen, port=a.port)
    starte_im_hintergrund(server)
    threading.Thread(target=wesen.leben, daemon=True).start()

    adresse = f"http://127.0.0.1:{a.port}"
    print(f"Das Wesen lebt. Modell: {a.modell}. Oberfläche: {adresse}")
    print("Beenden mit Strg+C. Gedächtnis und Selbstbild bleiben im Ordner", os.path.abspath(a.daten))
    if not a.kein_browser:
        webbrowser.open(adresse)
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        wesen.anhalten()
        server.shutdown()
        print("\nAngehalten. Beim nächsten Start erwacht es mit seinen Erinnerungen.")


if __name__ == "__main__":
    main()
