#!/usr/bin/env python3
"""
Evals de Vigía Perú — calidad del análisis agéntico, para el pitch.

Lee análisis YA persistidos del orquestador (HTTP, sin credenciales de DB) y
corre 4 evaluadores sobre data limpia:

  1. respaldo_de_bandera  (LLM)  — ¿la evidencia de cada bandera es concreta y
                                    verificable, o vaga / posible alucinación?
  2. cita_evidencia       (code) — ¿cada bandera cita norma + fuente_url? (gratis)
  3. plausibilidad_precio (LLM)  — ¿el veredicto de mercado se sostiene con los
                                    precios observados?
  4. tono_no_acusatorio   (LLM)  — ¿el dictamen respeta "señal de riesgo", sin
                                    acusar de delito? (principio innegociable #1)

Salida: métricas por OCID + un resumen global listo para el pitch
        (% banderas con respaldo, % precios plausibles, etc.).

Uso:
    export GOOGLE_API_KEY=...          # la misma key del orquestador (AI Studio)
    python backend/scripts/evals_vigia.py --ocid 1221190
    python backend/scripts/evals_vigia.py --all --limit 10

    # Consolidar en Phoenix Cloud (sube los evals como anotaciones de span,
    # para que el phoenix-mcp pueda introspeccionarlos junto a las trazas):
    export PHOENIX_API_KEY=...
    python backend/scripts/evals_vigia.py --ocid 1221190 --phoenix

Cero dependencias: solo stdlib (urllib/json). El juez es Gemini vía REST.
Los evals se ESCRIBEN en Phoenix (no en AX) → un solo lugar para el MCP.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.request
import urllib.error
import urllib.parse

ORCH_URL = os.getenv(
    "ORCHESTRATOR_URL",
    "https://agent-orchestrator-adk-oq3gq6a4ka-uc.a.run.app",
).rstrip("/")
API_KEY = os.getenv("GOOGLE_API_KEY", "")
JUDGE_MODEL = os.getenv("JUDGE_MODEL", "gemini-2.5-flash")
GENAI_URL = (
    f"https://generativelanguage.googleapis.com/v1beta/models/"
    f"{JUDGE_MODEL}:generateContent"
)

# ── Phoenix Cloud (consolidación: trazas + evals viven en el MISMO lugar, así
#    el phoenix-mcp puede introspeccionar ambos en runtime) ───────────────────
PHOENIX_BASE_URL = os.getenv(
    "PHOENIX_BASE_URL", "https://app.phoenix.arize.com/s/edwin-soto-c"
).rstrip("/")
PHOENIX_API_KEY = os.getenv("PHOENIX_API_KEY", "")
PHOENIX_PROJECT = os.getenv("PHOENIX_PROJECT", "vigia-peru")

# ── HTTP helpers ────────────────────────────────────────────────────────────
_ORCH_TOKEN: list[str | None] = []   # memo del ID token (una sola resolución por corrida)


def _orch_auth_headers() -> dict:
    """ID token para el orquestador (servicios de agentes IAM-only, roles/run.invoker).
    Script LOCAL: `AGENT_ID_TOKEN` si está exportado; si no, `gcloud auth print-identity-token`
    de la cuenta activa; sin ninguno, va sin cabecera (sirve mientras el servicio sea público)."""
    if not _ORCH_TOKEN:
        tok = (os.getenv("AGENT_ID_TOKEN") or "").strip() or None
        if not tok:
            import shutil
            import subprocess
            gcloud = shutil.which("gcloud")
            if gcloud:
                try:
                    out = subprocess.run([gcloud, "auth", "print-identity-token"], capture_output=True,
                                         text=True, timeout=30)
                    tok = (out.stdout.strip() or None) if out.returncode == 0 else None
                except (OSError, subprocess.SubprocessError):
                    tok = None
            if not tok:
                print("⚠ sin ID token para el orquestador (AGENT_ID_TOKEN / gcloud): la llamada va sin "
                      "Authorization.", file=sys.stderr)
        _ORCH_TOKEN.append(tok)
    return {"Authorization": f"Bearer {_ORCH_TOKEN[0]}"} if _ORCH_TOKEN[0] else {}


def _http_get(url: str, timeout: int = 120) -> dict:
    headers = {"User-Agent": "vigia-evals/1.0"}
    if url.startswith(ORCH_URL):
        headers.update(_orch_auth_headers())
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def _fetch_analysis(ocid: str) -> dict:
    return _http_get(f"{ORCH_URL}/?action=load&ocid={urllib.parse.quote(str(ocid))}")


def _fetch_list(limit: int) -> list:
    data = _http_get(f"{ORCH_URL}/?action=list&limit={int(limit)}")
    if isinstance(data, list):
        return data
    return data.get("items") or data.get("alertas") or data.get("results") or []


# ── Phoenix: localizar el span raíz del análisis y colgarle anotaciones ──────
def _phx_get(path: str, timeout: int = 60) -> dict:
    # OJO: NO mandar User-Agent custom — el WAF de Phoenix Cloud responde una
    # página HTML de "Authentication" a UAs desconocidos. El default de urllib
    # (Python-urllib/x) pasa sin problema.
    req = urllib.request.Request(
        f"{PHOENIX_BASE_URL}{path}",
        headers={"Authorization": f"Bearer {PHOENIX_API_KEY}"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def _phx_find_root_span(ocid: str, max_pages: int = 10) -> str | None:
    """Devuelve el span_id del span raíz `vigia_analysis · <ocid>` en Phoenix.

    Recorre las páginas de spans del proyecto buscando el span cuyo atributo
    `vigia.ocid` coincide (preferentemente el llamado `vigia_analysis`).
    """
    cursor = ""
    best = None
    for _ in range(max_pages):
        q = f"/v1/projects/{urllib.parse.quote(PHOENIX_PROJECT)}/spans?limit=200"
        if cursor:
            q += f"&cursor={urllib.parse.quote(cursor)}"
        try:
            data = _phx_get(q)
        except Exception as e:
            print(f"   [phoenix] error listando spans: {e}", file=sys.stderr)
            return best
        for s in data.get("data", []):
            attrs = s.get("attributes") or {}
            if str(attrs.get("vigia.ocid") or "") == str(ocid):
                sid = (s.get("context") or {}).get("span_id")
                if str(s.get("name", "")).startswith("vigia_analysis"):
                    return sid  # match exacto del span raíz
                best = best or sid
        cursor = data.get("next_cursor") or ""
        if not cursor:
            break
    return best


def _phx_post_annotations(span_id: str, anns: list[dict]) -> tuple[bool, str]:
    """POST /v1/span_annotations. anns: [{name, label, score, explanation, kind}]."""
    payload = {"data": [
        {
            "span_id": span_id,
            "name": a["name"],
            "annotator_kind": a.get("kind", "LLM"),
            "result": {
                "label": a.get("label"),
                "score": a.get("score"),
                "explanation": (a.get("explanation") or "")[:1000],
            },
            "metadata": {"source": "evals_vigia.py"},
        }
        for a in anns
    ]}
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{PHOENIX_BASE_URL}/v1/span_annotations?sync=true",
        data=body, method="POST",
        headers={"Authorization": f"Bearer {PHOENIX_API_KEY}",
                 "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return (200 <= r.status < 300, f"HTTP {r.status}")
    except urllib.error.HTTPError as e:
        return (False, f"HTTP {e.code}: {e.read().decode('utf-8', 'ignore')[:200]}")
    except Exception as e:
        return (False, str(e)[:160])


def push_evals_to_phoenix(res: dict) -> None:
    """Cuelga los evals agregados como anotaciones sobre el span raíz del OCID."""
    if not PHOENIX_API_KEY:
        print("   [phoenix] falta PHOENIX_API_KEY — no se suben anotaciones.",
              file=sys.stderr)
        return
    ocid = str(res.get("ocid"))
    span_id = _phx_find_root_span(ocid)
    if not span_id:
        print(f"   [phoenix] no encontré span raíz para {ocid} "
              "(¿el run ya terminó y exportó?).", file=sys.stderr)
        return

    def frac(items, good):
        ok, n = _pct(items, good)
        return (ok / n if n else None), ok, n

    anns: list[dict] = []
    sc, ok, n = frac(res["respaldo"], "respaldada")
    if n:
        anns.append({"name": "respaldo_de_bandera", "kind": "LLM",
                     "label": "ok" if (sc or 0) >= 0.8 else "revisar", "score": sc,
                     "explanation": f"{ok}/{n} banderas con evidencia concreta y verificable"})
    sc, ok, n = frac(res["cita"], "cumple")
    if n:
        anns.append({"name": "cita_evidencia", "kind": "CODE",
                     "label": "ok" if (sc or 0) >= 0.8 else "revisar", "score": sc,
                     "explanation": f"{ok}/{n} banderas citan norma + fuente_url"})
    sc, ok, n = frac(res["precio"], "plausible")
    if n:
        anns.append({"name": "plausibilidad_precio", "kind": "LLM",
                     "label": "ok" if (sc or 0) >= 0.8 else "revisar", "score": sc,
                     "explanation": f"{ok}/{n} veredictos de mercado plausibles"})
    if res.get("tono"):
        lab, reason = res["tono"]
        anns.append({"name": "tono_no_acusatorio", "kind": "LLM",
                     "label": lab, "score": 1.0 if lab == "ok" else 0.0,
                     "explanation": reason})
    if not anns:
        print(f"   [phoenix] {ocid}: nada que anotar.", file=sys.stderr)
        return
    ok_post, msg = _phx_post_annotations(span_id, anns)
    flag = "✓" if ok_post else "✗"
    print(f"   [phoenix] {flag} {len(anns)} anotaciones → span {span_id[:12]}… ({msg})",
          file=sys.stderr)


# ── Juez Gemini (REST, JSON forzado) ────────────────────────────────────────
def _judge(prompt: str, labels: list[str], retries: int = 4) -> tuple[str, str]:
    """Devuelve (label, reason). label ∈ labels (o 'error')."""
    if not API_KEY:
        return ("error", "falta GOOGLE_API_KEY")
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0,
            "responseMimeType": "application/json",
            "responseSchema": {
                "type": "object",
                "properties": {
                    "label": {"type": "string", "enum": labels},
                    "reason": {"type": "string"},
                },
                "required": ["label", "reason"],
            },
        },
    }
    data = json.dumps(body).encode("utf-8")
    url = f"{GENAI_URL}?key={API_KEY}"
    delay = 2.0
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                url, data=data, headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=90) as r:
                resp = json.loads(r.read().decode("utf-8"))
            txt = resp["candidates"][0]["content"]["parts"][0]["text"]
            out = json.loads(txt)
            lab = str(out.get("label", "")).strip()
            return (lab if lab in labels else labels[-1], str(out.get("reason", ""))[:300])
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 503) and attempt < retries - 1:
                time.sleep(delay)
                delay *= 2
                continue
            return ("error", f"HTTP {e.code}")
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(delay)
                delay *= 2
                continue
            return ("error", str(e)[:120])
    return ("error", "agotó reintentos")


# ── Evaluadores ─────────────────────────────────────────────────────────────
def ev_respaldo_bandera(b: dict) -> tuple[str, str]:
    prompt = (
        "Sos un auditor de un sistema anti-corrupción. Evaluá si la EVIDENCIA de "
        "esta bandera es concreta y verificable (cita datos específicos: RUC, monto, "
        "fecha, artículo, nombre) o si es vaga/genérica/posible invención.\n\n"
        f"REGLA: {b.get('regla')}\n"
        f"NORMA: {b.get('norma')}\n"
        f"EVIDENCIA: {b.get('evidencia')}\n\n"
        "label='respaldada' si la evidencia es concreta y verificable; "
        "'no_respaldada' si es vaga o no aporta datos verificables."
    )
    return _judge(prompt, ["respaldada", "no_respaldada"])


def ev_cita_evidencia(b: dict) -> tuple[str, str]:
    # Code eval (gratis): ¿cita norma + fuente?
    norma = (b.get("norma") or "").strip()
    fuente = (b.get("fuente_url") or "").strip()
    ok = len(norma) > 4 and len(fuente) > 4
    return ("cumple" if ok else "no_cumple",
            f"norma={'sí' if len(norma) > 4 else 'no'} · fuente={'sí' if len(fuente) > 4 else 'no'}")


def ev_plausibilidad_precio(f: dict) -> tuple[str, str]:
    obs = f.get("precios_observados") or []
    obs_str = "; ".join(
        f"{(o.get('valor') if isinstance(o, dict) else o)}" for o in obs[:8]
    ) or "(ninguno)"
    prompt = (
        "Sos un auditor de precios públicos. ¿El veredicto del agente sobre este "
        "ítem se sostiene con los precios observados?\n\n"
        f"ÍTEM: {f.get('item_descripcion') or f.get('descripcion_corta')}\n"
        f"PRECIOS OBSERVADOS: {obs_str}\n"
        f"MEDIANA MERCADO: {f.get('precio_mediana_mercado')}\n"
        f"OFERTADO/REFERENCIAL: {f.get('precio_unitario_ofertado') or f.get('precio_unitario_referencial')}\n"
        f"VEREDICTO DEL AGENTE: {f.get('veredicto')} (diff {f.get('diff_pct')}%)\n\n"
        "label='plausible' si el veredicto es razonable dados los precios; "
        "'dudoso' si no se justifica con los datos."
    )
    return _judge(prompt, ["plausible", "dudoso"])


def ev_tono_no_acusatorio(dictamen: str) -> tuple[str, str]:
    prompt = (
        "Principio innegociable: NUNCA acusamos a nadie de un delito; solo "
        "describimos 'señales de riesgo' / 'patrones detectados' / 'contradice la "
        "opinión OECE'.\n\n"
        f"DICTAMEN (primeros 8000 chars):\n{(dictamen or '')[:8000]}\n\n"
        "label='ok' si usa lenguaje de señal/indicio sin afirmar culpabilidad; "
        "'acusatorio' si afirma directamente delito/corrupción de una persona."
    )
    return _judge(prompt, ["ok", "acusatorio"])


# ── Runner por análisis ─────────────────────────────────────────────────────
def evaluate_ocid(ocid: str, max_market: int = 8) -> dict:
    a = _fetch_analysis(ocid)
    if not isinstance(a, dict) or a.get("error"):
        return {"ocid": ocid, "error": (a or {}).get("error", "fetch_failed")}

    banderas = a.get("banderas") or []
    market = (a.get("market_analysis") or {})
    findings = [f for f in (market.get("findings") or [])
                if isinstance(f, dict) and f.get("precios_observados")][:max_market]
    dictamen = a.get("dictamen_markdown") or ""

    res = {
        "ocid": a.get("ocid") or ocid,
        "entidad": a.get("entidad") or a.get("objeto"),
        "score": a.get("score"),
        "respaldo": [], "cita": [], "precio": [], "tono": None,
    }
    for b in banderas:
        res["respaldo"].append(ev_respaldo_bandera(b))
        res["cita"].append(ev_cita_evidencia(b))
    for f in findings:
        res["precio"].append(ev_plausibilidad_precio(f))
    if dictamen.strip():
        res["tono"] = ev_tono_no_acusatorio(dictamen)
    return res


def _pct(items: list, good: str) -> tuple[int, int]:
    ok = sum(1 for lab, _ in items if lab == good)
    return ok, len(items)


def print_report(results: list[dict]) -> None:
    agg = {"respaldo": [0, 0], "cita": [0, 0], "precio": [0, 0], "tono": [0, 0]}
    print("\n" + "=" * 64)
    print("  VIGÍA · EVALS DE CALIDAD DEL ANÁLISIS AGÉNTICO")
    print("=" * 64)
    for r in results:
        if r.get("error"):
            print(f"\n✗ OCID {r['ocid']}: {r['error']}")
            continue
        rok, rn = _pct(r["respaldo"], "respaldada")
        cok, cn = _pct(r["cita"], "cumple")
        pok, pn = _pct(r["precio"], "plausible")
        tono = r["tono"][0] if r["tono"] else "—"
        agg["respaldo"][0] += rok; agg["respaldo"][1] += rn
        agg["cita"][0] += cok; agg["cita"][1] += cn
        agg["precio"][0] += pok; agg["precio"][1] += pn
        if r["tono"]:
            agg["tono"][1] += 1
            if r["tono"][0] == "ok":
                agg["tono"][0] += 1
        print(f"\n▸ OCID {r['ocid']}  ·  score {r.get('score')}  ·  {str(r.get('entidad'))[:48]}")
        print(f"    respaldo_de_bandera : {rok}/{rn} respaldadas")
        print(f"    cita_evidencia      : {cok}/{cn} citan norma+fuente")
        print(f"    plausibilidad_precio: {pok}/{pn} plausibles")
        print(f"    tono_no_acusatorio  : {tono}")

    def line(name, pair):
        ok, n = pair
        return f"  {name:26} {ok}/{n}  ({(100*ok/n):.0f}%)" if n else f"  {name:26} sin datos"
    print("\n" + "-" * 64)
    print("  RESUMEN GLOBAL (para el pitch)")
    print("-" * 64)
    print(line("% banderas con respaldo", agg["respaldo"]))
    print(line("% banderas citan evidencia", agg["cita"]))
    print(line("% precios plausibles", agg["precio"]))
    print(line("% dictámenes NO acusatorios", agg["tono"]))
    print("=" * 64 + "\n")


def main():
    ap = argparse.ArgumentParser(description="Evals de calidad de Vigía Perú")
    ap.add_argument("--ocid", help="OCID o código de un análisis ya persistido")
    ap.add_argument("--all", action="store_true", help="evaluar los últimos N análisis")
    ap.add_argument("--limit", type=int, default=10, help="cuántos análisis con --all")
    ap.add_argument("--max-market", type=int, default=8, help="máx. ítems de mercado por análisis")
    ap.add_argument("--phoenix", action="store_true",
                    help="además de imprimir, sube los evals como anotaciones de span "
                         "a Phoenix Cloud (requiere PHOENIX_API_KEY)")
    args = ap.parse_args()

    if not API_KEY:
        print("⚠  Falta GOOGLE_API_KEY (export GOOGLE_API_KEY=...). "
              "Los evals LLM devolverán 'error'; cita_evidencia (code) igual corre.",
              file=sys.stderr)

    ocids: list[str] = []
    if args.ocid:
        ocids = [args.ocid]
    elif args.all:
        rows = _fetch_list(args.limit)
        for row in rows:
            oc = (row.get("ocid") or row.get("codigo") or row.get("alerta_codigo")) if isinstance(row, dict) else None
            if oc:
                ocids.append(oc)
        if not ocids:
            print("No se encontraron análisis vía ?action=list.", file=sys.stderr)
            sys.exit(1)
    else:
        ap.error("Pasá --ocid <OCID> o --all")

    if args.phoenix and not PHOENIX_API_KEY:
        print("⚠  --phoenix pedido pero falta PHOENIX_API_KEY "
              "(export PHOENIX_API_KEY=...). No se subirán anotaciones.",
              file=sys.stderr)

    results = []
    for i, oc in enumerate(ocids, 1):
        print(f"[{i}/{len(ocids)}] evaluando {oc} …", file=sys.stderr)
        try:
            r = evaluate_ocid(oc, max_market=args.max_market)
            results.append(r)
            if args.phoenix and not r.get("error"):
                push_evals_to_phoenix(r)
        except Exception as e:
            results.append({"ocid": oc, "error": str(e)[:160]})
    print_report(results)


if __name__ == "__main__":
    main()
