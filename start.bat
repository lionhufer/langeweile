@echo off
chcp 65001 >nul
cd /d "%~dp0"

rem ---- Modell anpassen: siehe README (abhaengig vom Grafikspeicher) ----
if "%WESEN_MODELL%"=="" set WESEN_MODELL=qwen2.5:14b

where python >nul 2>nul || (echo Python fehlt. Installiere es von https://www.python.org ^(Haken bei "Add to PATH"^). & pause & exit /b 1)
where ollama >nul 2>nul || (echo Ollama fehlt. Installiere es von https://ollama.com & pause & exit /b 1)

if not exist .venv (
  echo Richte Python-Umgebung ein...
  python -m venv .venv || (pause & exit /b 1)
  .venv\Scripts\python -m pip install -q -r requirements.txt
)

echo Lade Modelle (nur beim ersten Mal dauert das)...
ollama pull %WESEN_MODELL%
ollama pull nomic-embed-text

.venv\Scripts\python -m wesen --modell %WESEN_MODELL% %*
pause
