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


# El volante: la licencia de conducir y las escuelas de manejo.
VOLANTE = [
    "..................",
    "......######......",
    "....##++++++##....",
    "...#++......++#...",
    "..#+..........+#..",
    "..#+..........+#..",
    ".#+............+#.",
    ".#LLLLL#CC#LLLLL#.",
    ".#LLLLL#CC#LLLLL#.",
    ".#+....#LL#....+#.",
    "..#+...#LL#...+#..",
    "..#+...#LL#...+#..",
    "...#++.#LL#.++#...",
    "....##++++++##....",
    "......######......",
    "..................",
]

# El surtidor: los talleres de conversión a gas (GNV y GLP).
SURTIDOR = [
    "..................",
    "..##########......",
    "..#CCCCCCCC#.###..",
    "..#CwwwwwwC#.#=#..",
    "..#CwwwwwwC#..#...",
    "..#CCCCCCCC#..#...",
    "..#LLLLLLLL#..#...",
    "..#LLLLLLLL#..#...",
    "..#LLLCCLLL#..#...",
    "..#LLLCCLLL#..#...",
    "..#LLLLLLLL####...",
    "..#LLLLLLLL#......",
    "..#LLLLLLLL#......",
    ".############.....",
    ".#++++++++++#.....",
    ".############.....",
]

# El cilindro de gas: su revisión periódica.
CILINDRO = [
    "..................",
    ".......####.......",
    ".......#CC#.......",
    ".....########.....",
    "....#++++++++#....",
    "...#LLLLLLLLLL#...",
    "...#LLLLLLLLLL#...",
    "...#LLCCLLLLLL#...",
    "...#LLCCLLLLLL#...",
    "...#LLLLLLLLLL#...",
    "...#LLLLLLLLLL#...",
    "...#LLLLLLLLLL#...",
    "...#LLLLLLLLLL#...",
    "....#========#....",
    ".....########.....",
    "..................",
]


def agregar(S):
    assert len(AUTO) == 16 and all(len(f) == 18 for f in AUTO), "el auto no mide 18 x 16"
    S["auto"] = {"base": AUTO, "capas": []}
    for nombre, filas in (("volante", VOLANTE), ("surtidor", SURTIDOR), ("cilindro", CILINDRO)):
        assert len(filas) == 16 and all(len(f) == 18 for f in filas), f"{nombre} no mide 18 x 16"
        S[nombre] = {"base": filas, "capas": []}
