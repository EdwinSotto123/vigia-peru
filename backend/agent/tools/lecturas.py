"""Lo que ya leyeron los lectores de documentos (backend/lector, Claude Haiku 5.5) de este proceso, desde
`documento_lectura` (migración 245): el acta de buena pro, el contrato firmado, el pliego de consultas y las bases.
Plan 2026-11-04, parte 1.

Las banderas que dependen del juicio del modelo valen sólo si las dos lecturas (versión y versión-2) coinciden, igual
que al publicarlas (migraciones 246-248). Los postores que son personas naturales (RUC 10) van con un apellido tapado;
el nombre en claro queda sólo en `state["_nombres_tapar"]`, para tapar el dictamen.
"""
from __future__ import annotations

from tools._core import *  # noqa: F401,F403
from tools.privacidad import es_persona_natural, tapar_nombre

_VERSION = {"buena_pro": "v2", "contrato": "v1", "consultas": "v1", "bases": "v1"}
_NOMBRE = {"buena_pro": "acta", "contrato": "contrato", "consultas": "consultas", "bases": "bases"}


def _ocid_corto(ocid: str) -> str:
    return str(ocid or "").split("-")[-1]


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
        out["fuente"] = "lectores de documentos de Vigía (Claude Haiku 5.5 sobre los PDF del SEACE)"
    return out, nombres


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
    state = tool_context.state
    if lect:
        state["lecturas_documentos"] = lect
        state["lecturas_legal"] = lecturas_para_legal(lect)
        state["_nombres_tapar"] = sorted({*state.get("_nombres_tapar", []), *nombres})
    return {"documentos": sorted(k for k in lect if k != "fuente"),
            "banderas": {k: v["banderas_confirmadas"] if v["banderas_confirmadas"] is not None else v["banderas"]
                         for k, v in lect.items() if k != "fuente"}}


query_lecturas_documentos_tool = FunctionTool(query_lecturas_documentos)
