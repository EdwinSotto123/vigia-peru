"""CLI de prueba del RAG normativo.

    python -m backend.rag.consultar "¿plazo mínimo entre convocatoria y presentación de ofertas en licitación pública?" --regimen 32069 --top 5
    python -m backend.rag.consultar "causales de contratación directa" --regimen 30225 --json
    python -m backend.rag.consultar "matriz condición criterio causa efecto" --corpus control-cgr

Imprime, por chunk: corpus · documento · artículo/página · score · cita · url_oficial.
"""
from __future__ import annotations

import argparse
import json
import sys

from ._comun import CORPUS
from .recuperar import consultar


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pregunta")
    ap.add_argument("--regimen", choices=["32069", "30225", "ambos"], default="ambos")
    ap.add_argument("--top", type=int, default=5)
    ap.add_argument("--corpus", nargs="*", choices=CORPUS, help="fuerza los corpus a consultar")
    ap.add_argument("--distancia-max", type=float, default=None, help="vector_distance_threshold")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)

    res = consultar(args.pregunta, regimen=None if args.regimen == "ambos" else args.regimen,
                    top=args.top, corpus=args.corpus, distancia_max=args.distancia_max)
    if args.json:
        print(json.dumps(res, ensure_ascii=False, indent=1))
        return 0
    print(f"pregunta: {res['pregunta']}  (régimen {args.regimen}; corpus {', '.join(res['corpus'])}; {res['ms']} ms)")
    for n, err in res["errores"].items():
        print(f"  ! {n}: {err}")
    for n, lst in res["por_corpus"].items():
        print(f"\n── {n} ({len(lst)} chunks)")
        for i, m in enumerate(lst, 1):
            art = f"Art. {m['articulo']}" if m["articulo"] else "—"
            pag = f"p. {m['pagina']}" if m["pagina"] else ""
            sc = f"{m['score']:.3f}" if isinstance(m["score"], (int, float)) else "?"
            print(f"  {i}. [{sc}] {m['documento']} · {art} {pag}")
            print(f"     {m['cita'][:300]}")
            print(f"     {m['url_oficial']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
