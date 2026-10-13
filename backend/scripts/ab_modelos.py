#!/usr/bin/env python3
"""Prueba A/B de modelos sobre el pipeline REAL de agentes (Gemini vs Cloudflare Workers AI).

Cada variante es un servicio sombra de Cloud Run (infrastructure/deploy/agente-ab.sh) con un rol de base de SOLO
LECTURA: corre el análisis completo pero no puede escribir en producción. Este script arma la misma entrada que el
dispatcher (OCDS, documentos, clasificación) para cada contrato, la manda a cada variante y guarda la respuesta.

    # 1) elegir contratos ya analizados y correr las dos variantes
    python backend/scripts/ab_modelos.py correr --n 20 --seed 7 \
        --variante gemini=https://agente-ab-gemini-….run.app --variante glm=https://agente-ab-glm-….run.app
    # 2) informe comparativo (markdown) de una corrida
    python backend/scripts/ab_modelos.py comparar backend/scripts/ab_out/<corrida> [--base gemini]

Entorno: PGHOST, PGPASSWORD (admin o lector), PGSSLMODE=require. ID token de `gcloud auth print-identity-token`.
Las salidas (ab_out/) tienen datos de contratos: están en .gitignore.
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import json
import os
import pathlib
import random
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

AQUI = pathlib.Path(__file__).resolve().parent
SALIDA = AQUI / "ab_out"
MAX_ESPERA_S = int(os.getenv("AB_MAX_ESPERA_S", "2400"))


# ── entrada: lo mismo que arma el dispatcher (backend/dispatcher-worker/src/{sql,stream}.ts) ──
def conectar():
    import psycopg2
    return psycopg2.connect(host=os.environ["PGHOST"], user=os.getenv("PGUSER", "postgres"), dbname=os.getenv("PGDATABASE", "vigia"),
                            password=os.environ["PGPASSWORD"], sslmode=os.getenv("PGSSLMODE", "require"))


def elegir(cu, n: int, seed: int) -> list[str]:
    """n contratos ya analizados, repartidos por nivel de score (bajo/medio/alto) para ver todo el rango."""
    cu.execute(
        """SELECT p.ocid, COALESCE(a.score, 0) FROM procesamientos p
             LEFT JOIN alertas a ON a.codigo = 'OECE-' || p.ocid
            WHERE p.estado = 'procesado' AND documentos_listos(p.ocid) ORDER BY p.ocid""")
    filas = cu.fetchall()
    rng = random.Random(seed)
    grupos: dict[str, list[str]] = {"alto": [], "medio": [], "bajo": []}
    for ocid, score in filas:
        grupos["alto" if score >= 70 else "medio" if score >= 40 else "bajo"].append(ocid)
    for g in grupos.values():
        rng.shuffle(g)
    out: list[str] = []
    while len(out) < min(n, len(filas)):
        for g in ("alto", "medio", "bajo"):
            if grupos[g] and len(out) < n:
                out.append(grupos[g].pop())
    return out


def cuerpo(cu, ocid: str) -> dict:
    cu.execute("SELECT ocds_payload::text, tipo_contratacion, etapa, agentes_aplicables, validaciones_pendientes "
               "FROM convocatorias WHERE ocid = %s", (ocid,))
    ocds, tipo, etapa, agentes, valid = cu.fetchone()
    cu.execute("SELECT url_origen, url_gcs FROM documentos_vigentes(%s)", (ocid,))
    docs = {u: g for u, g in cu.fetchall() if u and g}
    b: dict = {"input": ocid, "ocds": json.loads(ocds) if ocds else None, "docs_b64": {}, "doc_urls": docs}
    if tipo is not None:
        b["clasificacion"] = {"tipo": tipo, "etapa": etapa, "agentes": agentes or [], "validaciones_pendientes": valid or []}
    return b


# ── ejecución ──
def id_token() -> str:
    r = subprocess.run("gcloud auth print-identity-token", capture_output=True, text=True, shell=True)
    if r.returncode or not r.stdout.strip():
        raise SystemExit("no pude obtener el ID token de gcloud")
    return r.stdout.strip()


_TOKEN = {"t": "", "ts": 0.0}


def token_vigente() -> str:
    """ID token de gcloud, renovado cada 40 min: una corrida larga pasaba de la hora de validez y daba 401."""
    if time.time() - _TOKEN["ts"] > 2400 or not _TOKEN["t"]:
        _TOKEN["t"], _TOKEN["ts"] = id_token(), time.time()
    return _TOKEN["t"]


def correr_uno(url: str, token: str, cuerpo_json: dict) -> dict:
    """POST ?stream=1 y lee el NDJSON hasta el evento `final`. Devuelve eventos + estado final + tiempos."""
    t0 = time.time()
    req = urllib.request.Request(f"{url}?stream=1", data=json.dumps(cuerpo_json).encode(),
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"})
    eventos, final, error = [], None, None
    abrir = None
    for intento in range(8):   # 429/503 = sin instancia libre (cuota de Cloud Run): esperar y reintentar
        try:
            abrir = urllib.request.urlopen(req, timeout=MAX_ESPERA_S)
            break
        except urllib.error.HTTPError as e:
            if e.code in (429, 503) and intento < 7:
                time.sleep(30 + 30 * intento)
                continue
            error = f"HTTPError: HTTP Error {e.code}"
            break
        except Exception as e:  # noqa: BLE001
            error = f"{type(e).__name__}: {str(e)[:300]}"
            break
    try:
        if abrir is None:
            raise RuntimeError(error or "sin respuesta")
        with abrir as r:
            for linea in r:
                linea = linea.strip()
                if not linea:
                    continue
                try:
                    ev = json.loads(linea)
                except ValueError:
                    continue
                if ev.get("kind") == "final":
                    final = ev
                else:
                    eventos.append(ev)
    except Exception as e:  # noqa: BLE001
        error = f"{type(e).__name__}: {str(e)[:300]}"
    return {"segundos": round(time.time() - t0, 1), "error": error, "n_eventos": len(eventos),
            "eventos": [e for e in eventos if e.get("kind") in ("error", "warn", "agent_error", "metrics", "phase")][:200],
            "final": final}


def cmd_correr(a) -> None:
    variantes = dict(v.split("=", 1) for v in a.variante)
    cn = conectar()
    cu = cn.cursor()
    ocids = a.ocids.split(",") if a.ocids else elegir(cu, a.n, a.seed)
    if a.completar:    # reusa una corrida y solo ejecuta lo que falta o falló
        corrida = pathlib.Path(a.completar)
        ocids = json.loads((corrida / "meta.json").read_text(encoding="utf-8"))["ocids"]
    else:
        corrida = SALIDA / time.strftime("%Y%m%d-%H%M%S")
    cuerpos = {o: cuerpo(cu, o) for o in ocids}
    cn.close()
    token = id_token()
    print(f"{len(ocids)} contratos × {len(variantes)} variantes → {corrida}")
    for v in variantes:
        (corrida / v).mkdir(parents=True, exist_ok=True)
    (corrida / "meta.json").write_text(json.dumps({"ocids": ocids, "variantes": variantes, "seed": a.seed}, indent=1), encoding="utf-8")

    def tarea(v: str, o: str):
        r = correr_uno(variantes[v], token_vigente(), cuerpos[o])
        (corrida / v / f"{o}.json").write_text(json.dumps(r, ensure_ascii=False, default=str), encoding="utf-8")
        return v, o, r

    def completo(v: str, o: str) -> bool:
        f = corrida / v / f"{o}.json"
        return f.exists() and bool(json.loads(f.read_text(encoding="utf-8")).get("final"))

    trabajos = [(v, o) for o in ocids for v in variantes if not (a.completar and completo(v, o))]
    print(f"a ejecutar: {len(trabajos)}")
    with cf.ThreadPoolExecutor(max_workers=a.paralelo * len(variantes)) as ex:
        futs = [ex.submit(tarea, v, o) for v, o in trabajos]
        for f in cf.as_completed(futs):
            v, o, r = f.result()
            ok = "ok " if r["final"] else "ERR"
            print(f"[{ok}] {v:8} {o} {r['segundos']:>6}s {r['error'] or ''}", flush=True)
    print(f"listo: python backend/scripts/ab_modelos.py comparar {corrida}")


# ── comparación ──
PALABRAS_ACUSATORIAS = re.compile(r"\b(corrupt[oa]s?|delincuent\w*|ladr[oó]n\w*|robó|robaron|estafa\w*|culpable\w*|delito\w*|cometi[óo])\b", re.I)


def _n(d, k):
    v = (d or {}).get(k)
    return len(v) if isinstance(v, (list, dict)) else 0


def _ok_n(d, k):
    v = (d or {}).get(k) or {}
    return (v.get("ok", 0), v.get("n", 0)) if isinstance(v, dict) else (0, 0)


def extraer(r: dict) -> dict:
    """Resumen comparable de UNA corrida de pipeline, leído del estado final del orquestador."""
    fin = r.get("final") or {}
    st = fin.get("state") or {}
    llm = st.get("llm_metrics") or {}
    ev = st.get("self_evals") or {}
    ver = st.get("verificacion_dictamen") or {}
    # Banderas: reglas duras de código disparadas + banderas de JUICIO de los agentes (clave estable por agente/vector)
    banderas: set[str] = set()
    for regla, v in (st.get("reglas_lote1") or {}).items():
        if isinstance(v, dict) and v.get("triggered"):
            banderas.add(f"regla:{regla}")
    for agente, clave in (("person_network", "banderas_red"), ("legal", "red_flags_documentales"),
                          ("compliance_ext", "banderas_juicio")):
        fuente = st.get({"person_network": "person_network", "legal": "legal_analysis", "compliance_ext": "compliance_extended"}[agente]) or {}
        for b in fuente.get(clave) or []:
            if isinstance(b, dict):
                tag = b.get("vector") or b.get("regla") or b.get("tipo") or b.get("codigo") or (b.get("titulo") or "")[:40]
                banderas.add(f"{agente}:{str(tag).lower()[:50]}")
    dictamen = st.get("final_dictamen") or ""
    if not isinstance(dictamen, str):
        dictamen = json.dumps(dictamen, ensure_ascii=False)
    da = st.get("document_analysis") or {}
    inventadas = sum(len(ver.get(k) or []) for k in ("urls_no_respaldadas", "rucs_no_respaldados", "dnis_no_respaldados"))
    banderas_fantasma = len(ver.get("banderas_no_existentes") or [])
    descartes = sum(_n(st.get(k) or {}, "descartes_schema") for k in ("person_network", "legal_analysis")) + _n(st, "descartes")
    return {
        "ok": bool(fin), "segundos": r.get("segundos"), "banderas": banderas, "dictamen": dictamen,
        "costo_usd": llm.get("cost_usd"), "tokens": llm.get("tokens_total"), "llamadas": llm.get("n_llm_calls"),
        "por_etapa": {e["etapa"]: e["costo_usd"] for e in (llm.get("por_etapa") or [])},
        "errores": [e for e in r.get("eventos", []) if e.get("kind") in ("error", "agent_error")],
        "respaldo": _ok_n(ev, "respaldo"), "cita": _ok_n(ev, "cita"), "precio": _ok_n(ev, "precio"),
        "completitud": _ok_n(ev, "completitud"), "tono": ev.get("tono"), "coherencia": ev.get("coherencia"),
        "inventado": inventadas, "bandera_fantasma": banderas_fantasma, "degradado": bool(ver.get("degradado")), "descartes_schema": descartes,
        "items": _n(da, "items_consolidados"), "postores": _n(da, "postores_extraidos"), "firmantes": _n(da, "firmantes"),
        "estados": {a: str((st.get(k) or {}).get("estado")) for a, k in (("legal", "legal_analysis"), ("person_network", "person_network"),
                                                                       ("compliance_ext", "compliance_extended"), ("mercado", "market_analysis"))},
        "veredicto_mercado": (st.get("market_analysis") or {}).get("veredicto_global"),
        "sobreprecio": (st.get("market_analysis") or {}).get("sobreprecio_pct"),
    }


def _pct(a: int, b: int) -> str:
    return f"{a/b:.0%}" if b else "—"


def cmd_comparar(a) -> None:
    corrida = pathlib.Path(a.corrida)
    meta = json.loads((corrida / "meta.json").read_text(encoding="utf-8"))
    base = a.base or list(meta["variantes"])[0]
    otras = [v for v in meta["variantes"] if v != base]
    datos = {v: {o: extraer(json.loads((corrida / v / f"{o}.json").read_text(encoding="utf-8")))
                 for o in meta["ocids"] if (corrida / v / f"{o}.json").exists()} for v in meta["variantes"]}
    L = [f"# A/B de modelos · {corrida.name}", "", f"Base: **{base}** · contratos: {len(meta['ocids'])}", "",
         "## Resumen por variante", "",
         "| variante | completó | tiempo mediano | costo medio | tokens medios | llamadas | respaldo bandera | cita norma | precio plausible | "
         "tono ok | URL/RUC/DNI sin respaldo | banderas citadas que no existen | descartes de esquema | acusatorio |",
         "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for v in meta["variantes"]:
        oks = [x for x in datos[v].values() if x["ok"]]
        seg = sorted(x["segundos"] for x in oks if x["segundos"])
        cs = [x["costo_usd"] for x in oks if x["costo_usd"] is not None]
        suma = lambda k: (sum(x[k][0] for x in oks), sum(x[k][1] for x in oks))   # noqa: E731
        L.append(f"| **{v}** | {len(oks)}/{len(datos[v])} | {seg[len(seg)//2] if seg else '—'} s | "
                 f"{(sum(cs)/len(cs)) if cs else float('nan'):.4f} USD | {(sum(x['tokens'] or 0 for x in oks)/len(oks)) if oks else 0:.0f} | "
                 f"{(sum(x['llamadas'] or 0 for x in oks)/len(oks)) if oks else 0:.0f} | {_pct(*suma('respaldo'))} | {_pct(*suma('cita'))} | "
                 f"{_pct(*suma('precio'))} | {_pct(sum(1 for x in oks if x['tono'] == 'ok'), len(oks))} | "
                 f"{sum(x['inventado'] for x in oks)} | {sum(x['bandera_fantasma'] for x in oks)} | {sum(x['descartes_schema'] for x in oks)} | "
                 f"{sum(1 for x in oks if PALABRAS_ACUSATORIAS.search(x['dictamen']))} |")
    for v in otras:
        coinc = solo_b = solo_v = 0
        mismo_merc = n_merc = 0
        ext = {"items": [0, 0], "postores": [0, 0], "firmantes": [0, 0]}
        ahorro = []
        for o in meta["ocids"]:
            b, x = datos[base].get(o), datos[v].get(o)
            if not (b and x and b["ok"] and x["ok"]):
                continue
            coinc += len(b["banderas"] & x["banderas"]); solo_b += len(b["banderas"] - x["banderas"]); solo_v += len(x["banderas"] - b["banderas"])
            if b["veredicto_mercado"] is not None:
                n_merc += 1; mismo_merc += b["veredicto_mercado"] == x["veredicto_mercado"]
            for k in ext:
                ext[k][0] += min(b[k], x[k]); ext[k][1] += max(b[k], x[k])
            if b["costo_usd"] and x["costo_usd"] is not None:
                ahorro.append(1 - x["costo_usd"] / b["costo_usd"])
        tot = coinc + solo_b + solo_v
        L += ["", f"## {v} frente a {base}", "",
              f"- **Banderas:** coinciden {coinc} · solo {base}: {solo_b} · solo {v}: {solo_v} → acuerdo {_pct(coinc, tot)}",
              f"- **Veredicto de mercado igual:** {mismo_merc}/{n_merc}",
              f"- **Extracción de documentos** (menor/mayor, 100 % = igual): ítems {_pct(*ext['items'])} · postores {_pct(*ext['postores'])} · firmantes {_pct(*ext['firmantes'])}",
              f"- **Ahorro de costo medio:** {sum(ahorro)/len(ahorro):.0%}" if ahorro else "- ahorro: no calculable"]
    for v in otras:
        L += ["", f"## Por agente: {v} frente a {base}", "",
              "| agente | banderas coinciden | solo " + base + " | solo " + v + " | acuerdo | `sin_dato` " + base + " | `sin_dato` " + v + " | costo medio " + base + " | costo medio " + v + " |",
              "|---|---|---|---|---|---|---|---|---|"]
        familias = ["regla", "legal", "person_network", "compliance_ext"]
        etapas = {"regla": [], "legal": ["document_legal_analyst_agent"], "person_network": ["person_network_agent", "estructurar_person_network"],
                  "compliance_ext": ["compliance_extended_agent"]}
        for fam in familias:
            c = sb = sv = 0
            sd_b = sd_v = 0
            cb, cv, nb, nv = 0.0, 0.0, 0, 0
            for o in meta["ocids"]:
                b, x = datos[base].get(o), datos[v].get(o)
                if not (b and x and b["ok"] and x["ok"]):
                    continue
                fb = {t for t in b["banderas"] if t.startswith(fam + ":")}
                fv = {t for t in x["banderas"] if t.startswith(fam + ":")}
                c += len(fb & fv); sb += len(fb - fv); sv += len(fv - fb)
                sd_b += b["estados"].get(fam) == "sin_dato"; sd_v += x["estados"].get(fam) == "sin_dato"
                cb += sum(b["por_etapa"].get(e, 0) for e in etapas[fam]); cv += sum(x["por_etapa"].get(e, 0) for e in etapas[fam])
                nb += 1; nv += 1
            tot = c + sb + sv
            if fam == "person_network":   # banderas de texto libre: no hay clave estable para cruzarlas → solo conteos
                L.append(f"| person_network (conteo; texto libre) | {c+sb} en {base} | — | {c+sv} en {v} | n/c | {sd_b} | {sd_v} | {cb/nb if nb else 0:.4f} | {cv/nv if nv else 0:.4f} |")
                continue
            L.append(f"| {fam} | {c} | {sb} | {sv} | {_pct(c, tot)} | {sd_b} | {sd_v} | {cb/nb if nb else 0:.4f} | {cv/nv if nv else 0:.4f} |")
        cw_b = sum(x["por_etapa"].get("report_writer_agent", 0) for x in datos[base].values() if x["ok"]); n_b = sum(1 for x in datos[base].values() if x["ok"])
        cw_v = sum(x["por_etapa"].get("report_writer_agent", 0) for x in datos[v].values() if x["ok"]); n_v = sum(1 for x in datos[v].values() if x["ok"])
        L.append(f"| report_writer (costo) | — | — | — | — | — | — | {cw_b/n_b if n_b else 0:.4f} | {cw_v/n_v if n_v else 0:.4f} |")
    L += ["", "## Por contrato", "", "| ocid | " + " | ".join(f"{v}: s / USD / banderas / sin respaldo / fantasma" for v in meta["variantes"]) + " |",
          "|---|" + "---|" * len(meta["variantes"])]
    for o in meta["ocids"]:
        celdas = []
        for v in meta["variantes"]:
            x = datos[v].get(o)
            celdas.append("—" if not x else ("ERR" if not x["ok"] else f"{x['segundos']} / {x['costo_usd'] or 0:.3f} / {len(x['banderas'])} / {x['inventado']} / {x['bandera_fantasma']}"))
        L.append(f"| {o} | " + " | ".join(celdas) + " |")
    ruta = corrida / "informe.md"
    ruta.write_text("\n".join(L) + "\n", encoding="utf-8")
    print("\n".join(L))
    print(f"\n→ {ruta}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("correr")
    c.add_argument("--n", type=int, default=20)
    c.add_argument("--seed", type=int, default=7)
    c.add_argument("--ocids", default="")
    c.add_argument("--completar", default="", help="carpeta de una corrida previa: ejecuta solo lo que falta o falló")
    c.add_argument("--paralelo", type=int, default=2, help="contratos en paralelo POR variante")
    c.add_argument("--variante", action="append", required=True, help="nombre=url (repetible)")
    c.set_defaults(f=cmd_correr)
    k = sub.add_parser("comparar")
    k.add_argument("corrida")
    k.add_argument("--base", default="")
    k.set_defaults(f=cmd_comparar)
    a = ap.parse_args()
    a.f(a)


if __name__ == "__main__":
    sys.exit(main())
