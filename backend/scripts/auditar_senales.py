#!/usr/bin/env python3
"""
Pruebas de cada señal (fase 5 del plan del 2026-10-27), contra la base de un entorno, sólo lectura:

  1. Cuántas hay de cada tipo y severidad, y cuántas sin evidencia (detalle vacío) o sin fuente.
  2. Que cada tipo que está en la base tenga su etiqueta y su explicación en la app: si no, la ficha mostraría la clave
     interna («obra_paralizada_larga») en vez de una frase. Lee los diccionarios del código (API y web).
  3. Privacidad del detalle guardado: ninguna clave de documento o de nombre que la app nunca debe mostrar (DNI, el
     documento del pariente, el nombre de quien recibió una visita), ni un RUC 10 o un DNI suelto como valor.
  4. Severidades válidas (alta, media, baja).

No imprime ningún dato de una persona: sólo conteos, tipos y nombres de claves. Sale con 1 si algo falla (2 o 3), así
se puede encadenar tras un refresco.

    MSYS_NO_PATHCONV=1 AWS_PROFILE=founder.edwin python backend/scripts/auditar_senales.py --entorno dev|prod
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "infrastructure" / "aws"))
from tunel_rds import conexion  # noqa: E402

# Dónde vive cada señal: (nombre, SQL que devuelve tipo, severidad, detalle::text, fuente_url, filas).
FUENTES = {
    "cruces_proveedor": """SELECT tipo, severidad, detalle::text, fuente_url FROM cruces_proveedor""",
    "persona_senal": """SELECT tipo, severidad, detalle::text, fuente_url FROM persona_senal""",
    "planilla": """SELECT s->>'tipo', s->>'severidad', (s->'detalle')::text, 'pte' FROM planilla_persona p,
                          jsonb_array_elements(CASE WHEN jsonb_typeof(p.senales) = 'array' THEN p.senales ELSE '[]' END) s""",
    "plazas": """SELECT s->>'tipo', s->>'severidad', (s->'detalle')::text, 'servir' FROM servir_convocatoria c,
                        jsonb_array_elements(CASE WHEN jsonb_typeof(c.senales) = 'array' THEN c.senales ELSE '[]' END) s""",
    "obras": """SELECT b->>'tipo', b->>'severidad', '{}', 'infobras' FROM obra_infobras o,
                       jsonb_array_elements(CASE WHEN jsonb_typeof(o.banderas) = 'array' THEN o.banderas ELSE '[]' END) b""",
    "inversiones": """SELECT b->>'tipo', b->>'severidad', '{}', 'invierte' FROM inversion_mef i,
                             jsonb_array_elements(CASE WHEN jsonb_typeof(i.banderas) = 'array' THEN i.banderas ELSE '[]' END) b""",
}
# Las que no llevan detalle propio (la evidencia está en otra tabla o en la fila de la obra).
SIN_DETALLE = {"obras", "inversiones"}

# Claves que el detalle nunca debe traer (la API no las muestra, pero lo seguro es que no estén).
CLAVES_PROHIBIDAS = {"dni", "numero_documento", "documento", "pariente_doc", "pariente_dni", "doc_pariente",
                     "funcionario", "funcionario_nombre", "nombre_funcionario", "declarante", "declarante_nombre",
                     "pariente_nombre", "nombre_pariente", "domicilio_persona"}
# Claves de un detalle que sí pueden llevar 8 u 11 dígitos (códigos, no personas).
CLAVES_CODIGO = {"ocid", "codigo", "cui", "codigo_unico", "nro_orden", "orden", "numero_orden", "numero", "contrato", "ruc", "ruc_entidad",
                 "entidad_ruc", "ruc_proveedor", "ruc_empresa", "ruc_otra", "ruc_espejo", "ruc_hermana", "ruc_sancionada",
                 "ruc_ganador", "ruc_postor", "ruc_par", "proceso", "nomenclatura", "id", "obra_id", "snip", "codigo_snip",
                 "codigo_infobras", "id_pte", "anio", "monto", "expediente", "convocatoria"}
SEVERIDADES = {"alta", "media", "baja"}
# Lo que sí se guarda a propósito y la API quita antes de responder: (fuente, tipo, clave) → dónde se quita.
EXCEPCIONES = {
    ("persona_senal", "familia_estado", "declarante"): "routes/personas.ts lo quita y deja sólo un apellido del funcionario",
}


def claves_ts(ruta: Path, desde: str, patron: str = r"^\s{2}([a-z][a-z0-9_]*):\s") -> set[str]:
    """Las claves de un diccionario de TypeScript (desde la línea que contiene `desde` hasta el `};` que lo cierra), y
    las de los que mete con `...OTRO` (otro `export const OTRO` de la misma carpeta)."""
    s = ruta.read_text(encoding="utf-8")
    i = s.index(desde)
    j = s.index("\n};", i)
    claves = set(re.findall(patron, s[i:j], re.M))
    for otro in re.findall(r"^\s{2}\.\.\.([A-Z_]+),", s[i:j], re.M):
        for f in ruta.parent.glob("*.ts"):
            if f"export const {otro}" in f.read_text(encoding="utf-8"):
                claves |= claves_ts(f, f"export const {otro}", patron)
    return claves


def etiquetas() -> dict[str, set[str]]:
    api = ROOT / "backend" / "api" / "src" / "lib" / "cruces.ts"
    web = ROOT / "frontend" / "lib"
    grupos = set(re.findall(r'tipo: "([a-z0-9_]+)"', (web / "cruces.ts").read_text(encoding="utf-8")))
    return {
        "cruces_web": grupos,
        "cruces_api": claves_ts(api, "export const ETIQUETA_CRUCE"),
        "persona_senal": claves_ts(web / "personas.ts", "export const SENAL:"),
        "planilla": claves_ts(web / "planilla.ts", "export const SENAL_PLANILLA"),
        "plazas": claves_ts(web / "planilla.ts", "export const SENAL_PLAZA"),
        "obras": grupos,
        "inversiones": grupos,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--entorno", choices=("dev", "prod"), default="dev")
    a = ap.parse_args()
    dic = etiquetas()
    fallas: list[str] = []
    re_clave = re.compile(r'"([A-Za-z_][A-Za-z0-9_]*)":')
    re_valor = re.compile(r'"([A-Za-z_][A-Za-z0-9_]*)": ?"?(\d{8}|10\d{9})"?[,}\]]')
    with conexion(a.entorno) as c:
        cur = c.cursor()
        cur.execute("SET statement_timeout = 0")
        for nombre, sql in FUENTES.items():
            cur.execute("SELECT to_regclass(%s) IS NOT NULL", ({"planilla": "planilla_persona", "plazas": "servir_convocatoria",
                        "obras": "obra_infobras", "inversiones": "inversion_mef"}.get(nombre, nombre),))
            if not cur.fetchone()[0]:
                print(f"\n## {nombre}: no existe en {a.entorno}")
                continue
            cur.execute(sql)
            por: dict[tuple[str, str], int] = {}
            vacias: dict[str, int] = {}
            sin_fuente: dict[str, int] = {}
            prohibidas: dict[str, set[str]] = {}
            sueltos: dict[str, set[str]] = {}
            malas_sev: dict[str, int] = {}
            filas = 0
            for tipo, sev, det, url in cur:
                filas += 1
                tipo = tipo or "(sin tipo)"
                por[(tipo, sev or "(sin)")] = por.get((tipo, sev or "(sin)"), 0) + 1
                if (sev or "") not in SEVERIDADES:
                    malas_sev[tipo] = malas_sev.get(tipo, 0) + 1
                if nombre not in SIN_DETALLE and (not det or det in ("{}", "null", "[]")):
                    vacias[tipo] = vacias.get(tipo, 0) + 1
                if not url:
                    sin_fuente[tipo] = sin_fuente.get(tipo, 0) + 1
                if det and len(det) > 2:
                    for k in re_clave.findall(det):
                        if k.lower() in CLAVES_PROHIBIDAS and (nombre, tipo, k) not in EXCEPCIONES:
                            prohibidas.setdefault(tipo, set()).add(k)
                    for k, _v in re_valor.findall(det):
                        if k.lower() not in CLAVES_CODIGO and not k.lower().startswith(("ruc", "cod", "id_", "nro", "anio", "monto")):
                            sueltos.setdefault(tipo, set()).add(k)
            tipos = sorted({t for t, _ in por})
            print(f"\n## {nombre} ({a.entorno}): {filas:,} señales, {len(tipos)} tipos")
            print("| tipo | alta | media | baja | sin evidencia | sin fuente |")
            print("|---|---:|---:|---:|---:|---:|")
            for t in tipos:
                fila = [por.get((t, s), 0) for s in ("alta", "media", "baja")]
                print(f"| {t} | {fila[0]:,} | {fila[1]:,} | {fila[2]:,} | {vacias.get(t, 0):,} | {sin_fuente.get(t, 0):,} |")
            sin_etiqueta = [t for t in tipos if t not in dic.get(nombre, set())]
            if nombre == "cruces_proveedor":
                sin_api = [t for t in tipos if t not in dic["cruces_api"]]
                sin_web = [t for t in tipos if t not in dic["cruces_web"]]
                if sin_api:
                    fallas.append(f"{nombre}: sin etiqueta en la API (ETIQUETA_CRUCE): {', '.join(sin_api)}")
                if sin_web:
                    fallas.append(f"{nombre}: sin grupo en la web (GRUPOS_CRUCE): {', '.join(sin_web)}")
            elif sin_etiqueta:
                fallas.append(f"{nombre}: sin etiqueta en la web: {', '.join(sin_etiqueta)}")
            for t, ks in sorted(prohibidas.items()):
                fallas.append(f"{nombre}/{t}: el detalle trae claves que no deben guardarse: {', '.join(sorted(ks))}")
            for t, ks in sorted(sueltos.items()):
                fallas.append(f"{nombre}/{t}: un DNI o RUC 10 suelto como valor en: {', '.join(sorted(ks))}")
            for t, n in sorted(malas_sev.items()):
                fallas.append(f"{nombre}/{t}: {n:,} con severidad fuera de alta/media/baja")
    print("\n## Resultado")
    for (fuente, tipo, clave), donde in EXCEPCIONES.items():
        print(f"- Nota: {fuente}/{tipo} guarda «{clave}» a propósito: {donde}.")
    if not fallas:
        print("Todo en orden: cada tipo tiene su etiqueta, y el detalle no trae documentos ni nombres que no deben estar.")
        return 0
    for f in fallas:
        print(f"- {f}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
