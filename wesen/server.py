"""Kleine Weboberfläche: Gespräch links, Bewusstseinsstrom rechts. Nur Standardbibliothek."""

import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")


def erstelle_server(wesen, host="127.0.0.1", port=8765):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def _json(self, daten, status=200):
            koerper = json.dumps(daten, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(koerper)))
            self.end_headers()
            self.wfile.write(koerper)

        def do_GET(self):
            url = urlparse(self.path)
            if url.path in ("/", "/index.html"):
                with open(os.path.join(STATIC, "index.html"), "rb") as f:
                    inhalt = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(inhalt)))
                self.end_headers()
                self.wfile.write(inhalt)
            elif url.path == "/api/zustand":
                try:
                    seit = int(parse_qs(url.query).get("seit", ["0"])[0])
                except ValueError:
                    seit = 0
                self._json(wesen.zustand(seit))
            else:
                self._json({"fehler": "nicht gefunden"}, 404)

        def do_POST(self):
            if urlparse(self.path).path != "/api/nachricht":
                return self._json({"fehler": "nicht gefunden"}, 404)
            laenge = int(self.headers.get("Content-Length", 0))
            try:
                text = json.loads(self.rfile.read(laenge) or b"{}").get("text", "")
            except json.JSONDecodeError:
                return self._json({"fehler": "kaputtes JSON"}, 400)
            try:
                self._json({"antwort": wesen.antworten(str(text))})
            except Exception as fehler:
                wesen.ereignis("stoerung", f"{type(fehler).__name__}: {fehler}")
                self._json({"fehler": str(fehler)}, 500)

    return ThreadingHTTPServer((host, port), Handler)


def starte_im_hintergrund(server):
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    return t
