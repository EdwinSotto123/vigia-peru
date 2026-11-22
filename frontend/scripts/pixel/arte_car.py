"""Los dibujos de Gobserva Car (2026-11-22, el usuario: «ahora vamos de car.gobserva»). Mismo método que arte.py: filas a
mano, validadas. agregar(S) los suma a S.

De 18 x 16, como los de arte_medicinas.py (una tarjeta los muestra del mismo tamaño). Colores del mundo Píxel:
  #  línea      =  línea media     +  relleno tenue     C  blanco (el faro, el tapacubos)     w  el vidrio
  L  la marca (la carrocería)
Quietos: van en grillas de tarjetas.
"""

AUTO = [
    "..................",
    "..................",
    ".....######.......",
    "....#ww#www#......",
    "...#www#wwww#.....",
    ".###############..",
    "#LLLLLLLLLLLLLLL#.",
    "#LLLLLLLLLLLLLLC#.",
    "#LLLLLLLLLLLLLLL#.",
    "##+++##LLL##+++##.",
    ".#=C=#.....#=C=#..",
    "..###.......###...",
    "..................",
    "==..==..==..==..==",
    "..................",
    "..................",
]


def agregar(S):
    assert len(AUTO) == 16 and all(len(f) == 18 for f in AUTO), "el auto no mide 18 x 16"
    S["auto"] = {"base": AUTO, "capas": []}
