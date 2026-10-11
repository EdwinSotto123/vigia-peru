#!/usr/bin/env python3
"""Markup de las 8 escenas de T3 'Tú también puedes mirar' (Moda). Escribe cada una en <salida>/t3_<escena>.xml."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from markup_tiktok import *  # noqa: E402,F401,F403

MAPA = "file_3F394AFMZ983D89R26TKNJNMK4"
LISTA = "file_5YTQZA67KA9FCSB5DDZG86XTDC"
FICHA = "file_12H7J6R4E79T1V7Q6NHT20J9AE"
LOGO = "file_6J6BFJA6B285WR2RAFMV9YDQMQ"

OJO_CHICO = (
    f'<path name="ojo_contorno" d="M0,60 Q60,0 120,60 Q60,120 0,60 Z" x="780" y="274" width="120" height="52" stroke="{LIMA}" stroke-width="3" opacity="0.85"/>'
    f'<ellipse name="ojo_iris" cx="840" cy="300" r="14" fill="rgba(212,255,63,0.25)" stroke="{LIMA}" stroke-width="3"/>'
    '<ellipse name="ojo_pupila" cx="842" cy="300" r="5.5" fill="#FFFFFF"/>'
)


def telefono(video: str, y: int = 350, nombre: str = "pantalla") -> str:
    return (
        f'<rectangle name="{nombre}_marco" x="297" y="{y - 8}" width="486" height="1033" corner-radius="52" fill="#151C1C" stroke="#3A4A46" stroke-width="4"/>'
        f'<video name="{nombre}" src="{video}" x="305" y="{y}" width="470" height="1017" fit="cover" corner-radius="42" muted=""/>'
    )


def escenas() -> dict[str, str]:
    e: dict[str, str] = {}
    e["e1"] = pagina(
        foto(), capas_legibilidad(), titular("Tu pueblo. Sus contratos. Un clic.", 300, 400),
        subtitulo("Tu pueblo también tiene contratos."), aviso("Historia ilustrativa. No es un caso real."), OJO_CHICO,
    )
    e["e2"] = pagina(
        foto(), capas_legibilidad(arriba=False), subtitulo("Abres Vigía. Eliges tu región."),
        aviso("Historia ilustrativa. No es un caso real.", nombre="aviso"), OJO_CHICO,
    )
    e["e3"] = pagina(
        '<rectangle name="fondo_luz" x="0" y="0" width="1080" height="1920" fill="radial-gradient(circle at 50% 40%, rgba(212,255,63,0.16) 0%, rgba(11,15,15,0) 62%)"/>',
        titular("Elige tu región.", 236, 100, 84), telefono(MAPA), subtitulo("Ves qué se contrata ahí.", y=1262, alto=150), OJO_CHICO,
    )
    e["e4"] = pagina(
        '<rectangle name="fondo_luz" x="0" y="0" width="1080" height="1920" fill="radial-gradient(circle at 50% 40%, rgba(212,255,63,0.16) 0%, rgba(11,15,15,0) 62%)"/>',
        titular("Si ya fue leído, ves sus señales.", 216, 140, 60), telefono(LISTA, y=382), subtitulo("Ves sus señales, con la ley citada.", y=1262, alto=150), OJO_CHICO,
    )
    e["e5"] = pagina(
        '<rectangle name="fondo_luz" x="0" y="0" width="1080" height="1920" fill="radial-gradient(circle at 50% 46%, rgba(212,255,63,0.18) 0%, rgba(11,15,15,0) 64%)"/>',
        titular("Una señal no es una acusación.", 250, 220, 80),
        '<rectangle name="tarjeta_marco" x="142" y="552" width="796" height="656" corner-radius="40" fill="#151C1C" stroke="#D4FF3F" stroke-width="3"/>'
        f'<video name="tarjeta" src="{FICHA}" x="150" y="560" width="780" height="640" fit="cover" corner-radius="34" muted=""/>',
        subtitulo("Una señal no acusa. Invita a revisar.", y=1262, alto=150), OJO_CHICO,
    )
    e["e6"] = pagina(
        foto(), capas_legibilidad(arriba=False), subtitulo("¿Una obra parada? Toma una foto. Puede ser anónima.", y=1158, alto=190),
        aviso("Escena ilustrativa. No es un caso real.", y=1376), OJO_CHICO,
    )
    e["e7"] = pagina(
        '<rectangle name="fondo_luz" x="0" y="0" width="1080" height="1920" fill="radial-gradient(circle at 50% 44%, rgba(212,255,63,0.14) 0%, rgba(11,15,15,0) 60%)"/>',
        bloque_peru(300, 560, 0.9, 20, 3.4, "mapa_puntos", 0.32),
        titular("Dos reportes. Confirmada.", 236, 220, 84),
        '<rectangle name="tel_a" x="190" y="640" width="250" height="470" corner-radius="38" fill="#151C1C" stroke="#6CB6FF" stroke-width="4"/>'
        '<rectangle name="tel_b" x="640" y="640" width="250" height="470" corner-radius="38" fill="#151C1C" stroke="#6CB6FF" stroke-width="4"/>'
        '<ellipse name="punto_a" cx="315" cy="840" r="30" fill="#D4FF3F"/>'
        '<ellipse name="punto_b" cx="765" cy="840" r="30" fill="#D4FF3F"/>'
        '<ellipse name="anillo" cx="540" cy="840" r="30" fill="rgba(212,255,63,0)" stroke="#D4FF3F" stroke-width="6" opacity="0"/>',
        subtitulo("Con dos reportes independientes, se confirma.", y=1262, alto=150), OJO_CHICO,
    )
    e["e8"] = pagina(
        '<rectangle name="fondo_luz" x="0" y="0" width="1080" height="1920" fill="radial-gradient(circle at 50% 32%, rgba(212,255,63,0.2) 0%, rgba(11,15,15,0) 64%)"/>',
        bloque_peru(300, 330, 0.9, 22, 3, "silueta", 0.22),
        bloque_ojo(540, 700, 520, 250, 15, "ojo_grande", 1.0),
        f'<text name="url" x="{SAFE_X - 40}" y="960" width="{SAFE_W + 80}" height="80" font-family="Inter" font-size="44" font-weight="700" color="{LIMA}" text-align="center" vertical-align="middle" max-lines="1">vigia-web.vigiaperu.workers.dev</text>',
        f'<text name="accion" x="{SAFE_X}" y="1050" width="{SAFE_W}" height="130" font-family="Space Grotesk" font-size="92" font-weight="700" color="{TINTA}" text-align="center" vertical-align="middle" max-lines="1">Busca tu distrito.</text>',
        f'<text name="firma" x="{SAFE_X}" y="1210" width="{SAFE_W}" height="90" font-family="Inter" font-size="30" font-weight="500" color="{SUAVE}" text-align="center" vertical-align="top" max-lines="2">Vigía Perú. Ojos ciudadanos para el dinero público.</text>',
        '<rectangle name="aguayo1" x="0" y="1860" width="216" height="24" fill="#B5412E"/><rectangle name="aguayo2" x="216" y="1860" width="216" height="24" fill="#D4A53C"/>'
        '<rectangle name="aguayo3" x="432" y="1860" width="216" height="24" fill="#2F7F79"/><rectangle name="aguayo4" x="648" y="1860" width="216" height="24" fill="#D4FF3F"/>'
        '<rectangle name="aguayo5" x="864" y="1860" width="216" height="24" fill="#8A3C6E"/>',
    )
    return e


if __name__ == "__main__":
    salida = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".")
    salida.mkdir(parents=True, exist_ok=True)
    for k, v in escenas().items():
        (salida / f"t3_{k}.xml").write_text(v, encoding="utf-8")
        print(k, len(v), "bytes")
