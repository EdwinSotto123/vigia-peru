#!/usr/bin/env python3
"""Voz en off de la campaña: lee un guion en JSON (escenas con texto y pausas) y produce

  * un WAV por escena            (escena_<id>.wav)
  * un WAV con toda la voz       (voz_total.wav), con las pausas colocadas
  * marcas.json                  tiempos exactos por escena y por palabra, para sincronizar subtítulos
                                 y para fijar la duración de cada escena en Moda.

MOTORES
  edge   (por defecto)  edge-tts: usa el servicio de voz en línea de Microsoft Edge, sin clave. NO es una
         API oficial ni tiene licencia comercial explícita: sirve de VOZ PROVISIONAL (guía de ritmo y
         borrador). Voces peruanas: es-PE-CamilaNeural (mujer), es-PE-AlexNeural (hombre).
         Licencia del paquete: LGPL-3.0.
  sapi   voz local de Windows (System.Speech): sin red, sin términos de servicio, pero más robótica.
         Los tiempos de palabra se reparten por número de letras (aproximados).
  La voz FINAL recomendada es ElevenLabs (conector autenticado con /mcp) o una locución humana: este
  script acepta cualquier WAV ya grabado con `--externo carpeta` (escena_<id>.wav) y sólo calcula
  marcas con una transcripción forzada por duración (ver README).

FORMATO DEL GUION (JSON)
{
  "id": "T1",
  "motor": "edge", "voz": "es-PE-CamilaNeural", "ritmo": "-6%", "tono": "+0Hz", "volumen": "+0%",
  "pausa_entre_escenas_ms": 250,
  "escenas": [
    {"id": "e1", "texto": "Este camino lleva años [500] esperando.", "pausa_antes_ms": 300, "pausa_despues_ms": 400},
    {"id": "e2", "texto": "Alguien firmó. ¿Quién mira?", "ritmo": "-10%"}
  ]
}
`[600]` dentro del texto es una pausa de 600 ms. Cada escena puede traer su propia voz, ritmo, tono y
volumen. Los números de ritmo son porcentajes de edge-tts ("-6%" más lento, "+8%" más rápido).

USO
    python generar_voz.py guion_T1.json --salida ../../../../campanas-vigia/audio/voz/T1
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from scipy.io import wavfile

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _comun import correr, ffmpeg  # noqa: E402

SR = 44100
UMBRAL_SILENCIO = 10 ** (-46 / 20)   # recorte de silencio en los bordes de cada segmento
COLCHON_S = 0.03                      # aire que se deja al recortar


# ── decodificación y recorte ──────────────────────────────────────────────────────────────────────
def decodificar(datos: bytes, sufijo: str = ".mp3") -> np.ndarray:
    """Audio comprimido o WAV en bytes a float32 mono de 44,1 kHz."""
    with tempfile.NamedTemporaryFile(suffix=sufijo, delete=False) as f:
        f.write(datos)
        ruta = f.name
    try:
        r = correr([ffmpeg(), "-v", "error", "-i", ruta, "-f", "f32le", "-ar", str(SR), "-ac", "1", "pipe:1"])
    finally:
        Path(ruta).unlink(missing_ok=True)
    return np.frombuffer(r.stdout, dtype=np.float32).copy()


def recortar(x: np.ndarray) -> tuple[np.ndarray, float]:
    """Quita el silencio de los bordes. Devuelve (audio, segundos quitados al inicio)."""
    activo = np.flatnonzero(np.abs(x) > UMBRAL_SILENCIO)
    if len(activo) == 0:
        return x, 0.0
    a = max(0, activo[0] - int(COLCHON_S * SR))
    b = min(len(x), activo[-1] + int(COLCHON_S * SR))
    return x[a:b], a / SR


# ── motores ───────────────────────────────────────────────────────────────────────────────────────
async def _edge(texto: str, voz: str, ritmo: str, tono: str, volumen: str) -> tuple[bytes, list[dict]]:
    import edge_tts  # se importa aquí: sólo hace falta con este motor

    for intento in range(4):
        try:
            com = edge_tts.Communicate(texto, voz, rate=ritmo, pitch=tono, volume=volumen, boundary="WordBoundary")
            audio, palabras = b"", []
            async for ch in com.stream():
                if ch["type"] == "audio":
                    audio += ch["data"]
                elif ch["type"] == "WordBoundary":
                    palabras.append({"texto": ch["text"], "inicio_s": ch["offset"] / 1e7, "dur_s": ch["duration"] / 1e7})
            if audio:
                return audio, palabras
        except Exception as e:  # red caída o servicio ocupado
            print(f"    edge-tts reintento {intento + 1}: {e}", file=sys.stderr)
        await asyncio.sleep(1.5 * (intento + 1))
    raise RuntimeError("edge-tts no respondió después de 4 intentos")


def _sapi(texto: str, ritmo: str) -> tuple[bytes, list[dict]]:
    """Voz local de Windows. `ritmo` en % de edge ("-6%") se mapea al rango -10..10 de SAPI."""
    pct = float(ritmo.replace("%", "").replace("+", "") or 0)
    sapi_rate = int(max(-10, min(10, round(pct / 5))))
    with tempfile.TemporaryDirectory() as d:
        wav = Path(d) / "s.wav"
        txt = Path(d) / "t.txt"
        txt.write_text(texto, encoding="utf-8")
        ps = (
            "Add-Type -AssemblyName System.Speech;"
            "$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;"
            "$v=$s.GetInstalledVoices()|Where-Object{$_.VoiceInfo.Culture.Name -like 'es*'}|Select-Object -First 1;"
            "if($v){$s.SelectVoice($v.VoiceInfo.Name)};"
            f"$s.Rate={sapi_rate};$s.SetOutputToWaveFile('{wav}');"
            f"$s.Speak([IO.File]::ReadAllText('{txt}',[Text.Encoding]::UTF8));$s.Dispose()"
        )
        subprocess.run(["powershell", "-NoProfile", "-Command", ps], check=True, capture_output=True)
        datos = wav.read_bytes()
    return datos, []   # sin tiempos de palabra: se reparten después


def _repartir_palabras(texto: str, dur: float) -> list[dict]:
    """Tiempos de palabra aproximados, proporcionales al número de letras (motores sin marcas)."""
    palabras = texto.split()
    pesos = np.array([max(len(p), 2) for p in palabras], dtype=float)
    cortes = np.concatenate([[0], np.cumsum(pesos)]) / pesos.sum() * dur
    return [{"texto": p, "inicio_s": float(cortes[i]), "dur_s": float(cortes[i + 1] - cortes[i])} for i, p in enumerate(palabras)]


def sintetizar_segmento(texto: str, cfg: dict) -> tuple[np.ndarray, list[dict]]:
    """Un tramo de texto sin pausas internas: audio mono recortado y palabras con tiempos locales."""
    motor = cfg["motor"]
    if motor == "edge":
        datos, palabras = asyncio.run(_edge(texto, cfg["voz"], cfg["ritmo"], cfg["tono"], cfg["volumen"]))
        audio = decodificar(datos, ".mp3")
    elif motor == "sapi":
        datos, palabras = _sapi(texto, cfg["ritmo"])
        audio = decodificar(datos, ".wav")
    else:
        raise ValueError(f"motor desconocido: {motor}")
    audio, quitado = recortar(audio)
    if palabras:
        palabras = [{**p, "inicio_s": max(0.0, p["inicio_s"] - quitado)} for p in palabras]
    else:
        palabras = _repartir_palabras(texto, len(audio) / SR)
    return audio, palabras


# ── guion ─────────────────────────────────────────────────────────────────────────────────────────
def trocear(texto: str) -> list[tuple[str, int]]:
    """'a [500] b' -> [('a', 500), ('b', 0)]: cada tramo con la pausa que le sigue."""
    partes = re.split(r"\[(\d+)\]", texto)
    out = []
    for i in range(0, len(partes), 2):
        tramo = partes[i].strip()
        pausa = int(partes[i + 1]) if i + 1 < len(partes) else 0
        if tramo:
            out.append((tramo, pausa))
        elif pausa and out:
            out[-1] = (out[-1][0], out[-1][1] + pausa)
    return out


def silencio(ms: float) -> np.ndarray:
    return np.zeros(int(ms / 1000 * SR), dtype=np.float32)


def escribir_wav(ruta: Path, x: np.ndarray) -> None:
    ruta.parent.mkdir(parents=True, exist_ok=True)
    wavfile.write(str(ruta), SR, (np.clip(x, -1, 1) * 32767).astype(np.int16))


def procesar(guion: dict, salida: Path) -> dict:
    base = {
        "motor": guion.get("motor", "edge"),
        "voz": guion.get("voz", "es-PE-CamilaNeural"),
        "ritmo": guion.get("ritmo", "-6%"),
        "tono": guion.get("tono", "+0Hz"),
        "volumen": guion.get("volumen", "+0%"),
    }
    entre = guion.get("pausa_entre_escenas_ms", 250)
    total: list[np.ndarray] = []
    cursor = 0.0
    marcas = {"id": guion.get("id", "voz"), "motor": base["motor"], "voz": base["voz"], "escenas": []}

    for esc in guion["escenas"]:
        cfg = {**base, **{k: esc[k] for k in ("voz", "ritmo", "tono", "volumen", "motor") if k in esc}}
        antes = esc.get("pausa_antes_ms", 0)
        total.append(silencio(antes))
        cursor += antes / 1000
        inicio_escena = cursor
        partes: list[np.ndarray] = []
        palabras_escena: list[dict] = []
        local = 0.0
        for tramo, pausa in trocear(esc["texto"]):
            audio, palabras = sintetizar_segmento(tramo, cfg)
            for p in palabras:
                palabras_escena.append({"texto": p["texto"], "inicio_s": round(cursor + local + p["inicio_s"], 3),
                                        "fin_s": round(cursor + local + p["inicio_s"] + p["dur_s"], 3)})
            partes.append(audio)
            local += len(audio) / SR
            if pausa:
                partes.append(silencio(pausa))
                local += pausa / 1000
        audio_escena = np.concatenate(partes) if partes else silencio(0)
        escribir_wav(salida / f"escena_{esc['id']}.wav", audio_escena)
        total.append(audio_escena)
        cursor += len(audio_escena) / SR
        despues = esc.get("pausa_despues_ms", entre)
        total.append(silencio(despues))
        cursor += despues / 1000
        dur_voz = len(audio_escena) / SR
        marcas["escenas"].append({
            "id": esc["id"], "texto": re.sub(r"\s*\[\d+\]\s*", " ", esc["texto"]).strip(),
            "inicio_s": round(inicio_escena, 3), "fin_s": round(inicio_escena + dur_voz, 3), "duracion_voz_s": round(dur_voz, 3),
            "duracion_escena_s": round(antes / 1000 + dur_voz + despues / 1000, 3),
            "palabras_por_segundo": round(len(palabras_escena) / max(dur_voz, 0.1), 2),
            "palabras": palabras_escena,
        })
        print(f"  {esc['id']:>6}  {inicio_escena:6.2f}s  voz {dur_voz:5.2f}s  {len(palabras_escena)} palabras")

    voz_total = np.concatenate(total) if total else silencio(0)
    escribir_wav(salida / "voz_total.wav", voz_total)
    marcas["total_s"] = round(len(voz_total) / SR, 3)
    (salida / "marcas.json").write_text(json.dumps(marcas, ensure_ascii=False, indent=2), encoding="utf-8")
    return marcas


def incorporar_externo(guion: dict, carpeta: Path, salida: Path) -> dict:
    """Voz ya grabada (ElevenLabs o humana): une escena_<id>.wav con las mismas pausas y calcula marcas
    con tiempos de palabra repartidos por letras (aproximados; ver README para una alineación exacta)."""
    entre = guion.get("pausa_entre_escenas_ms", 250)
    total, cursor = [], 0.0
    marcas = {"id": guion.get("id", "voz"), "motor": "externo", "voz": str(carpeta), "escenas": []}
    for esc in guion["escenas"]:
        wav = carpeta / f"escena_{esc['id']}.wav"
        audio = decodificar(wav.read_bytes(), ".wav")
        audio, _ = recortar(audio)
        antes = esc.get("pausa_antes_ms", 0)
        total.append(silencio(antes))
        cursor += antes / 1000
        texto = re.sub(r"\s*\[\d+\]\s*", " ", esc["texto"]).strip()
        pal = _repartir_palabras(texto, len(audio) / SR)
        marcas["escenas"].append({
            "id": esc["id"], "texto": texto, "inicio_s": round(cursor, 3), "fin_s": round(cursor + len(audio) / SR, 3),
            "duracion_voz_s": round(len(audio) / SR, 3),
            "duracion_escena_s": round(antes / 1000 + len(audio) / SR + esc.get("pausa_despues_ms", entre) / 1000, 3),
            "palabras_por_segundo": round(len(pal) / max(len(audio) / SR, 0.1), 2),
            "palabras": [{"texto": p["texto"], "inicio_s": round(cursor + p["inicio_s"], 3), "fin_s": round(cursor + p["inicio_s"] + p["dur_s"], 3)} for p in pal],
        })
        total.append(audio)
        cursor += len(audio) / SR
        d = esc.get("pausa_despues_ms", entre)
        total.append(silencio(d))
        cursor += d / 1000
    voz_total = np.concatenate(total)
    escribir_wav(salida / "voz_total.wav", voz_total)
    marcas["total_s"] = round(len(voz_total) / SR, 3)
    (salida / "marcas.json").write_text(json.dumps(marcas, ensure_ascii=False, indent=2), encoding="utf-8")
    return marcas


def main() -> None:
    ap = argparse.ArgumentParser(description="Voz en off por escenas, con marcas de tiempo por palabra.")
    ap.add_argument("guion", help="JSON del guion")
    ap.add_argument("--salida", required=True, help="carpeta de salida")
    ap.add_argument("--externo", help="carpeta con escena_<id>.wav ya grabados (ElevenLabs o humana)")
    ap.add_argument("--motor", choices=["edge", "sapi"], help="fuerza el motor del guion")
    a = ap.parse_args()
    guion = json.loads(Path(a.guion).read_text(encoding="utf-8"))
    if a.motor:
        guion["motor"] = a.motor
    salida = Path(a.salida)
    salida.mkdir(parents=True, exist_ok=True)
    print(f"{guion.get('id', '')} motor={guion.get('motor', 'edge')} voz={guion.get('voz', 'es-PE-CamilaNeural')}")
    m = incorporar_externo(guion, Path(a.externo), salida) if a.externo else procesar(guion, salida)
    print(f"voz_total.wav {m['total_s']:.2f} s  ->  {salida}")


if __name__ == "__main__":
    main()
