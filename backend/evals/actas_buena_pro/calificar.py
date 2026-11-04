#!/usr/bin/env python3
"""Califica una o varias corridas contra la respuesta oficial (CONOSCE) y escribe el informe.

  python -X utf8 backend/evals/actas_buena_pro/calificar.py v2-haiku-medio [v2-haiku-bajo ...]

Por caso (sólo filas con status ok; truncadas, rechazos y JSON inválidos se cuentan aparte):
  postores_n      cuántos presentaron oferta = los de CONOSCE
  postores        qué parte de los postores de CONOSCE aparece entre los extraídos: por RUC, por el RUC de un integrante
                  del consorcio o por el nombre (CONOSCE identifica a un consorcio con un código propio, no un RUC)
  ganador         el que marcó como ganador es el adjudicado en CONOSCE (mismo criterio)
  monto           la oferta del ganador está a 1 % o menos del monto adjudicado
  citas           qué parte de las citas de observaciones aparece en el texto del PDF, sólo en PDF con texto en casi todas
                  sus páginas (en los escaneados el modelo lee la imagen y no hay con qué comparar)
Las banderas se calculan de lo extraído con reglas fijas (comun.banderas_de); con dos corridas, cuánto coinciden
(estabilidad). Contra el piloto con Opus 5.5 (casos `con_opus`): es otro modelo, no la respuesta correcta; sirve para ver
dónde difieren, no para premiar a quien se le parezca.

Informe sin nombres en informe.md (va al repo); el detalle por caso en datos/calificacion_<etiqueta>.csv (no va).
"""
from __future__ import annotations

import csv
import json
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from comun import AQUI, BANDERAS, CASOS, DATOS, banderas_de, norma, solo_digitos  # noqa: E402

TEXTOS = DATOS / "texto"


def texto_de(caso: dict) -> tuple[str, float]:
    """El texto de los PDF del caso (pypdf) y qué parte de sus páginas lo tiene; guardado para no leerlos dos veces."""
    TEXTOS.mkdir(exist_ok=True)
    f = TEXTOS / f"{solo_digitos(caso['id']) or caso['id']}.json"
    if f.exists():
        d = json.loads(f.read_text(encoding="utf-8"))
        return d["texto"], d["cobertura"]
    from pypdf import PdfReader
    partes, con, total = [], 0, 0
    for p in caso["pdfs"]:
        try:
            for pg in PdfReader(DATOS / p).pages:
                t = pg.extract_text() or ""
                total += 1
                con += len(t.strip()) >= 200
                partes.append(t)
        except Exception:  # noqa: BLE001 — un PDF roto no tiene texto que comparar
            continue
    texto, cobertura = norma(" ".join(partes)), (con / total if total else 0.0)
    f.write_text(json.dumps({"texto": texto, "cobertura": cobertura}), encoding="utf-8")
    return texto, cobertura


def cita_aparece(cita: str, texto: str) -> bool:
    """7 de cada 10 de sus tríos de palabras seguidas están en el texto (tolera saltos de línea y guiones)."""
    pal = norma(cita).split()
    if len(pal) < 3:
        return norma(cita) in texto
    trios = [" ".join(pal[i:i + 3]) for i in range(len(pal) - 2)]
    return sum(t in texto for t in trios) / len(trios) >= 0.7


def mismo_nombre(a: str | None, b: str | None) -> bool:
    x, y = set(norma(a).split()) - {"SAC", "SA", "SRL", "EIRL", "S", "A", "C", "E", "I", "R", "L"}, \
        set(norma(b).split()) - {"SAC", "SA", "SRL", "EIRL", "S", "A", "C", "E", "I", "R", "L"}
    return bool(x and y) and len(x & y) / len(x | y) >= 0.6


def coincide(ext: dict, ofi: dict) -> bool:
    """¿El postor extraído es este postor de CONOSCE? Por RUC, por un integrante del consorcio o por el nombre."""
    r = solo_digitos(ext.get("ruc"))
    miembros = {solo_digitos(m) for m in ofi.get("miembros") or []}
    integrantes = {solo_digitos(m) for m in ext.get("integrantes_ruc") or []}
    return bool((r and (r == solo_digitos(ofi["ruc"]) or r in miembros)) or (integrantes & miembros)
                or mismo_nombre(ext.get("nombre"), ofi.get("nombre")))


def calificar_caso(caso: dict, salida: dict) -> dict:
    of = caso["oficial"]
    post = salida.get("postores") or []
    ganadores = [p for p in post if p.get("ganador")]
    g = ganadores[0] if len(ganadores) == 1 else None
    monto_ok = None
    if g and g.get("monto_ofertado") and of["monto"]:
        monto_ok = abs(float(g["monto_ofertado"]) - of["monto"]) / of["monto"] <= 0.01
    texto, cobertura = texto_de(caso)
    obs = salida.get("observaciones", salida.get("senales")) or []
    citas = [cita_aparece(o.get("cita", ""), texto) for o in obs] if cobertura >= 0.9 else []
    fuera_sin_motivo = [p for p in post if not p.get("ganador") and (p.get("admitida") is False or p.get("calificada") is False)
                        and not p.get("motivo_fuera")]
    return {
        "es_buena_pro": bool(salida.get("es_buena_pro")),
        "postores_n": len(post) == len(of["postores"]),
        "postores": sum(any(coincide(e, o) for e in post) for o in of["postores"]) / len(of["postores"]),
        "ganador": bool(g and coincide(g, of["ganador"])),
        "monto": monto_ok,
        "motivo": (not fuera_sin_motivo) if any(not p.get("ganador") for p in post) else None,
        "citas": (sum(citas) / len(citas)) if citas else None,
        "con_texto": cobertura >= 0.9,
        "banderas": banderas_de(salida),
        "n_observaciones": len(obs),
    }


def pct(xs: list) -> str:
    v = [x for x in xs if x is not None]
    return f"{100 * sum(v) / len(v):.0f} % (n={len(v)})" if v else "—"


def jaccard(a: set, b: set) -> float:
    return len(a & b) / len(a | b) if a | b else 1.0


def main() -> None:
    etiquetas = sys.argv[1:]
    casos = {c["id"]: c for c in (json.loads(l) for l in CASOS.read_text(encoding="utf-8").splitlines() if l.strip())}
    opus = {r["ocid"]: r["extraido"] for r in json.loads((DATOS / "opus_piloto.json").read_text(encoding="utf-8"))} \
        if (DATOS / "opus_piloto.json").exists() else {}
    estratos = Counter(c["tags"][0] for c in casos.values())
    lineas = ["# Set de prueba: actas de buena pro", "",
              f"{len(casos)} actas de procesos de un ítem y un ganador en soles. Respuesta oficial de CONOSCE: postores (con "
              "el nombre y los integrantes de cada consorcio), ganador y monto adjudicado. Estratos: "
              + ", ".join(f"{k} {v}" for k, v in estratos.items()) + ".",
              "Generado por `calificar.py`; el detalle por caso queda en `datos/` (fuera del repo: trae nombres).", ""]
    banderas_por_corrida: dict[str, dict[str, set]] = {}
    for et in etiquetas:
        carpeta = DATOS / "corridas" / et
        filas = [json.loads(l) for l in (carpeta / "results.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
        errores = [l for l in (carpeta / "errors.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()] \
            if (carpeta / "errors.jsonl").exists() else []
        estados = Counter(f["status"] for f in filas)
        notas, por_estrato, detalle, banderas = [], defaultdict(list), [], Counter()
        vs_opus = defaultdict(list)
        banderas_por_corrida[et] = {}
        for f in filas:
            if f["status"] != "ok" or f["id"] not in casos:
                continue
            caso = casos[f["id"]]
            n = calificar_caso(caso, f["salida"])
            notas.append(n)
            por_estrato[caso["tags"][0]].append(n)
            banderas.update(n["banderas"])
            banderas_por_corrida[et][f["id"]] = set(n["banderas"])
            detalle.append({"id": f["id"], "estrato": caso["tags"][0],
                            **{k: v for k, v in n.items() if k != "banderas"}, "banderas": "|".join(n["banderas"]),
                            "costo_usd": f["costo_usd"]})
            if f["id"] in opus:
                o = calificar_caso(caso, opus[f["id"]])
                vs_opus["postores_igual"].append(len(f["salida"].get("postores") or []) == len(opus[f["id"]].get("postores") or []))
                vs_opus["ganador_ok_ambos"].append(n["ganador"] == o["ganador"])
                vs_opus["opus_ganador_ok"].append(o["ganador"])
        costos = [f["costo_usd"] for f in filas]
        lineas += [f"## {et} ({filas[0]['modelo'] if filas else '?'}, esfuerzo {filas[0]['esfuerzo'] if filas else '?'})", "",
                   f"- Respuestas: {dict(estados)}; sin respuesta (red o límite): {len(errores)}.",
                   f"- Costo: USD {sum(costos):.3f} en total, {statistics.mean(costos) if costos else 0:.4f} por acta "
                   f"(en lote, {sum(f['costo_lote_usd'] for f in filas) / max(len(filas), 1):.4f}); tokens por acta "
                   f"(mediana) {statistics.median([f['tokens_in'] for f in filas]) if filas else 0:.0f} de entrada y "
                   f"{statistics.median([f['tokens_out'] for f in filas]) if filas else 0:.0f} de salida; "
                   f"{statistics.median([f['segundos'] for f in filas]) if filas else 0:.0f} s.", "",
                   "| Métrica | Todo | " + " | ".join(por_estrato) + " |", "|---|---|" + "---|" * len(por_estrato)]
        for clave, nombre in [("es_buena_pro", "Reconoce el acta"), ("postores_n", "Cuántos postores (exacto)"),
                              ("postores", "Postores de CONOSCE encontrados"), ("ganador", "Ganador"),
                              ("monto", "Monto del ganador (±1 %)"), ("motivo", "Motivo de cada descartado"),
                              ("citas", "Citas que están en el PDF (con texto)")]:
            lineas.append(f"| {nombre} | {pct([n[clave] for n in notas])} | "
                          + " | ".join(pct([n[clave] for n in v]) for v in por_estrato.values()) + " |")
        lineas += ["", "Banderas (actas): " + ", ".join(f"{b} {banderas[b]}" for b in BANDERAS if banderas[b]) + ".",
                   f"Actas con alguna bandera: {pct([bool(n['banderas']) for n in notas])}; con observaciones del modelo: "
                   f"{pct([n['n_observaciones'] > 0 for n in notas])}; PDF con texto: {pct([n['con_texto'] for n in notas])}."]
        if vs_opus:
            lineas += ["", f"Contra el piloto con Opus 5.5 ({len(vs_opus['ganador_ok_ambos'])} actas, esquema v1): mismo "
                       f"número de postores {pct(vs_opus['postores_igual'])}; Opus acertó el ganador en "
                       f"{pct(vs_opus['opus_ganador_ok'])} y coinciden en acertar o fallar en {pct(vs_opus['ganador_ok_ambos'])}."]
        lineas.append("")
        with (DATOS / f"calificacion_{et}.csv").open("w", encoding="utf-8", newline="") as fh:
            if detalle:
                w = csv.DictWriter(fh, fieldnames=list(detalle[0]))
                w.writeheader()
                w.writerows(detalle)
    if len(etiquetas) >= 2:
        lineas += ["## Estabilidad entre corridas", ""]
        a, b = etiquetas[0], etiquetas[1]
        comunes = set(banderas_por_corrida[a]) & set(banderas_por_corrida[b])
        for bandera in BANDERAS:
            en_a = {i for i in comunes if bandera in banderas_por_corrida[a][i]}
            en_b = {i for i in comunes if bandera in banderas_por_corrida[b][i]}
            if en_a | en_b:
                lineas.append(f"- {bandera}: {len(en_a)} en {a}, {len(en_b)} en {b}, {len(en_a & en_b)} en ambas "
                              f"(coinciden {jaccard(en_a, en_b):.2f})")
        iguales = sum(banderas_por_corrida[a][i] == banderas_por_corrida[b][i] for i in comunes)
        lineas += [f"- Actas con exactamente las mismas banderas: {iguales} de {len(comunes)}.", ""]
    (AQUI / "informe.md").write_text("\n".join(lineas), encoding="utf-8")
    print("\n".join(lineas))


if __name__ == "__main__":
    main()
