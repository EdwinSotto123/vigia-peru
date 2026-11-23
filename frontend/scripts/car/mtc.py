"""
Las listas de autorizados del MTC que usa Gobserva Car, además de los CITV (citv.py) → frontend/data/car/licencia.json y
frontend/data/car/gas.json.

El MTC publica cada lista en rec.mtc.gob.pe y la deja bajar en Excel sin captcha (`arExportToExcel`, el mismo botón
«Exportar» de su página). Se leen con la biblioteca estándar (filas_xlsx de citv.py).

  Licencia de conducir (rec.mtc.gob.pe/LicenciaConducir/…): centros médicos, centros de evaluación y escuelas de conductores.
  Gas vehicular (rec.mtc.gob.pe/AutorizaEntiComplementarias/…): talleres de conversión a GNV y a GLP, entidades
  certificadoras de GNV y de GLP, y centros de revisión periódica de cilindros.

    python frontend/scripts/car/mtc.py                    # las baja del MTC
    python frontend/scripts/car/mtc.py carpeta/           # usa los .xlsx ya bajados (mismos nombres que CLAVES)

Desde el 2026-11-22 lo hace solo, cada lunes, la fuente `mtc_car` del worker de scrapers
(backend/scrapers-worker/src/fuentes/mtc_car.ts, mismas salidas), que las publica en R2 y la web las lee de ahí
(frontend/lib/car-datos.ts). Este script queda para regenerar a mano el respaldo de frontend/data/car.

Privacidad, como en el resto de Gobserva: no se guarda el RUC; el nombre de una persona natural (RUC 10) no se guarda;
los celulares se tapan; los correos no se guardan.
"""
import json
import re
import sys
import time
import unicodedata
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from citv import fecha, filas_xlsx, telefono  # noqa: E402

BASE = "https://rec.mtc.gob.pe"
DATOS = Path(__file__).resolve().parents[2] / "data" / "car"

# clave: (ruta del Excel, parámetros, página pública del MTC)
LISTAS = {
    "medicos": ("/CentroMedico/arExportToExcel", "||", "/LicenciaConducir/ArCentroMedicoConfiguracion"),
    "evaluacion": ("/CentroEvaluacion/arExportToExcel", "||", "/LicenciaConducir/ArCentroEvaluacionConfiguracion"),
    "escuelas": ("/EscuelaConductor/arExportToExcel", "||", "/LicenciaConducir/ArEscuelaConductorConfiguracion"),
    "talleres-gnv": ("/TallerConversionGNVGLP/arExportToExcel", "1|||", "/AutorizaEntiComplementarias/ArTallerConversionGNVGLP"),
    "talleres-glp": ("/TallerConversionGNVGLP/arExportToExcel", "2|||", "/AutorizaEntiComplementarias/ArTallerConversionGNVGLP"),
    "certificadoras-gnv": ("/EntidadCertificadoraGNVGLP/arExportToExcel", "1|||", "/AutorizaEntiComplementarias/ArEntidadCertificadoraGNVGLP"),
    "certificadoras-glp": ("/EntidadCertificadoraGNVGLP/arExportToExcel", "2|||", "/AutorizaEntiComplementarias/ArEntidadCertificadoraGNVGLP"),
    "cilindros": ("/CentroRevisionPeriodicaCilindro/arExportToExcel", "||", "/CentroRevisionPeriodicaCilindro/ArAutorizados"),
}


def bajar(clave: str, carpeta: Path | None) -> bytes:
    if carpeta:
        return (carpeta / f"{clave}.xlsx").read_bytes()
    ruta, params, _ = LISTAS[clave]
    url = f"{BASE}{ruta}?pArrParametros={urllib.request.quote(params)}"
    pedido = urllib.request.Request(url, headers={"User-Agent": "Gobserva-datos-abiertos/1.0"})
    with urllib.request.urlopen(pedido, timeout=90) as r:
        datos = r.read()
    time.sleep(1)  # sin apuro: una lista por segundo
    return datos


def sin_tildes(t: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", t) if unicodedata.category(c) != "Mn").upper().strip()


def lugar(t: str) -> str | None:
    t = re.sub(r"\s+", " ", sin_tildes(t))
    return t or None


def leer(datos: bytes) -> tuple[str | None, list[dict]]:
    """Las filas como diccionarios con las cabeceras normalizadas (sin tildes, en mayúsculas) y la fecha del archivo."""
    filas = filas_xlsx(datos)
    generado = None
    for f in filas[:3]:
        m = re.search(r"(\d{4}-\d{2}-\d{2})", " ".join(f))
        if m:
            generado = m[1]
            break
    i = next(k for k, f in enumerate(filas) if f and any("RAZ" in sin_tildes(c) for c in f))
    cab = [sin_tildes(c) for c in filas[i]]
    salida = []
    for f in filas[i + 1:]:
        if not any(f):
            continue
        salida.append({cab[k]: (f[k] if k < len(f) else "") for k in range(len(cab))})
    return generado, salida


def col(fila: dict, *nombres: str) -> str:
    for n in nombres:
        for k, v in fila.items():
            if n in k:
                return v.strip()
    return ""


def item(fila: dict) -> dict | None:
    nombre = re.sub(r"\s+", " ", col(fila, "RAZON SOCIAL"))
    if not nombre:
        return None
    ruc = re.sub(r"\D", "", col(fila, "RUC"))
    return {
        # Una persona natural con negocio (RUC 10): su nombre no se guarda.
        "nombre": None if ruc.startswith("10") else nombre,
        "direccion": re.sub(r"\s+", " ", col(fila, "DIRECCION")) or None,
        # El MTC pone «LIMA-CALLAO» a los locales del Callao en una de sus listas: van con su región, el Callao.
        "departamento": "CALLAO" if lugar(col(fila, "PROVINCIA")) == "CALLAO" else lugar(col(fila, "DEPARTAMENTO")),
        "provincia": lugar(col(fila, "PROVINCIA")),
        "distrito": lugar(col(fila, "DISTRITO")),
        "telefono": telefono(col(fila, "TELEFONO")),
        "resolucion": re.sub(r"\s+", " ", col(fila, "RESOLUCION")) or None,
        "fechaResolucion": fecha(col(fila, "FECHA")),
    }


def limpio(d: dict) -> dict:
    return {k: v for k, v in d.items() if v not in (None, "", [])}


def juntar(gnv: list[dict], glp: list[dict]) -> list[dict]:
    """Un local que hace GNV y GLP sale una vez, con los dos tipos (mismo nombre y misma dirección)."""
    llave = lambda x: (sin_tildes(x["nombre"] or ""), re.sub(r"[^A-Z0-9]", "", sin_tildes(x["direccion"] or "")))
    por = {}
    for tipo, lista in (("GNV", gnv), ("GLP", glp)):
        for x in lista:
            k = llave(x)
            if k in por:
                if tipo not in por[k]["tipos"]:
                    por[k]["tipos"].append(tipo)
            else:
                por[k] = {**x, "tipos": [tipo]}
    return sorted(por.values(), key=lambda x: (x["departamento"] or "", x["provincia"] or "", x["distrito"] or "", x["nombre"] or ""))


def main():
    carpeta = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    listas, fechas = {}, {}
    for clave in LISTAS:
        generado, filas = leer(bajar(clave, carpeta))
        # Una misma fila repetida (el MTC lista dos veces algunos locales) sale una vez.
        vistos, listas[clave] = set(), []
        for x in (item(f) for f in filas):
            k = x and (x["nombre"], re.sub(r"[^A-Z0-9]", "", sin_tildes(x["direccion"] or "")), x["distrito"])
            if x and k not in vistos:
                vistos.add(k)
                listas[clave].append(x)
        fechas[clave] = generado
        print(f"{clave}: {len(listas[clave])} (generado por el MTC el {generado})")

    def fuente(clave: str, nombre: str) -> dict:
        return {"nombre": nombre, "url": BASE + LISTAS[clave][2], "generadoAl": fechas[clave]}

    orden = lambda xs: sorted(xs, key=lambda x: (x["departamento"] or "", x["provincia"] or "", x["distrito"] or "", x["nombre"] or ""))
    sin_resolucion = lambda xs: [limpio({k: v for k, v in x.items() if k not in ("resolucion", "fechaResolucion", "telefono")}) for x in xs]

    licencia = {
        "fuentes": {
            "medicos": fuente("medicos", "Centros médicos autorizados para la licencia de conducir (MTC)"),
            "evaluacion": fuente("evaluacion", "Centros de evaluación de postulantes a licencias (MTC)"),
            "escuelas": fuente("escuelas", "Escuelas de conductores autorizadas (MTC)"),
        },
        "medicos": sin_resolucion(orden(listas["medicos"])),
        "evaluacion": sin_resolucion(orden(listas["evaluacion"])),
        "escuelas": sin_resolucion(orden(listas["escuelas"])),
    }
    gas = {
        "fuentes": {
            "talleres": fuente("talleres-gnv", "Talleres de conversión a GNV y a GLP autorizados (MTC)"),
            "certificadoras": fuente("certificadoras-gnv", "Entidades certificadoras de GNV y de GLP autorizadas (MTC)"),
            "cilindros": fuente("cilindros", "Centros de revisión periódica de cilindros autorizados (MTC)"),
        },
        "talleres": [limpio(x) for x in juntar(listas["talleres-gnv"], listas["talleres-glp"])],
        "certificadoras": [limpio(x) for x in juntar(listas["certificadoras-gnv"], listas["certificadoras-glp"])],
        "cilindros": [limpio(x) for x in orden(listas["cilindros"])],
    }
    DATOS.mkdir(parents=True, exist_ok=True)
    for nombre, d in (("licencia", licencia), ("gas", gas)):
        (DATOS / f"{nombre}.json").write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"{DATOS / (nombre + '.json')}: {', '.join(f'{k} {len(v)}' for k, v in d.items() if isinstance(v, list))}")


if __name__ == "__main__":
    main()
