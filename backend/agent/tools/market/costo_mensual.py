"""Costo mensual de un servicio frente a su contrato anterior y a servicios parecidos (tabla `servicio_costo_mensual`,
migración 280).

En servicios no hay «precio de mercado»: lo comparable es cuánto cuesta el servicio POR MES. La comparación que se
sostiene sola es contra el mismo servicio en la misma entidad: «el contrato anterior costaba S/ X al mes y éste S/ Y».
Contra otras entidades sólo se da el rango (el alcance puede ser otro): es contexto, no bandera.

Todo sale de la base. Sin tabla, sin permiso o sin datos, devuelve `sin_dato` y el análisis sigue."""
from __future__ import annotations

import re

from tools._core import _pg, _short_ocid
from tools.fuentes import proceso_oece

from .normalizar import _percentil

# El mismo servicio: similitud de trigramas del objeto. 0,55 deja pasar «servicio de vigilancia para la sede central 2025»
# contra «… 2026» y deja fuera «servicio de limpieza».
SIM_PREVIO = 0.65
SIM_PARES = 0.50
# Medido en PROD (2026-11-14) sobre los 12 saltos más grandes: los falsos eran servicios de una sola vez (el
# mantenimiento de OTRO camino, un expediente técnico: 30 a 120 días), objetos de plantilla con similitud 0,60 y saltos
# de +400 % o +4 000 %, que son otro alcance y no el mismo servicio más caro.
MIN_PLAZO_CONTINUO = 150    # días: por debajo no es un servicio continuo que se renueva
MAX_SALTO = 300.0           # %: más que eso es otro servicio
RAZON_PLAZO = 3.0           # el plazo de uno no puede ser más de 3 veces el del otro
PARTE_DEL_PLAZO = 0.6       # una renovación llega cuando el anterior ya corrió al menos el 60 % de su plazo
# Servicios que se contratan por obra o por proyecto: el «anterior» es de otra obra, no una renovación.
_POR_PROYECTO = re.compile(r"supervisi[oó]n|expediente\s+t[eé]cnico|consultor[ií]a\s+de\s+obra|elaboraci[oó]n\s+de(l)?\s+(estudio|perfil|expediente)|"
                           r"mantenimiento\s+(peri[oó]dico|rutinario)\s+(de(l)?\s+)?(camino|carretera|v[ií]a|tramo|red\s+vial|la\s+red\s+vial)", re.I)
SALTO_MEDIA = 30.0      # % sobre el contrato anterior
SALTO_ALTA = 60.0
MAX_MESES_PREVIO = 48
MIN_PARES = 5
MAX_DISPERSION = 4.0    # p75 / p25 de los pares: más que eso no es el mismo servicio


def comparar_costo_mensual(ocid: str, entidad_ruc: str | None, objeto: str, costo_mensual: float | None,
                           n_personal: int | None = None) -> dict:
    """{estado, costo_mensual, previo?, pares?}. `previo`: el contrato anterior del mismo servicio en la misma entidad."""
    out: dict = {"estado": "sin_dato", "costo_mensual": costo_mensual}
    if not costo_mensual or costo_mensual <= 0:
        return {**out, "motivo": "sin_costo_mensual_de_este_contrato"}
    if not (objeto or "").strip():
        return {**out, "motivo": "sin_objeto"}
    oc = _short_ocid(ocid or "")
    try:
        conn = _pg()
    except Exception as e:  # noqa: BLE001
        return {**out, "motivo": f"sin_base: {str(e)[:80]}"}
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT s.ocid, s.entidad_ruc, s.entidad, s.objeto, s.fecha, s.monto, s.plazo_dias, s.plazo_fuente, s.costo_mensual,
                      s.n_personal, similarity(s.objeto_norm, lower(%s)) AS sim, s.proveedor_ruc,
                      (COALESCE((SELECT c.fecha_convocatoria FROM convocatorias c WHERE c.ocid = %s), CURRENT_DATE) - s.fecha) AS dias_antes
                 FROM servicio_costo_mensual s
                WHERE s.ocid <> %s AND similarity(s.objeto_norm, lower(%s)) >= %s
                  AND s.fecha >= CURRENT_DATE - make_interval(months => %s)
                  AND s.fecha < COALESCE((SELECT c.fecha_convocatoria FROM convocatorias c WHERE c.ocid = %s), CURRENT_DATE)
                ORDER BY s.fecha DESC LIMIT 200""",
            (objeto, oc, oc, objeto, min(SIM_PREVIO, SIM_PARES), MAX_MESES_PREVIO, oc))
        cols = [d[0] for d in cur.description]
        filas = [dict(zip(cols, r)) for r in cur.fetchall()]
    except Exception as e:  # noqa: BLE001 — sin la tabla o sin permiso
        return {**out, "motivo": f"sin_tabla: {str(e)[:80]}"}
    finally:
        try:
            conn.close()
        except Exception:  # noqa: BLE001
            pass

    def _fila(f: dict) -> dict:
        cm = float(f["costo_mensual"])
        return {"ocid": f["ocid"], "entidad": f.get("entidad"), "objeto": (f.get("objeto") or "")[:200],
                "fecha": f["fecha"].isoformat() if f.get("fecha") else None, "monto": float(f["monto"]),
                "plazo_dias": int(f["plazo_dias"]), "plazo_fuente": f.get("plazo_fuente"), "costo_mensual": round(cm, 2),
                "similitud": round(float(f["sim"]), 2), "n_personal": f.get("n_personal"), "url": proceso_oece(f["ocid"]),
                "dias_antes": int(f["dias_antes"]) if f.get("dias_antes") is not None else None,
                "diff_pct": round((costo_mensual - cm) / cm * 100, 1) if cm > 0 else None}

    previos = [f for f in filas if entidad_ruc and f.get("entidad_ruc") == entidad_ruc and float(f["sim"]) >= SIM_PREVIO]
    if previos:
        p = _fila(previos[0])       # el más reciente
        # Si las bases de los dos piden personal clave y ahora piden más, el servicio creció: se dice, y no hay bandera.
        np_prev = p.get("n_personal")
        p["alcance_crecio"] = bool(n_personal and np_prev and n_personal > np_prev)
        p["comparable"], p["no_comparable_por"] = True, None
        if p["diff_pct"] is not None and p["diff_pct"] > MAX_SALTO:
            p["comparable"], p["no_comparable_por"] = False, "la diferencia es tan grande que debe ser otro alcance, no el mismo servicio"
        elif _POR_PROYECTO.search(objeto or "") or _POR_PROYECTO.search(p.get("objeto") or ""):
            p["comparable"], p["no_comparable_por"] = False, "es un servicio por obra o por proyecto: el anterior es de otra obra"
        elif p.get("dias_antes") is not None and p["dias_antes"] < PARTE_DEL_PLAZO * p["plazo_dias"]:
            # Prueba real (1224008, 2026-11-14): «alimentos para el personal policial», dos contratos de 731 días
            # convocados con cinco meses de diferencia. No es una renovación: corren a la vez, para otra sede o grupo.
            p["comparable"], p["no_comparable_por"] = False, ("el contrato parecido se convocó hace poco y sigue vigente: son contratos "
                                                              "simultáneos (otra sede o grupo), no una renovación")
        elif p["plazo_dias"] < MIN_PLAZO_CONTINUO:
            p["comparable"], p["no_comparable_por"] = False, "el contrato anterior duró menos de cinco meses: no es un servicio continuo"
        out["previo"] = p
        out["estado"] = "hallado"
    pares = [f for f in filas if f.get("entidad_ruc") != entidad_ruc and float(f["sim"]) >= SIM_PARES]
    # Una entidad cuenta una vez (su contrato más reciente): diez renovaciones del mismo cliente no son diez precios.
    vistos: set = set()
    unicos = []
    for f in pares:
        k = f.get("entidad_ruc") or f["ocid"]
        if k not in vistos:
            vistos.add(k)
            unicos.append(f)
    vals = sorted(float(f["costo_mensual"]) for f in unicos)
    if len(vals) >= MIN_PARES:
        p25, p50, p75 = _percentil(vals, .25), _percentil(vals, .5), _percentil(vals, .75)
        comparable = bool(p25 and p75 / p25 <= MAX_DISPERSION)
        out["pares"] = {
            "n": len(vals), "p25": round(p25, 2), "p50": round(p50, 2), "p75": round(p75, 2), "comparable": comparable,
            "posicion": ("sobre_p75" if costo_mensual > p75 else "bajo_p25" if costo_mensual < p25 else "entre_p25_p75") if comparable else None,
            "diff_vs_p50_pct": round((costo_mensual - p50) / p50 * 100, 1) if (comparable and p50) else None,
            "nota": (None if comparable else "los servicios parecidos tienen costos muy dispersos: no se compara"),
            "ejemplos": [_fila(f) for f in unicos[:5]],
        }
        out["estado"] = "hallado"
    if out["estado"] == "sin_dato":
        out["motivo"] = "sin_contrato_anterior_ni_servicios_parecidos_con_plazo"
    return out


def _soles(v) -> str:
    return f"S/ {float(v):,.2f}"


def bandera_costo_mensual(state: dict, comp: dict, ocid: str, monto: float | None, plazo: int | None) -> dict | None:
    """La bandera `costo_mensual_salto`, si el costo mensual subió 30 % o más frente al contrato anterior del mismo
    servicio en la misma entidad. Devuelve la bandera (ya en `pending_flags`) o None. No hay bandera contra otras
    entidades: el alcance puede ser otro."""
    p = (comp or {}).get("previo") or {}
    cm = (comp or {}).get("costo_mensual")
    diff = p.get("diff_pct")
    if not cm or diff is None or diff < SALTO_MEDIA or p.get("alcance_crecio") or p.get("comparable") is False:
        return None
    # Sólo servicios continuos: los dos contratos duran cinco meses o más y sus plazos son del mismo orden.
    pa = p.get("plazo_dias") or 0
    if not plazo or plazo < MIN_PLAZO_CONTINUO or pa < MIN_PLAZO_CONTINUO or max(plazo, pa) > RAZON_PLAZO * min(plazo, pa):
        return None
    if any(isinstance(f, dict) and f.get("regla") == "costo_mensual_salto" for f in state.get("pending_flags") or []):
        return None
    # Alta sólo con un salto grande y un objeto casi idéntico; si no, media.
    sev = "alta" if (diff >= SALTO_ALTA and (p.get("similitud") or 0) >= 0.8) else "media"
    este = f"{_soles(cm)} al mes" + (f" ({_soles(monto)} en {plazo} días)" if (monto and plazo) else "")
    ev = (f"El servicio cuesta {este}. El contrato anterior del mismo servicio en esta entidad "
          f"({p.get('fecha') or 'sin fecha'}: «{(p.get('objeto') or '')[:110]}») costaba {_soles(p['costo_mensual'])} al mes "
          f"({_soles(p['monto'])} en {p['plazo_dias']} días): {diff:+.0f} %. "
          "Puede explicarse por más alcance, más personal o más sedes: hay que comparar los términos de referencia de los dos.")
    try:
        from tools.compliance_rules._base import _norma_state
        norma = _norma_state(state).get("principios") or ""
    except Exception:  # noqa: BLE001
        norma = ""
    flag = {"regla": "costo_mensual_salto", "triggered": True, "severidad": sev, "evidencia": ev[:500], "norma": norma,
            "fuente_url": p.get("url") or proceso_oece(ocid), "estado": "hallado", "verificada_en_codigo": True,
            "costo_mensual": cm, "costo_mensual_anterior": p["costo_mensual"], "diff_pct": diff,
            "contrato_anterior": p.get("ocid"), "similitud_objeto": p.get("similitud"),
            # Los números de la evidencia, en campos propios: la verificación los busca aquí (tools/verify.py).
            "monto": monto, "plazo_dias": plazo, "monto_anterior": p["monto"], "plazo_dias_anterior": p["plazo_dias"],
            "diff_pct_redondeado": round(diff)}
    state.setdefault("pending_flags", []).append(flag)
    return flag
