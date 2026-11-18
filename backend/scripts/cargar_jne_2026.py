#!/usr/bin/env python3
"""Carga a `jne_candidaturas` las candidaturas de 2026: Elecciones Generales (12 de abril) y Regionales y Municipales (4 de octubre).

La tabla llegaba a 2022 (archivos del JNE en la PNDA, que no publican candidatos desde entonces). Las de 2026 las baja
`backend/scripts/jne_candidatos_2026.py` de dos API públicas del JNE, sin captcha:
  · EG 2026   Plataforma Electoral (lista por tipo de elección y candidatos por expediente), con el resultado de los 208
              electos del reporte «Autoridades electas» de la PNDA;
  · ERM 2026  Voto Informado (listas y candidatos por ámbito). Sus resultados todavía no están publicados en un formato
              que se pueda leer: `resultado` queda NULL (pendiente), NO «no_electo».
Este guion sólo carga su salida `jne_candidaturas_2026.csv` (una fila por candidatura inscrita).

Qué ajusta al cargar:
  · `resultado` vacío → NULL: en la web, vacío se leería como «No ganó».
  · El nombre de EG viene «NOMBRES APELLIDOS» junto y el descargador estima dónde cortar (acierta ~99,5 %). Si la persona
    ya está en la base con su documento (candidaturas anteriores o el padrón de candidatos de la ONPE), vale ESE nombre:
    un apellido mal cortado se taparía mal al publicarlo.
Recargable: borra lo de 2026 de estas dos fuentes y lo vuelve a poner, en una transacción.

Privacidad: el archivo trae el documento de cada candidato (queda en la tabla, como el de años anteriores; la API nunca
lo publica). Este guion sólo imprime conteos.

Uso:  python -I -X utf8 backend/scripts/cargar_jne_2026.py <jne_candidaturas_2026.csv> --seco
      python -I -X utf8 backend/scripts/cargar_jne_2026.py <jne_candidaturas_2026.csv> --entorno prod
"""

from __future__ import annotations

import argparse
import collections
import csv
import hashlib
import io
import re
import site
import sys
import unicodedata
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
if site.getusersitepackages() not in sys.path:
    sys.path.append(site.getusersitepackages())
sys.path.insert(0, str(RAIZ / "infrastructure" / "aws"))

FUENTES = ("JNE_PlataformaElectoral", "JNE_VotoInformado")
COLS = ["numero_documento", "nombre", "nombre_original", "partido", "año", "cargo", "resultado", "region", "provincia", "distrito",
        "numero_lista", "fuente", "fuente_url"]


def norm(s: str) -> str:
    """MAYÚSCULAS, sin tildes, un espacio entre palabras: como los nombres de los años anteriores."""
    s = "".join(c for c in unicodedata.normalize("NFD", s or "") if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", s.upper()).strip()


def leer(ruta: Path) -> list[dict]:
    with ruta.open(encoding="utf-8-sig", newline="") as f:
        filas = list(csv.DictReader(f))
    if not filas or any(c not in filas[0] for c in COLS):
        raise SystemExit(f"el CSV no trae las columnas esperadas: {list(filas[0]) if filas else 'vacío'}")
    malas = [x for x in filas if x["año"] != "2026" or x["fuente"] not in FUENTES or not re.fullmatch(r"\d{8}", x["numero_documento"]) or not x["nombre"].strip()]
    if malas:
        raise SystemExit(f"{len(malas)} filas no son de 2026, de estas fuentes o no traen documento y nombre: no se carga")
    return filas


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("csv")
    ap.add_argument("--entorno", choices=["dev", "prod"])
    ap.add_argument("--seco", action="store_true", help="lee, coteja con la base y cuenta; no escribe")
    a = ap.parse_args()
    if not a.entorno:
        ap.error("falta --entorno (con --seco también: coteja contra esa base)")
    ruta = Path(a.csv)
    filas = leer(ruta)
    por = collections.Counter((x["fuente"], x["resultado"] or "pendiente") for x in filas)
    print(f"{len(filas)} candidaturas: {dict(por)}", flush=True)

    from tunel_rds import conexion  # noqa: PLC0415

    with conexion(a.entorno) as cn:
        cur = cn.cursor()
        cur.execute("SET statement_timeout = '600s'")
        # El nombre exacto de quien ya está en la base con ese documento: sólo para EG, que es donde el orden se estimó.
        docs = sorted({x["numero_documento"] for x in filas if x["fuente"] == "JNE_PlataformaElectoral"})
        cur.execute("""SELECT DISTINCT ON (numero_documento) numero_documento, nombre, nombre_original
                         FROM jne_candidaturas WHERE numero_documento = ANY(%s) AND "año" < 2026 AND COALESCE(nombre, '') <> ''
                        ORDER BY numero_documento, "año" DESC""", (docs,))
        conocido = {d: (n, o) for d, n, o in cur.fetchall()}
        cur.execute("""SELECT DISTINCT ON (dni) dni, apellidos, nombres FROM onpe_candidatos
                        WHERE dni = ANY(%s) AND COALESCE(apellidos, '') <> '' AND COALESCE(nombres, '') <> '' ORDER BY dni, cargado_at DESC""", (docs,))
        for d, ap_, no in cur.fetchall():
            conocido.setdefault(d, (norm(f"{ap_} {no}"), f"{ap_} {no}".strip()))
        # Otros dos registros que escriben «APELLIDOS NOMBRES» con el documento: los aportantes de campaña y el RNP.
        cur.execute("""SELECT DISTINCT ON (numero_documento) numero_documento, nombre, nombre_original FROM onpe_aportantes
                        WHERE numero_documento = ANY(%s) AND COALESCE(nombre, '') <> '' ORDER BY numero_documento, id DESC""", (docs,))
        for d, n, o in cur.fetchall():
            conocido.setdefault(d, (n, o))
        cur.execute("""SELECT DISTINCT ON (numero_documento) numero_documento, nombre, nombre_original FROM rnp_conformacion_juridica
                        WHERE numero_documento = ANY(%s) AND COALESCE(nombre, '') <> '' ORDER BY numero_documento, id DESC""", (docs,))
        for d, n, o in cur.fetchall():
            conocido.setdefault(d, (n, o))
        corregidos = iguales = 0
        for x in filas:
            if x["fuente"] != "JNE_PlataformaElectoral" or x["numero_documento"] not in conocido:
                continue
            n, o = conocido[x["numero_documento"]]
            # Las mismas palabras en otro orden: se toma el orden de la base. Si las palabras no son las mismas (otra
            # persona con ese documento en un registro mal tecleado), no se toca.
            if sorted(norm(n).split()) == sorted(norm(x["nombre"]).split()):
                if norm(n) != norm(x["nombre"]):
                    x["nombre"], x["nombre_original"] = norm(n), o or x["nombre_original"]
                    corregidos += 1
                else:
                    iguales += 1
        print(f"nombres de EG cotejados por documento: {iguales} ya estaban en orden, {corregidos} se reordenaron, "
              f"{len(docs) - len([d for d in docs if d in conocido])} personas sin registro previo (orden estimado)", flush=True)
        if a.seco:
            cur.execute('SELECT count(*) FROM jne_candidaturas WHERE "año" = 2026')
            print("en la base hoy, de 2026:", cur.fetchone()[0])
            return 0
        datos = io.StringIO()
        w = csv.writer(datos, lineterminator="\n")
        for x in filas:
            w.writerow([x["numero_documento"], norm(x["nombre"]), x["nombre_original"], x["partido"], 2026, x["cargo"], x["resultado"] or None,
                        x["region"], x["provincia"], x["distrito"], x["numero_lista"] or None, x["fuente"], x["fuente_url"]])
        datos.seek(0)
        cur.execute('DELETE FROM jne_candidaturas WHERE "año" = 2026 AND fuente = ANY(%s)', (list(FUENTES),))
        borradas = cur.rowcount
        columnas = ", ".join('"año"' if c == "año" else c for c in COLS)
        # COPY lee todo vacío como NULL. Por una tabla temporal: el resultado y el número de lista se quedan NULL; la región,
        # la provincia y el distrito vuelven a cadena vacía, que es como están los años anteriores.
        cur.execute("CREATE TEMP TABLE _jne (LIKE jne_candidaturas INCLUDING DEFAULTS) ON COMMIT DROP")
        cur.copy_expert(f"COPY _jne ({columnas}) FROM STDIN WITH (FORMAT csv)", datos)
        cur.execute(f"""INSERT INTO jne_candidaturas ({columnas})
                        SELECT numero_documento, nombre, nombre_original, partido, "año", cargo, NULLIF(resultado, ''), COALESCE(region, ''), COALESCE(provincia, ''),
                               COALESCE(distrito, ''), numero_lista, fuente, fuente_url FROM _jne""")
        nuevas = cur.rowcount
        with ruta.open("rb") as f:
            sha = hashlib.sha256(f.read()).hexdigest()
        cur.execute("""INSERT INTO datasets_cargas (fuente, clave, tabla, archivo, sha256, bytes, filas, fuente_url, descargado_at, cargado_at, estado)
                       VALUES ('jne_candidaturas', '2026', 'jne_candidaturas', %s, %s, %s, %s, 'https://plataformaelectoral.jne.gob.pe/', now(), now(), 'ok')
                       ON CONFLICT (fuente, clave) DO UPDATE SET archivo = EXCLUDED.archivo, sha256 = EXCLUDED.sha256, bytes = EXCLUDED.bytes,
                             filas = EXCLUDED.filas, descargado_at = EXCLUDED.descargado_at, cargado_at = now(), estado = 'ok', error = NULL""",
                    (ruta.name, sha, ruta.stat().st_size, nuevas))
        cn.commit()
        cur.execute("ANALYZE jne_candidaturas")
        cur.execute('SELECT "año", count(*), count(*) FILTER (WHERE resultado = \'electo\'), count(*) FILTER (WHERE resultado IS NULL) FROM jne_candidaturas WHERE "año" >= 2021 GROUP BY 1 ORDER BY 1')
        print(f"cargadas {nuevas} (se reemplazaron {borradas}). Por año (candidaturas, electos, sin resultado):", cur.fetchall())
        cn.commit()
    return 0


if __name__ == "__main__":
    sys.exit(main())
