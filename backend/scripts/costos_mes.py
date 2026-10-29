"""Lo que cuesta Vigía cada mes (migración 206): la factura de AWS por servicio, la tarifa de Cloudflare y el tipo de
cambio del BCRP, a `costos_mes` y `tipo_cambio_mes`. La IA de las lecturas no va aquí: se mide en cada lectura
(alertas.analisis_full->'llm_metrics') y la suma la API.

    python backend/scripts/costos_mes.py [--entorno prod|dev] [--mes 2026-10]

Sin --mes, el mes en curso (parcial: lo facturado hasta ayer más el ritmo de los últimos 7 días por los días que
faltan) y el anterior (cerrado). Cost Explorer cobra US$ 0,01 por consulta: son dos o tres por corrida.
Credenciales: el perfil de AWS de siempre (AWS_PROFILE); la base, por el túnel (infrastructure/aws/tunel_rds.py).
"""
from __future__ import annotations

import argparse
import calendar
import json
import subprocess
import sys
import urllib.request
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "infrastructure" / "aws"))
from tunel_rds import conexion  # noqa: E402

# Cada servicio de AWS en un rubro que se entienda («Amazon Relational Database Service» no le dice nada a nadie).
RUBROS_AWS = {
    "Amazon Relational Database Service": ("aws_base_datos", "Base de datos", "Las bases de datos (la pública y la de pruebas)"),
    "Amazon Elastic Compute Cloud - Compute": ("aws_servidores", "Servidores", "La salida a internet de la base y la conexión que la reparte"),
    "Amazon Virtual Private Cloud": ("aws_red", "Red", "Direcciones IP públicas"),
    "EC2 - Other": ("aws_discos", "Discos y transferencia", "Discos de los servidores y datos que salen"),
}
OTROS_AWS = ("aws_otros", "Otros servicios de AWS", None)

# Cloudflare: el plan de Workers (las páginas, la API y la captura de datos corren ahí). El uso por encima del plan no
# se mide aquí (Cloudflare no tiene una API de facturación pública).
CLOUDFLARE = ("cloudflare", "Páginas, API y captura de datos", "Cloudflare", "Plan Workers Paid", 5.00,
              "La tarifa del plan; el uso por encima del plan no se mide aquí.")

BCRP = "https://estadisticas.bcrp.gob.pe/estadisticas/series/api/PD04640PD/json/{desde}/{hasta}"


def aws_ce(desde: date, hasta: date, *filtro: str) -> dict:
    """Cost Explorer: el uso (sin créditos) por servicio entre `desde` (incluido) y `hasta` (excluido)."""
    cmd = ["aws", "ce", "get-cost-and-usage", "--time-period", f"Start={desde},End={hasta}",
           "--granularity", "MONTHLY", "--metrics", "UnblendedCost",
           "--filter", json.dumps({"Dimensions": {"Key": "RECORD_TYPE", "Values": ["Usage"]}}),
           "--group-by", "Type=DIMENSION,Key=SERVICE", "--output", "json", *filtro]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        raise SystemExit(f"Cost Explorer falló: {r.stderr.strip()[:300]}")
    por: dict[str, float] = {}
    for t in json.loads(r.stdout)["ResultsByTime"]:
        for g in t["Groups"]:
            por[g["Keys"][0]] = por.get(g["Keys"][0], 0.0) + float(g["Metrics"]["UnblendedCost"]["Amount"])
    return por


def tipo_cambio(mes: date) -> float | None:
    """El tipo de cambio venta promedio del mes según el BCRP (o None si no responde)."""
    fin = date(mes.year, mes.month, calendar.monthrange(mes.year, mes.month)[1])
    url = BCRP.format(desde=mes.isoformat(), hasta=min(fin, date.today()).isoformat())
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (vigia-peru costos)"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            datos = json.loads(resp.read().decode("utf-8", "replace"))
        vals = [float(p["values"][0]) for p in datos.get("periods", []) if p.get("values") and p["values"][0] not in ("n.d.", "")]
        return round(sum(vals) / len(vals), 4) if vals else None
    except Exception as e:  # el BCRP a veces no responde: se deja el último que haya
        print(f"  BCRP no respondió ({e}); se queda el tipo de cambio que haya")
        return None


def detalle_otros(servicios: list[str]) -> str:
    """Los servicios chicos de AWS, contados (la lista entera de nombres no le dice nada a nadie)."""
    return f"{len(servicios)} servicios chicos (registros, colas, claves, almacenamiento…)" if len(servicios) > 1 else (servicios[0] if servicios else "")


def agrupar(por_servicio: dict[str, float]) -> dict[str, list]:
    """Los servicios de AWS en sus rubros: {rubro: [título, detalle, US$, servicios]}."""
    agrupado: dict[str, list] = {}
    for servicio, usd in por_servicio.items():
        rubro, titulo, detalle = RUBROS_AWS.get(servicio, OTROS_AWS)
        a = agrupado.setdefault(rubro, [titulo, detalle, 0.0, []])
        a[2] += usd
        a[3].append(servicio)
    return agrupado


def filas_del_mes(mes: date) -> tuple[list[tuple], str, dict[str, float] | None, int]:
    """Las filas del mes, su nota, y (si el mes no cerró) el ritmo de los últimos días por servicio y en cuántos días."""
    hoy = date.today()
    fin = date(mes.year, mes.month, calendar.monthrange(mes.year, mes.month)[1])
    cerrado = fin < hoy
    hasta = (fin + timedelta(days=1)) if cerrado else hoy  # Cost Explorer: fin excluido; el día de hoy aún no se factura
    facturado = aws_ce(mes, hasta)
    al = hasta - timedelta(days=1)
    nota_mes = f"Facturado del 1 al {al.day} de {mes.month:02d}/{mes.year}"
    ritmo: dict[str, float] | None = None
    dias_reales = 0
    if cerrado:
        proyectado = facturado
    else:
        # El ritmo de los últimos 7 días por los días que faltan (la base pasó a AWS el 12 de octubre: el promedio del
        # mes entero subestimaba).
        dias = 7
        ritmo = aws_ce(max(mes, hoy - timedelta(days=dias)), hoy)
        dias_reales = (hoy - max(mes, hoy - timedelta(days=dias))).days or 1
        faltan = (fin - al).days
        proyectado = {k: v + ritmo.get(k, 0.0) / dias_reales * faltan for k, v in facturado.items()}
        for k, v in ritmo.items():
            proyectado.setdefault(k, v / dias_reales * faltan)
        nota_mes += f"; proyectado al mes con el ritmo de los últimos {dias_reales} días"
    filas = []
    for rubro, (titulo, detalle, usd, servicios) in agrupar(proyectado).items():
        if usd < 0.01:
            continue
        filas.append((mes, rubro, titulo, "AWS", detalle or detalle_otros(servicios), round(usd, 2), "factura", not cerrado,
                      al, nota_mes + ". Hoy lo cubren créditos promocionales de AWS: es lo que costará cuando se acaben."))
    rubro, titulo, proveedor, detalle, usd, nota = CLOUDFLARE
    filas.append((mes, rubro, titulo, proveedor, detalle, usd, "estimado", False, None, nota))
    return filas, nota_mes, ritmo, dias_reales


def filas_proyeccion(mes: date, ritmo: dict[str, float], dias: int) -> list[tuple]:
    """El mes siguiente, al ritmo de hoy, hasta que llegue su factura (así la meta del mes no queda sin costo)."""
    dias_mes = calendar.monthrange(mes.year, mes.month)[1]
    nota = (f"Proyección: el ritmo de los últimos {dias} días por los {dias_mes} del mes, hasta que llegue la factura. "
            "Hoy lo cubren créditos promocionales de AWS: es lo que costará cuando se acaben.")
    filas = [(mes, rubro, titulo, "AWS", detalle or detalle_otros(servicios), round(usd / dias * dias_mes, 2), "estimado", True, None, nota)
             for rubro, (titulo, detalle, usd, servicios) in agrupar(ritmo).items() if usd / dias * dias_mes >= 0.01]
    rubro, titulo, proveedor, detalle, usd, nota_cf = CLOUDFLARE
    filas.append((mes, rubro, titulo, proveedor, detalle, usd, "estimado", False, None, nota_cf))
    return filas


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--entorno", default="prod", choices=["prod", "dev"])
    ap.add_argument("--mes", help="AAAA-MM (sin él: el mes en curso y el anterior)")
    args = ap.parse_args()
    hoy = date.today()
    if args.mes:
        a, m = (int(x) for x in args.mes.split("-"))
        meses = [date(a, m, 1)]
    else:
        este = date(hoy.year, hoy.month, 1)
        anterior = date(este.year - (este.month == 1), 12 if este.month == 1 else este.month - 1, 1)
        meses = [anterior, este]
    with conexion(args.entorno) as con:
        cur = con.cursor()
        for mes in meses:
            filas, nota, ritmo, dias = filas_del_mes(mes)
            cur.execute("DELETE FROM costos_mes WHERE mes = %s", (mes,))
            cur.executemany(
                """INSERT INTO costos_mes (mes, rubro, titulo, proveedor, detalle, monto_usd, fuente, parcial, al, nota)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""", filas)
            tc = tipo_cambio(mes)
            if tc:
                cur.execute(
                    """INSERT INTO tipo_cambio_mes (mes, pen_por_usd, fuente) VALUES (%s, %s, %s)
                       ON CONFLICT (mes) DO UPDATE SET pen_por_usd = EXCLUDED.pen_por_usd, fuente = EXCLUDED.fuente, actualizado = now()""",
                    (mes, tc, "BCRP, tipo de cambio interbancario venta (PD04640PD), promedio del mes"))
            con.commit()
            total = sum(f[5] for f in filas)
            print(f"{mes:%Y-%m}: {len(filas)} rubros, US$ {total:,.2f} al mes ({nota}); tipo de cambio {tc or 'sin dato'}")
            for f in filas:
                print(f"   {f[2]:38s} {f[3]:10s} US$ {f[5]:8,.2f}  {f[6]}")
            # El mes en curso deja la proyección del siguiente (sin pisar una factura que ya exista).
            if ritmo:
                sig = date(mes.year + (mes.month == 12), 1 if mes.month == 12 else mes.month + 1, 1)
                cur.execute("SELECT count(*) FROM costos_mes WHERE mes = %s AND fuente = 'factura'", (sig,))
                if cur.fetchone()[0] == 0:
                    proy = filas_proyeccion(sig, ritmo, dias)
                    cur.execute("DELETE FROM costos_mes WHERE mes = %s", (sig,))
                    cur.executemany(
                        """INSERT INTO costos_mes (mes, rubro, titulo, proveedor, detalle, monto_usd, fuente, parcial, al, nota)
                           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""", proy)
                    con.commit()
                    print(f"{sig:%Y-%m} (proyección): US$ {sum(f[5] for f in proy):,.2f} al mes")


if __name__ == "__main__":
    main()
