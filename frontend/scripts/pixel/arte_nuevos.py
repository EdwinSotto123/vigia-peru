"""Personajes y lugares de Empleo, Licitaciones y Obras (mismo método que arte.py). agregar(S, h) los suma a S."""


def agregar(S, h):
    lienzo, rect, marco, filas, capa = h["lienzo"], h["rect"], h["marco"], h["filas"], h["capa"]
    W, H = 16, 26

    def ojos(fila):
        return capa(W, H, [(5, fila, "k"), (10, fila, "k"), (5, fila + 1, "k"), (10, fila + 1, "k")])

    # ── El postulante (Empleo): pelo parado, mochila, su hoja de vida ─────────────────────────
    S["postulante"] = {"base": [
        "................",
        "....H.HH.H......",
        "...HHHHHHHHH....",
        "..HHHHHHHHHHH...",
        "..HHHHHHHHHHHH..",
        "..HHSSSSSSSSHH..",
        "..HSSSSSSSSSSH..",
        "..SSSSSSSSSSSS..",
        "..SSSSSSSSSSSS..",
        "..SSSSSSSSSSSS..",
        "...SSSSkkSSSS...",
        "....SSSSSSSS....",
        ".......SS.......",
        "....LLLSSLLL....",
        "...LkLLLLLLkL...",
        "..LLkLLLLLLkLL..",
        "..LLkLLLLLLkLL..",
        "..LLS======SLL..",
        "..LL.=CCCC=.LL..",
        "..LL.=C==C=.LL..",
        "..LL.======.LL..",
        "...LLLLLLLLLL...",
        "....========....",
        ".....==..==.....",
        ".....==..==.....",
        "....HHH..HHH....",
    ], "capas": [{"nombre": "ojos", "anim": "parpadeo", "filas": ojos(8)}]}

    # ── La emprendedora (Licitaciones): cola de caballo, mandil, una caja para entregar ────────
    S["emprendedora"] = {"base": [
        "................",
        "....HHHHHHH.....",
        "...HHHHHHHHH.HH.",
        "..HHHHHHHHHHHHH.",
        "..HHSSSSSSSHHHH.",
        "..HSSSSSSSSSHH..",
        "..HSSSSSSSSSSH..",
        "..SSSSSSSSSSSS..",
        "..SSSSSSSSSSSS..",
        "..SSSSSSSSSSSS..",
        "...SSSSkkSSSS...",
        "....SSSSSSSS....",
        ".......SS.......",
        "....LLLSSLLL....",
        "...LLCCCCCCLL...",
        "..LLLCCCCCCLLL..",
        "..LLSHHHHHHSLL..",
        "..LL.HllllH.LL..",
        "..LL.HHllHH.LL..",
        "..LL.HHHHHH.LL..",
        "...LCHHHHHHCL...",
        "...LCCCCCCCCL...",
        "....CCCCCCCC....",
        ".....SS..SS.....",
        ".....SS..SS.....",
        "....HHH..HHH....",
    ], "capas": [{"nombre": "ojos", "anim": "parpadeo", "filas": ojos(8)}]}

    # ── El obrero (Obras): casco, chaleco con franja reflectiva ───────────────────────────────
    S["obrero"] = {"base": [
        "................",
        ".....LLLLLL.....",
        "....LLLLLLLL....",
        "...LLLLlLLLLL...",
        "..LLLLLlLLLLLL..",
        ".LLLLLLLLLLLLLL.",
        "..HSSSSSSSSSSH..",
        "..SSSSSSSSSSSS..",
        "..SSSSSSSSSSSS..",
        "..SSSSSSSSSSSS..",
        "...SSSkkkkSSS...",
        "....SSSSSSSS....",
        ".......SS.......",
        "....==LSSL==....",
        "...=LLLLLLLL=...",
        "..==LLLLLLLL==..",
        "..==CCCCCCCC==..",
        "..==LLLLLLLL==..",
        "..SSLLLLLLLLSS..",
        "...=LLLLLLLL=...",
        "...==========...",
        "....========....",
        ".....==..==.....",
        ".....==..==.....",
        ".....==..==.....",
        "....HHH..HHH....",
    ], "capas": [{"nombre": "ojos", "anim": "parpadeo", "filas": ojos(7)}]}

    # ── La entidad (un edificio del Estado, con su bandera que ondea) ─────────────────────────
    W2, H2 = 34, 28
    g = lienzo(W2, H2)
    rect(g, 16, 0, 16, 7, "#")
    # Frontón.
    for k in range(5):
        y = 7 + k
        rect(g, 15 - 3 * k, y, 18 + 3 * k, y, "#")
        if k > 0:
            rect(g, 16 - 3 * k, y, 17 + 3 * k, y, "+")
            rect(g, 15 - 3 * k, y, 17 - 3 * k, y, "#")
            rect(g, 16 + 3 * k, y, 18 + 3 * k, y, "#")
    rect(g, 1, 12, 32, 12, "#")
    rect(g, 2, 13, 31, 13, "=")
    for x0 in (4, 9, 22, 27):
        rect(g, x0, 14, x0 + 2, 23, "+")
        g[14][x0] = "#"; g[14][x0 + 2] = "#"
        for y in range(14, 24):
            g[y][x0] = "#"
            g[y][x0 + 2] = "#"
    marco(g, 13, 15, 20, 23, "#")
    rect(g, 14, 16, 19, 23, "w")
    rect(g, 16, 16, 17, 23, "=")
    rect(g, 2, 24, 31, 24, "=")
    rect(g, 1, 25, 32, 25, "=")
    rect(g, 0, 26, 33, 26, "#")
    rect(g, 0, 27, 33, 27, "=")
    banderaA = capa(W2, H2, [(x, y, "L") for x in range(17, 23) for y in range(0, 3)] + [(x, 1, "w") for x in (19, 20)])
    banderaB = capa(W2, H2, [(x, y + (1 if x in (19, 20, 21, 22) else 0), "L") for x in range(17, 23) for y in range(0, 3)] + [(x, 2 if x in (19, 20) else 1, "w") for x in (19, 20)])
    S["entidad"] = {"base": filas(g), "capas": [
        {"nombre": "banderaA", "anim": "alternaA", "filas": banderaA},
        {"nombre": "banderaB", "anim": "alternaB", "filas": banderaB},
    ]}

    # ── El tablero de convocatorias (Empleo) ──────────────────────────────────────────────────
    W3, H3 = 26, 22
    g = lienzo(W3, H3)
    marco(g, 0, 0, 25, 16, "H")
    rect(g, 1, 1, 24, 15, "+")
    for (x0, y0, w, h_) in ((2, 2, 7, 6), (11, 3, 6, 5), (18, 2, 5, 7), (3, 10, 6, 5), (12, 9, 8, 5)):
        rect(g, x0, y0, x0 + w - 1, y0 + h_ - 1, "C")
        for yy in range(y0 + 2, y0 + h_ - 1, 2):
            rect(g, x0 + 1, yy, x0 + w - 2, yy, "=")
        g[y0][x0 + w // 2] = "L"
    rect(g, 3, 17, 4, 21, "H")
    rect(g, 21, 17, 22, 21, "H")
    S["tablero"] = {"base": filas(g), "capas": [
        {"nombre": "nueva", "anim": "late", "filas": capa(W3, H3, [(x, y, "L") for x in range(12, 20) for y in (9,)] + [(x, y, "L") for x in (12, 19) for y in range(9, 14)] + [(x, 13, "L") for x in range(12, 20)])},
    ]}

    # ── El camión de reparto (Licitaciones) ───────────────────────────────────────────────────
    W4, H4 = 30, 16
    g = lienzo(W4, H4)
    marco(g, 0, 1, 18, 11, "#")
    rect(g, 1, 2, 17, 10, "C")
    rect(g, 3, 5, 15, 5, "=")
    rect(g, 3, 7, 11, 7, "=")
    rect(g, 19, 4, 26, 11, "L")
    rect(g, 26, 7, 28, 11, "L")
    rect(g, 21, 5, 24, 7, "w")
    g[4][19] = "#"
    rect(g, 0, 12, 28, 12, "#")
    for cx in (4, 22):
        rect(g, cx - 1, 12, cx + 2, 15, "#")
        rect(g, cx, 13, cx + 1, 14, "=")
    S["camion"] = {"base": filas(g), "capas": []}

    # ── La grúa (Obras): la carga sube y baja ─────────────────────────────────────────────────
    W5, H5 = 32, 36
    g = lienzo(W5, H5)
    # Torre en celosía.
    for y in range(4, 35):
        g[y][8] = "#"
        g[y][11] = "#"
        if y % 3 == 0:
            rect(g, 9, y, 10, y, "=")
        elif y % 3 == 1:
            g[y][9] = "="
        else:
            g[y][10] = "="
    # Pluma y contrapluma.
    rect(g, 0, 3, 31, 3, "#")
    rect(g, 0, 5, 7, 5, "=")
    rect(g, 12, 5, 31, 5, "=")
    for x in range(1, 31, 3):
        g[4][x] = "="
    rect(g, 0, 6, 4, 9, "H")  # contrapeso
    rect(g, 8, 0, 11, 2, "L")  # cabina
    rect(g, 9, 1, 10, 1, "w")
    rect(g, 6, 35, 13, 35, "=")
    g = filas(g)
    def carga(baja):
        pts = [(26, y, "#") for y in range(6, 14 + baja)]
        pts += [(x, y, "H") for x in range(23, 30) for y in range(14 + baja, 18 + baja)]
        pts += [(x, 15 + baja, "l") for x in range(24, 29)]
        return capa(W5, H5, pts)
    S["grua"] = {"base": g, "capas": [
        {"nombre": "cargaA", "anim": "alternaA", "filas": carga(0)},
        {"nombre": "cargaB", "anim": "alternaB", "filas": carga(2)},
    ]}

    # ── La obra en curso (Obras): estructura, andamio, el piso de arriba a medias ─────────────
    W6, H6 = 26, 26
    g = lienzo(W6, H6)
    for y in (4, 11, 18, 25):
        rect(g, 2, y, 21, y, "#")
    for x in (2, 9, 15, 21):
        for y in range(4, 26):
            g[y][x] = "#"
    rect(g, 3, 12, 8, 17, "+")
    rect(g, 10, 12, 14, 17, "+")
    rect(g, 16, 19, 20, 24, "+")
    rect(g, 3, 19, 8, 24, "+")
    rect(g, 10, 19, 14, 24, "w")
    rect(g, 11, 20, 13, 24, "=")
    rect(g, 2, 2, 12, 2, "L")  # viga que llega
    for y in range(0, 26):
        g[y][24] = "="
    for y in (7, 14, 21):
        rect(g, 21, y, 25, y, "=")
    S["obra"] = {"base": filas(g), "capas": [
        {"nombre": "viga", "anim": "late", "filas": capa(W6, H6, [(x, 2, "L") for x in range(2, 13)])},
    ]}

    # ── El cono ───────────────────────────────────────────────────────────────────────────────
    S["cono"] = {"base": [
        "...LL...",
        "...LL...",
        "..LLLL..",
        "..CCCC..",
        "..LLLL..",
        ".LLLLLL.",
        ".CCCCCC.",
        ".LLLLLL.",
        "LLLLLLLL",
        "########",
    ], "capas": []}

    # ── La vigía (Vigía): anteojos de marco, saco lima y corbata, y la lupa de Gobserva en alto, con su brillo ─
    # 20 de ancho (la lupa sobresale a la derecha); la misma altura y los mismos ojos que los demás.
    S["vigia"] = {"base": [
        "....................",
        "....HHHHHHH.........",
        "...HHHHHHHHHH.......",
        "..HHHHHHHHHHHH......",
        "..HHHHHHHHSSHH......",
        "..HSSSSSSSSSSH......",
        "..S====SS====S......",
        "..S=SS====SS=S......",
        "..S=SS=SS=SS=S..LLL.",
        "..S====SS====S.LlllL",
        "...SSSSkkSSSS..LlllL",
        "....SSSSSSSS...LlllL",
        ".......SS.......LLL.",
        "....LLCSSCLL...=....",
        "...LLLCCCCLLLSS.....",
        "..LLLLCkkCLLL.......",
        "..LLLLCkkCLLL.......",
        "..LLLLCkkCLLL.......",
        "..SLLLCCCCLLL.......",
        "...LLLCCCCLLL.......",
        "...LLLLLLLLLL.......",
        "....========........",
        ".....==..==.........",
        ".....==..==.........",
        ".....==..==.........",
        "....HHH..HHH........",
    ], "capas": [
        {"nombre": "ojos", "anim": "parpadeo", "filas": capa(20, H, [(5, 7, "k"), (10, 7, "k"), (5, 8, "k"), (10, 8, "k")])},
        {"nombre": "brillo", "anim": "late", "filas": capa(20, H, [(17, 9, "C"), (16, 10, "C")])},
    ]}

    # ── Íconos de 12 x 12 (en el color de la marca) ───────────────────────────────────────────
    I = {
        "calendario": [
            "..#....#....",
            "############",
            "#++++++++++#",
            "############",
            "#+#+#+#+#+##",
            "#++++++++++#",
            "#+#+#+#+#+##",
            "#++++++++++#",
            "#+#+#+####+#",
            "#+++++#++#+#",
            "#+++++####+#",
            "############",
        ],
        "campana": [
            ".....##.....",
            "....####....",
            "...#++++#...",
            "..#++++++#..",
            "..#++++++#..",
            "..#++++++#..",
            ".#++++++++#.",
            ".#++++++++#.",
            "#++++++++++#",
            "############",
            ".....##.....",
            "............",
        ],
        "caja": [
            "............",
            "..########..",
            ".#++++#+++#.",
            "############",
            "#+++++#++++#",
            "#+++++#++++#",
            "#++++++++++#",
            "#++++++++++#",
            "#+++####+++#",
            "#++++++++++#",
            "############",
            "............",
        ],
        "lupa": [
            "..####......",
            ".#++++#.....",
            "#++....#....",
            "#+.....#....",
            "#......#....",
            "#......#....",
            ".#....#.....",
            "..####.#....",
            ".......##...",
            "........##..",
            ".........##.",
            "..........##",
        ],
        "maletin": [
            "............",
            "....####....",
            "....#..#....",
            "############",
            "#++++++++++#",
            "#++++++++++#",
            "#####++#####",
            "#++++##++++#",
            "#++++++++++#",
            "#++++++++++#",
            "############",
            "............",
        ],
    }
    for k, v in I.items():
        S["icono_" + k] = {"base": v, "capas": [], "marca": True}
