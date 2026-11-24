"""compliance_rules._base — helpers compartidos: perfil/reglas activas, norma aplicable, montos y postores OCDS."""

from tools._core import *  # noqa: F401,F403


def _perfil_reglas(tool_context, reglas_activas):
    """reglas_activas explícito > state['reglas_activas'] > None (todas)."""
    if reglas_activas is not None:
        return frozenset(reglas_activas)
    try:
        v = tool_context.state.get("reglas_activas")
    except Exception:
        v = None
    if isinstance(v, (list, tuple, set, frozenset)):
        return frozenset(str(x) for x in v)
    return None


def _perfil_topes(tool_context, topes_uit):
    if topes_uit is not None:
        return topes_uit
    try:
        v = tool_context.state.get("topes_uit")
    except Exception:
        v = None
    return v if isinstance(v, dict) else None


def _regla_omitida(nombre: str, reglas: frozenset | None, activa_por_defecto: bool = False) -> dict | None:
    """Si el perfil no activa `nombre`, devuelve el resultado neutro (sin bandera).

    `activa_por_defecto=True` (reglas del lote 1, 2026-09-15): la regla corre aunque el
    perfil no la liste — solo se omite si el perfil la desactiva explícitamente con el
    prefijo `-` (p. ej. `-ofertas_agrupadas`) en `reglas_activas`."""
    if reglas is None:
        return None
    if activa_por_defecto:
        if f"-{nombre}" in reglas:
            return {"regla": nombre, "triggered": False, "omitida": True,
                    "estado": "sin_dato", "motivo": "regla desactivada explícitamente en el perfil"}
        return None
    if nombre not in reglas:
        return {"regla": nombre, "triggered": False, "omitida": True,
                "estado": "sin_dato", "motivo": "regla no activa en el perfil"}
    return None


# ─── Régimen normativo aplicable (lote 1 · T3) ──────────────────────────────
#
# Procesos convocados desde el 22-abr-2025 se rigen por la Ley 32069 y su Reglamento
# (D.S. 009-2025-EF); antes, por el TUO de la Ley 30225 (D.S. 082-2019-EF). Citar el TUO
# derogado en un expediente 2026 resta credibilidad ante un fiscal (informes 1225062,
# 1225256, 1225266, 1225416, 1225450).
_INICIO_LEY_32069 = _dt.date(2025, 4, 22)

# Cada cita se comprobó contra el texto oficial cargado en `norma_fragmento` (2026-11-15). Tres estaban mal y salían en
# las banderas: el art. 12 del Reglamento no trata del valor referencial (es la participación de Perú Compras), el
# fraccionamiento de la Ley 32069 es el art. 50 (el 36 es compra centralizada) y la comparación de precios del TUO es el
# art. 25 (el 22 es licitación y concurso público). El TUO no tiene un «Anexo IV» de procedimientos por monto.
_NORMAS = {
    "ley_32069": {
        "regimen": "ley_32069",
        "ley": "Ley N° 32069",
        "reglamento": "D.S. N° 009-2025-EF",
        "principios": "Art. 5 Ley 32069 — principios de competencia, transparencia e integridad",
        "transparencia": "Art. 5 Ley 32069 — principio de transparencia y publicidad",
        "competencia": "Art. 5 Ley 32069 — principio de competencia",
        "integridad": "Art. 5 Ley 32069 — principio de integridad",
        "impedimentos": "Art. 30 Ley 32069 — impedimentos para contratar",
        "sanciones": "Art. 30 Ley 32069 — impedimentos para contratar (proveedores sancionados)",
        "procedimientos": "Art. 54 Ley 32069 y art. 14 Ley 32513 (Presupuesto 2026) — procedimientos según cuantía",
        "comparacion_precios": "Arts. 97 y 98 Reglamento D.S. 009-2025-EF — comparación de precios",
        "penalidades": "Arts. 119, 120 y 142 Reglamento D.S. 009-2025-EF — penalidades, penalidad por mora y ampliación de plazo",
        "cuantia": "Art. 48 Ley 32069 y arts. 47 y 53 Reglamento D.S. 009-2025-EF — cuantía de la contratación e interacción con el mercado",
        "fraccionamiento": "Art. 50 Ley 32069 y art. 45 Reglamento D.S. 009-2025-EF — fraccionamiento",
    },
    "tuo_30225": {
        "regimen": "tuo_30225",
        "ley": "TUO Ley N° 30225",
        "reglamento": "D.S. N° 344-2018-EF",
        "principios": "Art. 2 TUO Ley 30225 — principios de libertad de concurrencia y transparencia",
        "transparencia": "Art. 2 TUO Ley 30225 — principio de transparencia",
        "competencia": "Art. 2 TUO Ley 30225 — principio de competencia",
        "integridad": "Art. 2 TUO Ley 30225 — principio de integridad",
        "impedimentos": "Art. 11 TUO Ley 30225 — impedimentos para contratar",
        "sanciones": "Art. 50 TUO Ley 30225 — infracciones y sanciones",
        "procedimientos": "Art. 21 TUO Ley 30225 y Ley de Presupuesto del año — procedimientos de selección según monto",
        "comparacion_precios": "Art. 25 TUO Ley 30225 — comparación de precios",
        "penalidades": "Arts. 158, 161 y 162 Reglamento D.S. 344-2018-EF — ampliación de plazo, penalidades y penalidad por mora",
        "cuantia": "Arts. 32 y 34 Reglamento D.S. 344-2018-EF — valor estimado y valor referencial",
        "fraccionamiento": "Art. 20 TUO Ley 30225 y art. 40 Reglamento D.S. 344-2018-EF — prohibición de fraccionamiento",
    },
}


def _to_date(v) -> "_dt.date | None":
    if v is None:
        return None
    if isinstance(v, _dt.datetime):
        return v.date()
    if isinstance(v, _dt.date):
        return v
    s = str(v).strip()
    try:
        return _dt.date.fromisoformat(s[:10])
    except ValueError:
        pass
    m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", s)
    if m:
        try:
            return _dt.date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        except ValueError:
            return None
    return None


def norma_aplicable(fecha_convocatoria=None) -> dict:
    """Régimen normativo por fecha de convocatoria (helper único del plan 2026-09-15).
    Sin fecha → se asume el régimen vigente (Ley 32069)."""
    f = _to_date(fecha_convocatoria)
    if f is not None and f < _INICIO_LEY_32069:
        return dict(_NORMAS["tuo_30225"])
    return dict(_NORMAS["ley_32069"])


def _fecha_convocatoria_state(state: dict):
    """Fecha de convocatoria desde el OCDS del state (tenderPeriod.startDate > datePublished > date)."""
    ocds = (state or {}).get("ocds") or (state or {}).get("ocds_preloaded") or {}
    tender = ocds.get("tender") or {}
    for v in ((tender.get("tenderPeriod") or {}).get("startDate"), tender.get("datePublished"),
              ocds.get("date")):
        d = _to_date(v)
        if d:
            return d
    return None


def _norma_state(state: dict) -> dict:
    return norma_aplicable(_fecha_convocatoria_state(state))


def _procurement_method(state: dict, tipo_bd: str | None = None) -> str:
    """Nombre del procedimiento: OCDS `tender.procurementMethodDetails` > valor de BD
    (COALESCE(tipo_proceso, modalidad)) > ''."""
    ocds = (state or {}).get("ocds") or (state or {}).get("ocds_preloaded") or {}
    tender = ocds.get("tender") or {}
    pmd = tender.get("procurementMethodDetails") or tender.get("procurementMethod")
    return str(pmd or tipo_bd or "").strip()


def _es_subasta(tipo: str) -> bool:
    u = _sin_tildes(tipo or "").upper()
    return "SUBASTA" in u or "SIE" == u.strip() or u.startswith("SIE-")


def _es_comparacion_precios(tipo: str) -> bool:
    u = _sin_tildes(tipo or "").upper()
    return "COMPARACION" in u or u.startswith("CP-") or u.startswith("COMPRE")


def _montos_ocds(ocds: dict) -> dict:
    """Montos publicados en el OCDS: referencial (tender.value), adjudicados (awards[].value)
    y contratados (contracts[].value)."""
    ocds = ocds or {}
    tender = ocds.get("tender") or {}

    def _amt(node):
        # En soles: un contrato en dólares trae `amount_PEN` (1226915 comparaba USD 15 387 contra precios en soles).
        val = (node or {}).get("value") or {}
        try:
            en_soles = val.get("amount_PEN") if str(val.get("currency") or "PEN").upper() != "PEN" else None
            v = float(en_soles or val.get("amount") or 0)
        except (TypeError, ValueError):
            v = 0.0
        return v if v > 0 else None

    referencial = _amt(tender)
    awards = [a for a in (_amt(a) for a in (ocds.get("awards") or []) if isinstance(a, dict)) if a]
    contracts = [c for c in (_amt(c) for c in (ocds.get("contracts") or []) if isinstance(c, dict)) if c]
    return {"referencial": referencial, "awards": awards, "contracts": contracts,
            "suma_awards": sum(awards) if awards else None,
            "suma_contracts": sum(contracts) if contracts else None}


def _monto_adjudicado_ocds(ocds: dict):
    """Monto adjudicado/contratado: contracts > awards > None (T8)."""
    m = _montos_ocds(ocds)
    if m["suma_contracts"]:
        return m["suma_contracts"], "contracts"
    if m["suma_awards"]:
        return m["suma_awards"], "awards"
    return None, None


# ── El ganador principal: el mismo en todo el análisis ─────────────────
# Con varios ganadores, el que se nombra es el de MAYOR monto adjudicado (suma de sus ítems en CONOSCE o, sin CONOSCE,
# de sus adjudicaciones vigentes del OCDS), empate por RUC: la misma regla que la API (`ganadorPrincipal`,
# contratos_detalle.ts). Antes cada lugar elegía a su modo (2026-11-24): `get_ganador` el primero de `parties[]`
# (2026-2543-197: HAMUQ, tercero por monto), la alerta un `LIMIT 1` sin orden y las reglas el primer award con RUC.
_ESTADOS_AWARD_CAIDO = ("cancelled", "unsuccessful")


def _id_proveedor(sup) -> str:
    return "".join(ch for ch in str((sup or {}).get("id") or "") if ch.isdigit()) if isinstance(sup, dict) else ""


def _awards_vigentes(ocds: dict, en_conosce: set | frozenset = frozenset()) -> list[dict]:
    """awards[] del OCDS que siguen vigentes (port de `adjudicacionesVigentes` de la API). Varias adjudicaciones sobre
    los MISMOS ítems son una buena pro que pasó a otro postor, o un reparto:
      · con CONOSCE, quedan las de los proveedores que CONOSCE registra (1220581: el OCDS nombra primero a JEMAR, cuya
        buena pro se reemplazó; CONOSCE registra contratado al CONSORCIO TECNISAN - METROPOLITAN);
      · sin CONOSCE, si juntas no pasan el referencial de sus ítems (+10 %) es un reparto y quedan todas; si lo pasan
        son alternativas: queda la que tiene contrato (contracts[].awardID) o, sin contrato, la primera."""
    ocds = ocds if isinstance(ocds, dict) else {}
    aws = [a for a in (ocds.get("awards") or []) if isinstance(a, dict)
           and str(a.get("status") or "").lower() not in _ESTADOS_AWARD_CAIDO]
    if len(aws) < 2:
        return aws
    items = [{str(ai.get("id")) for ai in (a.get("items") or []) if isinstance(ai, dict) and ai.get("id") is not None}
             for a in aws]
    grupo = list(range(len(aws)))

    def raiz(i):
        while grupo[i] != i:
            i = grupo[i]
        return i
    for i in range(len(aws)):
        for j in range(i + 1, len(aws)):
            if items[i] & items[j]:
                grupo[raiz(j)] = raiz(i)
    miembros: dict[int, list[int]] = {}
    for i in range(len(aws)):
        miembros.setdefault(raiz(i), []).append(i)
    ref_item = {str(it.get("id")): _f((it.get("totalValue") or {}).get("amount")) or 0.0
                for it in ((ocds.get("tender") or {}).get("items") or []) if isinstance(it, dict)}
    con_contrato = {str(c.get("awardID")) for c in (ocds.get("contracts") or []) if isinstance(c, dict) and c.get("awardID")}
    vigente = [True] * len(aws)
    for ids in miembros.values():
        if len(ids) < 2:
            continue
        confirmados = [i for i in ids if any(_id_proveedor(sp) in en_conosce for sp in (aws[i].get("suppliers") or []))]
        if confirmados:
            for i in ids:
                vigente[i] = i in confirmados
            continue
        ref = sum(ref_item.get(x, 0.0) for x in set().union(*(items[i] for i in ids)))   # cada ítem una vez
        suma = sum(_f((aws[i].get("value") or {}).get("amount")) or 0.0 for i in ids)
        if ref > 0 and suma <= ref * 1.1:
            continue
        contratados = [i for i in ids if str(aws[i].get("id")) in con_contrato]
        queda = contratados or ids[:1]
        for i in ids:
            vigente[i] = i in queda
    return [a for a, v in zip(aws, vigente) if v]


def _ganadores_ocds(ocds: dict, en_conosce: set | frozenset = frozenset()) -> list[tuple[str, str | None, float]]:
    """[(id del proveedor, nombre, monto)] de las adjudicaciones vigentes, de mayor a menor monto y por id."""
    suma: dict[str, list] = {}
    for a in _awards_vigentes(ocds, en_conosce):
        monto = _f((a.get("value") or {}).get("amount")) or 0.0
        sups = [sp for sp in (a.get("suppliers") or []) if _id_proveedor(sp)]
        for sp in sups:
            g = suma.setdefault(_id_proveedor(sp), [sp.get("name"), 0.0])
            g[1] += monto / len(sups)
    return sorted(((r, n, m) for r, (n, m) in suma.items()), key=lambda x: (-x[2], x[0]))


def _ganador_ocds(ocds: dict) -> tuple[str | None, str | None]:
    """(RUC, nombre) del ganador según el OCDS solo: el de mayor monto entre las adjudicaciones vigentes (empate por
    RUC). Solo RUC de 11 dígitos (un consorcio con código del SEACE no lo tiene)."""
    for ruc, nombre, _m in _ganadores_ocds(ocds):
        if len(ruc) == 11:
            return ruc, nombre
    return None, None


def _adjudicaciones_conosce(ocid: str, state: dict, cur=None) -> list[tuple[str, str | None, float, object]]:
    """[(ruc_proveedor, proveedor, monto, buena pro)] del proceso en CONOSCE (por código y entidad), sumado por
    proveedor, de mayor a menor monto y por RUC. Un consorcio va con su código del SEACE. Vacío sin base o sin filas.
    Se guarda en state["_conosce_adj"]."""
    st = state if isinstance(state, dict) else {}
    ocid = _short_ocid(str(ocid or ""))          # `convocatorias.ocid` es el corto
    ya = st.get("_conosce_adj")
    if isinstance(ya, dict) and ya.get("ocid") == str(ocid):
        return ya["filas"]
    filas: list[tuple] = []
    conn = None
    try:
        if cur is None:
            conn = _pg()
            cur = conn.cursor()
        cur.execute("SELECT codigo, entidad_ruc::text FROM convocatorias WHERE ocid = %s", (str(ocid),))
        fila = cur.fetchone()
        if fila and fila[0]:
            cur.execute("""SELECT ruc_proveedor, max(proveedor), sum(monto_adjudicado)::float, min(fecha_buenapro)
                             FROM conosce_adjudicaciones
                            WHERE codigo_convocatoria = %s AND (%s::text IS NULL OR entidad_ruc::text = %s::text)
                            GROUP BY 1""", (fila[0], fila[1], fila[1]))
            filas = [(str(r or "").strip(), n, float(m or 0), f) for r, n, m, f in cur.fetchall() if str(r or "").strip()]
            filas.sort(key=lambda x: (-x[2], x[0]))
    except Exception:  # noqa: BLE001 — sin base: el OCDS
        filas = []
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:  # noqa: BLE001
                pass
    if isinstance(state, dict):
        state["_conosce_adj"] = {"ocid": str(ocid), "filas": filas}
    return filas


def ganador_principal(ocid: str, state: dict, cur=None) -> dict | None:
    """{ruc, nombre, monto, fuente} del ganador del proceso: el de mayor monto adjudicado en CONOSCE (suma de sus ítems)
    o, sin CONOSCE, en las adjudicaciones vigentes del OCDS; empate por RUC. `ruc` puede ser el código del SEACE de un
    consorcio (no tiene RUC). None sin adjudicación. Es el que nombran `get_ganador`, la alerta y las reglas."""
    st = state if isinstance(state, dict) else {}
    ocid = _short_ocid(str(ocid or ""))
    ya = st.get("_ganador_principal")
    if isinstance(ya, dict) and ya.get("ocid") == str(ocid):
        return ya["ganador"]
    conosce = [f for f in _adjudicaciones_conosce(ocid, st, cur) if f[2] > 0]
    if conosce:
        ruc, nombre, monto, _ = conosce[0]
        g = {"ruc": ruc, "nombre": nombre, "monto": monto, "fuente": "conosce"}
    else:
        ocds = st.get("ocds") or st.get("ocds_preloaded") or {}
        lista = _ganadores_ocds(ocds)
        g = ({"ruc": lista[0][0], "nombre": lista[0][1], "monto": lista[0][2], "fuente": "ocds"} if lista else None)
    if isinstance(state, dict):
        state["_ganador_principal"] = {"ocid": str(ocid), "ganador": g}
    return g


def _items_conosce(ocid: str, state: dict, cur=None) -> list[tuple]:
    """[(n_item, ruc_proveedor, proveedor, monto, monto_referencial, estado)] del proceso en CONOSCE, una fila por ítem
    y proveedor (n_item = número oficial del ítem). CONOSCE no trae los ítems desiertos. Se guarda en
    state["_conosce_items"]; vacío sin base."""
    st = state if isinstance(state, dict) else {}
    ocid = _short_ocid(str(ocid or ""))
    ya = st.get("_conosce_items")
    if isinstance(ya, dict) and ya.get("ocid") == ocid:
        return ya["filas"]
    filas: list[tuple] = []
    conn = None
    try:
        if cur is None:
            conn = _pg()
            cur = conn.cursor()
        cur.execute("SELECT codigo, entidad_ruc::text FROM convocatorias WHERE ocid = %s", (ocid,))
        fila = cur.fetchone()
        if fila and fila[0]:
            cur.execute("""SELECT n_item, ruc_proveedor, proveedor, monto_adjudicado::float, monto_referencial::float,
                                  estado_item
                             FROM conosce_adjudicaciones
                            WHERE codigo_convocatoria = %s AND (%s::text IS NULL OR entidad_ruc::text = %s::text)
                            ORDER BY n_item, ruc_proveedor""", (fila[0], fila[1], fila[1]))
            filas = [tuple(r) for r in cur.fetchall()]
    except Exception:  # noqa: BLE001 — sin base: el OCDS
        filas = []
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:  # noqa: BLE001
                pass
    if isinstance(state, dict):
        state["_conosce_items"] = {"ocid": ocid, "filas": filas}
    return filas


_DETALLE_SIN_ADJUDICAR_RE = re.compile(r"DESIERT|\bNUL[OA]\b|CANCELAD", re.I)


def adjudicacion_del_proceso(ocid: str, state: dict, cur=None) -> dict | None:
    """La adjudicación de TODO el proceso para el dictamen: cada ganador (de mayor a menor monto, empate por RUC) con sus
    ítems (números oficiales: `n_item` de CONOSCE o `position` del OCDS) y su monto; el ganador principal (el de
    `ganador_principal`, del que es el análisis del proveedor); los ítems desiertos o sin adjudicar; el total adjudicado
    del proceso y el referencial de los ítems adjudicados (sin los desiertos). Fuente: CONOSCE o, sin CONOSCE, las
    adjudicaciones vigentes del OCDS. Un RUC de persona natural nunca sale: «persona natural» y el nombre tapado.

    2026-2543-197 (2026-11-24): 13 ítems, 8 ganadores y los ítems 5 y 9 desiertos; el dictamen hablaba de un solo
    proveedor como «el ganador». None sin adjudicación."""
    st = state if isinstance(state, dict) else {}
    ocid = _short_ocid(str(ocid or ""))
    ya = st.get("_adjudicacion")
    if isinstance(ya, dict) and ya.get("ocid") == ocid:
        return ya["adjudicacion"]
    ocds = st.get("ocds") or st.get("ocds_preloaded") or {}
    ocds = _safe_parse_json(ocds) if isinstance(ocds, str) else ocds
    ocds = ocds if isinstance(ocds, dict) else {}
    tender = ocds.get("tender") or {}
    titems = [it for it in (tender.get("items") or []) if isinstance(it, dict)]

    def _numero(it, i):
        pos = str(it.get("position") or "").strip()
        return int(pos) if pos.isdigit() else i
    item_de_num = {_numero(it, i): it for i, it in enumerate(titems, start=1)}
    num_de_id = {str(it.get("id")): _numero(it, i) for i, it in enumerate(titems, start=1) if it.get("id") is not None}

    por: dict[str, dict] = {}
    ref_por_item: dict[int, float] = {}
    filas = [f for f in _items_conosce(ocid, st, cur) if f[1] and (f[3] or 0) > 0]
    if filas:
        fuente = "conosce"
        for n, ruc, nombre, monto, mref, _est in filas:
            g = por.setdefault(str(ruc).strip(), {"nombre": nombre, "items": set(), "monto": 0.0})
            g["monto"] += float(monto or 0)
            if n is not None:
                g["items"].add(int(n))
                if mref:
                    ref_por_item[int(n)] = max(ref_por_item.get(int(n), 0.0), float(mref))
    else:
        fuente = "ocds"
        for a in _awards_vigentes(ocds):
            sups = [sp for sp in (a.get("suppliers") or []) if _id_proveedor(sp)]
            nums = set()
            for ai in (a.get("items") or []):
                if not isinstance(ai, dict):
                    continue
                n = num_de_id.get(str(ai.get("id")))
                if n is None and str(ai.get("position") or "").isdigit():
                    n = int(ai["position"])
                if n is not None:
                    nums.add(n)
            monto = _f((a.get("value") or {}).get("amount")) or 0.0
            for sp in sups:
                g = por.setdefault(_id_proveedor(sp), {"nombre": sp.get("name"), "items": set(), "monto": 0.0})
                g["items"] |= nums
                g["monto"] += monto / len(sups)
    if not por:
        if isinstance(state, dict):
            state["_adjudicacion"] = {"ocid": ocid, "adjudicacion": None}
        return None
    adjudicados = {n for g in por.values() for n in g["items"]}
    if not ref_por_item:
        ref_por_item = {n: _f(((item_de_num.get(n) or {}).get("totalValue") or {}).get("amount")) or 0.0 for n in adjudicados}

    from tools.privacidad import tapar_nombre

    def _ficha(ruc: str, g: dict) -> dict:
        natural = len(ruc) == 11 and ruc.startswith("10")
        return {"ruc": ruc if (len(ruc) == 11 and not natural) else None,
                **({"codigo_seace": ruc} if len(ruc) != 11 else {}),
                "persona_natural": natural,
                "nombre": tapar_nombre(g["nombre"]) if natural else g["nombre"],
                "items": sorted(g["items"]), "monto": round(g["monto"], 2)}
    orden = sorted(por.items(), key=lambda kv: (-kv[1]["monto"], kv[0]))
    ganadores = [_ficha(r, g) for r, g in orden]
    gp = ganador_principal(ocid, st, cur)
    i_principal = next((i for i, (r, _g) in enumerate(orden) if gp and r == str(gp.get("ruc"))), 0)

    desiertos = []
    for n in sorted(item_de_num):
        it = item_de_num[n]
        det = str(it.get("statusDetails") or "")
        st_it = str(it.get("status") or "").lower()
        if st_it in _ESTADOS_AWARD_CAIDO or _DETALLE_SIN_ADJUDICAR_RE.search(det):
            motivo = ("desierto" if "DESIERT" in det.upper() else "nulo" if re.search(r"\bNUL[OA]\b", det, re.I)
                      else "cancelado" if "CANCEL" in (det.upper() + st_it.upper()) else "sin_adjudicacion")
        elif adjudicados and n not in adjudicados:
            motivo = "sin_adjudicacion"
        else:
            continue
        desiertos.append({"item": n, "descripcion": str(it.get("description") or "")[:120], "motivo": motivo})

    total = round(sum(g["monto"] for g in por.values()), 2)
    ref_adj = round(sum(v for k, v in ref_por_item.items() if k in adjudicados), 2) or None
    out = {
        "fuente": fuente,
        "n_ganadores": len(ganadores),
        "ganadores": ganadores[:30],
        "ganador_principal": ganadores[i_principal],
        "monto_adjudicado_total": total,
        "n_items": len(item_de_num) or None,
        "items_desiertos": desiertos,
        "referencial_total": _f((tender.get("value") or {}).get("amount")),
        "referencial_items_adjudicados": ref_adj,
        "adjudicado_vs_referencial_pct": round((total - ref_adj) / ref_adj * 100, 1) if ref_adj else None,
    }
    if isinstance(state, dict):
        state["_adjudicacion"] = {"ocid": ocid, "adjudicacion": out}
    return out


def ganadores_para_regla(ocid: str, state: dict, cur=None) -> list[tuple[str, str | None]]:
    """[(id, nombre)] a evaluar en una regla sobre «el» ganador cuando hay varios: el principal primero y después los
    demás de `ganadores_evaluables` (integrantes de consorcio incluidos), hasta 5, sin repetir. Antes esas reglas
    miraban a uno solo, el de un `LIMIT 1` sin orden (2026-2543-197: 8 ganadores)."""
    out: list[tuple[str, str | None]] = []
    g = ganador_principal(ocid, state, cur)
    if g and g.get("ruc"):
        out.append((str(g["ruc"]), g.get("nombre")))
    try:
        for x in ganadores_evaluables(ocid, state, cur):
            if x.get("ruc") and all(str(x["ruc"]) != r for r, _ in out):
                out.append((str(x["ruc"]), x.get("nombre")))
    except Exception:  # noqa: BLE001
        pass
    return out[:5]


def rucs_ganadores_vigentes(ocid: str, state: dict, cur=None) -> set[str]:
    """Ids de quienes quedaron como ganadores (CONOSCE o, sin CONOSCE, adjudicaciones vigentes del OCDS)."""
    conosce = {f[0] for f in _adjudicaciones_conosce(ocid, state, cur) if f[2] > 0}
    if conosce:
        return conosce
    ocds = (state or {}).get("ocds") or (state or {}).get("ocds_preloaded") or {}
    return {r for r, _n, _m in _ganadores_ocds(ocds)}


def _f(v):
    try:
        x = float(v)
        return x if x > 0 else None
    except (TypeError, ValueError):
        return None


def _norm_razon_cr(s: str) -> str:
    s = _sin_tildes(str(s or "")).upper()
    s = re.sub(r"\b(S\.?A\.?C\.?|S\.?R\.?L\.?(TDA)?|E\.?I\.?R\.?L\.?|S\.?A\.?A?\.?|S\.?C\.?R\.?L\.?)\b", " ", s)
    return " ".join(re.sub(r"[^A-Z0-9 ]", " ", s).split())


def _sin_oferta(estado) -> bool:
    """`participante_sin_oferta`, "no presentó oferta", "sin propuesta"…: registrado sin ofertar."""
    e = " ".join(_sin_tildes(str(estado or "")).lower().replace("_", " ").replace("-", " ").split())
    return any(k in e for k in ("sin oferta", "no presento", "no oferto", "sin propuesta", "solo registro", "registrado sin",
                                "integrante consorcio", "integrante del consorcio", "consorciado"))


def _sin_repetidos(postores: list[dict]) -> list[dict]:
    """El mismo postor leído en dos documentos (a veces con otro RUC, el del consorcio) es UN postor."""
    vistos: set[str] = set()
    out = []
    for p in postores:
        nombre = " ".join(_sin_tildes(str(p.get("razon_social") or p.get("nombre") or "")).upper().replace(".", "").split())
        if nombre and nombre in vistos:
            continue
        if nombre:
            vistos.add(nombre)
        out.append(p)
    return out


_RE_FUERA = re.compile(r"descalific|rechaz|no\s+admit|inadmit|no\s+cumpl|no\s+alcanz|puntaje\s+t[eé]cnico\s+m[ií]nimo|"
                       r"puntaje\s+m[ií]nimo|excluid|desestim|no\s+coincid|inconsistenc|incongruenc|no\s+v[aá]lid|"
                       # 1226572: «No se indica motivo de no calificación…» (KEPAL), «Comprobante de pago no sustentado
                       # con voucher…» (MSK, descalificado por experiencia): el lector dejó calificada=None/True.
                       r"no\s+calificaci|no\s+(lo\s+)?sustent", re.I)
_RE_NO_FUERA = re.compile(r"no\s+(fue|qued[oó]|resulta)\s+(descalific|rechaz|excluid)|sin\s+ser\s+descalific", re.I)


def _quedo_fuera(motivo) -> bool:
    """El motivo dice que la oferta quedó fuera (rechazo económico, bajo el mínimo técnico), no sólo que perdió puntos
    («Bonificación MYPE no otorgada…; no fue descalificado», 1226255)."""
    t = str(motivo or "").strip()
    return bool(t) and bool(_RE_FUERA.search(t)) and not _RE_NO_FUERA.search(t)


def postores_acta(state: dict) -> list[dict] | None:
    """Los postores del acta de buena pro según el lector de Vigía (`lecturas_documentos.acta`, Haiku 5.5 leyendo el
    PDF; tools/lecturas.py), con las claves de `_postores_parser`. None si no hay acta leída.

    El lector lista SÓLO a quienes presentaron oferta (no a los registrados), con admitida/calificada y el motivo. Es
    más fiable que el parser genérico: en la prueba de oro de las 4 redes (2026-11-04) el parser sumaba postores que no
    existían (una «oferta» de S/ 30 000 tomada de otro documento, 1232065) y perdía los montos de los perdedores
    (1228861: un rival ofertó el 100 % de la cuantía), y el OCDS cuenta participantes, no ofertas (1227458: 6
    registrados, una sola oferta)."""
    acta = (((state or {}).get("lecturas_documentos") or {}).get("acta") or {}).get("salida") or {}
    if not isinstance(acta, dict) or acta.get("es_buena_pro") is False:
        return None
    post = [p for p in (acta.get("postores") or []) if isinstance(p, dict)]
    if not post:
        return None
    out = []
    for p in post:
        ruc = "".join(ch for ch in str(p.get("ruc") or "") if ch.isdigit())
        if p.get("admitida") is False:
            estado = "no admitido"
        elif p.get("calificada") is False:
            estado = "descalificado"
        elif not p.get("ganador") and _quedo_fuera(p.get("motivo_fuera")):
            # Admitida y calificada, pero quedó fuera después: oferta económica rechazada o bajo el puntaje técnico
            # mínimo (1228202: «el 90 % y 10 % del monto no coinciden»; 1230915: 60 puntos de 70). El lector deja
            # calificada=true y lo dice en motivo_fuera.
            estado = "descalificado"
        elif p.get("ganador"):
            estado = "adjudicado"
        else:
            estado = "valido"
        out.append({"ruc": ruc if len(ruc) == 11 else None, "razon_social": str(p.get("nombre") or "").strip(),
                    "monto": _f(p.get("monto_ofertado")), "es_ganador": bool(p.get("ganador")),
                    "puntaje": p.get("puntaje"), "estado": estado, "orden": None,
                    "motivo": (str(p.get("motivo_fuera"))[:300] if p.get("motivo_fuera") else None),
                    "integrantes_ruc": [r for r in (p.get("integrantes_ruc") or []) if isinstance(r, str)],
                    "fuente": "acta"})
    return out


def n_participantes_parser(state: dict) -> tuple[int, int] | None:
    """(participantes registrados, ofertas presentadas) según el acta leída o el parser, si distingue a los que no
    ofertaron."""
    acta = postores_acta(state)
    if acta:
        ocds = (state or {}).get("ocds") or (state or {}).get("ocds_preloaded") or {}
        n = (ocds.get("tender") or {}).get("numberOfTenderers") if isinstance(ocds, dict) else None
        try:
            n = int(n) if n is not None else None
        except (TypeError, ValueError):
            n = None
        return (max(n or 0, len(acta)), len(acta))
    raw = (state or {}).get("parser_raw_consolidated") or {}
    da = _safe_parse_json((state or {}).get("document_analysis")) or {}
    base = next((f for f in (raw.get("postores"), raw.get("postores_consolidados"), da.get("postores_extraidos"),
                             da.get("postores_consolidados")) if isinstance(f, list) and f), [])
    base = _sin_repetidos([p for p in base if isinstance(p, dict)])
    if not base or not any(p.get("estado") or p.get("estado_oferta") for p in base):
        return None
    sin = sum(1 for p in base if _sin_oferta(p.get("estado") or p.get("estado_oferta")))
    return len(base), len(base) - sin


def _postores_parser(state: dict) -> list[dict]:
    """Postores con montos: los del acta leída (`postores_acta`) si la hay; si no, desde el parser (tolerante a las claves nuevas de R4):
    `parser_raw_consolidated.postores[]` > `postores_consolidados[]` > `document_analysis.
    postores_extraidos[]`, completados con `ofertas[]` (postor, monto, orden) si existen.
    Cada entrada: {ruc, razon_social, monto, es_ganador, puntaje, estado, orden}."""
    acta = postores_acta(state)
    if acta:
        return acta
    raw = (state or {}).get("parser_raw_consolidated") or {}
    da = _safe_parse_json((state or {}).get("document_analysis")) or {}
    fuentes = [raw.get("postores"), raw.get("postores_consolidados"), da.get("postores_extraidos")]
    base = _sin_repetidos([p for p in next((f for f in fuentes if isinstance(f, list) and f), []) if isinstance(p, dict)])
    out: list[dict] = []
    for p in base:
        if not isinstance(p, dict):
            continue
        # Quien se registró pero no ofertó no es postor: contaba como oferta "válida" (1226064: 17 registrados,
        # 3 ofertas, 1 admitida → única oferta válida no disparaba).
        if _sin_oferta(p.get("estado") or p.get("estado_oferta")):
            continue
        ruc = "".join(ch for ch in str(p.get("ruc") or "") if ch.isdigit())
        out.append({
            "ruc": ruc if len(ruc) == 11 else None,
            "razon_social": (p.get("razon_social") or p.get("nombre") or "").strip(),
            "monto": _f(p.get("monto_oferta") if p.get("monto_oferta") is not None else p.get("monto")),
            "es_ganador": p.get("es_ganador"),
            "puntaje": p.get("puntaje"),
            "estado": str(p.get("estado") or p.get("estado_oferta") or "").strip().lower() or None,
            "orden": p.get("orden") or p.get("orden_prelacion"),
        })
    # `ofertas[]` (R4): {postor|razon_social, ruc, monto, orden, estado} — completa montos.
    for o in (raw.get("ofertas") or []):
        if not isinstance(o, dict):
            continue
        monto = _f(o.get("monto") or o.get("monto_oferta"))
        if monto is None:
            continue
        ruc = "".join(ch for ch in str(o.get("ruc") or "") if ch.isdigit())
        nom = _norm_razon_cr(o.get("postor") or o.get("razon_social") or "")
        dest = None
        for p in out:
            if (ruc and p["ruc"] == ruc) or (nom and _norm_razon_cr(p["razon_social"]) == nom):
                dest = p
                break
        if dest is None:
            dest = {"ruc": ruc if len(ruc) == 11 else None, "razon_social": o.get("postor") or o.get("razon_social") or "",
                    "monto": None, "es_ganador": o.get("es_ganador"), "puntaje": o.get("puntaje"),
                    "estado": None, "orden": o.get("orden")}
            out.append(dest)
        if dest["monto"] is None:
            dest["monto"] = monto
        if dest["orden"] is None and o.get("orden") is not None:
            dest["orden"] = o.get("orden")
        if dest["estado"] is None and o.get("estado"):
            dest["estado"] = str(o.get("estado")).strip().lower()
    # Ganador: si el parser no lo marcó, cruzar con awards del OCDS.
    ocds = (state or {}).get("ocds") or (state or {}).get("ocds_preloaded") or {}
    g_ruc, g_nom = _ganador_ocds(ocds)
    if g_ruc and not any(p.get("es_ganador") for p in out):
        for p in out:
            if p["ruc"] == g_ruc or (g_nom and _norm_razon_cr(p["razon_social"]) == _norm_razon_cr(g_nom)):
                p["es_ganador"] = True
    return out


def _sin_tildes(s: str) -> str:
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFD", str(s or "")) if unicodedata.category(c) != "Mn")


def _as_tool(fn):
    """FunctionTool con firma simple `(ocid, tool_context)`: ADK no sabe declarar
    `frozenset[str] | None`, y los sub-agentes LLM no deben elegir el perfil."""
    def _w(ocid: str, tool_context: ToolContext) -> dict:
        return fn(ocid, tool_context)
    _w.__name__ = fn.__name__
    _w.__qualname__ = fn.__qualname__
    _w.__doc__ = fn.__doc__
    return FunctionTool(func=_w)

def _ganador_ruc(ocid: str, state: dict, cur=None) -> tuple[str | None, str | None]:
    """(ruc, razon_social) del ganador principal (`ganador_principal`: mayor monto adjudicado, empate por RUC). Antes era
    la primera oferta ganadora de la base con un `LIMIT 1` sin orden: con varios ganadores, uno cualquiera."""
    g = ganador_principal(ocid, state, cur)
    return (g["ruc"], g.get("nombre")) if g else (None, None)


# ─── Prueba de oro de las redes (2026-11-04): IGV exonerado, honorario fijo y consorciados ───

_RE_EXONERADO_IGV = re.compile(
    r"ley\s*(n[°º.o]*\s*)?27037|amazon[ií]a.{0,80}\bigv\b|exonera\w*\s+(del\s+)?(pago\s+del\s+)?igv|"
    r"no\s+incluye\s+(el\s+)?igv|excluido\s+(el\s+)?igv|inafect\w*\s+(al|del)\s+igv", re.I)


def exonerado_igv(state: dict) -> bool:
    """True si los documentos dicen que la oferta va sin IGV (Ley 27037 de la Amazonía, «no incluye IGV»)."""
    textos = []
    lect = (state or {}).get("lecturas_documentos") or {}
    for k in ("acta", "contrato", "bases"):
        textos.append(json.dumps((lect.get(k) or {}).get("salida") or {}, ensure_ascii=False)[:20000])
    # El lote deja en state['documentos_texto'] sólo los metadatos: el texto se lee por sha256 (tools/verify.py).
    try:
        from tools.verify import textos_documentos
        textos.extend(t[:60000] for t in textos_documentos(state or {}).values())
    except Exception:  # noqa: BLE001
        pass
    return any(_RE_EXONERADO_IGV.search(t) for t in textos if t)


def ratio_vs_referencial(monto, vr, state: dict | None = None) -> tuple[float | None, bool]:
    """(monto / valor referencial, en la misma base tributaria) y si se comparó sin IGV.

    Un postor exonerado del IGV (Ley 27037) oferta sin IGV contra una cuantía publicada con IGV: 67 796,61 frente a
    80 000 es el 84,7 % literal, pero es 80 000 / 1,18 al céntimo (1226359, 1226546). Se compara sin IGV cuando la
    oferta por 1,18 cae a 0,1 % de la cuantía, o cuando los documentos dicen que la oferta va sin IGV y así queda entre
    el 90 % y el 110 %."""
    m, v = _f(monto), _f(vr)
    if not m or not v:
        return None, False
    r = m / v
    r_sin = m * 1.18 / v
    if abs(r - 1) > 0.001 and abs(r_sin - 1) <= 0.001:
        return r_sin, True
    if r < 0.9 and 0.9 <= r_sin <= 1.1 and state is not None and exonerado_igv(state):
        return r_sin, True
    return r, False


_RE_SIN_COMPETENCIA_PRECIO = re.compile(r"convenio|r[eé]g[ií]men\s+especial", re.I)


def honorario_fijo(state: dict) -> bool:
    """True si el monto lo fijaron las bases y no hubo oferta económica: un convenio o un régimen especial donde el
    acta trae varios candidatos evaluados por calificaciones o entrevista y sólo el adjudicatario tiene monto, igual a
    la cuantía (1228800, 1231429, 1232540: honorario de los TDR, terna de candidatos). Ahí el único «postor» del OCDS y
    la oferta igual al referencial son por construcción, no señales."""
    tipo = _procurement_method(state)
    if not _RE_SIN_COMPETENCIA_PRECIO.search(tipo or ""):
        return False
    acta = postores_acta(state) or []
    if len(acta) < 2:
        return False
    gan = [p for p in acta if p.get("es_ganador")]
    otros = [p for p in acta if not p.get("es_ganador")]
    if len(gan) != 1 or any(p.get("monto") for p in otros):
        return False
    ocds = (state or {}).get("ocds") or (state or {}).get("ocds_preloaded") or {}
    vr = _montos_ocds(ocds).get("referencial")
    m = gan[0].get("monto") or _monto_adjudicado_ocds(ocds)[0]
    return bool(vr and m and abs(float(m) - float(vr)) / float(vr) <= 0.001)


def ganadores_evaluables(ocid: str, state: dict, cur=None) -> list[dict]:
    """Quién ganó y, si es un consorcio, cada integrante (hasta 5): [{ruc, nombre, consorcio, monto, fecha_buena_pro}].

    Fuente: la buena pro del CONOSCE (conosce_adjudicaciones por código y entidad) con conosce_consorcios; sin ella, los
    suppliers del OCDS con RUC. Antes las reglas de proveedor partían de `postores`/`ofertas`/`empresas` de la base
    propia, donde un consorcio figura con su código del SEACE y no tiene fila en `empresas`: con un consorcio ganador no
    se evaluaba a nadie (prueba de oro 2026-11-04: RUC nuevo, giro SUNAT, concentración y visitas de un consorciado,
    9 omisiones). Se guarda en state["_ganadores_eval"]."""
    st = state if isinstance(state, dict) else {}
    ya = st.get("_ganadores_eval")
    if isinstance(ya, dict) and ya.get("ocid") == str(ocid):
        return ya["lista"]
    out: list[dict] = []
    conn = None
    try:
        if cur is None:
            conn = _pg()
            cur = conn.cursor()
        # Los 5 de mayor monto, empate por RUC (`_adjudicaciones_conosce`).
        for ruc, nombre, monto, fbp in _adjudicaciones_conosce(ocid, st, cur)[:5]:
            if re.fullmatch(r"(10|15|17|20)\d{9}", ruc):
                out.append({"ruc": ruc, "nombre": nombre, "consorcio": None, "monto": monto, "fecha_buena_pro": fbp})
                continue
            cur.execute("""SELECT DISTINCT ruc_miembro, miembro FROM conosce_consorcios
                            WHERE ruc_consorcio = %s AND ruc_miembro ~ '^(10|15|17|20)[0-9]{9}$'
                            ORDER BY 1 LIMIT 5""", (ruc,))
            for mr, mn in cur.fetchall():
                out.append({"ruc": mr, "nombre": mn, "consorcio": nombre or ruc, "monto": monto, "fecha_buena_pro": fbp})
    except Exception:  # noqa: BLE001 — sin base, el OCDS
        out = []
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:  # noqa: BLE001
                pass
    if not out:
        # Sin CONOSCE: las adjudicaciones VIGENTES del OCDS (no la buena pro que se reemplazó), por monto.
        ocds = st.get("ocds") or st.get("ocds_preloaded") or {}
        fbp = _to_date(((ocds.get("awards") or [{}])[0] or {}).get("date")) if isinstance(ocds, dict) else None
        for d, nombre, monto in _ganadores_ocds(ocds)[:5]:
            if len(d) == 11:
                out.append({"ruc": d, "nombre": nombre, "consorcio": None, "monto": monto or None, "fecha_buena_pro": fbp})
    if isinstance(state, dict):
        state["_ganadores_eval"] = {"ocid": str(ocid), "lista": out}
    return out
