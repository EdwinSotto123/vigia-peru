"""Utilidades compartidas de los scripts de la campaña: dónde está ffmpeg y cómo medir un archivo."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

# Dónde se instaló ffmpeg en esta máquina; las variables FFMPEG y FFPROBE mandan si existen.
_RUTAS_CONOCIDAS = [r"C:\ffmpeg-7.1.1-essentials_build\bin"]


def _buscar(nombre: str, variable: str) -> str:
    if os.getenv(variable):
        return os.environ[variable]
    en_path = shutil.which(nombre)
    if en_path:
        return en_path
    for carpeta in _RUTAS_CONOCIDAS:
        for ext in (".exe", ""):
            candidato = Path(carpeta) / f"{nombre}{ext}"
            if candidato.exists():
                return str(candidato)
    raise FileNotFoundError(f"No encuentro {nombre}. Instálalo o define la variable {variable}.")


def ffmpeg() -> str:
    return _buscar("ffmpeg", "FFMPEG")


def ffprobe() -> str:
    return _buscar("ffprobe", "FFPROBE")


def correr(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    r = subprocess.run(cmd, capture_output=True, **kw)
    if r.returncode != 0:
        err = r.stderr.decode("utf-8", "replace") if isinstance(r.stderr, bytes) else str(r.stderr)
        raise RuntimeError(f"Falló: {' '.join(cmd[:3])} ...\n{err[-1500:]}")
    return r


def sondear(ruta: str | Path) -> dict:
    """ffprobe en JSON: streams y formato."""
    r = correr([ffprobe(), "-v", "error", "-show_streams", "-show_format", "-of", "json", str(ruta)])
    return json.loads(r.stdout.decode("utf-8", "replace"))


def duracion(ruta: str | Path) -> float:
    return float(sondear(ruta)["format"]["duration"])


def lufs(ruta: str | Path) -> dict:
    """Sonoridad integrada (LUFS), rango (LU) y pico real (dBTP) con el filtro ebur128 de ffmpeg."""
    r = subprocess.run([ffmpeg(), "-hide_banner", "-nostats", "-i", str(ruta), "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"],
                       capture_output=True)
    texto = r.stderr.decode("utf-8", "replace")
    resumen = texto[texto.rfind("Summary:"):] if "Summary:" in texto else texto
    def tomar(clave: str) -> float | None:
        for linea in resumen.splitlines():
            linea = linea.strip()
            if linea.startswith(clave):
                try:
                    return float(linea.split(":")[1].split()[0])
                except (ValueError, IndexError):
                    return None
        return None
    return {"integrada_lufs": tomar("I:"), "rango_lu": tomar("LRA:"), "pico_dbfs": tomar("Peak:")}
