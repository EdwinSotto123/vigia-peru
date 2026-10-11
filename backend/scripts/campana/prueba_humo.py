#!/usr/bin/env python3
"""Prueba de humo del pipeline de audio y montaje, de punta a punta, con un mp4 REAL exportado de Moda.

    python prueba_humo.py --video ruta/al/mp4_de_moda.mp4 [--trabajo carpeta]

Pasos (todos deben salir bien o el script termina con error):
  1. voz     generar_voz.py sobre ejemplo_guion.json (edge-tts, es-PE)
  2. música  sintetizar_musica.py T1 con la duración del video
  3. sfx     sintetizar_sfx.py (viento, whoosh)
  4. mezcla  mezclar.py: video silencioso + voz + música + efectos -> mp4 final
  5. checks  ffprobe: 1080x1920, yuv420p, audio aac, duración; sonoridad -14 LUFS +/- 1,5;
             y que la música BAJA cuando habla la voz (se mide el ducking real)
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from scipy.io import wavfile

AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI))
from _comun import duracion, ffmpeg  # noqa: E402
from mezclar import filtro_ducking, mezclar  # noqa: E402


def correr(args: list[str]) -> None:
    r = subprocess.run([sys.executable, *args], capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise SystemExit(f"Falló {' '.join(args[:2])}:\n{r.stdout[-800:]}\n{r.stderr[-800:]}")
    print(r.stdout.strip().splitlines()[-1] if r.stdout.strip() else "")


def medir_ducking(musica: Path, voz: Path, marcas: dict, duck_db: float, d: float, trabajo: Path) -> float:
    """Pasa SOLO la música por el mismo sidechain y compara su nivel con y sin voz (dB)."""
    tallo = trabajo / "musica_ducked.wav"
    grafo = (f"[1:a]aformat=sample_rates=48000:channel_layouts=stereo,apad=whole_dur={d:.3f},atrim=0:{d:.3f}[v];"
             f"[0:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=-3dB,atrim=0:{d:.3f}[m];"
             f"[m][v]{filtro_ducking(duck_db)}[o]")
    subprocess.run([ffmpeg(), "-y", "-v", "error", "-i", str(musica), "-i", str(voz), "-filter_complex", grafo, "-map", "[o]", str(tallo)], check=True)
    sr, x = wavfile.read(tallo)
    sr0, x0 = wavfile.read(musica)
    x = x.astype(float).mean(axis=1) if x.ndim > 1 else x.astype(float)
    x0 = x0.astype(float).mean(axis=1) if x0.ndim > 1 else x0.astype(float)

    def rms(a: np.ndarray, a_s: float, b_s: float, sr_: int) -> float:
        seg = a[int(a_s * sr_): int(b_s * sr_)]
        return float(np.sqrt(np.mean(seg ** 2)) + 1e-12)

    # compara el mismo tramo (durante una frase) de la música original -3 dB contra la ya comprimida
    e = marcas["escenas"][0]
    a_s, b_s = e["inicio_s"] + 0.4, e["fin_s"] - 0.2
    orig = rms(x0, a_s, b_s, sr0) * 10 ** (-3 / 20)
    duck = rms(x, a_s, b_s, sr)
    return 20 * np.log10(duck / orig)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True, help="mp4 de Moda (cualquier duración)")
    ap.add_argument("--trabajo", default=str(AQUI / "_humo"), help="carpeta de trabajo")
    ap.add_argument("--ducking-db", type=float, default=10.0)
    a = ap.parse_args()
    trabajo = Path(a.trabajo)
    trabajo.mkdir(parents=True, exist_ok=True)
    video = Path(a.video)
    d = duracion(video)
    print(f"video de entrada: {video.name}  {d:.2f} s")

    print("1/4 voz");     correr([str(AQUI / "generar_voz.py"), str(AQUI / "ejemplo_guion.json"), "--salida", str(trabajo / "voz")])
    print("2/4 música");  correr([str(AQUI / "sintetizar_musica.py"), "--pista", "T1", "--duracion", f"{d:.0f}", "--salida", str(trabajo)])
    print("3/4 efectos"); correr([str(AQUI / "sintetizar_sfx.py"), "--solo", "viento,whoosh", "--salida", str(trabajo / "sfx")])
    sfx = [{"archivo": "sfx/sfx_viento.wav", "t_s": 0.0, "db": -18}, {"archivo": "sfx/sfx_whoosh.wav", "t_s": max(0.0, d - 1.0), "db": -10}]
    (trabajo / "sfx.json").write_text(json.dumps(sfx, indent=2), encoding="utf-8")

    musica = trabajo / f"musica_T1_{int(d)}s.wav"
    voz = trabajo / "voz" / "voz_total.wav"
    marcas = json.loads((trabajo / "voz" / "marcas.json").read_text(encoding="utf-8"))
    print("4/4 mezcla")
    res = mezclar(video, voz, musica, trabajo / "sfx.json", trabajo / "final_humo.mp4", duck_db=a.ducking_db)
    print(json.dumps(res, ensure_ascii=False, indent=2))

    bajada = medir_ducking(musica, voz, marcas, a.ducking_db, d, trabajo)
    print(f"ducking medido: la música baja {abs(bajada):.1f} dB mientras habla la voz (pedido: {a.ducking_db} dB)")
    problemas = list(res["problemas"])
    if abs(bajada) < a.ducking_db * 0.6:
        problemas.append(f"el ducking medido ({abs(bajada):.1f} dB) queda por debajo de lo pedido")
    if problemas:
        raise SystemExit("PRUEBA DE HUMO FALLÓ:\n- " + "\n- ".join(problemas))
    print(f"\nPRUEBA DE HUMO OK  ->  {res['archivo']}")


if __name__ == "__main__":
    main()
