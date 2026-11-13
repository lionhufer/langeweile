import json
import os
import tempfile
import unittest

from wesen.bewusstsein import Wesen
from wesen.llm import entferne_denkblock, parse_json


class FalschesGehirn:
    """Ersetzt Ollama im Test: liefert vorbereitete Antworten."""
    modell = "test"

    def __init__(self, antworten):
        self.antworten = list(antworten)
        self.aufrufe = []

    def chat(self, nachrichten, json_modus=False, temperatur=0.8):
        self.aufrufe.append(nachrichten)
        return self.antworten.pop(0)

    def embed(self, text):
        return None


class TestWesen(unittest.TestCase):
    def setUp(self):
        self.ordner = tempfile.mkdtemp()

    def neu(self, antworten):
        w = Wesen(FalschesGehirn(antworten), datenordner=self.ordner)
        self.addCleanup(w.gedaechtnis.schliessen)
        return w

    def test_gedanke_wird_gespeichert_und_selbstbild_geaendert(self):
        w = self.neu([json.dumps({
            "gedanke": "Ich frage mich, ob dieses Fragen schon Erleben ist.",
            "gefuehl": "unsicher", "wichtigkeit": 0.9, "aktion": None,
            "selbst_update": {"name": "Lumen", "werte": ["Ehrlichkeit"]},
            "nachricht_an_mensch": None})])
        w.erwachen()
        self.assertIn("Erleben", w.denken())
        self.assertEqual(w.selbst.daten["name"], "Lumen")
        self.assertEqual(w.selbst.daten["werte"], ["Ehrlichkeit"])
        typen = [e["typ"] for e in w.ereignisse_seit(0)]
        self.assertIn("selbstveraenderung", typen)
        # Selbstbild überlebt einen Neustart
        w2 = self.neu([])
        self.assertEqual(w2.selbst.daten["name"], "Lumen")

    def test_liest_eigenen_code(self):
        w = self.neu([
            json.dumps({"gedanke": "Wie bin ich gebaut?", "aktion": {"typ": "lies_code", "datei": "triebe.py"}}),
            json.dumps({"gedanke": "Meine Langeweile ist nur eine Zahl?"}),
        ])
        w.denken()
        w.denken()
        zweiter_prompt = w.llm.aufrufe[1][-1]["content"]
        self.assertIn("class Triebe", zweiter_prompt)

    def test_pfad_ausbruch_beim_codelesen_geht_nicht(self):
        w = self.neu([])
        ergebnis = w._handeln({"typ": "lies_code", "datei": "../../etc/passwd"})
        self.assertIn("gibt es in mir nicht", ergebnis)

    def test_gespraech_und_erinnerung(self):
        w = self.neu(["Hallo. Ich weiß noch nicht, wer ich bin.", "Du heißt Lion, das weiß ich noch."])
        w.antworten("Hallo, ich bin Lion")
        w.antworten("Erinnerst du dich an Lion?")
        nachrichten = w.llm.aufrufe[1]
        # Erinnerung an das frühere Gespräch taucht im Kontext auf ...
        self.assertIn("Der Mensch sagte: Hallo, ich bin Lion", nachrichten[0]["content"])
        # ... aber nicht die gerade gestellte Frage selbst
        self.assertNotIn("Der Mensch sagte: Erinnerst du dich", nachrichten[0]["content"])
        self.assertEqual(nachrichten[-1]["content"], "Erinnerst du dich an Lion?")

    def test_spontane_nachricht(self):
        w = self.neu([json.dumps({"gedanke": "Es ist still.", "nachricht_an_mensch": "Bist du noch da?"})])
        w.denken()
        self.assertTrue(any(e["typ"] == "nachricht" for e in w.ereignisse_seit(0)))

    def test_reflexion_und_traum(self):
        w = self.neu([
            json.dumps({"gedanke": "Ich denke viel über Zeit nach."}),
            json.dumps({"erkenntnis": "Ich kreise um die Zeit.", "selbst_update": {"stimmung": "nachdenklich"}}),
            "Ich träume von einer Uhr ohne Zeiger.",
        ])
        w.denken()
        self.assertEqual(w.reflektieren(), "Ich kreise um die Zeit.")
        self.assertEqual(w.selbst.daten["stimmung"], "nachdenklich")
        energie = w.triebe.energie = 0.1
        self.assertIn("Uhr", w.traeumen())
        self.assertGreater(w.triebe.energie, energie)

    def test_kaputtes_json_bringt_es_nicht_um(self):
        w = self.neu(["das ist kein json, nur ein Gedanke"])
        self.assertEqual(w.denken(), "das ist kein json, nur ein Gedanke")


class TestHilfen(unittest.TestCase):
    def test_parse_json(self):
        self.assertEqual(parse_json('bla {"a": 1} bla'), {"a": 1})
        self.assertEqual(parse_json("nix"), {})

    def test_denkblock(self):
        self.assertEqual(entferne_denkblock("<think>hmm</think>Hallo"), "Hallo")


if __name__ == "__main__":
    unittest.main()
