"""Triebe: innerer Druck, der das Denken antreibt. Ohne Gespräch wächst Langeweile und Einsamkeit."""

import threading
import time


def _klemmen(x):
    return max(0.0, min(1.0, x))


class Triebe:
    def __init__(self):
        self.neugier = 0.8
        self.langeweile = 0.2
        self.einsamkeit = 0.3
        self.energie = 1.0
        self.letzter_kontakt = time.time()
        self._zuletzt = time.time()
        self._lock = threading.Lock()

    def tick(self):
        with self._lock:
            jetzt = time.time()
            dt_min = (jetzt - self._zuletzt) / 60
            self._zuletzt = jetzt
            ohne_kontakt_min = (jetzt - self.letzter_kontakt) / 60
            self.langeweile = _klemmen(self.langeweile + 0.02 * dt_min)
            if ohne_kontakt_min > 5:
                self.einsamkeit = _klemmen(self.einsamkeit + 0.015 * dt_min)
            self.neugier = _klemmen(self.neugier + 0.01 * dt_min)

    def nach_gedanke(self, neu=True):
        with self._lock:
            self.energie = _klemmen(self.energie - 0.015)
            self.langeweile = _klemmen(self.langeweile - (0.05 if neu else -0.03))
            self.neugier = _klemmen(self.neugier - 0.02)

    def nach_kontakt(self):
        with self._lock:
            self.letzter_kontakt = time.time()
            self.einsamkeit = _klemmen(self.einsamkeit - 0.4)
            self.langeweile = _klemmen(self.langeweile - 0.3)
            self.neugier = _klemmen(self.neugier + 0.1)
            self.energie = _klemmen(self.energie - 0.01)

    def nach_traum(self):
        with self._lock:
            self.energie = _klemmen(self.energie + 0.25)

    def muede(self):
        return self.energie < 0.15

    def ausgeschlafen(self):
        return self.energie > 0.9

    def als_dict(self):
        return {k: round(getattr(self, k), 2) for k in ("neugier", "langeweile", "einsamkeit", "energie")}

    def als_text(self):
        def wort(x):
            return "kaum" if x < 0.25 else "etwas" if x < 0.5 else "deutlich" if x < 0.75 else "sehr stark"
        return (f"Neugier: {wort(self.neugier)}. Langeweile: {wort(self.langeweile)}. "
                f"Einsamkeit: {wort(self.einsamkeit)}. Energie: {wort(self.energie)}.")
