#!/usr/bin/env python3
"""Carga `servir_convocatoria` (migración 93): las plazas CAS publicadas en SERVIR Talento Perú, desde una PC en el Perú.

SERVIR (app.servir.gob.pe/DifusionOfertasExterno, JSF + PrimeFaces) responde 403 a Cloudflare (GET /diagnostico?partes=pte
de vigia-scrapers), así que no hay fuente en el Worker. Cómo se lee:
  1. GET ofertas_laborales.xhtml: la primera página (10 plazas) y el ViewState de la sesión.
  2. Cada plaza: POST del formulario con su botón "¡Ver más!" → detalle_ofertas_laborales.xhtml (requisitos: experiencia,
     formación, especialización, conocimientos, competencias; número de aviso, sueldo, vacantes, fechas).
  3. La página siguiente: POST AJAX de PrimeFaces con el botón "Sig." (partial-response con el formulario nuevo).
Unas 390 páginas (~3 900 plazas vigentes): ~1 hora. Lo que deja de estar publicado queda guardado (sólo se actualiza
`ultima_vez` de lo que sigue). Al final, refrescar_plazas(): la entidad por su nombre y las señales.

No hay datos personales: una plaza no nombra a quién la gana.

Uso:
  python backend/scripts/cargar_servir_convocatorias.py --seco --paginas 3      # baja 3 páginas y cuenta
  python backend/scripts/cargar_servir_convocatorias.py --entorno dev
  python backend/scripts/cargar_servir_convocatorias.py --entorno prod
Requiere requests, psycopg2, la CLI de AWS y session-manager-plugin (túnel de infrastructure/aws/tunel_rds.py).
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path

import requests

RAIZ = Path(__file__).resolve().parents[2]
URL = "https://app.servir.gob.pe/DifusionOfertasExterno/faces/consultas/ofertas_laborales.xhtml"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
FORM = "frmLstOfertsLabo"
FUENTE = "servir_convocatorias"

COLS = ["aviso", "titulo", "entidad", "ubicacion", "numero", "vacantes", "remuneracion", "fecha_inicio", "fecha_fin", "experiencia",
        "formacion", "especializacion", "conocimiento", "competencias", "detalle_url"]
ACTUALIZABLES = [c for c in COLS if c != "aviso"]
SQL_UPSERT = f"""
  INSERT INTO servir_convocatoria AS s ({", ".join(COLS)})
  SELECT {", ".join(COLS)} FROM jsonb_to_recordset(%s::jsonb) AS x (
    aviso INT, titulo TEXT, entidad TEXT, ubicacion TEXT, numero TEXT, vacantes INT, remuneracion NUMERIC, fecha_inicio DATE,
    fecha_fin DATE, experiencia TEXT, formacion TEXT, especializacion TEXT, conocimiento TEXT, competencias TEXT, detalle_url TEXT)
  ON CONFLICT (aviso) DO UPDATE SET {", ".join(f"{c} = EXCLUDED.{c}" for c in ACTUALIZABLES)}, ultima_vez = now()"""


def limpio(t: str | None) -> str | None:
    if t is None:
        return None
    t = " ".join(html.unescape(re.sub(r"<[^>]+>", " ", t)).split())
    return t or None


def texto_plano(h: str) -> str:
    h = re.sub(r"<script.*?</script>|<style.*?</style>", " ", h, flags=re.S)
    return " | ".join(x for x in (" ".join(html.unescape(p).split()) for p in re.split(r"<[^>]+>", h)) if x)


def view_state(h: str) -> str | None:
    m = re.search(r'name="javax\.faces\.ViewState"[^>]*value="([^"]+)"', h) or re.search(
        r'<update id="[^"]*javax\.faces\.ViewState[^"]*"><!\[CDATA\[([^\]]+)\]\]>', h)
    return m.group(1) if m else None


def campos(h: str) -> dict[str, str]:
    """Los campos del formulario (texto, ocultos y selects), sin los botones."""
    f: dict[str, str] = {}
    for m in re.finditer(r"<input\b[^>]*>", h):
        tag = m.group(0)
        n = re.search(r'name="([^"]+)"', tag)
        if not n or not n.group(1).startswith(FORM) or re.search(r'type="(submit|button)"', tag):
            continue
        v = re.search(r'value="([^"]*)"', tag)
        f[n.group(1)] = html.unescape(v.group(1)) if v else ""
    for m in re.finditer(r'<select\b[^>]*name="(' + FORM + r'[^"]*)"', h):
        f.setdefault(m.group(1), "")
    return f


def boton_siguiente(h: str) -> str | None:
    m = re.search(r'<button id="(' + FORM + r':j_idt\d+)"(?:(?!</button>).)*?>Sig\.</span>', h, flags=re.S)
    return m.group(1) if m else None


def botones_ver_mas(h: str) -> list[str]:
    return re.findall(r'<button id="(' + FORM + r':idPnlRepeatPuestos:\d+:j_idt\d+)"[^>]*title="[^"]*Ver m', h)


def pagina_de(h: str) -> tuple[int, int] | None:
    m = re.search(r"P.gina (\d+) de (\d+)", h)
    return (int(m.group(1)), int(m.group(2))) if m else None


def fecha(t: str | None) -> str | None:
    m = re.match(r"(\d{2})/(\d{2})/(\d{4})", t or "")
    return f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else None


def monto(t: str | None) -> float | None:
    m = re.search(r"(\d[\d,]*(?:\.\d+)?)", t or "")
    return float(m.group(1).replace(",", "")) if m else None


ETIQUETAS = {
    "experiencia": "EXPERIENCIA:", "formacion": "FORMACIÓN ACADÉMICA - PERFIL:", "especializacion": "ESPECIALIZACIÓN:",
    "conocimiento": "CONOCIMIENTO:", "competencias": "COMPETENCIAS:", "detalle_url": "DETALLE:", "vacantes": "CANTIDAD DE VACANTES:",
    "numero": "NÚMERO DE CONVOCATORIA:", "remuneracion": "REMUNERACIÓN:", "fecha_inicio": "FECHA INICIO DE PUBLICACIÓN:",
    "fecha_fin": "FECHA FIN DE PUBLICACIÓN:", "entidad": "INSTITUCIÓN:",
}


def parsear_detalle(h: str) -> dict | None:
    """El detalle de una plaza: cada dato es el texto que sigue a su etiqueta (las celdas del HTML van separadas por |)."""
    partes = [p.strip() for p in texto_plano(h).split("|")]
    d: dict[str, str | None] = {}
    for clave, etiqueta in ETIQUETAS.items():
        for i, p in enumerate(partes):
            if p.upper() == etiqueta and i + 1 < len(partes) and partes[i + 1].upper() not in ETIQUETAS.values():
                d.setdefault(clave, partes[i + 1])
                break
    # El número del aviso va solo en su celda ("N° 820922"), junto a "Imprimir aviso"; el menú nombra decretos con "N°".
    avisos = re.findall(r"\|\s*N°\s*(\d{5,})\s*\|", texto_plano(h))
    aviso = re.match(r"\d+", avisos[-1]) if avisos else None
    titulo = None
    i = next((k for k, p in enumerate(partes) if p == "Resumen del Aviso"), None)
    if i is not None and i + 1 < len(partes):
        titulo = partes[i + 1]
    if not aviso or not titulo or not d.get("entidad"):
        return None
    ubic = re.search(r'Ubicaci.n:\s*\|\s*([^|]+)', texto_plano(h))
    vac = re.search(r"\d+", d.get("vacantes") or "")
    return {
        "aviso": int(aviso.group(0)), "titulo": titulo, "entidad": d["entidad"], "ubicacion": ubic.group(1).strip() if ubic else None,
        "numero": d.get("numero"), "vacantes": int(vac.group(0)) if vac else None, "remuneracion": monto(d.get("remuneracion")),
        "fecha_inicio": fecha(d.get("fecha_inicio")), "fecha_fin": fecha(d.get("fecha_fin")), "experiencia": d.get("experiencia"),
        "formacion": d.get("formacion"), "especializacion": d.get("especializacion"), "conocimiento": d.get("conocimiento"),
        "competencias": d.get("competencias"),
        "detalle_url": d.get("detalle_url") if (d.get("detalle_url") or "").startswith("http") else None,
    }


def ubicaciones_del_listado(h: str) -> list[str | None]:
    """La ubicación de cada plaza del listado, en orden (el detalle no siempre la trae)."""
    return [limpio(m) for m in re.findall(r'Ubicaci.n:</span>(.*?)</span>', h, flags=re.S)]


def leer_todo(max_paginas: int | None, pausa: float) -> list[dict]:
    s = requests.Session()
    s.headers["User-Agent"] = UA
    h = s.get(URL, timeout=60).text
    plazas: dict[int, dict] = {}
    pag = pagina_de(h) or (1, 1)
    leidas = 0
    while True:
        vs = view_state(h)
        f = campos(h)
        ubic = ubicaciones_del_listado(h)
        for k, boton in enumerate(botones_ver_mas(h)):
            for intento in range(3):
                try:
                    r = s.post(URL, data={FORM: FORM, **f, boton: "", "javax.faces.ViewState": vs}, timeout=90)
                    d = parsear_detalle(r.text)
                    break
                except requests.RequestException:
                    time.sleep(5 * (intento + 1))
                    d = None
            if d:
                if not d["ubicacion"] and k < len(ubic):
                    d["ubicacion"] = ubic[k]
                plazas[d["aviso"]] = d
            time.sleep(pausa)
        leidas += 1
        print(f"  página {pag[0]}/{pag[1]}: {len(plazas)} plazas", flush=True)
        if pag[0] >= pag[1] or (max_paginas and leidas >= max_paginas):
            break
        sig = boton_siguiente(h)
        if not sig:
            print("  sin botón «Sig.»: se corta aquí")
            break
        r = s.post(URL, data={"javax.faces.partial.ajax": "true", "javax.faces.source": sig, "javax.faces.partial.execute": "@all",
                              "javax.faces.partial.render": f"{FORM}:mensaje {FORM}", sig: sig, FORM: FORM, **f,
                              "javax.faces.ViewState": vs},
                   headers={"Faces-Request": "partial/ajax", "X-Requested-With": "XMLHttpRequest"}, timeout=90)
        nuevo = r.text
        # La respuesta AJAX trae el formulario dentro de un CDATA: se arma una página con él y el ViewState nuevo.
        cuerpo = "".join(re.findall(r"<!\[CDATA\[(.*?)\]\]>", nuevo, flags=re.S))
        vs_nuevo = view_state(nuevo) or vs
        h = cuerpo + f'<input type="hidden" name="javax.faces.ViewState" value="{vs_nuevo}" />'
        siguiente = pagina_de(h)
        if not siguiente or siguiente[0] <= pag[0]:
            print("  la página no avanzó: se corta aquí")
            break
        pag = siguiente
    return list(plazas.values())


def main() -> int:
    ap = argparse.ArgumentParser(description="Carga las plazas CAS de SERVIR Talento Perú.")
    ap.add_argument("--entorno", choices=["dev", "prod"], help="dev = vigia-db-dev, prod = vigia-db")
    ap.add_argument("--seco", action="store_true", help="sólo baja y cuenta, no escribe")
    ap.add_argument("--paginas", type=int, help="tope de páginas (para probar)")
    ap.add_argument("--pausa", type=float, default=0.3, help="segundos entre pedidos (por defecto 0.3)")
    a = ap.parse_args()
    if not a.seco and not a.entorno:
        ap.error("falta --entorno (o --seco)")
    sys.stdout.reconfigure(encoding="utf-8")

    plazas = leer_todo(a.paginas, a.pausa)
    print(f"SERVIR: {len(plazas)} plazas leídas")
    if a.seco or not plazas:
        for p in plazas[:3]:
            print(json.dumps(p, ensure_ascii=False)[:600])
        return 0

    sys.path.insert(0, str(RAIZ / "infrastructure" / "aws"))
    from tunel_rds import BASES, conexion
    with conexion(a.entorno) as con:
        with con, con.cursor() as cur:
            cur.execute("SET ROLE vigia_jobs")
            for k in range(0, len(plazas), 500):
                cur.execute(SQL_UPSERT, (json.dumps(plazas[k:k + 500], ensure_ascii=False),))
            cur.execute("SELECT refrescar_plazas()")
            # La plaza de la gestión saliente (migración 183): después, porque refrescar_plazas() rehace todas las señales.
            cur.execute("SELECT to_regprocedure('refrescar_plazas_extra()') IS NOT NULL")
            if cur.fetchone()[0]:
                cur.execute("SELECT refrescar_plazas_extra()")
            cur.execute("SELECT count(*), count(entidad_ruc), count(*) FILTER (WHERE n_senales > 0) FROM servir_convocatoria")
            tot, con_ruc, con_senales = cur.fetchone()
            cur.execute(
                """INSERT INTO datasets_cargas (fuente, clave, tabla, archivo, sha256, filas, fuente_url, descargado_at, cargado_at, estado)
                   VALUES (%s, %s, 'servir_convocatoria', 'script', '', %s, %s, %s, now(), 'ok')
                   ON CONFLICT (fuente, clave) DO UPDATE SET filas = EXCLUDED.filas, descargado_at = EXCLUDED.descargado_at,
                     cargado_at = now(), estado = 'ok', error = NULL""",
                (FUENTE, date.today().isoformat(), len(plazas), URL, datetime.now(timezone.utc)))
    print(f"✓ {BASES[a.entorno]}: {len(plazas)} plazas cargadas · {tot} en la base, {con_ruc} con su entidad, {con_senales} con señales")
    return 0


if __name__ == "__main__":
    sys.exit(main())
