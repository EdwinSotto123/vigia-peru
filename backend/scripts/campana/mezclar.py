#!/usr/bin/env python3
"""Monta el video final de TikTok: toma el mp4 SILENCIOSO exportado de Moda y le pone voz en off,
música y efectos con ffmpeg.

  * La música baja (por defecto 10 dB) mientras habla la voz: compresión por sidechain, con la voz
    como disparador.
  * La mezcla se normaliza a -14 LUFS integrados con pico real de -1,5 dBTP (lo que pide TikTok),
    en dos pasadas de `loudnorm` para que el resultado sea exacto.
  * El video se copia sin recodificar si ya es h264 yuv420p; si no, se recodifica.
  * Salida: mp4 h264 + aac 192 kbps a 48 kHz estéreo, con `+faststart`. El audio del mp4 de origen
    (por ejemplo el de un video portador de Moda) se descarta.

    python mezclar.py --video silencioso.mp4 --voz voz_total.wav --musica musica_T1_30s.wav \\
        --sfx sfx_T1.json --salida final_T1.mp4

`--sfx` es un JSON con una lista de efectos: [{"archivo": "sfx_viento.wav", "t_s": 0.0, "db": -14},
{"archivo": "sfx_whoosh.wav", "t_s": 7.9, "db": -8}]. Las rutas relativas se buscan junto al JSON.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _comun import duracion, ffmpeg, lufs, sondear  # noqa: E402

OBJETIVO_LUFS = -14.0
PICO_DBTP = -1.5


def filtro_ducking(duck_db: float) -> str:
    """Compresión por sidechain: la voz dispara y la música baja. A más dB pedidos, más ratio."""
    ratio = max(4.0, min(20.0, 4 + duck_db * 1.5))
    return f"sidechaincompress=threshold=0.010:ratio={ratio:.1f}:attack=18:release=380:makeup=1:detection=rms"


def cadena_audio(d: float, hay_musica: bool, sfx: list[dict], musica_db: float, duck_db: float, fin_musica_s: float) -> tuple[list[str], int]:
    """Grafo de filtros: [1:a]=voz, [2:a]=música (si hay), [3..]=efectos. Devuelve (líneas, n entradas mezcladas)."""
    f = []
    f.append(f"[1:a]aformat=sample_rates=48000:channel_layouts=stereo,apad=whole_dur={d:.3f},atrim=0:{d:.3f},asplit=2[vozmix][vozsc]")
    entradas = ["[vozmix]"]
    if hay_musica:
        # ducking: la compresión sobre la música con la voz de disparador. ratio alto y umbral bajo para
        # que el recorte llegue a ~duck_db; el volumen base se aplica antes.
        f.append(
            f"[2:a]aformat=sample_rates=48000:channel_layouts=stereo,volume={musica_db}dB,"
            f"apad=whole_dur={d:.3f},atrim=0:{d:.3f},afade=t=out:st={max(0.0, min(d, fin_musica_s) - 1.8):.3f}:d=1.8[mus]"
        )
        f.append(f"[mus][vozsc]{filtro_ducking(duck_db)}[musduck]")
        entradas.append("[musduck]")
    else:
        f.append("[vozsc]anullsink")
    for i, e in enumerate(sfx):
        idx = 3 + i
        ms = int(round(float(e.get("t_s", 0)) * 1000))
        f.append(f"[{idx}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume={e.get('db', -10)}dB,adelay={ms}|{ms},apad=whole_dur={d:.3f},atrim=0:{d:.3f}[sfx{i}]")
        entradas.append(f"[sfx{i}]")
    f.append(f"{''.join(entradas)}amix=inputs={len(entradas)}:duration=first:normalize=0:dropout_transition=0[mezcla]")
    return f, len(entradas)


def medir_loudnorm(cmd_base: list[str], grafo: str) -> dict:
    r = subprocess.run(cmd_base + ["-filter_complex", grafo + f";[mezcla]loudnorm=I={OBJETIVO_LUFS}:TP={PICO_DBTP}:LRA=11:print_format=json[o]",
                                   "-map", "[o]", "-f", "null", "-"], capture_output=True)
    texto = r.stderr.decode("utf-8", "replace")
    m = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", texto, re.S)
    if not m:
        raise RuntimeError("No pude leer la medición de loudnorm:\n" + texto[-1200:])
    return json.loads(m.group(0))


def mezclar(video: Path, voz: Path, musica: Path | None, sfx_json: Path | None, salida: Path,
            musica_db: float = -3.0, duck_db: float = 10.0, objetivo: float = OBJETIVO_LUFS) -> dict:
    info = sondear(video)
    vs = next(s for s in info["streams"] if s["codec_type"] == "video")
    d = float(info["format"]["duration"])
    efectos = json.loads(sfx_json.read_text(encoding="utf-8")) if sfx_json else []
    for e in efectos:
        p = Path(e["archivo"])
        e["ruta"] = p if p.is_absolute() else (sfx_json.parent / p)
    cmd = [ffmpeg(), "-y", "-hide_banner", "-nostats", "-i", str(video), "-i", str(voz)]
    cmd += ["-i", str(musica)] if musica else ["-i", str(voz)]  # entrada 2 de relleno si no hay música
    for e in efectos:
        cmd += ["-i", str(e["ruta"])]
    dur_musica = duracion(musica) if musica else 0.0
    lineas, _ = cadena_audio(d, bool(musica), efectos, musica_db, duck_db, dur_musica or d)
    grafo = ";".join(lineas)

    # pasada 1: medir
    med = medir_loudnorm(cmd, grafo)
    ln = (f"loudnorm=I={objetivo}:TP={PICO_DBTP}:LRA=11:measured_I={med['input_i']}:measured_TP={med['input_tp']}:"
          f"measured_LRA={med['input_lra']}:measured_thresh={med['input_thresh']}:offset={med['target_offset']}:linear=true:print_format=summary")
    # pasada 2: aplicar
    copia = vs.get("codec_name") == "h264" and vs.get("pix_fmt") == "yuv420p"
    cmd2 = cmd + ["-filter_complex", f"{grafo};[mezcla]{ln},aresample=48000[aout]",
                  "-map", "0:v:0", "-map", "[aout]"]
    cmd2 += ["-c:v", "copy"] if copia else ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p"]
    cmd2 += ["-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-t", f"{d:.3f}", "-movflags", "+faststart", str(salida)]
    salida.parent.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(cmd2, capture_output=True)
    if r.returncode != 0:
        raise RuntimeError("ffmpeg falló en la mezcla final:\n" + r.stderr.decode("utf-8", "replace")[-2000:])
    return verificar(salida, d, objetivo, recodificado=not copia, medicion=med)


def verificar(ruta: Path, d_esperada: float, objetivo: float, recodificado: bool = False, medicion: dict | None = None) -> dict:
    info = sondear(ruta)
    v = next(s for s in info["streams"] if s["codec_type"] == "video")
    a = next((s for s in info["streams"] if s["codec_type"] == "audio"), None)
    son = lufs(ruta)
    res = {
        "archivo": str(ruta),
        "duracion_s": round(float(info["format"]["duration"]), 3),
        "video": f"{v['codec_name']} {v['width']}x{v['height']} {v.get('pix_fmt')}",
        "audio": f"{a['codec_name']} {a['sample_rate']} Hz {a['channels']} canales" if a else None,
        "sonoridad_lufs": son["integrada_lufs"],
        "pico_dbfs": son["pico_dbfs"],
        "video_recodificado": recodificado,
    }
    fallos = []
    if not a:
        fallos.append("el mp4 no tiene audio")
    if (v["width"], v["height"]) != (1080, 1920):
        fallos.append(f"resolución {v['width']}x{v['height']}, se esperaba 1080x1920")
    if v.get("pix_fmt") != "yuv420p":
        fallos.append(f"pix_fmt {v.get('pix_fmt')}, se esperaba yuv420p")
    if abs(res["duracion_s"] - d_esperada) > 0.15:
        fallos.append(f"duración {res['duracion_s']} s, se esperaba {d_esperada:.2f} s")
    if son["integrada_lufs"] is None or abs(son["integrada_lufs"] - objetivo) > 1.5:
        fallos.append(f"sonoridad {son['integrada_lufs']} LUFS, objetivo {objetivo}")
    res["ok"] = not fallos
    res["problemas"] = fallos
    return res


def main() -> None:
    ap = argparse.ArgumentParser(description="Mezcla voz, música y efectos sobre el mp4 silencioso de Moda.")
    ap.add_argument("--video", required=True, help="mp4 exportado de Moda (se ignora su audio)")
    ap.add_argument("--voz", required=True, help="voz_total.wav")
    ap.add_argument("--musica", help="WAV de la música (30 s)")
    ap.add_argument("--sfx", help="JSON con la lista de efectos")
    ap.add_argument("--salida", required=True, help="mp4 final")
    ap.add_argument("--musica-db", type=float, default=-3.0, help="volumen base de la música (dB), antes del ducking")
    ap.add_argument("--ducking-db", type=float, default=10.0, help="cuánto baja la música cuando habla la voz")
    ap.add_argument("--lufs", type=float, default=OBJETIVO_LUFS)
    a = ap.parse_args()
    res = mezclar(Path(a.video), Path(a.voz), Path(a.musica) if a.musica else None, Path(a.sfx) if a.sfx else None,
                  Path(a.salida), a.musica_db, a.ducking_db, a.lufs)
    print(json.dumps(res, ensure_ascii=False, indent=2))
    sys.exit(0 if res["ok"] else 1)


if __name__ == "__main__":
    main()
