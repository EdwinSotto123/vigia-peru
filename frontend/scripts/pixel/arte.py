"""Los personajes, lugares e íconos de píxeles de Gobserva: la fuente del arte. Valida las filas, dibuja una hoja de
contacto (en la carpeta temporal) y escribe frontend/components/pixel/sprites.ts y el personajes.js de la portada de
gobserva.cloud. Uso: python frontend/scripts/pixel/arte.py (necesita Pillow).
Paleta: '.' vacío, '#' tinta, '=' tinta media, '+' tinta tenue (piel, relleno), 'L' marca, 'l' marca tenue, 'w' fondo."""
import json, sys, pathlib, tempfile
from PIL import Image, ImageDraw


def lienzo(w, h):
    return [["."] * w for _ in range(h)]


def rect(g, x0, y0, x1, y1, c):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            g[y][x] = c


def marco(g, x0, y0, x1, y1, c):
    for x in range(x0, x1 + 1):
        g[y0][x] = c
        g[y1][x] = c
    for y in range(y0, y1 + 1):
        g[y][x0] = c
        g[y][x1] = c


def filas(g):
    return ["".join(r) for r in g]


def capa(w, h, puntos):
    g = lienzo(w, h)
    for (x, y, c) in puntos:
        g[y][x] = c
    return filas(g)


S = {}

# ── La vecina, con su celular ─────────────────────────────────────────────────────────────────
vecina = [
    ".....HHHHHH.....",
    "...HHHHHHHHHH...",
    "..HHHHHHHHHHHH..",
    "..HHHHSSSSHHHH..",
    "..HHSSSSSSSSHH..",
    ".HHHSSSSSSSSHHH.",
    ".HHSSSSSSSSSSHH.",
    ".HHSSSSSSSSSSHH.",
    ".HHSSSSSSSSSSHH.",
    ".HHSSSkSSkSSSHH.",
    "..HSSSSkkSSSSH..",
    "..HHSSSSSSSSHH..",
    "...HH.SSSS.HH...",
    ".......SS.......",
    "....LLLSSLLL....",
    "...LLLLLLLLLL...",
    "..LLLLLLLLLLLL..",
    "..LLSkkkkkkSLL..",
    "..LLSkllllkSLL..",
    "..LLLkllllkLLL..",
    "..LLLkkkkkkLLL..",
    "...LLLLLLLLLL...",
    "...LLLLLLLLLL...",
    "....LLLLLLLL....",
    ".....SS..SS.....",
    ".....HH..HH.....",
]
W, H = 16, len(vecina)
S["vecina"] = {"base": vecina, "capas": [
    {"nombre": "ojos", "anim": "parpadeo", "filas": capa(W, H, [(5, 7, "k"), (10, 7, "k"), (5, 8, "k"), (10, 8, "k")])},
    {"nombre": "pantalla", "anim": "late", "filas": capa(W, H, [(x, y, "L") for x in range(6, 10) for y in (18, 19)])},
]}

# Caminando: la misma vecina, las piernas alternan.
camina = vecina[:24] + ["................", "................"]
S["vecinaCamina"] = {"base": camina, "capas": [
    {"nombre": "ojos", "anim": "parpadeo", "filas": S["vecina"]["capas"][0]["filas"]},
    {"nombre": "pantalla", "anim": "late", "filas": S["vecina"]["capas"][1]["filas"]},
    {"nombre": "pasoA", "anim": "alternaA", "filas": capa(W, H, [(5, 24, "S"), (6, 24, "S"), (9, 24, "S"), (10, 24, "S"),
                                                               (5, 25, "H"), (6, 25, "H"), (10, 25, "H"), (11, 25, "H")])},
    {"nombre": "pasoB", "anim": "alternaB", "filas": capa(W, H, [(5, 24, "S"), (6, 24, "S"), (9, 24, "S"), (10, 24, "S"),
                                                               (4, 25, "H"), (5, 25, "H"), (9, 25, "H"), (10, 25, "H")])},
]}

# ── La doctora: saluda ────────────────────────────────────────────────────────────────────────
doctora = [
    "....HHHHHHHH....",
    "...HHHHHHHHHH...",
    "..HHHHHHHHHHHH..",
    "..HHHSSSSSHHHH..",
    "..HHSSSSSSSSSH..",
    "..HSSSSSSSSSSH..",
    "..HSSSSSSSSSSH..",
    "..HSSSSSSSSSSH..",
    "..HSSSkSSkSSSH..",
    "...SSSSkkSSSS...",
    "....SSSSSSSS....",
    ".......SS.......",
    "....==CLLC==....",
    "..==CCkLLkCC=...",
    "..=C=kCLLCCC=...",
    "..=C=kCLLCCC=...",
    "..=C=kCLLCLL=...",
    "..=C=LCLLCCC=...",
    "..=C=CCLLCCC=...",
    "..=C=CCCCCCC=...",
    "..SS=CCCCCCC=...",
    "....========....",
    ".....==..==.....",
    ".....==..==.....",
    ".....==..==.....",
    "....HHH..HHH....",
]
W, H = 16, len(doctora)
abajo = [(13, y, "C") for y in range(13, 20)] + [(13, 20, "S"), (14, 20, "S")]
arriba = [(13, 12, "C"), (14, 11, "C"), (14, 10, "C"), (14, 9, "C"), (14, 8, "C"), (14, 7, "C"),
          (14, 6, "S"), (15, 6, "S"), (14, 5, "S"), (15, 5, "S")]
S["doctora"] = {"base": doctora, "capas": [
    {"nombre": "ojos", "anim": "parpadeo", "filas": capa(W, H, [(5, 6, "k"), (10, 6, "k"), (5, 7, "k"), (10, 7, "k")])},
    {"nombre": "brazoAbajo", "anim": "saludaA", "filas": capa(W, H, abajo)},
    {"nombre": "brazoArriba", "anim": "saludaB", "filas": capa(W, H, arriba)},
]}

# ── La clínica ───────────────────────────────────────────────────────────────────────────────
W, H = 34, 28
g = lienzo(W, H)
marco(g, 13, 0, 20, 7, "#")
rect(g, 14, 1, 19, 6, "+")
rect(g, 16, 1, 17, 6, "l")
rect(g, 14, 3, 19, 4, "l")
rect(g, 16, 8, 17, 8, "#")
rect(g, 1, 9, 32, 9, "#")
rect(g, 0, 10, 33, 10, "#")
rect(g, 2, 11, 31, 26, "+")
for y in range(11, 27):
    g[y][2] = "#"
    g[y][31] = "#"
for x0 in (4, 10, 20, 26):
    marco(g, x0, 13, x0 + 3, 16, "#")
    rect(g, x0 + 1, 14, x0 + 2, 15, "w")
for x0 in (4, 26):
    marco(g, x0, 19, x0 + 3, 22, "#")
    rect(g, x0 + 1, 20, x0 + 2, 21, "w")
rect(g, 12, 17, 21, 17, "L")
marco(g, 13, 18, 20, 26, "#")
rect(g, 14, 19, 16, 26, "w")
rect(g, 17, 19, 19, 26, "w")
rect(g, 16, 19, 17, 26, "#")
g[22][15] = "="
g[22][18] = "="
rect(g, 0, 27, 33, 27, "=")
clinica = filas(g)
cruz = capa(W, H, [(x, y, "L") for x in (16, 17) for y in range(1, 7)] + [(x, y, "L") for x in range(14, 20) for y in (3, 4)])
S["clinica"] = {"base": clinica, "capas": [{"nombre": "cruz", "anim": "late", "filas": cruz}]}

# ── Íconos de 12 x 12 (en el color de la marca: '#' fuerte, '+' tenue) ────────────────────────
I = {
    "emergencia": [
        "............",
        "#..........#",
        ".#..####..#.",
        "....#++#....",
        ".####++####.",
        ".#++++++++#.",
        ".#++++++++#.",
        ".####++####.",
        "....#++#....",
        ".#..####..#.",
        "#..........#",
        "............",
    ],
    "dientes": [
        "............",
        "..###..###..",
        ".#+++##+++#.",
        ".#++++++++#.",
        ".#++++++++#.",
        ".#++++++++#.",
        "..#++++++#..",
        "..#++##++#..",
        "..#++##++#..",
        "..#+#..#+#..",
        "..##....##..",
        "............",
    ],
    "parto": [
        "....##......",
        "...#++#.....",
        "...#++#.....",
        "....##......",
        "...#++#.....",
        "..#++++#....",
        "..#+++++#...",
        "..#++++++#..",
        "..#+++++++#.",
        "..#++++++#..",
        "...#++++#...",
        "...##..##...",
    ],
    "ninos": [
        ".....##.....",
        "....#..#....",
        "...######...",
        "..#++++++#..",
        ".#++++++++#.",
        ".#+##++##+#.",
        ".#++++++++#.",
        "##+#++++#+##",
        ".#++####++#.",
        "..#++++++#..",
        "...######...",
        "............",
    ],
    "ojos": [
        "............",
        "............",
        "....####....",
        "..##++++##..",
        ".#+++##+++#.",
        "#+++####+++#",
        "#+++####+++#",
        ".#+++##+++#.",
        "..##++++##..",
        "....####....",
        "............",
        "............",
    ],
    "piel": [
        "....#.#.....",
        "...#+#+#.#..",
        "...#+#+##+#.",
        "...#+#+#+#..",
        "...#++++++#.",
        ".#.#+++++#..",
        "#+##+++++#..",
        ".#++++++#...",
        "..#+++++#...",
        "...#+++#....",
        "...#+++#....",
        "...#####....",
    ],
    "corazon": [
        "............",
        ".###....###.",
        "#+++#..#+++#",
        "#++++##++++#",
        "#++++++++++#",
        "#++++++++++#",
        ".#++++++++#.",
        "..#++++++#..",
        "...#++++#...",
        "....#++#....",
        ".....##.....",
        "............",
    ],
    "huesos": [
        "............",
        ".##......##.",
        "#++#....#++#",
        "#+++#..#+++#",
        ".#+++##+++#.",
        "..#++++++#..",
        "..#++++++#..",
        ".#+++##+++#.",
        "#+++#..#+++#",
        "#++#....#++#",
        ".##......##.",
        "............",
    ],
    "mental": [
        "....####....",
        "..##++++##..",
        ".#+++##+++#.",
        "#+++#++#+++#",
        "#++#+++#+++#",
        "#+++#++++#+#",
        "#++++#++#++#",
        ".#+++#+#++#.",
        "..##+++++#..",
        "....##+##...",
        "......##....",
        "............",
    ],
    "analisis": [
        "...######...",
        "....#++#....",
        "....#++#....",
        "....#++#....",
        "....#++#....",
        "...#++++#...",
        "...#####+#..",
        "..#######+#.",
        "..#+######.#",
        "..#+######.#",
        "...#+####.#.",
        "....######..",
    ],
    "imagenes": [
        "############",
        "#++++++++++#",
        "#+++####+++#",
        "#+#+#++#+#+#",
        "#+#++##++#+#",
        "#+#+#++#+#+#",
        "#+#++##++#+#",
        "#+#+#++#+#+#",
        "#++++##++++#",
        "#++++##++++#",
        "#++++++++++#",
        "############",
    ],
    "operacion": [
        "##.......##.",
        "#+#.....#+#.",
        ".#+#...#+#..",
        "..#+#.#+#...",
        "...#+#+#....",
        "....#+#.....",
        "...#+#+#....",
        "..###.###...",
        ".#+++#+++#..",
        ".#+++#+++#..",
        "..###.###...",
        "............",
    ],
}
for k, v in I.items():
    S["icono_" + k] = {"base": v, "capas": [], "marca": True}

# Chequeo (7 x 7) y pregunta (7 x 9) de la burbuja.
S["chequeo"] = {"base": [
    "......L",
    ".....LL",
    "L...LL.",
    "LL.LL..",
    ".LLL...",
    "..L....",
    ".......",
], "capas": []}
S["pregunta"] = {"base": [
    ".#####.",
    "##...##",
    ".....##",
    "....##.",
    "...##..",
    "...##..",
    ".......",
    "...##..",
    "...##..",
], "capas": []}
# El alfiler de la ubicación (11 x 14).
S["alfiler"] = {"base": [
    "...#####...",
    ".##LLLLL##.",
    ".#LLLLLLL#.",
    "#LLL###LLL#",
    "#LL#www#LL#",
    "#LL#www#LL#",
    "#LLL###LLL#",
    ".#LLLLLLL#.",
    ".##LLLLL##.",
    "..#LLLLL#..",
    "...#LLL#...",
    "....#L#....",
    ".....#.....",
    "...=====...",
], "capas": []}
# El carnet (colegiatura) 16 x 11.
S["carnet"] = {"base": [
    "################",
    "#LLLLLLLLLLLLLL#",
    "#++++++++++++++#",
    "#+####+++++++++#",
    "#+#++#+=======+#",
    "#+#++#+++++++++#",
    "#+####+=====+++#",
    "#+#..#+++++++++#",
    "#++++++LLL+====#",
    "#++++++++++++++#",
    "################",
], "capas": []}
# El documento sellado (registro) 12 x 14.
S["documento"] = {"base": [
    "#########...",
    "#+++++++##..",
    "#+=====+#+#.",
    "#+++++++####",
    "#+=======++#",
    "#++++++++++#",
    "#+=======++#",
    "#++++++++++#",
    "#+=====++++#",
    "#++++++LLL+#",
    "#+++++L+++L#",
    "#+++++L+L+L#",
    "#++++++LLL+#",
    "############",
], "capas": []}

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import arte_nuevos
import arte_medicinas
import arte_car
arte_nuevos.agregar(S, {"lienzo": lienzo, "rect": rect, "marco": marco, "filas": filas, "capa": capa})
arte_medicinas.agregar(S)  # los medicamentos y los establecimientos de Salud (arte_medicinas.py)
arte_car.agregar(S)  # el auto de Gobserva Car (arte_car.py)

# ── Validar ──────────────────────────────────────────────────────────────────────────────────
ok = True
for k, s in S.items():
    ws = {len(r) for r in s["base"]}
    if len(ws) != 1:
        print("ANCHO MALO", k, ws)
        ok = False
    for c in s["capas"]:
        if len(c["filas"]) != len(s["base"]) or {len(r) for r in c["filas"]} != ws:
            print("CAPA MALA", k, c["nombre"])
            ok = False
    for r in s["base"]:
        if set(r) - set(".#=+LlwSHkC"):
            print("CARACTER MALO", k, r)
            ok = False
if not ok:
    sys.exit(1)


# ── Hoja de contacto (claro y oscuro) ────────────────────────────────────────────────────────
def color(c, oscuro, marca=False):
    ink = (231, 240, 238) if oscuro else (30, 33, 33)
    paper = (11, 15, 15) if oscuro else (255, 255, 255)
    acc = (212, 255, 63) if oscuro else (47, 107, 16)

    def mez(a, t):
        return tuple(round(paper[i] * (1 - t) + a[i] * t) for i in range(3))
    if marca and c in "#+":
        c = "L" if c == "#" else "l"
    return {"#": ink, "=": mez(ink, .5), "+": mez(ink, .22), "L": acc, "l": mez(acc, .45), "w": paper,
            "S": (201, 142, 95), "H": (139, 100, 74) if oscuro else (52, 38, 30), "k": (40, 28, 22),
            "C": (220, 230, 227) if oscuro else (250, 251, 251)}.get(c)


def dibuja(s, oscuro, esc, ocultar=("alternaB", "saludaB")):
    b = s["base"]
    w, h = len(b[0]), len(b)
    im = Image.new("RGB", (w * esc, h * esc), (11, 15, 15) if oscuro else (255, 255, 255))
    d = ImageDraw.Draw(im)
    for fs in [b] + [c["filas"] for c in s["capas"] if c["anim"] not in ocultar]:
        for y, r in enumerate(fs):
            for x, c in enumerate(r):
                if c != ".":
                    d.rectangle([x * esc, y * esc, x * esc + esc - 1, y * esc + esc - 1], fill=color(c, oscuro, s.get("marca")))
    return im


out = pathlib.Path(tempfile.gettempdir()) / "pixel-gobserva"
out.mkdir(exist_ok=True)
for oscuro in (False, True):
    piezas = [dibuja(s, oscuro, 8) for s in S.values()]
    H2 = max(p.height for p in piezas) + 20
    hoja = Image.new("RGB", (1800, H2 * 7), (11, 15, 15) if oscuro else (240, 240, 236))
    x = y = 10
    for p in piezas:
        if x + p.width > 1790:
            x = 10
            y += H2
        hoja.paste(p, (x, y))
        x += p.width + 20
    hoja.save(out / f"hoja_{'noche' if oscuro else 'dia'}.png")
dibuja(S["doctora"], True, 8, ocultar=("saludaA",)).save(out / "doctora_saluda.png")
(out / "sprites.json").write_text(json.dumps(S, ensure_ascii=False), encoding="utf-8")
print("ok", len(S), "sprites; hoja de contacto en", out)
if __name__ == "__main__":
    import generar_ts  # noqa: F401  escribe frontend/components/pixel/sprites.ts
    import generar_worker  # noqa: F401  escribe el personajes.js de gobserva.cloud
