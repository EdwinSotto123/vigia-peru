"""Los reportes que genera el propio SEACE se leen SIN modelo: tienen plantilla fija.

Cinco documentos salen del sistema y no de un escáner, así que su texto (PyMuPDF) siempre trae las mismas etiquetas en el
mismo orden (medido el 2026-11-16 sobre 22 mil páginas: 0 % escaneadas):

  reporte_presentacion   «Presentación de ofertas/expresión de interés»: quién presentó oferta en cada ítem, con fecha y hora
  reporte_evaluacion     «Reporte de evaluación técnica»: por postor, registro, admisión, puntaje técnico y calificación
  reporte_otorgamiento   «Reporte de otorgamiento de buena pro»: por ítem, la cuantía, las cantidades, el resultado y a quién
                         se adjudicó y por cuánto (con los integrantes si es un consorcio)
  reporte_desempate      «Reporte del desempate»: orden de prelación y puntajes de los empatados
  acta_no_formulacion    «Acta de no formulación de consultas y observaciones»: nadie consultó

`leer_paginas(textos)` recibe el texto de cada página de un documento y devuelve sus reportes. Un reporte largo sigue en la
página siguiente con la cabecera repetida y un ítem puede quedar partido entre dos: por eso primero se juntan los cuerpos
de las páginas del mismo reporte y después se leen. Lo que no calza con la plantilla se cuenta en `sobrante` (no se
adivina); una página que pasó por OCR y perdió el orden se cuenta en `paginas_sin_leer`. Nada de aquí llama a un modelo.

Privacidad: el pie de cada reporte trae el DNI del usuario del SEACE que lo generó. No se lee ni se guarda. Los postores
pueden ser personas (RUC 10): quien guarde esta salida la trata como el resto de las lecturas (la API tapa al publicar).
"""
from __future__ import annotations

import re

TITULOS = {
    "reporte_presentacion": "PRESENTACION DE OFERTAS/EXPRESION DE INTERES",
    "reporte_evaluacion": "REPORTE DE EVALUACION TECNICA",
    "reporte_otorgamiento": "REPORTE DE OTORGAMIENTO DE BUENA PRO",
    "reporte_desempate": "REPORTE DEL DESEMPATE",
}
VERSION = "p1"

_TILDES = str.maketrans("ÁÉÍÓÚÜáéíóúü", "AEIOUUaeiouu")
_ENTERO = re.compile(r"^\d{1,6}$")
_NUMERO = re.compile(r"^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$")     # el SEACE escribe las cantidades grandes como «1.561305E7»
_CODIGO = re.compile(r"^\d{8,12}$")                       # RUC (11) o el código que el SEACE le da a un consorcio
_FILA_RUC = re.compile(r"^(\d{8,12})-\s*(.*)$")
_FECHA = re.compile(r"\b(\d{2})/(\d{2})/(\d{4})\b")
_HORA = re.compile(r"^\d{1,2}:\d{2}:\d{2}$")
_MONTO = re.compile(r"^(S/\.?|\$/?\.?|US\$|USD|€)\s*([\d,]+(?:\.\d+)?)$")
# La nomenclatura de un procedimiento: siglas, número, año y, al final, el número de convocatoria («LP-ABR-3-2026-X/CS-1»).
_NOMENCLATURA = re.compile(r"^[A-ZÑ]{2,}[A-Z0-9Ñ .\-/°º_]*-(?:19|20)\d{2}-.*-\d{1,2}$")
_REGISTRO = re.compile(r"^(no\s+)?v[aá]lid[oa]$|^inv[aá]lid[oa]$|^anulad[oa]$|^retirad[oa]$", re.I)
# El registro pegado al final del nombre, con espacio («… S.A.C. Valido») o sin él («…INGENIEROSValido»: el PDF no trae
# el espacio; se reconoce porque el nombre va en mayúsculas y «Valido» no). Lo halló la lectura con modelo al comparar.
_REGISTRO_PEGADO = re.compile(r"(?:\s|(?<=[A-ZÁÉÍÓÚÑ.)\"']))((?:No\s+)?V[aá]lid[oa]|(?<=\s)(?:no\s+)?v[aá]lid[oa])$")
_ADMISION = {"admitida": True, "no admitida": False}
_CALIFICACION = {"calificada": True, "descalificada": False, "-": None}
_MONEDA = {"S/": "PEN", "S/.": "PEN", "$/.": "USD", "$/": "USD", "$": "USD", "US$": "USD", "USD": "USD", "€": "EUR"}
_SI_NO = {"SI": True, "NO": False}
# Los títulos de las columnas: se repiten al seguir la tabla en otra página, en medio de las filas. No son datos.
_ROTULOS = {
    "reporte_presentacion": {"FECHA PRESENTACION", "FORMA DE PRESENTACION", "NOMBRE O RAZON SOCIAL", "RUC / CODIGO",
                             "HORA PRESENTACION"},
    "reporte_evaluacion": {"ESTADO DE", "ADMISION", "CALIFICACION", "PUNTAJE", "TECNICO", "ESTADO DE REGISTRO",
                           "DE PROPUESTA", "POSTOR"},
    "reporte_otorgamiento": {"CANTIDAD ADJUDICADA", "INTEGRANTE DEL CONSORCIO", "NOMBRE O RAZON SOCIAL", "MONTO ADJUDICADO"},
}


def _es_rotulo(clave: str, linea: str) -> bool:
    return _plano(linea).rstrip(" :") in _ROTULOS[clave]


def _plano(s: str) -> str:
    """Comparable: sin tildes, en mayúsculas y con espacios simples."""
    return " ".join((s or "").translate(_TILDES).upper().split())


def _lineas(texto: str) -> list[str]:
    return [" ".join(x.split()) for x in (texto or "").replace("\t", " ").splitlines() if x.strip()]


def _num(s: str) -> float | None:
    s = (s or "").replace(",", "").strip()
    return float(s) if _NUMERO.match(s) else None


def _fecha(s: str) -> str | None:
    m = _FECHA.search(s or "")
    return f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else None


def _indice(lineas: list[str], etiqueta: str, desde: int = 0, hasta: int | None = None) -> int:
    """Dónde está una etiqueta de la plantilla (comparada sin tildes ni «:» final), o -1."""
    buscada = _plano(etiqueta).rstrip(" :")
    for i in range(max(desde, 0), len(lineas) if hasta is None else min(hasta, len(lineas))):
        if _plano(lineas[i]).rstrip(" :") == buscada:
            return i
    return -1


def detectar(texto: str) -> str | None:
    """Qué reporte del SEACE es esta página, por su título (las primeras líneas), o None."""
    cabeza = _plano((texto or "")[:400])
    for clave, titulo in TITULOS.items():
        if titulo in cabeza:
            return clave
    if "ACTA DE NO" in cabeza and "FORMULACION DE CONSULTAS" in cabeza:
        return "acta_no_formulacion"
    return None


def _cabecera(cab: list[str]) -> dict:
    """Entidad, número de convocatoria, nomenclatura, objeto y descripción: los valores van ANTES de sus etiquetas."""
    k = next((i for i, x in enumerate(cab) if _NOMENCLATURA.match(_plano(x))), -1)
    if k < 0:
        return {"entidad": None, "nro_convocatoria": None, "nomenclatura": None, "objeto": None, "descripcion": " ".join(cab) or None}
    con_numero = k > 0 and bool(_ENTERO.match(cab[k - 1]))
    return {
        "entidad": " ".join(cab[: k - 1 if con_numero else k]) or None,
        "nro_convocatoria": int(cab[k - 1]) if con_numero else None,
        "nomenclatura": cab[k],
        "objeto": cab[k + 1] if k + 1 < len(cab) else None,
        "descripcion": " ".join(cab[k + 2:]) or None,
    }


def _generado(lineas: list[str]) -> str | None:
    """La fecha en que el SEACE generó el reporte: está en el pie."""
    for x in reversed(lineas[-9:]):
        if (f := _fecha(x)):
            return f
    return None


def _pie(lineas: list[str], desde: int) -> int:
    """Dónde empieza el pie (la línea «Usuario : …», que trae el DNI de quien generó el reporte y no se lee)."""
    for i in range(max(desde, 0), len(lineas)):
        if _plano(lineas[i]).replace(" ", "").startswith("USUARIO:"):
            return i
    return len(lineas)


def _partir(texto: str) -> tuple[dict, list[str], str | None] | None:
    """Una página de los tres reportes con la misma cabecera → (cabecera, cuerpo sin cabecera ni pie, fecha de generación)."""
    ls = _lineas(texto)
    fin_cab = _indice(ls, "Entidad convocante")
    ini = _indice(ls, "Nro. de convocatoria", fin_cab)
    if fin_cab < 0 or ini < 0:
        return None
    pie = _pie(ls, ini)
    # En el reporte de presentación, la línea anterior al pie es la fecha y hora de generación: no es una fila.
    if pie > ini + 1 and re.match(r"^\d{2}/\d{2}/\d{4} \d{1,2}[.:]\d{2}", ls[pie - 1]):
        pie -= 1
    return _cabecera(ls[1:fin_cab]), ls[ini + 1: pie], _generado(ls)


# ── Presentación de ofertas ──
def _items_presentacion(c: list[str]) -> tuple[list[dict], int]:
    """El primer ítem de cada hoja trae su encabezado completo («Nro. ítem», «Descripción del ítem», la descripción, el
    número y los títulos de las columnas). Los siguientes vienen compactos: descripción, número y «RUC / Código». Un ítem
    sin ofertas trae «No presentaron propuesta al ítem» y tres guiones."""
    items: list[dict] = []
    sobrante = 0

    def abrir(previo: list[str]) -> dict:
        numero = int(previo[-1]) if previo and _ENTERO.match(previo[-1]) else None
        igual = next((x for x in items if x["item"] == numero and numero is not None), None)
        if igual is not None:                     # el mismo ítem, que sigue en otra hoja
            return igual
        nuevo = {"item": numero, "descripcion": " ".join(previo[:-1] if numero is not None else previo) or None, "ofertas": []}
        items.append(nuevo)
        return nuevo

    actual: dict | None = None
    pendiente: list[str] = []                     # líneas aún sin dueño: el nombre de un postor o la descripción de un ítem
    i = 0
    while i < len(c):
        x = c[i]
        rotulo = _plano(x).rstrip(" :")
        if rotulo == "NRO. ITEM":
            sobrante += len(pendiente)
            pendiente, i = [], i + 1
        elif rotulo == "DESCRIPCION DEL ITEM":
            f = _indice(c, "Fecha Presentación", i + 1)
            h = _indice(c, "Hora Presentación", i + 1)
            if f < 0 or h < f:
                sobrante += len(c) - i
                break
            sobrante += len(pendiente)
            actual, pendiente, i = abrir(c[i + 1: f]), [], h + 1
        elif rotulo == "RUC / CODIGO":
            if pendiente and _ENTERO.match(pendiente[-1]):
                actual = abrir(pendiente)
            else:
                sobrante += len(pendiente)
            pendiente, i = [], i + 1
        elif rotulo in _ROTULOS["reporte_presentacion"]:
            i += 1
        elif actual is not None and pendiente and _CODIGO.match(x) and i + 3 < len(c) and _fecha(c[i + 1]) and _HORA.match(c[i + 3]):
            actual["ofertas"].append({"ruc": x, "nombre": " ".join(pendiente), "fecha": _fecha(c[i + 1]), "forma": c[i + 2],
                                      "hora": c[i + 3]})
            pendiente, i = [], i + 4
        elif actual is not None and not pendiente and _plano(x).startswith("NO ") and c[i + 1: i + 4] == ["-", "-", "-"]:
            actual["sin_ofertas"] = True
            i += 4
        else:
            pendiente.append(x)
            i += 1
    return items, sobrante + len(pendiente)


# ── Evaluación técnica ──
def _items_evaluacion(c: list[str]) -> tuple[list[dict], int]:
    items, i, sobrante = [], 0, 0
    while i < len(c):
        a = _indice(c, "Descripción del Item", i)
        b = _indice(c, "Postor", a)
        if a < 0 or b < 0:
            sobrante += len(c) - i
            break
        e = _indice(c, "Estado de", a, b)
        previo = c[a + 1: e if e >= 0 else b]
        numero = int(previo[0]) if previo and _ENTERO.match(previo[0]) else None
        item = {"item": numero, "descripcion": " ".join(previo[1:] if numero is not None else previo) or None, "postores": []}
        siguiente = _indice(c, "Nro. Item", b + 1)
        fin = siguiente if siguiente >= 0 else len(c)
        nombre: list[str] = []
        j = b + 1
        while j < fin:
            adm = _ADMISION.get(c[j].lower())
            cal = c[j + 2].lower() if j + 2 < fin else None
            if adm is not None and cal in _CALIFICACION and (c[j + 1] == "-" or _num(c[j + 1]) is not None):
                registro = nombre.pop() if nombre and _REGISTRO.match(nombre[-1]) else None
                # A veces el registro queda pegado al final del nombre, en la misma línea («… S.A.C. Valido»).
                if registro is None and nombre and (pegado := _REGISTRO_PEGADO.search(nombre[-1])):
                    registro, nombre[-1] = pegado.group(1), nombre[-1][: pegado.start()].strip()
                if nombre:
                    item["postores"].append({"nombre": " ".join(nombre), "registro": registro, "admitida": adm,
                                             "puntaje_tecnico": _num(c[j + 1]), "calificada": _CALIFICACION[cal]})
                else:
                    sobrante += 3
                nombre, j = [], j + 3
            elif _es_rotulo("reporte_evaluacion", c[j]):
                j += 1
            else:
                nombre.append(c[j])
                j += 1
        # Un ítem al que nadie postuló trae una sola línea que lo dice («No existen postores…»): no es una fila.
        if not item["postores"] and len(nombre) <= 2 and nombre and _plano(nombre[0]).startswith("NO "):
            item["sin_postores"] = True
            nombre = []
        sobrante += len(nombre)
        items.append(item)
        i = fin
    return items, sobrante


# ── Otorgamiento de la buena pro ──
_ETIQUETAS_ITEM = ("Valor Referencial", "Cantidad Desierta", "Unidad de Medida", "Cantidad Solicitada", "Descripción del",
                   "Nro. Item", "Monto Adjudicado")


def _resultado(texto: str) -> str:
    t = _plano(texto)
    for inicio, clave in (("ADJUDICADO", "adjudicado"), ("DESIERTO", "desierto"), ("MONTO MAYOR", "monto_mayor"),
                          ("CANCELADO", "cancelado"), ("NULO", "nulo")):
        if t.startswith(inicio):
            return clave
    return "otro"


def _items_otorgamiento(c: list[str]) -> tuple[list[dict], int]:
    marcas = [i for i in range(len(c)) if _plano(c[i]) == "RESULTADO"]
    # El valor del resultado («Adjudicado», «Desierto», «Monto mayor al valor…») va ANTES de su etiqueta: son las líneas
    # de texto que quedan tras el último número (o la última etiqueta) del ítem anterior.
    inicios = []
    for r in marcas:
        k = r
        while k > 0 and r - k < 3 and _num(c[k - 1]) is None and not _FILA_RUC.match(c[k - 1]) \
                and _plano(c[k - 1]).rstrip(" :") != "MONTO ADJUDICADO":
            k -= 1
        inicios.append(k)
    items, sobrante = [], inicios[0] if inicios else len(c)
    for n, (k, r) in enumerate(zip(inicios, marcas)):
        fin = inicios[n + 1] if n + 1 < len(inicios) else len(c)
        pos, desde = [], r + 1
        for etiqueta in _ETIQUETAS_ITEM:
            p = _indice(c, etiqueta, desde, fin)
            if p < 0:
                break
            pos.append(p)
            desde = p + 1
        if len(pos) < len(_ETIQUETAS_ITEM):
            sobrante += fin - k
            continue
        v_ref, c_des, u_med, c_sol, d_del, n_item, m_adj = pos
        antes = c[r + 1: v_ref]
        monto = next((m for x in antes if (m := _MONTO.match(x))), None)
        item = {
            "item": next((int(x) for x in c[d_del + 1: n_item] if _ENTERO.match(x)), None),
            "descripcion": " ".join(c[c_sol + 1: d_del]) or None,
            "resultado": _resultado(" ".join(c[k:r])),
            "resultado_texto": " ".join(c[k:r]) or None,
            "valor_referencial": _num(monto.group(2)) if monto else None,
            "moneda": _MONEDA.get(monto.group(1), "PEN") if monto else None,
            "unidad": " ".join(c[c_des + 1: u_med]) or None,
            "cantidad_solicitada": next((_num(x) for x in c[u_med + 1: c_sol] if _num(x) is not None), None),
            "cantidad_desierta": next((_num(x) for x in antes if _num(x) is not None), None),
            "adjudicados": [],
        }
        # Las filas: «RUC-NOMBRE» (el nombre puede seguir en la línea de abajo) y, al cierre, cantidad y monto. En un
        # consorcio, la primera entrada es el consorcio y las siguientes sus integrantes.
        entradas: list[dict] = []
        numeros: list[float] = []
        for x in c[m_adj + 1: fin]:
            m = _FILA_RUC.match(x)
            if _es_rotulo("reporte_otorgamiento", x):
                continue
            if m:
                sobrante += len(numeros)          # números sueltos antes de una fila nueva: no calzan
                numeros = []
                entradas.append({"ruc": m.group(1), "nombre": m.group(2).strip()})
            elif _num(x) is not None and entradas:
                numeros.append(_num(x))
                if len(numeros) == 2:
                    item["adjudicados"].append({**entradas[0], "integrantes": entradas[1:], "cantidad": numeros[0],
                                                "monto": numeros[1]})
                    entradas, numeros = [], []
            elif entradas and not numeros:
                entradas[-1]["nombre"] = (entradas[-1]["nombre"] + " " + x).strip()
            else:
                sobrante += 1
        sobrante += len(entradas) + len(numeros)
        items.append(item)
    return items, sobrante


_CUERPOS = {"reporte_presentacion": (_items_presentacion, "ofertas"), "reporte_evaluacion": (_items_evaluacion, "postores"),
            "reporte_otorgamiento": (_items_otorgamiento, "adjudicados")}


# ── Desempate (su cabecera es distinta: etiqueta y valor en otro orden) ──
def desempate(texto: str) -> dict | None:
    ls = _lineas(texto)
    ini = _indice(ls, "Listado del Resultado del Desempate")
    datos = _indice(ls, "Datos del Item y sorteo")
    if ini < 0 or datos < 0:
        return None
    pie = _pie(ls, ini)
    postores, sobrante = [], 0
    # Las filas empiezan después de los títulos de las columnas (el último es «discapacitados»). Cada una: código, nombre
    # (una o más líneas), hasta tres números (orden de prelación, puntaje total, puntaje técnico: el que quedó fuera del
    # orden trae sólo el técnico) y dos «SI/NO».
    j = max(_indice(ls, "discapacitados", ini, pie), ini) + 1
    while j < pie:
        if not _CODIGO.match(ls[j]):
            sobrante += 1
            j += 1
            continue
        ruc, j = ls[j], j + 1
        nombre: list[str] = []
        while j < pie and _num(ls[j]) is None and _plano(ls[j]) not in _SI_NO:
            nombre.append(ls[j])
            j += 1
        numeros: list[str] = []
        while j < pie and len(numeros) < 3 and _num(ls[j]) is not None and not _CODIGO.match(ls[j]):
            numeros.append(ls[j])
            j += 1
        if nombre and j + 1 < pie and _plano(ls[j]) in _SI_NO and _plano(ls[j + 1]) in _SI_NO:
            tecnico = _num(numeros.pop()) if numeros else None
            orden = int(numeros.pop(0)) if numeros and _ENTERO.match(numeros[0]) else None
            postores.append({"ruc": ruc, "nombre": " ".join(nombre), "orden": orden,
                             "puntaje_total": _num(numeros[0]) if numeros else None, "puntaje_tecnico": tecnico,
                             "mype": _SI_NO[_plano(ls[j])], "discapacitados": _SI_NO[_plano(ls[j + 1])]})
            j += 2
        else:
            sobrante += 1 + len(nombre) + len(numeros)
    if not postores:
        return None
    return {"plantilla": "reporte_desempate", "entidad": None, "nro_convocatoria": None,
            "nomenclatura": next((x for x in ls[:datos] if _NOMENCLATURA.match(_plano(x))), None),
            "objeto": None, "descripcion": None, "generado": _generado(ls),
            "items": [{"item": next((int(x) for x in ls[datos + 1: datos + 3] if _ENTERO.match(x)), None),
                       "fecha": next((f for x in ls[datos + 1: ini] if (f := _fecha(x))), None), "postores": postores}],
            "sobrante": sobrante}


# ── Acta de no formulación de consultas ──
def no_formulacion(texto: str) -> dict | None:
    ls = _lineas(texto)
    if "NO SE REGISTRARON" not in _plano(texto):
        return None
    return {"plantilla": "acta_no_formulacion", "entidad": None,
            "nro_convocatoria": next((int(ls[i + 1]) for i, x in enumerate(ls[:-1])
                                      if _plano(x).startswith("NRO. DE CONVOCATORIA") and _ENTERO.match(ls[i + 1])), None),
            "nomenclatura": next((x for x in ls if _NOMENCLATURA.match(_plano(x))), None),
            "objeto": None, "descripcion": None, "generado": _generado(ls), "items": [], "sobrante": 0}


def leer_paginas(textos: list[str]) -> list[dict]:
    """Los reportes de un documento, uno por plantilla y nomenclatura, con `paginas` (cuáles se leyeron, desde 1),
    `paginas_sin_leer` (tenían el título pero no la forma) y `sobrante` (líneas que no calzaron con la plantilla)."""
    grupos: dict[tuple, dict] = {}
    sin_leer: dict[str, int] = {}
    anterior: tuple | None = None                 # el reporte de la página anterior, si era uno de los tres con cuerpo
    for n, t in enumerate(textos):
        clave = detectar(t)
        if not clave:
            # La hoja siguiente de un reporte largo repite la cabecera pero NO el título: es su continuación si viene
            # justo después y trae la misma nomenclatura.
            partes = _partir(t) if anterior else None
            if partes and _plano(partes[0].get("nomenclatura") or "") == anterior[1] and anterior[1]:
                grupos[anterior]["paginas"].append(n + 1)
                grupos[anterior]["_cuerpo"].extend(partes[1])
            else:
                anterior = None
            continue
        anterior = None
        if clave in _CUERPOS:
            partes = _partir(t)
            if partes is None:
                sin_leer[clave] = sin_leer.get(clave, 0) + 1
                continue
            cab, cuerpo, generado = partes
            llave = (clave, _plano(cab.get("nomenclatura") or ""))
            g = grupos.setdefault(llave, {"plantilla": clave, **cab, "generado": generado, "paginas": [], "_cuerpo": []})
            g["paginas"].append(n + 1)
            g["_cuerpo"].extend(cuerpo)
            g["generado"] = g["generado"] or generado
            anterior = llave
            continue
        d = desempate(t) if clave == "reporte_desempate" else no_formulacion(t)
        if d is None:
            sin_leer[clave] = sin_leer.get(clave, 0) + 1
            continue
        llave = (clave, _plano(d.get("nomenclatura") or ""))
        if llave in grupos:
            grupos[llave]["paginas"].append(n + 1)
            grupos[llave]["items"].extend(d["items"])
            grupos[llave]["sobrante"] += d["sobrante"]
        else:
            grupos[llave] = {**d, "paginas": [n + 1]}
    salida = []
    for (clave, _), g in grupos.items():
        if "_cuerpo" in g:
            leer, campo = _CUERPOS[clave]
            items, sobrante = leer(g.pop("_cuerpo"))
            # El mismo ítem repetido (dos copias del reporte en el mismo ZIP): una sola vez, con sus filas sin repetir.
            unicos: list[dict] = []
            for it in items:
                igual = next((u for u in unicos if u["item"] == it["item"] and it["item"] is not None), None)
                if igual is None:
                    unicos.append(it)
                else:
                    igual[campo].extend(f for f in it[campo] if f not in igual[campo])
            g.update(items=unicos, sobrante=sobrante)
        g["items"].sort(key=lambda x: (x["item"] is None, x["item"] or 0))
        g["paginas_sin_leer"] = sin_leer.get(clave, 0)
        salida.append(g)
    return salida


def leer_pagina(texto: str) -> dict | None:
    """El reporte de una sola página, o None si no es uno o no se pudo leer."""
    r = leer_paginas([texto])
    return r[0] if r else None
