"""Verbindung zum lokalen Sprachmodell (Ollama). Das ist das "Gehirngewebe" des Wesens."""

import json
import re
import urllib.error
import urllib.request


class Ollama:
    def __init__(self, host="http://localhost:11434", modell="qwen2.5:14b",
                 embed_modell="nomic-embed-text", timeout=300):
        self.host = host.rstrip("/")
        self.modell = modell
        self.embed_modell = embed_modell
        self.timeout = timeout
        self._embed_kaputt = False

    def _post(self, pfad, daten):
        req = urllib.request.Request(
            self.host + pfad,
            data=json.dumps(daten).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=self.timeout) as antwort:
            return json.loads(antwort.read().decode("utf-8"))

    def chat(self, nachrichten, json_modus=False, temperatur=0.8):
        daten = {
            "model": self.modell,
            "messages": nachrichten,
            "stream": False,
            "options": {"temperature": temperatur, "num_ctx": 8192},
        }
        if json_modus:
            daten["format"] = "json"
        antwort = self._post("/api/chat", daten)
        return entferne_denkblock(antwort["message"]["content"])

    def embed(self, text):
        """Vektor für das Gedächtnis. Gibt None zurück, falls kein Embedding-Modell da ist."""
        if self._embed_kaputt:
            return None
        try:
            antwort = self._post("/api/embed", {"model": self.embed_modell, "input": text})
            return antwort["embeddings"][0]
        except (urllib.error.URLError, KeyError, IndexError, OSError):
            self._embed_kaputt = True  # dann eben Stichwortsuche
            return None


def entferne_denkblock(text):
    """Manche Modelle (z.B. qwen3, deepseek-r1) schreiben <think>...</think> vor die Antwort."""
    return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()


def parse_json(text):
    try:
        wert = json.loads(text)
        return wert if isinstance(wert, dict) else {}
    except (json.JSONDecodeError, TypeError):
        pass
    treffer = re.search(r"\{.*\}", text or "", flags=re.DOTALL)
    if treffer:
        try:
            wert = json.loads(treffer.group(0))
            return wert if isinstance(wert, dict) else {}
        except json.JSONDecodeError:
            pass
    return {}
