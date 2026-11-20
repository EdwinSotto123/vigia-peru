"""Lo que ya leyeron los lectores de documentos (backend/lector, modelos abiertos por vigia-llm) de este proceso, desde
`documento_lectura` (migración 245): el acta de buena pro, el contrato firmado, el pliego de consultas y las bases.
Plan 2026-11-04, parte 1. Y lo que resolvió el Tribunal de Contrataciones sobre el proceso (migraciones 402-434).

Las banderas que dependen del juicio del modelo valen sólo si las dos lecturas (versión y versión-2) coinciden, igual
que al publicarlas (migraciones 246-248). Los postores que son personas naturales (RUC 10) van con un apellido tapado;
el nombre en claro queda sólo en `state["_nombres_tapar"]`, para tapar el dictamen.
"""
from __future__ import annotations

from tools._core import *  # noqa: F401,F403
from tools.privacidad import es_persona_natural, tapar_nombre

_VERSION = {"buena_pro": "v2", "contrato": "v1", "consultas": "v1", "bases": "v1"}
_NOMBRE = {"buena_pro": "acta", "contrato": "contrato", "consultas": "consultas", "bases": "bases"}


_PREFIJO_OCDS = re.compile(r"^ocds-[a-z0-9]+-seacev\d+-(.+)$")


def ocid_corto(ocid) -> str:
    """El OCID como lo guarda Vigía (convocatorias.ocid, cruces_proveedor.ocid, documento_lectura.ocid): sin el prefijo
    `ocds-…-seacev3-`. Quedarse con lo que sigue al último guion servía para «…-1195870», pero de «…-2026-150-3» dejaba
    «3»: unos 397 mil procesos tienen el identificador con guiones, y el agente no encontraba sus lecturas ni sus banderas."""
    s = str(ocid or "").strip()
    m = _PREFIJO_OCDS.match(s)
    if m:
        return m.group(1)
    return s.split("-")[-1] if s.startswith("ocds-") else s


_ocid_corto = ocid_corto


def _postores(salida: dict, nombres: set[str]) -> list[dict]:
    out = []
    for p in salida.get("postores") or []:
        p = dict(p)
        if es_persona_natural(p.get("ruc")) and p.get("nombre"):
            nombres.add(p["nombre"])
            p["nombre"] = tapar_nombre(p["nombre"])
        if p.get("motivo_fuera"):
            p["motivo_fuera"] = str(p["motivo_fuera"])[:400]
        out.append(p)
    return out


def lecturas_bd(ocid: str, conn=None) -> tuple[dict, set[str]]:
    """{acta, contrato, consultas, bases} con la salida de cada lector y sus banderas confirmadas; y los nombres en claro."""
    propia = conn is None
    conn = conn or _pg()
    nombres: set[str] = set()
    try:
        cur = conn.cursor()
        cur.execute("""SELECT clase, version, salida, banderas, leido_at FROM documento_lectura
                        WHERE ocid = %s AND estado = 'ok'""", (_ocid_corto(ocid),))
        filas = {(c, v): (s, b or [], t) for c, v, s, b, t in cur.fetchall()}
    finally:
        if propia:
            try:
                conn.close()
            except Exception:  # noqa: BLE001
                pass
    out: dict = {}
    for clase, version in _VERSION.items():
        uno = filas.get((clase, version))
        if not uno:
            continue
        salida, banderas, leido = uno
        if isinstance(salida, str):
            salida = json.loads(salida)
        dos = filas.get((clase, f"{version}-2"))
        confirmadas = sorted(set(banderas) & set(dos[1])) if dos else None
        d = {k: v for k, v in (salida or {}).items() if k not in ("postores",)}
        if clase == "buena_pro":
            d["postores"] = _postores(salida or {}, nombres)
        c = d.get("contratista") if clase == "contrato" else None
        if isinstance(c, dict) and es_persona_natural(c.get("ruc")) and c.get("nombre"):
            nombres.add(c["nombre"])
            d["contratista"] = {**c, "nombre": tapar_nombre(c["nombre"])}
        out[_NOMBRE[clase]] = {
            "salida": d, "banderas": sorted(banderas), "banderas_confirmadas": confirmadas,
            "lecturas": 2 if dos else 1, "leido": leido.isoformat() if hasattr(leido, "isoformat") else leido,
        }
    if out:
        out["fuente"] = "lectores de documentos de Vigía (modelos abiertos sobre los PDF del SEACE)"
    return out, nombres


_SQL_TRIBUNAL = """
SELECT r.titulo, to_char(r.fecha, 'YYYY-MM-DD'), CASE WHEN r.resultado_ok THEN r.resultado END,
       CASE WHEN r.resultado_ok THEN r.efectos ELSE '{}' END, tribunal_corrigio(r), r.motivo,
       CASE WHEN r.cita_ok THEN r.cita END, COALESCE(r.infraccion, '{}'), COALESCE(r.pdf, r.url),
       COALESCE((SELECT json_agg(json_build_object('ruc', pe.ruc, 'rol', pe.rol, 'nombre', e.razon_social) ORDER BY pe.rol, pe.ruc)
                   FROM tribunal_parte_empresa pe LEFT JOIN empresas e ON e.ruc = pe.ruc::bpchar
                  WHERE pe.resolucion_id = r.id), '[]')
  FROM tribunal_resolucion r
 WHERE r.id IN (SELECT p.resolucion_id FROM tribunal_proceso p WHERE p.ocid = %s)
 ORDER BY r.fecha NULLS LAST, r.id"""


def tribunal_de_filas(filas) -> list[dict]:
    """Las resoluciones del Tribunal como las ve el analista legal: el resultado sólo si se comprobó contra la parte
    resolutiva (si no, None), `corrigio` (fundada, en parte o nulidad: el comité o las bases se equivocaron), el motivo
    que resumió el lector, la cita literal comprobada y las empresas (RUC 20, nombre comprobado) con su papel. Quien
    apeló no va: puede ser una persona natural."""
    out = []
    for titulo, fecha, resultado, efectos, corrigio, motivo, cita, infraccion, enlace, partes in filas:
        if isinstance(partes, str):
            partes = json.loads(partes)
        out.append({
            "resolucion": titulo, "fecha": fecha, "resultado": resultado, "efectos": list(efectos or []),
            "corrigio": bool(corrigio), "motivo": (str(motivo)[:600] if motivo else None), "cita": cita,
            "infraccion": list(infraccion or []), "enlace": enlace,
            "empresas": [{"ruc": p.get("ruc"), "nombre": p.get("nombre"),
                          "papel": "sancionador ordenado" if p.get("rol") == "sancionador" else "tenía la buena pro"}
                         for p in (partes or []) if isinstance(p, dict)],
        })
    # Dos correcciones del mismo proceso separadas por 7 días o más: el comité repitió el error (migración 434).
    fechas = sorted(x["fecha"] for x in out if x["corrigio"] and x["fecha"])
    if len(fechas) >= 2:
        from datetime import date
        d = [date.fromisoformat(f) for f in fechas]
        if any((b - a).days >= 7 for a, b in zip(d, d[1:])):
            for x in out:
                x["corregido_otra_vez"] = True
    return out


def tribunal_bd(ocid: str, conn=None) -> list[dict]:
    """Las resoluciones del Tribunal de Contrataciones unidas a este proceso, en orden de fecha."""
    propia = conn is None
    conn = conn or _pg()
    try:
        cur = conn.cursor()
        cur.execute(_SQL_TRIBUNAL, (_ocid_corto(ocid),))
        return tribunal_de_filas(cur.fetchall())
    finally:
        if propia:
            try:
                conn.close()
            except Exception:  # noqa: BLE001
                pass


def lecturas_para_legal(lect: dict) -> dict:
    """Lo que el analista legal necesita de las lecturas, compacto: las bases (personal clave, experiencia exigida,
    factores de evaluación con su puntaje, marcas con su cita, equipamiento, plazo), el pliego (observaciones no
    acogidas y denuncias de direccionamiento con su cita) y el acta (por qué quedó fuera cada postor y las
    observaciones con su cita). Es la fuente cuando las bases están escaneadas y el parser no trae el bloque (prueba de
    oro 2026-11-04: 14 omisiones de red_flag_documental con las bases ya leídas, p. ej. «Gestión de calidad: 85 de 100
    puntos», 1232093)."""
    out: dict = {}
    b = ((lect.get("bases") or {}).get("salida")) or {}
    if b.get("es_bases") is not False and b:
        out["bases"] = {k: b.get(k) for k in ("objeto", "valor_referencial", "plazo_dias", "experiencia_postor",
                                              "personal_clave", "equipamiento", "factores_evaluacion", "marcas")
                        if b.get(k) not in (None, [], {}, "")}
        out["bases"]["banderas_del_lector"] = (lect.get("bases") or {}).get("banderas") or []
    c = ((lect.get("consultas") or {}).get("salida")) or {}
    if c.get("es_pliego") is not False and c:
        obs = [o for o in (c.get("observaciones") or []) if isinstance(o, dict)]
        out["consultas"] = {
            "n_consultas": c.get("n_consultas"), "n_participantes": c.get("n_participantes"),
            "no_acogidas": [{"tema": o.get("tema"), "resumen": o.get("resumen")} for o in obs
                            if o.get("respuesta") == "no_acogida"][:25],
            "n_acogidas": sum(1 for o in obs if o.get("respuesta") in ("acogida", "acogida_parcial")),
            "denuncias": (c.get("denuncias") or [])[:8],
            "banderas_del_lector": (lect.get("consultas") or {}).get("banderas_confirmadas")
            if (lect.get("consultas") or {}).get("banderas_confirmadas") is not None else (lect.get("consultas") or {}).get("banderas") or [],
        }
    a = ((lect.get("acta") or {}).get("salida")) or {}
    if a:
        out["acta"] = {
            "postores": [{k: p.get(k) for k in ("nombre", "ganador", "admitida", "calificada", "puntaje", "monto_ofertado",
                                                "motivo_fuera", "motivo_tipo") if p.get(k) is not None}
                         for p in (a.get("postores") or []) if isinstance(p, dict)][:15],
            "observaciones": (a.get("observaciones") or [])[:8],
        }
    k = ((lect.get("contrato") or {}).get("salida")) or {}
    if k:
        out["contrato"] = {x: k.get(x) for x in ("numero_contrato", "fecha_suscripcion", "monto_contratado", "plazo_dias",
                                                 "fecha_inicio", "fecha_fin", "forma_de_pago", "observaciones")
                           if k.get(x) not in (None, [], "")}
    return out


def query_lecturas_documentos(ocid: str, tool_context: ToolContext) -> dict:
    """Lo que los lectores de Vigía ya leyeron de los documentos de este proceso (acta, contrato, consultas, bases).

    Args:
        ocid: el proceso.
    """
    try:
        lect, nombres = lecturas_bd(ocid)
    except Exception as e:  # noqa: BLE001 — sin base, el análisis sigue con el parser
        return {"error": f"base no disponible: {str(e)[:160]}"}
    # Lo que resolvió el Tribunal (2026-11-20): sin permiso o sin la tabla, el análisis sigue sin él.
    try:
        trib = tribunal_bd(ocid)
    except Exception as e:  # noqa: BLE001
        print(f"[lecturas] tribunal no disponible: {str(e)[:160]}", flush=True)
        trib = []
    state = tool_context.state
    if lect:
        state["lecturas_documentos"] = lect
        state["lecturas_legal"] = lecturas_para_legal(lect)
        state["_nombres_tapar"] = sorted({*state.get("_nombres_tapar", []), *nombres})
    if trib:
        state["tribunal_del_proceso"] = trib
        state["lecturas_legal"] = {**(state.get("lecturas_legal") or {}), "tribunal": trib}
    return {"documentos": sorted(k for k in lect if k != "fuente"),
            "banderas": {k: v["banderas_confirmadas"] if v["banderas_confirmadas"] is not None else v["banderas"]
                         for k, v in lect.items() if k != "fuente"},
            "resoluciones_del_tribunal": len(trib)}


query_lecturas_documentos_tool = FunctionTool(query_lecturas_documentos)
