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
            mismo_doc = e.get("slug") and (e["slug"] == _slug_de(m) or e["slug"] in str(m.get("uri") or ""))
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
    n = hit = primero_norma = malos = total = 0
    mrr = 0.0
    fallas = []
    for c in casos:
        reg = str(c["regimen"])
        ms = buscar(c["pregunta"], reg)[:8]
        n += 1
        p = _acierto(c.get("esperado") or [], ms)
        if p:
            hit += 1
            mrr += 1.0 / p
        else:
            fallas.append((c["id"], [(m.get("numero") or m.get("documento") or "")[:26] + ":" + str(m.get("articulo")) for m in ms[:3]]))
        if ms and (ms[0].get("aplica") == "norma" or ms[0].get("tipo") in ("ley", "reglamento", "norma") or str(ms[0].get("corpus", "")).startswith("normas")):
            primero_norma += 1
        malos += sum(1 for m in ms if _regimen_equivocado(reg, m))
        total += len(ms)
    r = {"sistema": nombre, "preguntas": n, "acierto@8": round(hit / n, 3), "MRR": round(mrr / n, 3), "norma_primero": round(primero_norma / n, 3),
         "regimen_equivocado": f"{malos} de {total} ({round(100 * malos / max(1, total), 1)} %)"}
    print(json.dumps(r, ensure_ascii=False))
    if detalle:
        for f in fallas[:25]:
            print("   sin acierto:", f)
    return r


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--solo", choices=["nuevo", "chroma"])
    ap.add_argument("--detalle", action="store_true")
    a = ap.parse_args()
    _entorno()
    casos = _casos()
    from tunel_rds import conexion
    if a.solo != "chroma":
        from tools import normas_rag as N
        with conexion("prod") as cn:
            cn.set_session(readonly=True, autocommit=True)

            def nuevo(q, reg):
                r = N.buscar_normas(q, FECHA[reg], conn=cn)
                ms = r.get("matches") or []
                for m in ms:        # el slug no va en la respuesta al agente: se recupera para medir
                    m["slug"] = m.get("slug") or ""
                return ms
            # Para medir hace falta el slug: se pide el candidato crudo y se elige igual que el agente.
            def nuevo_con_slug(q, reg):
                vec = N.embeber_pregunta(q)
                cur = cn.cursor()
                cur.execute("SELECT * FROM buscar_norma(%s, %s::halfvec, %s, 40, NULL)",
                            (q, ("[" + ",".join(f"{x:.6f}" for x in vec) + "]") if vec else None, FECHA[reg]))
                cols = [d[0] for d in cur.description]
                filas = N.elegir([dict(zip(cols, x)) for x in cur.fetchall()])
                otro = "30225" if reg == "32069" else "32069"
                for f in filas:
                    if f["aplica"] == "criterio_anterior":
                        f["advertencia"] = f"emitido bajo la ley {otro}"
                return filas
            medir("vigia_normas", nuevo_con_slug, casos, a.detalle)
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

        def chroma(q, reg):
            ms = (L.query_legal_rag_chroma(q, regimen=reg).get("matches") or [])
            for m in ms:
                m["slug"] = por_numero.get(str(m.get("numero") or "")) or por_numero.get(str(m.get("documento") or "")) or ""
            return ms
        medir("chroma", chroma, casos, a.detalle)


if __name__ == "__main__":
    main()
