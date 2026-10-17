"""Prensa pre-cargada: búsqueda de noticias GRATIS y lectura de las más relevantes, antes de los agentes.

Antes, cada agente de investigación buscaba por su cuenta con una búsqueda web cobrada por consulta (y repetía
las mismas consultas sobre el mismo proveedor). Ahora:
  1. Consultas armadas en código (no por el modelo): proveedor, entidad + palabras de riesgo, personas clave.
  2. Google News por RSS (sin clave ni costo): titular, medio, fecha y enlace de cada nota.
  3. Sin duplicados, priorizadas por relevancia (el nombre buscado en el titular) y fecha.
  4. Se LEEN solo las PRENSA_LEER mejores (10): se resuelve el enlace real y se extrae el texto de la nota.
El agente de prensa recibe esto inyectado y solo busca por su cuenta si falta algo puntual.
"""
from __future__ import annotations

import concurrent.futures
import email.utils
import json
import os
import re
import time
import unicodedata
import xml.etree.ElementTree as ET

PRENSA_LEER = int(os.getenv("PRENSA_LEER", "10"))
PRENSA_MAX_CONSULTAS = int(os.getenv("PRENSA_MAX_CONSULTAS", "5"))
PRENSA_ANIOS = float(os.getenv("PRENSA_ANIOS", "6"))
PRENSA_CHARS_NOTA = int(os.getenv("PRENSA_CHARS_NOTA", "3500"))
PRENSA_TIMEOUT_S = float(os.getenv("PRENSA_TIMEOUT_S", "12"))
_UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"}
_RSS = "https://news.google.com/rss/search"
_SOCIETARIO = re.compile(r"\b(s\.?a\.?c\.?|s\.?a\.?a\.?|s\.?a\.?|e\.?i\.?r\.?l\.?|s\.?r\.?l\.?|s\.?c\.?r\.?l\.?|sociedad anonima cerrada|"
                         r"empresa individual de responsabilidad limitada|sociedad comercial de responsabilidad limitada)\b\.?", re.I)
_RIESGO = "(denuncia OR irregularidades OR contraloría OR fiscalía OR sobrevaloración OR corrupción)"
_COMPRAS = "(licitación OR contratación OR adquisición OR compra OR proveedor)"
# Redes y video: el texto no se puede extraer; se conserva el titular, no se intenta leer.
_SIN_LECTURA = re.compile(r"(facebook|instagram|tiktok|twitter|x)\.com|youtube\.com|youtu\.be", re.I)


def _sin_tildes(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s or "") if not unicodedata.combining(c))


def nombre_nucleo(razon: str) -> str:
    """'GASOLINERAS S.A.C.' → 'Gasolineras'; sin forma societaria ni comillas."""
    n = _SOCIETARIO.sub(" ", (razon or "").replace('"', " "))
    return " ".join(n.split()).strip(" .,-")


def nombre_entidad_prensa(entidad: str) -> str:
    """Como la nombra la prensa: 'MUNICIPALIDAD DISTRITAL DE SAN MARTIN DE PORRES' → 'Municipalidad de San Martin de
    Porres'; 'GOBIERNO REGIONAL DE CUSCO SEDE CENTRAL' → 'Gobierno Regional de Cusco'."""
    mayusculas = (entidad or "").isupper()
    n = re.sub(r"\b(distrital|provincial)\s+de\b", "de", entidad or "", flags=re.I)
    n = re.sub(r"\s*\b(sede central|unidad ejecutora.*|u\.?\s?e\.?\s*\d+.*)$", "", n, flags=re.I)
    n = " ".join(n.split()).strip(" -,.")
    return n.title().replace(" De ", " de ").replace(" Del ", " del ").replace(" La ", " la ").replace(" Y ", " y ") if mayusculas else n


def consultas(razon: str, entidad: str, personas: list[str] | None = None) -> list[tuple[str, str, str]]:
    """[(consulta, tipo, nombre_buscado)] — deterministas, sin el modelo."""
    out: list[tuple[str, str, str]] = []
    nucleo = nombre_nucleo(razon)
    if len(nucleo.split()) >= 2:
        out.append((f'"{nucleo}"', "proveedor", nucleo))
    elif len(nucleo) >= 4:
        # Nombre de una palabra ("Gasolineras"): solo la razón social completa, si no trae noticias de cualquier rubro.
        completa = " ".join((razon or "").replace('"', " ").split())
        out.append((f'"{completa}"', "proveedor", completa))
    entidad = nombre_entidad_prensa(entidad)
    if entidad:
        # Perú + compras + riesgo: con una entidad de nombre común ("Ministerio Público") salían notas de otros
        # países y de temas sin relación con contrataciones.
        out.append((f'"{entidad}" Perú {_COMPRAS} {_RIESGO}', "entidad", entidad))
    for p in (personas or [])[:3]:
        if p and len(p.split()) >= 2:
            out.append((f'"{p}"', "persona", p))
    vistos, unicas = set(), []
    for c in out:
        if c[0] not in vistos:
            vistos.add(c[0])
            unicas.append(c)
    return unicas[:PRENSA_MAX_CONSULTAS]


def _rss(cli, consulta: str) -> list[dict]:
    r = cli.get(_RSS, params={"q": consulta, "hl": "es-419", "gl": "PE", "ceid": "PE:es-419"})
    if r.status_code >= 400:
        return []
    raiz = ET.fromstring(r.content)
    notas = []
    for it in raiz.findall(".//item"):
        fecha = None
        try:
            fecha = email.utils.parsedate_to_datetime(it.findtext("pubDate") or "").timestamp()
        except (TypeError, ValueError):
            pass
        extracto = re.sub(r"<[^>]+>", " ", it.findtext("description") or "")
        notas.append({"titulo": (it.findtext("title") or "").strip(), "medio": (it.findtext("source") or "").strip(),
                      "fecha_ts": fecha, "enlace": it.findtext("link") or "", "extracto": " ".join(extracto.split())[:300]})
    return notas


def _plano(s: str) -> str:
    return re.sub(r"[^a-z0-9ñ]+", " ", _sin_tildes(s).lower()).strip()


def _menciona(nota: dict, buscado: str) -> bool:
    """El nombre buscado aparece en el titular o el extracto. Sin forma societaria, salvo que el nombre sea de una
    sola palabra ("Gasolineras"): ahí se exige la razón social entera, si no cualquier nota del rubro pasa."""
    nucleo = nombre_nucleo(buscado)
    clave = _plano(nucleo if len(nucleo.split()) >= 2 else buscado).replace(" ", "")
    texto = _plano(f"{nota['titulo']} {nota.get('extracto', '')}").replace(" ", "")
    return bool(clave) and clave in texto


# Cupos de lectura por tipo de consulta: la entidad no queda fuera por un proveedor con mucha prensa.
_CUPOS = {"proveedor": 4, "entidad": 4, "persona": 2}


def _puntaje(nota: dict, buscado: str, tipo: str) -> float:
    titulo = _sin_tildes(nota["titulo"]).lower()
    clave = _sin_tildes(buscado).lower()
    p = {"proveedor": 3.0, "persona": 2.5, "entidad": 1.0}.get(tipo, 1.0)
    if clave and clave in titulo:
        p += 3.0
    if re.search(r"denunci|irregular|contralor|fiscal|sobreval|corrup|sancion|investig", titulo):
        p += 1.5
    if nota.get("fecha_ts"):
        anios = (time.time() - nota["fecha_ts"]) / 31_557_600
        p += max(0.0, 2.0 - anios / 2)
    return p


def _resolver(cli, enlace: str) -> str | None:
    """Enlace de Google News → URL real del medio (el mismo pedido que hace la web de Google News)."""
    if "/articles/" not in enlace:
        return enlace or None
    aid = enlace.split("/articles/")[1].split("?")[0]
    h = cli.get(f"https://news.google.com/rss/articles/{aid}").text
    sg, ts = re.search(r'data-n-a-sg="([^"]+)"', h), re.search(r'data-n-a-ts="([^"]+)"', h)
    if not (sg and ts):
        return None
    req = [["Fbv4je", f'["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],'
                      f'"X","X",1,[1,1,1],1,1,null,0,0,null,0],"{aid}",{ts.group(1)},"{sg.group(1)}"]']]
    r = cli.post("https://news.google.com/_/DotsSplashUi/data/batchexecute", data={"f.req": json.dumps([req])},
                 headers={"Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"})
    m = re.search(r'\[\\"garturlres\\",\\"(.*?)\\"', r.text)
    return m.group(1) if m else None


def _texto(html: str) -> str:
    """Texto de la nota: los párrafos <p> con contenido (sin menús, scripts ni pies)."""
    html = re.sub(r"(?is)<(script|style|nav|footer|header|aside|form)[^>]*>.*?</\1>", " ", html)
    parrafos = []
    for p in re.findall(r"(?is)<p[^>]*>(.*?)</p>", html):
        t = re.sub(r"<[^>]+>", " ", p)
        t = re.sub(r"&nbsp;|&#160;", " ", t)
        t = re.sub(r"&quot;", '"', re.sub(r"&amp;", "&", t))
        t = " ".join(t.split())
        if len(t) >= 60:
            parrafos.append(t)
    return "\n".join(parrafos)[:PRENSA_CHARS_NOTA]


def _leer(enlace: str, medio: str = "") -> dict:
    import httpx
    if _SIN_LECTURA.search(medio or ""):
        return {"url": enlace, "texto": "", "error": "red social: solo titular"}
    with httpx.Client(headers=_UA, timeout=PRENSA_TIMEOUT_S, follow_redirects=True) as cli:
        try:
            url = _resolver(cli, enlace)
            if not url:
                return {"url": None, "texto": "", "error": "enlace sin resolver"}
            r = cli.get(url)
            return {"url": url, "texto": _texto(r.text) if r.status_code < 400 else "",
                    **({} if r.status_code < 400 else {"error": f"HTTP {r.status_code}"})}
        except Exception as e:  # noqa: BLE001
            return {"url": None, "texto": "", "error": f"{type(e).__name__}: {str(e)[:120]}"}


def precargar(razon: str, entidad: str, personas: list[str] | None = None) -> dict:
    """Notas candidatas de todas las consultas y el texto de las PRENSA_LEER más relevantes."""
    import httpx
    t0 = time.monotonic()
    qs = consultas(razon, entidad, personas)
    candidatas: dict[str, dict] = {}
    limite = time.time() - PRENSA_ANIOS * 31_557_600
    with httpx.Client(headers=_UA, timeout=PRENSA_TIMEOUT_S, follow_redirects=True) as cli:
        pendientes = list(qs)
        while pendientes:
            q, tipo, buscado = pendientes.pop(0)
            try:
                notas = _rss(cli, q)
            except Exception:  # noqa: BLE001
                notas = []
            for n in notas:
                if n.get("fecha_ts") and n["fecha_ts"] < limite:
                    continue
                if not _menciona(n, buscado):
                    continue   # homónimos y notas de otro rubro: el nombre tiene que estar en la nota
                clave = re.sub(r"\W+", " ", _sin_tildes(n["titulo"]).lower()).strip()[:90]
                pts = _puntaje(n, buscado, tipo)
                if clave and (clave not in candidatas or candidatas[clave]["puntaje"] < pts):
                    candidatas[clave] = {**n, "puntaje": round(pts, 2), "consulta": q, "tipo": tipo}
            # La consulta estricta de la entidad (Perú + compras + riesgo) puede no traer nada: una más amplia.
            if tipo == "entidad" and not any(c["tipo"] == "entidad" for c in candidatas.values()) and _COMPRAS in q:
                amplia = f'"{buscado}" {_RIESGO}'
                pendientes.append((amplia, "entidad", buscado))
                qs.append((amplia, "entidad", buscado))
    ordenadas = sorted(candidatas.values(), key=lambda n: n["puntaje"], reverse=True)
    elegidas, usados = [], {}
    for n in ordenadas:                      # primero, cada tipo hasta su cupo
        if usados.get(n["tipo"], 0) < _CUPOS.get(n["tipo"], 2):
            elegidas.append(n)
            usados[n["tipo"]] = usados.get(n["tipo"], 0) + 1
    for n in ordenadas:                      # los cupos que sobren, a las mejores restantes
        if len(elegidas) >= PRENSA_LEER:
            break
        if n not in elegidas:
            elegidas.append(n)
    elegidas = sorted(elegidas[:PRENSA_LEER], key=lambda n: n["puntaje"], reverse=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as ex:
        lecturas = list(ex.map(lambda n: _leer(n["enlace"], n.get("medio", "")), elegidas))
    leidas = []
    for n, l in zip(elegidas, lecturas):
        fecha = time.strftime("%Y-%m-%d", time.gmtime(n["fecha_ts"])) if n.get("fecha_ts") else None
        leidas.append({"titulo": n["titulo"], "medio": n["medio"], "fecha": fecha, "url": l.get("url") or n["enlace"],
                       "consulta": n["consulta"], "tipo": n["tipo"], "texto": l.get("texto") or "",
                       **({"error_lectura": l["error"]} if l.get("error") else {})})
    return {"fuente": "google_news_rss", "consultas": [q for q, _, _ in qs], "candidatas": len(candidatas),
            "leidas": leidas, "otras_titulares": [{"titulo": n["titulo"], "medio": n["medio"]} for n in ordenadas if n not in elegidas][:15],
            "segundos": round(time.monotonic() - t0, 1), "costo_usd": 0.0,
            "nota": "Notas ya buscadas y LEÍDAS (texto extraído). Cita solo estas URLs; busca por tu cuenta solo si falta algo puntual."}
