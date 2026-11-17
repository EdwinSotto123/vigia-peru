"""Lo que mide Cloudflare del uso de Workers AI, por día y modelo, a `gasto_ia_dia` (migración 336). GET
/transparencia/gasto lo pone al lado de los libros de la base, que no anotan todo (laboratorio de precios, lecturas de
empleo, pruebas sueltas).

    python -X utf8 backend/scripts/gasto_workers_ai.py prod [--dias 31] [--medir]

Lee el GraphQL de Cloudflare (aiInferenceAdaptiveGroups: neuronas por día y modelo) con el token de despliegue de
~/.simplia/secretos.env (CF_TOKEN_DESPLIEGUE; nunca se imprime) y convierte neuronas a dólares con la tarifa de Workers AI
(US$ 0,011 por 1 000 neuronas). Los días son UTC, como los agrupa Cloudflare. `--medir` imprime sin escribir.
Corre desde una máquina con el token: la API no lo tiene. Rehacer un día lo reemplaza (el de hoy va creciendo).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "infrastructure" / "aws"))

USD_POR_NEURONA = 0.011 / 1000
API = "https://api.cloudflare.com/client/v4"


def token() -> str:
    txt = (Path.home() / ".simplia" / "secretos.env").read_text(encoding="utf-8")
    m = re.search(r"^\s*(?:export\s+)?CF_TOKEN_DESPLIEGUE=[\"']?([^\"'\r\n]+)", txt, re.M)
    if not m:
        sys.exit("falta CF_TOKEN_DESPLIEGUE en ~/.simplia/secretos.env")
    return m.group(1)


def llamar(tk: str, metodo: str, ruta: str, cuerpo: dict | None = None) -> dict:
    req = urllib.request.Request(f"{API}{ruta}", method=metodo, data=json.dumps(cuerpo).encode() if cuerpo else None,
                                 headers={"Authorization": f"Bearer {tk}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return json.loads(e.read() or b"{}")


def medir(dias: int) -> list[tuple[str, str, int, int, float]]:
    """→ [(día, modelo, neuronas, pedidos, usd)]."""
    tk = token()
    cuentas = llamar(tk, "GET", "/accounts?per_page=5").get("result") or []
    if not cuentas:
        sys.exit("el token no ve ninguna cuenta de Cloudflare")
    desde = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=min(dias, 31))).date().isoformat()
    q = """query($a:String!,$d:Date!){viewer{accounts(filter:{accountTag:$a}){
      ai: aiInferenceAdaptiveGroups(limit:5000, filter:{date_geq:$d}, orderBy:[date_ASC]){
        count sum{ totalNeurons } dimensions{ date modelId } } }}}"""
    r = llamar(tk, "POST", "/graphql", {"query": q, "variables": {"a": cuentas[0]["id"], "d": desde}})
    if r.get("errors"):
        sys.exit(f"GraphQL: {json.dumps(r['errors'])[:400]}")
    filas = (((r.get("data") or {}).get("viewer") or {}).get("accounts") or [{}])[0].get("ai") or []
    out = []
    for f in filas:
        n = int(f["sum"]["totalNeurons"] or 0)
        out.append((f["dimensions"]["date"], f["dimensions"]["modelId"], n, int(f["count"] or 0), round(n * USD_POR_NEURONA, 4)))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("entorno", choices=["dev", "prod"])
    # Cloudflare no responde rangos de más de 4 semanas y 4 días.
    ap.add_argument("--dias", type=int, default=31)
    ap.add_argument("--medir", action="store_true", help="imprime sin escribir")
    a = ap.parse_args()
    filas = medir(a.dias)
    por_dia: dict[str, float] = {}
    for d, _, _, _, usd in filas:
        por_dia[d] = por_dia.get(d, 0) + usd
    for d in sorted(por_dia):
        print(f"{d}  US$ {por_dia[d]:10,.2f}")
    print(f"total US$ {sum(por_dia.values()):,.2f} en {len(por_dia)} días, {len(filas)} filas día-modelo")
    if a.medir:
        return
    from psycopg2.extras import execute_values
    from tunel_rds import conexion

    with conexion(a.entorno) as cn:
        cur = cn.cursor()
        execute_values(cur, """INSERT INTO gasto_ia_dia (dia, proveedor, modelo, neuronas, pedidos, usd, medido_at)
                               VALUES %s
                               ON CONFLICT (dia, proveedor, modelo) DO UPDATE SET neuronas = EXCLUDED.neuronas,
                                 pedidos = EXCLUDED.pedidos, usd = EXCLUDED.usd, medido_at = now()""",
                       [(d, "workers_ai", m, n, p, usd, dt.datetime.now(dt.timezone.utc)) for d, m, n, p, usd in filas])
        cn.commit()
    print(f"guardadas {len(filas)} filas en gasto_ia_dia ({a.entorno})")


if __name__ == "__main__":
    main()
