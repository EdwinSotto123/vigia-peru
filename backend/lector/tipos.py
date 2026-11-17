"""Qué TIPO de documento es cada pieza de un proceso (sin modelo).

El SEACE ordena los archivos en casilleros («Bases integradas», «Documentos de otorgamiento de buena pro»…), pero el
casillero no es el tipo: un ZIP de «otorgamiento» trae el reporte que genera el sistema y el acta firmada por el comité;
en «declaratoria de desierto» hay informes y también actas; en «nulidad» aparecen informes de adelantos. Una PIEZA es un
PDF (suelto o dentro de un ZIP) y su tipo sale, en este orden, de:

  1. la plantilla   el título de un reporte que genera el SEACE (lector/plantillas.py)
  2. el nombre      del archivo interno del ZIP («1Acta de otorgamiento de la buena pro.pdf»)
  3. el título      las primeras líneas de la pieza, o sus frases de fondo en las resoluciones
  4. el casillero   lo que diga el SEACE, cuando nada de lo anterior alcanza (el menos fiable)

`clasificar` devuelve (tipo, por): `por` dice con cuál de las cuatro se decidió. La lista de tipos es cerrada: lo que no
calza es «otro», y esa parte se mide (docs/DOCUMENTOS_SEACE.md).
"""
from __future__ import annotations

import re

from lector import plantillas

# tipo → (origen, a qué lector le toca). origen: generado (lo emite el SEACE, plantilla fija) | firmado | anexo
TIPOS: dict[str, tuple[str, str | None]] = {
    "reporte_presentacion": ("generado", "plantilla"),
    "reporte_evaluacion": ("generado", "plantilla"),
    "reporte_otorgamiento": ("generado", "plantilla"),
    "reporte_desempate": ("generado", "plantilla"),
    "acta_no_formulacion": ("generado", "plantilla"),
    "bases": ("firmado", "bases"),
    "bases_integradas": ("firmado", "bases"),
    "pliego_absolucion": ("firmado", "consultas"),
    "acta_buena_pro": ("firmado", "buena_pro"),
    "cuadro_evaluacion": ("firmado", "cuadro_evaluacion"),
    "contrato": ("firmado", "contrato"),
    "orden": ("firmado", "contrato"),
    "adenda": ("firmado", "modificacion"),
    "garantia": ("firmado", "garantia"),
    "adicional": ("firmado", "modificacion"),
    "reduccion": ("firmado", "modificacion"),
    "ampliacion_plazo": ("firmado", "modificacion"),
    "resolucion_contrato": ("firmado", "resolucion"),
    "nulidad": ("firmado", "resolucion"),
    "informe_desierto": ("firmado", "desierto"),
    "resumen_ejecutivo": ("firmado", "resumen_ejecutivo"),
    "presupuesto": ("anexo", None),
    "ficha_tecnica": ("anexo", None),
    "otro": ("anexo", None),
}

_TILDES = str.maketrans("ÁÉÍÓÚÜáéíóúü", "AEIOUUaeiouu")


def _plano(s: str | None) -> str:
    return " ".join((s or "").translate(_TILDES).upper().split())


# 2. Por el nombre del archivo interno (sin números ni guiones). El primero que calza gana.
_POR_NOMBRE: list[tuple[str, str]] = [
    ("acta_buena_pro", r"\bACTA\b.*\b(OTORGAMIENTO|BUENA PRO|ADMISION|EVALUACION|CALIFICACION|APERTURA)"),
    ("cuadro_evaluacion", r"\bCUADRO\b.*\b(EVALUACION|COMPARATIVO|CALIFICACION)|\bCUADRO N\b"),
    ("bases_integradas", r"\bBASES? INTEGRADAS?\b|\bINTEGRADAS?\b.*\bBASES\b"),
    ("pliego_absolucion", r"\bPLIEGO\b|\bABSOLUCION\b"),
    ("bases", r"\bBASES\b"),
    ("presupuesto", r"\bPRESUPUESTO\b|\bMETRADOS?\b|\bANALISIS DE (COSTOS|PRECIOS)\b|\bFORMULA POLINOMICA\b"),
    ("ficha_tecnica", r"\bFICHAS? (TECNICAS?|DE HOMOLOGACION)\b|\bF T\b|\bFH ITEM\b"),
    ("garantia", r"\bCARTA FIANZA\b|\bFIANZA\b|\bPOLIZA\b|\bGARANTIA\b"),
    ("adenda", r"\bADENDA\b"),
    ("contrato", r"\bCONTRATO\b"),
    ("orden", r"\bORDEN DE (COMPRA|SERVICIO)\b|\bO C\b|\bO S\b"),
]

# 3a. Por el título: las primeras líneas de la pieza.
_POR_TITULO: list[tuple[str, str]] = [
    ("bases_integradas", r"\bBASES INTEGRADAS\b"),
    ("bases", r"\bBASES (ESTANDAR|ADMINISTRATIVAS)\b|^BASES\b|\bBASES DE(L)? (LA )?(LICITACION|CONCURSO|SUBASTA|COMPARACION|PROCEDIMIENTO)"),
    ("pliego_absolucion", r"\bPLIEGO (DE )?ABSOLU|\bPLIEGO ABSOLUTORIO\b|\bABSOLUCION DE (LAS )?CONSULTAS\b"),
    ("acta_buena_pro", r"\bACTA\b.{0,160}\b(OTORGAMIENTO|BUENA PRO|ADMISION|EVALUACION DE OFERTAS|CALIFICACION|APERTURA DE (SOBRES|OFERTAS))"),
    ("cuadro_evaluacion", r"\bCUADRO (COMPARATIVO|DE EVALUACION|DE CALIFICACION)\b"),
    ("garantia", r"\bCARTA FIANZA\b|\bPOLIZA DE CAUCION\b|\bFIANZA SOLIDARIA\b|\bGARANTIA INCONDICIONAL\b|\bCERTIFICADO DE GARANTIA\b"),
    ("adenda", r"\bADENDA\b.{0,40}\b(AL|DEL|N)\b"),
    ("orden", r"\bORDEN DE (COMPRA|SERVICIO)\b"),
    ("contrato", r"\bCONTRATO\b.{0,12}\b(N|NRO|DE|PARA)\b"),
    ("resumen_ejecutivo", r"\bRESUMEN EJECUTIVO\b|\bINDAGACION DE(L)? MERCADO\b|\bESTUDIO DE MERCADO\b|\bINFORME DE RESULTADOS DEL PROCESO\b"),
]

# 3b. Por el fondo: en los casilleros de la ejecución del contrato el documento es una resolución o una carta, y lo que
# lo define está en lo que resuelve. Se busca en todo el texto de la pieza (son documentos cortos).
_POR_FONDO: list[tuple[str, str]] = [
    ("ampliacion_plazo", r"\bAMPLIACION (DE|DEL) PLAZO\b"),
    ("reduccion", r"\bREDUCCION DE (LAS )?(PRESTACIONES|OBRA)\b|\bDEDUCTIVO( VINCULANTE)?( DE OBRA)? N"),
    ("adicional", r"\b(PRESTACION(ES)?|OBRAS?) ADICIONAL(ES)?\b|\bADICIONAL DE OBRA\b|\bADICIONAL N"),
    ("nulidad", r"\bNULIDAD (DE OFICIO|DEL (PROCEDIMIENTO|CONTRATO|OTORGAMIENTO)|DE LA BUENA PRO)\b|\bDECLARAR (LA )?NUL[AO]\b"),
    ("resolucion_contrato", r"\bRESOL(VER|UCION)( TOTAL| PARCIAL)?( DE| DEL| EL)? CONTRATO\b|\bRESOLUCION CONTRACTUAL\b"),
    ("informe_desierto", r"\bDECLARA(R|TORIA DE|DO|SE)? DESIERTO\b|\bDESIERTO EL PROCEDIMIENTO\b"),
]

# 4. Por el casillero del SEACE (lo último): patrón sobre el título en mayúsculas sin tildes.
_POR_CASILLERO: list[tuple[str, str]] = [
    ("bases_integradas", r"^BASES INTEGRADAS"),
    ("bases", r"^BASES"),
    ("pliego_absolucion", r"^PLIEGO"),
    ("acta_no_formulacion", r"NO FORMULACION"),
    ("reporte_presentacion", r"PRESENTACION DE PROPUESTAS"),
    ("cuadro_evaluacion", r"CALIFICACION Y EVALUACION"),
    ("acta_buena_pro", r"OTORGAMIENTO DE BUENA PRO"),
    ("garantia", r"GARANTIA"),
    ("ampliacion_plazo", r"AMPLIACION"),
    ("adicional", r"ADICIONAL"),
    ("resolucion_contrato", r"RESOLUCION DEL CONTRATO"),
    ("nulidad", r"NULIDAD"),
    ("informe_desierto", r"DESIERTO"),
    ("resumen_ejecutivo", r"RESUMEN EJECUTIVO"),
    ("contrato", r"ARCHIVOS DEL CONTRATO"),
]
_EJECUCION = re.compile(r"ADICIONAL|AMPLIACION|RESOLUCION|NULIDAD|DESIERTO|COMPLEMENTARIO|INTERVENCION")
_PLIEGO = r"\bPLIEGO (DE )?ABSOLU|\bPLIEGO ABSOLUTORIO\b|\bABSOLUCION DE (LAS )?CONSULTAS\b"


def _primero(reglas: list[tuple[str, str]], texto: str) -> str | None:
    return next((tipo for tipo, patron in reglas if re.search(patron, texto)), None)


def clasificar(casillero: str | None, archivo: str | None, inicio: str | None, texto: str | None = None) -> tuple[str, str]:
    """El tipo de una pieza y cómo se decidió.

    casillero  el título del SEACE (documentos_gcs.titulo)
    archivo    el nombre del archivo dentro del ZIP, o None si la pieza es el documento entero
    inicio     el texto de su primera página con letras (puede venir vacío en un escaneo)
    texto      todo el texto de la pieza; sólo se mira en los casilleros de la ejecución del contrato
    """
    cas = _plano(casillero)
    if (tipo := plantillas.detectar(inicio or "")):
        return tipo, "plantilla"
    if archivo:
        nombre = _plano(re.sub(r"\.[A-Za-z0-9]{2,5}$", "", archivo.split("/")[-1]))
        nombre = " ".join(re.sub(r"[0-9_\-.()+]+", " ", nombre).split())
        if (tipo := _primero(_POR_NOMBRE, nombre)):
            return tipo, "nombre"
        if re.search(r"\.(XLSX?|XLSM)\b", _plano(archivo)):
            return "presupuesto", "nombre"
    cabeza = _plano((inicio or "")[:1500])
    if _EJECUCION.search(cas):
        if (tipo := _primero(_POR_FONDO, _plano((texto or inicio or "")[:60000]))):
            # En el casillero de desierto, un acta que declara desierto el proceso sigue siendo un acta.
            if tipo == "informe_desierto" and re.search(_POR_TITULO[3][1], cabeza[:600]):
                return "acta_buena_pro", "titulo"
            return tipo, "titulo"
    # Un pliego nombra las bases en su primer párrafo («…consultas y observaciones a las bases de la licitación…»): si el
    # documento se titula pliego, es un pliego.
    if cabeza and re.search(_PLIEGO, cabeza[:600]):
        return "pliego_absolucion", "titulo"
    if cabeza and (tipo := _primero(_POR_TITULO, cabeza)):
        # Las integradas suelen conservar en la portada «BASES ESTÁNDAR…»: el casillero del SEACE dice cuáles son (429
        # piezas mal tipadas al 2026-11-17, entre ellas las del proceso 1225937).
        if tipo == "bases" and re.search(r"^BASES INTEGRADAS", cas):
            return "bases_integradas", "casillero"
        return tipo, "titulo"
    if (tipo := _primero(_POR_CASILLERO, cas)):
        return tipo, "casillero"
    return "otro", "casillero"


def regimen(texto: str | None) -> str | None:
    """Con qué ley se convocó, por lo que el propio documento cita: la Ley 32069 (vigente desde abril de 2025) o la
    anterior, la Ley 30225. Importa porque cambia el vocabulario: «cuantía de la contratación» en vez de «valor
    referencial»."""
    t = _plano((texto or "")[:200000])
    nueva = len(re.findall(r"\b32069\b|LEY GENERAL DE CONTRATACIONES PUBLICAS", t))
    vieja = len(re.findall(r"\b30225\b|LEY DE CONTRATACIONES DEL ESTADO", t))
    if not nueva and not vieja:
        return None
    return "ley_32069" if nueva >= vieja else "ley_30225"
