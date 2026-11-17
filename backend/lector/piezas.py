#!/usr/bin/env python3
"""Las PIEZAS de cada proceso: un PDF (suelto o dentro de un ZIP) con su tipo, y lo que se lee de él sin modelo.

  python -X utf8 backend/lector/piezas.py prod --medir                 # sólo cuenta: no escribe nada
  python -X utf8 backend/lector/piezas.py dev                          # registra piezas y lecturas de plantilla
  python -X utf8 backend/lector/piezas.py prod --limite 2000
  python -X utf8 backend/lector/piezas.py prod --bases                 # lee por secciones las bases con texto (sin modelo)

Parte del texto que ya está guardado (documentos_texto.paginas, con el nombre del archivo interno de cada página) y:
  1. corta cada documento en piezas (lector/piezas.partir) y les pone tipo (lector/tipos.clasificar);
  2. lee con plantilla los reportes que genera el SEACE (lector/plantillas.leer_paginas);
  3. guarda todo en documento_pieza y pieza_lectura (migración 325). No baja archivos ni llama a un modelo.
Se puede cortar y volver a correr: sólo toma los documentos cuyo texto es más nuevo que su última pieza.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from collections import Counter
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "backend"))
sys.path.insert(0, str(RAIZ / "infrastructure" / "aws"))
from lector import plantillas, tipos  # noqa: E402
from lector.base import ocids_de_archivo  # noqa: E402

MIN_LETRAS = 120                       # una página con menos letras es un escaneo sin transcribir
TOPE_TEXTO = 60_000                    # caracteres de la pieza que mira el clasificador

PAGINAS_CON_TEXTO = 25                 # de cada archivo interno se trae el texto de sus primeras páginas; del resto, el largo

# De cada documento guardado, sus páginas: con texto las primeras de cada archivo interno (lo que miran el clasificador y
# las plantillas: los reportes del SEACE son cortos) y sólo su tamaño las demás. Sin agrupar por el JSON de las páginas,
# que son cientos de KB por fila.
PENDIENTES = """
SELECT d.ocid, d.doc_id, d.casillero, t.sha256, d.formato,
       (SELECT jsonb_agg(CASE WHEN x.rn <= %(con_texto)s THEN x.p
                              ELSE jsonb_build_object('n', x.p->'n', 'archivo', x.p->'archivo', 'chars', x.p->'chars') END ORDER BY x.ord)
          FROM (SELECT e.p, e.ord, row_number() OVER (PARTITION BY e.p->>'archivo' ORDER BY e.ord) AS rn
                  FROM jsonb_array_elements(t.paginas) WITH ORDINALITY AS e(p, ord)) x) AS paginas
  FROM (SELECT g.ocid, g.sha256, min(g.id) AS doc_id, max(upper(g.titulo)) AS casillero, max(lower(g.formato)) AS formato
          FROM documentos_gcs g WHERE g.borrado_at IS NULL AND g.ocid IS NOT NULL AND g.sha256 IS NOT NULL
           AND (%(ocids)s::text[] IS NULL OR ocid_corto(g.ocid) = ANY (%(ocids)s::text[]))
         GROUP BY g.ocid, g.sha256) d
  JOIN documentos_texto t ON t.sha256 = d.sha256
 WHERE jsonb_typeof(t.paginas) = 'array' {solo_nuevos}
"""
SOLO_NUEVOS = """
   AND NOT EXISTS (SELECT 1 FROM documento_pieza p
                    WHERE p.sha256 = t.sha256 AND p.ocid = d.ocid AND p.actualizado_at >= t.actualizado_at)"""


def _letras(t: str) -> int:
    return sum(1 for c in t if c.isalpha())


def partir(paginas: list[dict]) -> list[dict]:
    """Las piezas de un documento guardado: las páginas seguidas del mismo archivo interno. Un PDF suelto es una pieza."""
    piezas: list[dict] = []
    for i, p in enumerate(paginas or []):
        archivo = p.get("archivo") or ""
        texto = p.get("texto") or ""
        if not piezas or piezas[-1]["archivo"] != archivo:
            piezas.append({"archivo": archivo, "pag_ini": int(p.get("n") or i + 1), "pag_fin": int(p.get("n") or i + 1),
                           "paginas": 0, "paginas_con_texto": 0, "inicio": "", "_texto": [], "_indices": []})
        z = piezas[-1]
        z["pag_fin"] = int(p.get("n") or i + 1)
        z["paginas"] += 1
        z["_indices"].append(i)
        # Una página que llegó sin su texto (sólo el largo) cuenta como escrita si tenía más que un sello o una firma.
        if _letras(texto) >= MIN_LETRAS or ("texto" not in p and int(p.get("chars") or 0) >= 3 * MIN_LETRAS):
            z["paginas_con_texto"] += 1
            if not z["inicio"] and texto:
                z["inicio"] = texto
        if sum(len(x) for x in z["_texto"]) < TOPE_TEXTO:
            z["_texto"].append(texto)
    return piezas


def leer_documento(casillero: str | None, paginas: list[dict], formato: str | None = None) -> list[dict]:
    """Las piezas de un documento con su tipo y, si son reportes del SEACE, su lectura de plantilla.

    `formato`: el del archivo guardado. Sólo dentro de un contenedor (ZIP, RAR) el nombre de cada pieza dice algo: el de
    un PDF suelto repite el casillero («Archivos de la ampliación del contrato.pdf») y no se usa para clasificar."""
    piezas = partir(paginas)
    multi = (formato or "").lower() in ("zip", "rar", "7z") or len({z["archivo"] for z in piezas}) > 1
    textos = [(p.get("texto") or "") for p in (paginas or [])]
    reportes = plantillas.leer_paginas(textos)
    for z in piezas:
        texto = "\n".join(z.pop("_texto"))
        indices = set(z.pop("_indices"))
        z["tipo"], z["por"] = tipos.clasificar(casillero, z["archivo"] if multi else None, z["inicio"], texto)
        z["origen"] = tipos.TIPOS[z["tipo"]][0]
        z["regimen"] = tipos.regimen(texto)
        # Los reportes cuya primera página cae en esta pieza.
        z["lecturas"] = [r for r in reportes if (r["paginas"][0] - 1) in indices]
        z["nomenclatura"] = next((r.get("nomenclatura") for r in z["lecturas"] if r.get("nomenclatura")), None)
        z.pop("inicio")
    return piezas


GUARDAR_PIEZA = """
INSERT INTO documento_pieza (ocid, sha256, archivo, doc_id, casillero, tipo_documento, origen, clasificado_por, pag_ini, pag_fin,
                             paginas, paginas_con_texto, regimen, nomenclatura, actualizado_at)
VALUES %s
ON CONFLICT (ocid, sha256, archivo) DO UPDATE SET
  doc_id = EXCLUDED.doc_id, casillero = EXCLUDED.casillero, tipo_documento = EXCLUDED.tipo_documento, origen = EXCLUDED.origen,
  clasificado_por = EXCLUDED.clasificado_por, pag_ini = EXCLUDED.pag_ini, pag_fin = EXCLUDED.pag_fin, paginas = EXCLUDED.paginas,
  paginas_con_texto = EXCLUDED.paginas_con_texto, regimen = EXCLUDED.regimen, nomenclatura = EXCLUDED.nomenclatura,
  actualizado_at = now()
RETURNING id, ocid, sha256, archivo
"""
MOLDE_PIEZA = "(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())"
CAMPOS_PIEZA = ("ocid", "sha256", "archivo", "doc_id", "casillero", "tipo", "origen", "por", "pag_ini", "pag_fin", "paginas",
                "paginas_con_texto", "regimen", "nomenclatura")
GUARDAR_LECTURA = """
INSERT INTO pieza_lectura (pieza_id, lector, version, modelo, estado, salida, sobrante, costo_usd, leido_at)
VALUES %s
ON CONFLICT (pieza_id, lector, version) DO UPDATE SET
  estado = EXCLUDED.estado, salida = EXCLUDED.salida, sobrante = EXCLUDED.sobrante, leido_at = now()
"""
MOLDE_LECTURA = "(%s, %s, %s, 'plantilla', %s, %s, %s, 0, now())"
LOTE = 400                             # piezas por ida a la base: por el túnel cada ida cuesta decenas de milisegundos


def volcar(cur, piezas: dict, lecturas: dict) -> None:
    """Guarda un lote: las piezas (y recoge sus ids) y después sus lecturas. Las llaves ya vienen sin repetir."""
    from psycopg2.extras import execute_values

    if not piezas:
        return
    filas = execute_values(cur, GUARDAR_PIEZA, [tuple(z[c] for c in CAMPOS_PIEZA) for z in piezas.values()],
                           template=MOLDE_PIEZA, page_size=LOTE, fetch=True)
    ids = {(o, h, a): i for i, o, h, a in filas}
    filas_lectura = [(ids[llave], lector, plantillas.VERSION, "ok" if not r["sobrante"] and not r["paginas_sin_leer"] else "parcial",
                      json.dumps(r, ensure_ascii=False), r["sobrante"])
                     for (llave, lector), r in lecturas.items() if llave in ids]
    if filas_lectura:
        execute_values(cur, GUARDAR_LECTURA, filas_lectura, template=MOLDE_LECTURA, page_size=100)
    piezas.clear()
    lecturas.clear()


# Las bases con texto que aún no pasaron por el lector de secciones: de cada una, sus páginas completas.
BASES_PENDIENTES = """
SELECT p.id, (SELECT jsonb_agg(jsonb_build_object('n', e.p->'n', 'texto', e.p->'texto') ORDER BY e.ord)
                FROM jsonb_array_elements(t.paginas) WITH ORDINALITY AS e(p, ord)
               WHERE (e.p->>'n') ~ '^\\d+$' AND (e.p->>'n')::int BETWEEN p.pag_ini AND p.pag_fin) AS paginas
  FROM documento_pieza p JOIN documentos_texto t ON t.sha256 = p.sha256
 WHERE p.tipo_documento IN ('bases', 'bases_integradas') AND p.paginas >= 15 AND p.paginas_con_texto * 2 >= p.paginas
   AND jsonb_typeof(t.paginas) = 'array'
   AND NOT EXISTS (SELECT 1 FROM pieza_lectura l WHERE l.pieza_id = p.id AND l.lector = 'bases_secciones' AND l.version = %(version)s)
"""
GUARDAR_SECCIONES = """
INSERT INTO pieza_lectura (pieza_id, lector, version, modelo, estado, salida, sobrante, costo_usd, leido_at)
VALUES (%(pieza_id)s, 'bases_secciones', %(version)s, 'plantilla', %(estado)s, %(salida)s, 0, 0, now())
ON CONFLICT (pieza_id, lector, version) DO UPDATE SET estado = EXCLUDED.estado, salida = EXCLUDED.salida, leido_at = now()
"""
VERSION_SECCIONES = "s1"


def leer_bases(entorno: str, limite: int = 0) -> None:
    """Las secciones de las bases con texto y lo que se saca de ellas sin modelo (lector/secciones.py): la cuantía o que
    está reservada, la experiencia exigida y la experiencia adicional, cada una con su página y su cita."""
    from contextlib import ExitStack

    from lector import secciones
    from tunel_rds import conexion

    t0 = time.time()
    cuenta: Counter = Counter()
    with ExitStack() as pila:
        cn = pila.enter_context(conexion(entorno))
        lee = cn.cursor("bases")
        lee.itersize = 40
        lee.execute(BASES_PENDIENTES + (f" LIMIT {limite}" if limite else ""), {"version": VERSION_SECCIONES})
        cn_escribe = pila.enter_context(conexion(entorno))
        escribe = cn_escribe.cursor()
        for n, (pieza_id, paginas) in enumerate(lee, 1):
            d = secciones.leer(paginas or [])
            cuenta["con armazón" if d else "sin armazón"] += 1
            if d:
                c = d["cuantia"]
                cuenta["cuantía reservada" if c and c["reservada"] else "cuantía con monto" if c and c["valor"] else
                       "cuantía sin monto" if c else "sin apartado de cuantía"] += 1
                cuenta["con experiencia exigida"] += bool(d["experiencia_exigida"])
                cuenta["con experiencia adicional"] += bool(d["experiencia_adicional"])
            escribe.execute(GUARDAR_SECCIONES, {"pieza_id": pieza_id, "version": VERSION_SECCIONES,
                                                "estado": "ok" if d else "sin_armazon",
                                                "salida": json.dumps(d, ensure_ascii=False) if d else None})
            if n % 200 == 0:
                cn_escribe.commit()
                print(f"  {n} bases, {round(time.time() - t0)} s", flush=True)
        cn_escribe.commit()
    print(f"{entorno}: bases leídas por secciones en {round(time.time() - t0)} s: {dict(cuenta)}")


def main() -> None:
    from tunel_rds import conexion

    ap = argparse.ArgumentParser()
    ap.add_argument("entorno", choices=["dev", "prod"])
    ap.add_argument("--medir", action="store_true", help="sólo cuenta tipos por casillero; no escribe")
    ap.add_argument("--todos", action="store_true", help="rehace también los documentos ya registrados")
    ap.add_argument("--bases", action="store_true", help="en vez de registrar piezas, lee por secciones las bases con texto")
    ap.add_argument("--limite", type=int, default=0)
    ap.add_argument("--ocids-archivo", default=None, help="sólo los documentos de estos procesos (uno por línea)")
    a = ap.parse_args()
    if a.bases:
        leer_bases(a.entorno, a.limite)
        return
    t0 = time.time()
    por_casillero: Counter = Counter()
    por_tipo: Counter = Counter()
    lecturas: Counter = Counter()
    docs = piezas_n = 0
    consulta = PENDIENTES.format(solo_nuevos="" if (a.medir or a.todos) else SOLO_NUEVOS) + (f" LIMIT {a.limite}" if a.limite else "")
    from contextlib import ExitStack
    with ExitStack() as pila:
        cn = pila.enter_context(conexion(a.entorno))
        lee = cn.cursor("piezas")              # cursor del lado del servidor: son decenas de miles de textos
        lee.itersize = 200
        lee.execute(consulta, {"con_texto": PAGINAS_CON_TEXTO, "ocids": ocids_de_archivo(a.ocids_archivo)})
        # Se escribe por otra conexión, para confirmar por tandas sin cerrar el cursor de lectura.
        cn_escribe = None if a.medir else pila.enter_context(conexion(a.entorno))
        escribe = cn_escribe.cursor() if cn_escribe else None
        lote_piezas: dict = {}                 # (ocid, sha256, archivo) → pieza
        lote_lecturas: dict = {}               # ((ocid, sha256, archivo), lector) → lectura
        for ocid, doc_id, casillero, sha256, formato, paginas in lee:
            docs += 1
            for z in leer_documento(casillero, paginas or [], formato):
                piezas_n += 1
                por_casillero[(casillero, z["tipo"], z["por"])] += 1
                por_tipo[(z["tipo"], z["por"], "con texto" if z["paginas_con_texto"] else "sin texto")] += 1
                for r in z["lecturas"]:
                    lecturas[(r["plantilla"], "ok" if not r["sobrante"] and not r["paginas_sin_leer"] else "parcial")] += 1
                if escribe is None:
                    continue
                llave = (ocid, sha256, z["archivo"])
                lote_piezas[llave] = {**z, "ocid": ocid, "sha256": sha256, "doc_id": doc_id, "casillero": casillero}
                for r in z["lecturas"]:
                    lote_lecturas.setdefault((llave, r["plantilla"]), r)
            if cn_escribe is not None and len(lote_piezas) >= LOTE:
                volcar(escribe, lote_piezas, lote_lecturas)
                cn_escribe.commit()
            if docs % 2000 == 0:
                print(f"  {docs} documentos, {piezas_n} piezas, {round(time.time() - t0)} s", flush=True)
        if cn_escribe is not None:
            volcar(escribe, lote_piezas, lote_lecturas)
            cn_escribe.commit()
    print(f"{a.entorno}: {docs} documentos, {piezas_n} piezas en {round(time.time() - t0)} s")
    total = sum(por_tipo.values()) or 1
    otro = sum(v for (t, _, _), v in por_tipo.items() if t == "otro")
    print(f"sin tipo («otro»): {otro} de {total} ({100 * otro / total:.1f} %)")
    print("por tipo, cómo se decidió y si tiene texto:")
    for k, v in sorted(por_tipo.items(), key=lambda kv: -kv[1]):
        print(f"  {v:7d}  {k[0]:22s} {k[1]:10s} {k[2]}")
    if a.medir:
        print("por casillero:")
        for k, v in sorted(por_casillero.items(), key=lambda kv: (kv[0][0] or "", -kv[1])):
            if v >= 15:
                print(f"  {v:7d}  {(k[0] or '')[:52]:52s} → {k[1]} ({k[2]})")
    print("lecturas de plantilla:", dict(lecturas))


if __name__ == "__main__":
    main()
