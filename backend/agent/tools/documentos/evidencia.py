"""Post-proceso de una extracción: verificación de evidencia contra el texto de la
página, sha256 por dato, remapeo de precio/marca según la etapa del documento."""

from tools._core import *  # noqa: F401,F403
from ._base import CITA_MAX, TEXTO_LITERAL_MAX, _BLOQUES_VALIDOS, _norm_txt
from .clasificacion import _es_doc_contratacion, _origen_precio


# ── Post-proceso: evidencia verificable, sha256 por dato, alias de compat ──────────────
def _cita_en_pagina(cita: str, texto_pagina: str) -> bool:
    """¿La cita (normalizada) aparece en el texto de la página? Tolerante a espacios/tildes/caja;
    con citas largas basta con que aparezca un prefijo de 60 chars normalizados."""
    c = _norm_txt(cita or "")
    t = _norm_txt(texto_pagina or "")
    if not c or not t:
        return False
    if c in t:
        return True
    c2 = re.sub(r"[^A-Z0-9 ]", " ", c)
    t2 = re.sub(r"[^A-Z0-9 ]", " ", t)
    c2 = " ".join(c2.split()); t2 = " ".join(t2.split())
    if c2 and c2 in t2:
        return True
    return len(c2) > 60 and c2[:60] in t2


_FOLIO_RX = (
    re.compile(r"p[aá]g(?:ina)?\.?\s*(?:n[°º]?\s*)?(\d{1,3})\s*(?:de|/)\s*\d{1,3}", re.I),
    re.compile(r"^\s*(?:p[aá]g(?:ina)?\.?\s*)?(\d{1,3})\s*(?:de|/)\s*\d{1,3}\s*$", re.I | re.M),
    re.compile(r"^\s*(?:-\s*)?(\d{1,3})\s*(?:-\s*)?$", re.M),
)


def _detectar_folio(texto: str) -> int | None:
    """Número IMPRESO de página (folio) si el pie/cabecera lo trae: 'Página 22 de 69',
    '22 / 69' o un número suelto en las 3 últimas / 2 primeras líneas. None si no se ve.
    Es informativo: la página citada es SIEMPRE el índice real ⟦p.N⟧."""
    t = (texto or "").strip()
    if not t:
        return None
    lineas = [l for l in t.splitlines() if l.strip()]
    borde = "\n".join(lineas[-3:] + lineas[:2])
    pie = "\n".join(lineas[-2:])
    for i, rx in enumerate(_FOLIO_RX):
        m = rx.search(borde if i < 2 else pie)   # el número suelto solo cuenta en el pie
        if m:
            try:
                n = int(m.group(1))
                if 0 < n < 1000:
                    return n
            except Exception:
                continue
    return None


def _tokens_cita(cita: str) -> list[str]:
    c = re.sub(r"[^A-Z0-9 ]", " ", _norm_txt(cita or ""))
    return [t for t in c.split() if len(t) >= 3 or t.isdigit()]


def _cita_tokens_en_pagina(cita: str, texto_pagina: str) -> bool:
    """Bolsa de tokens: ≥ 85 % de los tokens de la cita (mín. 4) están en la página. Cubre
    filas de tabla que el OCR reordena o parte en dos líneas (Formato 11, tablas de la OC)."""
    toks = _tokens_cita(cita)
    if len(toks) < 4:
        return False
    t = " " + re.sub(r"[^A-Z0-9 ]", " ", _norm_txt(texto_pagina or "")) + " "
    t = " ".join(t.split())
    t = f" {t} "
    hits = sum(1 for k in toks if f" {k} " in t)
    return hits / len(toks) >= 0.85


def _verificar_evidencia(obj: dict, paginas_by_n: dict[int, dict], sha256: str | None, stats: dict) -> None:
    """Marca cada evidencia como verificada/no verificada contra el texto de la página y
    estampa `documento_sha256`. No borra nada: V (verify.py) decide qué persistir.
    Orden: página declarada → ±1 → TODAS las páginas (el LLM a veces cita el folio impreso
    en vez del índice ⟦p.N⟧: se corrige `pagina` y se conserva `pagina_declarada`) → bolsa de
    tokens en la página declarada ±1 (`verificacion='tokens'`). `folio` = número impreso
    detectado en la página final, si lo hay."""
    if not isinstance(obj, dict):
        return
    obj["documento_sha256"] = sha256
    evs = obj.get("evidencia")
    if not isinstance(evs, list):
        obj["evidencia"] = []
        return
    out = []
    for ev in evs:
        if not isinstance(ev, dict):
            continue
        cita = str(ev.get("cita") or "")[:CITA_MAX]
        pagina = ev.get("pagina")
        try:
            pagina = int(pagina) if pagina is not None else None
        except Exception:
            pagina = None
        declarada = pagina
        ok = False
        metodo = None
        if pagina is not None and pagina in paginas_by_n:
            ok = _cita_en_pagina(cita, paginas_by_n[pagina].get("texto") or "")
            if ok:
                metodo = "literal"
            if not ok:  # tolerancia ±1 página (tablas que cruzan de página)
                for q in (pagina - 1, pagina + 1):
                    if q in paginas_by_n and _cita_en_pagina(cita, paginas_by_n[q].get("texto") or ""):
                        ok, pagina, metodo = True, q, "literal"
                        break
        if not ok and len(_tokens_cita(cita)) >= 3:
            # folio impreso ≠ índice real: buscar la cita literal en todo el documento
            for q, pg in sorted(paginas_by_n.items()):
                if q == declarada:
                    continue
                if _cita_en_pagina(cita, pg.get("texto") or ""):
                    ok, pagina, metodo = True, q, "literal"
                    break
        if not ok and declarada is not None:
            for q in (declarada, declarada - 1, declarada + 1):
                if q in paginas_by_n and _cita_tokens_en_pagina(cita, paginas_by_n[q].get("texto") or ""):
                    ok, pagina, metodo = True, q, "tokens"
                    break
        stats["total"] = stats.get("total", 0) + 1
        stats["verificadas"] = stats.get("verificadas", 0) + (1 if ok else 0)
        e = {"pagina": pagina, "cita": cita, "verificada": ok, "documento_sha256": sha256}
        if metodo:
            e["verificacion"] = metodo
        if ok and declarada is not None and declarada != pagina:
            e["pagina_declarada"] = declarada
            stats["paginas_corregidas"] = stats.get("paginas_corregidas", 0) + 1
        folio = None
        if pagina is not None and pagina in paginas_by_n:
            folio = _detectar_folio(paginas_by_n[pagina].get("texto") or "")
        if folio is None:
            try:
                folio = int(ev["folio"]) if ev.get("folio") is not None else None
            except Exception:
                folio = None
        if folio is not None:
            e["folio"] = folio
        out.append(e)
    obj["evidencia"] = out


_KW_MARCA = ("MARCA", "MODELO", "EQUIVALENTE", "SIMILAR")


def _marca_respaldada(marca: str, paginas: list[dict]) -> tuple[bool, int | None]:
    """¿El texto del documento contiene la marca Y, en esa misma página, la palabra
    'marca'/'modelo'/'equivalente'/'similar'? Si no, la marca no fue EXIGIDA por ese
    documento (vino de otro lado o el LLM la infirió de códigos de parte)."""
    m = _norm_txt(marca or "")
    m = re.sub(r"\b(O|U)\s+(SIMILAR|EQUIVALENTE)\b", " ", m)
    m = re.sub(r"[^A-Z0-9 ]", " ", m)
    m = " ".join(m.split())
    if len(m) < 2:
        return False, None
    for pg in paginas or []:
        t = " ".join(re.sub(r"[^A-Z0-9 ]", " ", _norm_txt(pg.get("texto") or "")).split())
        if m in t and any(k in t for k in _KW_MARCA):
            return True, pg.get("n")
    return False, None


def _post_procesar(data: dict, tx: dict, sha256: str | None, doc: dict | None = None) -> dict:
    """Aplica verificación de evidencia a ítems/postores/firmantes/comité/motivos/bloques,
    recorta `texto_literal` al tope, y deja `requerimiento_tecnico_detallado` como ALIAS de
    `texto_literal` para los consumidores existentes (market, legal, self-eval).

    Además (lote 1 · T7) etiqueta cada ítem con la ETAPA del documento y remapea los campos
    según ella: en documentos de CONTRATACIÓN (contrato/OC/acta/propuesta) el precio va a
    `precio_unitario_contratado` (u `ofertado`) y la marca a `marca_ofertada`; nunca quedan
    como `precio_unitario_referencial` / `marca_o_modelo_exigido`. En documentos de
    REQUERIMIENTO, `marca_o_modelo_exigido` solo sobrevive si el texto del documento trae
    la marca junto a 'marca'/'modelo'/'equivalente'/'similar' (si no → `marca_no_respaldada`)."""
    paginas = tx.get("paginas") or []
    paginas_by_n = {int(p["n"]): p for p in paginas if p.get("n") is not None}
    stats: dict = {}
    tipo = data.get("tipo_documento_detectado")
    contratacion = _es_doc_contratacion(tipo, doc)
    data["_etapa"] = "contratacion" if contratacion else "requerimiento"
    descartes: list[dict] = list(data.get("_descartes_parser") or [])
    origen = _origen_precio(tipo, doc) if contratacion else None
    for it in (data.get("items") or []):
        if not isinstance(it, dict):
            continue
        tl = it.get("texto_literal")
        if isinstance(tl, str) and len(tl) > TEXTO_LITERAL_MAX:
            it["texto_literal"] = tl[:TEXTO_LITERAL_MAX]
            it["texto_literal_truncado"] = True
        if it.get("texto_literal") and not it.get("requerimiento_tecnico_detallado"):
            it["requerimiento_tecnico_detallado"] = it["texto_literal"]
        _verificar_evidencia(it, paginas_by_n, sha256, stats)
        it["_tipo_documento"] = tipo
        it["_etapa"] = data["_etapa"]
        if contratacion:
            pu = it.get("precio_unitario_contratado") or it.get("precio_unitario_ofertado") or it.get("precio_unitario_referencial")
            if origen in ("contrato", "orden_de_compra", "adenda"):
                it["precio_unitario_contratado"] = pu
                it.setdefault("precio_unitario_ofertado", None)
            else:
                it["precio_unitario_ofertado"] = pu
                it.setdefault("precio_unitario_contratado", None)
            it["origen_precio"] = origen if pu else None
            marca = it.get("marca_ofertada") or it.get("marca_o_modelo_exigido")
            it["marca_ofertada"] = marca or None
            if it.get("marca_o_modelo_exigido"):
                descartes.append({"campo": "marca_o_modelo_exigido", "valor": it["marca_o_modelo_exigido"],
                                  "motivo": f"documento de contratación ({tipo}): es marca ofertada, no exigida",
                                  "item": it.get("descripcion_corta")})
            it["marca_o_modelo_exigido"] = None
            it["precio_unitario_referencial"] = None
        else:
            marca = it.get("marca_o_modelo_exigido")
            if marca:
                ok, pg = _marca_respaldada(marca, paginas)
                if ok:
                    it["marca_exigida_pagina"] = pg
                else:
                    it["marca_no_respaldada"] = marca
                    it["marca_o_modelo_exigido"] = None
                    descartes.append({"campo": "marca_o_modelo_exigido", "valor": marca,
                                      "motivo": "el texto del requerimiento no exige esa marca (sin 'marca'/'modelo'/'o equivalente' junto al nombre)",
                                      "item": it.get("descripcion_corta")})
            if it.get("marca_ofertada"):
                it["marca_ofertada"] = None
        # texto_literal_paginas: si TODAS las evidencias verificadas se corrigieron con el
        # mismo desfase (folio impreso vs índice real), desplazar también estas páginas.
        deltas = {e["pagina"] - e["pagina_declarada"] for e in (it.get("evidencia") or [])
                  if isinstance(e, dict) and e.get("verificada") and e.get("pagina_declarada") is not None}
        if len(deltas) == 1 and isinstance(it.get("texto_literal_paginas"), list):
            d = deltas.pop()
            if d:
                it["texto_literal_paginas_declaradas"] = list(it["texto_literal_paginas"])
                it["texto_literal_paginas"] = [int(x) + d for x in it["texto_literal_paginas"] if isinstance(x, (int, float))]
    for key in ("postores", "firmantes", "comite_evaluacion", "motivos_adjudicacion", "invitados"):
        for obj in (data.get(key) or []):
            _verificar_evidencia(obj, paginas_by_n, sha256, stats)
    for key in ("estudio_mercado", "contrato_final", "procedimiento_seleccion", "ejecucion_contractual", *_BLOQUES_VALIDOS):
        obj = data.get(key)
        if isinstance(obj, dict):
            _verificar_evidencia(obj, paginas_by_n, sha256, stats)
            # sub-listas con `pagina`: estampar sha (la página la puso el LLM; folio si se detecta)
            for lk, lv in obj.items():
                if isinstance(lv, list):
                    for el in lv:
                        if isinstance(el, dict):
                            el["documento_sha256"] = sha256
                            pg = el.get("pagina")
                            if isinstance(pg, int) and pg in paginas_by_n:
                                f = _detectar_folio(paginas_by_n[pg].get("texto") or "")
                                if f is not None:
                                    el["folio"] = f
    if descartes:
        data["_descartes_parser"] = descartes
    data["_evidencia_stats"] = stats
    return data
