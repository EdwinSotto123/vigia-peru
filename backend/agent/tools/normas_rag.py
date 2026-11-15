"""RAG normativo en la base propia, con fecha y jerarquía (tablas `norma` y `norma_fragmento`, migración 284).

El agente legal pregunta y recibe, PARA LA FECHA de la convocatoria:
  · `norma`              artículos de la ley, el reglamento, las directivas y las bases estándar que regían ese día;
  · `criterio`           acuerdos, precedentes y opiniones del MISMO régimen;
  · `criterio_anterior`  opiniones o acuerdos emitidos bajo la OTRA ley: valen por analogía y llevan la advertencia de
                         que sus artículos no son los vigentes.
Las normas del otro régimen no salen. La búsqueda es híbrida (palabras + vector) y la jerarquía ordena.

Antes (Chroma): 37 de 45 criterios devueltos para un contrato de la Ley 32069 eran de la ley anterior, sin decirlo.
Sin tablas, sin vector o sin resultados devuelve `error` y `query_legal_rag` sigue con su respaldo."""
from __future__ import annotations

import datetime as dt
import json
import os
import re

CUPO = {"norma": int(os.getenv("NORMAS_K_NORMA", "5")), "criterio": int(os.getenv("NORMAS_K_CRITERIO", "3")),
        "criterio_anterior": int(os.getenv("NORMAS_K_ANTERIOR", "2"))}
MAX_BASES_ESTANDAR = 2          # los anexos de bases estándar no deben copar el cupo de normas
INICIO_32069 = dt.date(2025, 4, 22)
NOMBRE_LEY = {"32069": "Ley N° 32069", "30225": "Ley N° 30225"}
CORPUS = {"norma": "normas", "criterio": "criterios", "criterio_anterior": "criterios-regimen-anterior"}


def embeber_pregunta(texto: str) -> list[float] | None:
    """El vector de la pregunta con el mismo modelo de los fragmentos (bge-m3, por vigia-llm). None si no se pudo."""
    base = (os.getenv("WORKERS_AI_URL") or "").rstrip("/")
    token = os.getenv("WORKERS_AI_TOKEN") or ""
    if not base or not token:
        return None
    base = base[:-3] if base.endswith("/v1") else base
    try:
        import requests
        r = requests.post(base + "/v1/embeddings", json={"input": [texto[:2000]]}, timeout=float(os.getenv("NORMAS_EMBED_TIMEOUT_S", "20")),
                          headers={"authorization": f"Bearer {token}", "user-agent": "vigia-agente/1"})
        r.raise_for_status()
        return r.json()["data"][0]["embedding"]
    except Exception:  # noqa: BLE001 — sin vector se busca sólo por palabras
        return None


def _fecha(v) -> dt.date | None:
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", str(v or ""))
    try:
        return dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else None
    except ValueError:
        return None


def _cita_formato(f: dict) -> str:
    art = f"Art. {f['articulo']} de " if f.get("articulo") and f["tipo"] in ("ley", "reglamento") else ""
    return f"{art}{f.get('numero') or f.get('documento')}" + (f" ({f['url_oficial']})" if f.get("url_oficial") else "")


def elegir(filas: list[dict], cupo: dict | None = None) -> list[dict]:
    """De los candidatos (ya ordenados por puntaje) arma la respuesta: sin repetir artículo, con cupos por tipo de
    aplicación y con las bases estándar acotadas. El orden final: normas, criterios del régimen, criterios anteriores."""
    cupo = cupo or CUPO
    vistos, por = set(), {"norma": [], "criterio": [], "criterio_anterior": []}
    n_bases = 0
    for f in filas:
        ap = f.get("aplica")
        if ap not in por or len(por[ap]) >= cupo.get(ap, 0):
            continue
        clave = (f.get("slug"), f.get("articulo") or (f.get("texto") or "")[:80])
        if clave in vistos:
            continue
        if f.get("tipo") == "bases_estandar":
            if n_bases >= MAX_BASES_ESTANDAR:
                continue
            n_bases += 1
        vistos.add(clave)
        por[ap].append(f)
    # Un lugar para la directiva: la ley y el reglamento pesan más y copaban el cupo aunque la pregunta fuera sobre algo
    # que sólo regula una directiva (el cuaderno de incidencias, la ficha del proveedor, los acuerdos marco).
    if por["norma"] and not any(x.get("tipo") == "directiva" for x in por["norma"]):
        mejor = next((x for x in filas if x.get("aplica") == "norma" and x.get("tipo") == "directiva"), None)
        if mejor is not None:
            if len(por["norma"]) >= cupo.get("norma", 0):
                por["norma"].pop()
            por["norma"].append(mejor)
    return por["norma"] + por["criterio"] + por["criterio_anterior"]


def texto_de_la_fecha(cur, filas: list[dict], f: dt.date) -> None:
    """Un artículo puede tener OTRO texto para la fecha del proceso (el Reglamento cambió 123 artículos el 14-01-2026).
    Si existe una versión (`norma.version_de`) de ese artículo que regía ese día, el agente recibe ESE texto."""
    pares = sorted({(x["slug"], x["articulo"]) for x in filas if x.get("articulo") and x.get("aplica") == "norma"})
    if not pares:
        return
    try:
        cur.execute("""SELECT n.version_de, f.articulo, n.slug, n.documento, n.vigencia_hasta, string_agg(f.texto, E'\n' ORDER BY f.orden)
                         FROM norma n JOIN norma_fragmento f ON f.slug = n.slug
                        WHERE n.version_de = ANY(%s) AND f.articulo = ANY(%s)
                          AND COALESCE(n.vigencia_desde, DATE '1900-01-01') <= %s AND (n.vigencia_hasta IS NULL OR n.vigencia_hasta >= %s)
                        GROUP BY 1, 2, 3, 4, 5""", ([p[0] for p in pares], [p[1] for p in pares], f, f))
        version = {(r[0], r[1]): r for r in cur.fetchall()}
    except Exception:  # noqa: BLE001 — sin la migración 286 no hay versiones: queda el texto vigente
        return
    for x in filas:
        v = version.get((x.get("slug"), x.get("articulo")))
        if v and x.get("aplica") == "norma":
            x["texto"], x["documento"], x["version_fecha"] = v[5], v[3], f"texto que regía hasta el {v[4]:%d-%m-%Y}" if v[4] else "versión de la fecha"
            x["slug_version"] = v[2]


def buscar_normas(pregunta: str, fecha=None, tipos: list[str] | None = None, conn=None, vector=...) -> dict:
    """{question, fecha, regimen, matches[], _source: 'vigia_normas'} o {error}. `fecha`: la de la convocatoria."""
    f = _fecha(fecha) or dt.date.today()
    regimen = "32069" if f >= INICIO_32069 else "30225"
    vec = embeber_pregunta(pregunta) if vector is ... else vector
    cerrar = conn is None
    try:
        if conn is None:
            from tools._core import _pg
            conn = _pg()
        cur = conn.cursor()
        cur.execute("SELECT * FROM buscar_norma(%s, %s::halfvec, %s, 40, %s)",
                    (pregunta, ("[" + ",".join(f"{x:.6f}" for x in vec) + "]") if vec else None, f, tipos))
        cols = [d[0] for d in cur.description]
        filas = [dict(zip(cols, r)) for r in cur.fetchall()]
        elegidas = elegir(filas)
        texto_de_la_fecha(cur, elegidas, f)
    except Exception as e:  # noqa: BLE001
        return {"error": f"normas: {str(e)[:160]}", "question": pregunta}
    finally:
        if cerrar and conn is not None:
            try:
                conn.close()
            except Exception:  # noqa: BLE001
                pass
    if not filas:
        return {"error": "normas_sin_resultados", "question": pregunta, "regimen": regimen}
    tope = max(float(x.get("puntaje") or 0) for x in filas) or 1.0
    matches = []
    vistos = set()
    for x in elegidas:
        clave = (x.get("slug_version") or x.get("slug"), x.get("articulo") or id(x))
        if clave in vistos:          # el mismo artículo llegó por el texto vigente y por su versión anterior
            continue
        vistos.add(clave)
        otro = "30225" if regimen == "32069" else "32069"
        m = {
            "corpus": CORPUS[x["aplica"]], "aplica": x["aplica"], "tipo": x["tipo"], "documento": x["documento"], "numero": x.get("numero"),
            "articulo": x.get("articulo"), "epigrafe": x.get("epigrafe"), "pagina": x.get("pagina"),
            "cita": re.sub(r"\s+", " ", x.get("texto") or "").strip()[:700], "url_oficial": x.get("url_oficial") or "",
            "regimen": x.get("regimen"), "fecha_emision": x["fecha_emision"].isoformat() if x.get("fecha_emision") else None,
            # 0 a 1 relativo al mejor candidato: el umbral de pertinencia de las reglas (0,7) sigue teniendo sentido.
            "score": round(float(x.get("puntaje") or 0) / tope, 4), "cita_formato": _cita_formato(x),
            # Claves que esperan las reglas que eligen una opinión (compliance_rules._elegir_opinion_pertinente).
            "num_opinion": x.get("numero") if x["tipo"] == "opinion" else None, "norma": x.get("numero") or x.get("documento"),
            "interpretacion_snippet": re.sub(r"\s+", " ", x.get("texto") or "").strip()[:400], "link": x.get("url_oficial") or "",
        }
        if x.get("version_fecha"):
            m["version"] = x["version_fecha"]
        if x["aplica"] == "criterio_anterior":
            m["advertencia"] = (f"Emitido bajo la {NOMBRE_LEY[otro]}, que NO rige este proceso ({NOMBRE_LEY[regimen]}). Sirve sólo por analogía: "
                                f"no cites sus artículos como vigentes; cita el artículo equivalente de la norma aplicable si aparece arriba.")
        matches.append(m)
    return {"question": pregunta, "fecha": f.isoformat(), "regimen": regimen, "n_matches": len(matches), "matches": matches,
            "busqueda": "hibrida" if vec else "solo_palabras", "_source": "vigia_normas",
            "como_citar": ("Cita primero las entradas `aplica: norma` (rigen en la fecha del proceso). Un `criterio_anterior` no se "
                           "cita como norma vigente.")}


if __name__ == "__main__":      # prueba rápida: python -m tools.normas_rag "pregunta" 2026-05-01
    import sys
    print(json.dumps(buscar_normas(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None), ensure_ascii=False, indent=1)[:4000])
