"""Genera frontend/public/data/autoridades-2022.json: quien gobierna cada region, provincia y distrito.

Fuente: JNE Infogob, Elecciones Regionales y Municipales 2022 (ERM2022), archivos
`dataset/ELECCIONES/*/ERM2022_Autoridades_*.xlsx`. Se conservan solo los cargos de ALCALDIA y
GOBERNACION (no regidores ni vicegobernadores) y por cada uno: la persona, la organizacion politica
que la llevo, su tipo y el porcentaje de votos que obtuvo la organizacion.

Lo que NO esta en los archivos se dice tal cual en el JSON (`faltan`), no se rellena:
  - Las regiones que fueron a segunda vuelta regional (el archivo regional trae 16 de 25).
  - Los distritos sin alcalde en el archivo.
Si hay un archivo `autoridades-2022-complemento.json` (llenado a mano con fuente), se suma.

Uso (desde la raiz del repo):  python backend/scripts/generar_autoridades_2022.py
"""

from __future__ import annotations

import json
import re
import unicodedata
from datetime import date
from pathlib import Path

import pandas as pd

RAIZ = Path(__file__).resolve().parents[2]
BASE = RAIZ / "dataset" / "ELECCIONES"
SALIDA = RAIZ / "frontend" / "public" / "data" / "autoridades-2022.json"
COMPLEMENTO = RAIZ / "frontend" / "public" / "data" / "autoridades-2022-complemento.json"
GEO = RAIZ / "frontend" / "public"


def norm(s: str) -> str:
    s = unicodedata.normalize("NFD", str(s)).encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Z0-9]", "", s.upper())


# La fuente viene en mayusculas y sin tildes. Para los NOMBRES DE ORGANIZACION se reponen las tildes de
# las palabras mas comunes (no se adivinan: solo esta lista); los nombres de personas quedan como vienen.
TILDES = {
    "PERU": "Perú", "DEMOCRATICO": "Democrático", "POLITICO": "Político", "ACCION": "Acción", "REGION": "Región",
    "UNION": "Unión", "RENOVACION": "Renovación", "INTEGRACION": "Integración", "JUNIN": "Junín", "MAS": "Más",
    "CIVICA": "Cívica", "ESPERANZA": "Esperanza", "PAIS": "País", "NACION": "Nación", "REPUBLICA": "República",
    "PROGRESO": "Progreso", "ALIANZA": "Alianza", "TRABAJO": "Trabajo", "ANCASH": "Áncash", "HUANUCO": "Huánuco",
    "SAN": "San", "MARTIN": "Martín", "LIBERTAD": "Libertad", "AMAZONENSE": "Amazonense", "FUERZA": "Fuerza",
    "VICTORIA": "Victoria", "RENACER": "Renacer", "UNIDAD": "Unidad", "MOVIMIENTO": "Movimiento", "PARTIDO": "Partido",
    "CONTIGO": "Contigo", "SOMOS": "Somos", "PODEMOS": "Podemos", "AVANZA": "Avanza", "FRENTE": "Frente",
    "HONRADEZ": "Honradez", "REFORMA": "Reforma", "OBRAS": "Obras", "JUNTOS": "Juntos", "POR": "por", "EL": "el",
    "DE": "de", "DEL": "del", "LA": "la", "LAS": "las", "LOS": "los", "Y": "y", "E": "e", "CON": "con", "PARA": "para",
    "COMUN": "Común", "TRANSFORMACION": "Transformación", "LIBRE": "Libre", "NACIONAL": "Nacional", "SOLIDARIDAD": "Solidaridad",
    "ACCION": "Acción", "POPULAR": "Popular", "CAMBIO": "Cambio", "FIRME": "Firme", "REGIONAL": "Regional",
}


def bonito(s: str, tildes: bool = False) -> str:
    """'JULON PEREZ JABIER' -> 'Julon Perez Jabier'. Con `tildes`, repone las de la lista TILDES."""
    peq = {"DE", "DEL", "LA", "LAS", "LOS", "Y", "E", "POR", "CON", "PARA", "EL"}
    out = []
    for i, p in enumerate(str(s).strip().split()):
        if tildes and p in TILDES and (p not in peq or i == 0 or True):
            out.append(TILDES[p] if p not in peq or i == 0 else p.lower())
        else:
            out.append(p.lower() if (p in peq and i > 0) else p.capitalize())
    return " ".join(out)


def persona(r) -> str:
    return bonito(f"{r['pre']} {r['a1']} {r['a2'] if pd.notna(r['a2']) else ''}")


def leer(ruta: str, cols: list[str]) -> pd.DataFrame:
    df = pd.read_excel(BASE / ruta)
    df.columns = cols
    return df


def main() -> None:
    dep_geo = json.loads((GEO / "peru-departments.json").read_text(encoding="utf-8"))["features"]
    prov_geo = json.loads((GEO / "peru-provinces.json").read_text(encoding="utf-8"))["features"]
    dep_cod = {norm(f["properties"]["name"]): f["properties"]["code"] for f in dep_geo}
    prov_cod: dict[tuple[str, str], str] = {}
    for f in prov_geo:
        p = f["properties"]
        prov_cod[(norm(p["departamento"]), norm(p["name"]))] = p["code"]

    # La geometria escribe distinto tres provincias (o no trae Putumayo, 1608): se unen a mano.
    for dep, prov, cod in [("ANCASH", "ANTONIO RAIMONDI", "0203"), ("ICA", "NASCA", "1103"), ("LORETO", "PUTUMAYO", "1608")]:
        prov_cod[(norm(dep), norm(prov))] = cod

    orgs: dict[str, int] = {}
    lista_orgs: list[dict] = []

    def org(nombre: str, tipo: str) -> int:
        if nombre not in orgs:
            orgs[nombre] = len(lista_orgs)
            t = {"PARTIDO POLITICO": "partido", "MOVIMIENTO REGIONAL": "movimiento", "ALIANZA ELECTORAL": "alianza"}.get(
                norm(tipo) and unicodedata.normalize("NFD", tipo).encode("ascii", "ignore").decode().upper(), "otro"
            )
            lista_orgs.append({"n": bonito(nombre, tildes=True), "t": t})
        return orgs[nombre]

    # --- regional
    r = leer(
        "REGIONAL 2022/ERM2022_Autoridades_Regional.xlsx",
        ["reg", "cargo", "a1", "a2", "pre", "org", "tipo", "sexo", "joven", "nativo", "votos", "pct"],
    )
    r = r[r.cargo == "GOBERNADOR REGIONAL"]
    regional = []
    sin_cod = []
    for _, x in r.iterrows():
        c = dep_cod.get(norm(x.reg))
        if not c:
            sin_cod.append(x.reg)
            continue
        regional.append({"u": c, "g": persona(x), "o": org(x.org, x.tipo), "p": round(float(x.pct), 4)})

    # --- provincial
    p = leer(
        "MUNICIPAL PROVINCIAL 2022/ERM2022_Autoridades_Provinciales.xlsx",
        ["reg", "prov", "cargo", "a1", "a2", "pre", "org", "tipo", "sexo", "joven", "nativo", "votos", "pct"],
    )
    p = p[p.cargo.str.startswith("ALCALDE")]
    provincial = []
    sin_prov = []
    for _, x in p.iterrows():
        c = prov_cod.get((norm(x.reg), norm(x.prov)))
        if not c:
            sin_prov.append((x.reg, x.prov))
            continue
        provincial.append({"u": c, "n": bonito(x.prov), "a": persona(x), "o": org(x.org, x.tipo), "p": round(float(x.pct), 4)})

    # --- distrital
    d = leer(
        "MUNICIPAL DISTRITAL 2022/ERM2022_Autoridades_Distrital.xlsx",
        ["reg", "prov", "dist", "cargo", "a1", "a2", "pre", "org", "tipo", "sexo", "joven", "nativo", "votos", "pct"],
    )
    d = d[d.cargo.str.startswith("ALCALDE")]
    distrital = []
    for _, x in d.iterrows():
        c = prov_cod.get((norm(x.reg), norm(x.prov)))
        distrital.append(
            {"u": c or "", "n": bonito(x.dist), "pv": bonito(x.prov), "a": persona(x), "o": org(x.org, x.tipo), "p": round(float(x.pct), 4)}
        )

    faltan_reg = sorted(set(dep_cod.values()) - {g["u"] for g in regional})
    salida = {
        "fuente": "JNE, Plataforma Electoral (Infogob), Elecciones Regionales y Municipales 2022",
        "generado": date.today().isoformat(),
        "orgs": lista_orgs,
        "regional": regional,
        "provincial": provincial,
        "distrital": distrital,
        "faltan": {"regional": faltan_reg},
    }
    if COMPLEMENTO.exists():
        comp = json.loads(COMPLEMENTO.read_text(encoding="utf-8"))
        for g in comp.get("regional", []):
            idx = org(g["org"], g.get("tipo", "PARTIDO POLITICO")) if g["org"] not in orgs else orgs[g["org"]]
            salida["regional"].append({"u": g["u"], "g": g["g"], "o": idx, "p": g.get("p"), "s": g.get("fuente", "")})
        salida["orgs"] = lista_orgs
        salida["faltan"]["regional"] = sorted(set(dep_cod.values()) - {g["u"] for g in salida["regional"]})

    SALIDA.parent.mkdir(parents=True, exist_ok=True)
    SALIDA.write_text(json.dumps(salida, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("regional", len(salida["regional"]), "faltan", salida["faltan"]["regional"])
    print("provincial", len(provincial), "sin codigo:", sin_prov)
    print("distrital", len(distrital), "sin provincia mapeada:", sum(1 for x in distrital if not x["u"]))
    print("organizaciones", len(lista_orgs), "| bytes", SALIDA.stat().st_size)
    if sin_cod:
        print("regiones sin codigo:", sin_cod)


if __name__ == "__main__":
    main()
