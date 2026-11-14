"""Segunda mirada a cada sobreprecio ANTES de que sea bandera y de que se escriba el dictamen.

Un veredicto «elevado» sólo vale si lo que se comparó es el mismo bien, en la misma unidad, con suficientes precios.
Hasta el 2026-11-14 esa revisión la hacía un juez DESPUÉS de escrito el dictamen (que publicaba el veredicto viejo) y
sin ver los precios observados: sólo el nombre del ítem, la mediana y el porcentaje. Aquí:

  1. Guardas en código, sin modelo: pocas observaciones, precios muy dispersos, una sola tienda, o una diferencia
     tan grande que casi siempre es otra unidad u otro producto.
  2. Un modelo (el capaz, no el rápido) mira cada sobreprecio con sus especificaciones y los productos con que se
     comparó, y dice si son comparables. Si no lo son, o si no pudo decidir en un caso extremo, el veredicto pasa a
     `no_verificable` con su motivo: no hay bandera y el dictamen lo cuenta así.

Lo que se degrada queda en `market_analysis.verificacion_precio` y en `descartes`. Nunca levanta.
"""
from __future__ import annotations

import json
import os
import re
import statistics

_ELEVADOS = ("elevado", "muy_elevado")
_MIN_OBS = int(os.getenv("PRECIO_MIN_OBSERVACIONES", "3"))
_MAX_DISPERSION = float(os.getenv("PRECIO_MAX_DISPERSION", "4"))        # precio más alto / más bajo de los observados
_PCT_EXTREMO = float(os.getenv("PRECIO_PCT_EXTREMO", "300"))            # sobre esto, sólo vale con un «sí» explícito
_MAX_ITEMS = int(os.getenv("PRECIO_VERIFICAR_MAX", "12"))


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _precios(f: dict) -> list[float]:
    return [p for p in (_num(o.get("precio") if o.get("precio") is not None else o.get("valor"))
                        for o in f.get("precios_observados") or [] if isinstance(o, dict)) if p and p > 0]


_ORIGEN_OFICIAL = {
    "osinergmin": "precio oficial de grifos y estaciones de servicio (Osinergmin): combustible de uso vehicular al público",
    "conosce": "otras compras del Estado registradas en el SEACE con una descripción parecida",
    "perucompras": "precio de catálogo de Perú Compras",
    "precio_referencia": "precio de referencia de otras compras del Estado para el mismo código de bien",
}


def _es_oficial(o: dict) -> bool:
    return str(o.get("origen") or "").lower() in _ORIGEN_OFICIAL or str(o.get("dominio") or "").lower().endswith(".gob.pe")


_RE_AGREGADOR = re.compile(r"\b(v[ií]veres|insumos|productos|alimentos|frutas|verduras|pescados|carnes|abarrotes|reactivos|"
                           r"indumentaria|uniformes|materiales|repuestos|accesorios|medicamentos|[uú]tiles|diversos|varios|"
                           r"kit\s+de|paquete\s+de|lote\s+de|canasta)\b", re.I)
_RE_DECLARACIONES = re.compile(r"de\s+(\d+)\s+declaraciones", re.I)
_RE_OTRO_COMBUSTIBLE = re.compile(r"\bf-?\s?76\b|marino|naval|turbo|\bjet\b|b[uú]nker|residual|\bifo\b|aviaci[oó]n", re.I)
_UNIDAD_SUELTA = re.compile(r"^\s*(unidad|und\.?|servicio|global|glb\.?|paquete|juego|kit|lote)\s*$", re.I)


def _sin_repetir(obs: list[dict]) -> list[dict]:
    """Tres veces el mismo producto de la misma tienda al mismo precio es UNA observación."""
    vistos, out = set(), []
    for o in obs:
        k = (str(o.get("dominio") or o.get("proveedor") or "").lower(),
             " ".join(str(o.get("producto") or o.get("titulo_fuente") or "").lower().split())[:80], _num(o.get("precio")))
        if k not in vistos:
            vistos.add(k)
            out.append(o)
    return out


def _pactado(f: dict):
    return _num(f.get("precio_unitario_ofertado")) or _num(f.get("precio_unitario_referencial"))


def guardas(f: dict, ma: dict | None = None) -> str | None:
    """El motivo por el que un sobreprecio NO se sostiene con sus propios números, o None si pasa.

    Cada guarda sale de leer los 175 veredictos «elevado» y «muy elevado» emitidos en producción del 10 al 14 de
    noviembre de 2026: fuera de los combustibles, sólo 13 de 117 eran una comparación correcta."""
    pactado = _pactado(f)
    pct = _num(f.get("diff_pct")) or 0
    desc = str(f.get("item_descripcion") or "")
    # 1. El precio pactado está mal tomado: el total del contrato o el monto de otro ítem como precio unitario (11 casos;
    #    todos superaban 2 veces su propio valor referencial).
    ofertado, referencial = _num(f.get("precio_unitario_ofertado")), _num(f.get("precio_unitario_referencial"))
    if ofertado and referencial and ofertado > 2 * referencial:
        return (f"el precio pactado (S/ {ofertado:,.2f}) es más del doble de su propio valor referencial "
                f"(S/ {referencial:,.2f}): está mal tomado del documento")
    # El total con que se coteja es el mayor que haya (el del contrato o la cuantía): `total_ofertado` a veces suma sólo
    # los ítems analizados, y con 1,1 veces caía un sobreprecio cierto (1232055, tubo endotraqueal).
    cantidad = _num(f.get("cantidad"))
    total = max(_num((ma or {}).get("total_ofertado")) or 0, _num((ma or {}).get("cuantia_referencial_total")) or 0)
    if ofertado and cantidad and total and ofertado * cantidad > 1.5 * total:
        return "el precio pactado por la cantidad supera con mucho el total del contrato: no es un precio unitario"
    # 2. Más de +300 %: ninguno de los 16 que hubo era cierto (otra unidad, otro producto, el lote como una unidad).
    if pct > _PCT_EXTREMO:
        return f"una diferencia de {pct:,.0f} % casi siempre es otra unidad, otro producto o un lote tomado como una unidad"
    # 3. Un lote de varios bienes comparado con el precio de UNA unidad (21 casos: víveres, uniformes, insumos).
    mediana = _num(f.get("precio_mediana_comparacion")) or _num(f.get("precio_mediana_mercado"))
    if pactado and pactado >= 5000 and (cantidad or 0) <= 100 and (_RE_AGREGADOR.search(desc) or (
            _UNIDAD_SUELTA.match(str(f.get("unidad") or "")) and mediana and pactado > 5 * mediana)):
        return "el ítem es un conjunto de varios bienes (un lote): no se compara con el precio de una unidad"

    if f.get("diff_fuente") == "cotizaciones_expediente":
        return None   # las cotizaciones del propio expediente tienen sus guardas (tools/market/cotizaciones.py)

    if f.get("diff_fuente") == "ancla_regional":
        # Otras compras del Estado: 28 de 33 eran falsas, 16 por ser otro bien del mismo código de catálogo.
        refs = [r for r in f.get("referencias_internas") or [] if isinstance(r, dict) and _num(r.get("precio_unitario"))]
        mismas = [r for r in refs if (_num(r.get("solape_raices")) or 0) >= 0.5]
        if len(mismas) < 3:
            return (f"sólo {len(mismas)} compra(s) del Estado describen el mismo bien: hacen falta al menos 3 "
                    f"(las demás comparten el código de catálogo, no el producto)")
        if len({str(r.get("ocid")) for r in mismas}) < 2:
            return "todas las compras de comparación son de un solo proceso"
        ps = [_num(r.get("precio_unitario")) for r in mismas]
        if min(ps) > 0 and max(ps) / min(ps) > _MAX_DISPERSION:
            return (f"las otras compras del Estado van de S/ {min(ps):,.2f} a S/ {max(ps):,.2f}: son bienes distintos "
                    f"y su mediana no dice nada")
        if pactado and pactado <= max(ps):
            return f"el precio pactado (S/ {pactado:,.2f}) está dentro de lo que pagaron otras entidades (hasta S/ {max(ps):,.2f})"
        if 15 <= pct <= 22:
            return "una diferencia de 15 a 22 % contra otras compras puede ser sólo el IGV (unas lo incluyen y otras no)"
        return None

    obs = _sin_repetir([o for o in f.get("precios_observados") or [] if isinstance(o, dict)])
    precios = [p for p in (_num(o.get("precio") if o.get("precio") is not None else o.get("valor")) for o in obs) if p and p > 0]
    # Una fuente oficial (los precios de grifos de Osinergmin, otras compras del Estado, Perú Compras) ya resume muchas
    # declaraciones: no se le pide «varias tiendas». Una tienda sola, sí.
    oficial = bool(obs) and all(_es_oficial(o) for o in obs)
    if any(str(o.get("origen") or "").lower() == "osinergmin" for o in obs):
        # Combustible: 58 elevados contra una referencia mal acotada (otro combustible, pocas declaraciones, ámbito
        # nacional). Vale con 10 declaraciones o más y si el precio supera en 15 % al percentil 75.
        if _RE_OTRO_COMBUSTIBLE.search(desc):
            return "es un combustible naval, de aviación o industrial: el precio de los grifos no lo mide"
        n_decl = max((int(m.group(1)) for o in obs for m in [_RE_DECLARACIONES.search(str(o.get("producto") or ""))] if m), default=0)
        if n_decl < 10:
            return f"la referencia oficial tiene sólo {n_decl} declaraciones de precio: hacen falta al menos 10"
        if pactado and precios and pactado <= 1.15 * max(precios):
            return (f"el precio pactado (S/ {pactado:,.2f}) no supera en 15 % al percentil 75 de los grifos "
                    f"(S/ {max(precios):,.2f}): está dentro de lo que se cobra")
        return None
    if len(precios) < (2 if oficial else _MIN_OBS):
        return f"sólo {len(precios)} precio(s) distintos de comparación: hacen falta al menos {_MIN_OBS}"
    tiendas = {str(o.get("dominio") or o.get("proveedor") or "").lower() for o in obs} - {""}
    if not oficial and len(tiendas) < 2:
        return "todos los precios de comparación son de una sola tienda"
    if min(precios) > 0 and max(precios) / min(precios) > _MAX_DISPERSION:
        return (f"los precios de comparación van de S/ {min(precios):,.2f} a S/ {max(precios):,.2f}: son productos "
                f"distintos y su mediana no dice nada")
    # La mediana contra el propio rango: si el precio pactado cae dentro de lo observado, no es sobreprecio.
    if pactado and pactado <= max(precios):
        return (f"el precio pactado (S/ {pactado:,.2f}) está dentro del rango de los precios observados "
                f"(hasta S/ {max(precios):,.2f})")
    if oficial and 15 <= pct <= 22:
        return "una diferencia de 15 a 22 % contra otras compras puede ser sólo el IGV (unas lo incluyen y otras no)"
    return None


def _unidad_confirmada(f: dict) -> bool:
    """¿Algún precio observado tiene la unidad comprobada (no «asumida la misma»)?"""
    return any(isinstance(o, dict) and str((o.get("normalizacion") or {}).get("regla") or "") not in ("", "asumida_misma_unidad")
               for o in f.get("precios_observados") or [])


def _especificacion(state: dict, numero) -> str:
    for it in ((state.get("market_input") or {}).get("items") or []):
        if isinstance(it, dict) and str(it.get("numero")) == str(numero):
            partes = [str(it.get(k) or "") for k in ("requerimiento_tecnico_detallado", "marca_o_modelo_exigido")]
            cert = it.get("certificaciones_exigidas") or []
            if cert:
                partes.append("certificaciones: " + ", ".join(str(c) for c in cert[:5]))
            return " | ".join(p for p in partes if p.strip())[:900]
    return ""


def _preguntar(items: list[dict]) -> list[dict]:
    """Un veredicto por ítem: {label: comparable | no_comparable | None, reason}."""
    from tools import self_eval
    prompt = (
        "Eres un perito en compras públicas del Perú. Para CADA ítem recibes lo que el Estado compró (descripción, "
        "especificaciones, unidad, cantidad y precio unitario pactado) y los precios con que se comparó: de tiendas o de "
        "una fuente oficial (`que_es_esta_fuente` dice cuál; en ese caso el nombre del producto observado puede repetir "
        "el del ítem, y lo que importa es si esa fuente mide el mismo bien). Decide si la comparación sirve para afirmar un SOBREPRECIO. Es 'comparable' sólo si los productos "
        "observados son el MISMO bien (misma función, misma gama y calidad, mismas especificaciones clave) y en la "
        "MISMA unidad de venta (unidad contra unidad; no kilo contra bolsa, ni unidad contra caja o paquete, ni metro "
        "contra rollo). Es 'no_comparable' si: son de otra gama o calidad (doméstico contra profesional, hospitalario, "
        "industrial o militar; genérico contra uno con certificación o marca exigida); la unidad o la presentación es "
        "otra; el ítem del Estado incluye algo que la tienda no (instalación, transporte a zona alejada, garantía "
        "extendida, bordado, confección a medida, kit o conjunto de piezas); o los productos observados son distintos "
        "entre sí. OJO con la unidad: si el ítem se compra por kilo, litro o metro y lo observado son envases (lata de "
        "410 g, bolsa de 500 g, rollo), el precio observado tiene que estar ya convertido a esa medida: calcula tú el "
        "precio del envase entre su contenido y, si no cuadra con el precio observado que recibes, es 'no_comparable'. "
        "Lo mismo con la concentración o la medida de un medicamento o repuesto (1 mg no es 0,5 mg; calibre 0 no es "
        "2/0; estéril no es no estéril). Ante la duda, 'no_comparable': afirmar un sobreprecio falso es peor que "
        "callar uno cierto.\n"
        "Devuelve `veredictos`: lista alineada por índice con {label: 'comparable'|'no_comparable', reason: una frase "
        "con el dato concreto}.\n\n"
        f"ÍTEMS:\n{json.dumps(items, ensure_ascii=False, default=str)}"
    )
    return self_eval._judge_array_reason(prompt, len(items), ["comparable", "no_comparable"], etapa="verificador_precio")


def verificar_sobreprecios(state: dict) -> dict:
    """Revisa los hallazgos `elevado` / `muy_elevado` de `state['market_analysis']` y degrada los que no se sostienen."""
    res: dict = {"revisados": 0, "confirmados": 0, "degradados": [], "sin_juez": 0}
    try:
        ma = state.get("market_analysis")
        if isinstance(ma, str):
            ma = json.loads(ma)
        if not isinstance(ma, dict):
            return res
        fs = [f for f in ma.get("findings") or [] if isinstance(f, dict) and f.get("veredicto") in _ELEVADOS]
        if not fs:
            return res
        res["revisados"] = len(fs)

        def _degradar(f: dict, motivo: str, quien: str) -> None:
            f["veredicto_original"] = f.get("veredicto")
            f["veredicto"] = "no_verificable"
            f["motivo_no_verificable"] = f"{quien}: {motivo}"[:300]
            res["degradados"].append({"item": f.get("item_descripcion"), "numero": f.get("item_numero"),
                                      "era": f["veredicto_original"], "diff_pct": f.get("diff_pct"), "motivo": motivo[:200]})

        pendientes = []
        for f in fs:
            motivo = guardas(f, ma)
            if motivo:
                _degradar(f, motivo, "verificación del precio")
            else:
                pendientes.append(f)

        a_juzgar = [f for f in pendientes if f.get("precios_observados") or f.get("referencias_internas")][:_MAX_ITEMS]
        if a_juzgar:
            items = [{
                "i": i, "item": f.get("item_descripcion"), "especificaciones": _especificacion(state, f.get("item_numero")),
                "unidad": f.get("unidad"), "cantidad": f.get("cantidad"),
                "precio_unitario_pactado": _num(f.get("precio_unitario_ofertado")) or _num(f.get("precio_unitario_referencial")),
                "mediana_observada": (f.get("precio_mediana_comparacion") if f.get("diff_fuente") == "ancla_regional"
                                      else f.get("precio_mediana_mercado")),
                "diferencia_pct": f.get("diff_pct"),
                "productos_observados": (
                    # Contra otras compras del Estado: lo que cada entidad compró, con su precio adjudicado.
                    [{"producto": str(r.get("descripcion") or "")[:140], "precio": r.get("precio_unitario"),
                      "unidad": r.get("unidad"), "fuente": str(r.get("entidad") or "")[:60],
                      "que_es_esta_fuente": _ORIGEN_OFICIAL["conosce"]}
                     for r in (f.get("referencias_internas") or [])[:8] if isinstance(r, dict)]
                    if f.get("diff_fuente") == "ancla_regional" else
                    [{"producto": str(o.get("producto") or o.get("titulo_fuente") or "")[:140],
                      "precio": o.get("precio"), "unidad": o.get("unidad"),
                      "fuente": o.get("dominio") or o.get("proveedor"),
                      **({"que_es_esta_fuente": _ORIGEN_OFICIAL[str(o.get("origen")).lower()]}
                         if str(o.get("origen") or "").lower() in _ORIGEN_OFICIAL else {})}
                     for o in _sin_repetir([o for o in f.get("precios_observados") or [] if isinstance(o, dict)])[:8]]),
            } for i, f in enumerate(a_juzgar)]
            try:
                verds = _preguntar(items)
            except Exception as e:  # noqa: BLE001
                verds = [{"label": None, "reason": f"no evaluado: {str(e)[:80]}"}] * len(a_juzgar)
            for f, v in zip(a_juzgar, verds):
                pct = _num(f.get("diff_pct")) or 0
                if v.get("label") == "no_comparable":
                    _degradar(f, v.get("reason") or "la comparación no es del mismo bien", "revisión del precio")
                elif v.get("label") is None:
                    res["sin_juez"] += 1
                    # Sin confirmación no se afirma lo dudoso: una diferencia grande o precios sin la unidad comprobada.
                    if pct >= 100 or not (_unidad_confirmada(f) or f.get("diff_fuente") == "ancla_regional"):
                        _degradar(f, f"diferencia de {pct:.0f} % sin poder confirmar que sea el mismo bien y unidad",
                                  "verificación del precio")
                else:
                    f["verificacion_precio"] = {"comparable": True, "motivo": (v.get("reason") or "")[:240]}
                    # Sin ninguna unidad comprobada, lo más que se afirma es «elevado».
                    if f.get("veredicto") == "muy_elevado" and f.get("diff_fuente") != "ancla_regional" and not _unidad_confirmada(f):
                        f["veredicto_original"], f["veredicto"] = "muy_elevado", "elevado"
        res["confirmados"] = sum(1 for f in fs if f.get("veredicto") in _ELEVADOS)

        if res["degradados"]:
            # El lote: si incluía un ítem degradado, su total suma una mediana que no vale.
            if ma.get("sobreprecio_pct") is not None:
                ma["sobreprecio_pct_original"] = ma.get("sobreprecio_pct")
                ma["sobreprecio_pct"] = None
                ma["veredicto_global_original"] = ma.get("veredicto_global")
                ma["veredicto_global"] = "no_verificable"
                ma["motivo_no_verificable"] = "lote: incluye ítem(s) cuya comparación de precio no se sostiene"
            elif str(ma.get("veredicto_global") or "") in _ELEVADOS and res["confirmados"] == 0:
                ma["veredicto_global_original"] = ma.get("veredicto_global")
                ma["veredicto_global"] = "no_verificable"
            try:
                from pipeline_state import _registrar_descarte
                for d in res["degradados"]:
                    _registrar_descarte(state, "market.verificador_precio", "sobreprecio_no_sostenido",
                                        f"{d['item']}: {d['motivo']}")
            except Exception:  # noqa: BLE001
                pass
        ma["verificacion_precio"] = {k: (len(v) if k == "degradados" else v) for k, v in res.items()}
        ma["verificacion_precio"]["detalle"] = res["degradados"][:12]
        state["market_analysis"] = ma
    except Exception as e:  # noqa: BLE001
        res["error"] = f"{type(e).__name__}: {str(e)[:160]}"
    return res


def dispersion(precios: list[float]) -> float | None:
    """Coeficiente de variación de los precios observados (para pruebas y diagnósticos)."""
    if len(precios) < 2 or statistics.mean(precios) == 0:
        return None
    return statistics.pstdev(precios) / statistics.mean(precios)
