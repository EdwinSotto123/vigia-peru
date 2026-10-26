#!/usr/bin/env python3
"""
Aplica la migración 137 (nepotismo como señal) y refresca la señal, en un entorno.

  MSYS_NO_PATHCONV=1 AWS_PROFILE=founder.edwin PYTHONIOENCODING=utf-8 PATH="/c/Users/usuario/bin:$PATH" \
    python backend/scripts/aplicar_nepotismo_senal.py prod

Pasos (todo en una conexión, serializado):
  1. Aplica backend/db/migrations/137_dji_nepotismo_senal.sql (vista dji_nepotismo + refrescar_nepotismo_senal()).
  2. SELECT refrescar_nepotismo_senal();  -> inserta persona_senal tipo 'nepotismo' y parcha persona_entidad.
  3. Verifica: cuántas señales, cuántas entidades, y una muestra (sin exponer identidades).

No corras esto a la vez que procesar_dji (escribe dji_vinculos): espera a que termine, para capturar todos los vínculos.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "infrastructure" / "aws"))
from tunel_rds import conexion  # noqa: E402

MIG = ROOT / "backend" / "db" / "migrations" / "137_dji_nepotismo_senal.sql"


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    entorno = args[0] if args else "prod"
    solo_migracion = "--no-refresh" in sys.argv  # aplica vista+función, sin refrescar (para ir antes del deploy del front)
    sql = MIG.read_text(encoding="utf-8")
    print(f"→ {entorno}: aplicando 137{'' if solo_migracion else ' + refrescando nepotismo'}…", flush=True)
    with conexion(entorno) as c:
        with c.cursor() as cur:
            cur.execute(sql)
            print("  ✓ migración 137 aplicada (vista + función)", flush=True)
            if solo_migracion:
                c.commit()
                print("✓ listo (solo migración; el refresco va tras el deploy)", flush=True)
                return 0
            cur.execute("SELECT refrescar_nepotismo_senal()")
            n = cur.fetchone()[0]
            print(f"  ✓ refrescar_nepotismo_senal() → {n} señales", flush=True)
        c.commit()
        with c.cursor() as cur:
            cur.execute("SELECT count(*), count(DISTINCT entidad_ruc) FROM persona_senal WHERE tipo='nepotismo'")
            tot, ents = cur.fetchone()
            print(f"  · persona_senal nepotismo: {tot} filas en {ents} entidades", flush=True)
            cur.execute("SELECT count(*) FROM dji_nepotismo")
            print(f"  · vista dji_nepotismo (detalle): {cur.fetchone()[0]} filas", flush=True)
            # Muestra sin identidades: cargo del funcionario, grado, nº de órdenes (no nombres ni DNI).
            cur.execute(
                """SELECT (p->>'cargo') AS cargo, (p->>'grado') AS grado, (detalle->>'ordenes')::int AS ordenes
                     FROM persona_senal s, jsonb_array_elements(s.detalle->'parientes') p
                    WHERE s.tipo='nepotismo' ORDER BY (detalle->>'monto')::float DESC NULLS LAST LIMIT 8"""
            )
            print("  · muestra (cargo / grado / órdenes):", flush=True)
            for cargo, grado, ordenes in cur.fetchall():
                print(f"      - {(cargo or 'sin cargo')[:48]:48s}  {grado or '-':10s}  {ordenes} órd.", flush=True)
            # ¿Cuántas personas ganan el chip en la lista (resumen persona_entidad)?
            cur.execute("SELECT count(*) FROM persona_entidad WHERE 'nepotismo' = ANY(tipos)")
            print(f"  · persona_entidad con el chip nepotismo: {cur.fetchone()[0]}", flush=True)
    print("✓ listo", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
