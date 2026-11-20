"""Lector de las resoluciones del Tribunal de Contrataciones (TCE / TCP) que resuelven recursos de apelación.

El dato lo lee el modelo (GLM por Workers AI, motor_workers.MotorWorkers.llamar_texto); el código sólo enruta (¿es una
apelación?), recorta (el encabezado y la parte resolutiva) y comprueba (la cita literal del resolutivo está en el texto,
y cada procedimiento citado también). Ver docs/DATOS_Y_SENALES.md §15.1: las apelaciones fundadas y las nulidades de
oficio son la verdad de la etapa de selección con la que se validan las señales de competencia.
"""
from __future__ import annotations

import re

# v2 (2026-11-19): también a quién se le revocó la buena pro (adjudicatario) y contra quién se ordena abrir un
# procedimiento sancionador (sancionador_contra, infraccion). tribunal_cargar.py relee las v1 por tramos.
VERSION = "v2"
# La regla que comprueba el resultado (resultado_de_texto). Al cambiarla, tribunal_cargar.py recomprueba las cargadas.
VERSION_REGLA = "3"
# 3 (2026-11-20): el destinatario del sancionador debe estar en un punto resolutivo que ORDENE abrirlo (antes bastaba
# que la palabra «sancionador» estuviera en la parte resolutiva y el nombre en cualquier parte del texto: salían como
# sancionadas empresas de puntos que ARCHIVAN un sancionador o mandan copias de uno a la Fiscalía).
# El que relee las disputas (migración 423): el modelo chico y la regla no leen lo mismo.
MODELO_GRANDE = "@cf/zai-org/glm-5.3"

SISTEMA = """Lees resoluciones del Tribunal de Contrataciones del Perú (antes TCE, hoy TCP) que resuelven un RECURSO DE
APELACIÓN contra un acto de un procedimiento de selección (la buena pro, una descalificación, la declaratoria de desierto).
Devuelves sólo lo que la resolución dice, con sus palabras. No inventes: si un dato no figura, déjalo vacío.

- «procedimientos»: cada procedimiento de selección impugnado, copiado tal como aparece (por ejemplo «Licitación Pública
  Abreviada de Obras N° 003-2026-MDH/C-1» o «Adjudicación Simplificada N° 12-2025-GRA/CS - Primera Convocatoria»), con
  sus ítems si la resolución los nombra.
- «entidad»: la entidad que convocó, con su nombre completo como figura.
- «impugnante»: quien apeló (empresa o consorcio), como figura.
- «resultado»: lo que decide el Tribunal sobre el recurso. fundado | fundado_en_parte | infundado | improcedente |
  nulidad_de_oficio (el Tribunal declara nulo el procedimiento o parte de él, aunque también se pronuncie sobre el
  recurso) | desistimiento | otro.
- «efectos»: lo que ordena: revoca_buena_pro, otorga_buena_pro_al_impugnante, retrotrae (vuelve a una etapa anterior),
  nulidad (anula el procedimiento o ítems), descalifica_al_adjudicatario, confirma_buena_pro.
- «motivo»: en una oración, por qué decide así (el vicio que encontró o por qué no lo encontró).
- «cita_resolutivo»: copia LITERAL del primer punto de la parte resolutiva («1. Declarar …»), hasta 300 caracteres.
- «fecha»: la fecha de la resolución (AAAA-MM-DD).
- «adjudicatario»: el postor que tenía la buena pro cuando se apeló (empresa o consorcio), como figura. Vacío si no había
  buena pro (por ejemplo, se apeló una descalificación de un procedimiento declarado desierto).
- «sancionador_contra»: cada proveedor contra el que la parte resolutiva ordena abrir un procedimiento administrativo
  sancionador (o remitir los actuados a la Secretaría del Tribunal para que lo abra), como figura. Si es un consorcio y
  la resolución nombra a sus integrantes, cada integrante. Vacío si la parte resolutiva no lo ordena.
- «infraccion»: por qué se ordena ese procedimiento: documentacion_falsa | informacion_inexacta | otra. Vacío si no hay."""

ESQUEMA = {
    "type": "object",
    "properties": {
        "procedimientos": {"type": "array", "items": {"type": "string"}, "maxItems": 6},
        "entidad": {"type": "string"},
        "impugnante": {"type": "string"},
        "resultado": {"type": "string", "enum": ["fundado", "fundado_en_parte", "infundado", "improcedente",
                                                  "nulidad_de_oficio", "desistimiento", "otro"]},
        "efectos": {"type": "array", "items": {"type": "string", "enum": [
            "revoca_buena_pro", "otorga_buena_pro_al_impugnante", "retrotrae", "nulidad", "descalifica_al_adjudicatario",
            "confirma_buena_pro"]}},
        "motivo": {"type": "string"},
        "cita_resolutivo": {"type": "string"},
        "fecha": {"type": "string"},
        "adjudicatario": {"type": "string"},
        "sancionador_contra": {"type": "array", "items": {"type": "string"}, "maxItems": 6},
        "infraccion": {"type": "array", "items": {"type": "string", "enum": [
            "documentacion_falsa", "informacion_inexacta", "otra"]}},
    },
    "required": ["procedimientos", "entidad", "resultado", "cita_resolutivo"],
}

PEDIDO = "Lee esta resolución del Tribunal y devuelve sus datos con la herramienta «salida»."

_ESPACIOS = re.compile(r"\s+")
# Cómo empieza la parte resolutiva, de la forma más segura a la menos:
#  1. «LA SALA RESUELVE:» en mayúsculas (la mayoría);
#  2. «La Sala resuelve:» con dos puntos, en cualquier forma (las salas 1 y 5 en 2026);
#  3. sin la palabra: «… luego de agotado el debate correspondiente, por unanimidad; 1. Declarar …» (la sala 2 en 2026).
# Nunca «resuelve» sin dos puntos: calzaba «la resolución que resuelve el recurso de apelación» de una nota al pie de la
# última página, y el resultado salía vacío (33 resoluciones el 2026-11-19).
_RESUELVE_MAYUS = re.compile(r"(?:LA SALA RESUELVE|SE RESUELVE|RESUELVE)\s*:")
_RESUELVE_DOS_PUNTOS = re.compile(r"(?:la sala resuelve|se resuelve|resuelve)\s*:", re.I)
_RESUELVE_DEBATE = re.compile(r"debate correspondiente[^.;:]{0,40}?por (?:unanimidad|mayor[ií]a)\s*[;,:]", re.I)


def _resolutivo(t: str):
    """El comienzo de la parte resolutiva: la última ancla de la forma más segura que aparezca (ver arriba)."""
    for patron in (_RESUELVE_MAYUS, _RESUELVE_DOS_PUNTOS, _RESUELVE_DEBATE):
        m = None
        for m in patron.finditer(t):
            pass
        if m:
            return m
    return None


def plano(t: str) -> str:
    return _ESPACIOS.sub(" ", t or "").strip()


def tipo_de(texto: str) -> str:
    """Enruta sin modelo, por el encabezado: apelacion | sancion | otro (sustituciones, nulidades sueltas, otros)."""
    ini = plano(texto)[:4000]
    if re.search(r"recurso de apelaci[oó]n", ini, re.I):
        return "apelacion"
    if re.search(r"sancionador|imposici[oó]n de sanci[oó]n|inhabilitaci[oó]n", ini, re.I):
        return "sancion"
    return "otro"


def recorte(texto: str, cabeza: int = 7000, cola: int = 5000) -> str:
    """Lo que el modelo necesita: el encabezado (sumilla, visto, el procedimiento y las partes) y la parte resolutiva."""
    t = plano(texto)
    m = _resolutivo(t)
    fin = t[m.start():m.start() + cola] if m else t[-cola:]
    return t[:cabeza] + "\n\n[…]\n\n" + fin


def _compacto(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", plano(s).lower().replace("°", "").replace("º", ""))


# Lo que puede decir el primer punto resolutivo. Las cinco primeras resuelven la apelación; las otras son resoluciones que
# no la resuelven (una sanción, una rectificación de error material, una aclaración) y el modelo las lee como «otro».
_PRIMER_PUNTO = (
    (r"nulidad|\bnul[oa]s?\b", "nulidad_de_oficio"),
    (r"\bfundad[oa]s? en parte", "fundado_en_parte"),
    (r"\binfundad[oa]s?\b", "infundado"),
    (r"\bimprocedente", "improcedente"),
    (r"\bdesist", "desistimiento"),
    (r"\bfundad[oa]s?\b", "fundado"),
    (r"\bsancionar\b", "sancion"),
    (r"\brectificar\b", "rectificacion"),
    (r"\baclarar\b|\bno ha lugar\b", "aclaracion"),
)
NO_RESUELVEN_APELACION = {"sancion", "rectificacion", "aclaracion"}
# Lo que importa para validar las señales (migraciones 404, 422): ¿el Tribunal corrigió el proceso?
CORREGIDO = {"fundado", "fundado_en_parte", "nulidad_de_oficio"}
NO_CORREGIDO = {"infundado", "improcedente", "desistimiento"}


def grupo(resultado: str | None) -> str | None:
    """corregido | no_corregido | otro (no resuelve la apelación) | None (no se sabe)."""
    if resultado in CORREGIDO:
        return "corregido"
    if resultado in NO_CORREGIDO:
        return "no_corregido"
    if resultado == "otro" or resultado in NO_RESUELVEN_APELACION:
        return "otro"
    return None


def resultado_de_texto(texto: str) -> str | None:
    """Segunda lectura, sin modelo, del resultado: el primer punto de la parte resolutiva tal como está escrito. Gana lo
    que aparece PRIMERO en ese punto («Declarar FUNDADO el recurso … y, en consecuencia, la nulidad del otorgamiento» es
    fundado; «Declarar la nulidad de oficio …» es nulidad); a la misma altura, el patrón más largo («fundado en parte»)."""
    t = plano(texto)
    m = _resolutivo(t)
    if not m:
        return None
    primero = t[m.end():m.end() + 600]
    # El primer punto termina donde empieza el 2 (a veces después de una cabecera de página «Página 40 de 41»).
    corte = re.search(r"(?<!de)\s2\s*[.)]\s", primero)
    primero = (primero[:corte.start()] if corte else primero).lower()
    hallados = []
    for patron, valor in _PRIMER_PUNTO:
        h = re.search(patron, primero)
        if h:
            hallados.append((h.start(), -(h.end() - h.start()), valor))
    if not hallados:
        return None
    valor = min(hallados)[2]
    # «1. Declarar IMPROCEDENTE el recurso … 2. Declarar la nulidad de oficio del procedimiento»: la nulidad que el
    # Tribunal declara en un punto posterior también corrige el proceso (así lo pide el lector al modelo).
    if valor in NO_CORREGIDO:
        resto = t[m.end():m.end() + 4000]
        fin = re.search(r"Reg[ií]strese|Comun[ií]quese", resto)
        if re.search(r"declarar,? de oficio,? la nulidad|declarar la nulidad de oficio", resto[:fin.start() if fin else None], re.I):
            return "nulidad_de_oficio"
    return valor


def comprobar(salida: dict, texto: str) -> dict:
    """La cita del resolutivo y cada procedimiento deben estar en el texto (sin espacios ni signos): si no, no se usan. El
    resultado se compara con la lectura sin modelo del primer punto resolutivo:
    - `_resultado_ok`: el mismo resultado (o el modelo dice «otro» y el punto no resuelve una apelación). Sólo entonces la
      API publica el resultado exacto.
    - `_corregido_ok`: los dos coinciden en si el Tribunal corrigió el proceso (fundado, en parte o nulidad) o no, aunque
      difieran en cuál. Es la etiqueta con la que se validan las señales y se compara a las entidades."""
    t = _compacto(texto)
    cita = salida.get("cita_resolutivo") or ""
    salida["_cita_ok"] = bool(cita) and _compacto(cita[:160]) in t
    salida["_procedimientos_ok"] = [p for p in (salida.get("procedimientos") or []) if len(_compacto(p)) >= 8 and _compacto(p) in t]
    regla = resultado_de_texto(texto)
    modelo = salida.get("resultado")
    salida["_resultado_regla"] = regla
    salida["_resultado_ok"] = regla is not None and (regla == modelo or (modelo == "otro" and regla in NO_RESUELVEN_APELACION))
    salida["_corregido_ok"] = grupo(regla) is not None and grupo(regla) == grupo(modelo)
    # Las partes: cada nombre debe estar en el texto. El procedimiento sancionador, además, sólo si la parte resolutiva lo
    # ordena (la palabra está en ella): un modelo que lo deduce de los fundamentos no basta.
    adj = plano(salida.get("adjudicatario") or "")
    salida["_adjudicatario_ok"] = adj if len(_compacto(adj)) >= 6 and _compacto(adj) in t else ""
    salida["_sancionador_ok"] = sancionados_en(texto, salida.get("sancionador_contra") or [])
    return salida


def parte_resolutiva(texto: str) -> str:
    """De «RESUELVE:» (o su ancla) hasta «Regístrese», o 5 000 caracteres."""
    t = plano(texto)
    m = _resolutivo(t)
    if not m:
        return ""
    resto = t[m.end():m.end() + 5000]
    fin = re.search(r"Reg[ií]strese", resto)
    return resto[:fin.start()] if fin else resto


_PUNTO = re.compile(r"(?:^|\s)\d{1,2}\s*[.)]\s")


def puntos_con_sancionador(texto: str) -> list[str]:
    """Los puntos de la parte resolutiva («3. Abrir expediente administrativo sancionador contra …») que ordenan abrir
    un procedimiento sancionador, cada uno entero. Sin puntos numerados, la parte resolutiva entera si lo menciona."""
    res = parte_resolutiva(texto)
    cortes = [m.start() for m in _PUNTO.finditer(res)] or [0]
    if cortes[0] != 0:
        cortes = [0, *cortes]
    trozos = [res[a:b] for a, b in zip(cortes, [*cortes[1:], len(res)])]
    # Que ORDENE abrirlo: un verbo de apertura antes de «sancionador» en la misma oración («abrir expediente
    # administrativo sancionador», «disponga el inicio del procedimiento sancionador») o «sancionador contra …». No
    # cuenta el punto que archiva uno («el archivo definitivo del expediente administrativo sancionador seguido a …»)
    # ni el que manda copias de un expediente sancionador a la Fiscalía.
    return [x for x in trozos if _ORDENA.search(x)]


_ORDENA = re.compile(r"\b(?:abr[aei]\w*|inici\w*|apertur\w*)\b[^.;]{0,120}?sancionador|sancionador\s+contra\b", re.I)


def sancionados_en(texto: str, nombres: list[str]) -> list[str]:
    """De los nombres que dio el modelo, los que están en un punto resolutivo que ordena el sancionador. Un consorcio con
    sus integrantes («Consorcio X, integrado por A y B»): vale entero, o cada integrante que figure en ese punto."""
    puntos = [_compacto(x) for x in puntos_con_sancionador(texto)]
    if not puntos:
        return []
    salen: list[str] = []
    for n in nombres:
        n = plano(n)
        c = _compacto(n)
        if len(c) >= 6 and any(c in p for p in puntos):
            candidatos = [n]
        else:
            candidatos = [x for x in nombres_de(n)[1:] if len(_compacto(x)) >= 6 and any(_compacto(x) in p for p in puntos)]
        salen += [x for x in candidatos if x not in salen]
    return salen


def ordena_sancionador(texto: str) -> bool:
    """La parte resolutiva ordena abrir (o remitir para que se abra) un procedimiento sancionador."""
    return bool(re.search(r"sancionador", parte_resolutiva(texto), re.I))


_INTEGRADO = re.compile(r",?\s*(?:integrad[oa]|conformad[oa]|compuest[oa])s?\s+por\s+", re.I)
_TRATAMIENTO = re.compile(r"^(?:las?|los?|el|sus?)\s+(?:empresas?|señor(?:es|as?)?|señora|proveedor(?:es)?|postor(?:es)?)\s+", re.I)
_INTEGRANTES_DE = re.compile(r",?\s*(?:integrantes?|miembros?)\s+del?\s+", re.I)


def nombres_de(parte: str) -> list[str]:
    """«Consorcio Piura, conformado por las empresas A S.C.R.L. y B E.I.R.L.» → ["Consorcio Piura", "A S.C.R.L.",
    "B E.I.R.L."]: el consorcio y cada integrante, para unir cada uno a su RUC. También «las empresas A y B, integrantes
    del Consorcio C». Un nombre suelto vuelve tal cual."""
    t = plano(parte).strip(" .;,")
    m = _INTEGRADO.search(t)
    if m:
        cabeza, cola = t[:m.start()].strip(" ,"), t[m.end():]
    else:
        m = _INTEGRANTES_DE.search(t)
        if not m:
            return [_TRATAMIENTO.sub("", t)] if t else []
        cabeza, cola = t[m.end():].strip(" ,"), t[:m.start()]
    cola = _TRATAMIENTO.sub("", cola.strip())
    # Los integrantes van separados por comas y la última «y» / «e». Pero «Construcciones, Ventas y Servicios Octalier
    # E.I.R.L.» es UN nombre: se juntan los trozos hasta uno que cierra con una forma societaria. Si ninguno cierra así
    # (personas, nombres sin forma), se parte sólo en las «y».
    trozos = re.split(r"(,\s*|\s+y\s+|\s+e\s+)", cola)
    piezas, actual = [], ""
    for i, trozo in enumerate(trozos):
        if i % 2 == 1 and not actual:
            continue  # el separador que sigue a un nombre ya cerrado
        actual += trozo
        if i % 2 == 0 and _FORMA_FINAL.search(trozo.strip(" .;")):
            piezas.append(actual)
            actual = ""
    if actual.strip(" .;,"):
        piezas.append(actual)
    if len(piezas) <= 1:
        piezas = re.split(r"\s+y\s+", cola)
    piezas = [_TRATAMIENTO.sub("", p.strip(" .;,")) for p in piezas]
    return [x for x in [cabeza, *piezas] if len(x) >= 3]


_FORMA_FINAL = re.compile(
    r"(?:\bS\.?\s?A\.?\s?C|\bS\.?\s?A\.?\s?A|\bS\.?\s?A|\bE\.?\s?I\.?\s?R\.?\s?L|\bS\.?\s?R\.?\s?L(?:TDA)?|\bS\.?\s?C\.?\s?R\.?\s?L"
    r"|SOCIEDAD AN[OÓ]NIMA(?: CERRADA| ABIERTA)?|RESPONSABILIDAD LIMITADA)\.?$", re.I)


def normalizar(salida: dict) -> dict:
    salida["procedimientos"] = [plano(p) for p in (salida.get("procedimientos") or []) if plano(p)][:6]
    salida["sancionador_contra"] = [plano(p) for p in (salida.get("sancionador_contra") or []) if plano(p)][:6]
    for k in ("entidad", "impugnante", "motivo", "cita_resolutivo", "fecha", "adjudicatario"):
        if k in salida:
            salida[k] = plano(salida.get(k) or "")
    return salida
