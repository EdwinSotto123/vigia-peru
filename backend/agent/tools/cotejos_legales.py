"""Cotejos numéricos que el agente legal recibe ya calculados (nada de aritmética en el LLM).

Experiencia del postor: el tope de proporcionalidad se mide contra el VALOR ESTIMADO de la convocatoria (OCDS
tender.value / tender.items[].totalValue), no contra el monto adjudicado. Medido 2026-10-16 en el golden set:
el agente comparaba contra lo adjudicado y marcaba "experiencia desproporcionada" en 4 contratos donde la
exigencia era 1,9×, 2,0×, 2,5× y 3,0× del valor estimado (ninguno supera 3×).
"""
from __future__ import annotations

from typing import Any

TOPE_EXPERIENCIA = 3.0


def _monto(v: Any) -> float | None:
    if isinstance(v, dict):
        v = v.get("amount")
    try:
        f = float(v)
        return f if f > 0 else None
    except (TypeError, ValueError):
        return None


def cotejos_legales(state: dict) -> dict:
    ocds = state.get("ocds") if isinstance(state.get("ocds"), dict) else {}
    tender = ocds.get("tender") or {}
    total = _monto(tender.get("value"))
    items_ocds = [i for i in (tender.get("items") or []) if isinstance(i, dict)]
    da = state.get("document_analysis") if isinstance(state.get("document_analysis"), dict) else {}

    experiencia = []
    for idx, it in enumerate(da.get("items_consolidados") or []):
        if not isinstance(it, dict):
            continue
        exigida = _monto((it.get("requisitos_postor") or {}).get("experiencia_minima_soles"))
        if exigida is None:
            continue
        # Valor estimado del ítem: el del OCDS en la misma posición si hay varios; si no, el total del proceso.
        base, fuente = None, None
        if len(items_ocds) > 1 and idx < len(items_ocds):
            base, fuente = _monto(items_ocds[idx].get("totalValue")), "valor estimado del ítem (OCDS)"
        if base is None and total is not None:
            base, fuente = total, "valor estimado de la convocatoria (OCDS)"
        veces = round(exigida / base, 2) if base else None
        experiencia.append({
            "item": it.get("numero") or idx + 1,
            "experiencia_minima_soles": exigida,
            "valor_estimado": base,
            "fuente_valor": fuente,
            "veces_valor_estimado": veces,
            "supera_tope": (veces is not None and veces > TOPE_EXPERIENCIA),
            "tope": TOPE_EXPERIENCIA,
        })
    return {
        "procedimiento": {"id": tender.get("id"), "titulo": tender.get("title"), "metodo": tender.get("procurementMethodDetails")},
        "valor_estimado_total": total,
        "experiencia": experiencia,
        "nota": ("La experiencia solo es desproporcionada si supera_tope=true (más de 3 veces el valor ESTIMADO). "
                 "Nunca la compares contra el monto adjudicado u ofertado."),
    }


# ── Depuración de las banderas del analista legal (prueba de oro de las 4 redes, 2026-11-04) ──
import json as _json
import re as _re

# Lo que ya emiten las reglas de código: repetirlo como bandera documental duplica el puntaje (5 falsas alarmas).
_RE_DUPLICA_REGLA = _re.compile(
    r"[uú]nic[oa]\s+(postor|oferta|ofertante|oferente)|oferta\s+[uú]nica|postor\s+[uú]nico|sin\s+competencia\s+efectiva|"
    r"igual\s+al?\s+(100\s*%\s+del\s+)?valor\s+(referencial|estimado)|100\s*%\s+del\s+valor", _re.I)
# Un puntaje sobre 100 por las bonificaciones de ley (MYPE 5 %, colindancia o provincia 10 %) es lo normal (3).
_RE_BONIFICACION = _re.compile(r"bonificaci[oó]n|(puntaje|puntos).{0,80}(super|por\s+encima|exce|mayor).{0,30}\b100\b", _re.I)
# «dejó fuera 6 de 10 ofertas»: si quedaron 3 o más, el requisito no direccionó (regla 11 del prompt del analista).
_RE_DEJO_FUERA = _re.compile(r"dej[oó]\s+fuera\s+(?:a\s+)?(\d+)\s+de\s+(?:las\s+|los\s+)?(\d+)", _re.I)
# Un requisito, certificado o experiencia exigida (para contar la competencia efectiva en el acta).
_RE_REQUISITO = _re.compile(r"requisit|certificad|exig", _re.I)
# Una descalificación o una contradicción entre actas no es «un requisito que direccionó»: esas no se tocan aquí.
_RE_NO_REQUISITO = _re.compile(r"descalific|incongru|contradic|anul|no\s+admit", _re.I)
# Lo que el contrato «no fija» (garantía, penalidad) cuando la cláusula remite a la ley: la ley lo exige igual.
_RE_OMISION = _re.compile(r"no\s+(fija|establece|precisa|define|consigna|indica|determina)|omite|sin\s+(definir|fijar|precisar)", _re.I)
_RE_GARANTIA = _re.compile(r"garant[ií]a|penalidad", _re.I)
_RE_REMITE_LEY = _re.compile(r"(remite|de\s+corresponder|conforme\s+a|seg[uú]n|de\s+acuerdo\s+(con|a)).{0,80}(ley|reglamento|lgcp|lcp)", _re.I)
# «6 de 10 ofertas fueron no admitidas»: la misma cuenta dicha al revés que «dejó fuera».
_RE_N_DE_M_FUERA = _re.compile(r"(\d+)\s+de\s+(?:las\s+|los\s+)?(\d+)\s+(?:ofertas|postores|propuestas)\s+(?:fueron\s+|quedaron\s+|resultaron\s+)?"
                               r"(?:no\s+admitid|descalificad|excluid|fuera|rechazad)", _re.I)
# «Sin comité de selección identificado»: con la Ley 32069 el oficial de compra o los evaluadores conducen varios
# procedimientos, y el expediente que se lee no siempre trae la designación (falsa alarma en la prueba de oro).
_RE_COMITE = _re.compile(r"comit[eé]\s+de\s+selecci[oó]n|\bcomit[eé]\b", _re.I)
_RE_AUSENTE = _re.compile(r"(sin|ausencia\s+de(l)?)\s+(un\s+)?comit|no\s+se\s+(identific|design|acredit|encontr)\w*\s+(el\s+|un\s+|ning[uú]n\s+|al\s+)?(comit|evaluador)|comit[eé]\s+de\s+selecci[oó]n\s+(no\s+)?(identificad|designad)", _re.I)
# La vigencia de una carta fianza o garantía (vence antes de la conformidad): se renueva en la ejecución.
_RE_FIANZA = _re.compile(r"carta\s+fianza|garant[ií]a\s+de\s+fiel", _re.I)
_RE_VIGENCIA = _re.compile(r"\bvence|vencimiento|vigencia|renov", _re.I)
# Una bandera que afirma que sólo uno o dos podían cumplir (ésa sí puede ser direccionamiento aunque hubiera otros).
_RE_UNICO = _re.compile(r"[uú]nico\s+proveedor|s[oó]lo\s+(un|uno|dos)\b|exclusiv|marca", _re.I)
# Lo que converge en una marca o un modelo aunque varios distribuidores lo vendan (prueba de oro: 1226255 tela por
# marca y código de artículo sin «o equivalente», 1228062 la ficha de un dron con valores exactos; ambas con 2 y 3
# calificados y SÍ son requisito dirigido).
_RE_CONVERGE = _re.compile(
    r"[uú]nico\s+proveedor|s[oó]lo\s+(un|uno|dos)\b|exclusiv|marca|\bmodelo\b|fabricante|c[oó]digo\s+de\s+art[ií]culo|"
    r"o\s+equivalente|valores\s+exactos|patentad|distribuidor\s+(autorizado|exclusivo)", _re.I)
# «marca/modelo» como categoría y no como una marca dada: «ficha técnica del modelo/marca» (1223907), «sin especificar
# marca/modelo» (1226350). Se quita antes de buscar convergencia; «un único modelo», «marca NICOLL» siguen contando.
_RE_MARCA_GENERICA = _re.compile(
    r"(sin\s+(especificar|indicar|precisar|mencionar|consignar|exigir)\s+(una\s+|la\s+|el\s+)?)?"
    r"\b(marca|modelo)\s*(/|,|\by\b|\bo\b|\bni\b)\s*(la\s+|el\s+)?(marca|modelo)\b|"
    r"sin\s+(especificar|indicar|precisar|mencionar|consignar|exigir)\s+(una\s+|la\s+|el\s+)?(marca|modelo)\b", _re.I)


def _converge(texto: str) -> bool:
    """¿El hallazgo dice que el requisito converge en un proveedor, una marca o un modelo?"""
    return bool(_RE_CONVERGE.search(_RE_MARCA_GENERICA.sub(" ", texto or "")))


# Requisito de cercanía (grifo, almacén o taller a N km de la sede): reduce el universo, pero en una ciudad no apunta por
# sí solo a un proveedor (1225299, golden: «en Lima no apunta por sí sola a un único proveedor»).
_RE_CERCANIA = _re.compile(
    r"a\s+(no\s+)?m[aá]s\s+de\s+\d+([.,]\d+)?\s*(km|kil[oó]metros?)|radio\s+(m[aá]ximo\s+)?de\s+\d+|"
    r"restricci[oó]n\s+geogr[aá]fica|cercan[ií]a\s+(a|al|de)\s+(la\s+)?(sede|local|entidad)", _re.I)
# Lo que habla de un requisito, una especificación o un criterio de evaluación (el objeto de la bandera documental).
_RE_SOBRE_REQUISITO = _re.compile(
    r"requisit|especificaci|certificad|exig|criterio|muestra|ficha|marca|modelo|experiencia|t[eé]rminos\s+de\s+referencia|"
    r"\btdr\b|plazo\s+de\s+entrega|factor(es)?\s+de\s+evaluaci|homolog|penalidad|garant[ií]a|admit|calific", _re.I)
# Lo que pasó en una convocatoria anterior (desierta, nulidad): no es un hecho de este proceso (regla 10 del prompt).
_RE_CONV_ANTERIOR = _re.compile(r"(primera|anterior|previa)\s+convocatoria|convocatoria\s+(anterior|previa|desierta)|declarad[ao]\s+desiert", _re.I)


def _competencia_efectiva(state: dict) -> int:
    """Cuántos postores quedaron calificados (o ganaron) según el acta leída (lecturas_legal.acta), 0 si no se sabe."""
    acta = ((state.get("lecturas_legal") or {}) if isinstance(state.get("lecturas_legal"), dict) else {}).get("acta") or {}
    postores = acta.get("postores") if isinstance(acta, dict) else None
    if not isinstance(postores, list):
        return 0
    return sum(1 for p in postores if isinstance(p, dict) and (p.get("calificada") is True or p.get("ganador") is True))


# Errores materiales: fechas, cronograma o transcripción que no cambian quién compite (regla 7 del prompt; 6).
_RE_ERROR_MATERIAL = _re.compile(r"^\W*incoherencia|error\s+(de\s+)?transcripci|error\s+material|podr[ií]a\s+ser\s+un\s+error", _re.I)


def depurar_banderas_legales(state: dict) -> list[dict]:
    """Quita de `legal_analysis.red_flags_documentales` lo que no es una bandera documental: la repetición de una regla
    de código (único postor, oferta igual al referencial, con vector «procedimiento»), los puntajes sobre 100 por
    bonificaciones de ley y los errores materiales de fechas o de transcripción. Devuelve lo quitado (queda en
    `legal_analysis.descartes_depuracion`). En la prueba de oro eran 14 de las 18 falsas alarmas del analista legal."""
    la = state.get("legal_analysis")
    era_str = isinstance(la, str)
    if era_str:
        try:
            la = _json.loads(la)
        except ValueError:
            return []
    if not isinstance(la, dict):
        return []
    quedan, fuera, contexto = [], [], []
    calificados = _competencia_efectiva(state)
    for rf in la.get("red_flags_documentales") or []:
        if not isinstance(rf, dict):
            quedan.append(rf)
            continue
        texto = " ".join(str(rf.get(k) or "") for k in ("descripcion", "hallazgo", "titulo"))
        vector = str(rf.get("vector") or "").lower()
        motivo = None
        motivo_contexto = None
        if vector == "procedimiento" and _RE_DUPLICA_REGLA.search(texto):
            motivo = "repite una regla de código (único postor / oferta igual al referencial)"
        elif _RE_BONIFICACION.search(texto):
            motivo = "puntaje sobre 100 por bonificaciones de ley"
        elif vector in ("otro", "procedimiento", "") and _RE_ERROR_MATERIAL.search(texto.strip()):
            motivo = "error material sin efecto en la competencia"
        elif (m := _RE_DEJO_FUERA.search(texto)) and int(m.group(2)) - int(m.group(1)) >= 3 and not _RE_UNICO.search(texto):
            motivo = f"requisito con competencia efectiva: quedaron {int(m.group(2)) - int(m.group(1))} ofertas"
        elif ((m2 := _RE_N_DE_M_FUERA.search(texto)) and int(m2.group(2)) - int(m2.group(1)) >= 3 and not _RE_UNICO.search(texto)
              and _RE_REQUISITO.search(texto)):
            motivo = f"requisito con competencia efectiva: quedaron {int(m2.group(2)) - int(m2.group(1))} ofertas"
        elif (vector == "comite" or _RE_COMITE.search(texto)) and _RE_AUSENTE.search(texto):
            motivo = "comité no identificado en el expediente leído (con la Ley 32069 puede conducir el oficial de compra)"
        elif _RE_FIANZA.search(texto) and _RE_VIGENCIA.search(texto):
            motivo = "vigencia de la garantía: se renueva durante la ejecución, no es una bandera de la contratación"
        elif (_RE_REQUISITO.search(texto) and calificados >= 3 and not _RE_UNICO.search(texto) and not _RE_NO_REQUISITO.search(texto)
              and vector in ("requisito_a_la_medida", "direccionamiento", "requisito", "otro", "")):
            motivo = f"requisito con competencia efectiva: el acta tiene {calificados} postores calificados"
        elif _RE_OMISION.search(texto) and _RE_GARANTIA.search(texto) and _RE_REMITE_LEY.search(texto):
            motivo = "omisión del contrato que cubre la ley (la cláusula remite a la norma)"
        elif _RE_CONV_ANTERIOR.search(texto) and _RE_DUPLICA_REGLA.search(texto) and not _converge(texto):
            # 1225299: «el mismo postor fue único oferente de la primera convocatoria, declarada desierta, y vuelve a ser
            # el único»: repite las reglas de único postor con hechos de otra convocatoria.
            motivo_contexto = "repite el único postor (reglas de código) con hechos de una convocatoria anterior"
        elif calificados >= 2 and not _converge(texto):
            # Con dos o más ofertas calificadas de distinto postor no hay evidencia de que el expediente converja en un
            # solo proveedor (prueba de oro 2026-11-10: 1226350, 1226611, 1228943, 1242917, 1223907). El hallazgo
            # puede ser cierto (un empate mal resuelto, actas que no cuadran): se publica, pero sin puntaje.
            motivo_contexto = f"competencia efectiva: el acta tiene {calificados} postores calificados y nada converge en una marca o modelo"
        elif vector in ("otro", "requisito", "requisito_a_la_medida", "") and _RE_CERCANIA.search(texto) and not _converge(texto):
            motivo_contexto = "requisito de cercanía: reduce el universo de postores, pero nada indica que apunte a uno solo"
        elif vector in ("procedimiento", "comite", "otro", "") and not _RE_SOBRE_REQUISITO.search(texto) and not _converge(texto):
            # Una irregularidad del trámite (negociación, desierta, justificación del procedimiento) que no toca ningún
            # requisito ni especificación: no es un requisito dirigido (1225299: el mismo postor de la convocatoria desierta).
            motivo_contexto = "irregularidad del trámite que no toca un requisito ni una especificación"
        if motivo:
            fuera.append({"vector": vector, "descripcion": texto[:200], "motivo": motivo})
        elif motivo_contexto:
            contexto.append({**rf, "motivo_contexto": motivo_contexto})
        else:
            quedan.append(rf)
    if fuera or contexto:
        la["red_flags_documentales"] = quedan
        if fuera:
            la["descartes_depuracion"] = fuera
        if contexto:
            # Se publican como «hecho de contexto» (bandera con puntua=false: se ve en la ficha y no suma al puntaje).
            la["hallazgos_contexto"] = contexto
        state["legal_analysis"] = _json.dumps(la, ensure_ascii=False) if era_str else la
    return fuera + [{"vector": c.get("vector"), "descripcion": str(c.get("descripcion"))[:200],
                     "motivo": "contexto: " + c["motivo_contexto"]} for c in contexto]
