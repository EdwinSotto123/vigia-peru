"""Lee con el modelo las apelaciones del Tribunal ya descargadas y las carga, unidas a su contrato (migración 402).

    NORMAS_DESCARGAS=C:/Users/usuario/rag-legal-pe python -X utf8 backend/scripts/tribunal_cargar.py prod [--max N] [--hilos 2]

1. Enruta sin modelo (lector/tribunal.tipo_de): sólo las que resuelven un recurso de apelación.
2. El modelo lee el encabezado y la parte resolutiva (GLM por Workers AI); se comprueba que la cita del resolutivo y
   cada procedimiento estén en el texto.
3. Cada procedimiento se parte en tipo, número, año y siglas y se busca en convocatoria_nomenclatura. Se une sólo si
   queda UN contrato: por la nomenclatura escrita igual («exacta») o por siglas compatibles y el nombre de la entidad
   («sigla_y_entidad»). Con dos candidatos parecidos no se une: mejor perder un caso que atar mal uno.
Reanudable: las resoluciones ya cargadas se saltan.
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


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("entorno", choices=["prod", "dev"])
    ap.add_argument("--max", type=int, default=0)
    ap.add_argument("--hilos", type=int, default=2)
    a = ap.parse_args()
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
            d = json.loads(f.read_text(encoding="utf-8"))
            if T.tipo_de(d["texto"]) != "apelacion":
                continue
            pendientes.append(d)
            if a.max and len(pendientes) >= a.max:
                break
        print(f"{len(pendientes)} apelaciones por leer", flush=True)

        def leer(d):
            r = motor.llamar_texto(T, T.recorte(d["texto"]))
            s = r.get("salida")
            if r.get("estado") != "ok" or not s:
                with lock:
                    hechos["errores"] += 1
                return None
            return d, T.comprobar(s, d["texto"]), r

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
                                                         resultado_regla, resultado_ok)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (id) DO NOTHING""",
                    (d["id"], d.get("titulo") or "", int(m.group(1)) if m else None, int(m.group(2)) if m else d.get("anio"),
                     m.group(4).upper() if m else None, m.group(3).upper() if m else None, fecha, s.get("resultado"),
                     s.get("efectos") or [], s.get("entidad"), s.get("impugnante"), (s.get("motivo") or "")[:600],
                     (s.get("cita_resolutivo") or "")[:400], bool(s.get("_cita_ok")), d["url"], d.get("pdf"),
                     r.get("modelo"), T.VERSION, r.get("costo_usd"), s.get("_resultado_regla"), bool(s.get("_resultado_ok"))))
                for i, ptxt in enumerate(s.get("_procedimientos_ok") or [], 1):
                    ocid, via = unir(cur, ptxt, s.get("entidad") or "")
                    cur.execute("INSERT INTO tribunal_proceso (resolucion_id, n, texto, ocid, via) VALUES (%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING",
                                (d["id"], i, ptxt[:400], ocid, via))
                    hechos["procesos"] += 1
                    hechos["unidas"] += ocid is not None
                cn.commit()
                hechos["apelaciones"] += 1
                hechos["usd"] += r.get("costo_usd") or 0
                if hechos["apelaciones"] % 25 == 0:
                    print(f"{hechos['apelaciones']} cargadas; procesos unidos {hechos['unidas']} de {hechos['procesos']}; US$ {hechos['usd']:.3f}", flush=True)
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
    print(f"fin: {hechos}", flush=True)


if __name__ == "__main__":
    main()
