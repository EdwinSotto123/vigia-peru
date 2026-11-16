#!/usr/bin/env python3
"""Las «Fichas Resumen» de los informes de control de la Contraloría: bajarlas, leerlas y armar su buscador.

Cada informe de `informes_control` (migración 90) trae en `url_resumen` su Ficha Resumen (SPIC, TIPOARCHIVO=RE): un PDF
de texto de ~3 páginas con el número, el título, el objetivo, la entidad auditada, los montos auditado y examinado, el
ubigeo, la fecha de emisión, la unidad que lo emite, el tipo de servicio de control y los resultados (observaciones,
recomendaciones y los funcionarios comprendidos). El informe completo (`url_pdf`) es un escaneo de 50 a 150 MB: no se baja.

  lista    --entorno prod --salida lista.json      los informes con su ficha por bajar (de 2023 en adelante primero)
  bajar    --lista lista.json --carpeta DIR        baja las fichas a DIR (1 pedido por segundo como máximo, reanudable)
  medir    --carpeta DIR [--muestra 30]            prueba el lector del formulario en una muestra de años distintos
  cargar   --entorno prod --carpeta DIR            texto + campos del formulario → informe_control_ficha (migración 304)
  leer     --entorno prod [--tope-usd 40]          tema, perjuicio, normas y referencias de cada observación (GLM 5.3 flash)
  indexar  --entorno prod                          trozos (objetivo y observaciones) y embeddings → informe_control_fragmento (305)
  estado   --entorno prod

El servidor de la Contraloría (apps8.contraloria.gob.pe) sólo responde a IPs del Perú: `bajar` corre desde una PC en el
Perú. Los PDF son datos de afuera: corre este script con `python -P` (no agrega su carpeta ni la actual a sys.path), en
una carpeta propia para las descargas. `bajar` se detiene si el servidor deja de dar PDF (403, 429, una página HTML):
no se salta ningún bloqueo.

PRIVACIDAD: la ficha nombra a los funcionarios comprendidos, con su DNI. El texto se guarda tal cual en la base (lo lee
el que carga a los implicados), pero `campos` no lleva ni nombres ni DNI, y nada de esto se imprime. Lo que publica la
API pasa por publicar() (backend/api/src/lib/privacidad.ts). La responsabilidad que señala la Contraloría es PRESUNTA.

Sólo modelos abiertos: la lectura va a Workers AI (GLM 5.3 flash) por vigia-llm con `x-vigia-respaldo: nunca`, y los
embeddings son los de bge-m3 (1 024), los mismos de norma_fragmento y rag_fragmento.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import re
import sys
import threading
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
UA = "vigia-rag/1.0 (informes publicos de control)"
HOST = "apps8.contraloria.gob.pe"
PAUSA_MIN_S = 1.0                    # 1 pedido por segundo como máximo
VERSION_PARSER = "ficha-1"


def _conexion(entorno: str):
    sys.path.insert(0, str(RAIZ / "infrastructure" / "aws"))
    from tunel_rds import conexion
    return conexion(entorno)


def _ahora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ─── lista ──────────────────────────────────────────────────────────────────────────────────────

def lista(entorno: str, salida: Path) -> None:
    with _conexion(entorno) as cn:
        cn.set_session(readonly=True, autocommit=True)
        cu = cn.cursor()
        cu.execute("""SELECT codigo, url_resumen, fecha_emision::text, numero FROM informes_control
                       WHERE url_resumen LIKE 'https://apps8.contraloria.gob.pe/%%'
                       ORDER BY (fecha_emision >= DATE '2023-01-01') DESC NULLS LAST, fecha_emision DESC NULLS LAST, codigo""")
        filas = [{"codigo": c, "url": u, "fecha": f, "numero": n} for c, u, f, n in cu.fetchall()]
    salida.write_text(json.dumps(filas, ensure_ascii=False), encoding="utf-8")
    print(f"{len(filas)} informes con ficha → {salida}")


# ─── bajar ──────────────────────────────────────────────────────────────────────────────────────

def _registro_de(carpeta: Path) -> Path:
    return carpeta.parent / f"{carpeta.name}_bajadas.jsonl"


def _leer_registro(reg: Path) -> dict[str, dict]:
    hechos: dict[str, dict] = {}
    if reg.exists():
        for linea in reg.read_text(encoding="utf-8").splitlines():
            try:
                d = json.loads(linea)
                hechos[d["codigo"]] = d
            except (ValueError, KeyError):
                continue
    return hechos


def bajar(lista_json: Path, carpeta: Path, limite: int | None, reintentar: bool) -> int:
    import requests

    carpeta.mkdir(parents=True, exist_ok=True)
    reg = _registro_de(carpeta)
    hechos = _leer_registro(reg)
    pendientes = []
    for x in json.loads(lista_json.read_text(encoding="utf-8")):
        c = x["codigo"]
        if not re.fullmatch(r"[0-9A-Z]{6,24}", c or "") or not str(x.get("url", "")).startswith(f"https://{HOST}/"):
            continue
        ya = hechos.get(c)
        if (carpeta / f"{c}.pdf").exists() and ya and ya.get("estado") == "ok":
            continue
        # Un 404 o un archivo vacío no cambia por volver a pedirlo: sólo con --reintentar.
        if ya and ya.get("estado") in ("no_existe", "vacio") and not reintentar:
            continue
        pendientes.append(x)
    if limite:
        pendientes = pendientes[:limite]
    print(f"{len(pendientes)} fichas por bajar ({len(hechos)} ya en el registro) → {carpeta}", flush=True)

    s = requests.Session()
    s.headers.update({"User-Agent": UA, "Accept": "application/pdf"})
    ultimo_pedido = 0.0
    seguidos_bloqueo = 0
    ok = fallas = 0
    t0 = time.time()
    with reg.open("a", encoding="utf-8") as freg:
        for k, x in enumerate(pendientes, 1):
            c = x["codigo"]
            espera = PAUSA_MIN_S - (time.time() - ultimo_pedido)
            if espera > 0:
                time.sleep(espera)
            ultimo_pedido = time.time()
            fila = {"codigo": c, "at": _ahora()}
            try:
                r = s.get(x["url"], timeout=90)
                cuerpo = r.content
                fila.update(http=r.status_code, ms=int(r.elapsed.total_seconds() * 1000), bytes=len(cuerpo))
                if r.status_code == 200 and cuerpo[:5] == b"%PDF-":
                    tmp = carpeta / f"{c}.pdf.part"
                    tmp.write_bytes(cuerpo)
                    os.replace(tmp, carpeta / f"{c}.pdf")
                    fila.update(estado="ok", sha256=hashlib.sha256(cuerpo).hexdigest())
                    ok += 1
                    seguidos_bloqueo = 0
                elif r.status_code == 404:
                    fila.update(estado="no_existe")
                elif r.status_code == 200 and len(cuerpo) == 0:
                    fila.update(estado="vacio")
                elif r.status_code in (403, 429) or (r.status_code == 200 and b"<html" in cuerpo[:2000].lower()):
                    fila.update(estado="bloqueo", tipo=r.headers.get("content-type", "")[:60])
                    seguidos_bloqueo += 1
                else:
                    fila.update(estado="error", tipo=r.headers.get("content-type", "")[:60])
                    seguidos_bloqueo += 1 if r.status_code >= 500 else 0
            except Exception as e:  # noqa: BLE001 — red: se anota y se sigue
                fila.update(estado="error", error=f"{type(e).__name__}: {str(e)[:160]}")
                seguidos_bloqueo += 1
            if fila["estado"] != "ok":
                fallas += 1
            freg.write(json.dumps(fila, ensure_ascii=False) + "\n")
            freg.flush()
            if seguidos_bloqueo >= 3:
                # El servidor dejó de dar PDF: se espera (1, 2, 4… minutos) y, si sigue, se detiene. No se salta nada.
                if seguidos_bloqueo >= 8:
                    print(f"  {seguidos_bloqueo} respuestas seguidas sin PDF: me detengo (retomar más tarde con el mismo comando)", flush=True)
                    return 2
                pausa = 60 * 2 ** (seguidos_bloqueo - 3)
                print(f"  {seguidos_bloqueo} respuestas seguidas sin PDF ({fila.get('http')} {fila.get('error', '')}): pausa de {pausa} s", flush=True)
                time.sleep(pausa)
            if k % 100 == 0 or k == len(pendientes):
                v = k / max(1e-6, time.time() - t0)
                print(f"  {k}/{len(pendientes)}: {ok} ok, {fallas} sin ficha · {v:.2f}/s · faltan ~{(len(pendientes) - k) / max(v, 1e-6) / 60:.0f} min",
                      flush=True)
    print(f"listo: {ok} bajadas, {fallas} sin ficha", flush=True)
    return 0


# ─── El formulario ──────────────────────────────────────────────────────────────────────────────
# La ficha es un formulario fijo del SPIC (el mismo de 2015 a 2026), en tres partes:
#   I.   Información general: rótulo a la izquierda y valor a su derecha o debajo, en el mismo renglón de la tabla.
#   II.  Tipo de servicio de control posterior: cinco renglones; el elegido lleva una «X».
#   III. Resultados: 1 Observaciones (en un servicio de control específico, «Argumentos de Hecho (irregularidades
#        advertidas)»), 2 Recomendaciones y 3 Funcionarios comprendidos (DNI, nombre y tipo de responsabilidad, que no se
#        leen aquí: no van a `campos`).
# Se lee por bloques de texto (PyMuPDF), ordenados por página, renglón y columna.

ROTULOS_I = [
    ("numero", r"N\s*[°º.o]?\s*de\s+informe"),
    ("titulo", r"T[íi]tulo\s+del\s+informe"),
    ("objetivo", r"Objetivo\s+(?:de\s+la\s+auditor[íi]a|general|del\s+servicio(?:\s+de\s+control)?|de\s+la\s+acci[óo]n)"),
    ("entidad", r"Entidad\s+(?:auditada|sujeta\s+a\s+control|examinada)"),
    ("monto_auditado", r"Monto\s+auditado"),
    ("monto_examinado", r"Monto\s+examinado"),
    ("monto_objeto", r"Monto\s+objeto\s+del\s+servicio(?:\s*\(\s*de\s+corresponder\s*\))?"),
    ("ubigeo", r"Ubigeo"),
    ("region", r"Regi[óo]n"),
    ("provincia", r"Provincia"),
    ("distrito", r"Distrito"),
    ("fecha_emision", r"Fecha\s+de\s+emisi[óo]n\s+del?\s+informe"),
    ("unidad_emisora", r"Unidad\s+org[áa]nica\s+que\s+emite\s+el\s+informe"),
]
_ROTULO_I = re.compile("|".join(f"(?P<{k}>(?<![\\w])(?:{r})\\s*:)" for k, r in ROTULOS_I), re.I)
_SECCION_II = re.compile(r"(?m)^[ \t]*II\.\s*Tipo\s+de\s+servicio[^\n]*\n", re.I)
_SECCION_III = re.compile(r"(?m)^[ \t]*III\.\s*Resultados[^\n]*\n", re.I)
# La sección de las personas: desde aquí nada va a `campos`.
_FUNCIONARIOS = re.compile(r"(?m)^[ \t]*(?:\d[ \t]*\n[ \t]*)?(?:Funcionarios\s+comprendidos|Relaci[óo]n\s+de\s+(?:funcionarios|personas)\s+comprendid"
                           r"|Personas\s+comprendidas|Nombres\s+y\s+apellidos|Apellidos\s+y\s+nombres)", re.I)
# Los apartados de III, con su número delante («1\nObservaciones:»).
_APARTADOS = [
    ("observaciones", r"Observaciones"),
    ("observaciones", r"Argumentos\s+de\s+[Hh]echo(?:\s*\([^)\n]*\))?"),
    ("observaciones", r"Hechos\s+con\s+evidencia[^:\n]*"),
    ("recomendaciones", r"Recomendaciones"),
    ("conclusiones", r"Conclusiones"),
    ("deficiencias_control_interno", r"Deficiencias\s+de\s+control\s+interno"),
]
_APARTADO = re.compile(r"(?m)^[ \t]*(?:\d[ \t]*\n[ \t]*)?(?P<rotulo>" + "|".join(f"(?:{r})" for _, r in _APARTADOS) + r")[ \t]*[:.]?[ \t]*\n")
TIPOS_SERVICIO = [
    ("auditoria_cumplimiento", r"Auditor[íi]a\s+de\s+Cumplimiento"),
    ("auditoria_financiera", r"Auditor[íi]a\s+Financiera"),
    ("auditoria_desempeno", r"Auditor[íi]a\s+de\s+Desempe[ñn]o"),
    ("control_especifico", r"Servicio\s+de\s+Control\s+Espec[íi]fico"),
    ("accion_oficio_posterior", r"Acci[óo]n\s+de\s+Oficio"),
]
# El comienzo de un ítem numerado: «1.», «1.-», «1 -», «2-», «1)» al comienzo del renglón (nunca «2.130,00»).
_ITEM = re.compile(r"(?m)^[ \t]*(\d{1,2})[ \t]*(?:\.[ \t]*-|\.(?!\d)|-(?!\d)|\))")
# El formato viejo de las recomendaciones: «10 - 10. Disponer…» (y el primero a veces sólo «1 - Remitir…»), en orden de
# texto (1, 10, 2…).
_ITEM_DOBLE = re.compile(r"(?m)^[ \t]*(\d{1,2})[ \t]*-[ \t]*(?:(\d{1,2})[ \t]*\.(?!\d))?")
_DESTINATARIO = re.compile(r"^(?:\d+\.\s*)?(?:Al?|A\s+la|A\s+las|A\s+los)\s+[^\n]{3,160}:$", re.I)
# «Al Órgano Instructor: Realizar…»: el destinatario al comienzo del mismo ítem.
_DESTINATARIO_EN_LINEA = re.compile(r"^((?:Al?|A\s+la|A\s+las|A\s+los)\s+[^:]{3,140}):\s+(?=\S)", re.I)


def _limpio(s: str) -> str:
    return " ".join((s or "").split())


def _sin_nulos(v):
    """Lo mismo sin el carácter nulo en ningún texto (Postgres no lo guarda en text ni en jsonb)."""
    if isinstance(v, str):
        return v.replace("\x00", "")
    if isinstance(v, list):
        return [_sin_nulos(x) for x in v]
    if isinstance(v, dict):
        return {k: _sin_nulos(x) for k, x in v.items()}
    return v


def _bloques(doc) -> list[tuple[int, float, float, str]]:
    """Los bloques de texto de todas las páginas, en orden de lectura: página, renglón (±3 pt) y columna."""
    out = []
    for i, p in enumerate(doc):
        bs = sorted((b for b in p.get_text("blocks") if b[6] == 0 and b[4].strip()), key=lambda b: (b[1], b[0]))
        filas: list[list] = []
        for b in bs:
            if filas and abs(b[1] - filas[-1][0][1]) <= 3:
                filas[-1].append(b)
            else:
                filas.append([b])
        for f in filas:
            out.extend((i, b[1], b[0], b[4] if b[4].endswith("\n") else b[4] + "\n") for b in sorted(f, key=lambda b: b[0]))
    return out


def _monto(s: str | None) -> tuple[float | None, str | None]:
    t = _limpio(s)
    if not t:
        return None, None
    moneda = "USD" if re.search(r"US\s*\$|USD|\bD[óo]lares", t, re.I) else ("PEN" if re.search(r"S\s*/|soles", t, re.I) else None)
    m = re.search(r"\d[\d.,´' ]*", t)
    if not m:
        return None, moneda
    num = re.sub(r"[´' ]", "", m.group(0)).rstrip(".,")
    if "," in num and "." in num:
        dec = "," if num.rfind(",") > num.rfind(".") else "."
        num = num.replace("." if dec == "," else ",", "").replace(",", ".")
    elif "," in num:
        num = num.replace(",", ".") if re.search(r",\d{1,2}$", num) else num.replace(",", "")
    elif num.count(".") > 1 or re.search(r"\.\d{3}$", num):
        num = num.replace(".", "")
    try:
        return round(float(num), 2), moneda or "PEN"
    except ValueError:
        return None, moneda


def _fecha(s: str | None) -> str | None:
    m = re.search(r"(\d{1,2})/(\d{1,2})/(\d{4})", s or "")
    if not m:
        return None
    try:
        return datetime(int(m[3]), int(m[2]), int(m[1])).date().isoformat()
    except ValueError:
        return None


def _items(s: str, doble: bool = False) -> tuple[str, list[dict]]:
    """El texto antes del primer ítem y los ítems [{n, texto}]. Los números van seguidos (1, 2, 3…): un «2.» que no toca
    es parte del texto. Con `doble` (recomendaciones viejas, «10 - 10.»), cualquier orden, y se ordenan por número."""
    elegidas: list[tuple[int, int, int]] = []        # (n, inicio, fin de la marca)
    if doble and any(m.group(2) and m.group(1) == m.group(2) for m in _ITEM_DOBLE.finditer(s)):
        vistos: set[int] = set()
        for m in _ITEM_DOBLE.finditer(s):
            n = int(m.group(1))
            if (m.group(2) is None or m.group(2) == m.group(1)) and n not in vistos:
                vistos.add(n)
                elegidas.append((n, m.start(), m.end()))
        # Sólo si los números quedan 1..N sin huecos; si no, el orden seguido de siempre.
        if sorted(vistos) != list(range(1, len(vistos) + 1)):
            elegidas = []
    if not elegidas:
        esperado = 1
        for m in _ITEM.finditer(s):
            if int(m.group(1)) == esperado:
                elegidas.append((esperado, m.start(), m.end()))
                esperado += 1
    if not elegidas:
        t = s.strip()
        return "", ([{"n": 1, "texto": t}] if _limpio(t) else [])
    items = []
    for k, (n, ini, fin) in enumerate(elegidas):
        hasta = elegidas[k + 1][1] if k + 1 < len(elegidas) else len(s)
        items.append({"n": n, "texto": s[fin:hasta].strip()})
    return s[:elegidas[0][1]].strip(), sorted(items, key=lambda x: x["n"])


def _con_destinatarios(previo: str, items: list[dict]) -> list[dict]:
    """Las recomendaciones van agrupadas por destinatario («Al titular de la entidad:»), un renglón antes de su primer
    ítem: ese renglón sale del texto del ítem anterior (o del texto previo) y queda como `destinatario`."""
    actual = None
    lineas_previo = [x.strip() for x in previo.splitlines() if x.strip()]
    if lineas_previo and _DESTINATARIO.match(_limpio(lineas_previo[-1])):
        actual = _limpio(lineas_previo[-1]).rstrip(":")
    out = []
    for it in items:
        lineas = [x for x in it["texto"].splitlines()]
        siguiente = None
        while lineas and not lineas[-1].strip():
            lineas.pop()
        if lineas and _DESTINATARIO.match(_limpio(lineas[-1])):
            siguiente = _limpio(lineas.pop()).rstrip(":")
        d = {"n": it["n"], "texto": _limpio("\n".join(lineas))}
        m = _DESTINATARIO_EN_LINEA.match(d["texto"])
        if m:
            actual = _limpio(m.group(1))
            d["texto"] = d["texto"][m.end():]
        if actual:
            d["destinatario"] = actual
        out.append(d)
        if siguiente:
            actual = siguiente
    return out


def parsear(datos: bytes) -> dict:
    """PDF de la ficha → {texto, paginas, campos}. `texto` es el texto entero (con las personas: no se publica tal cual);
    `campos` sólo lleva lo del formulario hasta la sección de funcionarios, sin nombres ni DNI."""
    import fitz  # PyMuPDF

    with fitz.open(stream=datos, filetype="pdf") as doc:
        paginas = doc.page_count
        texto = "\f".join(p.get_text("text") for p in doc)
        lin = "".join(t for *_x, t in _bloques(doc))
    campos: dict = {"version": VERSION_PARSER}
    avisos: list[str] = []
    s2, s3 = _SECCION_II.search(lin), _SECCION_III.search(lin)
    corte = _FUNCIONARIOS.search(lin, s3.end() if s3 else 0)
    fin_iii = corte.start() if corte else len(lin)
    if not corte:
        avisos.append("sin_seccion_funcionarios")
    sec_i = lin[: s2.start() if s2 else (s3.start() if s3 else fin_iii)]
    sec_ii = lin[s2.end(): s3.start()] if s2 and s3 else ""
    sec_iii = lin[s3.end(): fin_iii] if s3 else ""
    if not s2:
        avisos.append("sin_seccion_ii")
    if not s3:
        avisos.append("sin_seccion_iii")

    # I. Información general.
    rotulos = list(_ROTULO_I.finditer(sec_i))
    valores: dict[str, str] = {}
    for k, m in enumerate(rotulos):
        clave = m.lastgroup
        hasta = rotulos[k + 1].start() if k + 1 < len(rotulos) else len(sec_i)
        v = _limpio(sec_i[m.end():hasta])
        if clave and v and clave not in valores:
            valores[clave] = v
    for k in ("numero", "titulo", "objetivo", "entidad", "unidad_emisora"):
        if valores.get(k):
            campos[k] = valores[k]
    for k in ("monto_auditado", "monto_examinado", "monto_objeto"):
        if k in valores:
            monto, moneda = _monto(valores[k])
            campos[k] = monto
            if moneda and moneda != "PEN":
                campos[f"{k}_moneda"] = moneda
    ubi = {k: valores[k] for k in ("region", "provincia", "distrito") if valores.get(k)}
    if ubi:
        campos["ubigeo"] = ubi
    if valores.get("fecha_emision"):
        campos["fecha_emision"] = _fecha(valores["fecha_emision"])

    # II. Tipo de servicio: el renglón con la «X».
    actual = None
    marcados = []
    for linea in sec_ii.splitlines():
        l = linea.strip()
        if not l:
            continue
        if l.upper() == "X":
            if actual:
                marcados.append(actual)
            continue
        for codigo, r in TIPOS_SERVICIO:
            if re.match(r, l, re.I):
                actual = (codigo, _limpio(re.sub(r"\s+X$", "", l)))
                if re.search(r"\sX$", l):
                    marcados.append(actual)
                break
    if len(marcados) == 1:
        campos["tipo_servicio"], campos["tipo_servicio_texto"] = marcados[0]
    elif marcados:
        campos["tipo_servicio"] = marcados[0][0]
        campos["tipo_servicio_texto"] = marcados[0][1]
        avisos.append("tipo_servicio_varios")
    else:
        avisos.append("sin_tipo_servicio")

    # III. Resultados: observaciones, recomendaciones y lo que aparezca.
    aps = list(_APARTADO.finditer(sec_iii))
    vistos: set[str] = set()
    for k, m in enumerate(aps):
        rot = _limpio(m.group("rotulo"))
        clave = next(c for c, r in _APARTADOS if re.fullmatch(r, rot))
        cuerpo = sec_iii[m.end(): aps[k + 1].start() if k + 1 < len(aps) else len(sec_iii)]
        if clave in vistos:
            avisos.append(f"apartado_repetido:{clave}")
            continue
        vistos.add(clave)
        if clave == "observaciones":
            previo, items = _items(cuerpo)
            campos["observaciones_rotulo"] = rot
            campos["observaciones"] = [{"n": it["n"], "texto": _limpio(it["texto"])} for it in items]
            if _limpio(previo):
                campos["observaciones_previo"] = _limpio(previo)
        elif clave == "recomendaciones":
            previo, items = _items(cuerpo, doble=True)
            campos["recomendaciones"] = _con_destinatarios(previo, items)
        else:
            previo, items = _items(cuerpo)
            campos[clave] = [{"n": it["n"], "texto": _limpio(it["texto"])} for it in items]
    antes = _limpio(sec_iii[: aps[0].start()]) if aps else _limpio(sec_iii)
    if antes:
        campos["resultados_sin_rotulo"] = antes[:4000]
    if not campos.get("observaciones"):
        avisos.append("sin_observaciones")
    if avisos:
        campos["avisos"] = avisos
    campos["huella"] = huella_observaciones(campos)
    return {"texto": texto, "paginas": paginas, "campos": campos}


def _calidad(c: dict, ref: dict | None = None) -> list[str]:
    """Lo que le falta a una ficha leída para darla por bien leída (vacío = bien)."""
    malos = []
    for k in ("numero", "titulo", "objetivo", "entidad", "fecha_emision", "unidad_emisora", "tipo_servicio"):
        if not c.get(k):
            malos.append(f"falta:{k}")
    if c.get("monto_auditado") is None and c.get("monto_objeto") is None and c.get("monto_examinado") is None:
        malos.append("falta:monto")
    obs = c.get("observaciones") or []
    if not obs:
        malos.append("falta:observaciones")
    elif [o["n"] for o in obs] != list(range(1, len(obs) + 1)):
        malos.append("observaciones:numeracion")
    elif any(len(o["texto"]) < 25 for o in obs):
        malos.append("observaciones:texto_corto")
    if not c.get("recomendaciones"):
        malos.append("falta:recomendaciones")
    if ref:
        if ref.get("numero") and c.get("numero") and _limpio(ref["numero"]) != _limpio(c["numero"]):
            malos.append("numero_distinto")
        if ref.get("fecha") and c.get("fecha_emision") and ref["fecha"] != c["fecha_emision"]:
            malos.append("fecha_distinta")
    for a in c.get("avisos") or []:
        if a != "sin_seccion_funcionarios":
            malos.append(f"aviso:{a}")
    return malos


def medir(lista_json: Path, carpeta: Path, muestra: int | None, ver: bool) -> None:
    filas = json.loads(lista_json.read_text(encoding="utf-8"))
    if muestra:
        random.seed(304)
        filas = [x for x in filas if (carpeta / f"{x['codigo']}.pdf").exists()]
        filas = random.sample(filas, min(muestra, len(filas)))
    bien = 0
    problemas: dict[str, int] = {}
    n = 0
    for x in filas:
        f = carpeta / f"{x['codigo']}.pdf"
        if not f.exists():
            continue
        n += 1
        try:
            c = parsear(f.read_bytes())["campos"]
        except Exception as e:  # noqa: BLE001
            print(f"{x['codigo']}: ERROR {type(e).__name__}: {e}")
            continue
        malos = _calidad(c, x)
        bien += not malos
        for m in malos:
            problemas[m] = problemas.get(m, 0) + 1
        if ver or malos:
            print(f"{x['codigo']} {x.get('fecha')} {c.get('tipo_servicio')} obs={len(c.get('observaciones') or [])} "
                  f"rec={len(c.get('recomendaciones') or [])} {'OK' if not malos else 'MAL ' + ','.join(malos)}")
        if ver:
            print("   objetivo:", (c.get("objetivo") or "")[:140])
            print("   montos:", c.get("monto_auditado"), c.get("monto_examinado"), c.get("monto_objeto"), "| unidad:", (c.get("unidad_emisora") or "")[:60])
            for o in c.get("observaciones") or []:
                print(f"   obs {o['n']}: {re.sub(r'[0-9]{8}', '<8D>', o['texto'])[:160]}")
            for r in (c.get("recomendaciones") or [])[:3]:
                print(f"   rec {r['n']} [{(r.get('destinatario') or '')[:40]}]: {r['texto'][:90]}")
            if c.get("resultados_sin_rotulo"):
                print("   SIN RÓTULO:", c["resultados_sin_rotulo"][:120])
    print(f"\n{n} fichas: {bien} bien leídas ({bien / max(n, 1):.1%})")
    for k, v in sorted(problemas.items(), key=lambda kv: -kv[1]):
        print(f"  {v:6d}  {k}")


# ─── cargar ─────────────────────────────────────────────────────────────────────────────────────

def huella_observaciones(campos: dict) -> str:
    """md5 de las observaciones leídas: si cambian, la lectura de IA se rehace."""
    obs = [[o.get("n"), o.get("texto")] for o in (campos.get("observaciones") or [])]
    return hashlib.md5(json.dumps(obs, ensure_ascii=False).encode("utf-8")).hexdigest()


SQL_FICHA = """
  INSERT INTO informe_control_ficha AS f (codigo, texto, paginas, bytes, sha256, descargado_at, campos, actualizado_at)
  SELECT x.codigo, x.texto, x.paginas, x.bytes, x.sha256, x.descargado_at, x.campos, now()
    FROM jsonb_to_recordset(%s::jsonb) AS x (codigo TEXT, texto TEXT, paginas SMALLINT, bytes INT, sha256 TEXT,
                                             descargado_at TIMESTAMPTZ, campos JSONB)
   WHERE EXISTS (SELECT 1 FROM informes_control i WHERE i.codigo = x.codigo)
  ON CONFLICT (codigo) DO UPDATE
     SET texto = EXCLUDED.texto, paginas = EXCLUDED.paginas, bytes = EXCLUDED.bytes, sha256 = EXCLUDED.sha256,
         descargado_at = EXCLUDED.descargado_at, actualizado_at = now(),
         -- La lectura de IA se conserva si las observaciones son las mismas que leyó.
         campos = CASE WHEN f.campos -> 'ia' ->> 'huella' = EXCLUDED.campos ->> 'huella'
                       THEN EXCLUDED.campos || jsonb_build_object('ia', f.campos -> 'ia')
                       ELSE EXCLUDED.campos END
   WHERE (f.sha256, f.campos ->> 'version') IS DISTINCT FROM (EXCLUDED.sha256, EXCLUDED.campos ->> 'version')"""


def cargar(entorno: str, carpeta: Path, todas: bool) -> None:
    reg = _leer_registro(_registro_de(carpeta))
    with _conexion(entorno) as cn:
        cu = cn.cursor()
        cu.execute("SET statement_timeout = '600s'")
        cu.execute("SELECT codigo, sha256, campos ->> 'version' FROM informe_control_ficha")
        hay = {c: (s, v) for c, s, v in cu.fetchall()}
        pendientes = []
        for c, d in reg.items():
            if d.get("estado") != "ok" or not (carpeta / f"{c}.pdf").exists():
                continue
            if not todas and hay.get(c) == (d.get("sha256"), VERSION_PARSER):
                continue
            pendientes.append(c)
        print(f"{len(pendientes)} fichas por cargar ({len(hay)} ya en la base)", flush=True)
        lote: list[dict] = []
        n = errores = 0
        avisos: dict[str, int] = {}

        def soltar():
            nonlocal lote
            if lote:
                # Algunas fichas traen el carácter nulo en su texto (2018CPOL42500015, «…recomendaciones siguientes: \0»):
                # Postgres no lo acepta en text ni en jsonb y el lote entero fallaba. Se quita antes de mandarlo.
                cu.execute(SQL_FICHA, (json.dumps(_sin_nulos(lote), ensure_ascii=False),))
                cn.commit()
                lote = []

        for c in pendientes:
            datos = (carpeta / f"{c}.pdf").read_bytes()
            try:
                p = parsear(datos)
            except Exception as e:  # noqa: BLE001 — un PDF roto no corta la carga
                errores += 1
                print(f"  {c}: no se pudo leer ({type(e).__name__})", flush=True)
                continue
            for a in p["campos"].get("avisos") or []:
                avisos[a] = avisos.get(a, 0) + 1
            campos = p["campos"]
            lote.append({"codigo": c, "texto": p["texto"].replace("\x00", ""), "paginas": p["paginas"], "bytes": len(datos),
                         "sha256": hashlib.sha256(datos).hexdigest(), "descargado_at": reg[c].get("at") or _ahora(), "campos": campos})
            n += 1
            if len(lote) >= 200:
                soltar()
                print(f"  {n}/{len(pendientes)}", flush=True)
        soltar()
        cu.execute("SELECT * FROM refrescar_informe_control_fragmento()")
        trozos, cambios, borrados, sin_vector = cu.fetchone()
        cn.commit()
    print(f"cargadas {n} fichas ({errores} sin leer); avisos del lector: {avisos}")
    print(f"trozos: {trozos} ({cambios} nuevos o cambiados, {borrados} borrados, {sin_vector} sin vector)")


# ─── leer (IA) ──────────────────────────────────────────────────────────────────────────────────

LLM_URL = "https://vigia-llm.vigiaperu.workers.dev/v1/chat/completions"
EMB_URL = "https://vigia-llm.vigiaperu.workers.dev/v1/embeddings"
MODELO = "@cf/zai-org/glm-5.3-flash"
PRECIO = (0.15, 0.50)               # USD por millón de tokens de entrada y salida (lista de Workers AI, 2026-11)
VERSION_LECTURA = "obs-1"
CLIENTE_IA = "vigia-rag/1.0"
TEMAS = ["seleccion_contratacion", "ejecucion_contractual", "pagos_adelantos", "personal_planillas", "bienes_almacen",
         "presupuesto_tesoreria", "otros"]

SISTEMA = """Eres analista de control gubernamental en el Perú. Recibes las observaciones de la Ficha Resumen de uno o \
varios informes de control de la Contraloría General de la República (en un servicio de control específico se llaman \
«argumentos de hecho»). Para CADA observación de CADA informe devuelve lo que la observación dice, sin inventar ni \
completar nada que no esté escrito en ella:

- tema: exactamente uno de
  · seleccion_contratacion: requerimiento, términos de referencia, indagación de mercado, bases, comité de selección, \
evaluación y calificación de ofertas, buena pro, contratación directa, fraccionamiento, compras menores a 8 UIT, \
catálogos electrónicos, suscripción o perfeccionamiento del contrato;
  · ejecucion_contractual: ejecución de contratos de bienes, servicios u obras: conformidades, entregas, penalidades, \
ampliaciones de plazo, adicionales, deductivos, valorizaciones, metrados, supervisión, residente, expediente técnico, \
recepción y liquidación de obra, arbitrajes;
  · pagos_adelantos: pagos indebidos, en exceso o sin sustento, adelantos, garantías, devengados y giros;
  · personal_planillas: contratación de personal (CAS, locadores, FAG, designaciones), planillas, remuneraciones, \
bonificaciones, viáticos, encargos;
  · bienes_almacen: bienes patrimoniales, almacén, combustible, vehículos, donaciones, inventarios, alimentos;
  · presupuesto_tesoreria: presupuesto, modificaciones presupuestales, tesorería, caja, cuentas bancarias, \
recaudación, tributos, transferencias, rendición de fondos;
  · otros: lo que no cabe en los anteriores.
- perjuicio: el perjuicio económico, pago indebido, beneficio indebido o afectación económica que la observación \
CUANTIFICA, como número (sin separadores de miles, con punto decimal: «S/ 1 391 399,50» → 1391399.5). Si da un \
total, ese; si sólo da montos parciales de un mismo perjuicio, su suma. El monto de un contrato, de una buena pro o de \
lo examinado NO es perjuicio. null si no lo cuantifica.
- moneda: "PEN" para soles, "USD" para dólares; null si no hay perjuicio.
- normas: las normas que la observación cita, tal como las nombra («Ley N° 30225, artículo 34», «Directiva \
N° 003-2024-EF/43.01»). [] si no cita ninguna.
- obras: obras o proyectos de inversión que nombra: {nombre, cui}. cui = el código único de inversión o el código \
SNIP si aparece (sólo dígitos), si no null.
- contratos: números de contrato, orden de compra u orden de servicio que nombra («Contrato N° 13-2018-UNAB»).
- procesos: procedimientos de selección que nombra («Licitación Pública N° 001-2013-DRST-CEAH», «Contratación Directa \
N° 015-2020-GRL»).
- empresas: empresas o consorcios que nombra: {razon_social, ruc}; ruc sólo si aparece (11 dígitos), si no null. \
NUNCA incluyas personas naturales, funcionarios ni servidores públicos.

Devuelve todo con la herramienta «salida»: un elemento por informe (con su id) y, dentro, uno por observación (con su n)."""

ESQUEMA = {
    "type": "object",
    "properties": {
        "informes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "observaciones": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "n": {"type": "integer"},
                                "tema": {"type": "string", "enum": TEMAS},
                                "perjuicio": {"type": ["number", "null"]},
                                "moneda": {"type": ["string", "null"], "enum": ["PEN", "USD", None]},
                                "normas": {"type": "array", "items": {"type": "string"}},
                                "obras": {"type": "array", "items": {"type": "object", "properties": {
                                    "nombre": {"type": "string"}, "cui": {"type": ["string", "null"]}}, "required": ["nombre"]}},
                                "contratos": {"type": "array", "items": {"type": "string"}},
                                "procesos": {"type": "array", "items": {"type": "string"}},
                                "empresas": {"type": "array", "items": {"type": "object", "properties": {
                                    "razon_social": {"type": "string"}, "ruc": {"type": ["string", "null"]}}, "required": ["razon_social"]}},
                            },
                            "required": ["n", "tema", "perjuicio", "normas", "obras", "contratos", "procesos", "empresas"],
                        },
                    },
                },
                "required": ["id", "observaciones"],
            },
        },
    },
    "required": ["informes"],
}

# Lo que sólo lleva una organización (como pareceEmpresa de privacidad.ts): una «empresa» sin nada de esto ni RUC 20 se
# descarta (puede ser una persona natural).
_MARCAS_EMPRESA = re.compile(
    r"\b(S\.?\s?A\.?\s?C\.?|S\.?\s?A\.?\s?A\.?|S\.?\s?A\.?|S\.?\s?R\.?\s?L\.?|E\.?\s?I\.?\s?R\.?\s?L\.?|LTDA|L\.?L\.?C\.?|INC|CORP\w*|"
    r"CONSORCIO|EMPRESA|INVERSIONES|CONSTRUCTORA|CONTRATISTAS?|CONSULTOR[AE]S?|SERVICIOS|COMERCIAL|INDUSTRIAL|IMPORTACIONES|"
    r"DISTRIBUIDORA|NEGOCIACIONES|INGENIEROS|TRANSPORTES|MULTISERVICIOS|GRUPO|COMPA[ÑN][IÍ]A|SOCIEDAD|COOPERATIVA|ASOCIACI[OÓ]N|"
    r"LABORATORIOS?|FARMAC[EÉ]UTICA|OPERATORS|HOLDING|BANCO|CAJA)\b", re.I)


def _textos(v, tope: int = 15, largo: int = 220) -> list[str]:
    out: list[str] = []
    for x in v if isinstance(v, list) else []:
        t = _limpio(str(x))[:largo] if isinstance(x, (str, int, float)) else ""
        if t and t.lower() not in (o.lower() for o in out):
            out.append(t)
    return out[:tope]


def normalizar_obs(o: dict) -> dict:
    tema = o.get("tema") if o.get("tema") in TEMAS else "otros"
    try:
        perjuicio = float(o["perjuicio"]) if o.get("perjuicio") is not None else None
    except (TypeError, ValueError):
        perjuicio = None
    if perjuicio is not None and not (0 < perjuicio < 1e11):
        perjuicio = None
    moneda = o.get("moneda") if o.get("moneda") in ("PEN", "USD") else ("PEN" if perjuicio is not None else None)
    obras = []
    for x in o.get("obras") or []:
        if not isinstance(x, dict) or not _limpio(x.get("nombre")):
            continue
        cui = re.sub(r"\D", "", str(x.get("cui") or ""))
        obras.append({"nombre": _limpio(x["nombre"])[:300], "cui": cui if 4 <= len(cui) <= 8 else None})
    empresas = []
    for x in o.get("empresas") or []:
        if not isinstance(x, dict):
            continue
        nombre = _limpio(x.get("razon_social"))[:200]
        ruc = re.sub(r"\D", "", str(x.get("ruc") or ""))
        ruc = ruc if re.fullmatch(r"(15|17|20)\d{9}", ruc) else None
        # Nunca un RUC 10 ni algo que pueda ser una persona natural.
        if not nombre or re.search(r"\b10\d{9}\b", str(x.get("ruc") or "")) or not (ruc or _MARCAS_EMPRESA.search(nombre)):
            continue
        if all(e["razon_social"].lower() != nombre.lower() for e in empresas):
            empresas.append({"razon_social": nombre, "ruc": ruc})
    return {"n": int(o["n"]), "tema": tema, "perjuicio": round(perjuicio, 2) if perjuicio is not None else None,
            "moneda": moneda if perjuicio is not None else None, "normas": _textos(o.get("normas")), "obras": obras[:10],
            "contratos": _textos(o.get("contratos")), "procesos": _textos(o.get("procesos")), "empresas": empresas[:10]}


def _ssm(nombre: str) -> str:
    import subprocess
    env = dict(os.environ, MSYS_NO_PATHCONV="1")
    env.setdefault("AWS_PROFILE", "founder.edwin")
    return subprocess.run(["aws", "ssm", "get-parameter", "--region", "us-east-2", "--name", nombre, "--with-decryption",
                           "--query", "Parameter.Value", "--output", "text"], capture_output=True, text=True, env=env,
                          check=True).stdout.strip()


def _post(url: str, cuerpo: dict, token: str, intentos: int = 7, plazo: int = 300) -> tuple[dict, str]:
    """POST a vigia-llm; espera y reintenta ante 429/3021 (el tope compartido de Workers AI) y ante 5xx o la red."""
    import urllib.error
    import urllib.request

    datos = json.dumps(cuerpo).encode()
    ultimo = ""
    for intento in range(intentos):
        req = urllib.request.Request(url, data=datos, method="POST", headers={
            "authorization": f"Bearer {token}", "content-type": "application/json", "user-agent": CLIENTE_IA,
            "x-vigia-respaldo": "nunca"})
        try:
            with urllib.request.urlopen(req, timeout=plazo) as r:
                return json.loads(r.read()), r.headers.get("x-vigia-modelo", "")
        except urllib.error.HTTPError as e:
            ultimo = f"HTTP {e.code}: {e.read(300).decode('utf-8', 'replace')}"
            if e.code < 500 and e.code != 429:
                raise RuntimeError(ultimo) from None
        except Exception as e:  # noqa: BLE001 — la red: se reintenta
            ultimo = f"{type(e).__name__}: {str(e)[:200]}"
        if "3021" in ultimo or "rate limit" in ultimo.lower() or "HTTP 429" in ultimo:
            time.sleep(45 + random.random() * 45)
        else:
            time.sleep(10 * (intento + 1))
    raise RuntimeError(ultimo[:300])


def _pedido_lectura(lote: list[dict]) -> str:
    partes = []
    for f in lote:
        partes.append(f"### Informe {f['codigo']}\nTítulo: {f.get('titulo') or ''}\nEntidad: {f.get('entidad') or ''}\n"
                      f"Objetivo: {(f.get('objetivo') or '')[:900]}\nObservaciones:")
        for o in f["observaciones"]:
            partes.append(f"[{o['n']}] {o['texto'][:3500]}")
        partes.append("")
    partes.append("Devuelve con la herramienta «salida» la lectura de cada observación de cada informe.")
    return "\n".join(partes)


def leer_lote(lote: list[dict], token: str) -> dict:
    """Una llamada a GLM 5.3 flash con varias fichas. {codigo: [obs normalizadas]}, tokens y costo."""
    cuerpo = {
        "model": MODELO,
        "messages": [{"role": "system", "content": SISTEMA}, {"role": "user", "content": _pedido_lectura(lote)}],
        "tools": [{"type": "function", "function": {"name": "salida", "description": "La lectura de las observaciones.",
                                                    "parameters": ESQUEMA}}],
        "tool_choice": {"type": "function", "function": {"name": "salida"}},
        "reasoning_effort": "low",
        "max_tokens": 8000,
        "temperature": 0,
    }
    t0 = time.time()
    j, quien = _post(LLM_URL, cuerpo, token)
    if quien and not quien.startswith("workers-ai:"):
        raise RuntimeError(f"contestó {quien}, no Workers AI")
    u = j.get("usage") or {}
    tin, tout = int(u.get("prompt_tokens") or 0), int(u.get("completion_tokens") or 0)
    costo = tin * PRECIO[0] / 1e6 + tout * PRECIO[1] / 1e6
    msj = ((j.get("choices") or [{}])[0] or {}).get("message") or {}
    llamadas = msj.get("tool_calls") or []
    args = next((c.get("function", {}).get("arguments") for c in llamadas if c.get("function", {}).get("name") == "salida"), None)
    if args is None and llamadas:
        args = llamadas[0].get("function", {}).get("arguments")
    if args is None:
        crudo = msj.get("content") or ""
        args = crudo[crudo.find("{"):] if "{" in crudo else None
    salida = (args if isinstance(args, dict) else json.loads(args)) if args else {}
    por_codigo: dict[str, list[dict]] = {}
    pedidas = {f["codigo"]: {o["n"] for o in f["observaciones"]} for f in lote}
    for inf in salida.get("informes") or []:
        c = str(inf.get("id") or "").strip()
        if c not in pedidas:
            continue
        obs = []
        for o in inf.get("observaciones") or []:
            try:
                if isinstance(o, dict) and int(o.get("n")) in pedidas[c]:
                    obs.append(normalizar_obs(o))
            except (TypeError, ValueError):
                continue
        por_codigo[c] = obs
    return {"leidas": por_codigo, "tokens_in": tin, "tokens_out": tout, "costo": costo, "segundos": time.time() - t0}


def _lotes(fichas: list[dict], max_fichas: int, max_chars: int) -> list[list[dict]]:
    lotes, actual, chars = [], [], 0
    for f in fichas:
        c = sum(len(o["texto"]) for o in f["observaciones"]) + len(f.get("objetivo") or "") + 200
        if actual and (len(actual) >= max_fichas or chars + c > max_chars):
            lotes.append(actual)
            actual, chars = [], 0
        actual.append(f)
        chars += c
    if actual:
        lotes.append(actual)
    return lotes


def leer(entorno: str, tope_usd: float, hilos: int, max_fichas: int, limite: int | None, bitacora: Path) -> None:
    hilos = max(1, min(hilos, 2))          # Workers AI es compartido con el análisis masivo: 2 a la vez como máximo
    token = _ssm("/vigia/llm/token")
    gastado = 0.0
    if bitacora.exists():
        for linea in bitacora.read_text(encoding="utf-8").splitlines():
            try:
                gastado += float(json.loads(linea).get("costo") or 0)
            except ValueError:
                continue
    print(f"gastado antes: US$ {gastado:.4f} (tope US$ {tope_usd})", flush=True)
    hechas = 0
    while gastado < tope_usd and (limite is None or hechas < limite):
        with _conexion(entorno) as cn:
            cu = cn.cursor()
            cu.execute("SET statement_timeout = '300s'")
            # Las que no tienen lectura o cuyas observaciones cambiaron desde que se leyeron; las más nuevas primero.
            cu.execute("""SELECT f.codigo, f.campos -> 'observaciones', f.campos ->> 'objetivo', i.titulo, i.entidad_nombre
                            FROM informe_control_ficha f JOIN informes_control i ON i.codigo = f.codigo
                           WHERE jsonb_typeof(f.campos -> 'observaciones') = 'array' AND jsonb_array_length(f.campos -> 'observaciones') > 0
                             AND (f.campos -> 'ia' ->> 'huella') IS DISTINCT FROM (f.campos ->> 'huella')
                           ORDER BY coalesce(i.fecha_emision, i.fecha_publicacion) DESC NULLS LAST, f.codigo
                           LIMIT 240""")
            fichas = [{"codigo": c, "observaciones": obs, "objetivo": objetivo, "titulo": titulo, "entidad": entidad}
                      for c, obs, objetivo, titulo, entidad in cu.fetchall()]
            if not fichas:
                print("no queda nada por leer", flush=True)
                break
            if limite is not None:
                fichas = fichas[: max(0, limite - hechas)]
            lotes = _lotes(fichas, max_fichas, 9000)
            print(f"{len(fichas)} fichas en {len(lotes)} pedidos", flush=True)
            with ThreadPoolExecutor(max_workers=hilos) as ex, bitacora.open("a", encoding="utf-8") as fb:
                futuros = {ex.submit(leer_lote, l, token): l for l in lotes}
                for fu, lote in futuros.items():
                    if fu.cancelled():
                        continue
                    try:
                        r = fu.result()
                    except Exception as e:  # noqa: BLE001 — un pedido que falla queda para la próxima vuelta
                        print(f"  pedido de {len(lote)} fichas falló: {str(e)[:160]}", flush=True)
                        fb.write(json.dumps({"at": _ahora(), "fichas": [f["codigo"] for f in lote], "error": str(e)[:200], "costo": 0}) + "\n")
                        continue
                    gastado += r["costo"]
                    chars = {f["codigo"]: sum(len(o["texto"]) for o in f["observaciones"]) for f in lote}
                    total_chars = max(1, sum(chars.values()))
                    for f in lote:
                        obs = r["leidas"].get(f["codigo"])
                        if not obs:
                            continue
                        parte = chars[f["codigo"]] / total_chars
                        ia = {"modelo": MODELO, "version": VERSION_LECTURA, "leido_at": _ahora(),
                              "tokens_in": round(r["tokens_in"] * parte), "tokens_out": round(r["tokens_out"] * parte),
                              "costo_usd": round(r["costo"] * parte, 6), "huella": huella_observaciones({"observaciones": f["observaciones"]}),
                              "observaciones": sorted(obs, key=lambda o: o["n"])}
                        cu.execute("UPDATE informe_control_ficha SET campos = jsonb_set(campos, '{ia}', %s::jsonb), actualizado_at = now() WHERE codigo = %s",
                                   (json.dumps(ia, ensure_ascii=False), f["codigo"]))
                        hechas += 1
                    cn.commit()
                    fb.write(json.dumps({"at": _ahora(), "fichas": [f["codigo"] for f in lote], "leidas": len(r["leidas"]),
                                         "tokens_in": r["tokens_in"], "tokens_out": r["tokens_out"], "costo": round(r["costo"], 6),
                                         "segundos": round(r["segundos"], 1)}) + "\n")
                    fb.flush()
                    if gastado >= tope_usd:
                        # Los que no empezaron no se piden; los que ya están en camino se esperan y se guardan.
                        print(f"  tope de gasto alcanzado: US$ {gastado:.4f}", flush=True)
                        for otro in futuros:
                            otro.cancel()
            cu.execute("SELECT * FROM refrescar_informe_control_fragmento()")
            cn.commit()
            print(f"leídas {hechas} fichas · gastado US$ {gastado:.4f}", flush=True)


# ─── indexar ────────────────────────────────────────────────────────────────────────────────────

def embeber(textos: list[str], token: str) -> list[list[float]]:
    j, _ = _post(EMB_URL, {"input": textos}, token, intentos=6, plazo=120)
    data = j.get("data") or []
    vs = [x["embedding"] if isinstance(x, dict) else x for x in data]
    if len(vs) != len(textos) or any(len(v) != 1024 for v in vs):
        raise RuntimeError(f"embeddings con otra forma ({len(vs)} de {len(textos)})")
    return vs


def indexar(entorno: str, hilos: int) -> None:
    token = _ssm("/vigia/llm/token")
    hilos = max(1, min(hilos, 2))
    with _conexion(entorno) as cn:
        cu = cn.cursor()
        cu.execute("SET statement_timeout = '600s'")
        cu.execute("SELECT * FROM refrescar_informe_control_fragmento()")
        print("trozos (total, nuevos o cambiados, borrados, sin vector):", cu.fetchone(), flush=True)
        cn.commit()
        hechos, t0 = 0, time.time()
        while True:
            cu.execute("""SELECT id, coalesce(contexto, ''), texto FROM informe_control_fragmento
                           WHERE embedding IS NULL ORDER BY id LIMIT 256""")
            filas = cu.fetchall()
            if not filas:
                break
            entradas = [((ctx + "\n\n" + tx) if ctx else tx)[:6000] for _i, ctx, tx in filas]
            grupos = [list(range(k, min(k + 32, len(filas)))) for k in range(0, len(filas), 32)]
            with ThreadPoolExecutor(max_workers=hilos) as ex:
                vectores = list(ex.map(lambda g: embeber([entradas[i] for i in g], token), grupos))
            pares = []
            for g, vs in zip(grupos, vectores):
                for i, v in zip(g, vs):
                    pares.append((filas[i][0], "[" + ",".join(f"{x:.5f}" for x in v) + "]"))
            cu.execute("""UPDATE informe_control_fragmento f SET embedding = v.e::halfvec, indexado_at = now()
                            FROM unnest(%s::bigint[], %s::text[]) AS v(id, e) WHERE f.id = v.id""",
                       ([p[0] for p in pares], [p[1] for p in pares]))
            cn.commit()
            hechos += len(pares)
            print(f"  vectores: {hechos} ({hechos / max(1e-6, time.time() - t0):.1f}/s)", flush=True)
        cu.execute("ANALYZE informe_control_fragmento")
        cn.commit()
    print(f"vectores calculados: {hechos}")


def estado(entorno: str) -> None:
    with _conexion(entorno) as cn:
        cn.set_session(readonly=True, autocommit=True)
        cu = cn.cursor()
        cu.execute("""SELECT count(*), count(*) FILTER (WHERE campos ? 'ia'),
                             round(sum((campos -> 'ia' ->> 'costo_usd')::numeric), 4),
                             sum(jsonb_array_length(coalesce(campos -> 'observaciones', '[]'))),
                             count(*) FILTER (WHERE campos ? 'avisos')
                        FROM informe_control_ficha""")
        print("fichas | leídas con IA | costo IA US$ | observaciones | con avisos:", cu.fetchone())
        cu.execute("""SELECT tipo, count(*), count(embedding), count(tema) FROM informe_control_fragmento GROUP BY 1 ORDER BY 1""")
        for r in cu.fetchall():
            print("trozos", r)
        cu.execute("""SELECT tema, count(*) FROM informe_control_fragmento WHERE tipo = 'observacion' GROUP BY 1 ORDER BY 2 DESC""")
        print("temas:", cu.fetchall())


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("lista")
    p.add_argument("--entorno", choices=["dev", "prod"], required=True)
    p.add_argument("--salida", type=Path, required=True)
    p = sub.add_parser("bajar")
    p.add_argument("--lista", type=Path, required=True)
    p.add_argument("--carpeta", type=Path, required=True)
    p.add_argument("--limite", type=int)
    p.add_argument("--reintentar", action="store_true", help="vuelve a pedir las que dieron 404 o vacío")
    p = sub.add_parser("medir")
    p.add_argument("--lista", type=Path, required=True)
    p.add_argument("--carpeta", type=Path, required=True)
    p.add_argument("--muestra", type=int)
    p.add_argument("--ver", action="store_true", help="muestra lo leído de cada ficha (sin la sección de funcionarios)")
    p = sub.add_parser("cargar")
    p.add_argument("--entorno", choices=["dev", "prod"], required=True)
    p.add_argument("--carpeta", type=Path, required=True)
    p.add_argument("--todas", action="store_true", help="vuelve a leer también las que no cambiaron")
    p = sub.add_parser("leer")
    p.add_argument("--entorno", choices=["dev", "prod"], required=True)
    p.add_argument("--tope-usd", type=float, default=40.0)
    p.add_argument("--hilos", type=int, default=2)
    p.add_argument("--fichas-por-pedido", type=int, default=4)
    p.add_argument("--limite", type=int)
    p.add_argument("--bitacora", type=Path, default=Path("contraloria_fichas_lectura.jsonl"),
                   help="un renglón por pedido (tokens, costo): suma el gasto entre corridas")
    p = sub.add_parser("indexar")
    p.add_argument("--entorno", choices=["dev", "prod"], required=True)
    p.add_argument("--hilos", type=int, default=2)
    p = sub.add_parser("estado")
    p.add_argument("--entorno", choices=["dev", "prod"], required=True)
    a = ap.parse_args()
    if a.cmd == "cargar":
        cargar(a.entorno, a.carpeta, a.todas)
        return 0
    if a.cmd == "leer":
        leer(a.entorno, a.tope_usd, a.hilos, a.fichas_por_pedido, a.limite, a.bitacora)
        return 0
    if a.cmd == "indexar":
        indexar(a.entorno, a.hilos)
        return 0
    if a.cmd == "estado":
        estado(a.entorno)
        return 0
    if a.cmd == "lista":
        lista(a.entorno, a.salida)
        return 0
    if a.cmd == "bajar":
        return bajar(a.lista, a.carpeta, a.limite, a.reintentar)
    if a.cmd == "medir":
        medir(a.lista, a.carpeta, a.muestra, a.ver)
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
