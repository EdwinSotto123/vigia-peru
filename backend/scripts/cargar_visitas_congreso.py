#!/usr/bin/env python3
"""
Visitas al Congreso de la República (fase 2.1 del plan del 2026-10-27) → visitas_entidades (fuente 'congreso_visitas').

El Congreso no usa la plataforma de la PCM (visitas.servicios.gob.pe, que pide un captcha por consulta: no se automatiza):
tiene su propio registro de transparencia, con una consulta JSON pública por rango de fechas y sin captcha
(POST https://wb2server.congreso.gob.pe/regvisitastransparencia/filtrar). Un día por pedido (~1,200 visitas en un día de
sesiones; 744 KB), con una pausa entre pedidos. La historia empieza entre 2019 y 2021.

Cada día se reemplaza entero (borra las de esa fecha de esta fuente e inserta las de hoy): repetirlo no duplica nada. Al
final, refresca visita_entidad_ruc (el RUC de la entidad visitada, migración 186). Las empresas de quien visita
(empresa_visita) se rehacen con refrescar_empresas() (lo corre la carga de empresas; o a mano después del relleno).

Privacidad: el nombre y el documento de quien visita y el nombre de quien recibe se guardan para los cruces (como en las
demás visitas) y la API nunca los publica: de quien recibe, sólo su cargo y su oficina.

  python -u backend/scripts/cargar_visitas_congreso.py --entorno prod --desde 2020-01-01        # relleno (horas: detached)
  python -u backend/scripts/cargar_visitas_congreso.py --entorno prod                           # los últimos 14 días
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
import unicodedata
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

import psycopg2.extras

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "infrastructure" / "aws"))
from tunel_rds import conexion  # noqa: E402

URL = "https://wb2server.congreso.gob.pe/regvisitastransparencia/filtrar"
FUENTE = "congreso_visitas"
ENTIDAD = "CONGRESO DE LA REPUBLICA"
AGENTE = "VigiaPeru/1.0 (transparencia ciudadana; carga diaria con pausas)"
# Una entidad del Estado en el campo «entidad» de quien visita (lo demás con nombre es privado; vacío, a título personal).
PUBLICA = re.compile(
    r"\b(MINISTERIO|MUNICIPALIDAD|GOBIERNO REGIONAL|PODER JUDICIAL|MINISTERIO PUBLICO|FISCALIA|CONTRALORIA|DEFENSORIA|"
    r"UNIVERSIDAD NACIONAL|SUPERINTENDENCIA|PRESIDENCIA DEL CONSEJO|JURADO NACIONAL|OFICINA NACIONAL|REGISTRO NACIONAL|"
    r"POLICIA NACIONAL|EJERCITO|MARINA DE GUERRA|FUERZA AEREA|PROCURADURIA|TRIBUNAL CONSTITUCIONAL|BANCO CENTRAL|"
    r"ESSALUD|SEGURO SOCIAL|CONGRESO|PARLAMENTO|EMBAJADA|CONSULADO|PROGRAMA NACIONAL|INSTITUTO NACIONAL|ORGANISMO)\b"
)


def limpio(v) -> str:
    return re.sub(r"\s+", " ", str(v or "").replace("\xa0", " ")).strip()


def norma(s: str) -> str:
    s = unicodedata.normalize("NFD", s)
    return "".join(c for c in s if unicodedata.category(c) != "Mn").upper().strip()


def fecha(s) -> date | None:
    s = limpio(s)
    for f in ("%d/%m/%y", "%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, f).date()
        except ValueError:
            continue
    return None


def hora(s):
    s = limpio(s)
    for f in ("%H:%M", "%H:%M:%S"):
        try:
            return datetime.strptime(s, f).time()
        except ValueError:
            continue
    return None


def minutos(a, b) -> int | None:
    if not a or not b:
        return None
    d0 = datetime.combine(date(2000, 1, 1), a)
    d1 = datetime.combine(date(2000, 1, 1), b)
    if d1 < d0:
        return None  # salió otro día o el registro está mal: sin duración
    return int((d1 - d0).total_seconds() // 60)


def tipo_doc(s: str) -> str | None:
    t = norma(limpio(s))
    if not t:
        return None
    if t.startswith("DNI"):
        return "DNI"
    if "EXTRANJ" in t or t == "CE":
        return "CE"
    if t.startswith("PASAP"):
        return "PASAPORTE"
    return t


def pedir(d: date) -> list[dict]:
    cuerpo = json.dumps({"fechaDesde": d.isoformat(), "fechaHasta": d.isoformat(), "visitanteCampo": "", "visitanteNombres": "",
                         "empleadoCampo": "", "empleadoNombres": "", "vista": ""}).encode()
    req = urllib.request.Request(URL, data=cuerpo, headers={"Content-Type": "application/json", "User-Agent": AGENTE})
    for intento in range(1, 5):
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                datos = json.loads(r.read().decode("utf-8"))
                return datos if isinstance(datos, list) else []
        except Exception as e:  # noqa: BLE001 — la red o el servidor: se reintenta con más pausa
            print(f"  {d}: falló el pedido ({intento}): {str(e)[:120]}", flush=True)
            time.sleep(10 * intento)
    raise RuntimeError(f"{d}: el Congreso no respondió")


def fila(x: dict, d: date, ahora: datetime, huella: str) -> dict | None:
    visitante = limpio(x.get("entidadVisitanteNombreCompleto"))
    if not visitante:
        return None
    entidad = limpio(x.get("entidad")) or None
    ent_n = norma(entidad) if entidad else ""
    ti, to = hora(x.get("horaIngreso")), hora(x.get("fechaVisitaTermino"))
    lugar = ", ".join(v for v in (limpio(x.get("edificio")), limpio(x.get("ubicacion"))) if v) or None
    f_visita = fecha(x.get("fechaVisitaRecepcion")) or d
    return {
        "fecha_registro": fecha(x.get("fechaRegistro")),
        "fecha_visita": f_visita,
        "entidad_visitada": ENTIDAD,
        "entidad_visitada_norm": ENTIDAD,
        "visitante": visitante,
        "visitante_norm": norma(visitante.replace(",", " ")).replace("  ", " "),
        "tipo_documento": tipo_doc(x.get("entidadVisitanteTipoDocumento")),
        "numero_documento": limpio(x.get("entidadVisitanteDocumento")) or None,
        "tipo_entidad_visitante": ("publica" if PUBLICA.search(ent_n) else "privada") if entidad else "persona_natural",
        "entidad_visitante": entidad,
        "funcionario_visitado": None,
        "funcionario_nombre": norma(limpio(x.get("empleado"))) or None,
        "funcionario_area": limpio(x.get("centroCostoNombre")) or None,
        "funcionario_cargo": limpio(x.get("cargo")) or None,
        "hora_ingreso": ti,
        "hora_salida": to,
        "duracion_min": minutos(ti, to),
        "motivo": limpio(x.get("motivo")) or None,
        "lugar_especifico": lugar,
        "observacion": limpio(x.get("observacion")) or None,
        "fuente": FUENTE,
        "periodo": f_visita.strftime("%Y-%m"),
        "sha256": huella,
        "descargado_at": ahora,
    }


COLUMNAS = ["fecha_registro", "fecha_visita", "entidad_visitada", "entidad_visitada_norm", "visitante", "visitante_norm",
            "tipo_documento", "numero_documento", "tipo_entidad_visitante", "entidad_visitante", "funcionario_visitado",
            "funcionario_nombre", "funcionario_area", "funcionario_cargo", "hora_ingreso", "hora_salida", "duracion_min",
            "motivo", "lugar_especifico", "observacion", "fuente", "periodo", "sha256", "descargado_at"]


class Base:
    """Una sola conexión por el túnel para toda la corrida (abrir una por día eran segundos de SSM cada vez); si se
    corta, se vuelve a abrir."""

    def __init__(self, entorno: str) -> None:
        self.entorno = entorno
        self.cm = None
        self.c = None

    def cerrar(self) -> None:
        if self.cm is not None:
            try:
                self.cm.__exit__(None, None, None)
            except Exception:  # noqa: BLE001
                pass
        self.cm = self.c = None

    def hacer(self, fn):
        for intento in range(1, 4):
            try:
                if self.c is None:
                    self.cm = conexion(self.entorno)
                    self.c = self.cm.__enter__()
                r = fn(self.c)
                self.c.commit()
                return r
            except Exception as e:  # noqa: BLE001 — el túnel o la base: se reabre y se repite
                print(f"  la base falló ({intento}): {str(e)[:160]}", flush=True)
                self.cerrar()
                time.sleep(20)
        raise RuntimeError("la base no respondió tres veces")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--entorno", choices=["prod", "dev"], default="prod")
    ap.add_argument("--desde", help="AAAA-MM-DD; sin él, 14 días antes de la última visita cargada (o 2020-01-01)")
    ap.add_argument("--hasta", help="AAAA-MM-DD; sin él, hoy")
    ap.add_argument("--pausa", type=float, default=1.5, help="segundos entre pedidos")
    a = ap.parse_args()
    hasta = date.fromisoformat(a.hasta) if a.hasta else date.today()
    base = Base(a.entorno)

    def ultima(c):
        cur = c.cursor()
        cur.execute("SELECT max(fecha_visita) FROM visitas_entidades WHERE fuente = %s", (FUENTE,))
        return cur.fetchone()[0]

    if a.desde:
        desde = date.fromisoformat(a.desde)
    else:
        u = base.hacer(ultima)
        desde = (u - timedelta(days=14)) if u else date(2020, 1, 1)
    print(f"{a.entorno}: visitas del Congreso del {desde} al {hasta}", flush=True)
    total = vacios = 0
    d = desde
    while d <= hasta:
        datos = pedir(d)
        ahora = datetime.now()
        huella = hashlib.sha256(json.dumps(datos, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        filas = [f for f in (fila(x, d, ahora, huella) for x in datos) if f]

        def escribir(c, d=d, filas=filas):
            cur = c.cursor()
            cur.execute("SET statement_timeout = '300s'")
            # El día pedido se reemplaza entero.
            cur.execute("DELETE FROM visitas_entidades WHERE fuente = %s AND fecha_visita = %s", (FUENTE, d))
            if filas:
                psycopg2.extras.execute_values(
                    cur, f"INSERT INTO visitas_entidades ({', '.join(COLUMNAS)}) VALUES %s",
                    [tuple(f[k] for k in COLUMNAS) for f in filas], page_size=1000)

        base.hacer(escribir)
        total += len(filas)
        vacios += 0 if filas else 1
        if d.day == 1 or filas and d == hasta:
            print(f"  {d}: {len(filas)} visitas (van {total}; días sin visitas: {vacios})", flush=True)
        d += timedelta(days=1)
        time.sleep(a.pausa)
    def cerrar_corrida(c):
        cur = c.cursor()
        cur.execute("SET statement_timeout = 0")
        cur.execute("SELECT refrescar_visita_entidad_ruc()")
        n = cur.fetchone()[0]
        # Con la migración 188: las visitas de familiares de funcionarios y lo que cuenta la pestaña Visitas; con la 195, la
        # visita de un locador antes de su primera orden; con la 196, la de quien entra a la planilla.
        for fn in ("refrescar_visita_pariente", "refrescar_visitas_entidad", "refrescar_persona_visita_previa", "refrescar_planilla_extra"):
            cur.execute("SELECT to_regprocedure(%s) IS NOT NULL", (f"{fn}()",))
            if cur.fetchone()[0]:
                cur.execute(f"SELECT {fn}()")
        cur.execute("SELECT count(*), min(fecha_visita), max(fecha_visita) FROM visitas_entidades WHERE fuente = %s", (FUENTE,))
        return n, cur.fetchone()

    n, en_base = base.hacer(cerrar_corrida)
    base.cerrar()
    print(f"{a.entorno}: listo; {total} visitas en esta corrida; en la base {en_base}; visita_entidad_ruc {n}", flush=True)


if __name__ == "__main__":
    main()
