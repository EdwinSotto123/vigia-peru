#!/usr/bin/env python3
"""Carga `procuraduria_casos_sede` (migración 90) desde el boletín estadístico mensual de la Procuraduría Pública
Especializada en Delitos de Corrupción (PPEDC): https://procuraduriaanticorrupcion.minjus.gob.pe/ (Publicaciones).

Del PDF (verificado con el de julio de 2026, 56 páginas) se toman, por sede:
  · Tabla N.° 02 "Clasificación de casos en trámite por importancia": A+, A, B, EJECUCIÓN y TOTAL. TOTAL son los casos en
    trámite (incluye los que están en ejecución de sentencia); EJECUCIÓN, los casos con sentencia firme en etapa de
    cobro de la reparación civil.
  · La página de cada sede (sección 03): "Sentencias favorables" (sentencias y autos consentidos o ejecutoriados que
    fijan reparación civil, del 1 de enero al corte), "Cobro de reparaciones civiles" (S/ cobrados en el mismo lapso) y
    "Casos nuevos". En el PDF los valores salen antes de su rótulo: monto | sentencias | casos nuevos (comprobado contra
    el texto de cada sede y contra el Gráfico 12).
Antes de escribir se comprueba que cada columna de la tabla sume su fila Total, que las sentencias
sumen lo que dice el texto ("un total de 521 nuevas sentencias") y que, agrupadas con SEDES, den los casos por
departamento de la Figura 02. Si algo no cuadra, no carga (el formato del boletín cambió: revisar antes de --forzar).

Sede → departamento (ubigeo INEI de 2 dígitos). Las sedes siguen a los distritos judiciales, no a las regiones; las que
no llevan nombre de departamento van al de su ciudad. La Figura 02 del boletín de julio 2026 lo confirma (Lima = Lima
Sede Central + Lima Norte + Lima Sur + Huaura + Cañete; Áncash = Áncash + Del Santa; Ica = Ica + Chincha; …). Las que
no están en ese boletín pero sí en otros (Lima Este, Ventanilla, Selva Central…) quedan mapeadas igual. Una sede nueva
sin mapa corta la carga: agregarla a SEDES.

Conexión: túnel de Session Manager como `postgres` (infrastructure/aws/tunel_rds.py, `conexion()`), clave maestra de SSM:
  dev  → vigia-db-dev, /vigia/dev/db-admin        prod → vigia-db, /vigia/vigia-db/password

Uso:
  python backend/scripts/cargar_ppedc_boletin.py --url https://procuraduriaanticorrupcion.minjus.gob.pe/wp-content/uploads/2026/09/BOLETIN-PPEDC-A-JULIO-2026.pdf --entorno dev
  python backend/scripts/cargar_ppedc_boletin.py --url <pdf> --seco          # sólo lee y muestra, sin base
  python backend/scripts/cargar_ppedc_boletin.py --url <pdf> --pdf boletin.pdf --entorno dev   # con una copia local
Re-ejecutable: reemplaza el corte (DELETE + INSERT en una transacción) y anota la carga en datasets_cargas.
Requiere PyMuPDF (`pip install pymupdf`), psycopg2, la CLI de AWS y session-manager-plugin.
"""

from __future__ import annotations

import argparse
import calendar
import hashlib
import re
import sys
import tempfile
import unicodedata
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
FUENTE = "ppedc_boletin"
ENTORNOS = ("dev", "prod")
MESES = {m: i for i, m in enumerate(["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SETIEMBRE",
                                     "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"], start=1)} | {"SEPTIEMBRE": 9}

# Sede (normalizada con norm()) → departamento.
SEDES = {
    "AMAZONAS": "01", "BAGUA": "01",
    "ANCASH": "02", "DEL SANTA": "02", "SANTA": "02", "HUARAZ": "02",
    "APURIMAC": "03", "ANDAHUAYLAS": "03",
    "AREQUIPA": "04",
    "AYACUCHO": "05",
    "CAJAMARCA": "06", "JAEN": "06",
    "CALLAO": "07", "VENTANILLA": "07",
    "CUSCO": "08", "LA CONVENCION": "08",
    "HUANCAVELICA": "09",
    "HUANUCO": "10",
    "ICA": "11", "CHINCHA": "11",
    "JUNIN": "12", "SELVA CENTRAL": "12",          # Selva Central: sede en La Merced (Chanchamayo)
    "LA LIBERTAD": "13",
    "LAMBAYEQUE": "14",
    "LIMA": "15", "LIMA SEDE CENTRAL": "15", "LIMA NORTE": "15", "LIMA SUR": "15", "LIMA ESTE": "15",
    "HUAURA": "15", "CANETE": "15",
    "LORETO": "16", "YURIMAGUAS": "16",
    "MADRE DE DIOS": "17",
    "MOQUEGUA": "18",
    "PASCO": "19",
    "PIURA": "20", "SULLANA": "20",
    "PUNO": "21",
    "SAN MARTIN": "22", "MOYOBAMBA": "22", "TARAPOTO": "22",
    "TACNA": "23",
    "TUMBES": "24",
    "UCAYALI": "25", "ATALAYA": "25",
}
# Nombre de departamento (como en la Figura 02) → ubigeo.
DEPARTAMENTOS = {
    "AMAZONAS": "01", "ANCASH": "02", "APURIMAC": "03", "AREQUIPA": "04", "AYACUCHO": "05", "CAJAMARCA": "06", "CALLAO": "07",
    "CUSCO": "08", "HUANCAVELICA": "09", "HUANUCO": "10", "ICA": "11", "JUNIN": "12", "LA LIBERTAD": "13", "LAMBAYEQUE": "14",
    "LIMA": "15", "LORETO": "16", "MADRE DE DIOS": "17", "MOQUEGUA": "18", "PASCO": "19", "PIURA": "20", "PUNO": "21",
    "SAN MARTIN": "22", "TACNA": "23", "TUMBES": "24", "UCAYALI": "25",
}

NUM = r"\d[\d  ]*"                               # 62007, 10 213 (espacio o espacio duro como separador de miles)


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).upper()
    return " ".join(re.sub(r"[^A-Z0-9]+", " ", s).split())


def entero(s: str) -> int:
    return int(re.sub(r"\D", "", s))


def monto(s: str) -> float:
    """'1 116 186.84' / '22 835' / '261,882.87' → float (el boletín usa punto decimal)."""
    return float(re.sub(r"[\s ,]", "", s))


class ErrorBoletin(Exception):
    pass


def paginas(pdf: Path) -> list[str]:
    import fitz   # PyMuPDF
    with fitz.open(pdf) as d:
        # Cada línea del PDF es una celda o un rótulo: se unen con ' | ' para buscar por patrones.
        return [" | ".join(x.strip() for x in p.get_text().split("\n") if x.strip()) for p in d]


def corte(textos: list[str]) -> date:
    for t in textos[:6]:
        m = re.search(r"BOLET[IÍ]N ESTAD[IÍ]STICO (\d{4})\s*[-–]\s*([A-ZÁÉÍÓÚ]+)", t.upper())
        if m and norm(m.group(2)) in MESES:
            anio, mes = int(m.group(1)), MESES[norm(m.group(2))]
            return date(anio, mes, calendar.monthrange(anio, mes)[1])
    raise ErrorBoletin("no encuentro 'Boletín estadístico <año> - <mes>' en las primeras páginas")


def tabla_importancia(textos: list[str]) -> tuple[dict[str, dict], dict]:
    """Tabla N.° 02 → {sede: {a_mas, a, b, ejecucion, total}} y la fila Total."""
    for t in textos:
        if "POR IMPORTANCIA" not in t.upper() or "EJECUCI" not in t.upper():
            continue
        celdas = t.split(" | ")
        try:
            i = next(k for k, c in enumerate(celdas) if c.upper() == "TOTAL") + 1
        except StopIteration:
            continue
        filas: dict[str, dict] = {}
        total = None
        while i + 5 < len(celdas):
            nombre, valores = celdas[i].strip(), celdas[i + 1:i + 6]
            if re.fullmatch(NUM, nombre) or not all(re.fullmatch(NUM, v.strip()) for v in valores):
                break
            # Las cuatro categorías NO suman el total en el propio boletín (julio 2026: 846 + 10 213 + 41 891 + 10 002 =
            # 62 952 contra 62 007; sus porcentajes suman 101,5 %): se guardan como vienen y se comprueba cada columna.
            a_mas, a, b, ejec, tot = (entero(v) for v in valores)
            fila = {"a_mas": a_mas, "a": a, "b": b, "ejecucion": ejec, "total": tot}
            if norm(nombre) == "TOTAL":
                total = fila
            else:
                filas[nombre] = fila
            i += 6
        if filas and total:
            return filas, total
    raise ErrorBoletin("no encuentro la Tabla N.° 02 (casos en trámite por importancia)")


def paginas_sede(textos: list[str]) -> dict[str, dict]:
    """Las páginas de cada sede → {NORM(sede): {casos, a_mas, a, b, ejecucion, sentencias, reparacion, nuevos}}."""
    out: dict[str, dict] = {}
    for t in textos:
        caja = re.search(rf"Sentencias favorables \| ([\d  .,]+?) \| Cobro de reparaciones \| civiles \| ({NUM}) \| Casos nuevos \| ({NUM})", t)
        cab = re.search(rf"\| ([^|]*[A-Za-zÁÉÍÓÚÑáéíóúñ][^|]*?) \| \1 \| ({NUM}) \| Casos en \| trámite", t)
        if not caja or not cab:
            continue
        imp = re.search(rf"A\+ \| ({NUM}) \| A \| ({NUM}) \| Ejecución \| ({NUM}) \| B \| ({NUM})", t)
        out[norm(cab.group(1))] = {
            "casos": entero(cab.group(2)),
            "reparacion": monto(caja.group(1)), "sentencias": entero(caja.group(2)), "nuevos": entero(caja.group(3)),
            **({"a_mas": entero(imp.group(1)), "a": entero(imp.group(2)), "ejecucion": entero(imp.group(3)), "b": entero(imp.group(4))} if imp else {}),
        }
    return out


def totales_texto(textos: list[str]) -> dict[str, int]:
    """Totales nacionales que el boletín escribe en el texto (para comprobar las sumas)."""
    todo = " ".join(textos)
    out = {}
    if m := re.search(rf"total de ({NUM}) nuevas sentencias", todo):
        out["sentencias"] = entero(m.group(1))
    if m := re.search(rf"ingresaron a la Procuradur[ií]a .*?\| ({NUM}) \(", todo):
        out["nuevos"] = entero(m.group(1))
    return out


def figura_departamentos(textos: list[str]) -> dict[str, int]:
    """Figura N.° 02 (casos en trámite por departamento) → {ubigeo: casos}. Lo último que se lee de cada nombre gana:
    el recuadro de arriba (los 5 mayores) pone los nombres juntos y los números después."""
    for t in textos:
        if "POR DEPARTAMENTOS" not in t.upper():
            continue
        celdas = t.split(" | ")
        out = {}
        for nombre, valor in zip(celdas, celdas[1:]):
            if norm(nombre) in DEPARTAMENTOS and re.fullmatch(NUM, valor.strip()):
                out[DEPARTAMENTOS[norm(nombre)]] = entero(valor)
        return out
    return {}


def leer_boletin(pdf: Path, url: str) -> tuple[date, list[dict], list[str]]:
    textos = paginas(pdf)
    c = corte(textos)
    tabla, total = tabla_importancia(textos)
    detalle = paginas_sede(textos)
    avisos: list[str] = []

    filas = []
    for sede, v in tabla.items():
        clave = norm(sede)
        dep = SEDES.get(clave) or SEDES.get(norm(re.sub(r"\(.*?\)", "", sede)))
        if not dep:
            raise ErrorBoletin(f"sede sin departamento: {sede!r} (agregarla a SEDES)")
        d = detalle.get(clave) or detalle.get(norm(re.sub(r"\(.*?\)", "", sede)))
        if not d:
            avisos.append(f"{sede}: sin página de sede (sentencias, reparación y casos nuevos quedan vacíos)")
            d = {}
        elif d.get("casos") != v["total"] or any(k in d and d[k] != v[k] for k in ("a_mas", "a", "b", "ejecucion")):
            avisos.append(f"{sede}: la página de la sede no coincide con la tabla 02 ({d} vs {v}); vale la tabla")
        filas.append({"corte": c, "sede": sede, "departamento": dep, "en_tramite": v["total"], "en_ejecucion": v["ejecucion"],
                      "importancia_a_mas": v["a_mas"], "importancia_a": v["a"], "importancia_b": v["b"],
                      "casos_nuevos": d.get("nuevos"), "sentencias": d.get("sentencias"), "reparacion_civil": d.get("reparacion"),
                      "url_fuente": url})

    # Comprobaciones: si no cuadran, el boletín cambió de forma.
    errores = []
    for k, col in (("total", "en_tramite"), ("ejecucion", "en_ejecucion"), ("a_mas", "importancia_a_mas"), ("a", "importancia_a"),
                   ("b", "importancia_b")):
        s = sum(f[col] for f in filas)
        if s != total[k]:
            errores.append(f"las sedes suman {s} en {col} y la fila Total dice {total[k]}")
    tt = totales_texto(textos)
    for k, col in (("sentencias", "sentencias"), ("nuevos", "casos_nuevos")):
        s = sum(f[col] or 0 for f in filas)
        if k in tt and s != tt[k]:
            errores.append(f"las sedes suman {s} {col} y el texto dice {tt[k]}")
    fig = figura_departamentos(textos)
    por_dep: dict[str, int] = {}
    for f in filas:
        por_dep[f["departamento"]] = por_dep.get(f["departamento"], 0) + f["en_tramite"]
    for dep, n in sorted(fig.items()):
        if por_dep.get(dep) != n:
            errores.append(f"departamento {dep}: las sedes suman {por_dep.get(dep)} y la Figura 02 dice {n}")
    if not fig:
        avisos.append("no encontré la Figura 02 (casos por departamento): el mapa de sedes no se comprobó")
    return c, filas, avisos + [f"ERROR: {e}" for e in errores]


def bajar(url: str, carpeta: Path) -> Path:
    destino = carpeta / "boletin.pdf"
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=300) as r, open(destino, "wb") as f:
        while bloque := r.read(1 << 20):
            f.write(bloque)
    return destino


def cargar(entorno: str, c: date, filas: list[dict], url: str, archivo: Path, sha: str) -> None:
    from psycopg2.extras import execute_values
    cols = ["corte", "sede", "departamento", "en_tramite", "en_ejecucion", "importancia_a_mas", "importancia_a", "importancia_b",
            "casos_nuevos", "sentencias", "reparacion_civil", "url_fuente"]
    sys.path.insert(0, str(RAIZ / "infrastructure" / "aws"))
    from tunel_rds import BASES, conexion
    with conexion(entorno) as con:
        with con, con.cursor() as cur:    # una transacción: el corte se reemplaza entero o nada
            cur.execute("DELETE FROM procuraduria_casos_sede WHERE corte = %s", (c,))
            execute_values(cur, f"INSERT INTO procuraduria_casos_sede ({', '.join(cols)}) VALUES %s",
                           [tuple(f[k] for k in cols) for f in filas])
            cur.execute(
                """INSERT INTO datasets_cargas (fuente, clave, tabla, archivo, sha256, bytes, filas, fuente_url, descargado_at,
                                               cargado_at, estado)
                   VALUES (%s, %s, 'procuraduria_casos_sede', %s, %s, %s, %s, %s, %s, now(), 'ok')
                   ON CONFLICT (fuente, clave) DO UPDATE SET archivo = EXCLUDED.archivo, sha256 = EXCLUDED.sha256,
                     bytes = EXCLUDED.bytes, filas = EXCLUDED.filas, fuente_url = EXCLUDED.fuente_url,
                     descargado_at = EXCLUDED.descargado_at, cargado_at = now(), estado = 'ok', error = NULL""",
                (FUENTE, c.isoformat(), url.rsplit("/", 1)[-1], sha, archivo.stat().st_size, len(filas), url,
                 datetime.now(timezone.utc)))
    print(f"✓ {BASES[entorno]}: {len(filas)} sedes al corte {c}")


def main() -> int:
    ap = argparse.ArgumentParser(description="Carga el boletín estadístico de la Procuraduría Anticorrupción (PPEDC).")
    ap.add_argument("--url", required=True, help="URL del PDF del boletín (queda como url_fuente)")
    ap.add_argument("--pdf", type=Path, help="copia local del PDF (si no, se baja de --url)")
    ap.add_argument("--entorno", choices=sorted(ENTORNOS), help="base donde cargar (dev = vigia-db-dev, prod = vigia-db)")
    ap.add_argument("--seco", action="store_true", help="sólo lee y muestra, no escribe")
    ap.add_argument("--forzar", action="store_true", help="cargar aunque las comprobaciones no cuadren")
    a = ap.parse_args()
    if not a.seco and not a.entorno:
        ap.error("falta --entorno (o --seco)")
    sys.stdout.reconfigure(encoding="utf-8")

    with tempfile.TemporaryDirectory() as tmp:
        pdf = a.pdf or bajar(a.url, Path(tmp))
        sha = hashlib.sha256(pdf.read_bytes()).hexdigest()
        try:
            c, filas, avisos = leer_boletin(pdf, a.url)
        except ErrorBoletin as e:
            print(f"✗ {e}", file=sys.stderr)
            return 1
        print(f"Boletín al {c}: {len(filas)} sedes · sha256 {sha[:12]}…")
        print(f"{'sede':<22}{'dep':>4}{'trámite':>9}{'ejecución':>10}{'sentencias':>11}{'reparación S/':>16}{'nuevos':>8}")
        for f in sorted(filas, key=lambda f: (f["departamento"], -f["en_tramite"])):
            rep = f"{f['reparacion_civil']:,.2f}" if f["reparacion_civil"] is not None else "—"
            print(f"{f['sede']:<22}{f['departamento']:>4}{f['en_tramite']:>9,}{f['en_ejecucion']:>10,}"
                  f"{f['sentencias'] if f['sentencias'] is not None else '—':>11}{rep:>16}{f['casos_nuevos'] or '—':>8}")
        print(f"{'TOTAL':<26}{sum(f['en_tramite'] for f in filas):>9,}{sum(f['en_ejecucion'] for f in filas):>10,}"
              f"{sum(f['sentencias'] or 0 for f in filas):>11}{sum(f['reparacion_civil'] or 0 for f in filas):>16,.2f}"
              f"{sum(f['casos_nuevos'] or 0 for f in filas):>8}")
        for x in avisos:
            print(f"  ! {x}")
        if any(x.startswith("ERROR") for x in avisos) and not a.forzar:
            print("✗ las comprobaciones no cuadran: no se carga (revisar el PDF; --forzar para cargar igual)", file=sys.stderr)
            return 1
        if a.seco:
            return 0
        cargar(a.entorno, c, filas, a.url, pdf, sha)
    return 0


if __name__ == "__main__":
    sys.exit(main())
