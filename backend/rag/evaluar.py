"""Evalúa recall@k del RAG normativo con evalset.jsonl (≥ 40 preguntas derivadas de las reglas de
backend/agent/tools/compliance_rules.py).

    python -m backend.rag.evaluar                 # recall@5 por corpus, tabla + fallos
    python -m backend.rag.evaluar --k 10 --verbose
    python -m backend.rag.evaluar --solo fracc-32069-ley plazo-conv-32069

Una pregunta acierta si alguno de los k chunks del corpus indicado cumple alguno de sus
`esperado`: {slug, articulo?} (slug exacto + artículo si se indica), {slug_prefijo, texto_contiene?}
(p. ej. cualquier opinión cuyo texto mencione "fraccion"). Guarda el detalle en
backend/rag/.cache/eval-<fecha>.json para documentar cada intento en docs/design/RAG_NORMATIVO.md.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path

from ._comun import AQUI, CACHE_DIR
from .recuperar import catalogo, consultar

EVALSET = AQUI / "evalset.jsonl"


def cargar_evalset() -> list[dict]:
    out = []
    for ln in EVALSET.read_text(encoding="utf-8").splitlines():
        ln = ln.strip()
        if ln and not ln.startswith("#"):
            out.append(json.loads(ln))
    return out


def _slug_de(match: dict, cat: dict) -> str:
    meta = cat.get(match.get("source_uri") or "") or {}
    return meta.get("slug") or ""


def cumple(match: dict, esperado: dict, cat: dict) -> bool:
    slug = _slug_de(match, cat)
    if esperado.get("slug"):
        if slug != esperado["slug"]:
            return False
        if esperado.get("articulo") and str(match.get("articulo")) != str(esperado["articulo"]):
            return False
        return True
    if esperado.get("slug_prefijo"):
        if not slug.startswith(esperado["slug_prefijo"]):
            return False
        if esperado.get("texto_contiene") and not re.search(esperado["texto_contiene"], match.get("cita") or "", re.I):
            return False
        return True
    return False


def evaluar(preguntas: list[dict], k: int, verbose: bool = False) -> dict:
    cat = catalogo()
    resultados = []
    for q in preguntas:
        res = consultar(q["pregunta"], regimen=None, top=k, corpus=[q["corpus"]])
        matches = res["por_corpus"].get(q["corpus"], [])
        rank = None
        for i, m in enumerate(matches, 1):
            if any(cumple(m, e, cat) for e in q["esperado"]):
                rank = i
                break
        resultados.append({"id": q["id"], "corpus": q["corpus"], "regimen": q.get("regimen"), "regla": q.get("regla"),
                           "hit": rank is not None, "rank": rank, "ms": res["ms"], "error": res["errores"].get(q["corpus"]),
                           "devuelto": [{"slug": _slug_de(m, cat), "articulo": m.get("articulo"),
                                         "score": m.get("score")} for m in matches]})
        marca = "✓" if rank else "✗"
        print(f"  {marca} {q['id']:32s} {q['corpus']:22s} rank={rank or '-'}  {res['ms']} ms")
        if verbose or not rank:
            for d in resultados[-1]["devuelto"]:
                sc = f"{d['score']:.3f}" if isinstance(d["score"], (int, float)) else "?"
                print(f"        [{sc}] {d['slug']} art. {d['articulo']}")
    return {"k": k, "fecha": dt.datetime.now().isoformat(timespec="seconds"), "resultados": resultados}


def tabla(ev: dict) -> str:
    por: dict[str, list] = {}
    for r in ev["resultados"]:
        por.setdefault(r["corpus"], []).append(r)
    filas = [f"| corpus | preguntas | aciertos | recall@{ev['k']} | MRR |", "|---|---|---|---|---|"]
    tot_n = tot_h = 0
    tot_mrr = 0.0
    for c, lst in sorted(por.items()):
        n, h = len(lst), sum(1 for r in lst if r["hit"])
        mrr = sum(1 / r["rank"] for r in lst if r["rank"]) / n
        tot_n += n; tot_h += h; tot_mrr += sum(1 / r["rank"] for r in lst if r["rank"])
        filas.append(f"| {c} | {n} | {h} | {h/n:.2f} | {mrr:.2f} |")
    filas.append(f"| **total** | {tot_n} | {tot_h} | **{tot_h/tot_n:.2f}** | {tot_mrr/tot_n:.2f} |")
    return "\n".join(filas)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--k", type=int, default=5)
    ap.add_argument("--solo", nargs="*")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args(argv)
    preguntas = cargar_evalset()
    if args.solo:
        preguntas = [q for q in preguntas if q["id"] in set(args.solo)]
    print(f"{len(preguntas)} preguntas, k={args.k}\n")
    ev = evaluar(preguntas, args.k, args.verbose)
    print("\n" + tabla(ev))
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    out = CACHE_DIR / f"eval-{dt.datetime.now():%Y%m%d-%H%M%S}.json"
    out.write_text(json.dumps(ev, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\ndetalle: {out}")
    total = sum(1 for r in ev["resultados"] if r["hit"]) / max(1, len(ev["resultados"]))
    return 0 if total >= 0.8 else 1


if __name__ == "__main__":
    sys.exit(main())
