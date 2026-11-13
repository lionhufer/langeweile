"""Langzeitgedächtnis: alles, was das Wesen erlebt, denkt und träumt, bleibt auf der Platte."""

import json
import math
import re
import sqlite3
import threading
import time


def _kosinus(a, b):
    if not a or not b or len(a) != len(b):
        return 0.0
    skalar = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return skalar / (na * nb) if na and nb else 0.0


def _woerter(text):
    return {w for w in re.findall(r"\w+", text.lower()) if len(w) > 3}


class Gedaechtnis:
    def __init__(self, pfad, embed_funktion=None):
        self._db = sqlite3.connect(pfad, check_same_thread=False)
        self._lock = threading.Lock()
        self._embed = embed_funktion or (lambda text: None)
        with self._lock:
            self._db.execute(
                """CREATE TABLE IF NOT EXISTS erinnerungen (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    zeit REAL NOT NULL,
                    art TEXT NOT NULL,
                    inhalt TEXT NOT NULL,
                    wichtigkeit REAL NOT NULL DEFAULT 0.5,
                    embedding TEXT
                )"""
            )
            self._db.commit()

    def speichern(self, art, inhalt, wichtigkeit=0.5):
        vektor = self._embed(inhalt)
        with self._lock:
            self._db.execute(
                "INSERT INTO erinnerungen (zeit, art, inhalt, wichtigkeit, embedding) VALUES (?, ?, ?, ?, ?)",
                (time.time(), art, inhalt, float(wichtigkeit), json.dumps(vektor) if vektor else None),
            )
            self._db.commit()

    def schliessen(self):
        with self._lock:
            self._db.close()

    def letzte(self, n=10, art=None):
        with self._lock:
            if art:
                zeilen = self._db.execute(
                    "SELECT zeit, art, inhalt FROM erinnerungen WHERE art = ? ORDER BY id DESC LIMIT ?", (art, n)
                ).fetchall()
            else:
                zeilen = self._db.execute(
                    "SELECT zeit, art, inhalt FROM erinnerungen ORDER BY id DESC LIMIT ?", (n,)
                ).fetchall()
        return [{"zeit": z, "art": a, "inhalt": i} for z, a, i in reversed(zeilen)]

    def zufaellige(self, n=5):
        with self._lock:
            zeilen = self._db.execute(
                "SELECT zeit, art, inhalt FROM erinnerungen ORDER BY RANDOM() LIMIT ?", (n,)
            ).fetchall()
        return [{"zeit": z, "art": a, "inhalt": i} for z, a, i in zeilen]

    def anzahl(self):
        with self._lock:
            return self._db.execute("SELECT COUNT(*) FROM erinnerungen").fetchone()[0]

    def erinnern(self, anlass, k=5):
        """Holt die Erinnerungen, die am besten zum Anlass passen (Bedeutung + Wichtigkeit + Frische)."""
        vektor = self._embed(anlass)
        anlass_woerter = _woerter(anlass)
        jetzt = time.time()
        with self._lock:
            zeilen = self._db.execute(
                "SELECT zeit, art, inhalt, wichtigkeit, embedding FROM erinnerungen ORDER BY id DESC LIMIT 3000"
            ).fetchall()
        bewertet = []
        for zeit, art, inhalt, wichtigkeit, emb in zeilen:
            if vektor and emb:
                aehnlichkeit = _kosinus(vektor, json.loads(emb))
            else:
                w = _woerter(inhalt)
                aehnlichkeit = len(w & anlass_woerter) / (len(anlass_woerter) or 1)
            frische = math.exp(-(jetzt - zeit) / (7 * 24 * 3600))  # verblasst über Wochen
            punkte = aehnlichkeit * 0.7 + wichtigkeit * 0.2 + frische * 0.1
            if aehnlichkeit > 0:
                bewertet.append((punkte, {"zeit": zeit, "art": art, "inhalt": inhalt}))
        bewertet.sort(key=lambda x: x[0], reverse=True)
        return [e for _, e in bewertet[:k]]
