#!/usr/bin/env python3
"""Parser de la Declaración Jurada de Intereses (DJI, Ley 31227) descargada del portal público DJIC.

A diferencia del dato abierto masivo, el PDF individual SÍ trae la identidad de los parientes. De aquí sacamos:
  - Sección 7 (familiares): DNI/CE, apellidos y nombres, parentesco, ocupación y lugar de trabajo.
  - Sección 1 (empresas con participación patrimonial): razón social y RUC cuando el declarante marcó «Sí».

Entrada: el texto del PDF (pdftotext -layout, o copiado). El parentesco es vocabulario controlado, así que se usa
como ancla para separar nombre | parentesco | ocupación aunque pdftotext parta las celdas en varias líneas.

  python backend/scripts/parse_dji_pdf.py archivo.txt           # imprime JSON
  pdftotext -layout decl.pdf - | python backend/scripts/parse_dji_pdf.py -

PRIVACIDAD: el DNI de un pariente es dato de un tercero. Aguas arriba se guarda como ref HMAC (como el resto de
DNIs del proyecto), se cruza internamente y solo se publica el HECHO agregado, nunca el nombre ni el DNI.
"""
from __future__ import annotations

import json
import re
import sys

# Vocabulario de parentescos (de la nota al pie del formato DJI + las 48 categorías del dato abierto). Se prueba el
# más largo primero para que «HERMANO(A) DEL CONVIVIENTE» gane sobre «HERMANO(A)».
PARENTESCOS = [
    "MADRE DEL EXCÓNYUGE", "PADRE DEL EXCÓNYUGE", "HERMANO(A) DEL EXCÓNYUGE", "HIJO(A) DEL EXCÓNYUGE",
    "MADRE DEL CÓNYUGE", "PADRE DEL CÓNYUGE", "HERMANO(A) DEL CÓNYUGE", "HIJASTRO(A) POR PARTE DEL CÓNYUGE",
    "ABUELA MATERNA DEL CÓNYUGE", "ABUELA PATERNA DEL CÓNYUGE", "ABUELO MATERNO DEL CÓNYUGE", "ABUELO PATERNO DEL CÓNYUGE",
    "NIETASTRO(A) POR PARTE DEL CÓNYUGE",
    "MADRE DEL CONVIVIENTE", "PADRE DEL CONVIVIENTE", "HERMANO(A) DEL CONVIVIENTE", "HIJO(A) DEL CONVIVIENTE",
    "HIJO DEL CONVIVIENTE", "NIETO(A) DEL CONVIVIENTE",
    "ABUELA MATERNA DEL CONVIVIENTE", "ABUELA PATERNA DEL CONVIVIENTE", "ABUELO MATERNO DEL CONVIVIENTE", "ABUELO PATERNO DEL CONVIVIENTE",
    "ABUELA MATERNA DEL DECLARANTE", "ABUELA PATERNA DEL DECLARANTE", "ABUELO MATERNO DEL DECLARANTE", "ABUELO PATERNO DEL DECLARANTE",
    "MADRE DEL DECLARANTE", "PADRE DEL DECLARANTE", "HERMANO(A) DEL DECLARANTE",
    "HIJO(A)", "HIJO DEL EXCÓNYUGE", "NIETO(A)", "BISABUELO(A)", "TÍO(A) ABUELO(A)", "TÍO (A)", "TÍO(A)",
    "SOBRINO(A)", "PRIMO(A)", "CUÑADO(A)", "CONVIVIENTE", "CONYUGE", "CÓNYUGE", "YERNO", "NUERA",
]
# normaliza: colapsa espacios internos, mayúsculas
_norm = lambda s: re.sub(r"\s+", " ", s).strip().upper()
VOCAB = sorted({_norm(p) for p in PARENTESCOS}, key=len, reverse=True)
RE_PAR = re.compile("(" + "|".join(re.escape(p) for p in VOCAB) + ")")
RE_DOC = re.compile(r"\b(\d{6,9}|[A-Z]{1,3}\d{5,12})\b")


def grado(parentesco: str) -> str:
    p = parentesco
    if p == "HERMANO(A) DEL DECLARANTE":
        return "hermano"
    if p == "HIJO(A)":
        return "hijo"
    if p in ("PADRE DEL DECLARANTE", "MADRE DEL DECLARANTE"):
        return "padre"
    if p in ("CONYUGE", "CÓNYUGE", "CONVIVIENTE"):
        return "conyuge"
    return "otro"


def familiares(texto: str) -> list[dict]:
    t = _norm(texto)
    # el bloque de la sección 7, entre el encabezado de la tabla y la sección 8
    m = re.search(r"PARENTESCO.*?LUGAR DE TRABAJO(.*?)(?:\b8\b\s+OTRA INFORMACI|$)", t)
    bloque = m.group(1) if m else t
    out: list[dict] = []
    docs = list(RE_DOC.finditer(bloque))
    for i, d in enumerate(docs):
        resto = bloque[d.end(): docs[i + 1].start() if i + 1 < len(docs) else len(bloque)].strip()
        mp = RE_PAR.search(resto)
        if not mp:
            continue
        nombre = resto[: mp.start()].strip(" .-")
        parentesco = mp.group(1)
        cola = resto[mp.end():].strip(" .-")
        if not nombre:
            continue
        out.append({"doc": d.group(1), "nombre": nombre, "parentesco": parentesco,
                    "grado": grado(parentesco), "ocupacion_lugar": cola or None})
    return out


RE_DNI = re.compile(r"^\d{6,9}$")
RE_RUC = re.compile(r"\b(10|15|16|17|20)\d{9}\b")
# fronteras de columna (x0) del formato DJI; derivadas del encabezado de la sección 7
COL1_FIN, COL2_FIN, COL3_FIN = 108, 250, 345


def familiares_pdf(ruta: str) -> list[dict]:
    """Extrae la sección 7 (familiares) por coordenadas: ancla en el DNI (col1), cada palabra se asigna a la
    fila del DNI más cercano. Robusto ante el parentesco que envuelve en dos líneas y ante celdas pegadas."""
    import pdfplumber  # import perezoso: solo si se parsea un PDF
    vistos: dict[str, dict] = {}
    with pdfplumber.open(ruta) as pdf:
        for pg in pdf.pages:
            txt = pg.extract_text() or ""
            if "LUGAR DE TRABAJO" not in txt and "vínculo de consanguinidad" not in txt:
                continue
            ws = pg.extract_words(use_text_flow=False, keep_blank_chars=False)
            anclas = [w for w in ws if w["x0"] < COL1_FIN and RE_DNI.match(w["text"])]
            if not anclas:
                continue
            tops = sorted(a["top"] for a in anclas)
            for a in anclas:
                t = a["top"]
                nombre, parent = [], []
                for w in ws:
                    if w is a or w["x0"] < COL1_FIN:
                        continue
                    # a la fila del DNI (top) más cercano, y que sea ESTE
                    cerca = min(tops, key=lambda tt: abs(tt - w["top"]))
                    if cerca != t or abs(w["top"] - t) > 11:
                        continue
                    if w["x0"] < COL2_FIN:
                        nombre.append((round(w["top"]), w["x0"], w["text"]))
                    elif w["x0"] < COL3_FIN:
                        parent.append((round(w["top"]), w["x0"], w["text"]))
                nom = " ".join(x[2] for x in sorted(nombre))             # orden de lectura: (top, x0)
                par_txt = _norm(" ".join(x[2] for x in sorted(parent)))
                mp = RE_PAR.search(par_txt)
                parentesco = mp.group(1) if mp else (par_txt or None)
                doc = a["text"]
                if doc not in vistos and nom:
                    vistos[doc] = {"doc": doc, "nombre": nom, "parentesco": parentesco,
                                   "grado": grado(parentesco) if parentesco else "otro"}
    return list(vistos.values())


def empresas_pdf(ruta: str) -> list[str]:
    """RUCs declarados en la sección 1 (participación patrimonial). Best-effort: RUCs en páginas de la sección 1."""
    import pdfplumber
    rucs: set[str] = set()
    with pdfplumber.open(ruta) as pdf:
        for pg in pdf.pages:
            txt = pg.extract_text() or ""
            if "participaci" in txt.lower() and "patrimonial" in txt.lower():
                rucs.update(RE_RUC.findall(txt.replace(" ", "")))
    return sorted(rucs)


def main() -> None:
    ruta = sys.argv[1] if len(sys.argv) > 1 else "-"
    if ruta.lower().endswith(".pdf"):
        fams = familiares_pdf(ruta)
        emp = empresas_pdf(ruta)
        print(json.dumps({"familiares": fams, "n": len(fams), "empresas_ruc": emp}, ensure_ascii=False, indent=2))
        return
    texto = sys.stdin.read() if ruta == "-" else open(ruta, encoding="utf-8", errors="replace").read()
    fams = familiares(texto)
    print(json.dumps({"familiares": fams, "n": len(fams)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
