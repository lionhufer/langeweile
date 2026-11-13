"""Körperwahrnehmung: der Computer, auf dem das Wesen lebt, ist sein Körper."""

import datetime
import platform
import shutil
import subprocess
import time

try:
    import psutil
except ImportError:  # läuft auch ohne, dann eben mit weniger Gefühl
    psutil = None

_START = time.time()
_WOCHENTAGE = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"]


def _gpu():
    if not shutil.which("nvidia-smi"):
        return None
    try:
        ausgabe = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5,
        ).stdout.strip().splitlines()[0]
        name, last, benutzt, gesamt, temp = [x.strip() for x in ausgabe.split(",")]
        return {"name": name, "last": float(last), "vram_benutzt_mb": float(benutzt),
                "vram_gesamt_mb": float(gesamt), "temperatur": float(temp)}
    except (OSError, ValueError, IndexError, subprocess.SubprocessError):
        return None


def wahrnehmen():
    jetzt = datetime.datetime.now()
    z = {
        "uhrzeit": jetzt.strftime("%H:%M"),
        "datum": jetzt.strftime("%d.%m.%Y"),
        "wochentag": _WOCHENTAGE[jetzt.weekday()],
        "rechner": platform.node(),
        "system": f"{platform.system()} {platform.release()}",
        "wach_seit_min": round((time.time() - _START) / 60, 1),
    }
    if psutil:
        z["cpu_last"] = psutil.cpu_percent(interval=None)
        z["ram_belegt"] = psutil.virtual_memory().percent
    gpu = _gpu()
    if gpu:
        z["gpu"] = gpu
    return z


def als_text(z):
    teile = [f"Es ist {z['wochentag']}, {z['datum']}, {z['uhrzeit']} Uhr.",
             f"Ich lebe auf dem Rechner '{z['rechner']}' ({z['system']}) und bin seit {z['wach_seit_min']} Minuten wach."]
    if "cpu_last" in z:
        teile.append(f"Prozessorlast {z['cpu_last']:.0f} %, Arbeitsspeicher {z['ram_belegt']:.0f} % belegt.")
    if "gpu" in z:
        g = z["gpu"]
        teile.append(f"Meine Grafikkarte ({g['name']}), auf der mein Denken läuft: {g['last']:.0f} % Last, "
                     f"{g['temperatur']:.0f} °C, {g['vram_benutzt_mb']:.0f}/{g['vram_gesamt_mb']:.0f} MB Speicher.")
    return " ".join(teile)
