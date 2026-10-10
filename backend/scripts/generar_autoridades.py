"""Genera frontend/public/data/autoridades-<anio>.json (2014, 2018 y 2022): quien gobierna cada region,
provincia y distrito segun las Elecciones Regionales y Municipales (ERM) de ese anio.

Fuente: JNE Infogob, `dataset/ELECCIONES/*/ERM<anio>_Autoridades_*.xlsx`. Se conservan solo la
gobernacion regional (en 2014 "presidencia regional") y las alcaldias provincial y distrital; no
regidores ni vicegobernadores. Por cada cargo: la persona, la organizacion politica, su tipo y el
porcentaje de votos de la organizacion.

Lo que NO esta en los archivos se dice tal cual (`faltan`), no se rellena. El archivo regional
trae solo las regiones que se decidieron en primera vuelta (22 filas en 2014, 20 en 2018, 30 en
2022, la mitad vicegobernadores): las regiones de segunda vuelta se completan con
`autoridades-<anio>-complemento.json`, escrito a mano CON FUENTE (el campo `fuente` viaja a la
pantalla). Cada complemento se contrasto contra las filas que si estaban en el archivo.

Uso (desde la raiz del repo):  python backend/scripts/generar_autoridades.py
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
DATOS = RAIZ / "frontend" / "public" / "data"
GEO = RAIZ / "frontend" / "public"

CARGO_REGIONAL = {2014: "PRESIDENTE REGIONAL", 2018: "GOBERNADOR REGIONAL", 2022: "GOBERNADOR REGIONAL"}
ARCHIVOS = {
    2014: ("REGIONAL 2014/ERM2014_Autoridades_Regional.xlsx", "MUNICIPAL PROVINCIAL 2014/ERM2014_Autoridades_Provincial.xlsx", "MUNICIPAL DISTRITAL 2014/ERM2014_Autoridades_Distrital.xlsx"),
    2018: ("REGIONAL 2018/ERM2018_Autoridades_Regional.xlsx", "MUNICIPAL PROVINCIAL 2018/ERM2018_Autoridades_Provincial.xlsx", "MUNICIPAL DISTRITAL 2018/ERM2018_Autoridades_Distrital.xlsx"),
    2022: ("REGIONAL 2022/ERM2022_Autoridades_Regional.xlsx", "MUNICIPAL PROVINCIAL 2022/ERM2022_Autoridades_Provinciales.xlsx", "MUNICIPAL DISTRITAL 2022/ERM2022_Autoridades_Distrital.xlsx"),
}

# La fuente viene en mayusculas y sin tildes. Para los NOMBRES DE ORGANIZACION se reponen las tildes de
# las palabras mas comunes (no se adivinan: solo esta lista); los nombres de personas quedan como vienen.
TILDES = {
    "PERU": "Perú", "DEMOCRATICO": "Democrático", "POLITICO": "Político", "ACCION": "Acción", "REGION": "Región",
    "UNION": "Unión", "RENOVACION": "Renovación", "INTEGRACION": "Integración", "JUNIN": "Junín", "MAS": "Más",
    "CIVICA": "Cívica", "PAIS": "País", "NACION": "Nación", "REPUBLICA": "República", "ANCASH": "Áncash",
    "HUANUCO": "Huánuco", "MARTIN": "Martín", "COMUN": "Común", "TRANSFORMACION": "Transformación",
    "AFIRMACION": "Afirmación", "CONCERTACION": "Concertación", "RECONSTRUCCION": "Reconstrucción",
    "RESTAURACION": "Restauración", "TRADICION": "Tradición", "DESCENTRALISTA": "Descentralista",
    "SOSTENIBLE": "Sostenible", "MODERNIDAD": "Modernidad", "CAMBIO": "Cambio", "FUTURO": "Futuro",
    "CIVICO": "Cívico", "PERUANO": "Peruano", "DEMOCRACIA": "Democracia", "AYACUCHO": "Ayacucho",
}
MENORES = {"DE", "DEL", "LA", "LAS", "LOS", "Y", "E", "POR", "CON", "PARA", "EL", "EN", "A"}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFD", str(s)).encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Z0-9]", "", s.upper())


def bonito(s: str, tildes: bool = False) -> str:
    out = []
    for i, p in enumerate(str(s).strip().split()):
        if p in MENORES and i > 0:
            out.append(p.lower())
        elif tildes and p in TILDES:
            out.append(TILDES[p])
        else:
            out.append(p.capitalize())
    return " ".join(out)


def persona(x) -> str:
    return bonito(f"{x['pre']} {x['a1']} {x['a2'] if pd.notna(x['a2']) else ''}")


def tipo_org(t: str) -> str:
    t = unicodedata.normalize("NFD", str(t)).encode("ascii", "ignore").decode().upper()
    return {"PARTIDO POLITICO": "partido", "MOVIMIENTO REGIONAL": "movimiento", "ALIANZA ELECTORAL": "alianza"}.get(t, "otro")


def leer(ruta: str, cols: list[str]) -> pd.DataFrame:
    df = pd.read_excel(BASE / ruta)
    df.columns = cols
    return df


def generar(anio: int) -> None:
    f_reg, f_prov, f_dist = ARCHIVOS[anio]
    dep_geo = json.loads((GEO / "peru-departments.json").read_text(encoding="utf-8"))["features"]
    prov_geo = json.loads((GEO / "peru-provinces.json").read_text(encoding="utf-8"))["features"]
    dep_cod = {norm(f["properties"]["name"]): f["properties"]["code"] for f in dep_geo}
    prov_cod: dict[tuple[str, str], str] = {
        (norm(f["properties"]["departamento"]), norm(f["properties"]["name"])): f["properties"]["code"] for f in prov_geo
    }
    # La geometria escribe distinto algunas provincias (o no trae Putumayo, 1608): se unen a mano.
    for dep, prov, cod in [
        ("ANCASH", "ANTONIO RAIMONDI", "0203"), ("ICA", "NASCA", "1103"), ("LORETO", "PUTUMAYO", "1608"),
        ("ANCASH", "ANTONIO RAYMONDI", "0203"),
    ]:
        prov_cod[(norm(dep), norm(prov))] = cod

    orgs: dict[str, int] = {}
    lista_orgs: list[dict] = []

    def org(nombre: str, tipo: str) -> int:
        if nombre not in orgs:
            orgs[nombre] = len(lista_orgs)
            lista_orgs.append({"n": bonito(nombre, tildes=True), "t": tipo_org(tipo)})
        return orgs[nombre]

    cols_r = ["reg", "cargo", "a1", "a2", "pre", "org", "tipo", "sexo", "joven", "nativo", "votos", "pct"]
    r = leer(f_reg, cols_r)
    r = r[r.cargo == CARGO_REGIONAL[anio]]
    regional = []
    for _, x in r.iterrows():
        c = dep_cod.get(norm(x.reg))
        if c:
            regional.append({"u": c, "g": persona(x), "o": org(x.org, x.tipo), "p": round(float(x.pct), 4)})

    cols_p = ["reg", "prov", "cargo", "a1", "a2", "pre", "org", "tipo", "sexo", "joven", "nativo", "votos", "pct"]
    p = leer(f_prov, cols_p)
    p = p[p.cargo.str.startswith("ALCALDE")]
    provincial, sin_prov = [], []
    for _, x in p.iterrows():
        c = prov_cod.get((norm(x.reg), norm(x.prov)))
        if not c:
            sin_prov.append((x.reg, x.prov))
            continue
        provincial.append({"u": c, "n": bonito(x.prov), "a": persona(x), "o": org(x.org, x.tipo), "p": round(float(x.pct), 4)})

    cols_d = ["reg", "prov", "dist", "cargo", "a1", "a2", "pre", "org", "tipo", "sexo", "joven", "nativo", "votos", "pct"]
    d = leer(f_dist, cols_d)
    d = d[d.cargo.str.startswith("ALCALDE")]
    distrital = []
    for _, x in d.iterrows():
        c = prov_cod.get((norm(x.reg), norm(x.prov)))
        distrital.append(
            {"u": c or "", "n": bonito(x.dist), "pv": bonito(x.prov), "a": persona(x), "o": org(x.org, x.tipo), "p": round(float(x.pct), 4)}
        )

    todas = set(dep_cod.values())
    comp_ruta = DATOS / f"autoridades-{anio}-complemento.json"
    if comp_ruta.exists():
        comp = json.loads(comp_ruta.read_text(encoding="utf-8"))
        ya = {g["u"] for g in regional}
        for g in comp.get("regional", []):
            if g["u"] in ya:
                continue  # el archivo del JNE manda
            regional.append({"u": g["u"], "g": g["g"], "o": org(g["org"], g.get("tipo", "PARTIDO POLITICO")), "p": g.get("p"), "s": g.get("fuente", "")})

    salida = {
        "anio": anio,
        "fuente": f"JNE, Plataforma Electoral (Infogob), Elecciones Regionales y Municipales {anio}",
        "generado": date.today().isoformat(),
        "orgs": lista_orgs,
        "regional": regional,
        "provincial": provincial,
        "distrital": distrital,
        "faltan": {"regional": sorted(todas - {g["u"] for g in regional})},
    }
    DATOS.mkdir(parents=True, exist_ok=True)
    destino = DATOS / f"autoridades-{anio}.json"
    destino.write_text(json.dumps(salida, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(anio, "| regional", len(regional), "faltan", salida["faltan"]["regional"], "| provincial", len(provincial), "sin codigo", sin_prov,
          "| distrital", len(distrital), "sin prov", sum(1 for x in distrital if not x["u"]), "| orgs", len(lista_orgs), "|", destino.stat().st_size, "bytes")


if __name__ == "__main__":
    for a in (2014, 2018, 2022):
        generar(a)
