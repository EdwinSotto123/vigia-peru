"""Conjunto de oro de extracción (plan del 2026-11-16, fase 5): una muestra de piezas leídas por un lector con modelo.
Imprime SÓLO el texto de cada pieza (el comienzo y, si es larga, la parte resolutiva), para escribir su verdad a ciegas en
oro/<lector>.json, y guarda aparte lo que dijo el modelo (en <carpeta>/modelo_<lector>.json, fuera del repositorio: las
citas pueden traer nombres), para calificarlo después con calificar_oro.py. La muestra es estable (por la huella), mitad
con páginas transcritas por visión y mitad con texto propio.

  python -X utf8 backend/evals/hechos/muestra_oro.py <lector> <n> <carpeta> > textos.txt
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "infrastructure" / "aws"))
from tunel_rds import conexion

LECTOR, N, DIR = sys.argv[1], int(sys.argv[2]), Path(sys.argv[3])
DIR.mkdir(parents=True, exist_ok=True)

with conexion("prod") as cn:
    cur = cn.cursor()
    # Muestra estable (por la huella), mitad con páginas transcritas por visión y mitad con texto propio.
    cur.execute("""
      WITH c AS (
        -- La lectura más reciente de cada pieza: tras releer con una versión nueva, la misma muestra mide la nueva.
        SELECT DISTINCT ON (p.id) p.id, p.ocid, p.sha256, p.pag_ini, p.pag_fin, p.tipo_documento, l.salida, l.version, l.modelo,
               (t.motor ILIKE '%%vision%%') AS vision, md5(p.sha256 || p.id::text) AS orden
          FROM documento_pieza p JOIN pieza_lectura l ON l.pieza_id = p.id JOIN documentos_texto t ON t.sha256 = p.sha256
         WHERE l.lector = %s AND l.estado = 'ok' AND l.modelo <> 'plantilla'
         ORDER BY p.id, l.leido_at DESC)
      (SELECT * FROM c WHERE vision ORDER BY orden LIMIT %s) UNION ALL (SELECT * FROM c WHERE NOT vision ORDER BY orden LIMIT %s)""",
                [LECTOR, N // 2, N - N // 2])
    filas = cur.fetchall()
    modelo = {}
    for pid, ocid, sha, ini, fin, tipo, salida, version, mod, vision, _ in filas:
        cur.execute("SELECT paginas FROM documentos_texto WHERE sha256 = %s", [sha])
        paginas = cur.fetchone()[0] or []
        texto = []
        for pg in paginas:
            n = int(pg.get("n") or 0)
            if (ini is None or n >= ini) and (fin is None or n <= fin):
                t = re.sub(r"\s+", " ", pg.get("texto") or "").strip()
                texto.append(f"[p.{n}] {t}")
        cuerpo = " ".join(texto)
        print(f"=== pieza {pid} | {tipo} | {'visión' if vision else 'texto'} | {len(cuerpo)} caracteres")
        k = cuerpo.upper().rfind("RESUELVE")
        if len(cuerpo) > 2600 and k > 1000:
            print(cuerpo[:900] + " …[…]… " + cuerpo[k - 300:k + 2400] + (" …[sigue]" if len(cuerpo) > k + 2400 else ""))
        else:
            print(cuerpo[:2600] + (" …[sigue]" if len(cuerpo) > 2600 else ""))
        print()
        modelo[pid] = {"ocid": ocid, "sha256": sha, "tipo_documento": tipo, "version": version, "modelo": mod, "vision": vision, "salida": salida}
    (DIR / f"modelo_{LECTOR}.json").write_text(json.dumps(modelo, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
