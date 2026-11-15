"""Sube a la base una corrida de la prueba de oro, para verla en el panel (tablas golden_*, migración 285).

    python -X utf8 backend/scripts/golden_subir.py prod <corrida> --golden <carpeta golden> --conjunto servicios --imagen b390f6b6-sdk

Guarda: los casos del conjunto (lo esperado por regla), la corrida (precisión, exhaustividad, F1, por regla) y el
resultado de cada contrato (aciertos, falsas alarmas, omisiones, con la evidencia que dio el agente). Con la misma corrida
guarda además el conjunto `legal`: lo que dijo el analista legal en cada contrato y, de cada norma que citó, si el artículo
EXISTE en el RAG normativo y si esa norma REGÍA en la fecha de la convocatoria (una cita de la ley anterior en un proceso
de la Ley 32069 es el error que se busca)."""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import statistics
import sys

RAIZ = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "infrastructure" / "aws"))
sys.path.insert(0, str(RAIZ / "backend" / "scripts"))
from tunel_rds import conexion  # noqa: E402
import golden_eval as G  # noqa: E402

INICIO_32069 = "2025-04-22"
# Cómo se reconoce cada norma en una cita, y a qué régimen pertenece.
NORMAS = [
    (re.compile(r"32069", re.I), "ley-32069", "32069"),
    (re.compile(r"009-2025", re.I), "ds-009-2025-ef", "32069"),
    (re.compile(r"344-2018", re.I), "reglamento-ds-344-2018-ef-consolidado", "30225"),
    (re.compile(r"30225|082-2019", re.I), "tuo-ley-30225-ds-082-2019-ef", "30225"),
]
RE_CITA = re.compile(r"art(?:[íi]culo|s?\.)\s*(\d{1,3})(?:\.\d+)?[^.;\n]{0,90}?(Ley\s*(?:N[°ºo.]*\s*)?(?:32069|30225)|D\.?\s?S\.?\s*(?:N[°ºo.]*\s*)?\d{3}-\d{4}(?:-EF)?|Reglamento|TUO)", re.I)


def _fecha_caso(st: dict) -> str | None:
    t = ((st.get("ocds") or st.get("ocds_preloaded") or {}).get("tender") or {})
    for v in ((t.get("tenderPeriod") or {}).get("startDate"), t.get("datePublished"), (st.get("ocds") or {}).get("date")):
        m = re.match(r"^(\d{4}-\d{2}-\d{2})", str(v or ""))
        if m:
            return m.group(1)
    return None


RE_OPINION = re.compile(r"Opini[oó]n\s*(?:N[°ºo.]*\s*)?(D?\d{1,6})-(20\d{2})", re.I)


def clave_opinion(numero: str, anio: str) -> str:
    """«D26-2025», «D000026-2025-OECE-DTN» y «026-2025/DTN» son la misma opinión: el número sin la D ni los ceros."""
    return f"{int(re.sub(r'[^0-9]', '', numero) or 0)}-{anio}"


def citas_legales(st: dict, articulos: dict[str, set], regimen: str, opiniones: dict[str, set] | None = None) -> dict:
    """Las normas que citó el analista legal (en sus banderas y en el dictamen) y su validez."""
    textos = []
    leg = st.get("legal_analysis")
    if isinstance(leg, dict):
        for b in leg.get("red_flags_documentales") or []:
            if isinstance(b, dict):
                textos.append(f"{b.get('norma') or ''} {b.get('descripcion') or ''}")
    textos.append(str(st.get("final_dictamen") or "")[:60000])
    vistas, citas = set(), []
    # Opiniones del OECE: ¿existe en el corpus y se emitió bajo la ley que rige el proceso?
    for txt in textos:
        for m in RE_OPINION.finditer(txt):
            clave = clave_opinion(m.group(1), m.group(2))
            if ("opinion", clave) in vistas:
                continue
            vistas.add(("opinion", clave))
            # En 2025 hay dos series con el mismo número (OSCE, Ley 30225, y OECE, Ley 32069): vale si alguna rige.
            regs = (opiniones or {}).get(clave)
            rige = bool(regs) and bool(regs & {regimen, "ambos"})
            citas.append({"cita": re.sub(r"\s+", " ", m.group(0))[:80], "norma": "opinion", "articulo": clave, "existe": bool(regs),
                          "rige": rige, "estado": "no_existe" if not regs else "ok" if rige else "otro_regimen"})
    for txt in textos:
        for m in RE_CITA.finditer(txt):
            art, nombre = m.group(1), m.group(2)
            slug, reg = None, None
            for patron, s, r in NORMAS:
                if patron.search(nombre) or patron.search(m.group(0)):
                    slug, reg = s, r
                    break
            if slug is None:      # «del Reglamento» a secas: el del régimen del proceso
                slug, reg = (("ds-009-2025-ef", "32069") if regimen == "32069" else ("reglamento-ds-344-2018-ef-consolidado", "30225")) \
                    if re.search(r"reglamento", nombre, re.I) else (None, None)
            if slug is None or (slug, art) in vistas:
                continue
            vistas.add((slug, art))
            existe = art in articulos.get(slug, set())
            citas.append({"cita": re.sub(r"\s+", " ", m.group(0))[:140], "norma": slug, "articulo": art, "existe": existe,
                          "rige": reg == regimen, "estado": "ok" if (existe and reg == regimen) else "otro_regimen" if reg != regimen else "no_existe"})
    return {"citas": citas, "total": len(citas), "ok": sum(c["estado"] == "ok" for c in citas),
            "otro_regimen": sum(c["estado"] == "otro_regimen" for c in citas), "no_existe": sum(c["estado"] == "no_existe" for c in citas)}


def _f1(tp, fp, fn):
    p = tp / (tp + fp) if tp + fp else 0.0
    r = tp / (tp + fn) if tp + fn else 0.0
    return round(100 * p, 1), round(100 * r, 1), round(2 * p * r / (p + r), 3) if p + r else 0.0


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("destino")
    ap.add_argument("corrida", type=pathlib.Path)
    ap.add_argument("--golden", type=pathlib.Path, required=True)
    ap.add_argument("--conjunto", required=True)
    ap.add_argument("--imagen", default=None)
    ap.add_argument("--variante", default=None)
    ap.add_argument("--nota", default=None)
    a = ap.parse_args()

    golden = {p.stem: json.loads(p.read_text(encoding="utf-8")) for p in sorted(a.golden.glob("*.json"))}
    catalogo = set().union(*(g["reglas"].keys() for g in golden.values()))
    variante = a.variante or sorted(p.name for p in a.corrida.iterdir() if p.is_dir())[0]

    with conexion(a.destino) as cn:
        cu = cn.cursor()
        cu.execute("SELECT slug, articulo FROM norma_fragmento WHERE articulo IS NOT NULL")
        articulos: dict[str, set] = {}
        for slug, art in cu.fetchall():
            articulos.setdefault(slug, set()).add(str(art).split(".")[0])

        cu.execute("SELECT numero, documento, regimen FROM norma WHERE tipo = 'opinion'")
        opiniones: dict[str, set] = {}
        for numero, documento, reg in cu.fetchall():
            mo = RE_OPINION.search(str(documento or "")) or RE_OPINION.search(f"Opinión N° {numero or ''}") or RE_OPINION.search(str(numero or ""))
            if mo:
                opiniones.setdefault(clave_opinion(mo.group(1), mo.group(2)), set()).add(reg)
        tp = fp = fn = errores = 0
        por_regla: dict[str, list[int]] = {}
        costos, segs, filas, filas_legal = [], [], [], []
        ltp = lfp = lfn = 0
        tot_citas = {"total": 0, "ok": 0, "otro_regimen": 0, "no_existe": 0}
        for ocid, g in golden.items():
            f = a.corrida / variante / f"{ocid}.json"
            if not f.exists():
                continue
            r = json.loads(f.read_text(encoding="utf-8"))
            st = (r.get("final") or {}).get("state") or {}
            fecha = _fecha_caso(st)
            regimen = "32069" if (fecha or "9999") >= INICIO_32069 else "30225"
            titulo = (((st.get("ocds") or {}).get("tender") or {}).get("description") or ((st.get("ocds") or {}).get("tender") or {}).get("title") or "")[:300]
            cu.execute("""INSERT INTO golden_caso (conjunto, caso, titulo, perfil, fecha, regimen, esperado, nota) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                          ON CONFLICT (conjunto, caso) DO UPDATE SET titulo = COALESCE(NULLIF(EXCLUDED.titulo, ''), golden_caso.titulo), perfil = EXCLUDED.perfil,
                            fecha = COALESCE(EXCLUDED.fecha, golden_caso.fecha), regimen = EXCLUDED.regimen, esperado = EXCLUDED.esperado, nota = EXCLUDED.nota""",
                       (a.conjunto, ocid, titulo, g.get("perfil"), fecha, regimen, json.dumps(g["reglas"], ensure_ascii=False), str(g.get("lo_propio_de_la_red") or "")[:1500] or None))
            esp_legal = {k: v for k, v in g["reglas"].items() if k == "red_flag_documental"}
            cu.execute("""INSERT INTO golden_caso (conjunto, caso, titulo, perfil, fecha, regimen, esperado) VALUES ('legal', %s, %s, %s, %s, %s, %s)
                          ON CONFLICT (conjunto, caso) DO UPDATE SET titulo = COALESCE(NULLIF(EXCLUDED.titulo, ''), golden_caso.titulo), perfil = EXCLUDED.perfil,
                            fecha = COALESCE(EXCLUDED.fecha, golden_caso.fecha), regimen = EXCLUDED.regimen, esperado = EXCLUDED.esperado""",
                       (ocid, titulo, g.get("perfil") or a.conjunto, fecha, regimen, json.dumps(esp_legal, ensure_ascii=False)))
            if r.get("error") or not r.get("final"):
                errores += 1
                filas.append((ocid, "error", [], [], [], r.get("segundos"), None, {"error": str(r.get("error"))[:300]}))
                continue
            disparo, _score, x = G.reglas_de_corrida(r, catalogo)
            ac, fa, om = [], [], []
            for regla, e in g["reglas"].items():
                if e.get("estado") == "sin_dato":
                    continue
                verdad, pred = e.get("estado") == "disparada", regla in disparo
                c = por_regla.setdefault(regla, [0, 0, 0])
                if verdad and pred:
                    tp += 1; c[0] += 1; ac.append(regla)
                elif pred:
                    fp += 1; c[1] += 1; fa.append(regla)
                elif verdad:
                    fn += 1; c[2] += 1; om.append(regla)
            emitidas = {}
            for b in (st.get("banderas") or []) + (st.get("pending_flags") or []) + (st.get("pending_market_flags") or []):
                if isinstance(b, dict) and b.get("regla"):
                    emitidas.setdefault(b["regla"], str(b.get("evidencia") or "")[:400])
            if x.get("costo_usd") is not None:
                costos.append(x["costo_usd"])
            if x.get("segundos") is not None:
                segs.append(x["segundos"])
            filas.append((ocid, "ok", ac, fa, om, x.get("segundos"), x.get("costo_usd"), {"emitidas": emitidas}))
            # El analista legal: su regla y sus citas.
            ci = citas_legales(st, articulos, regimen, opiniones)
            for k in tot_citas:
                tot_citas[k] += ci[k]
            e = g["reglas"].get("red_flag_documental") or {}
            verdad, pred = e.get("estado") == "disparada", "red_flag_documental" in disparo
            la, lf, lo = [], [], []
            if e.get("estado") != "sin_dato":
                if verdad and pred:
                    ltp += 1; la.append("red_flag_documental")
                elif pred:
                    lfp += 1; lf.append("red_flag_documental")
                elif verdad:
                    lfn += 1; lo.append("red_flag_documental")
            leg = st.get("legal_analysis") if isinstance(st.get("legal_analysis"), dict) else {}
            dichas = [{"vector": b.get("vector"), "severidad": b.get("severidad"), "descripcion": str(b.get("descripcion") or "")[:400], "norma": str(b.get("norma") or "")[:160]}
                      for b in (leg.get("red_flags_documentales") or []) if isinstance(b, dict)]
            filas_legal.append((ocid, "ok", la, lf, lo, x.get("segundos"), x.get("costo_usd"), {"banderas_legales": dichas, "citas": ci["citas"][:40],
                                                                                              "resumen_citas": {k: ci[k] for k in tot_citas}}))

        # Cuándo se ejecutó: lo dice el nombre de la carpeta (AAAAMMDD-HHMMSS, hora de Lima).
        mt = re.match(r"^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$", a.corrida.name)
        cuando = f"{mt.group(1)}-{mt.group(2)}-{mt.group(3)} {mt.group(4)}:{mt.group(5)}:{mt.group(6)} America/Lima" if mt else None

        def _corrida(conjunto, n, err, m, por, extra, lineas, var=None):
            p, rc, f1 = m
            cu.execute("""INSERT INTO golden_corrida (conjunto, corrida, variante, imagen, contratos, errores, precision_pct, exhaustividad_pct, f1,
                                                       usd_medio, segundos_medio, por_regla, metricas, nota, ejecutada_at)
                          VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, COALESCE(%s::timestamptz, now()))
                          ON CONFLICT (conjunto, corrida, variante) DO UPDATE SET imagen = EXCLUDED.imagen, contratos = EXCLUDED.contratos, errores = EXCLUDED.errores,
                            precision_pct = EXCLUDED.precision_pct, exhaustividad_pct = EXCLUDED.exhaustividad_pct, f1 = EXCLUDED.f1, usd_medio = EXCLUDED.usd_medio,
                            segundos_medio = EXCLUDED.segundos_medio, por_regla = EXCLUDED.por_regla, metricas = EXCLUDED.metricas, nota = EXCLUDED.nota,
                            ejecutada_at = EXCLUDED.ejecutada_at
                          RETURNING id""",
                       (conjunto, a.corrida.name, var or variante, a.imagen, n, err, p, rc, f1, round(statistics.mean(costos), 4) if costos else None,
                        round(statistics.mean(segs), 1) if segs else None, json.dumps(por, ensure_ascii=False), json.dumps(extra, ensure_ascii=False), a.nota, cuando))
            cid = cu.fetchone()[0]
            cu.execute("DELETE FROM golden_resultado WHERE corrida_id = %s", (cid,))
            for caso, estado, ac, fa, om, seg, usd, det in lineas:
                cu.execute("""INSERT INTO golden_resultado (corrida_id, caso, estado, aciertos, falsas_alarmas, omisiones, segundos, usd, detalle)
                              VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""", (cid, caso, estado, ac, fa, om, seg, usd, json.dumps(det, ensure_ascii=False)))
            return cid

        n_ok = sum(1 for x in filas if x[1] == "ok")
        _corrida(a.conjunto, n_ok, errores, _f1(tp, fp, fn), por_regla, {}, filas)
        pct = lambda k: round(100 * tot_citas[k] / tot_citas["total"], 1) if tot_citas["total"] else None  # noqa: E731
        _corrida("legal", len(filas_legal), errores, _f1(ltp, lfp, lfn), {"red_flag_documental": [ltp, lfp, lfn]},
                 {"red": a.conjunto, "citas": tot_citas, "citas_ok_pct": pct("ok"), "citas_otro_regimen_pct": pct("otro_regimen"),
                  "citas_no_existe_pct": pct("no_existe")}, filas_legal, var=a.conjunto)
        cu.execute("UPDATE golden_conjunto c SET casos = (SELECT count(*) FROM golden_caso k WHERE k.conjunto = c.clave), actualizado_at = now()")
        cn.commit()
        print(f"{a.conjunto}: {n_ok} contratos (+{errores} err), P/R/F1 {_f1(tp, fp, fn)} | legal {_f1(ltp, lfp, lfn)} | citas {tot_citas}")


if __name__ == "__main__":
    main()
