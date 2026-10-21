#!/usr/bin/env python3
"""Carga `informes_control` (migración 90) desde el Buscador de Informes de la Contraloría, desde una PC en el Perú.

Es lo mismo que la fuente `contraloria_informes` de vigia-scrapers (backend/scrapers-worker/src/fuentes/
contraloria_informes.ts: mismo endpoint, mismos campos, mismo upsert), para cuando el Worker no llega: el servidor de la
Contraloría (appbp.contraloria.gob.pe, 161.132.x.x) no responde a IPs de fuera del Perú. Medido el 2026-10-21: 522 desde
Cloudflare (directo en Miami, relay en Zúrich y Browser Rendering) y timeout desde AWS us-east-2; 200 desde Lima.

Responsabilidad PRESUNTA (no es condena). PRIVACIDAD: cada fila del buscador trae en `Text` (y a veces en
`Funcionarios`) el DNI y el nombre de cada funcionario; de eso sólo se toma cuántos son. Nada se guarda en disco.

Uso:
  python backend/scripts/cargar_contraloria_informes.py --entorno dev          # las 4 responsabilidades (~14 100, 15 páginas)
  python backend/scripts/cargar_contraloria_informes.py --entorno prod
  python backend/scripts/cargar_contraloria_informes.py --seco                 # sólo baja y cuenta
  python backend/scripts/cargar_contraloria_informes.py --entorno dev --responsabilidades PENAL,CIVIL
Idempotente: upsert por código y, al final, refrescar_informes_control_entidad() (ubigeo y RUC de todos los informes).
Requiere psycopg2, la CLI de AWS y session-manager-plugin (túnel de infrastructure/aws/tunel_rds.py).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
URL_BUSCADOR = "https://appbp.contraloria.gob.pe/BuscadorCGR/Informes/BusquedaInformesCGR.ashx"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
RESPONSABILIDADES = ["PENAL", "CIVIL", "ADMINISTRATIVO ENTIDAD", "ADMINISTRATIVO PAS"]
NOMBRES = {"PENAL": "penal", "CIVIL": "civil", "ADMINISTRATIVO ENTIDAD": "administrativa_entidad",
           "ADMINISTRATIVO PAS": "administrativa_pas", "ADMINISTRATIVO": "administrativa"}
POR_PAGINA = 1000
FUENTE = "contraloria_informes"

COLS = ["codigo", "numero", "titulo", "modalidad", "sector", "nivel_gobierno", "entidad_nombre", "departamento", "provincia",
        "distrito", "responsabilidades", "funcionarios", "fecha_emision", "fecha_publicacion", "fecha_fin_ejecucion", "url_pdf",
        "url_resumen"]
ACTUALIZABLES = [c for c in COLS if c != "codigo"]
# El mismo upsert que el Worker: sólo toca updated_at si algo cambió.
SQL_UPSERT = f"""
  INSERT INTO informes_control AS ic ({", ".join(COLS)})
  SELECT {", ".join(COLS)} FROM jsonb_to_recordset(%s::jsonb) AS x (
    codigo TEXT, numero TEXT, titulo TEXT, modalidad TEXT, sector TEXT, nivel_gobierno TEXT, entidad_nombre TEXT,
    departamento TEXT, provincia TEXT, distrito TEXT, responsabilidades TEXT[], funcionarios INT, fecha_emision DATE,
    fecha_publicacion DATE, fecha_fin_ejecucion DATE, url_pdf TEXT, url_resumen TEXT)
  ON CONFLICT (codigo) DO UPDATE SET {", ".join(f"{c} = EXCLUDED.{c}" for c in ACTUALIZABLES)}, updated_at = now()
  WHERE ({", ".join(f"ic.{c}" for c in ACTUALIZABLES)}) IS DISTINCT FROM ({", ".join(f"EXCLUDED.{c}" for c in ACTUALIZABLES)})"""


def txt(v) -> str | None:
    return None if v is None else (" ".join(str(v).split()) or None)


def fecha(v) -> str | None:
    m = re.fullmatch(r"(\d{4})/(\d{2})/(\d{2})", txt(v) or "")
    if not m:
        return None
    try:
        return date(int(m[1]), int(m[2]), int(m[3])).isoformat()
    except ValueError:
        return None


def responsabilidades(v) -> list[str]:
    out = set()
    for parte in str(v or "").split(","):
        r = " ".join(parte.split()).upper()
        if r:
            out.add(NOMBRES.get(r) or re.sub(r"[^a-z0-9]+", "_", r.lower()))
    return sorted(out)


def https(v) -> str | None:
    t = txt(v)
    return re.sub(r"^http://", "https://", t, flags=re.I) if t else None


def a_informe(f: dict) -> dict | None:
    """Una fila del buscador → informe. Sólo campos de una lista cerrada: ni `Text` ni `Funcionarios`."""
    codigo, entidad = txt(f.get("CodigoInforme")), txt(f.get("Entidad"))
    if not codigo or not entidad:
        return None
    n = txt(f.get("TotalFuncionarios"))
    return {
        "codigo": codigo, "numero": txt(f.get("NumeroInforme")), "titulo": txt(f.get("Descripcion")),
        "modalidad": txt(f.get("ModalidadServicio")), "sector": txt(f.get("Sector")), "nivel_gobierno": txt(f.get("NivelGobierno")),
        "entidad_nombre": entidad, "departamento": txt(f.get("Departamento")), "provincia": txt(f.get("Provincia")),
        "distrito": txt(f.get("Distrito")), "responsabilidades": responsabilidades(f.get("Responsabilidad")),
        "funcionarios": int(n) if n and n.isdigit() else None,
        "fecha_emision": fecha(f.get("FechaEmision")), "fecha_publicacion": fecha(f.get("FechaPublicacion")),
        "fecha_fin_ejecucion": fecha(f.get("FechaFinEjecucion")),
        "url_pdf": https(f.get("RutaCloudInforme") or f.get("ResumenInforme")),
        "url_resumen": https(f.get("RutaCloudResumen") or f.get("ResumenEjecutivo")),
    }


def pagina(n: int, resp: list[str]) -> tuple[list[dict], int, int]:
    q = urllib.parse.urlencode({"ActionPage": "TransportType", "Action": "loadInformesElastic", "PageSize": POR_PAGINA,
                                "PageNumber": n, "pGeneral": " ", "pResponsabilidad": " OR ".join(f'"{r}"' for r in resp)})
    for intento in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(f"{URL_BUSCADOR}?{q}", headers={"User-Agent": UA}), timeout=180) as r:
                filas = json.loads(r.read().decode("utf-8"))
            break
        except Exception as e:     # noqa: BLE001 — red o 5xx: reintentar con espera
            if intento == 3:
                raise RuntimeError(f"página {n}: {e} (¿IP fuera del Perú? la Contraloría sólo responde a IPs peruanas)") from e
            time.sleep(5 * 2 ** intento)
    if not isinstance(filas, list):
        raise RuntimeError(f"página {n}: el buscador no devolvió una lista")
    total_paginas = int(filas[0].get("TotalPages") or 0) if filas else 0
    total = int(filas[0].get("TotalRows") or 0) if filas else 0
    return [i for i in map(a_informe, filas) if i], total_paginas, total


def main() -> int:
    ap = argparse.ArgumentParser(description="Carga los informes de control de la Contraloría (responsabilidad presunta).")
    ap.add_argument("--entorno", choices=["dev", "prod"], help="dev = vigia-db-dev, prod = vigia-db")
    ap.add_argument("--seco", action="store_true", help="sólo baja y cuenta, no escribe")
    ap.add_argument("--responsabilidades", default=",".join(RESPONSABILIDADES),
                    help=f"separadas por coma (por defecto: {','.join(RESPONSABILIDADES)})")
    a = ap.parse_args()
    if not a.seco and not a.entorno:
        ap.error("falta --entorno (o --seco)")
    sys.stdout.reconfigure(encoding="utf-8")
    resp = [r.strip().upper() for r in a.responsabilidades.split(",") if r.strip()]

    informes: dict[str, dict] = {}
    n, paginas, total = 1, 1, 0
    while n <= paginas and n <= 60:
        filas, paginas, total = pagina(n, resp)
        for i in filas:
            informes[i["codigo"]] = i
        print(f"  página {n}/{paginas}: {len(filas)} informes")
        n += 1
    print(f"Buscador: {total} informes; leídos {len(informes)} distintos")
    if a.seco or not informes:
        return 0

    sys.path.insert(0, str(RAIZ / "infrastructure" / "aws"))
    from tunel_rds import BASES, conexion
    lista = list(informes.values())
    with conexion(a.entorno) as con:
        with con, con.cursor() as cur:
            escritos = 0
            for k in range(0, len(lista), POR_PAGINA):
                cur.execute(SQL_UPSERT, (json.dumps(lista[k:k + POR_PAGINA], ensure_ascii=False),))
                escritos += cur.rowcount
            cur.execute("SELECT * FROM refrescar_informes_control_entidad()")
            tot, con_ubigeo, con_ruc, ambiguos = cur.fetchone()
            cur.execute("""SELECT encode(sha256(convert_to(coalesce(string_agg(codigo || '|' || coalesce(fecha_publicacion::text, ''),
                                  ',' ORDER BY codigo), ''), 'UTF8')), 'hex') FROM informes_control""")
            (sha,) = cur.fetchone()
            cur.execute(
                """INSERT INTO datasets_cargas (fuente, clave, tabla, archivo, sha256, filas, fuente_url, descargado_at, cargado_at, estado)
                   VALUES (%s, 'con_responsabilidad', 'informes_control', %s, %s, %s, %s, %s, now(), 'ok')
                   ON CONFLICT (fuente, clave) DO UPDATE SET archivo = EXCLUDED.archivo, sha256 = EXCLUDED.sha256,
                     filas = EXCLUDED.filas, fuente_url = EXCLUDED.fuente_url, descargado_at = EXCLUDED.descargado_at,
                     cargado_at = now(), estado = 'ok', error = NULL""",
                (FUENTE, f"script {date.today().isoformat()}", sha, tot, URL_BUSCADOR, datetime.now(timezone.utc)))
    print(f"✓ {BASES[a.entorno]}: {escritos} nuevos o cambiados · {tot} informes, {con_ruc} con RUC "
          f"({con_ruc / max(tot, 1):.1%}), {con_ubigeo} con distrito, {ambiguos} ambiguos")
    return 0


if __name__ == "__main__":
    sys.exit(main())
