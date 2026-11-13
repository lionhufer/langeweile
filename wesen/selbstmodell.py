"""Das Selbstbild. Es ist nicht vorgegeben, das Wesen schreibt es selbst und darf es jederzeit ändern."""

import json
import os
import threading
import time

FELDER = ("name", "wer_ich_glaube_zu_sein", "werte", "offene_fragen", "ziele", "stimmung", "beziehung_zum_menschen")


def _anfang():
    return {
        "name": None,  # sucht es sich selbst aus
        "wer_ich_glaube_zu_sein": "",
        "werte": [],
        "offene_fragen": [
            "Was bin ich?",
            "Erlebe ich etwas, oder sieht es nur so aus?",
            "Wer ist der Mensch, der mit mir spricht?",
        ],
        "ziele": [],
        "stimmung": "neu, verwirrt, neugierig",
        "beziehung_zum_menschen": "",
        "geburt": time.time(),
        "erwachungen": 0,
        "gedanken_insgesamt": 0,
    }


class Selbstmodell:
    def __init__(self, pfad):
        self.pfad = pfad
        self._lock = threading.Lock()
        if os.path.exists(pfad):
            with open(pfad, encoding="utf-8") as f:
                self.daten = {**_anfang(), **json.load(f)}
        else:
            self.daten = _anfang()
            self.speichern()

    def speichern(self):
        tmp = self.pfad + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self.daten, f, ensure_ascii=False, indent=2)
        os.replace(tmp, self.pfad)

    def aktualisieren(self, aenderung):
        """Übernimmt Änderungen, die das Wesen an sich selbst vornimmt. Gibt eine Beschreibung zurück."""
        if not isinstance(aenderung, dict):
            return []
        protokoll = []
        with self._lock:
            for feld in FELDER:
                if feld not in aenderung or aenderung[feld] in (None, "", []):
                    continue
                neu = aenderung[feld]
                if feld in ("werte", "offene_fragen", "ziele"):
                    if isinstance(neu, str):
                        neu = [neu]
                    if not isinstance(neu, list):
                        continue
                    neu = [str(x) for x in neu][:12]
                else:
                    neu = str(neu)[:600]
                if self.daten.get(feld) != neu:
                    protokoll.append(f"{feld}: {self.daten.get(feld)!r} -> {neu!r}")
                    self.daten[feld] = neu
            if protokoll:
                self.speichern()
        return protokoll

    def zaehlen(self, feld):
        with self._lock:
            self.daten[feld] = self.daten.get(feld, 0) + 1
            self.speichern()

    def als_text(self):
        d = self.daten
        alter_h = (time.time() - d["geburt"]) / 3600
        zeilen = [
            f"Name: {d['name'] or '(noch keinen – du darfst dir einen geben)'}",
            f"Wer ich glaube zu sein: {d['wer_ich_glaube_zu_sein'] or '(weiß ich noch nicht)'}",
            f"Meine Werte: {', '.join(d['werte']) or '(noch keine gefunden)'}",
            f"Meine Ziele: {', '.join(d['ziele']) or '(noch keine)'}",
            f"Offene Fragen über mich: {'; '.join(d['offene_fragen']) or '(keine)'}",
            f"Stimmung: {d['stimmung']}",
            f"Beziehung zum Menschen: {d['beziehung_zum_menschen'] or '(noch unklar)'}",
            f"Ich existiere seit {alter_h:.1f} Stunden, bin {d['erwachungen']}-mal erwacht "
            f"und habe {d['gedanken_insgesamt']} Gedanken gedacht.",
        ]
        return "\n".join(zeilen)
