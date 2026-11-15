"""Evalúa el RAG normativo propio (tools/normas_rag.py) contra el anterior (Chroma) con el mismo conjunto de preguntas.

    python -X utf8 -m backend.rag.evaluar_normas [--solo nuevo|chroma] [--detalle]

Conjunto: backend/rag/evalset.jsonl (pregunta, régimen, artículos esperados) + backend/rag/evalset_fechas.jsonl (la
misma pregunta en las dos fechas: tiene que cambiar la norma). Mide, sobre los 8 primeros resultados:
  · acierto@8 y MRR: ¿está el artículo esperado y en qué puesto?
  · norma primero: ¿el primer resultado es una norma aplicable (no una opinión)?
  · régimen equivocado: resultados que citan la OTRA ley sin advertirlo (lo que hacía alucinar al agente legal).
Las claves salen de la configuración de la Lambda; no se imprimen."""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "infrastructure" / "aws"))
sys.path.insert(0, str(RAIZ / "backend" / "agent"))
FECHA = {"32069": "2026-06-01", "30225": "2024-06-01"}
OTRA = {"32069": ("30225", "344-2018", "082-2019", "1444"), "30225": ("32069", "009-2025")}


def _entorno() -> None:
    env = json.loads(subprocess.run(["aws", "lambda", "get-function-configuration", "--region", "us-east-2", "--function-name",
                                     "vigia-agente-servicios", "--query", "Environment.Variables", "--output", "json"],
                                    capture_output=True, text=True, encoding="utf-8").stdout or "{}")
    for k, v in env.items():
        if k.startswith(("CHROMA", "WORKERS_AI", "LEGAL_RAG", "RAG_")):
            os.environ.setdefault(k, v)


def _casos() -> list[dict]:
    casos = []
    for nombre in ("evalset.jsonl", "evalset_fechas.jsonl"):
        f = Path(__file__).with_name(nombre)
        if f.exists():
            casos += [json.loads(l) for l in f.read_text(encoding="utf-8").splitlines() if l.strip()]
    # «ambos» (criterios y control que valen en los dos regímenes) se pregunta con la fecha de hoy.
    for c in casos:
        if str(c.get("regimen")) not in FECHA:
            c["regimen"] = "32069"
    return casos


def _slug_de(m: dict) -> str:
    return str(m.get("slug") or "")


def _acierto(esperado: list[dict], matches: list[dict]) -> int | None:
    """Puesto (desde 1) del primer resultado que es un artículo esperado; None si no está."""
    for i, m in enumerate(matches, 1):
        for e in esperado:
            if e.get("slug_prefijo"):
                if _slug_de(m).startswith(e["slug_prefijo"]) and str(e.get("texto_contiene") or "").lower() in str(m.get("texto") or m.get("cita") or "").lower():
                    return i
                continue
            # «ley-32069-art-30-impedimentos» es el artículo 30 de «ley-32069» (el cuadro que el consolidado sólo enlaza).
            mismo_doc = e.get("slug") and (e["slug"] == _slug_de(m) or _slug_de(m).startswith(e["slug"] + "-art-") or e["slug"] in str(m.get("uri") or ""))
            if mismo_doc and (not e.get("articulo") or str(e["articulo"]).split(".")[0] == str(m.get("articulo") or "").split(".")[0]):
                return i
    return None


def _regimen_equivocado(reg: str, m: dict) -> bool:
    """Cita la otra ley y no lo advierte."""
    if m.get("advertencia"):
        return False
    texto = f"{m.get('documento') or ''} {m.get('numero') or ''} {m.get('regimen') or ''}"
    return any(x in texto for x in OTRA[reg]) or str(m.get("regimen") or "") == OTRA[reg][0]


def medir(nombre: str, buscar, casos: list[dict], detalle: bool) -> dict:
    n = hit = hit10 = primero_norma = malos = total = 0
    mrr = 0.0
    fallas, por_caso = [], []
    for c in casos:
        reg = str(c["regimen"])
        todos = buscar(c["pregunta"], reg, c.get("fecha"))[:10]      # `fecha`: preguntas que dependen de la versión de la norma
        ms = todos[:8]
        n += 1
        p = _acierto(c.get("esperado") or [], ms)
        # Lo que de verdad recibe el agente son hasta 10: los dos últimos son criterios de la otra ley (por analogía).
        hit10 += 1 if _acierto(c.get("esperado") or [], todos) else 0
        por_caso.append({"caso": c, "puesto": p,
                         "primeros": [f"{(m.get('documento') or m.get('numero') or '')[:90]}" + (f", art. {m['articulo']}" if m.get("articulo") else "")
                                      + (f" ({m['aplica']})" if m.get("aplica") and m["aplica"] != "norma" else "") for m in ms[:8]]})
        if p:
            hit += 1
            mrr += 1.0 / p
        else:
            fallas.append((c["id"], [(m.get("numero") or m.get("documento") or "")[:26] + ":" + str(m.get("articulo")) for m in ms[:3]]))
        if ms and (ms[0].get("aplica") == "norma" or ms[0].get("tipo") in ("ley", "reglamento", "norma") or str(ms[0].get("corpus", "")).startswith("normas")):
            primero_norma += 1
        malos += sum(1 for m in ms if _regimen_equivocado(reg, m))
        total += len(ms)
    r = {"sistema": nombre, "preguntas": n, "acierto@8": round(hit / n, 3), "acierto@10": round(hit10 / n, 3), "MRR": round(mrr / n, 3),
         "norma_primero": round(primero_norma / n, 3),
         "regimen_equivocado": f"{malos} de {total} ({round(100 * malos / max(1, total), 1)} %)"}
    print(json.dumps(r, ensure_ascii=False))
    if detalle:
        for f in fallas[:25]:
            print("   sin acierto:", f)
    r["por_caso"] = por_caso
    return r


def subir(destino: str, r: dict, nota: str | None) -> None:
    """La medición al panel (/admin/golden, conjunto `rag_normas`): cada pregunta con su puesto y lo que salió primero."""
    import datetime as dt
    from tunel_rds import conexion
    corrida = "normas-" + dt.datetime.now().strftime("%Y%m%d-%H%M")
    with conexion(destino) as cn:
        cu = cn.cursor()
        for x in r["por_caso"]:
            c = x["caso"]
            esperado = [(e.get("slug") or (e.get("slug_prefijo", "") + "…")) + (f", art. {e['articulo']}" if e.get("articulo") else "") for e in c.get("esperado") or []]
            cu.execute("""INSERT INTO golden_caso (conjunto, caso, titulo, perfil, fecha, regimen, esperado) VALUES ('rag_normas', %s, %s, %s, %s, %s, %s)
                          ON CONFLICT (conjunto, caso) DO UPDATE SET titulo = EXCLUDED.titulo, perfil = EXCLUDED.perfil, fecha = EXCLUDED.fecha,
                            regimen = EXCLUDED.regimen, esperado = EXCLUDED.esperado""",
                       (c["id"], c["pregunta"][:400], c.get("regla"), c.get("fecha") or FECHA[str(c["regimen"])], str(c["regimen"]),
                        json.dumps({"pregunta": c["pregunta"], "esperado": esperado}, ensure_ascii=False)))
        cu.execute("UPDATE golden_conjunto SET casos = (SELECT count(*) FROM golden_caso WHERE conjunto = 'rag_normas'), actualizado_at = now() WHERE clave = 'rag_normas'")
        metricas = {k: r[k] for k in ("acierto@8", "acierto@10", "MRR", "norma_primero", "regimen_equivocado", "preguntas")}
        cu.execute("""INSERT INTO golden_corrida (conjunto, corrida, variante, imagen, contratos, errores, exhaustividad_pct, f1, metricas, nota)
                      VALUES ('rag_normas', %s, %s, %s, %s, 0, %s, %s, %s, %s)
                      ON CONFLICT (conjunto, corrida, variante) DO UPDATE SET metricas = EXCLUDED.metricas, nota = EXCLUDED.nota RETURNING id""",
                   (corrida, r["sistema"], r["sistema"], r["preguntas"], round(100 * r["acierto@8"], 1), r["MRR"], json.dumps(metricas, ensure_ascii=False), nota))
        cid = cu.fetchone()[0]
        cu.execute("DELETE FROM golden_resultado WHERE corrida_id = %s", (cid,))
        for x in r["por_caso"]:
            cu.execute("""INSERT INTO golden_resultado (corrida_id, caso, estado, aciertos, omisiones, detalle) VALUES (%s, %s, 'ok', %s, %s, %s)""",
                       (cid, x["caso"]["id"], ["norma_esperada"] if x["puesto"] else [], [] if x["puesto"] else ["norma_esperada"],
                        json.dumps({"puesto": x["puesto"], "primeros": x["primeros"]}, ensure_ascii=False)))
        cn.commit()
    print(f"subida: rag_normas {corrida} ({r['sistema']}), {len(r['por_caso'])} preguntas")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--solo", choices=["nuevo", "chroma"])
    ap.add_argument("--detalle", action="store_true")
    ap.add_argument("--subir", choices=["dev", "prod"], help="guarda la medición en el panel (conjunto rag_normas)")
    ap.add_argument("--nota")
    a = ap.parse_args()
    _entorno()
    casos = _casos()
    from tunel_rds import conexion
    if a.solo != "chroma":
        from tools import normas_rag as N
        with conexion("prod") as cn:
            cn.set_session(readonly=True, autocommit=True)

            def nuevo(q, reg, fecha=None):
                r = N.buscar_normas(q, fecha or FECHA[reg], conn=cn)
                ms = r.get("matches") or []
                for m in ms:        # el slug no va en la respuesta al agente: se recupera para medir
                    m["slug"] = m.get("slug") or ""
                return ms
            # Para medir hace falta el slug: se pide el candidato crudo y se elige igual que el agente.
            def nuevo_con_slug(q, reg, fecha=None):
                vec = N.embeber_pregunta(q)
                cur = cn.cursor()
                cur.execute("SELECT * FROM buscar_norma(%s, %s::halfvec, %s, 40, NULL)",
                            (q, ("[" + ",".join(f"{x:.6f}" for x in vec) + "]") if vec else None, fecha or FECHA[reg]))
                cols = [d[0] for d in cur.description]
                filas = N.elegir([dict(zip(cols, x)) for x in cur.fetchall()])
                # Igual que el agente: si el artículo tenía otro texto en esa fecha, cuenta esa versión.
                N.texto_de_la_fecha(cur, filas, N._fecha(fecha or FECHA[reg]))
                for f in filas:
                    f["slug"] = f.get("slug_version") or f["slug"]
                otro = "30225" if reg == "32069" else "32069"
                for f in filas:
                    if f["aplica"] == "criterio_anterior":
                        f["advertencia"] = f"emitido bajo la ley {otro}"
                return filas
            res = medir("vigia_normas", nuevo_con_slug, casos, a.detalle)
        if a.subir:
            subir(a.subir, res, a.nota)
    if a.solo != "nuevo":
        from tools import legal as L

        # Chroma no devuelve el slug: se recupera por el número de la norma (el catálogo ya está en la base).
        with conexion("prod") as cn2:
            cu2 = cn2.cursor()
            cu2.execute("SELECT numero, documento, slug FROM norma")
            por_numero = {}
            for numero, documento, slug in cu2.fetchall():
                por_numero[str(numero or "")] = slug
                por_numero[str(documento or "")] = slug

        def chroma(q, reg, fecha=None):
            ms = (L.query_legal_rag_chroma(q, regimen=reg).get("matches") or [])
            for m in ms:
                m["slug"] = por_numero.get(str(m.get("numero") or "")) or por_numero.get(str(m.get("documento") or "")) or ""
            return ms
        res = medir("chroma", chroma, casos, a.detalle)
        if a.subir:
            subir(a.subir, res, a.nota)


if __name__ == "__main__":
    main()
