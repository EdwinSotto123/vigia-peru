"""Corrida DIARIA del lote en la nube (Cloud Run Job `vigia-batch`), sin la laptop ni el VPS de Lima.

Por qué existe: la API OCDS del OECE y prod1.seace.gob.pe dan 403 a las IP de GCP. Con RELAY_URL
(+ RELAY_TOKEN) todo GET sale por el Worker `vigia-relay` (Zúrich, 200 medido desde GCP) y el lote ya no
necesita una IP peruana. Las convocatorias nuevas entran por separado con el job `scraper-oece-ocds`
(diario); esto trae los DOCUMENTOS de los contratos que alguien financió y todavía no los tienen
(`pedidos_descarga`: los pide `asignar_contribucion` al asignar), que es lo que deja un contrato
"listo para leerse".

Una vuelta = pedidos → subir → ingestar. Se repite en tandas chicas hasta no tener pedidos o agotar el
tiempo: el disco de Cloud Run es memoria, así que cada tanda baja pocos GB y se sube antes de seguir.

  1. candado en GCS (una corrida a la vez) y estado SQLite bajado de GCS (el disco es efímero)
  2. tandas: descargar pedidos → subir lotes a GCS → ingestar (upsert + documentos_gcs + cierra pedidos)
  3. el estado vuelve a GCS al final, también si algo falló

Salida: 0 ok · 4 el SEACE cortó por ráfaga de 403 (se reintenta mañana) · 5 el relay no sirve · 2 candado
ocupado (otra corrida está en curso; no es un error).
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time

from . import BATCH_DIR, BUCKET_DEFAULT, PREFIJO_DEFAULT
from .estado_remoto import Conflicto, EstadoRemoto, Ocupado

log = logging.getLogger("batch.nube")


def _pedidos_pendientes() -> int:
    from .descargar import _pg

    with _pg() as conn, conn.cursor() as cur:
        cur.execute("""SELECT count(*) FROM pedidos_descarga
                       WHERE estado = 'pendiente' OR (estado = 'descargando' AND tomado_at < now() - interval '20 hours')""")
        return int(cur.fetchone()[0])


def _tanda(args: argparse.Namespace, minutos_restantes: float) -> int:
    """Una vuelta completa. Devuelve el código de salida de la descarga (0, 4 o 5)."""
    from . import descargar, ingestar, subir

    codigo = descargar.main(["pedidos", "--max", str(args.max_por_tanda), "--max-gb-por-noche", str(args.max_gb_por_tanda),
                             "--max-minutos", f"{max(1.0, minutos_restantes):.1f}"])
    # --limpiar: borra del disco (memoria) cada archivo ya verificado en GCS; el estado SQLite se conserva.
    subir.main(["--pendientes", "--bucket", args.bucket, "--prefijo", args.prefijo, "--limpiar"])
    ingestar.main(["--bucket", args.bucket, "--prefijo", args.prefijo])
    return codigo


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--bucket", default=BUCKET_DEFAULT)
    ap.add_argument("--prefijo", default=PREFIJO_DEFAULT)
    ap.add_argument("--max-minutos", type=float, default=float(os.getenv("NUBE_MAX_MINUTOS", "150")),
                    help="tiempo total de la corrida (debe quedar bajo el task-timeout del job)")
    ap.add_argument("--max-por-tanda", type=int, default=40, help="contratos por tanda")
    ap.add_argument("--max-gb-por-tanda", type=float, default=2.0, help="tope de descarga por tanda (el disco es memoria)")
    ap.add_argument("--max-tandas", type=int, default=30)
    ap.add_argument("--ttl-candado-horas", type=float, default=4.0)
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    t0 = time.monotonic()
    remoto = EstadoRemoto(args.bucket)
    try:
        remoto.tomar(args.ttl_candado_horas)
    except Ocupado as e:
        log.warning("%s", e)
        return 2
    codigo = 0
    try:
        remoto.bajar(BATCH_DIR / "estado.sqlite")
        for n in range(1, args.max_tandas + 1):
            restantes = args.max_minutos - (time.monotonic() - t0) / 60
            if restantes < 3:
                log.info("tiempo agotado tras %d tandas", n - 1)
                break
            pendientes = _pedidos_pendientes()
            log.info("━━ tanda %d · %d pedidos pendientes · %.0f min restantes", n, pendientes, restantes)
            if not pendientes:
                break
            codigo = _tanda(args, restantes)
            if codigo:
                log.warning("la descarga cortó con código %d: no se insiste hoy", codigo)
                break
    finally:
        try:
            # sanear=True: el disco de esta corrida desaparece; lo que quedó "bajado" sin subir vuelve a pendiente.
            remoto.subir(BATCH_DIR / "estado.sqlite", sanear=True)
        except Conflicto as e:
            log.error("%s", e)
            codigo = codigo or 1
        remoto.soltar()
    log.info("fin · %.1f min · código %d", (time.monotonic() - t0) / 60, codigo)
    return codigo


if __name__ == "__main__":
    sys.exit(main())
