"""Carga el RAG normativo en la base propia (tablas `norma` y `norma_fragmento`, migración 284).

    python -X utf8 backend/scripts/cargar_normas.py dev|prod chroma        # trae las 4 colecciones de Chroma Cloud
    python -X utf8 backend/scripts/cargar_normas.py dev|prod carpeta <dir> # carga fichas .json de una carpeta (ver abajo)
    python -X utf8 backend/scripts/cargar_normas.py dev|prod vectores      # calcula los embeddings que falten
    python -X utf8 backend/scripts/cargar_normas.py dev|prod reglas <json> # carga las reglas de cumplimiento (norma_regla)
    python -X utf8 backend/scripts/cargar_normas.py dev|prod cierres       # vigencias que dependen de otra norma (bases de 2025)
    python -X utf8 backend/scripts/cargar_normas.py dev|prod podar <dir>   # borra lo descargado que ya no está en la carpeta y los duplicados
    python -X utf8 backend/scripts/cargar_normas.py dev|prod estado

Las claves (Chroma, vigia-llm) salen de la configuración de la Lambda de agentes si no están en el entorno; no se imprimen.

Ficha de `carpeta` (un .json por norma o criterio, para lo que se descargue después: opiniones del OECE, acuerdos, etc.):
  {"slug": "opinion-012-2026-dtn", "documento": "Opinión N° 012-2026/DTN", "numero": "012-2026/DTN", "emisor": "OECE",
   "tipo": "opinion", "regimen": "32069", "fecha_emision": "2026-03-14", "url_oficial": "https://…",
   "fragmentos": [{"articulo": "29", "epigrafe": "Requisitos de calificación", "texto": "…", "pagina": 3}]}
Opcionales (migración 286): "materia" (contrataciones | control | presupuesto | administrativo | empleo_publico | inversion |
especial | integridad; empleo_publico, especial e integridad no salen en la búsqueda general: migraciones 287 y 331),
"estado", "verificacion" (C | S | PV), "version_de" (slug de la norma de la que esta es OTRA versión por fecha), "catalogo_id",
"sha256", "vigencia_desde", "vigencia_hasta". Las fichas salen de backend/scripts/normas_fichas.py.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "infrastructure" / "aws"))
from tunel_rds import conexion  # noqa: E402

JERARQUIA = {"ley": 1, "reglamento": 2, "directiva": 3, "bases_estandar": 3, "acuerdo_sala_plena": 4, "precedente": 4,
             "opinion": 5, "resolucion_tribunal": 5, "control": 6, "otra": 6}
TIPO_CHROMA = {"norma": "ley", "reglamento": "reglamento", "bases_estandar": "bases_estandar", "criterio_vinculante": "acuerdo_sala_plena",
               "opinion": "opinion", "control": "control"}
INICIO_32069 = "2025-04-22"


def _entorno_lambda() -> dict:
    r = subprocess.run(["aws", "lambda", "get-function-configuration", "--region", "us-east-2", "--function-name", "vigia-agente-servicios",
                        "--query", "Environment.Variables", "--output", "json"], capture_output=True, text=True, encoding="utf-8")
    return json.loads(r.stdout or "{}")


_ENV: dict = {}


def _env(k: str) -> str:
    if k in os.environ:
        return os.environ[k]
    if not _ENV:
        _ENV.update(_entorno_lambda())
    return _ENV.get(k, "")


def embeber(textos: list[str]) -> list[list[float]]:
    base = _env("WORKERS_AI_URL").rstrip("/")
    base = base[:-3] if base.endswith("/v1") else base
    req = urllib.request.Request(base + "/v1/embeddings", method="POST", data=json.dumps({"input": textos}).encode(),
                                 headers={"authorization": "Bearer " + _env("WORKERS_AI_TOKEN"), "content-type": "application/json",
                                          "user-agent": "vigia-carga/1"})
    for intento in range(4):
        try:
            d = json.loads(urllib.request.urlopen(req, timeout=90).read())
            return [x["embedding"] for x in d["data"]]
        except Exception as e:  # noqa: BLE001
            if intento == 3:
                raise
            print("  reintento de embeddings:", str(e)[:80], flush=True)
            time.sleep(3 * (intento + 1))
    return []


def _fecha(v) -> str | None:
    m = re.match(r"^(\d{4}-\d{2}-\d{2})", str(v or ""))
    return m.group(1) if m else None


def _regimen_y_fecha(meta: dict, tipo: str) -> tuple[str, str | None]:
    """El régimen y la fecha de emisión de un criterio. El nombre de las opiniones lo trae: «Opinión N° 4-2023/DTN
    (2023, Ley 30225 - DL 1444)». Sin dato, el año del número; una opinión de 2025 sin ley declarada va por su fecha."""
    doc = f"{meta.get('documento') or ''} {meta.get('numero') or ''}"
    reg = str(meta.get("regimen") or "").strip()
    anio = None
    m = re.search(r"\b(20[0-3]\d)\b", doc)
    if m:
        anio = int(m.group(1))
    fecha = _fecha(meta.get("fecha_emision")) or _fecha(meta.get("fecha")) or _fecha(meta.get("vigencia_desde"))
    if tipo in ("opinion", "acuerdo_sala_plena", "precedente", "resolucion_tribunal"):
        if "30225" in doc or "1444" in doc or "1341" in doc:
            reg = "30225"
        elif "32069" in doc:
            reg = "32069"
        elif reg not in ("32069", "30225"):
            # «ambos» en un criterio casi siempre es un acuerdo emitido bajo la ley anterior: va por su año.
            reg = "30225" if (anio and anio < 2025) else ("32069" if (anio and anio >= 2026) else (reg or "ambos"))
        if not fecha and anio:
            fecha = f"{anio}-01-01"
    if reg not in ("32069", "30225", "ambos"):
        reg = "ambos"
    return reg, fecha


_RE_ART = re.compile(r"^\s*art[íi]culo\s+(\d+[A-Za-z]?(?:\.\d+)?)\s*[.\-–:º°]*\s*([^\n]{0,140})", re.I | re.M)


def _articulo(meta: dict, texto: str) -> tuple[str | None, str | None]:
    art = str(meta.get("articulo") or "").strip() or None
    m = _RE_ART.search(texto or "")
    epi = None
    if m:
        art = art or m.group(1)
        epi = (m.group(2) or "").strip(" .-–:") or None
    return art, (epi[:160] if epi else None)


def _hash(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()[:32]


def _guardar(cu, norma: dict, fragmentos: list[dict]) -> int:
    cu.execute("""INSERT INTO norma (slug, documento, numero, emisor, tipo, jerarquia, regimen, fecha_emision, vigencia_desde, vigencia_hasta,
                                     url_oficial, url_pdf, origen, nota, actualizado_at)
                  VALUES (%(slug)s, %(documento)s, %(numero)s, %(emisor)s, %(tipo)s, %(jerarquia)s, %(regimen)s, %(fecha_emision)s,
                          %(vigencia_desde)s, %(vigencia_hasta)s, %(url_oficial)s, %(url_pdf)s, %(origen)s, %(nota)s, now())
                  ON CONFLICT (slug) DO UPDATE SET documento = EXCLUDED.documento, numero = EXCLUDED.numero, emisor = EXCLUDED.emisor,
                    tipo = EXCLUDED.tipo, jerarquia = EXCLUDED.jerarquia, regimen = EXCLUDED.regimen, fecha_emision = EXCLUDED.fecha_emision,
                    vigencia_desde = EXCLUDED.vigencia_desde, vigencia_hasta = EXCLUDED.vigencia_hasta, url_oficial = EXCLUDED.url_oficial,
                    url_pdf = EXCLUDED.url_pdf, origen = EXCLUDED.origen, nota = EXCLUDED.nota, actualizado_at = now()""", norma)
    extra = {k: norma.get(k) for k in ("materia", "estado", "verificacion", "version_de", "catalogo_id", "sha256") if norma.get(k)}
    if extra:          # columnas de la migración 286: sólo las que trae la ficha
        cu.execute("UPDATE norma SET " + ", ".join(f"{k} = %s" for k in extra) + " WHERE slug = %s", (*extra.values(), norma["slug"]))
    cu.execute("SELECT orden, hash FROM norma_fragmento WHERE slug = %s", (norma["slug"],))
    hay = dict(cu.fetchall())
    nuevos = {f["orden"]: f for f in fragmentos}
    sobran = [o for o in hay if o not in nuevos]
    if sobran:
        cu.execute("DELETE FROM norma_fragmento WHERE slug = %s AND orden = ANY(%s)", (norma["slug"], sobran))
    n = 0
    for o, f in nuevos.items():
        if hay.get(o) == f["hash"]:
            continue
        cu.execute("""INSERT INTO norma_fragmento (slug, orden, articulo, epigrafe, pagina, texto, hash)
                      VALUES (%s, %s, %s, %s, %s, %s, %s)
                      ON CONFLICT (slug, orden) DO UPDATE SET articulo = EXCLUDED.articulo, epigrafe = EXCLUDED.epigrafe,
                        pagina = EXCLUDED.pagina, texto = EXCLUDED.texto, hash = EXCLUDED.hash, embedding = NULL""",
                   (norma["slug"], o, f.get("articulo"), f.get("epigrafe"), f.get("pagina"), f["texto"], f["hash"]))
        n += 1
    return n


def desde_chroma(cn) -> None:
    # El mismo cliente que usa el agente (tools/legal.py), con sus variables.
    for k in ("CHROMA_API_KEY", "CHROMA_TENANT", "CHROMA_DATABASE"):
        if _env(k):
            os.environ[k] = _env(k)
    sys.path.insert(0, str(RAIZ / "backend" / "agent"))
    from tools import legal as L
    cli = L._chroma_cliente()
    cu = cn.cursor()
    for corpus in ("normas-vigentes", "normas-historicas", "criterios-vinculantes", "control-cgr"):
        col = cli.get_collection(f"vigia_{corpus}")
        total, por_slug = col.count(), {}
        for ini in range(0, total, 300):
            g = col.get(limit=300, offset=ini, include=["documents", "metadatas"])
            for _id, doc, meta in zip(g["ids"], g["documents"], g["metadatas"]):
                meta = meta or {}
                slug = str(meta.get("slug") or _hash(str(meta.get("uri") or _id)))
                por_slug.setdefault(slug, []).append((meta, doc or "", _id))
        cambios = 0
        for slug, trozos in por_slug.items():
            m0 = trozos[0][0]
            tipo = TIPO_CHROMA.get(str(m0.get("tipo") or ""), "otra")
            if tipo == "bases_estandar" or re.search(r"directiva", str(m0.get("documento") or ""), re.I) and tipo not in ("ley", "reglamento"):
                tipo = "bases_estandar" if re.search(r"bases|anexo", str(m0.get("documento") or ""), re.I) else "directiva"
            reg, fecha = _regimen_y_fecha(m0, tipo)
            norma = {"slug": slug, "documento": str(m0.get("documento") or slug)[:300], "numero": m0.get("numero"), "emisor": m0.get("emisor"),
                     "tipo": tipo, "jerarquia": JERARQUIA[tipo], "regimen": reg, "fecha_emision": fecha,
                     "vigencia_desde": _fecha(m0.get("vigencia_desde")) or (INICIO_32069 if (reg == "32069" and tipo in ("ley", "reglamento")) else None),
                     "vigencia_hasta": _fecha(m0.get("vigencia_hasta")), "url_oficial": m0.get("url_oficial"), "url_pdf": m0.get("url_pdf"),
                     "origen": "chroma", "nota": f"corpus {corpus}"}
            # El orden del trozo: el que traiga la metadata, o el del id.
            def _orden(t):
                c = t[0].get("chunk")
                if isinstance(c, (int, float)):
                    return int(c)
                mm = re.search(r"(\d+)\D*$", str(t[2]))
                return int(mm.group(1)) if mm else 0
            frag, vistos = [], set()
            for i, (meta, doc, _id) in enumerate(sorted(trozos, key=_orden)):
                texto = doc.strip()
                if len(texto) < 40 or _hash(texto) in vistos:
                    continue
                vistos.add(_hash(texto))
                art, epi = _articulo(meta, texto)
                frag.append({"orden": i, "articulo": art, "epigrafe": epi, "pagina": meta.get("pagina") if isinstance(meta.get("pagina"), int) else None,
                             "texto": texto, "hash": _hash(texto)})
            cambios += _guardar(cu, norma, frag)
        cn.commit()
        print(f"{corpus}: {total} trozos en Chroma, {len(por_slug)} documentos, {cambios} fragmentos nuevos o cambiados", flush=True)


def desde_carpeta(cn, carpeta: Path) -> None:
    cu = cn.cursor()
    n = 0
    for f in sorted(carpeta.glob("*.json")):
        if f.name.startswith("_"):
            continue
        d = json.loads(f.read_text(encoding="utf-8"))
        tipo = d.get("tipo") or "otra"
        norma = {"slug": d["slug"], "documento": d["documento"], "numero": d.get("numero"), "emisor": d.get("emisor"), "tipo": tipo,
                 "jerarquia": JERARQUIA.get(tipo, 6), "regimen": d.get("regimen") or "ambos", "fecha_emision": _fecha(d.get("fecha_emision")),
                 "vigencia_desde": _fecha(d.get("vigencia_desde")), "vigencia_hasta": _fecha(d.get("vigencia_hasta")),
                 "url_oficial": d.get("url_oficial"), "url_pdf": d.get("url_pdf"), "origen": d.get("origen") or "descarga", "nota": d.get("nota"),
                 **{k: d.get(k) for k in ("materia", "estado", "verificacion", "version_de", "catalogo_id", "sha256")}}
        frag = [{"orden": i, "articulo": x.get("articulo"), "epigrafe": x.get("epigrafe"), "pagina": x.get("pagina"), "texto": x["texto"].strip(),
                 "hash": _hash(x["texto"].strip())} for i, x in enumerate(d.get("fragmentos") or []) if len((x.get("texto") or "").strip()) >= 40]
        n += _guardar(cu, norma, frag)
    cn.commit()
    print(f"{carpeta}: {n} fragmentos nuevos o cambiados", flush=True)


def reglas(cn, archivo: Path) -> None:
    """Las reglas de cumplimiento del paquete docs/rag_legal_peru (02_datos/reglas_cumplimiento.json) a `norma_regla`."""
    dato = json.loads(archivo.read_text(encoding="utf-8"))
    lista = dato if isinstance(dato, list) else list(dato.values())[0]
    cu = cn.cursor()
    # Qué regla de Vigía ya la cubre (backend/rag/reglas_vigia.json): para ver en el panel lo que falta construir.
    cubre = json.loads((RAIZ / "backend" / "rag" / "reglas_vigia.json").read_text(encoding="utf-8"))
    for r in lista:
        c = cubre.get(r["id"]) or {}
        cu.execute("""INSERT INTO norma_regla (id, categoria, fase, descripcion, fundamento, normas, tipo_verificacion, parametro, valor_referencia,
                                               severidad, regimen, verificacion, regla_vigia, nota, actualizado_at)
                      VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
                      ON CONFLICT (id) DO UPDATE SET categoria = EXCLUDED.categoria, fase = EXCLUDED.fase, descripcion = EXCLUDED.descripcion,
                        fundamento = EXCLUDED.fundamento, normas = EXCLUDED.normas, tipo_verificacion = EXCLUDED.tipo_verificacion,
                        parametro = EXCLUDED.parametro, valor_referencia = EXCLUDED.valor_referencia, severidad = EXCLUDED.severidad,
                        regimen = EXCLUDED.regimen, verificacion = EXCLUDED.verificacion, regla_vigia = EXCLUDED.regla_vigia,
                        nota = EXCLUDED.nota, actualizado_at = now()""",
                   (r["id"], r.get("categoria") or "transversal", r.get("fase"), r["descripcion"], c.get("fundamento") or r.get("fundamento"),
                    list(r.get("normas_ids") or []),
                    r.get("tipo_verificacion"), r.get("parametro") or None, r.get("valor_referencia_2026") or None, r.get("severidad"),
                    list(r.get("regimen") or []), c.get("verificacion") or r.get("verificacion"), ", ".join(c.get("reglas") or []) or None, c.get("nota")))
    cn.commit()
    print("reglas cargadas:", len(lista), flush=True)


def podar(cn, carpeta: Path) -> None:
    """La carpeta manda: borra lo descargado que ya no está entre las fichas (una norma renombrada o descartada) y las
    opiniones cargadas desde Chroma (una fila por conclusión) cuya opinión completa ya llegó desde su página oficial."""
    slugs = [json.loads(f.read_text(encoding="utf-8"))["slug"] for f in sorted(carpeta.glob("*.json")) if not f.name.startswith("_")]
    if len(slugs) < 50:
        raise SystemExit(f"{carpeta}: sólo {len(slugs)} fichas; no se poda con una carpeta a medias")
    cu = cn.cursor()
    cu.execute("DELETE FROM norma WHERE origen = 'descarga' AND NOT (slug = ANY(%s)) RETURNING slug", (slugs,))
    fuera = [r[0] for r in cu.fetchall()]
    print("descargadas que ya no están en la carpeta:", len(fuera), fuera[:8], flush=True)
    # La misma opinión por el número de su página en gob.pe (…/informes-publicaciones/<número>-opinion-…).
    cu.execute("""DELETE FROM norma v USING norma n
                   WHERE v.tipo = 'opinion' AND v.origen = 'chroma' AND n.tipo = 'opinion' AND n.origen = 'descarga'
                     AND substring(v.url_oficial FROM 'informes-publicaciones/([0-9]+)-') IS NOT NULL
                     AND substring(v.url_oficial FROM 'informes-publicaciones/([0-9]+)-') = substring(n.url_oficial FROM 'informes-publicaciones/([0-9]+)-')
                  RETURNING v.slug""")
    print("conclusiones sueltas reemplazadas por su opinión completa:", cu.rowcount, flush=True)
    cn.commit()


def cierres(cn) -> None:
    """Vigencias que dependen de otra norma. Las bases estándar de 2025 (cargadas desde Chroma) rigen hasta el 13-01-2026:
    desde el 14 se convoca con las que aprobó la R.D. 0001-2026-EF/54.01 (cuadro comparativo del OECE del D.S. 001-2026-EF)."""
    cu = cn.cursor()
    cu.execute("""UPDATE norma SET vigencia_hasta = DATE '2026-01-13', estado = 'vigente_modificada'
                   WHERE tipo = 'bases_estandar' AND origen = 'chroma' AND regimen = '32069' AND vigencia_hasta IS NULL
                     AND slug LIKE 'bases-estandar-%%-2025'""")
    print("bases estándar de 2025 cerradas al 13-01-2026:", cu.rowcount, flush=True)
    cn.commit()


def vectores(cn, lote: int = 24) -> None:
    cu = cn.cursor()
    hechos = 0
    while True:
        cu.execute("SELECT id, left(coalesce(epigrafe || '. ', '') || texto, 6000) FROM norma_fragmento WHERE embedding IS NULL ORDER BY id LIMIT %s", (lote,))
        filas = cu.fetchall()
        if not filas:
            break
        vs = embeber([t for _i, t in filas])
        for (i, _t), v in zip(filas, vs):
            cu.execute("UPDATE norma_fragmento SET embedding = %s::halfvec WHERE id = %s", ("[" + ",".join(f"{x:.6f}" for x in v) + "]", i))
        cn.commit()
        hechos += len(filas)
        if hechos % 480 == 0:
            print("  vectores:", hechos, flush=True)
    print("vectores calculados:", hechos, flush=True)


def estado(cn) -> None:
    cu = cn.cursor()
    cu.execute("""SELECT n.tipo, n.regimen, count(DISTINCT n.slug), count(f.id), count(f.embedding), count(f.articulo),
                         min(COALESCE(n.fecha_emision, n.vigencia_desde))::text, max(COALESCE(n.fecha_emision, n.vigencia_desde))::text
                    FROM norma n LEFT JOIN norma_fragmento f ON f.slug = n.slug GROUP BY 1, 2 ORDER BY min(n.jerarquia), 2""")
    print("tipo | régimen | documentos | fragmentos | con vector | con artículo | desde | hasta")
    for r in cu.fetchall():
        print(" | ".join(str(x) for x in r))


if __name__ == "__main__":
    destino, que = sys.argv[1], sys.argv[2]
    with conexion(destino) as cn:
        cu0 = cn.cursor()
        cu0.execute("SET statement_timeout = 0")
        if que == "chroma":
            desde_chroma(cn)
        elif que == "carpeta":
            desde_carpeta(cn, Path(sys.argv[3]))
        elif que == "vectores":
            vectores(cn)
        elif que == "podar":
            podar(cn, Path(sys.argv[3]))
        elif que == "cierres":
            cierres(cn)
        elif que == "reglas":
            reglas(cn, Path(sys.argv[3]))
        estado(cn)
