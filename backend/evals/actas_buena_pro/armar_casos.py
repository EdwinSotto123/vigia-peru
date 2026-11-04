#!/usr/bin/env python3
"""Arma el set de 100 actas de buena pro con su respuesta oficial (CONOSCE), en datos/ (fuera del repo).

Respuesta oficial de cada caso, del registro de CONOSCE (no de un modelo): quiénes presentaron oferta
(conosce_postores), quién ganó y por cuánto (conosce_adjudicaciones). Sólo procesos de UN ítem y UN ganador en soles,
para que el acta y el registro hablen de lo mismo.

Estratos («prometedores»: donde hay algo que mirar), con su etiqueta en `tags[0]`:
  bandera_alta     50  el contrato ya tiene una bandera de severidad alta en Vigía (casos_cruce)
  varios_postores  30  compitieron dos o más y no tiene bandera alta: ahí aparecen las descalificaciones
  postor_unico     20  se presentó uno solo
Se incluyen las 14 actas del piloto con Opus 5.5 que entren (etiqueta extra `con_opus`), para comparar.

Lectura de la base de producción (sólo SELECT) por el túnel; documentos por vigia-r2-sync; tokens contados gratis con
Haiku (count_tokens) para dejar fuera lo que pase de TOPE_TOKENS.
  python -X utf8 backend/evals/actas_buena_pro/armar_casos.py
"""
from __future__ import annotations

import io
import json
import random
import sys
import zipfile
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from comun import CASOS, CLIENTE, DATOS, PDFS, R2_URL, cliente_claude, mensajes, SISTEMA, ssm  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "infrastructure" / "aws"))
from tunel_rds import conexion  # noqa: E402

CUPOS = {"bandera_alta": 50, "varios_postores": 30, "postor_unico": 20}
TOPE_TOKENS = 60_000
TOPE_BYTES_PDF = 20 * 1024 * 1024
SEMILLA = 20261103
PILOTO = DATOS / "opus_piloto.json"

SQL = """
WITH d AS (
  SELECT DISTINCT ON (ocid) ocid, url_gcs, bytes FROM documentos_gcs
   WHERE tipo = 'awardNotice' AND lower(formato) = 'zip' AND borrado_at IS NULL AND bytes BETWEEN 100000 AND 3000000
   ORDER BY ocid, creado_at DESC),
c AS (SELECT d.*, v.codigo FROM d JOIN convocatorias v ON v.ocid = d.ocid WHERE v.codigo IS NOT NULL),
adj AS (
  SELECT codigo_convocatoria, count(DISTINCT n_item) AS items, count(DISTINCT ruc_proveedor) AS ganadores,
         min(ruc_proveedor) AS ruc_ganador, sum(monto_adjudicado) AS monto,
         bool_and(moneda IN ('Soles', 'Nuevos Soles')) AS soles
    FROM conosce_adjudicaciones WHERE codigo_convocatoria IN (SELECT codigo FROM c) GROUP BY 1),
pos AS (
  SELECT codigo_convocatoria, count(DISTINCT n_item) AS items, array_agg(DISTINCT ruc_postor) AS rucs
    FROM conosce_postores WHERE codigo_convocatoria IN (SELECT codigo FROM c) GROUP BY 1),
cc AS (SELECT ocid, bool_or(severidad = 'alta') AS alta, array_agg(DISTINCT t) AS tipos
         FROM casos_cruce, unnest(tipos) t WHERE ocid IN (SELECT ocid FROM c) GROUP BY ocid)
SELECT c.ocid, c.codigo, c.url_gcs, c.bytes, adj.ruc_ganador, adj.monto, pos.rucs, COALESCE(cc.alta, false), cc.tipos
  FROM c JOIN adj ON adj.codigo_convocatoria = c.codigo JOIN pos ON pos.codigo_convocatoria = c.codigo
  LEFT JOIN cc ON cc.ocid = c.ocid
 WHERE adj.items = 1 AND pos.items = 1 AND adj.ganadores = 1 AND adj.soles AND adj.monto > 50000
"""


SQL_OFICIAL = """
SELECT p.codigo_convocatoria, p.ruc_postor, max(p.postor) AS nombre,
       COALESCE((SELECT array_agg(DISTINCT k.ruc_miembro) FROM conosce_consorcios k WHERE k.ruc_consorcio = p.ruc_postor), '{}'),
       bool_or(p.ruc_postor = a.ruc_proveedor) AS ganador, max(a.monto) AS monto
  FROM conosce_postores p
  JOIN (SELECT codigo_convocatoria, min(ruc_proveedor) AS ruc_proveedor, sum(monto_adjudicado) AS monto
          FROM conosce_adjudicaciones WHERE codigo_convocatoria = ANY(%s) GROUP BY 1) a USING (codigo_convocatoria)
 WHERE p.codigo_convocatoria = ANY(%s)
 GROUP BY 1, 2
"""


def oficial(cur, codigos: list[str]) -> dict[str, dict]:
    """La respuesta de CONOSCE por proceso: cada postor con su RUC (un consorcio trae un código propio, no un RUC), su
    nombre y los RUC de sus integrantes; el ganador y el monto adjudicado."""
    cur.execute(SQL_OFICIAL, (codigos, codigos))
    out: dict[str, dict] = {}
    for codigo, ruc, nombre, miembros, ganador, monto in cur.fetchall():
        o = out.setdefault(codigo, {"postores": [], "ganador": None, "monto": float(monto),
                                    "fuente": "CONOSCE (conosce_postores, conosce_adjudicaciones, conosce_consorcios)"})
        p = {"ruc": ruc, "nombre": nombre, "miembros": sorted(m for m in miembros if m)}
        o["postores"].append(p)
        if ganador:
            o["ganador"] = p
    for o in out.values():
        o["postores"].sort(key=lambda p: p["ruc"])
    return out


def estrato(alta: bool, n_postores: int) -> str:
    if n_postores <= 1:
        return "postor_unico"
    return "bandera_alta" if alta else "varios_postores"


def bajar_pdfs(ocid: str, url_gcs: str) -> list[Path]:
    """Sólo los PDF del ZIP, con nombres propios (nunca la ruta que trae el ZIP: zip-slip). Nada se ejecuta."""
    bucket, key = url_gcs.removeprefix("gs://").split("/", 1)
    r = requests.get(R2_URL, params={"bucket": bucket, "key": key},
                     headers={"Authorization": f"Bearer {ssm('/vigia/r2/lector-token')}", "user-agent": CLIENTE}, timeout=120)
    r.raise_for_status()
    carpeta = PDFS / "".join(ch for ch in ocid if ch.isalnum() or ch in "-_")
    carpeta.mkdir(parents=True, exist_ok=True)
    out, total = [], 0
    with zipfile.ZipFile(io.BytesIO(r.content)) as z:
        for i in sorted(z.infolist(), key=lambda x: x.filename):
            if i.is_dir() or not i.filename.lower().endswith(".pdf") or total + i.file_size > TOPE_BYTES_PDF:
                continue
            datos = z.read(i)
            if not datos.startswith(b"%PDF"):
                continue
            p = carpeta / f"{len(out) + 1:02d}.pdf"
            p.write_bytes(datos)
            out.append(p)
            total += i.file_size
    return out


def solo_oficial() -> None:
    """Rehace la respuesta oficial de los casos ya armados (sin bajar de nuevo las actas)."""
    casos = [json.loads(l) for l in CASOS.read_text(encoding="utf-8").splitlines() if l.strip()]
    with conexion("prod") as c:
        cur = c.cursor()
        cur.execute("SET TRANSACTION READ ONLY")
        of = oficial(cur, [x["codigo"] for x in casos])
        c.rollback()
    faltan = [x["id"] for x in casos if x["codigo"] not in of or of[x["codigo"]]["ganador"] is None]
    for x in casos:
        if x["codigo"] in of:
            x["oficial"] = of[x["codigo"]]
    with CASOS.open("w", encoding="utf-8") as f:
        for x in casos:
            f.write(json.dumps(x, ensure_ascii=False) + "\n")
    print(f"respuesta oficial rehecha: {len(casos)} casos; sin ganador entre los postores: {faltan}", flush=True)


def main() -> None:
    if "--solo-oficial" in sys.argv:
        return solo_oficial()
    DATOS.mkdir(exist_ok=True)
    piloto = {r["ocid"] for r in json.loads(PILOTO.read_text(encoding="utf-8"))} if PILOTO.exists() else set()
    with conexion("prod") as c:
        cur = c.cursor()
        cur.execute("SET TRANSACTION READ ONLY")
        cur.execute(SQL)
        filas = cur.fetchall()
        c.rollback()
    print(f"{len(filas)} candidatos", flush=True)
    rnd = random.Random(SEMILLA)
    rnd.shuffle(filas)
    filas.sort(key=lambda f: f[0] not in piloto)          # las del piloto primero (estable: el resto queda barajado)
    claude = cliente_claude()
    elegidos: list[dict] = []
    cuenta = {k: 0 for k in CUPOS}
    for ocid, codigo, url_gcs, _bytes, ruc_ganador, monto, rucs, alta, tipos in filas:
        e = estrato(alta, len(rucs))
        if cuenta[e] >= CUPOS[e]:
            continue
        try:
            pdfs = bajar_pdfs(ocid, url_gcs)
        except Exception as ex:  # noqa: BLE001
            print(f"  {ocid}: no se pudo bajar ({str(ex)[:100]})", flush=True)
            continue
        if not pdfs:
            continue
        try:
            n = claude.messages.count_tokens(model="claude-haiku-5-5", system=SISTEMA, messages=mensajes(pdfs)).input_tokens
        except Exception as ex:  # noqa: BLE001
            print(f"  {ocid}: no se pudo contar ({str(ex)[:160]})", flush=True)
            continue
        if n > TOPE_TOKENS:
            continue
        tags = [e] + (["con_opus"] if ocid in piloto else [])
        elegidos.append({"id": ocid, "codigo": codigo, "tags": tags, "tokens": n,
                         "pdfs": [str(p.relative_to(DATOS)) for p in pdfs],
                         "oficial": {"postores": sorted(rucs), "ruc_ganador": ruc_ganador, "monto": float(monto),
                                     "fuente": "CONOSCE (conosce_postores, conosce_adjudicaciones)"},
                         "banderas_vigia": sorted(tipos or [])})
        cuenta[e] += 1
        print(f"  {ocid}: {e} ({len(rucs)} postores, {n} tokens) {cuenta}", flush=True)
        if all(cuenta[k] >= CUPOS[k] for k in CUPOS):
            break
    with CASOS.open("w", encoding="utf-8") as f:
        for x in elegidos:
            f.write(json.dumps(x, ensure_ascii=False) + "\n")
    solo_oficial()                                       # la respuesta con consorcios, nombres e integrantes
    print(f"FIN: {len(elegidos)} casos {cuenta} → {CASOS}", flush=True)


if __name__ == "__main__":
    main()
