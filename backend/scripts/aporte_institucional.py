"""Aporte institucional: una organización (p. ej. la propia plataforma) financia N contratos de
una zona sin pasar por pasarela. Misma tabla y mismas reglas que cualquier aporte: la asignación
es FIFO sobre `cola_auditoria` (solo tipos/etapas activos, migración 19); nadie elige contratos.

  PGHOST=34.71.244.66 PGSSLMODE=require PYTHONPATH=. python backend/scripts/aporte_institucional.py \
      --nombre "Vigía Perú" --slug vigia-peru --email contacto@example.org \
      --logo https://.../assets/logo/vigia_peru_512.png --ubigeo 08 --contratos 10 \
      --mensaje "Aporte institucional: 10 contratos de bienes con adjudicación o contrato" [--pedir-documentos]

Imprime el código del comprobante (VIG-YYYY-NNNNN) y los OCIDs asignados. Con --pedir-documentos
abre un `pedido_descarga` por cada contrato asignado sin documentos vigentes, para bajarlos
enseguida con `python -m backend.batch.descargar pedidos` en vez de esperar la noche.
"""
from __future__ import annotations

import argparse
import sys

import psycopg

from backend.scrapers._core.pipeline import pg_dsn


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--nombre", required=True)
    ap.add_argument("--slug", required=True)
    ap.add_argument("--email", required=True, help="privado, nunca se publica")
    ap.add_argument("--logo", default=None)
    ap.add_argument("--tipo", default="organizacion", choices=("empresa", "organizacion", "persona"))
    ap.add_argument("--ruc", default=None)
    ap.add_argument("--ubigeo", required=True, help="'08' (departamento), '0801' (provincia) o '080101' (distrito)")
    ap.add_argument("--contratos", type=int, default=10)
    ap.add_argument("--mensaje", default=None)
    ap.add_argument("--pedir-documentos", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    with psycopg.connect(pg_dsn()) as conn, conn.cursor() as cur:
        cur.execute("SELECT id FROM financiadores WHERE slug = %s", (a.slug,))
        row = cur.fetchone()
        if row:
            fid = row[0]
            cur.execute("UPDATE financiadores SET nombre_publico=%s, logo_url=COALESCE(%s, logo_url), visible=true WHERE id=%s",
                        (a.nombre, a.logo, fid))
        else:
            cur.execute("""INSERT INTO financiadores (tipo, nombre_publico, slug, ruc, logo_url, email, visible)
                           VALUES (%s, %s, %s, %s, %s, %s, true) RETURNING id""",
                        (a.tipo, a.nombre, a.slug, a.ruc, a.logo, a.email))
            fid = cur.fetchone()[0]
        cur.execute("SELECT id, precio_pen FROM tarifas WHERE vigente_desde <= current_date ORDER BY vigente_desde DESC, id DESC LIMIT 1")
        tarifa_id, precio = cur.fetchone()
        cur.execute("SELECT nombre, nivel FROM zonas WHERE ubigeo = %s", (a.ubigeo,))
        z = cur.fetchone()
        if not z:
            print(f"✗ zona {a.ubigeo} no existe"); return 2
        cur.execute("SELECT count(*) FROM cola_auditoria WHERE ubigeo LIKE %s", (a.ubigeo + "%",))
        en_cola = cur.fetchone()[0]
        print(f"financiador #{fid} {a.nombre} · zona {z[0]} ({z[1]}) · en cola financiable: {en_cola} · "
              f"{a.contratos} contratos × S/ {precio} = S/ {float(precio) * a.contratos:.2f}")
        if a.dry_run:
            conn.rollback(); return 0
        cur.execute("""INSERT INTO contribuciones (codigo, financiador_id, ubigeo, contratos, tarifa_id, monto_pen, estado,
                                                   pasarela, pasarela_ref, validada_por, pagada_at, mensaje_publico)
                       VALUES (next_codigo_contribucion(), %s, %s, %s, %s, %s, 'pagada', 'institucional',
                               'aporte-institucional', 'sistema', now(), %s) RETURNING id, codigo""",
                    (fid, a.ubigeo, a.contratos, tarifa_id, float(precio) * a.contratos, a.mensaje))
        cid, codigo = cur.fetchone()
        cur.execute("SELECT asignar_contribucion(%s)", (cid,))
        n = cur.fetchone()[0]
        cur.execute("SELECT ocid FROM asignaciones WHERE contribucion_id = %s ORDER BY id", (cid,))
        ocids = [r[0] for r in cur.fetchall()]
        pedidos = 0
        if a.pedir_documentos:
            for o in ocids:
                cur.execute("SELECT count(*) FROM documentos_vigentes(%s)", (o,))
                if cur.fetchone()[0] == 0:
                    cur.execute("SELECT pedir_descarga(%s, 'financiado')", (o,))
                    pedidos += 1
        cur.execute("SELECT refresh_financiamiento()")
        conn.commit()
        print(f"✓ {codigo} · asignados {n}/{a.contratos} · pedidos de descarga abiertos: {pedidos}")
        print("ocids:", " ".join(ocids))
    return 0


if __name__ == "__main__":
    sys.exit(main())
