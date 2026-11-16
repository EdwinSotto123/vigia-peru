#!/usr/bin/env python3
"""Carga `informes_control` (migración 90) desde el Buscador de Informes de la Contraloría, desde una PC en el Perú.

Es lo mismo que la fuente `contraloria_informes` de vigia-scrapers (backend/scrapers-worker/src/fuentes/
contraloria_informes.ts: mismo endpoint, mismos campos, mismo upsert), para cuando el Worker no llega: el servidor de la
Contraloría (appbp.contraloria.gob.pe, 161.132.x.x) no responde a IPs de fuera del Perú. Medido el 2026-10-21: 522 desde
Cloudflare (directo en Miami, relay en Zúrich y Browser Rendering) y timeout desde AWS us-east-2; 200 desde Lima.

Responsabilidad PRESUNTA (no es condena). PRIVACIDAD: cada fila del buscador trae en `Text` (y a veces en
`Funcionarios`) el DNI y el nombre de cada funcionario. Sin --personas, de eso sólo se toma cuántos son. Con --personas
(migración 302) cada uno va a `informe_control_persona` (documento, nombre y responsabilidades), una tabla que ni la API
ni el MCP ni los agentes leen; la API ve la vista sin documento `informe_control_implicado`. Nada se guarda en disco y
el script sólo imprime conteos: nunca un nombre ni un documento.

Uso:
  python backend/scripts/cargar_contraloria_informes.py --entorno dev          # las 4 responsabilidades (~14 100, 15 páginas)
  python backend/scripts/cargar_contraloria_informes.py --entorno prod
  python backend/scripts/cargar_contraloria_informes.py --entorno prod --personas   # y las personas de cada informe
  python backend/scripts/cargar_contraloria_informes.py --seco [--personas]     # sólo baja y cuenta
  python backend/scripts/cargar_contraloria_informes.py --entorno dev --responsabilidades PENAL,CIVIL
Idempotente: upsert por código y, al final, refrescar_informes_control_entidad() (ubigeo y RUC de todos los informes).
Las personas de cada informe leído se reemplazan por las de esta lectura (upsert por código y orden; se borran las que
sobran). Un informe que esta vez no trae a nadie conserva las que tenía. Después rehace la señal de personas que sale de
ellas (refrescar_persona_informe_control, migración 308) y el resumen de las listas de personas.
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


# ── Las personas de cada informe (--personas, migración 302) ──────────────────────────────────────────────────────────
# `Text` junta los campos del informe y, por cada funcionario comprendido, «DNI : <número> APELLIDOS NOMBRES
# RESPONSABILIDAD : ADMINISTRATIVO ENTIDAD PENAL». Tras la última persona siguen el nivel de gobierno, el periodo y el
# operativo: la lista de responsabilidades termina en la primera palabra que no es una de las suyas. Medido el 2026-11-16:
# en los 14 154 informes hay tantos «DNI :» como dice TotalFuncionarios.
PALABRAS_RESPONSABILIDAD = {"ADMINISTRATIVO", "ENTIDAD", "PAS", "PENAL", "CIVIL"}


def responsabilidades_persona(cola: str) -> list[str]:
    """«ADMINISTRATIVO ENTIDAD ADMINISTRATIVO PAS PENAL GOBIERNO LOCAL …» → administrativa_entidad, administrativa_pas,
    penal (los nombres de NOMBRES, los mismos de informes_control.responsabilidades)."""
    ws: list[str] = []
    for w in cola.split():
        if w.upper() not in PALABRAS_RESPONSABILIDAD:
            break
        ws.append(w.upper())
    out, i = set(), 0
    while i < len(ws):
        if ws[i] == "ADMINISTRATIVO" and i + 1 < len(ws) and ws[i + 1] in ("ENTIDAD", "PAS"):
            out.add(NOMBRES[f"ADMINISTRATIVO {ws[i + 1]}"])
            i += 2
            continue
        if ws[i] in NOMBRES:      # un ENTIDAD o PAS suelto no dice nada: se ignora
            out.add(NOMBRES[ws[i]])
        i += 1
    return sorted(out)


def personas(f: dict) -> tuple[list[dict], int]:
    """Las personas de una fila del buscador, en su orden, y cuántos «DNI :» trae. De cada una: el documento (sólo cifras;
    None si no trae número), el nombre como lo publica la Contraloría y sus responsabilidades. Queda en memoria: nunca se
    imprime ni va a disco."""
    texto = " ".join(str(f.get("Text") or "").split())
    tramos = re.split(r"\bDNI\s*:", texto)[1:]
    out: list[dict] = []
    for tramo in tramos:
        m = re.match(r"\s*(.*?)\s*\bRESPONSABILIDAD\s*:\s*(.*)$", tramo)
        if not m:
            continue
        toks = m.group(1).split()
        doc = toks.pop(0) if toks and re.fullmatch(r"[0-9]+", toks[0]) else None
        if toks:
            out.append({"orden": len(out) + 1, "doc": doc, "nombre": " ".join(toks),
                        "responsabilidades": responsabilidades_persona(m.group(2))})
    return out, len(tramos)


def verificar(informes: dict[str, dict], gente: dict[str, tuple[list[dict], int]]) -> None:
    """Por informe, ¿las personas leídas son TotalFuncionarios? Y si no, por qué. Sólo conteos."""
    c: dict[str, int] = {k: 0 for k in ("personas", "cuadran", "sin_text", "otro_numero", "sin_responsabilidad", "dni8",
                                         "doc_otro", "sin_doc", "sin_tipo", "repetidas")}
    otros: dict[int, int] = {}
    for codigo, i in informes.items():
        ps, marcas = gente.get(codigo, ([], 0))
        n = i.get("funcionarios")
        c["personas"] += len(ps)
        if n is not None and len(ps) == n:
            c["cuadran"] += 1
        elif marcas == 0:
            c["sin_text"] += 1           # el buscador no trajo a nadie en Text
        elif marcas != n:
            c["otro_numero"] += 1        # el buscador lista otro número de personas que su propio TotalFuncionarios
        else:
            c["sin_responsabilidad"] += 1  # algún «DNI :» sin «RESPONSABILIDAD :» o sin nombre: no se pudo leer
        docs = [p["doc"] for p in ps if p["doc"]]
        for d in docs:
            if len(d) == 8:
                c["dni8"] += 1
            else:
                c["doc_otro"] += 1
                otros[len(d)] = otros.get(len(d), 0) + 1
        c["sin_doc"] += sum(1 for p in ps if not p["doc"])
        c["sin_tipo"] += sum(1 for p in ps if not p["responsabilidades"])
        c["repetidas"] += len(docs) - len(set(docs))
    no = len(informes) - c["cuadran"]
    print(f"Personas: {c['personas']} en {len(informes)} informes; {c['dni8']} con DNI de 8 cifras, {c['doc_otro']} con otro "
          f"número ({', '.join(f'{v} de {k} cifras' for k, v in sorted(otros.items())) or 'ninguno'}), {c['sin_doc']} sin número, "
          f"{c['sin_tipo']} sin responsabilidad leída, {c['repetidas']} repetidas en su mismo informe")
    print(f"  Personas leídas = TotalFuncionarios en {c['cuadran']} de {len(informes)} informes; no cuadran {no}: "
          f"{c['sin_text']} sin nadie en Text, {c['otro_numero']} con otro número de «DNI :» que su total, "
          f"{c['sin_responsabilidad']} con alguna persona que no se pudo leer")


SQL_PERSONAS_TEMP = """CREATE TEMP TABLE _icp (codigo TEXT, orden SMALLINT, doc TEXT, nombre TEXT, responsabilidades TEXT[])
  ON COMMIT DROP"""
SQL_PERSONAS_LOTE = """INSERT INTO _icp SELECT codigo, orden, doc, nombre, responsabilidades FROM jsonb_to_recordset(%s::jsonb)
  AS x (codigo TEXT, orden SMALLINT, doc TEXT, nombre TEXT, responsabilidades TEXT[])"""
# Las de un informe leído que ya no están en su lista (la lista se acortó). Un informe sin nadie esta vez no entra a _icp.
SQL_PERSONAS_BORRAR = """DELETE FROM informe_control_persona p
  WHERE p.codigo IN (SELECT DISTINCT codigo FROM _icp)
    AND NOT EXISTS (SELECT 1 FROM _icp t WHERE t.codigo = p.codigo AND t.orden = p.orden)"""
SQL_PERSONAS_UPSERT = """INSERT INTO informe_control_persona AS p (codigo, orden, doc, nombre, responsabilidades)
  SELECT codigo, orden, doc, nombre, responsabilidades FROM _icp
  ON CONFLICT (codigo, orden) DO UPDATE SET doc = EXCLUDED.doc, nombre = EXCLUDED.nombre,
    responsabilidades = EXCLUDED.responsabilidades, cargado_at = now()
  WHERE (p.doc, p.nombre, p.responsabilidades) IS DISTINCT FROM (EXCLUDED.doc, EXCLUDED.nombre, EXCLUDED.responsabilidades)"""


def escribir_personas(cur, gente: dict[str, tuple[list[dict], int]]) -> tuple[int, int, int]:
    """Las personas de cada informe leído, en la misma transacción que los informes. Devuelve (escritas o cambiadas,
    borradas, total en la tabla). Un error no se imprime con su DETAIL: Postgres pone ahí los valores de la fila."""
    import psycopg2
    filas = [{"codigo": codigo, **p} for codigo, (ps, _) in gente.items() for p in ps]
    try:
        cur.execute(SQL_PERSONAS_TEMP)
        for k in range(0, len(filas), 5000):
            cur.execute(SQL_PERSONAS_LOTE, (json.dumps(filas[k:k + 5000], ensure_ascii=False),))
        # Sin estadísticas, el DELETE de abajo puede elegir un plan que compara cada fila con todas.
        cur.execute("CREATE INDEX ON _icp (codigo, orden)")
        cur.execute("ANALYZE _icp")
        cur.execute(SQL_PERSONAS_BORRAR)
        borradas = cur.rowcount
        cur.execute(SQL_PERSONAS_UPSERT)
        escritas = cur.rowcount
        cur.execute("SELECT count(*) FROM informe_control_persona")
        (total,) = cur.fetchone()
    except psycopg2.Error as e:
        raise SystemExit(f"personas: error {e.pgcode}: {e.diag.message_primary}") from None
    return escritas, borradas, total


def pagina(n: int, resp: list[str], gente: dict[str, tuple[list[dict], int]] | None = None) -> tuple[list[dict], int, int]:
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
    informes = []
    for f in filas:
        i = a_informe(f)
        if i:
            informes.append(i)
            if gente is not None:
                gente[i["codigo"]] = personas(f)
    return informes, total_paginas, total


def main() -> int:
    ap = argparse.ArgumentParser(description="Carga los informes de control de la Contraloría (responsabilidad presunta).")
    ap.add_argument("--entorno", choices=["dev", "prod"], help="dev = vigia-db-dev, prod = vigia-db")
    ap.add_argument("--seco", action="store_true", help="sólo baja y cuenta, no escribe")
    ap.add_argument("--responsabilidades", default=",".join(RESPONSABILIDADES),
                    help=f"separadas por coma (por defecto: {','.join(RESPONSABILIDADES)})")
    ap.add_argument("--personas", action="store_true",
                    help="también las personas de cada informe → informe_control_persona (migración 302); sólo imprime conteos")
    a = ap.parse_args()
    if not a.seco and not a.entorno:
        ap.error("falta --entorno (o --seco)")
    sys.stdout.reconfigure(encoding="utf-8")
    resp = [r.strip().upper() for r in a.responsabilidades.split(",") if r.strip()]

    informes: dict[str, dict] = {}
    gente: dict[str, tuple[list[dict], int]] | None = {} if a.personas else None
    n, paginas, total = 1, 1, 0
    while n <= paginas and n <= 60:
        filas, paginas, total = pagina(n, resp, gente)
        for i in filas:
            informes[i["codigo"]] = i
        print(f"  página {n}/{paginas}: {len(filas)} informes")
        n += 1
        time.sleep(1)    # un pedido por segundo como máximo
    print(f"Buscador: {total} informes; leídos {len(informes)} distintos")
    if gente is not None:
        verificar(informes, gente)
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
            if gente is not None:
                # Después de los informes: cada persona apunta a su informe (llave foránea).
                p_escritas, p_borradas, p_total = escribir_personas(cur, gente)
                print(f"Personas: {p_escritas} nuevas o cambiadas, {p_borradas} quitadas; {p_total} en informe_control_persona")
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
        if gente is not None:
            # Lo que sale de las personas (migración 308): la señal del locador que un informe de su entidad comprende y que
            # recibió órdenes de ella después, y el resumen de las listas de personas. Cada uno en su transacción; si la
            # función no está en esa base, se salta. Las banderas de los contratos (303) las rehace la cadena de cruces.
            for f in ("refrescar_persona_informe_control", "refrescar_personas_resumen"):
                with con, con.cursor() as cur:
                    cur.execute("SELECT to_regprocedure(%s) IS NOT NULL", (f"{f}()",))
                    if cur.fetchone()[0]:
                        cur.execute("SET LOCAL statement_timeout = 0")
                        cur.execute(f"SELECT {f}()")
                        print(f"  {f}(): {cur.fetchone()[0]}")
    print(f"✓ {BASES[a.entorno]}: {escritos} nuevos o cambiados · {tot} informes, {con_ruc} con RUC "
          f"({con_ruc / max(tot, 1):.1%}), {con_ubigeo} con distrito, {ambiguos} ambiguos")
    return 0


if __name__ == "__main__":
    sys.exit(main())
