#!/usr/bin/env python3
"""Secciones 1 a 6 de la Declaración Jurada de Intereses (DJI, Ley 31227): lo que el funcionario declara con RUC.

  1 participación patrimonial en empresas (suya o de su cónyuge)   4 empleos, asesorías y consultorías (público y privado)
  2 representaciones, poderes y mandatos                           5 organizaciones privadas (partidos, gremios, ONG)
  3 directorios y consejos                                         6 comités de selección y fondos por encargo

La sección 7 (familiares) la lee parse_dji_pdf.familiares_pdf; aquí se corta antes. Un PDF del portal DJIC puede
traer varias declaraciones (una por ejercicio y oportunidad): cada fila lleva la suya.

Cómo lee: por página, ordena por altura los títulos de sección (a veces son una fila de tabla, a veces texto suelto)
y las tablas (pdfplumber.find_tables); cada tabla es de la última sección que se abrió encima. Dentro de la tabla,
las filas se anclan en el RUC de la primera columna («R.U.C.:» y 11 dígitos, que el formato parte en dos renglones:
8 + 3) y cada palabra de las otras columnas va a la fila del ancla de arriba más cercana, como el DNI en la sección 7.

  python backend/scripts/parse_dji_intereses.py <archivo.pdf>    # imprime JSON (para revisar a mano)

PRIVACIDAD: una persona natural con negocio declara su RUC 10 (sus dígitos 3-10 son el DNI): se guarda para cruzar,
nunca se publica en claro (como todo RUC 10 del proyecto).
"""
from __future__ import annotations

import json
import re
import sys
import unicodedata

TITULOS = {
    1: re.compile(r"participaci[oó]n\s+patrimonial", re.I),
    2: re.compile(r"representaciones,?\s+poderes", re.I),
    3: re.compile(r"en\s+directorios,?\s+consejos", re.I),
    4: re.compile(r"Empleos,?\s+asesor[ií]as", re.I),
    5: re.compile(r"organizaciones\s+privadas", re.I),
    6: re.compile(r"Comit[eé]s\s+de\s+Selecci[oó]n", re.I),
    7: re.compile(r"v[ií]nculo\s+de\s+consanguinidad", re.I),
    8: re.compile(r"Otra\s+informaci[oó]n\s+relevante", re.I),
}
RE_MARCA = re.compile(r"S[ií]\s*\[\s*(X?)\s*\]\s*No\s*\[\s*(X?)\s*\]", re.I)
RE_EJERCICIO = re.compile(r"EJERCICIO:\s*(\d{4})\s+OPORTUNIDAD:\s*([A-ZÁÉÍÓÚ ]+?)\s*$", re.M)
# Quién declara: «3 Apellido Paterno : X 4 Apellido Materno : Y» y, en el renglón siguiente, «5 Nombres : Z». Un PDF del
# portal puede traer declaraciones de OTROS funcionarios de la entidad (2026-10-27: uno con 34 declaraciones de 31
# personas): cada declaración es de quien dice aquí, no del dueño del archivo.
RE_PATERNO = re.compile(r"Apellido\s+Paterno\s*:\s*(.*?)\s+4\s+Apellido\s+Materno\s*:\s*(.*?)\s*$", re.I)
RE_NOMBRES = re.compile(r"^\s*5\s+Nombres\s*:\s*(.*?)\s*$", re.I)
_norm = lambda s: re.sub(r"\s+", " ", s or "").strip().upper()


def _sin_tildes(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def es_el_mismo(persona: str | None, del_archivo: str) -> bool:
    return bool(persona) and _sin_tildes(_norm(persona)) == _sin_tildes(_norm(del_archivo))


def declarante(persona: str | None, del_archivo: str, hay_otros: bool) -> str | None:
    """A nombre de quién va una declaración: el dueño del archivo si la firma él (sin mirar tildes), quien la firma si es
    otro funcionario, y nadie (None: se descarta) si no se leyó quién la firma en un PDF que trae a otras personas."""
    if es_el_mismo(persona, del_archivo):
        return del_archivo
    if persona:
        return _norm(persona)
    return None if hay_otros else del_archivo


def persona_de(lineas: list[dict], i: int) -> str | None:
    """«PATERNO MATERNO NOMBRES» (como declarante_norm) si el renglón i es el de los apellidos y el siguiente, nombres."""
    m = RE_PATERNO.search(lineas[i]["texto"])
    if not m:
        return None
    nombres = next((RE_NOMBRES.match(l["texto"]).group(1) for l in lineas[i + 1: i + 3] if RE_NOMBRES.match(l["texto"])), "")
    p = _norm(f"{m.group(1)} {m.group(2)} {nombres}")
    return p or None


RE_FECHA = re.compile(r"(\d{1,2})/(\d{2})/(\d{4})")
RE_PERIODO = re.compile(r"(\d{1,2}/\d{2}/\d{4})\s*-\s*(\d{1,2}/\d{2}/\d{4}|Actualidad)", re.I)
# Encabezados de columna: no son filas.
RE_ENCABEZADO = re.compile(r"REGISTRO\s*\(R\.U\.C|R\.U\.C\.\s*\(Entidad|R\.U\.C\.\s*o\s*$|NOMBRE/RAZ|NOMBRE DE LA ENTIDAD|"
                           r"CARGO/POSICI|TIPO DE COMIT|NATURALEZA DE LA|^Periodo$|^Naturaleza$|Nacional/", re.I)


def _lineas(words: list[dict]) -> list[dict]:
    """Palabras → renglones (mismo top ±2), en orden de lectura."""
    filas: list[dict] = []
    for w in sorted(words, key=lambda w: (round(w["top"]), w["x0"])):
        if filas and abs(filas[-1]["top"] - w["top"]) <= 2:
            filas[-1]["ws"].append(w)
        else:
            filas.append({"top": w["top"], "ws": [w]})
    for f in filas:
        f["ws"].sort(key=lambda w: w["x0"])
        f["texto"] = " ".join(w["text"] for w in f["ws"])
    return filas


def _fecha(s: str | None) -> str | None:
    m = RE_FECHA.search(s or "")
    return f"{m.group(3)}-{m.group(2)}-{int(m.group(1)):02d}" if m else None


def _rucs(texto: str) -> list[str]:
    """Los RUC de una celda: «R.U.C.:20132023» + «540» (partido en dos renglones) → 20132023540."""
    out = []
    partes = re.split(r"R\.?\s*U\.?\s*C\.?\s*:?", texto) if "R.U.C" in texto.upper() or "RUC" in texto.upper() else [texto]
    for p in partes:
        d = re.sub(r"\D", "", p)
        if len(d) == 11 and d[:2] in ("10", "15", "16", "17", "20"):
            out.append(d)
        elif len(d) > 11:
            # dos RUC pegados sin prefijo (filas que el formato junta): de a 11
            out += [d[i:i + 11] for i in range(0, len(d) - 10, 11) if d[i:i + 2] in ("10", "15", "16", "17", "20")]
    return out


RE_LIMPIAR = re.compile(
    r"REGISTRO\s*\(R\.U\.C\.?/sin R\.U\.C\.?/otro tipo(?: de registro)?\s*\)?|de registro\s*\)?|"
    r"NOMBRE/RAZ[ÓO]N O DENOMINACI[ÓO]N SOCIAL|\(incluido[^)]*\)?|sucesiones indivisas, entre otros\)|"
    r"R\.U\.C\.\s*\(Entidad p[úu]blica u otros\)|NOMBRE DE LA ENTIDAD P[ÚU]BLICA//(?:OTROS)?|CARGO/POSICI[ÓO]N/\s*FUNCI[ÓO]N/OBJETO|"
    r"TIPO DE COMIT[ÉE]\s*/\s*TIPO DE FONDO|NATURALEZA DE LA\s*PARTICIPACI[ÓO]N|\bNaturaleza\b|\bPeriodo\b|Nacional/\s*Extranjera",
    re.I)


def _texto(ws: list[dict]) -> str:
    return " ".join(w["text"] for w in sorted(ws, key=lambda w: (round(w["top"]), w["x0"])))


def _anclas(col0: list[dict]) -> list[dict]:
    """Los RUC de la primera columna: «R.U.C.:» (o 11 dígitos) y los 1 a 3 dígitos que bajan al renglón de abajo."""
    anclas: list[dict] = []
    for w in sorted(col0, key=lambda w: (round(w["top"]), w["x0"])):
        t = w["text"]
        if re.match(r"R\.?U\.?C", t, re.I) or re.fullmatch(r"(10|15|16|17|20)\d{9}", t):
            anclas.append({"top": w["top"], "texto": t})
        elif anclas and re.fullmatch(r"\d{1,11}", t) and len(re.sub(r"\D", "", anclas[-1]["texto"])) < 11:
            anclas[-1]["texto"] += t
    return anclas


def _filas_tabla(tb, words: list[dict]) -> list[dict]:
    """Las filas de una tabla: cada fila de pdfplumber con sus celdas; si el formato juntó dos filas en una (sin raya
    entre ellas, dos RUC en la primera celda), las palabras de las otras celdas van al RUC más cercano en altura."""
    out: list[dict] = []
    for row in tb.rows:
        cols = []
        for c in row.cells:
            if not c:
                cols.append([])
                continue
            x0, top, x1, bottom = c
            cols.append([w for w in words if w["x0"] >= x0 - 1 and w["x1"] <= x1 + 1 and w["top"] >= top - 1 and w["bottom"] <= bottom + 1])
        if not cols or not any(cols):
            continue
        anclas = _anclas(cols[0])
        if len(anclas) <= 1:
            textos = [RE_LIMPIAR.sub(" ", _texto(col)).strip() for col in cols]
            textos = [re.sub(r"\s+", " ", t) for t in textos]
            if not anclas and (not any(textos[1:]) or RE_ENCABEZADO.search(" ".join(_texto(col) for col in cols))):
                continue
            out.append({"rucs": _rucs(anclas[0]["texto"]) if anclas else [], "cols": textos})
            continue
        partes = [[[] for _ in cols] for _ in anclas]
        for ci, col in enumerate(cols[1:], start=1):
            for w in col:
                i = min(range(len(anclas)), key=lambda k: abs(anclas[k]["top"] - w["top"]))
                partes[i][ci].append(w)
        for a, p in zip(anclas, partes):
            textos = [""] + [re.sub(r"\s+", " ", RE_LIMPIAR.sub(" ", _texto(col))).strip() for col in p[1:]]
            out.append({"rucs": _rucs(a["texto"]), "cols": textos})
    return out


def intereses_pdf(ruta: str) -> dict:
    """{'declaraciones': [{'ejercicio', 'oportunidad', 'persona', 'marcas': {k: 'si'|'no'}, 'filas': [{seccion, ruc,
    nombre, detalle, periodo, desde, hasta}]}]}: las filas de las secciones 1 a 6 y las marcas de la 1 a la 7.
    `persona` es quien firma esa declaración («PATERNO MATERNO NOMBRES»), que puede no ser el dueño del archivo."""
    import pdfplumber  # perezoso: sólo al leer un PDF
    decls: list[dict] = []
    actual: dict | None = None
    seccion: int | None = None
    with pdfplumber.open(ruta) as pdf:
        for pg in pdf.pages:
            words = pg.extract_words(keep_blank_chars=False, use_text_flow=False)
            if not words:
                continue
            lineas = _lineas(words)
            texto = "\n".join(l["texto"] for l in lineas)
            eventos: list[tuple[float, str, object]] = []
            for m in RE_EJERCICIO.finditer(texto):
                top = next((l["top"] for l in lineas if m.group(0).strip() in l["texto"]), 0)
                eventos.append((top - 0.5, "decl", (m.group(1), m.group(2).strip())))
            for i, l in enumerate(lineas):
                quien = persona_de(lineas, i)
                if quien:
                    eventos.append((l["top"], "persona", quien))
                    continue
                for k, rx in TITULOS.items():
                    if rx.search(l["texto"]):
                        # la marca Sí/No va en el mismo renglón o en los dos de abajo/arriba del título (partido en 3)
                        ventana = " ".join(x["texto"] for x in lineas[max(0, i - 2): i + 3])
                        mm = RE_MARCA.search(ventana)
                        marca = ("si" if mm.group(1) else "no" if mm.group(2) else None) if mm else None
                        eventos.append((l["top"], "titulo", (k, marca)))
                        break
            for tb in pg.find_tables():
                eventos.append((tb.bbox[1] + 0.1, "tabla", tb))
            for _, tipo, dato in sorted(eventos, key=lambda e: e[0]):
                if tipo == "decl":
                    actual = {"ejercicio": int(dato[0]), "oportunidad": dato[1], "persona": None, "marcas": {}, "filas": []}
                    decls.append(actual)
                    seccion = None
                elif tipo == "persona":
                    if actual is None or actual.get("persona"):
                        actual = {"ejercicio": None, "oportunidad": None, "persona": None, "marcas": {}, "filas": []}
                        decls.append(actual)
                    actual["persona"] = dato
                elif tipo == "titulo":
                    k, marca = dato
                    seccion = k
                    if actual is None:
                        actual = {"ejercicio": None, "oportunidad": None, "persona": None, "marcas": {}, "filas": []}
                        decls.append(actual)
                    # La de la 7 también: un «No» ahí es «no declaró familiares», no una falla del lector de familiares.
                    if k <= 7 and marca and k not in actual["marcas"]:
                        actual["marcas"][k] = marca
                elif tipo == "tabla" and actual is not None and seccion and 1 <= seccion <= 6:
                    if actual["marcas"].get(seccion) == "no":
                        continue
                    for f in _filas_tabla(dato, words):
                        cols = f["cols"] + ["", "", "", ""]
                        resto = " ".join(cols[1:])
                        per = RE_PERIODO.search(resto)
                        # Sin RUC ni periodo es un pedazo de otra fila o el título de la sección dentro de la tabla.
                        if not f["rucs"] and not (per and cols[1].strip()):
                            continue
                        if any(rx.search(resto) for rx in TITULOS.values()):
                            continue
                        for ruc in f["rucs"] or [None]:
                            actual["filas"].append({
                                "seccion": seccion, "ruc": ruc,
                                "nombre": RE_PERIODO.sub("", cols[1]).strip() or None,
                                "detalle": RE_PERIODO.sub("", cols[2]).strip() or None,
                                "periodo": per.group(0) if per else None,
                                "desde": _fecha(per.group(1)) if per else None,
                                "hasta": (None if per and per.group(2).lower().startswith("actual") else _fecha(per.group(2))) if per else None,
                            })
    return {"declaraciones": decls}


def main() -> None:
    print(json.dumps(intereses_pdf(sys.argv[1]), ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
