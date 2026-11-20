"""Lee con el modelo las apelaciones del Tribunal ya descargadas y las carga, unidas a su contrato (migración 402).

    NORMAS_DESCARGAS=C:/Users/usuario/rag-legal-pe python -X utf8 backend/scripts/tribunal_cargar.py prod [--max N] [--hilos 2]

1. Enruta sin modelo (lector/tribunal.tipo_de): sólo las que resuelven un recurso de apelación.
2. El modelo lee el encabezado y la parte resolutiva (GLM por Workers AI); se comprueba que la cita del resolutivo y
   cada procedimiento estén en el texto.
3. Cada procedimiento se parte en tipo, número, año y siglas y se busca en convocatoria_nomenclatura. Se une sólo si
   queda UN contrato: por la nomenclatura escrita igual («exacta») o por siglas compatibles y el nombre de la entidad
   («sigla_y_entidad»). Con dos candidatos parecidos no se une: mejor perder un caso que atar mal uno.
4. Recomprueba con la regla vigente (lector/tribunal.VERSION_REGLA) las resoluciones que se comprobaron con otra.
5. Cascada (migración 423): las que quedan en disputa (el modelo chico y la regla no dicen lo mismo) las relee el modelo
   grande (GLM 5.3), hasta --releer por corrida; si su lectura pasa la comprobación, reemplaza a la del chico.
Reanudable: las resoluciones ya cargadas se saltan.

Tope de tiempo (--tope-min, 50 por defecto): pasado el tope no se empieza ninguna lectura ni paso nuevo, y a los 5 minutos
más un vigilante cierra el proceso. El 2026-11-20 una corrida quedó colgada 6 h en una consulta: el túnel murió del lado
de AWS con el puerto local abierto (las keepalives no lo ven) y, con el log tomado, ninguna corrida siguiente leyó nada.
"""
from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import re
import sys
import threading
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

RAIZ_REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ_REPO / "backend"))
sys.path.insert(0, str(RAIZ_REPO / "infrastructure" / "aws"))
from lector import tribunal as T  # noqa: E402
from lector.motor_workers import MotorWorkers  # noqa: E402
from tunel_rds import conexion  # noqa: E402

TIPOS = [
    (r"ADJUDICACION SIMPLIFICADA|\bAS-", "AS"), (r"LICITACION PUBLICA|\bLP-", "LP"), (r"CONCURSO PUBLICO|\bCP-", "CP"),
    (r"SUBASTA INVERSA|\bSIE-", "SIE"), (r"COMPARACION DE PRECIOS|\bCOMPRE-", "COMPRE"),
    (r"CONTRATACION DIRECTA|\bDIRECTA-", "DIRECTA"), (r"SELECCION DE CONSULTORES INDIVIDUALES|\bSCI-", "SCI"),
    (r"PROCEDIMIENTO ESPECIAL|\bPEC-", "PEC"),
]
GENERICAS = {"CS", "OEC", "CE", "CEP", "CES", "CEA", "CSE", "OC", "PRIMERA", "SEGUNDA", "TERCERA", "CUARTA", "QUINTA",
             "CONVOCATORIA", "ITEM", "ITEMS", "PAQUETE", "DERIVADA", "DERIVADO", "NRO", "DE", "DEL", "LA", "EL", "LOS", "LAS",
             "PARA", "POR", "CON", "EN", "COMITE", "SELECCION"}
# Sólo las palabras vacías: «municipalidad», «gobierno regional», «provincial» SÍ cuentan (sin ellas el Gobierno Regional de
# Lambayeque y la Municipalidad Provincial de Lambayeque se parecían del todo).
VACIAS_ENTIDAD = {"DE", "DEL", "LA", "EL", "LOS", "LAS", "Y", "SEDE", "CENTRAL", "SA", "SAC", "EIRL"}
CONV = {"PRIMERA": 1, "SEGUNDA": 2, "TERCERA": 3, "CUARTA": 4, "QUINTA": 5}


def mayus(t: str) -> str:
    t = unicodedata.normalize("NFD", t or "")
    return "".join(c for c in t if unicodedata.category(c) != "Mn").upper()


def siglas(t: str) -> set[str]:
    return {w for w in re.split(r"[^A-Z0-9]+", mayus(t).replace(".", "")) if len(w) >= 2 and not w.isdigit() and w not in GENERICAS}


def compacto(t: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", re.sub(r"(^|[^0-9])0+([0-9])", r"\1\2", mayus(t)))


def partir(texto: str) -> dict | None:
    t = mayus(texto)
    tipo = next((s for p, s in TIPOS if re.search(p, t)), None)
    m = re.search(r"(?:^|[^0-9])0*([0-9]{1,5})\s*[-–/ ]\s*((?:19|20)[0-9]{2})(?![0-9])(.*)$", t)
    if not tipo or not m:
        return None
    resto = re.sub(r"\(.*?\)", " ", m.group(3))
    conv = next((v for k, v in CONV.items() if k + " CONV" in t), None)
    fin = re.search(r"-\s*([0-9]{1,2})\s*(?:$|[^0-9A-Z])", resto)
    if conv is None and fin:
        conv = int(fin.group(1))
    return {"tipo": tipo, "num": int(m.group(1)), "anio": int(m.group(2)), "resto": resto, "conv": conv}


def entidad_parecida(a: str, b: str) -> float:
    x = {w for w in re.split(r"[^A-Z0-9]+", mayus(a)) if len(w) >= 3 and w not in VACIAS_ENTIDAD}
    y = {w for w in re.split(r"[^A-Z0-9]+", mayus(b)) if len(w) >= 3 and w not in VACIAS_ENTIDAD}
    return len(x & y) / len(x | y) if x and y else 0.0


def unir(cur, texto: str, entidad: str) -> tuple[str | None, str | None]:
    p = partir(texto)
    if not p:
        return None, None
    cur.execute("""SELECT cn.ocid, cn.prefijo, cn.num, cn.anio, cn.sigla, cn.conv, cn.entidad_ruc, e.nombre
                     FROM convocatoria_nomenclatura cn LEFT JOIN entidades e ON btrim(e.ruc::text) = cn.entidad_ruc
                    WHERE cn.tipo = %s AND cn.num = %s AND cn.anio = %s""", (p["tipo"], p["num"], p["anio"]))
    cands = cur.fetchall()
    if not cands:
        return None, None
    ct = compacto(texto)
    exactas = [c for c in cands if compacto(f"{c[1]}-{c[2]}-{c[3]}-{c[4]}") in ct]
    tt = siglas(p["resto"])
    def puntos(c):
        sc = siglas(c[4])
        compatible = bool(sc) and (sc <= tt or (len(tt) >= 1 and tt <= sc))
        return compatible, entidad_parecida(entidad, c[7] or "")
    if exactas:
        grupo, via = exactas, "exacta"
    else:
        evaluados = [(c, *puntos(c)) for c in cands]
        compatibles = [x for x in evaluados if x[1] and x[2] >= 0.34]
        if not compatibles:
            return None, None
        mejor = max(x[2] for x in compatibles)
        grupo, via = [x[0] for x in compatibles if x[2] >= mejor - 0.05], "sigla_y_entidad"
    # «Abreviado» o no son procedimientos distintos con el mismo número: se respeta lo que dice el texto.
    abreviado = "ABREVIAD" in mayus(texto)
    grupo = [c for c in grupo if ("ABR" in c[1]) == abreviado] or grupo
    # Una sola entidad; de ella, la convocatoria pedida (o la única).
    if len({c[6] for c in grupo}) != 1:
        return None, None
    if p["conv"] is not None:
        grupo = [c for c in grupo if c[5] == p["conv"]] or grupo
    familias = {(c[1], c[4], c[5]) for c in grupo}
    if len(familias) != 1:
        return None, None
    # La misma nomenclatura con dos OCID es la misma convocatoria registrada dos veces: vale la del código del SEACE.
    return sorted(c[0] for c in grupo)[0] if all(not c[0].isdigit() for c in grupo) else min(c[0] for c in grupo if c[0].isdigit()), via


def _texto(por_id: dict, pid) -> str | None:
    f = por_id.get(str(pid))
    if not f:
        return None
    try:
        return json.loads(f.read_text(encoding="utf-8")).get("texto") or ""
    except (ValueError, OSError):
        return None


def insertar_parte(cur, pid: int, rol: str, n: int, nombre: str, ocids: list[str] | None = None) -> bool:
    """Una parte con su RUC 20 (tribunal_ruc_de en los procesos de la resolución); un consorcio, por sus integrantes."""
    if ocids is None:
        cur.execute("SELECT array_agg(ocid) FROM tribunal_proceso WHERE resolucion_id = %s AND ocid IS NOT NULL", (pid,))
        ocids = cur.fetchone()[0] or []
    rucs: dict[str, str] = {}
    for cand in T.nombres_de(nombre):
        cur.execute("SELECT ruc, via FROM tribunal_ruc_de(%s, %s)", (cand, ocids))
        for ruc, via in cur.fetchall():
            rucs.setdefault(ruc, via)
    for ruc, via in (list(rucs.items()) or [(None, None)]):
        cur.execute("""INSERT INTO tribunal_parte (resolucion_id, rol, n, nombre, ruc, via) VALUES (%s,%s,%s,%s,%s,%s)
                       ON CONFLICT DO NOTHING""", (pid, rol, n, nombre[:300], ruc, via))
    return bool(rucs)


def guardar_partes(cur, pid: int, s: dict) -> int:
    """El adjudicatario y los destinatarios del sancionador (migración 424), cada nombre comprobado en el texto, unidos a
    su RUC 20 con tribunal_ruc_de() en los procesos de la resolución. Un consorcio se parte en sus integrantes."""
    cur.execute("SELECT array_agg(ocid) FROM tribunal_proceso WHERE resolucion_id = %s AND ocid IS NOT NULL", (pid,))
    ocids = cur.fetchone()[0] or []
    cur.execute("DELETE FROM tribunal_parte WHERE resolucion_id = %s", (pid,))
    partes = [("adjudicatario", s.get("_adjudicatario_ok"))] if s.get("_adjudicatario_ok") else []
    partes += [("sancionador", x) for x in s.get("_sancionador_ok") or []]
    return sum(insertar_parte(cur, pid, rol, n, nombre, ocids) for n, (rol, nombre) in enumerate(partes, 1))


# Hasta cuándo se puede empezar algo nuevo (time.monotonic). Lo fija main() con --tope-min.
LIMITE = float("inf")


def hay_tiempo() -> bool:
    return time.monotonic() < LIMITE


def vigilante(minutos: float) -> None:
    """Cierra el proceso pase lo que pase (una consulta colgada no termina nunca): libera el log para la corrida siguiente."""
    def cortar():
        print(f"vigilante: {minutos:.0f} min sin terminar, se cierra el proceso", flush=True)
        os._exit(3)
    t = threading.Timer(minutos * 60, cortar)
    t.daemon = True
    t.start()


def actualizar_version(cn, cur, por_id: dict, motor, maximo: int, hechos: dict, hilos: int = 3) -> int:
    """Las leídas con un lector anterior (VERSION) se releen con el modelo chico por tramos, para sumar lo que el lector
    nuevo trae (v2: adjudicatario, sancionador, infracción). El resultado comprobado NO se toca, salvo que estuviera en
    disputa y la lectura nueva pase la comprobación: la relectura del modelo grande no se pierde. El modelo lee en
    `hilos` a la vez (~45 s cada lectura); la base se escribe en este hilo."""
    if maximo <= 0:
        return 0
    cur.execute("SELECT id, resultado_ok FROM tribunal_resolucion WHERE version IS DISTINCT FROM %s ORDER BY id DESC LIMIT %s",
                (T.VERSION, maximo))
    filas = [(pid, ok, t) for pid, ok in cur.fetchall() if (t := _texto(por_id, pid)) is not None]

    def leer(fila):
        pid, ok, texto = fila
        if not hay_tiempo():
            return pid, ok, None, {"estado": "tope"}
        r = motor.llamar_texto(T, T.recorte(texto))
        s = r.get("salida")
        if r.get("estado") != "ok" or not s:
            return pid, ok, None, r
        return pid, ok, T.comprobar(T.normalizar(s), texto), r

    n = 0
    with ThreadPoolExecutor(max(1, hilos)) as ex:
        for pid, ok, s, r in ex.map(leer, filas):
            hechos["usd"] += r.get("costo_usd") or 0
            if s is None:
                hechos["errores"] += r.get("estado") != "tope"
                continue
            cur.execute("""UPDATE tribunal_resolucion SET adjudicatario = %s, infraccion = %s, version = %s,
                                  costo_usd = COALESCE(costo_usd, 0) + %s WHERE id = %s""",
                        (s.get("_adjudicatario_ok") or None, (s.get("infraccion") or []) if s.get("_sancionador_ok") else [],
                         T.VERSION, r.get("costo_usd") or 0, pid))
            if not ok and s["_resultado_ok"]:
                cur.execute("""UPDATE tribunal_resolucion SET resultado = %s, efectos = %s, motivo = %s, cita = %s, cita_ok = %s,
                                      modelo = %s, resultado_regla = %s, resultado_ok = true, corregido_ok = %s WHERE id = %s""",
                            (s.get("resultado"), s.get("efectos") or [], (s.get("motivo") or "")[:600],
                             (s.get("cita_resolutivo") or "")[:400], bool(s.get("_cita_ok")), r.get("modelo"),
                             s.get("_resultado_regla"), s["_corregido_ok"], pid))
            hechos["partes_unidas"] = hechos.get("partes_unidas", 0) + guardar_partes(cur, pid, s)
            cn.commit()
            n += 1
    if n:
        print(f"releídas con el lector {T.VERSION}: {n}", flush=True)
    return n


def recomprobar(cn, cur, por_id: dict) -> int:
    """La regla mejora (VERSION_REGLA): las ya cargadas se vuelven a comprobar contra su texto, sin modelo."""
    cur.execute("SELECT id, resultado FROM tribunal_resolucion WHERE regla_version IS DISTINCT FROM %s", (T.VERSION_REGLA,))
    n = 0
    for pid, resultado in cur.fetchall():
        if not hay_tiempo():
            break   # lo que falta queda con la regla anterior: la próxima corrida sigue
        texto = _texto(por_id, pid)
        if texto is None:
            continue
        s = T.comprobar({"resultado": resultado, "cita_resolutivo": "", "procedimientos": []}, texto)
        cur.execute("""UPDATE tribunal_resolucion SET resultado_regla = %s, resultado_ok = %s, corregido_ok = %s, regla_version = %s
                        WHERE id = %s""", (s["_resultado_regla"], s["_resultado_ok"], s["_corregido_ok"], T.VERSION_REGLA, pid))
        # Regla 3: los destinatarios del sancionador ya guardados se recomprueban en el punto que lo ordena.
        cur.execute("SELECT DISTINCT n, nombre FROM tribunal_parte WHERE resolucion_id = %s AND rol = 'sancionador' ORDER BY n", (pid,))
        previos = [x[1] for x in cur.fetchall()]
        if previos:
            quedan = T.sancionados_en(texto, previos)
            if quedan != previos:
                cur.execute("DELETE FROM tribunal_parte WHERE resolucion_id = %s AND rol = 'sancionador'", (pid,))
                cur.execute("SELECT COALESCE(max(n), 0) FROM tribunal_parte WHERE resolucion_id = %s", (pid,))
                base = cur.fetchone()[0]
                for i, nombre in enumerate(quedan, base + 1):
                    insertar_parte(cur, pid, "sancionador", i, nombre)
                if not quedan:
                    cur.execute("UPDATE tribunal_resolucion SET infraccion = '{}' WHERE id = %s", (pid,))
                print(f"   {pid}: sancionador {len(previos)} → {len(quedan)}", flush=True)
        n += 1
        if n % 500 == 0:
            cn.commit()
    cn.commit()
    if n:
        print(f"recomprobadas con la regla {T.VERSION_REGLA}: {n}", flush=True)
    return n


def releer_disputas(cn, cur, por_id: dict, maximo: int, hechos: dict) -> dict:
    """El modelo grande relee las que el chico y la regla no leen igual. Si su resultado pasa la comprobación exacta, o
    coincide con la regla en si el Tribunal corrigió el proceso y el chico no, su lectura reemplaza a la del chico. Lo
    que dijo queda en segunda_lectura y no se relee otra vez."""
    if maximo <= 0:
        return {}
    cur.execute("""SELECT id, resultado, corregido_ok FROM tribunal_resolucion
                    WHERE NOT resultado_ok AND resultado_regla IS NOT NULL AND segunda_lectura IS NULL
                    ORDER BY id DESC LIMIT %s""", (maximo,))
    filas = cur.fetchall()
    if not filas:
        return {}
    grande = MotorWorkers(T.MODELO_GRANDE)
    hecho = {"releidas": 0, "reemplazadas": 0}
    for pid, resultado, corregido_ok in filas:
        if not hay_tiempo():
            break
        texto = _texto(por_id, pid)
        if texto is None:
            continue
        r = grande.llamar_texto(T, T.recorte(texto))
        s = r.get("salida")
        hechos["usd"] += r.get("costo_usd") or 0
        if r.get("estado") != "ok" or not s:
            hechos["errores"] += 1
            continue
        s = T.comprobar(T.normalizar(s), texto)
        hecho["releidas"] += 1
        mejor = s["_resultado_ok"] or (s["_corregido_ok"] and not corregido_ok)
        if mejor:
            cur.execute(
                """UPDATE tribunal_resolucion SET resultado = %s, efectos = %s, motivo = %s, cita = %s, cita_ok = %s,
                          modelo = %s, costo_usd = COALESCE(costo_usd, 0) + %s, resultado_ok = %s, corregido_ok = %s,
                          segunda_lectura = %s
                    WHERE id = %s""",
                (s.get("resultado"), s.get("efectos") or [], (s.get("motivo") or "")[:600], (s.get("cita_resolutivo") or "")[:400],
                 bool(s.get("_cita_ok")), r.get("modelo"), r.get("costo_usd") or 0, s["_resultado_ok"], s["_corregido_ok"],
                 s.get("resultado"), pid))
            hecho["reemplazadas"] += 1
        else:
            cur.execute("UPDATE tribunal_resolucion SET segunda_lectura = %s, costo_usd = COALESCE(costo_usd, 0) + %s WHERE id = %s",
                        (s.get("resultado") or "otro", r.get("costo_usd") or 0, pid))
        cn.commit()
    print(f"disputas releídas con {T.MODELO_GRANDE}: {hecho['releidas']}, reemplazadas {hecho['reemplazadas']}", flush=True)
    return hecho


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("entorno", choices=["prod", "dev"])
    ap.add_argument("--max", type=int, default=0)
    ap.add_argument("--hilos", type=int, default=2)
    ap.add_argument("--releer", type=int, default=40, help="disputas que relee el modelo grande por corrida (0: ninguna)")
    ap.add_argument("--tope-min", type=float, default=50,
                    help="minutos tras los que no se empieza nada nuevo; a los 5 más, el vigilante cierra el proceso")
    ap.add_argument("--actualizar", type=int, default=60,
                    help="leídas con un lector anterior que se releen por corrida (0: ninguna)")
    a = ap.parse_args()
    global LIMITE
    LIMITE = time.monotonic() + a.tope_min * 60
    vigilante(a.tope_min + 5)
    sys.stdout.reconfigure(encoding="utf-8")
    raiz = Path(os.environ["NORMAS_DESCARGAS"]) / "tribunal"
    archivos = sorted(raiz.glob("*/*.json"), reverse=True)
    motor = MotorWorkers()
    lock = threading.Lock()
    hechos = {"leidas": 0, "apelaciones": 0, "unidas": 0, "procesos": 0, "usd": 0.0, "errores": 0}
    with conexion(a.entorno) as cn:
        cur = cn.cursor()
        cur.execute("SELECT id FROM tribunal_resolucion")
        ya = {r[0] for r in cur.fetchall()}
        pendientes = []
        for f in archivos:
            pid = int(f.stem)
            if pid in ya:
                continue
            try:
                d = json.loads(f.read_text(encoding="utf-8"))
            except (ValueError, OSError) as e:
                # Uno a medio escribir por una versión vieja del bajador, o en uso: queda para la próxima corrida.
                print(f"   salto {f.name}: {e}", flush=True)
                continue
            if T.tipo_de(d.get("texto") or "") != "apelacion":
                continue
            pendientes.append(d)
            if a.max and len(pendientes) >= a.max:
                break
        print(f"{len(pendientes)} apelaciones por leer", flush=True)

        def leer(d):
            if not hay_tiempo():
                return None
            r = motor.llamar_texto(T, T.recorte(d["texto"]))
            s = r.get("salida")
            if r.get("estado") != "ok" or not s:
                with lock:
                    hechos["errores"] += 1
                return None
            return d, T.comprobar(T.normalizar(s), d["texto"]), r

        with ThreadPoolExecutor(max(1, a.hilos)) as ex:
            for res in ex.map(leer, pendientes):
                if not res:
                    continue
                d, s, r = res
                m = re.search(r"(\d+)-(20\d\d)-(TCE|TCP)-(S\d)", d.get("titulo") or "", re.I)
                fecha = s.get("fecha") if re.match(r"^\d{4}-\d{2}-\d{2}$", s.get("fecha") or "") else None
                cur.execute(
                    """INSERT INTO tribunal_resolucion (id, titulo, numero, anio, sala, tribunal, fecha, resultado, efectos,
                                                         entidad, impugnante, motivo, cita, cita_ok, url, pdf, modelo, version, costo_usd,
                                                         resultado_regla, resultado_ok, corregido_ok, regla_version,
                                                         adjudicatario, infraccion)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (id) DO NOTHING""",
                    (d["id"], d.get("titulo") or "", int(m.group(1)) if m else None, int(m.group(2)) if m else d.get("anio"),
                     m.group(4).upper() if m else None, m.group(3).upper() if m else None, fecha, s.get("resultado"),
                     s.get("efectos") or [], s.get("entidad"), s.get("impugnante"), (s.get("motivo") or "")[:600],
                     (s.get("cita_resolutivo") or "")[:400], bool(s.get("_cita_ok")), d["url"], d.get("pdf"),
                     r.get("modelo"), T.VERSION, r.get("costo_usd"), s.get("_resultado_regla"), bool(s.get("_resultado_ok")),
                     bool(s.get("_corregido_ok")), T.VERSION_REGLA, s.get("_adjudicatario_ok") or None,
                     (s.get("infraccion") or []) if s.get("_sancionador_ok") else []))
                for i, ptxt in enumerate(s.get("_procedimientos_ok") or [], 1):
                    ocid, via = unir(cur, ptxt, s.get("entidad") or "")
                    cur.execute("INSERT INTO tribunal_proceso (resolucion_id, n, texto, ocid, via) VALUES (%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING",
                                (d["id"], i, ptxt[:400], ocid, via))
                    hechos["procesos"] += 1
                    hechos["unidas"] += ocid is not None
                hechos["partes_unidas"] = hechos.get("partes_unidas", 0) + guardar_partes(cur, d["id"], s)
                cn.commit()
                hechos["apelaciones"] += 1
                hechos["usd"] += r.get("costo_usd") or 0
                if hechos["apelaciones"] % 25 == 0:
                    print(f"{hechos['apelaciones']} cargadas; procesos unidos {hechos['unidas']} de {hechos['procesos']}; US$ {hechos['usd']:.3f}", flush=True)
        por_id = {f.stem: f for f in archivos}
        hechos["recomprobadas"] = recomprobar(cn, cur, por_id)
        hechos["actualizadas"] = actualizar_version(cn, cur, por_id, motor, a.actualizar, hechos, a.hilos) if hay_tiempo() else 0
        hechos.update(releer_disputas(cn, cur, por_id, a.releer, hechos) if hay_tiempo() else {})
        # La bitácora de las fuentes que se cargan desde la PC (GET /estado/datos, estado_fuentes del MCP): una fila por
        # corrida, también sin apelaciones nuevas, para que se vea que la tarea sigue viva.
        clave = datetime.datetime.now().strftime("%Y-%m-%dT%H")
        resumen = json.dumps(hechos, sort_keys=True)
        cur.execute(
            """INSERT INTO datasets_cargas (fuente, clave, tabla, sha256, filas, fuente_url, descargado_at, cargado_at, estado)
               VALUES ('tribunal_apelaciones', %s, 'tribunal_resolucion', %s, %s, %s, now(), now(), 'ok')
               ON CONFLICT (fuente, clave) DO UPDATE SET sha256 = EXCLUDED.sha256, filas = EXCLUDED.filas, cargado_at = now(), estado = 'ok'""",
            (clave, hashlib.sha256(resumen.encode()).hexdigest(), hechos["apelaciones"],
             "https://www.gob.pe/institucion/oece/colecciones/68030-resoluciones-del-tribunal-de-contrataciones-publicas"))
        cn.commit()
        # Las entidades cuyos procesos el Tribunal corrige más que el resto del país (migración 422), con lo recién leído.
        if hechos["apelaciones"] or hechos["recomprobadas"] or hechos.get("reemplazadas") or hechos["actualizadas"]:
            # Las entidades cuyos procesos el Tribunal corrige (422) y las señales de las partes (424).
            for funcion in ("refrescar_tribunal_entidad", "refrescar_cruce_tribunal"):
                try:
                    cur.execute("SET statement_timeout = 0")
                    cur.execute(f"SELECT {funcion}()")
                    print(f"{funcion}: {cur.fetchone()[0]}", flush=True)
                    cn.commit()
                except Exception as e:  # noqa: BLE001 — la carga ya quedó hecha
                    cn.rollback()
                    print(f"{funcion} no se refrescó: {str(e)[:160]}", flush=True)
    print(f"fin: {hechos}", flush=True)


if __name__ == "__main__":
    main()
