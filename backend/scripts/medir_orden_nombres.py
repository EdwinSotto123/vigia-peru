#!/usr/bin/env python3
"""Mide y regenera la tabla de pesos con que la API decide el ORDEN de un nombre (lib/pesosNombre.ts, que usa
`ordenProbable` de lib/privacidad.ts): «apellidos nombres» o «nombres apellidos». De eso depende qué apellido se tapa.

Verdad de campo: personas que están en el RNP (nombre en un solo texto) y en las órdenes de servicio
(persona_orden_anual trae ap1 y ap2 aparte), unidas por su documento. Los pesos salen del resto del padrón de órdenes
(las personas de la prueba no entran a la cuenta): por cada palabra, cuántas veces es apellido y cuántas nombre de pila.
Las partículas (DE, DEL, LA...) se pegan a la palabra que sigue.

  python -X utf8 backend/scripts/medir_orden_nombres.py              # compara la regla vieja con la de pesos
  python -X utf8 backend/scripts/medir_orden_nombres.py --escribir   # y reescribe backend/api/src/lib/pesosNombre.ts

Sólo lectura en la base (PROD por el túnel). No imprime ni escribe nombres de personas: sólo conteos y, en la tabla,
palabras sueltas con 40 usos o más. Medido el 2026-11-16: regla de 281 nombres de pila, 1,81 % de error; con pesos, 0,25 %.
"""
import json
import math
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "infrastructure" / "aws"))
from tunel_rds import conexion  # noqa: E402

ts = (RAIZ / "backend/api/src/lib/privacidad.ts").read_text(encoding="utf-8")
PILA = set(re.search(r"const PILA = new Set\(\s*`([^`]+)`", ts).group(1).split())
PART = set(re.findall(r'"([a-z]+)"', re.search(r"const PARTICULAS = new Set\(\[([^\]]+)\]", ts).group(1)))
MINIMO = 40


def norm(w: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", w.lower()) if unicodedata.category(c) != "Mn")


def palabras(s: str) -> list[str]:
    return [norm(w) for w in re.findall(r"[^\W\d_]+(?:['’-][^\W\d_]+)*", s or "")]


def actual(p, defecto="sunat"):
    if len(p) < 2:
        return defecto
    primera, ultima = p[0] in PILA, p[-1] in PILA
    tercera = len(p) >= 3 and p[2] in PILA
    if primera and not ultima:
        return "np"
    if not primera and (ultima or tercera):
        return "sunat"
    return defecto


def grupos(p: list[str]) -> list[str]:
    """La palabra principal de cada grupo: las partículas se pegan a la que sigue («de la cruz» → «cruz»)."""
    out, i = [], 0
    while i < len(p):
        j = i
        while j < len(p) - 1 and p[j] in PART:
            j += 1
        out.append(p[j])
        i = j + 1
    return out


def ruc10(dni: str) -> str:
    base = "10" + dni
    s_ = sum(int(d) * f for d, f in zip(base, (5, 4, 3, 2, 7, 6, 5, 4, 3, 2)))
    r = 11 - s_ % 11
    return base + str(0 if r == 10 else 1 if r == 11 else r)


with conexion("prod") as cn:
    cn.set_session(readonly=True, autocommit=True)
    cu = cn.cursor()
    cu.execute("SET statement_timeout = '300s'")
    cu.execute("""SELECT DISTINCT ON (numero_documento) numero_documento, nombre FROM rnp_conformacion_juridica
                   WHERE tipo_documento LIKE 'DOC. NACIONAL%' AND numero_documento ~ '^[0-9]{8}$' AND nombre !~* 'SUCESI|REPRESENTAD' LIMIT 250000""")
    por_ruc = {ruc10(d): n for d, n in cu.fetchall()}
    cu.execute("""SELECT ruc, max(nombre), max(ap1), max(ap2) FROM persona_orden_anual
                   WHERE ap1 IS NOT NULL AND ap2 IS NOT NULL AND nombre IS NOT NULL GROUP BY ruc LIMIT 700000""")
    padron = cu.fetchall()

ap, pila = Counter(), Counter()
prueba = []
for ruc, nombre, ap1, ap2 in padron:
    a1, a2 = palabras(ap1), palabras(ap2)
    if not a1 or not a2:
        continue
    if ruc in por_ruc:
        p = palabras(por_ruc[ruc])
        if len(p) >= 3:
            if p[:len(a1) + len(a2)] == a1 + a2:
                prueba.append((p, "sunat", len(a1) + len(a2)))
            elif p[-(len(a1) + len(a2)):] == a1 + a2:
                prueba.append((p, "np", len(a1) + len(a2)))
        continue                       # las personas de la prueba no entran al diccionario
    for w in a1 + a2:
        if w not in PART:
            ap[w] += 1
    for w in palabras(nombre):
        if w not in a1 and w not in a2 and w not in PART:
            pila[w] += 1
print("casos de prueba:", len(prueba), Counter(v for _, v, _ in prueba), "| con apellido compuesto:", sum(1 for p, _, n in prueba if n > 2))

W = {}
for w in set(ap) | set(pila):
    a, n = ap.get(w, 0), pila.get(w, 0)
    if a + n < MINIMO or len(w) < 2:
        continue
    v = max(-9, min(9, round(2 * math.log((a + 1) / (n + 1)))))
    if v:
        W[w] = v


def nueva(p, defecto="sunat"):
    g = grupos(p)
    if len(g) >= 3:
        w = [W.get(x, 0) for x in g]
        s = w[0] + w[1] - sum(w[2:])
        n = w[-2] + w[-1] - sum(w[:-2])
        if s != n:
            return "sunat" if s > n else "np"
    return actual(p, defecto)


def medir(regla, solo_compuestos=False):
    mal = total = 0
    for p, verdad, n_ap in prueba:
        if solo_compuestos and n_ap <= 2:
            continue
        total += 1
        mal += regla(p) != verdad
    return mal, total


for nombre_regla, regla in (("actual", actual), ("con pesos", nueva)):
    m, t = medir(regla)
    mc, tc = medir(regla, True)
    print(f"{nombre_regla:10s} orden mal {m} de {t} ({100 * m / t:.2f} %) | con apellido compuesto: {mc} de {tc} ({100 * mc / max(tc, 1):.2f} %)")
print("palabras con peso:", len(W))

if "--escribir" in sys.argv:
    por_peso: dict[int, list[str]] = {}
    for w, v in W.items():
        por_peso.setdefault(v, []).append(w)
    lineas = []
    for v in sorted(por_peso, reverse=True):
        texto = " ".join(sorted(por_peso[v]))
        trozos, linea = [], ""
        for w in texto.split(" "):
            if len(linea) + len(w) + 1 > 108:
                trozos.append(linea)
                linea = w
            else:
                linea = f"{linea} {w}".strip()
        trozos.append(linea)
        lineas.append(f'  "{v}": `' + "\n".join(trozos) + "`,")
    destino = RAIZ / "backend/api/src/lib/pesosNombre.ts"
    destino.write_text(
        "/**\n"
        " * Cuánto pesa cada palabra de un nombre como APELLIDO (positivo) o como NOMBRE DE PILA (negativo), de −9 a 9.\n"
        " *\n"
        " * Sirve a `ordenProbable` (lib/privacidad.ts) para decidir si un nombre viene «apellidos nombres» o «nombres apellidos»\n"
        " * y tapar el apellido correcto. Sale de contar, en un padrón que trae los apellidos aparte del nombre (700 mil personas\n"
        f" * con órdenes de servicio), cuántas veces cada palabra es apellido y cuántas nombre de pila: peso = 2·ln((apellido + 1) /\n"
        f" * (nombre + 1)), sólo palabras con {MINIMO} usos o más. Son palabras sueltas, no personas.\n"
        " *\n"
        " * Medido con verdad de campo (39 mil personas del RNP que no entraron a la cuenta): la regla anterior, con 281 nombres\n"
        " * de pila, erraba el orden en 1,81 % (y dejaba los dos apellidos a la vista en 1,34 %); con estos pesos, 0,25 %.\n"
        " * Se mide y se regenera con backend/scripts/medir_orden_nombres.py [--escribir] (2026-11-16).\n"
        " */\n"
        "const POR_PESO: Record<string, string> = {\n" + "\n".join(lineas) + "\n};\n\n"
        "/** palabra (sin tildes, en minúsculas) → peso. */\n"
        "export const PESO_NOMBRE = new Map<string, number>();\n"
        "for (const [peso, lista] of Object.entries(POR_PESO)) for (const w of lista.split(/\\s+/)) if (w) PESO_NOMBRE.set(w, Number(peso));\n",
        encoding="utf-8", newline="\n")
    print("escrito", destino, destino.stat().st_size, "bytes")
