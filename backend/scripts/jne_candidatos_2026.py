#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
descargar_candidatos_2026.py — candidatos de las Elecciones Generales 2026 (EG2026) y de las Elecciones
Regionales y Municipales 2026 (ERM2026) del JNE → un JSON y un CSV locales, con campos compatibles con la
tabla jne_candidaturas.

Fuentes (públicas, sin captcha ni login en las pantallas que las consumen; verificadas el 2026-11-18):

  EG2026  · API de la Plataforma Electoral del JNE (https://plataformaelectoral.jne.gob.pe)
            POST {PE}/api/v1/candidato/listas                       listas por tipo de elección (1 pedido por tipo)
            GET  {PE}/api/v1/plan-gobierno/candidatos?IdProcesoElectoral=124&TxCodExpedienteExt=<expediente>
            Trae el documento («numeroDocumento»), el estado, el cargo y «nombreCompleto» (NOMBRES APELLIDOS, junto).
  ERM2026 · API de Voto Informado del JNE (https://votoinformado.jne.gob.pe)
            GET  {VI}/v1/departamentos[/<dep>/provincias[/<pro>/distritos]]
            POST {VI}/v1/candidatos/organizaciones                  {dep[,pro,dis]} → listas inscritas del ámbito
            POST {VI}/v1/candidatos/organizaciones/candidatos       {dep[,pro,dis],idSolicitudLista} → candidatos
            Trae apellidos y nombres separados, cargo, estado y ámbito. No trae un campo de documento: el nombre
            del archivo de la foto («urlFotoCandidato») es el documento (comprobado contra la Plataforma Electoral).
  Electos EG2026 · reporte «Autoridades electas» del JNE en la Plataforma Nacional de Datos Abiertos (XLS).

Uso:
  python descargar_candidatos_2026.py                       # todo (EG ~1 900 pedidos, ERM ~13 000 pedidos)
  python descargar_candidatos_2026.py --proceso EG2026
  python descargar_candidatos_2026.py --muestra 40          # muestra: 40 listas por tipo (EG) y 40 distritos (ERM)
  python descargar_candidatos_2026.py --salida C:\\ruta      # dónde dejar candidatos_2026.json / .csv y la caché

Salidas (en <salida>, por defecto ./salida junto al script):
  candidatos_2026.json / .csv     todo lo bajado, una fila por candidatura (con estado, expediente, documento…)
  jne_candidaturas_2026.csv       sólo quien llegó inscrito a la elección, con las columnas de la tabla jne_candidaturas
  resumen.json                    conteos por proceso y cargo, tiempos, pedidos

Reanudable: cada respuesta se guarda en <salida>/cache y no se vuelve a pedir (--refrescar la ignora).
Cortés: un tope de pedidos por segundo por sitio (--ritmo-eg, --ritmo-erm) compartido entre los hilos; si el sitio
responde 429 se detiene 15 s y baja el ritmo. Voto Informado responde 429 por encima de unos 3 pedidos por segundo.
Sólo imprime conteos (nunca nombres ni documentos).
Requiere: requests. Para marcar los electos de EG2026 hace falta además xlrd (si no está, deja resultado vacío).
"""
from __future__ import annotations

import argparse
import collections
import csv
import hashlib
import json
import math
import os
import random
import re
import sys
import threading
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
PE = "https://apiplataformaelectoral3.jne.gob.pe"
PE_WEB = "https://plataformaelectoral.jne.gob.pe"
VI = "https://votoinformado.jne.gob.pe/api"
VI_WEB = "https://votoinformado.jne.gob.pe"
PNDA_ELECTAS = "https://www.datosabiertos.gob.pe/dataset/autoridades-electas-en-procesos-electorales-jurado-nacional-de-elecciones"
ID_EG, ID_ERM = 124, 126          # idProcesoElectoral en la Plataforma Electoral (GET {PE}/api/v1/expediente/proceso-electoral)
TIPOS_EG = [(1, "PRESIDENCIAL"), (15, "DIPUTADOS"), (3, "PARLAMENTO ANDINO"), (20, "SENADORES DISTRITO ÚNICO"),
            (21, "SENADORES DISTRITO MÚLTIPLE")]
TIPOS_ERM = {4: "REGIONAL", 5: "MUNICIPAL PROVINCIAL", 6: "MUNICIPAL DISTRITAL"}
CAMPOS = ["proceso", "anio", "nombre", "nombre_original", "apellidos", "apellido_paterno", "apellido_materno", "nombres", "orden_nombre",
          "nombre_fuente", "documento", "cargo", "cargo_fuente", "tipo_eleccion", "partido", "resultado", "cargo_electo", "estado",
          "estado_lista", "region", "provincia", "distrito", "ubigeo_jne", "numero_lista", "expediente", "id_hoja_vida", "fuente",
          "fuente_url"]

_imprimir = threading.Lock()


def log(*a):
    with _imprimir:
        print(*a, flush=True)


# ── texto ───────────────────────────────────────────────────────────────────────────────────────────────
def normalizar(s) -> str:
    """Igual que normalize_name() de load_jne_candidaturas.py (NFD sin marcas, mayúsculas), con los espacios colapsados."""
    if not s:
        return ""
    s = unicodedata.normalize("NFD", str(s))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return " ".join(s.upper().split())


def limpio(s):
    s = " ".join(str(s).split()) if s is not None else ""
    return s or None


_SIN_TILDE = str.maketrans("ÁÉÍÓÚÜÀÈÌÒÙ", "AEIOUUAEIOU")


def lugar(s) -> str | None:
    """Un departamento, provincia o distrito como lo escribe el JNE en sus reportes: mayúsculas, sin tildes y con Ñ
    (Voto Informado los da con tilde: «ÁNCASH», «BONGARÁ»; la Plataforma Electoral y la PNDA, sin ella)."""
    s = limpio(s)
    return s.upper().translate(_SIN_TILDE) if s else None


def cargo_canonico(cargo: str | None) -> str | None:
    """El cargo como conviene guardarlo: en singular, como lo escribe el JNE en sus reportes de autoridades."""
    c = normalizar(cargo)
    if not c:
        return None
    if c.startswith("DIPUTAD"):
        return "DIPUTADO"
    if c.startswith("SENADOR"):
        return "SENADOR"
    return " ".join(str(cargo).upper().split())


def familia_cargo(cargo: str | None) -> str:
    c = normalizar(cargo)
    if "PARLAMENTO ANDINO" in c:
        return "PA"
    if c.startswith("DIPUTAD"):
        return "DIP"
    if c.startswith("SENADOR"):
        return "SEN"
    if "VICEPRESIDENTE" in c:
        return "VP1" if "PRIMER" in c else "VP2"
    if c.startswith("PRESIDENTE"):
        return "PRES"
    return c


# ── pedidos con caché, pausa y reintentos ───────────────────────────────────────────────────────────────
class Ritmo:
    """Tope de pedidos por segundo a un sitio, entre todos los hilos. Tras un 429 se detiene 15 s y baja el ritmo."""

    def __init__(self, por_segundo: float):
        self.intervalo = 1.0 / por_segundo
        self.lock = threading.Lock()
        self.proximo = 0.0
        self.frenadas = 0

    def esperar(self):
        with self.lock:
            ahora = time.monotonic()
            turno = max(ahora, self.proximo)
            self.proximo = turno + self.intervalo
        if turno > ahora:
            time.sleep(turno - ahora)

    def frenar(self):
        with self.lock:
            self.frenadas += 1
            self.intervalo = min(self.intervalo * 1.5, 5.0)
            self.proximo = max(self.proximo, time.monotonic() + 15.0)


class Cliente:
    def __init__(self, cache: Path, ritmos: dict[str, float], refrescar: bool, solo_cache: bool = False):
        self.cache, self.refrescar, self.solo_cache = cache, refrescar, solo_cache
        self.faltan = 0
        self.ritmos = {sitio: Ritmo(r) for sitio, r in ritmos.items()}
        self.local = threading.local()
        self.lock = threading.Lock()
        self.pedidos = collections.Counter()
        self.de_cache = 0
        self.fallos: list[tuple[str, str]] = []

    def _sesion(self) -> requests.Session:
        s = getattr(self.local, "s", None)
        if s is None:
            s = requests.Session()
            s.headers.update({"User-Agent": UA, "Accept": "application/json, text/plain, */*", "Accept-Language": "es-PE,es;q=0.9"})
            self.local.s = s
        return s

    def json(self, clave: str, metodo: str, url: str, cuerpo=None, origen: str = "", valido=None):
        ruta = self.cache / (clave + ".json")
        if not self.refrescar and ruta.exists():
            try:
                d = json.loads(ruta.read_text("utf-8"))
                with self.lock:
                    self.de_cache += 1
                return d
            except ValueError:
                pass
        if self.solo_cache:
            with self.lock:
                self.faltan += 1
            return None
        sitio = re.match(r"https://([^/]+)", url).group(1)
        ritmo = self.ritmos.setdefault(sitio, Ritmo(1.0))
        ultimo = ""
        for intento in range(7):
            ritmo.esperar()
            try:
                r = self._sesion().request(metodo, url, json=cuerpo, timeout=120,
                                           headers={"Origin": origen, "Referer": origen + "/"} if origen else None)
                with self.lock:
                    self.pedidos[sitio] += 1
                if r.status_code == 429:
                    ritmo.frenar()      # el sitio pide ir más lento: se espera y se baja el ritmo para todos los hilos
                    ultimo = "HTTP 429"
                    continue
                if r.status_code == 200:
                    try:
                        d = r.json()
                    except ValueError:
                        d, ultimo = None, "200 sin JSON (¿página de desafío?)"
                    if d is not None:
                        if valido is None or valido(d):
                            ruta.parent.mkdir(parents=True, exist_ok=True)
                            tmp = ruta.with_name(ruta.name + ".%d.tmp" % threading.get_ident())
                            tmp.write_text(json.dumps(d, ensure_ascii=False), "utf-8")
                            os.replace(tmp, ruta)
                            return d
                        ultimo = "200 con forma inesperada"
                else:
                    ultimo = f"HTTP {r.status_code}"
            except requests.RequestException as e:
                ultimo = type(e).__name__
            time.sleep(min(90.0, 2.0 * 2 ** intento) + random.random())
        with self.lock:
            self.fallos.append((clave, ultimo))
        return None


def en_paralelo(hilos: int, fn, cosas, etiqueta: str, cada: int = 500):
    """fn sobre cada cosa con `hilos` hilos; resultados en orden. Avisa del avance cada `cada`."""
    cosas = list(cosas)
    out = []
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=max(1, hilos)) as ex:
        for i, r in enumerate(ex.map(fn, cosas), 1):
            out.append(r)
            if i % cada == 0 or i == len(cosas):
                log(f"   [{etiqueta}] {i}/{len(cosas)} · {time.time() - t0:.0f} s")
    return out


# ── EG 2026: Plataforma Electoral ───────────────────────────────────────────────────────────────────────
def bajar_eg(cl: Cliente, hilos: int, muestra: int | None) -> tuple[list[dict], dict]:
    es_lista = lambda d: isinstance(d, dict) and isinstance(d.get("data"), list)   # noqa: E731
    t = cl.json(f"pe/tipos_{ID_EG}", "GET", f"{PE}/api/v1/tipo-eleccion/tipo/{ID_EG}", origen=PE_WEB, valido=es_lista)
    tipos = [(int(x["idTipoEleccion"]), x["tipoEleccion"]) for x in t["data"]] if t and t["data"] else TIPOS_EG
    listas = []
    for idt, nombre in tipos:
        d = cl.json(f"pe/listas_{ID_EG}_{idt}", "POST", f"{PE}/api/v1/candidato/listas", origen=PE_WEB, valido=es_lista,
                    cuerpo={"pageSize": 0, "skip": 0, "sortField": "", "sortDir": "",
                            "filter": {"idProcesoElectoral": ID_EG, "idTipoEleccion": idt}})
        if d is None:
            log(f"   [EG] no se pudo bajar las listas del tipo {idt} {nombre}")
            continue
        de_tipo = d["data"]
        if muestra:
            de_tipo = random.Random(2026).sample(de_tipo, min(muestra, len(de_tipo)))
        listas += de_tipo
    log(f"   [EG] {len(listas)} listas ({dict(collections.Counter(l['txTipoEleccion'] for l in listas))})")

    def una(l):
        exp = l["txCodExpedienteExt"]
        return l, cl.json(f"pe/cand_{ID_EG}/{exp}", "GET", origen=PE_WEB, valido=es_lista,
                          url=f"{PE}/api/v1/plan-gobierno/candidatos?IdProcesoElectoral={ID_EG}&TxCodExpedienteExt={exp}")

    filas = []
    declarados = 0
    repetidas = [0]
    for l, d in en_paralelo(hilos, una, listas, "EG candidatos", 200):
        declarados += l.get("nuCantidadCandidatos") or 0
        if d is None:
            continue
        distrito_electoral = limpio(l.get("txDistritoElectoral"))
        nacional = normalizar(distrito_electoral) in ("UNICO NACIONAL", "")
        presidencial = int(l.get("idTipoEleccion") or 0) == 1
        ya = set()
        for c in d["data"]:
            doc = limpio(c.get("numeroDocumento"))
            nombre_fuente = limpio(c.get("nombreCompleto"))
            if not nombre_fuente:
                continue
            for cargo in (c.get("cargo") or [None]):
                # La misma persona sale repetida en su lista cuando además postula a otra (un candidato a presidente que va
                # al Senado aparece dos veces, con el número que lleva en cada una): una sola fila por persona y cargo.
                if (doc or nombre_fuente, cargo) in ya:
                    repetidas[0] += 1
                    continue
                ya.add((doc or nombre_fuente, cargo))
                filas.append({
                    "proceso": "EG2026", "anio": 2026,
                    "nombre": None, "nombre_original": None, "apellidos": None, "apellido_paterno": None, "apellido_materno": None, "nombres": None,
                    "orden_nombre": None, "nombre_fuente": nombre_fuente, "documento": doc,
                    "cargo": cargo_canonico(cargo), "cargo_fuente": limpio(cargo), "tipo_eleccion": limpio(l.get("txTipoEleccion")),
                    "partido": limpio(c.get("organizacionPolitica")) or limpio(l.get("txOrganizacionPolitica")),
                    "resultado": None, "cargo_electo": None,
                    "estado": limpio(c.get("estado")), "estado_lista": limpio(l.get("txEstadoLista")),
                    "region": None if nacional else lugar(distrito_electoral), "provincia": None, "distrito": None,
                    "ubigeo_jne": limpio(l.get("txUbigeo")),
                    # En la fórmula presidencial «numeroCandidato» es el número que la persona lleva en OTRA lista: no se usa.
                    "numero_lista": int(c["numeroCandidato"]) if c.get("numeroCandidato") and not presidencial else None,
                    "expediente": l["txCodExpedienteExt"],
                    "id_hoja_vida": int(c["idHojaVida"]) if c.get("idHojaVida") is not None else None,
                    "fuente": "JNE_PlataformaElectoral",
                    "fuente_url": f"{PE}/api/v1/plan-gobierno/candidatos?IdProcesoElectoral={ID_EG}&TxCodExpedienteExt={l['txCodExpedienteExt']}",
                })
    return filas, {"listas": len(listas), "nuCantidadCandidatos_sumado_de_las_listas": declarados,
                   "filas_repetidas_dentro_de_su_lista_quitadas": repetidas[0]}


# ── ERM 2026: Voto Informado ────────────────────────────────────────────────────────────────────────────
def bajar_erm(cl: Cliente, hilos: int, muestra: int | None) -> tuple[list[dict], dict]:
    es_arreglo = lambda d: isinstance(d, list)                                     # noqa: E731
    es_sobre = lambda d: isinstance(d, dict) and "success" in d                    # noqa: E731
    deps = cl.json("vi/departamentos", "GET", f"{VI}/v1/departamentos", origen=VI_WEB, valido=es_arreglo) or []
    nombre_dep = {d["id"]: d["nombre"] for d in deps}

    def provincias(dep):
        return dep, cl.json(f"vi/provincias_{dep}", "GET", f"{VI}/v1/departamentos/{dep}/provincias", origen=VI_WEB, valido=es_arreglo) or []

    provs = en_paralelo(hilos, provincias, sorted(nombre_dep), "ERM provincias", 25)
    nombre_pro = {(dep, p["id"]): p["nombre"] for dep, ps in provs for p in ps}

    def distritos(dp):
        dep, pro = dp
        return dp, cl.json(f"vi/distritos_{dep}{pro}", "GET", f"{VI}/v1/departamentos/{dep}/provincias/{pro}/distritos",
                           origen=VI_WEB, valido=es_arreglo) or []

    dists = en_paralelo(hilos, distritos, sorted(nombre_pro), "ERM distritos", 100)
    nombre_dis = {(dep, pro, x["id"]): x["nombre"] for (dep, pro), ds in dists for x in ds}
    ambitos = sorted(nombre_dis)
    log(f"   [ERM] {len(nombre_dep)} departamentos, {len(nombre_pro)} provincias, {len(ambitos)} distritos")
    if muestra:
        ambitos = sorted(random.Random(2026).sample(ambitos, min(muestra, len(ambitos))))
        consultas = sorted({(a[0], None, None) for a in ambitos}) + ambitos
    else:
        # El pedido por departamento da TODAS las listas regionales (el de un distrito, sólo las que llevan consejero en su provincia).
        consultas = [(dep, None, None) for dep in sorted(nombre_dep)] + ambitos

    def organizaciones(a):
        dep, pro, dis = a
        cuerpo = {"dep": dep}
        if pro:
            cuerpo.update(pro=pro, dis=dis)
        return a, cl.json(f"vi/org/{dep}{pro or ''}{dis or ''}", "POST", f"{VI}/v1/candidatos/organizaciones", cuerpo, VI_WEB, es_sobre)

    listas: dict[int, dict] = {}
    sin_listas = 0
    for (dep, pro, dis), d in en_paralelo(hilos, organizaciones, consultas, "ERM listas por ámbito", 300):
        if d is None:
            continue
        bloques = d.get("data") or []
        if pro and not bloques:
            sin_listas += 1
        for b in bloques:
            tipo = int(b["idTipoEleccion"])
            for o in b.get("organizaciones") or []:
                for l in o.get("listas") or []:
                    ident = int(l["idSolicitudLista"])
                    if ident in listas:
                        continue
                    if tipo != 4 and not pro:
                        continue
                    listas[ident] = {"id": ident, "tipo": tipo, "tipo_nombre": b.get("tipoEleccion") or TIPOS_ERM.get(tipo),
                                     "partido": limpio(o.get("organizacionPolitica")), "expediente": limpio(l.get("codigoExpediente")),
                                     "dep": dep, "pro": pro if tipo in (5, 6) else None, "dis": dis if tipo == 6 else None}
    por_tipo = collections.Counter(l["tipo_nombre"] for l in listas.values())
    log(f"   [ERM] {len(listas)} listas ({dict(por_tipo)}); {sin_listas} distritos sin listas")

    def candidatos(l):
        cuerpo = {"dep": l["dep"], "idSolicitudLista": l["id"]}
        if l["pro"]:
            cuerpo["pro"] = l["pro"]
        if l["dis"]:
            cuerpo["dis"] = l["dis"]
        return l, cl.json(f"vi/lista/{l['id'] % 100:02d}/{l['id']}", "POST", f"{VI}/v1/candidatos/organizaciones/candidatos", cuerpo, VI_WEB, es_sobre)

    filas = []
    vacias = 0
    for l, d in en_paralelo(hilos, candidatos, [listas[k] for k in sorted(listas)], "ERM candidatos", 500):
        if d is None:
            continue
        n = 0
        for b in d.get("data") or []:
            for o in b.get("organizaciones") or []:
                for li in o.get("listas") or []:
                    if int(li.get("idSolicitudLista") or 0) != l["id"]:
                        continue
                    for grupo in li.values():
                        if not isinstance(grupo, list):
                            continue
                        for c in grupo:
                            if not isinstance(c, dict) or "cargoEleccion" not in c:
                                continue
                            ap1, ap2, nom = limpio(c.get("apellidoPaterno")), limpio(c.get("apellidoMaterno")), limpio(c.get("nombres"))
                            completo = " ".join(x for x in (ap1, ap2, nom) if x)
                            if not completo:
                                continue
                            n += 1
                            foto = str(c.get("urlFotoCandidato") or "")
                            m = re.fullmatch(r"([0-9A-Za-z]{8,12})\.(?:jpe?g|png|webp)", foto.strip(), re.I)
                            ubigeo = limpio(c.get("ubigeo")) or (l["dep"] + (l["pro"] or "00") + (l["dis"] or "00"))
                            dep, pro, dis = ubigeo[:2], ubigeo[2:4], ubigeo[4:6]
                            filas.append({
                                "proceso": "ERM2026", "anio": 2026,
                                "nombre": normalizar(completo), "nombre_original": completo,
                                "apellidos": " ".join(x for x in (ap1, ap2) if x) or None, "apellido_paterno": ap1, "apellido_materno": ap2, "nombres": nom, "orden_nombre": "fuente",
                                "nombre_fuente": " ".join(x for x in (nom, ap1, ap2) if x),
                                "documento": m.group(1) if m else None,
                                "cargo": cargo_canonico(c.get("cargoEleccion")), "cargo_fuente": limpio(c.get("cargoEleccion")),
                                "tipo_eleccion": l["tipo_nombre"], "partido": l["partido"], "resultado": None, "cargo_electo": None,
                                "estado": limpio(c.get("estadoCandidato")), "estado_lista": None,
                                "region": lugar(c.get("departamento")) or lugar(nombre_dep.get(dep)),
                                "provincia": lugar(c.get("provincia")) or (lugar(nombre_pro.get((dep, pro))) if pro != "00" else None),
                                "distrito": lugar(c.get("distrito")) or (lugar(nombre_dis.get((dep, pro, dis))) if dis != "00" else None),
                                "ubigeo_jne": ubigeo,
                                "numero_lista": c.get("numeroPosicion") if c.get("numeroPosicion") is not None else c.get("numeroCandidato"),
                                "expediente": l["expediente"], "id_hoja_vida": c.get("idHojaVida"),
                                "fuente": "JNE_VotoInformado", "fuente_url": f"{VI_WEB}/candidatos",
                            })
        if not n:
            vacias += 1
    return filas, {"ambitos_consultados": len(consultas), "listas": len(listas), "listas_por_tipo": dict(por_tipo),
                   "listas_sin_candidatos": vacias, "distritos_sin_listas": sin_listas}


# ── orden del nombre en EG (la Plataforma Electoral da «NOMBRES APELLIDOS» en un solo campo) ───────────
PARTICULAS = {"DE", "DEL", "LA", "LAS", "LOS", "SAN", "SANTA", "VDA", "VIUDA", "Y", "DA", "DI", "DOS", "VAN", "VON", "MC", "MAC", "D"}


def corte_por_particulas(t: list[str]) -> int:
    """Índice donde empiezan los apellidos: las dos últimas «unidades» (una partícula se pega a la palabra que sigue)."""
    i, unidades = len(t), 0
    while i > 1 and unidades < 2:
        i -= 1
        while i > 1 and t[i - 1] in PARTICULAS:
            i -= 1
        unidades += 1
    return max(1, i)


class Lexico:
    """Cuántas veces cada palabra aparece como nombre de pila y como apellido (de los candidatos de ERM, que vienen separados)."""

    PREVIO_TRES = -3.5       # castigo (log) a que los apellidos tengan tres palabras; medido con evaluar_corte.py
    PREVIO_CASADA = 0.0      # … salvo cuando el nombre termina en «DE APELLIDO»

    def __init__(self):
        self.nom = collections.Counter()
        self.ape = collections.Counter()

    def sumar(self, nombres: str, apellidos: str):
        self.nom.update(normalizar(nombres).split())
        self.ape.update(normalizar(apellidos).split())

    def corte(self, t: list[str]) -> int:
        if len(t) < 2:
            return len(t)
        if len(t) == 2:
            return 1
        a = 0.5
        ln = [math.log((self.nom[x] + a) / (self.nom[x] + self.ape[x] + 2 * a)) for x in t]
        la = [math.log((self.ape[x] + a) / (self.nom[x] + self.ape[x] + 2 * a)) for x in t]
        mejor, mejor_k = -1e18, corte_por_particulas(t)
        # «… APELLIDO APELLIDO DE APELLIDO» (apellido de casada) o «… VDA DE …»: ahí tres apellidos es lo normal.
        de_casada = len(t) >= 5 and ((t[-2] == "DE" and t[-3] not in PARTICULAS) or "VDA" in t or "VIUDA" in t)
        for k in range(1, len(t)):
            if t[k - 1] in PARTICULAS:
                continue      # los nombres no terminan en partícula: «DEL», «DE LA»… van con el apellido que sigue
            unidades = sum(1 for x in t[k:] if x not in PARTICULAS)
            previo = {1: -5.0, 2: 0.0, 3: (self.PREVIO_CASADA if de_casada else self.PREVIO_TRES)}.get(unidades, -7.0)
            if t[k] in PARTICULAS and k > 0 and unidades >= 2 and t[k - 1] not in PARTICULAS:
                previo -= 0.5        # un apellido paterno que empieza en partícula es menos común que un nombre que la lleva
            p = sum(ln[:k]) + sum(la[k:]) + previo
            if p > mejor:
                mejor, mejor_k = p, k
        return mejor_k


def ordenar_nombres_eg(eg: list[dict], erm: list[dict], electos: list[dict]) -> dict:
    """Llena nombre / nombre_original («APELLIDOS NOMBRES», como la tabla) en las filas de EG."""
    info: dict = {}
    # 1 · exacto: la misma persona (mismo documento) postuló en ERM, donde el nombre viene separado.
    por_doc = {}
    for r in erm:
        if r["documento"] and r["nombre_fuente"]:
            por_doc.setdefault(r["documento"], r)
    # 2 · exacto: los electos del reporte de la PNDA traen apellidos y nombres separados.
    por_electo = {normalizar(f"{e['nombres']} {e['ap1']} {e['ap2']}"): e for e in electos}
    # 3 · estimado: corte por léxico (si hay ERM) o por partículas.
    lex = None
    if erm:
        prueba = [r for r in erm if int(hashlib.md5(r["nombre"].encode()).hexdigest(), 16) % 5 == 0]
        resto = Lexico()
        for r in erm:
            if int(hashlib.md5(r["nombre"].encode()).hexdigest(), 16) % 5 != 0:
                resto.sumar(r["nombres"] or "", f"{r['apellido_paterno'] or ''} {r['apellido_materno'] or ''}")
        ok_lex = ok_part = n = 0
        for r in prueba:
            t = normalizar(r["nombre_fuente"]).split()
            real = len(normalizar(r["nombres"]).split())
            if len(t) < 2 or not real or real >= len(t):
                continue
            n += 1
            ok_lex += resto.corte(t) == real
            ok_part += corte_por_particulas(t) == real
        if n:
            info["acierto_del_corte_por_lexico_en_ERM"] = round(ok_lex / n, 4)
            info["acierto_del_corte_por_particulas_en_ERM"] = round(ok_part / n, 4)
            info["nombres_de_prueba"] = n
        lex = Lexico()
        for r in erm:
            lex.sumar(r["nombres"] or "", f"{r['apellido_paterno'] or ''} {r['apellido_materno'] or ''}")
    conocidos = aciertos = 0
    for r in eg:
        fuente = r["nombre_fuente"]
        clave = normalizar(fuente)
        tn = clave.split()
        otro = por_doc.get(r["documento"]) if r["documento"] else None
        e = por_electo.get(clave)
        if otro and sorted(normalizar(otro["nombre_fuente"]).split()) == sorted(tn):
            ap1, ap2, nom, orden = otro["apellido_paterno"], otro["apellido_materno"], otro["nombres"], "fuente_erm_mismo_documento"
        elif e:
            ap1, ap2, nom, orden = limpio(e["ap1"]), limpio(e["ap2"]), limpio(e["nombres"]), "fuente_electos_pnda"
        else:
            t = fuente.split()
            k = (lex.corte(tn) if lex else corte_por_particulas(tn)) if len(tn) == len(t) else corte_por_particulas(t)
            ap1, ap2, nom, orden = " ".join(t[k:]) or None, None, " ".join(t[:k]) or None, ("estimado_lexico" if lex else "estimado_particulas")
        if orden.startswith("fuente") and len(tn) > 2:
            # Segunda medida del corte estimado, ahora sobre nombres de EG cuyo orden real se conoce.
            real = len(normalizar(nom).split())
            if 0 < real < len(tn) and tn[:real] == normalizar(nom).split():
                conocidos += 1
                aciertos += (lex.corte(tn) if lex else corte_por_particulas(tn)) == real
        completo = " ".join(x for x in (ap1, ap2, nom) if x)
        exacto = orden.startswith("fuente")
        # El corte estimado sólo separa apellidos de nombres, no un apellido del otro: van juntos en «apellidos».
        r.update(nombre=normalizar(completo), nombre_original=completo, nombres=nom, orden_nombre=orden,
                 apellidos=" ".join(x for x in (ap1, ap2) if x) or None,
                 apellido_paterno=ap1 if exacto else None, apellido_materno=ap2 if exacto else None)
    if conocidos:
        info["acierto_del_corte_en_EG_con_orden_conocido"] = round(aciertos / conocidos, 4)
        info["nombres_de_EG_con_orden_conocido"] = conocidos
    info["orden_del_nombre"] = dict(collections.Counter(r["orden_nombre"] for r in eg))
    return info


def validar_documento_de_la_foto(eg: list[dict], erm: list[dict]) -> dict:
    """Quien postuló en las dos elecciones con el mismo nombre completo: ¿el documento que da la Plataforma Electoral (EG)
    es el del nombre del archivo de su foto en Voto Informado (ERM)? Un homónimo cuenta como «otro documento»."""
    por_nombre: dict[tuple, set] = {}
    for r in eg:
        por_nombre.setdefault(tuple(sorted(normalizar(r["nombre_fuente"]).split())), set()).add(r["documento"])
    mismos = otros = 0
    vistos = set()
    for r in erm:
        clave = tuple(sorted(r["nombre"].split()))
        if not r["documento"] or clave not in por_nombre or (clave, r["documento"]) in vistos:
            continue
        vistos.add((clave, r["documento"]))
        if r["documento"] in por_nombre[clave]:
            mismos += 1
        else:
            otros += 1
    return {"personas_con_el_mismo_nombre_en_EG_y_ERM": mismos + otros, "con_el_mismo_documento": mismos, "con_otro_documento": otros}


# ── electos de EG 2026: reporte «Autoridades electas» del JNE en la PNDA ───────────────────────────────
def electos_pnda(cache: Path) -> tuple[list[dict], str]:
    try:
        import xlrd
    except ImportError:
        return [], "falta xlrd (pip install xlrd): no se marcan los electos"
    s = requests.Session()
    s.headers.update({"User-Agent": UA})
    try:
        pagina = s.get(PNDA_ELECTAS, timeout=90).text
        urls = sorted(set(re.findall(r'href="(https?://www\.datosabiertos\.gob\.pe/sites/default/files/autoridades_electas_\d{8}[^"]*\.xls)"', pagina, re.I)),
                      key=lambda u: re.sub(r"\D", "", u.rsplit("/", 1)[1]))
        if not urls:
            return [], "la PNDA no lista ningún autoridades_electas_<fecha>.xls"
        url = urls[-1]
        destino = cache / "pnda" / url.rsplit("/", 1)[1]
        if not destino.exists():
            destino.parent.mkdir(parents=True, exist_ok=True)
            destino.write_bytes(s.get(url, timeout=180).content)
        sh = xlrd.open_workbook(str(destino)).sheet_by_index(0)
    except Exception as e:                                                         # noqa: BLE001
        return [], f"no se pudo leer el reporte de electos de la PNDA ({type(e).__name__})"
    cab = [re.sub(r"^(TX|NU)(?=[A-Z])", "", str(c).strip().upper()) for c in sh.row_values(0)]
    out = []
    for i in range(1, sh.nrows):
        r = dict(zip(cab, sh.row_values(i)))
        proceso = normalizar(r.get("PROCESOELECTORAL"))
        if "2026" not in proceso or "GENERALES" not in proceso:
            continue
        out.append({"nombres": str(r.get("NOMBRES") or "").strip(), "ap1": str(r.get("APELLIDOPATERNO") or "").strip(),
                    "ap2": str(r.get("APELLIDOMATERNO") or "").strip(), "partido": str(r.get("ORGANIZACIONPOLITICA") or "").strip(),
                    "cargo": str(r.get("CARGO") or "").strip(), "region": str(r.get("REGION") or "").strip(), "proceso": proceso})
    return out, f"{url} · {len(out)} electos de EG 2026"


def marcar_electos_eg(eg: list[dict], electos: list[dict]) -> dict:
    indice: dict[tuple, list[dict]] = {}
    for r in eg:
        indice.setdefault((normalizar(r["nombre_fuente"]), familia_cargo(r["cargo_fuente"])), []).append(r)
    sin_par = 0
    for e in electos:
        cands = indice.get((normalizar(f"{e['nombres']} {e['ap1']} {e['ap2']}"), familia_cargo(e["cargo"])), [])
        if len(cands) > 1:
            mismos = [c for c in cands if normalizar(c["partido"]) == normalizar(e["partido"])] or cands
            cands = [c for c in mismos if c["estado"] == "INSCRITO"] or mismos
            reg = normalizar(e["region"])
            cands = [c for c in cands if reg and normalizar(c["region"]) == reg] or cands
        if not cands:
            sin_par += 1
            continue
        cands[0]["resultado"] = "electo"
        cands[0]["cargo_electo"] = " ".join(e["cargo"].upper().split())
    for r in eg:
        # La proclamación de EG 2026 está completa: quien quedó inscrito y no figura entre los electos, no ganó.
        if r["resultado"] is None and electos and r["estado"] == "INSCRITO" and r["estado_lista"] == "INSCRITO":
            r["resultado"] = "no_electo"
    return {"electos_en_el_reporte": len(electos), "electos_sin_candidatura_empatada": sin_par,
            "filas_marcadas_electo": sum(1 for r in eg if r["resultado"] == "electo")}


# ── salida ──────────────────────────────────────────────────────────────────────────────────────────────
def resumen(filas: list[dict]):
    por_proceso = collections.Counter(r["proceso"] for r in filas)
    for proceso in sorted(por_proceso):
        de = [r for r in filas if r["proceso"] == proceso]
        personas = len({r["documento"] or r["nombre"] for r in de})
        log(f"\n{proceso}: {len(de)} candidaturas · {personas} personas · con documento {sum(1 for r in de if r['documento'])}"
            f" · documento de 8 dígitos {sum(1 for r in de if re.fullmatch(r'[0-9]{8}', r['documento'] or ''))}")
        for (tipo, cargo), n in sorted(collections.Counter((r["tipo_eleccion"], r["cargo"]) for r in de).items(), key=lambda x: (str(x[0][0]), -x[1])):
            log(f"   {n:>7}  {tipo} · {cargo}")
        log("   por estado de la candidatura:", dict(collections.Counter(r["estado"] for r in de).most_common()))
        if any(r["estado_lista"] for r in de):
            log("   por estado de la lista:", dict(collections.Counter(r["estado_lista"] for r in de).most_common()))
        log("   por resultado:", dict(collections.Counter(str(r["resultado"]) for r in de).most_common()))
        log("   organizaciones políticas:", len({r["partido"] for r in de}), "· regiones:", len({r["region"] for r in de if r["region"]}),
            "· provincias:", len({(r["region"], r["provincia"]) for r in de if r["provincia"]}),
            "· distritos:", len({(r["region"], r["provincia"], r["distrito"]) for r in de if r["distrito"]}))


def main():
    ap = argparse.ArgumentParser(description="Candidatos de EG 2026 y ERM 2026 (JNE) → JSON y CSV")
    ap.add_argument("--proceso", choices=["todos", "EG2026", "ERM2026"], default="todos")
    ap.add_argument("--salida", default=str(Path(__file__).resolve().parent / "salida"))
    ap.add_argument("--muestra", type=int, default=None, help="N listas por tipo (EG) y N distritos al azar (ERM), en vez de todo")
    ap.add_argument("--ritmo-eg", type=float, default=4.0, help="tope de pedidos por segundo a la Plataforma Electoral")
    ap.add_argument("--ritmo-erm", type=float, default=2.5,
                    help="tope de pedidos por segundo a Voto Informado (su nginx responde 429 por encima de unos 3 por segundo)")
    ap.add_argument("--hilos-eg", type=int, default=2, help="pedidos a la vez a la Plataforma Electoral")
    ap.add_argument("--hilos-erm", type=int, default=2, help="pedidos a la vez a Voto Informado")
    ap.add_argument("--refrescar", action="store_true", help="no usar la caché de respuestas")
    ap.add_argument("--solo-cache", action="store_true",
                    help="no hacer ningún pedido: arma la salida (con sufijo _parcial) con lo que ya esté en la caché")
    ap.add_argument("--sin-electos", action="store_true", help="no bajar el reporte de electos de la PNDA")
    args = ap.parse_args()

    salida = Path(args.salida)
    cache = salida / ("cache_muestra" if args.muestra else "cache")
    salida.mkdir(parents=True, exist_ok=True)
    cl = Cliente(cache, {"apiplataformaelectoral3.jne.gob.pe": args.ritmo_eg, "votoinformado.jne.gob.pe": args.ritmo_erm}, args.refrescar,
                 args.solo_cache)
    t0 = time.time()
    tiempos, extra = {}, {}
    eg: list[dict] = []
    erm: list[dict] = []

    def fase(nombre, fn, hilos):
        t = time.time()
        filas, inf = fn(cl, hilos, args.muestra)
        tiempos[nombre] = round(time.time() - t, 1)
        extra[nombre] = inf
        return filas

    with ThreadPoolExecutor(max_workers=2) as ex:      # un sitio distinto cada uno: van a la vez
        f_eg = ex.submit(fase, "EG2026", bajar_eg, args.hilos_eg) if args.proceso in ("todos", "EG2026") else None
        f_erm = ex.submit(fase, "ERM2026", bajar_erm, args.hilos_erm) if args.proceso in ("todos", "ERM2026") else None
        eg = f_eg.result() if f_eg else []
        erm = f_erm.result() if f_erm else []

    if eg:
        electos, nota = ([], "omitido") if args.sin_electos else electos_pnda(cache)
        log(f"\nElectos EG 2026 (PNDA): {nota}")
        extra["nombres_EG"] = ordenar_nombres_eg(eg, erm, electos)
        if electos:
            extra["electos_EG"] = marcar_electos_eg(eg, electos)
        if erm:
            extra["documento_de_la_foto_ERM_vs_documento_EG"] = validar_documento_de_la_foto(eg, erm)

    filas = eg + erm
    sufijo = "_muestra" if args.muestra else ("" if args.proceso == "todos" else "_" + args.proceso)
    if args.solo_cache:
        sufijo += "_parcial"
    ruta_json = salida / f"candidatos_2026{sufijo}.json"
    ruta_csv = salida / f"candidatos_2026{sufijo}.csv"
    ruta_json.write_text(json.dumps(filas, ensure_ascii=False, indent=0), "utf-8")
    with open(ruta_csv, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=CAMPOS, extrasaction="ignore")
        w.writeheader()
        w.writerows(filas)

    # Un tercer archivo con las columnas de jne_candidaturas, sólo con quien llegó inscrito a la elección (lista y candidato
    # INSCRITO). Las ausencias van como cadena vacía, igual que las deja load_jne_candidaturas.py en lo ya cargado.
    ruta_tabla = salida / f"jne_candidaturas_2026{sufijo}.csv"
    en_carrera = [r for r in filas if r["estado"] == "INSCRITO" and r["estado_lista"] in (None, "INSCRITO")]
    with open(ruta_tabla, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["numero_documento", "nombre", "nombre_original", "partido", "año", "cargo", "resultado", "region", "provincia",
                    "distrito", "numero_lista", "fuente", "fuente_url", "proceso", "tipo_eleccion", "expediente"])
        for r in en_carrera:
            w.writerow([r["documento"] or "", r["nombre"], r["nombre_original"], r["partido"] or "", 2026, r["cargo"] or "",
                        r["resultado"] or "", r["region"] or "", r["provincia"] or "", r["distrito"] or "",
                        "" if r["numero_lista"] is None else r["numero_lista"], r["fuente"], r["fuente_url"], r["proceso"],
                        r["tipo_eleccion"] or "", r["expediente"] or ""])
    extra["archivo_para_la_tabla"] = {"filas": len(en_carrera), "por_proceso": dict(collections.Counter(r["proceso"] for r in en_carrera))}

    resumen(filas)
    log("\nDetalle:", json.dumps(extra, ensure_ascii=False, indent=1))
    log(f"\nPedidos hechos: {dict(cl.pedidos)} · respuestas tomadas de la caché: {cl.de_cache} · fallidos: {len(cl.fallos)}"
        f" · respuestas 429 (ritmo bajado): { {s: r.frenadas for s, r in cl.ritmos.items() if r.frenadas} }")
    if cl.solo_cache:
        log(f"Sólo caché: {cl.faltan} respuestas no estaban en la caché (esas listas o ámbitos no salen en esta salida)")
    for clave, por_que in cl.fallos[:30]:
        log(f"   FALLÓ {clave}: {por_que}")
    log(f"Tiempo por fase (s): {tiempos} · total {time.time() - t0:.0f} s")
    log(f"Salida: {ruta_json}\n        {ruta_csv}\n        {ruta_tabla}")
    (salida / f"resumen{sufijo}.json").write_text(json.dumps({
        "generado": time.strftime("%Y-%m-%dT%H:%M:%S"), "filas": len(filas), "tiempos_s": tiempos, "pedidos": dict(cl.pedidos),
        "de_cache": cl.de_cache, "fallidos": cl.fallos, "detalle": extra,
        "por_proceso_y_cargo": {f"{p} | {t} | {c}": n for (p, t, c), n in sorted(collections.Counter(
            (r["proceso"], str(r["tipo_eleccion"]), str(r["cargo"])) for r in filas).items())}}, ensure_ascii=False, indent=1), "utf-8")
    sys.exit(1 if cl.fallos else 0)


if __name__ == "__main__":
    main()
