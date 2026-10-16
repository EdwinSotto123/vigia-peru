#!/usr/bin/env python3
"""Compara corridas del pipeline de agentes contra un golden set (verdad de referencia hecha a mano).

El golden vive FUERA del repo (tiene texto de expedientes): una carpeta con `golden/<ocid>.json`, cada uno con el
estado de cada regla del catálogo (`disparada` | `no_disparada` | `sin_dato`), score, nivel y dictamen.
Las corridas son las de `ab_modelos.py correr` (`ab_out/<corrida>/<variante>/<ocid>.json`).

    python backend/scripts/golden_eval.py --golden ../vigia-golden/golden backend/scripts/ab_out/<corrida> [--salida informe.md]
    # lo que producción ya analizó, como variante "produccion" (PGHOST/PGPASSWORD como en ab_modelos.py)
    python backend/scripts/golden_eval.py --golden ../vigia-golden/golden backend/scripts/ab_out/golden --desde-bd produccion

Métricas por variante (sólo sobre reglas con dato en el golden; `sin_dato` no cuenta):
  - precisión y exhaustividad de banderas, por regla y global;
  - acuerdo de nivel (bajo/medio/alto) y error medio del score;
  - costo y tiempo medios.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import statistics
import sys
from urllib.parse import urlparse

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from ab_modelos import extraer  # noqa: E402

# Banderas de juicio de los agentes → señal del catálogo (las reglas duras ya vienen como "regla:<id>").
_JUICIO = {"legal": "red_flag_documental", "person_network": "red_personas_vinculada"}
# Reglas que el pipeline guarda con otro nombre que el del catálogo.
_ALIAS = {"sancion_historica_oece": "antecedentes_proveedor", "penalidades_oece_historicas": "antecedentes_proveedor",
          "antecedente_proveedor_web": "antecedentes_proveedor", "sobreprecio_muy_elevado": "sobreprecio_elevado",
          "vinculo_red_personas": "red_personas_vinculada"}
# Dominios que la persistencia acepta como respaldo sin grounding (tools/verify.py::_CANONICAL_HOSTS).
_HOSTS_OFICIALES = ("oece.gob.pe", "osce.gob.pe", "seace.gob.pe", "sunat.gob.pe")


def _red_persistible(st: dict) -> bool:
    """¿Alguna bandera de person_network pasaría el filtro de persist_analysis_outputs? Exige cita y una URL
    respaldada (en grounding_urls o de dominio oficial). Una corrida sin escritura (rol de solo lectura) no
    persiste, y sin este filtro se contaba todo lo que el agente dejó en el estado, cosa que producción no hace."""
    pn = st.get("person_network")
    if isinstance(pn, str):
        try:
            pn = json.loads(pn)
        except ValueError:
            return False
    if not isinstance(pn, dict):
        return False
    g = st.get("grounding_urls") or []
    g = {(x if isinstance(x, str) else (x.get("url") or x.get("uri") or "")).rstrip("/")
         for x in (list(g) if not isinstance(g, dict) else list(g.keys()) + list(g.values())) if x}
    for b in pn.get("banderas_red") or []:
        if not isinstance(b, dict):
            continue
        estado = str(b.get("estado") or "").lower()
        if str(b.get("confianza") or "").lower() != "alta" and estado not in ("hallado", "confirmado", "verificado"):
            continue
        evs = b.get("evidencia") or []
        evs = [evs] if isinstance(evs, dict) else [{"cita": evs}] if isinstance(evs, str) else evs
        citas = [e for e in evs if isinstance(e, dict) and str(e.get("cita") or "").strip()]
        urls = [str(e.get("url") or "").rstrip("/") for e in evs if isinstance(e, dict) and e.get("url")]
        if citas and any(u in g or urlparse(u).netloc.endswith(_HOSTS_OFICIALES) for u in urls):
            return True
    return False


def nivel(score: float | None) -> str | None:
    if score is None:
        return None
    return "alto" if score >= 70 else "medio" if score >= 40 else "bajo"


def reglas_de_corrida(r: dict, catalogo: set[str]) -> tuple[set[str], float | None, dict]:
    """Ids del catálogo que la corrida disparó, su score (si lo persistió) y el resumen de `extraer`."""
    x = extraer(r)
    st = (r.get("final") or {}).get("state") or {}
    # Los hechos de contexto (puntua=false) se muestran pero no son una alerta: no cuentan como predicción.
    ids: set[str] = {_ALIAS.get(b["regla"], b["regla"]) for b in st.get("banderas") or []
                     if isinstance(b, dict) and b.get("regla") and b.get("puntua", True)}
    persistida = bool(st.get("banderas"))   # viene de la BD (desde_bd) o de una corrida que sí escribió
    for b in x["banderas"]:
        fam, _, tag = b.partition(":")
        if fam == "regla":
            ids.add(tag)
        elif fam == "person_network" and not persistida:
            if _red_persistible(st):
                ids.add(_JUICIO[fam])
        elif fam in _JUICIO:
            ids.add(_JUICIO[fam])
        elif tag in catalogo:
            ids.add(tag)
    if (x.get("sobreprecio") or 0) >= 30 or str(x.get("veredicto_mercado") or "").lower().startswith("sobreprecio"):
        ids.add("sobreprecio_elevado")
    score = st.get("score")
    return ids & catalogo, (float(score) if isinstance(score, (int, float)) else None), x


def desde_bd(ocids: list[str], destino: pathlib.Path) -> None:
    """Escribe lo que producción ya guardó (alertas.score + banderas) como una variante más de la corrida."""
    from ab_modelos import conectar
    destino.mkdir(parents=True, exist_ok=True)
    with conectar() as c, c.cursor() as cu:
        for ocid in ocids:
            cu.execute("SELECT id, score FROM alertas WHERE ocid=%s ORDER BY updated_at DESC NULLS LAST LIMIT 1", (ocid,))
            fila = cu.fetchone()
            if not fila:
                continue
            cu.execute("SELECT regla, severidad, agente_origen, COALESCE(puntua, true) FROM banderas WHERE alerta_id=%s", (fila[0],))
            banderas = [{"regla": r, "severidad": s, "agente_origen": ag, "puntua": p} for r, s, ag, p in cu.fetchall()]
            (destino / f"{ocid}.json").write_text(json.dumps(
                {"final": {"state": {"score": fila[1], "banderas": banderas}}}, ensure_ascii=False), encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("corrida", type=pathlib.Path)
    ap.add_argument("--golden", type=pathlib.Path, required=True)
    ap.add_argument("--salida", type=pathlib.Path)
    ap.add_argument("--desde-bd", metavar="VARIANTE",
                    help="antes de comparar, guarda en <corrida>/<VARIANTE>/ lo que producción ya tiene para esos contratos")
    a = ap.parse_args()

    golden = {p.stem: json.loads(p.read_text(encoding="utf-8")) for p in sorted(a.golden.glob("*.json"))}
    if not golden:
        sys.exit(f"sin golden en {a.golden}")
    if a.desde_bd:
        desde_bd(list(golden), a.corrida / a.desde_bd)
    catalogo = set().union(*(g["reglas"].keys() for g in golden.values()))
    variantes = sorted(p.name for p in a.corrida.iterdir() if p.is_dir())

    L = [f"# Golden set: {len(golden)} contratos · corrida `{a.corrida.name}`", "",
         "| variante | contratos | precisión | exhaustividad | F1 | nivel igual | error score | USD medio | s medio |",
         "|---|---|---|---|---|---|---|---|---|"]
    detalle: dict[str, dict[str, list[int]]] = {}
    for v in variantes:
        tp = fp = fn = 0
        por_regla: dict[str, list[int]] = {}
        niveles = errores = 0
        dif: list[float] = []
        costos: list[float] = []
        segs: list[float] = []
        n = 0
        for ocid, g in golden.items():
            f = a.corrida / v / f"{ocid}.json"
            if not f.exists():
                continue
            r = json.loads(f.read_text(encoding="utf-8"))
            if r.get("error") or not r.get("final"):
                errores += 1
                continue
            n += 1
            disparo, score, x = reglas_de_corrida(r, catalogo)
            for regla, e in g["reglas"].items():
                if e.get("estado") == "sin_dato":
                    continue
                verdad = e.get("estado") == "disparada"
                pred = regla in disparo
                c = por_regla.setdefault(regla, [0, 0, 0])
                if verdad and pred:
                    tp += 1; c[0] += 1
                elif pred:
                    fp += 1; c[1] += 1
                elif verdad:
                    fn += 1; c[2] += 1
            if score is not None:
                dif.append(abs(score - g["score"]))
                niveles += nivel(score) == g["nivel"]
            if x.get("costo_usd") is not None:
                costos.append(x["costo_usd"])
            if x.get("segundos") is not None:
                segs.append(x["segundos"])
        detalle[v] = por_regla
        p = tp / (tp + fp) if tp + fp else 0.0
        rc = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * p * rc / (p + rc) if p + rc else 0.0
        med = lambda xs, fmt: fmt.format(statistics.mean(xs)) if xs else "—"  # noqa: E731
        L.append(f"| {v} | {n} (+{errores} err) | {p:.0%} | {rc:.0%} | {f1:.2f} | {niveles}/{len(dif)} | "
                 f"{med(dif, '{:.0f}')} | {med(costos, '{:.3f}')} | {med(segs, '{:.0f}')} |")

    L += ["", "## Por regla (aciertos / falsas alarmas / omisiones)", "",
          "| regla | " + " | ".join(variantes) + " |", "|---|" + "---|" * len(variantes)]
    for regla in sorted(catalogo):
        celdas = [("{}/{}/{}".format(*detalle[v][regla]) if regla in detalle[v] else "—") for v in variantes]
        if any(c not in ("—", "0/0/0") for c in celdas):
            L.append(f"| {regla} | " + " | ".join(celdas) + " |")
    texto = "\n".join(L) + "\n"
    if a.salida:
        a.salida.write_text(texto, encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    print(texto)


if __name__ == "__main__":
    main()
