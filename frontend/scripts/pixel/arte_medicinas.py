"""Los medicamentos y los establecimientos en píxeles (Gobserva Salud, 2026-11-22; el usuario: «QUE SEA TIPO MARKETPLACE,
donde se muestre cuadros en PIXEL ART… otras secciones es solo texto plano»). Mismo método que arte.py: filas a mano,
validadas. agregar(S) los suma a S.

Todos de 18 x 16, para que una tarjeta los muestre del mismo tamaño. Los colores son los del mundo Píxel:
  #  línea      =  línea media     +  relleno tenue     C  blanco (papel, pastilla)     w  el fondo (vidrio)
  L  la marca (la cruz, lo que se toma)     l  marca tenue     H  ámbar (el frasco de jarabe)     S  naranja (cápsula)
Sin capas animadas: en una grilla de tarjetas, quietos.
"""

W, H = 18, 16


def estampar(g, x0, y0, patron):
    """Copia un dibujo de varias filas en (x0, y0); el «.» del dibujo no pinta."""
    for dy, fila in enumerate(patron):
        for dx, c in enumerate(fila):
            if c != ".":
                g[y0 + dy][x0 + dx] = c


def lienzo():
    return [["."] * W for _ in range(H)]


def filas(g):
    return ["".join(r) for r in g]


def pastilla(a, b=None):
    b = b or a
    return ["+##+", f"#{a}{a}#", f"#{a}{b}#", "+##+"]


def capsula(a, b):
    return [".########.", f"#{a*3}#{b*4}#", f"#{a*3}#{b*4}#", ".########."]


def bala(c):
    return [".##.", f"#{c}{c}#", f"#{c}{c}#", f"#{c}{c}#", f"#{c}{c}#", f"#{c}{c}#", f"#{c}{c}#", "####"]


def agregar(S):
    # ── Tabletas: un blíster de seis, una ya tomada ──────────────────────────────────────────
    g = lienzo()
    for x in range(W):
        g[3][x] = g[15][x] = "#"
    for y in range(3, 16):
        g[y][0] = g[y][17] = "#"
    for y in range(4, 15):
        for x in range(1, 17):
            g[y][x] = "+"
    for i, x in enumerate((2, 7, 12)):
        estampar(g, x, 5, pastilla("C"))
        estampar(g, x, 10, ["+==+", "=++=", "=++=", "+==+"] if i == 1 else pastilla("L", "l"))
    S["medTableta"] = {"base": filas(g), "capas": []}

    # ── Cápsulas: tres, de dos colores ───────────────────────────────────────────────────────
    g = lienzo()
    estampar(g, 1, 1, capsula("L", "C"))
    estampar(g, 7, 6, capsula("S", "C"))
    estampar(g, 2, 11, capsula("C", "L"))
    S["medCapsula"] = {"base": filas(g), "capas": []}

    # ── Jarabes y suspensiones: el frasco ámbar con su etiqueta y el vasito medidor ─────────
    S["medJarabe"] = {"base": [
        "....####..........",
        "....#==#..........",
        "....####..........",
        "....#HH#..........",
        "...#HHHH#.........",
        "..#HHHHHH#........",
        ".#HHHHHHHH#.......",
        ".#CCCCCCCC#.......",
        ".#CCCLLCCC#.......",
        ".#CCLLLLCC#..#...#",
        ".#CCCLLCCC#..#lll#",
        ".#CCCCCCCC#..#LLL#",
        ".#HHHHHHHH#..#LLL#",
        ".#HHHHHHHH#...###.",
        ".#HHHHHHHH#.......",
        ".##########.......",
    ], "capas": []}

    # ── Inyectables: el vial, la ampolla y la jeringa ────────────────────────────────────────
    S["medInyectable"] = {"base": [
        "..................",
        ".#####............",
        ".#LLL#............",
        ".#####.....#......",
        "..#=#.....#C#.....",
        ".#+++#....#C#.....",
        "#CCCCC#....#......",
        "#C===C#...#C#.....",
        "#CCCCC#..#CCC#....",
        "#+++++#..#+++#....",
        "#+++++#..#+++#....",
        "#######..#####....",
        "..................",
        "...#.#########....",
        "...###CCCLLLLL#===",
        "...#.#########....",
    ], "capas": []}

    # ── Gotas (oftálmicas, óticas, orales): el gotero y una gota ─────────────────────────────
    g = lienzo()
    estampar(g, 3, 0, [
        "....#....",
        "...#=#...",
        "...#=#...",
        "..#####..",
        "..#===#..",
        "..#####..",
        "#CCCCCCC#",
        "#CCCCCCC#",
        "#LLLLLLL#",
        "#C=C=C=C#",
        "#CCCCCCC#",
        "#+++++++#",
        "#+++++++#",
        "#+++++++#",
        "#+++++++#",
        "#########",
    ])
    estampar(g, 12, 2, ["..L..", "..L..", ".LLL.", "LLlLL", "LLLLL", ".LLL."])
    S["medGotas"] = {"base": filas(g), "capas": []}

    # ── Cremas, geles y ungüentos: el tubo ───────────────────────────────────────────────────
    S["medCrema"] = {"base": [
        "..................",
        "..................",
        "..................",
        "..................",
        "..................",
        "#############.....",
        "#+#CCCCCCCCC#.####",
        "#+#CCLLLLLCC###==#",
        "#+#CCCCCCCCC#=#==#",
        "#+#CCLLLCCCC###==#",
        "#+#CCCCCCCCC#.####",
        "#############.....",
        "..................",
        "..................",
        "..................",
        "..................",
    ], "capas": []}

    # ── Inhaladores y sprays: el inhalador con su carga y un soplo ───────────────────────────
    S["medInhalador"] = {"base": [
        "..................",
        "..................",
        "..........###.....",
        ".........#===#....",
        ".........#===#....",
        ".........#===#....",
        ".........#===#....",
        "........##===##...",
        "........#L===L#...",
        "........#LLLLL#...",
        "........#LLLLL#...",
        "..l.#####LLLLL#...",
        ".l..#LLLLLLLLL#...",
        "..l.#LLLLLLLLL#...",
        ".l..#lllLLLLLL#...",
        "....###########...",
    ], "capas": []}

    # ── Sobres (polvos y gránulos): el sobre con su borde dentado ────────────────────────────
    S["medSobre"] = {"base": [
        "..................",
        "...#.#.#.#.#.#....",
        "...###########....",
        "...#+++++++++#....",
        "...#+++++++++#....",
        "...#CCCCCCCCC#....",
        "...#CCCCLCCCC#....",
        "...#CCCLLLCCC#....",
        "...#CCCCLCCCC#....",
        "...#CCCCCCCCC#....",
        "...#C=====CCC#....",
        "...#CCCCCCCCC#....",
        "...#+++++++++#....",
        "...#+++++++++#....",
        "...###########....",
        "..................",
    ], "capas": []}

    # ── Óvulos y supositorios: tres en su bandeja ────────────────────────────────────────────
    g = lienzo()
    for i, x in enumerate((2, 7, 12)):
        estampar(g, x, 5, bala("L" if i == 1 else "C"))
    estampar(g, 0, 13, ["#++++++++++++++++#", "##################"])
    S["medOvulo"] = {"base": filas(g), "capas": []}

    # ── Lo demás (parches, champús, kits): la caja con la cruz ───────────────────────────────
    S["medCaja"] = {"base": [
        "..................",
        "..................",
        "....#############.",
        "...#+++++++++++##.",
        "..#+++++++++++#=#.",
        ".#############==#.",
        ".#CCCCCCCCCCC#==#.",
        ".#CCCCCLCCCCC#==#.",
        ".#CCCCLLLCCCC#==#.",
        ".#CCCCCLCCCCC#==#.",
        ".#CCCCCCCCCCC#==#.",
        ".#C=======CCC#==#.",
        ".#C=====CCCCC#==#.",
        ".#CCCCCCCCCCC#=#..",
        ".#CCCCCCCCCCC##...",
        ".#############....",
    ], "capas": []}

    # ── Establecimientos, para las listas: el hospital, la posta y el consultorio ───────────
    S["lugarHospital"] = {"base": [
        "........LL........",
        "......LLLLLL......",
        "......LLLLLL......",
        "........LL........",
        "..############....",
        "..#++++++++++#....",
        "..#+ww+ww+ww+#....",
        "..#+ww+ww+ww+####.",
        "..#++++++++++#++#.",
        "..#+ww+ww+ww+#ww#.",
        "..#+ww+ww+ww+#ww#.",
        "..#++++++++++#++#.",
        "..#+ww+##+ww+#ww#.",
        "..#+ww+==+ww+#ww#.",
        "..#++++==++++#++#.",
        "##################",
    ], "capas": []}
    S["lugarPosta"] = {"base": [
        "..................",
        "........##........",
        ".......#++#.......",
        "......#++++#......",
        ".....#++++++#.....",
        "....#++++++++#....",
        "...#++++++++++#...",
        "..##############..",
        "...#CCCCCCCCCC#...",
        "...#CCLCCCCCCC#...",
        "...#CLLLCCCCCC#...",
        "...#CCLCCC#=#C#...",
        "...#CCCCCC#=#C#...",
        "...#CCCCCC#=#C#...",
        "...#CCCCCC#=#C#...",
        "##################",
    ], "capas": []}
    S["lugarConsultorio"] = {"base": [
        "..................",
        "..................",
        "..##############..",
        "..#C=======CCCC#..",
        "..##############..",
        ".#LCLCLCLCLCLCLC#.",
        ".#LCLCLCLCLCLCLC#.",
        "..#++++++++++++#..",
        "..#+wwwww+#==#+#..",
        "..#+wwLww+#==#+#..",
        "..#+wLLLw+#==#+#..",
        "..#+wwLww+#==#+#..",
        "..#+wwwww+#==#+#..",
        "..#+++++++#==#+#..",
        "..#+++++++#==#+#..",
        "##################",
    ], "capas": []}

    for k in ("medTableta", "medCapsula", "medJarabe", "medInyectable", "medGotas", "medCrema", "medInhalador", "medSobre",
              "medOvulo", "medCaja", "lugarHospital", "lugarPosta", "lugarConsultorio"):
        b = S[k]["base"]
        assert len(b) == H and all(len(f) == W for f in b), (k, len(b), [len(f) for f in b])
        assert all(c in ".#=+CwLlHSk" for f in b for c in f), k
