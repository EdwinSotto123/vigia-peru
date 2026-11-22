"""
Los centros de inspección técnica vehicular (CITV) autorizados por el MTC → frontend/data/car/citv.json (Gobserva Car).

El MTC publica la lista en https://rec.mtc.gob.pe/AutorizaEntiComplementarias/ArCITVConfiguracion y la deja bajar en
Excel sin captcha (`arExportToExcel`). Este script la baja (o lee un .xlsx ya bajado), la lee con la biblioteca estándar
(el .xlsx es un zip de XML: sin dependencias) y escribe un JSON con la fecha en que el MTC generó el archivo.

    python frontend/scripts/car/citv.py                 # la baja del MTC
    python frontend/scripts/car/citv.py archivo.xlsx    # usa un archivo ya bajado

Privacidad, como en el resto de Gobserva: los celulares (9 cifras que empiezan con 9) se tapan; los fijos quedan.
"""
import html
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from io import BytesIO
from pathlib import Path

URL = "https://rec.mtc.gob.pe/CentroInspeccionTecnicoVehicular/arExportToExcel?pArrParametros=%7C%7C"
SALIDA = Path(__file__).resolve().parents[2] / "data" / "car" / "citv.json"
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def filas_xlsx(datos: bytes) -> list[list[str]]:
    z = zipfile.ZipFile(BytesIO(datos))
    comunes = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).iter(f"{NS}si"):
            comunes.append("".join(t.text or "" for t in si.iter(f"{NS}t")))
    hoja = sorted(n for n in z.namelist() if n.startswith("xl/worksheets/sheet"))[0]
    filas = []
    for r in ET.fromstring(z.read(hoja)).iter(f"{NS}row"):
        fila = []
        for c in r.findall(f"{NS}c"):
            v = c.find(f"{NS}v")
            txt = (v.text if v is not None else "") or ""
            if c.get("t") == "s" and txt:
                txt = comunes[int(txt)]
            elif c.get("t") == "inlineStr":
                txt = "".join(x.text or "" for x in c.iter(f"{NS}t"))
            # El MTC deja entidades HTML en algunos textos («&quot;b&quot;»): se decodifican (dos veces: vienen dobles).
            fila.append(html.unescape(html.unescape(txt)).strip())
        filas.append(fila)
    return filas


CELULAR = re.compile(r"(?<!\d)9\d{2}[ -]?\d{3}[ -]?\d{3}(?!\d)")


def telefono(t: str) -> str | None:
    t = re.sub(r"\s+", " ", t).strip()
    return CELULAR.sub("9••••••••", t) or None


def fecha(t: str) -> str | None:
    m = re.match(r"(\d{2})/(\d{2})/(\d{4})", t)
    return f"{m[3]}-{m[2]}-{m[1]}" if m else None


def numero(t: str) -> int | None:
    t = t.strip()
    return int(float(t)) if re.fullmatch(r"\d+(\.0+)?", t) else None


def main():
    if len(sys.argv) > 1:
        datos = Path(sys.argv[1]).read_bytes()
    else:
        pedido = urllib.request.Request(URL, headers={"User-Agent": "Gobserva-datos-abiertos/1.0"})
        with urllib.request.urlopen(pedido, timeout=60) as r:
            datos = r.read()
    filas = filas_xlsx(datos)
    generado = next((re.search(r"(\d{4}-\d{2}-\d{2})", " ".join(f)) for f in filas[:3] if re.search(r"\d{4}-\d{2}-\d{2}", " ".join(f))), None)
    i = next(k for k, f in enumerate(filas) if f and f[0].upper().startswith("N") and len(f) > 5 and "RAZ" in f[1].upper())
    cab = [c.upper() for c in filas[i]]
    col = lambda nombre: next(k for k, c in enumerate(cab) if nombre in c)
    c = {
        "razon": col("RAZ"), "direccion": col("DIRECCI"), "horario": col("HORARIO"), "dep": col("DEPARTAMENTO"),
        "prov": col("PROVINCIA"), "dist": col("DISTRITO"), "tel": col("TELEFONO"), "rd": col("RD"), "fechaRd": col("FECHA RD"),
        "inicio": col("INICIO"), "lineas": col("CANTIDAD"), "tipo": col("TIPO"), "sinTrans": col("SIN TRANS"), "sancion": col("SANCI"),
    }
    centros = []
    for f in filas[i + 1:]:
        if len(f) < len(cab) or not f[c["razon"]]:
            continue
        centros.append({
            "razonSocial": f[c["razon"]],
            "direccion": f[c["direccion"]] or None,
            "horario": re.sub(r"\s{2,}", " | ", f[c["horario"]]).strip(" |") or None,
            "departamento": f[c["dep"]] or None,
            "provincia": f[c["prov"]] or None,
            "distrito": f[c["dist"]] or None,
            "telefono": telefono(f[c["tel"]]),
            "resolucion": f[c["rd"]] or None,
            "fechaResolucion": fecha(f[c["fechaRd"]]),
            "inicioOperacion": fecha(f[c["inicio"]]),
            "lineas": numero(f[c["lineas"]]),
            "tipoLineas": f[c["tipo"]] or None,
            "diasSinTransmitir": numero(f[c["sinTrans"]]),
            "sancion": f[c["sancion"]] or None,
        })
    SALIDA.parent.mkdir(parents=True, exist_ok=True)
    SALIDA.write_text(json.dumps({
        "fuente": "Centros de Inspección Técnica Vehicular autorizados (MTC)",
        "url": "https://rec.mtc.gob.pe/AutorizaEntiComplementarias/ArCITVConfiguracion",
        "generadoAl": generado[1] if generado else None,
        "centros": centros,
    }, ensure_ascii=False, indent=0), encoding="utf-8")
    print(f"{len(centros)} centros en {SALIDA} (generado por el MTC el {generado[1] if generado else '?'})")


if __name__ == "__main__":
    main()
