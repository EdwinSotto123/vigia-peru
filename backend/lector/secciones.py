"""Las SECCIONES de unas bases, y lo que se puede sacar de ellas sin modelo.

Las bases estándar (Ley 32069 y la anterior, Ley 30225) tienen la misma armazón en todos los procedimientos:

  SECCIÓN GENERAL      texto fijo que la entidad no puede tocar. Trae montos que NO son de este proceso: topes legales
                       («cuando la cuantía adjudicada sea igual o menor a S/ 480 000,00…»). No se lee ningún dato de aquí.
  SECCIÓN ESPECÍFICA   lo que la entidad llenó:
    Capítulo I    generalidades: entidad, objeto, CUANTÍA de la contratación (o «valor referencial»), fuente, plazo
    Capítulo II   el procedimiento: cronograma, contenido de las ofertas, requisitos para perfeccionar el contrato
    Capítulo III  el requerimiento (especificaciones, términos de referencia o expediente) y, dentro, los REQUISITOS DE
                  CALIFICACIÓN: capacidad legal, experiencia del postor en la especialidad, capacidad técnica y profesional
    Capítulo IV   los FACTORES DE EVALUACIÓN (precio, experiencia ADICIONAL, mejoras…)
    …             la PROFORMA DEL CONTRATO (penalidades, adelantos, garantías) y los ANEXOS

Por qué importa: el 2026-11-16 un monto de «experiencia adicional del postor» (un factor de evaluación del Capítulo IV)
se publicó como la cuantía del proceso. Cada dato se busca sólo en su sección: la cuantía en el Capítulo I, la
experiencia exigida en los requisitos de calificación, la experiencia adicional en los factores.

Además, con la Ley 32069 la entidad puede RESERVAR la cuantía («ha determinado no dar a conocer la cuantía de la
contratación», numeral 53.4 del Reglamento): en esas bases el monto no existe, y eso también es un dato.
"""
from __future__ import annotations

import re

_TILDES = str.maketrans("ÁÉÍÓÚÜáéíóúü", "AEIOUUaeiouu")
_ROMANOS = {"I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6, "VII": 7, "VIII": 8}
_CAPITULOS = {1: "generalidades", 2: "procedimiento", 3: "requerimiento", 4: "evaluacion"}
_MONEDAS = {"S/": "PEN", "S/.": "PEN", "US$": "USD", "$": "USD", "USD": "USD", "€": "EUR"}
_MONTO = r"(S/\.?|US\$|USD|\$|€)\s*([0-9][0-9.,' ]*[0-9])"


def _mayus(s: str) -> str:
    """En mayúsculas y sin tildes, con el MISMO largo que el original: las posiciones sirven para cortar la cita."""
    return (s or "").translate(_TILDES).upper()


def _plano(s: str) -> str:
    return " ".join(_mayus(s).split())


def numero(s: str) -> float | None:
    """Un monto como lo escriben las bases: «198,410.00», «5 000 000,00», «480 000.00», «1'250,000.50»."""
    s = re.sub(r"[\s']", "", s or "").strip(".,")
    if not re.fullmatch(r"[0-9][0-9.,]*", s):
        return None
    coma, punto = s.rfind(","), s.rfind(".")
    if coma >= 0 and punto >= 0:
        decimal = max(coma, punto)                      # el último separador es el decimal
        entero = re.sub(r"[.,]", "", s[:decimal])
        return float(f"{entero}.{s[decimal + 1:]}")
    sep = "," if coma >= 0 else "." if punto >= 0 else ""
    if sep:
        partes = s.split(sep)
        if len(partes[-1]) == 3 and all(len(p) == 3 for p in partes[1:]):   # «480,000» o «5.000.000»: miles
            return float("".join(partes))
        return float("".join(partes[:-1]) + "." + partes[-1])
    return float(s)


def partir(paginas: list[dict]) -> list[dict]:
    """Las secciones de unas bases: [{clave, titulo, pag_ini, pag_fin, texto}] en el orden del documento.

    `paginas`: [{n, texto}] de la pieza. Claves: general, generalidades, procedimiento, requerimiento,
    requisitos_calificacion (un tramo dentro del requerimiento), evaluacion, capitulo_5…, proforma, anexos. Si no aparece el
    título «SECCIÓN ESPECÍFICA» devuelve [] (no son bases estándar, o es un escaneo sin texto): ahí no se adivina."""
    lineas: list[tuple[int, str]] = []
    for i, p in enumerate(paginas or []):
        n = int(p.get("n") or i + 1)
        lineas.extend((n, x) for x in (p.get("texto") or "").splitlines())
    planas = [_plano(x) for _, x in lineas]
    # El título, solo en su línea. Si las bases traen un índice, el título aparece dos veces: vale el último «SECCIÓN
    # ESPECÍFICA» que tenga después un «CAPÍTULO I».
    candidatos = [i for i, x in enumerate(planas) if re.fullmatch(r"SECCION ESPECIFICA\.?", x)]
    inicio = next((i for i in reversed(candidatos)
                   if any(re.match(r"CAPITULO I\b", y) for y in planas[i + 1: i + 400])), None)
    if inicio is None:
        return []
    cortes: list[tuple[int, str, str]] = [(0, "general", "Sección general"), (inicio, "especifica", "Sección específica")]
    visto_requisitos = False
    for i in range(inicio + 1, len(planas)):
        x = planas[i]
        if (m := re.match(r"CAPITULO ([IVX]{1,4})\b", x)) and len(x) <= 80:
            n = _ROMANOS.get(m.group(1))
            if n:
                cortes.append((i, _CAPITULOS.get(n, f"capitulo_{n}"), lineas[i][1].strip()))
        elif re.match(r"(\d\.\d{1,2}\.?\s*)?REQUISITOS DE CALIFICACION\b", x) and len(x) <= 70 and not visto_requisitos \
                and cortes[-1][1] == "requerimiento":
            visto_requisitos = True
            cortes.append((i, "requisitos_calificacion", lineas[i][1].strip()))
        elif re.match(r"PROFORMA DEL CONTRATO\b", x) and len(x) <= 60 and cortes[-1][1] != "proforma":
            cortes.append((i, "proforma", lineas[i][1].strip()))
        elif re.fullmatch(r"ANEXOS\.?", x) and cortes[-1][1] != "anexos":
            cortes.append((i, "anexos", lineas[i][1].strip()))
    secciones = []
    for k, (i, clave, titulo) in enumerate(cortes):
        fin = cortes[k + 1][0] if k + 1 < len(cortes) else len(lineas)
        if fin <= i or clave == "especifica":
            continue
        tramo = lineas[i:fin]
        partes: list[str] = []
        pagina = None
        for n, x in tramo:
            if n != pagina:
                pagina = n
                partes.append(f"⟦p.{n}⟧")
            partes.append(x)
        secciones.append({"clave": clave, "titulo": titulo, "pag_ini": tramo[0][0], "pag_fin": tramo[-1][0],
                          "texto": "\n".join(partes)})
    return secciones


def _seccion(secciones: list[dict], *claves: str) -> dict | None:
    return next((s for s in secciones if s["clave"] in claves), None)


def _pagina(texto: str, pos: int, defecto: int | None) -> int | None:
    marcas = re.findall(r"⟦p\.(\d+)⟧", texto[:pos])
    return int(marcas[-1]) if marcas else defecto


def _cita(texto: str, ini: int, fin: int, margen: int = 90) -> str:
    """La frase alrededor de un dato, en una línea y sin las marcas de página."""
    a = max(texto.rfind("\n\n", 0, ini), texto.rfind(". ", 0, ini), ini - margen * 3)
    trozo = texto[max(a, 0): min(len(texto), fin + margen)]
    return " ".join(re.sub(r"⟦p\.\d+⟧", " ", trozo).split())[:600]


def cuantia(secciones: list[dict]) -> dict | None:
    """La cuantía de la contratación (o el valor referencial) como la dicen las generalidades, o que está reservada.

    → {reservada, valor, moneda, con_limites, pagina, cita, rotulo}; None si las generalidades no traen ese apartado."""
    s = _seccion(secciones, "generalidades")
    if not s:
        return None
    texto = s["texto"]
    may = _mayus(texto)
    # El título del apartado: con su numeral («1.4. CUANTÍA DE LA CONTRATACIÓN») o solo en su línea, a veces con el número
    # de una nota al pie pegado («…CONTRATACIÓN7»).
    m = re.search(r"\n\s*1\.\s?\d{1,2}\.?\s*\n?\s*(CUANTIA DE LA CONTRATACION|VALOR REFERENCIAL|VALOR ESTIMADO)", may) \
        or re.search(r"\n\s*(CUANTIA DE LA CONTRATACION|VALOR REFERENCIAL|VALOR ESTIMADO)\s?\d{0,2}\s*\n", may)
    if not m:
        return None
    resto = may[m.end():]
    fin = re.search(r"\n\s*1\.\s?\d{1,2}\.?\s*\n?\s*[A-Z]{4,}", resto)
    cuerpo_fin = m.end() + (fin.start() if fin else min(len(resto), 3000))
    cuerpo = may[m.end(): cuerpo_fin]
    base = {"rotulo": " ".join(m.group(1).lower().split()), "pagina": _pagina(texto, m.end(), s["pag_ini"]),
            "con_limites": bool(re.search(r"LIMITE\s+(INFERIOR|SUPERIOR)", cuerpo))}
    if (r := re.search(r"NO\s+(SE\s+)?(DAR|DA|DARA)\s+A\s+CONOCER|(CUANTIA|VALOR\s+(ESTIMADO|REFERENCIAL))[^.]{0,80}RESERVAD[AO]", cuerpo)):
        return {**base, "reservada": True, "valor": None, "moneda": None,
                "cita": _cita(texto, m.end() + r.start(), m.end() + r.end(), 160)}
    v = re.search(r"ASCIENDE\s+A(?:\s+LA\s+SUMA\s+(?:TOTAL\s+)?DE)?\s*:?\s*" + _MONTO, cuerpo) \
        or re.search(r"\b(?:CUANTIA|VALOR\s+REFERENCIAL|VALOR\s+ESTIMADO)[^.\n]{0,60}\b(?:ES|SERA)(?:\s+DE)?\s*:?\s*" + _MONTO, cuerpo)
    if not v:
        # En obras el apartado puede ser sólo la tabla de costos (costo directo, gastos generales, utilidad, IGV): la
        # cuantía es el TOTAL de la tabla, nunca un renglón ni el subtotal.
        totales = [t for t in re.finditer(r"(?<!SUB)(?<!SUB )\bTOTAL\b[^\n]{0,40}?\n?\s*" + _MONTO, cuerpo)]
        if totales:
            v = totales[-1]
    if not v:
        return {**base, "reservada": False, "valor": None, "moneda": None, "cita": _cita(texto, m.start(), m.end() + 200)}
    return {**base, "reservada": False, "valor": numero(v.group(2)), "moneda": _MONEDAS.get(v.group(1).replace(" ", ""), "PEN"),
            "cita": _cita(texto, m.end() + v.start(), m.end() + v.end())}


_EXPERIENCIA = re.compile(r"MONTO\s+FACTURADO\s+ACUMULADO\s+(?:EQUIVALENTE(?:\s+A)?|DE|NO\s+MENOR\s+(?:A|DE)|MINIMO\s+DE|IGUAL\s+O\s+MAYOR\s+A)")
_VECES = re.compile(r"(?:\(?\s*([0-9]+(?:[.,][0-9]+)?)\s*\)?|\b(UNA|DOS|TRES|CUATRO|CINCO))\s*(?:\(\s*[0-9]+(?:[.,][0-9]+)?\s*\)\s*)?(?:VEZ|VECES)\b")
_VECES_LETRAS = {"UNA": 1.0, "DOS": 2.0, "TRES": 3.0, "CUATRO": 4.0, "CINCO": 5.0}
# Un monto sin el símbolo de la moneda, sólo si va seguido de su importe en letras («100,000.00 (Cien mil con 00/100 soles)»).
_MONTO_DESNUDO = re.compile(r"^\s*:?\s*()([0-9]{1,3}(?:[,. ][0-9]{3})+(?:[.,][0-9]{2})?)\s*\(\s*[A-ZÑ0-9 ]{6,90}?(?:SOLES|/100)")
_ANIOS = re.compile(r"DURANTE\s+LOS\s+(?:[A-Z]+\s*)?\(?\s*(\d{1,2})?\s*\)?\s*A[ÑN]OS\s+ANTERIORES")
_ANIOS_LETRAS = {"CINCO": 5, "OCHO": 8, "DIEZ": 10, "QUINCE": 15, "VEINTE": 20, "VEINTICINCO": 25}


def _experiencias(seccion: dict | None) -> list[dict]:
    """Cada «monto facturado acumulado equivalente a…» de la sección: el monto (escrito en cifras, a veces después de las
    letras: «…a DOSCIENTOS MIL CON 00/100 SOLES (S/.200,000.00)») o las veces la cuantía, los años y el ítem si lo dice."""
    if not seccion:
        return []
    texto = seccion["texto"]
    may = _mayus(texto)
    salida = []
    for m in _EXPERIENCIA.finditer(may):
        ventana = may[m.end(): m.end() + 220]
        corte = re.search(r"\.\s|\n\s*\n", ventana)                 # hasta el fin de la frase
        frase = ventana[: corte.start()] if corte and corte.start() > 25 else ventana
        if re.match(r"\s*:?\s*\[", frase) or "CONSIGNAR" in frase[:60]:
            continue                                                # la plantilla sin llenar: «[CONSIGNAR EL MONTO…]»
        monto = re.search(_MONTO, frase) or _MONTO_DESNUDO.match(frase)
        veces = _VECES.search(frase)
        if veces and (not monto or veces.start() < monto.start()):
            monto = None
        elif not monto:
            continue
        else:
            veces = None
        fin = m.end() + (monto.end() if monto else veces.end())
        anios = _ANIOS.search(may, fin, fin + 700)
        letras = re.search(r"DURANTE\s+LOS\s+([A-Z]+)", anios.group(0)) if anios and not anios.group(1) else None
        item = re.search(r"ITEM\s+N?\W{0,3}\s*([0-9]{1,3}|[IVX]{1,5})\b", may[max(0, m.start() - 90): m.start()])
        salida.append({"monto": numero(monto.group(2)) if monto else None,
                       "moneda": _MONEDAS.get(monto.group(1).replace(" ", ""), "PEN") if monto else None,
                       "veces": (float(veces.group(1).replace(",", ".")) if veces.group(1) else _VECES_LETRAS[veces.group(2)]) if veces else None,
                       "anios": int(anios.group(1)) if anios and anios.group(1) else (_ANIOS_LETRAS.get(letras.group(1)) if letras else None),
                       "item": item.group(1) if item else None,
                       "pagina": _pagina(texto, m.start(), seccion["pag_ini"]), "cita": _cita(texto, m.start(), fin, 200)})
    return salida


def experiencia_exigida(secciones: list[dict]) -> list[dict]:
    """La experiencia que se EXIGE al postor (requisito de calificación): el monto facturado acumulado o las «veces» la
    cuantía. La primera suele ser la general y la siguiente, si hay, la rebajada para micro y pequeñas empresas."""
    return _experiencias(_seccion(secciones, "requisitos_calificacion") or _seccion(secciones, "requerimiento"))


def experiencia_adicional(secciones: list[dict]) -> list[dict]:
    """La experiencia ADICIONAL que da puntaje (factor de evaluación): no es un requisito ni, menos, la cuantía."""
    return _experiencias(_seccion(secciones, "evaluacion"))


def leer(paginas: list[dict]) -> dict | None:
    """Lo que se saca de unas bases sin modelo, o None si no tienen la armazón estándar."""
    secciones = partir(paginas)
    if not secciones:
        return None
    return {"secciones": [{k: s[k] for k in ("clave", "titulo", "pag_ini", "pag_fin")} for s in secciones],
            "cuantia": cuantia(secciones), "experiencia_exigida": experiencia_exigida(secciones),
            "experiencia_adicional": experiencia_adicional(secciones)}
