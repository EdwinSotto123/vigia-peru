"""Claves de dedup/similitud de ítems — usado tanto por el parser en lote como por el
legacy para no duplicar el mismo ítem numerado distinto en dos documentos."""

from tools._core import *  # noqa: F401,F403
from ._base import _norm_txt, _LOOKALIKES


def _desc_compacta(desc: str) -> str:
    """Descripción como clave: MAYÚSCULAS sin tildes, lookalikes griegos/cirílicos del OCR
    (Μ→M), sin espacios ni puntuación ('DRYWALL 0.90 mm' == 'DRYWALL0.90 MM …')."""
    d = _norm_txt(str(desc or "")).translate(_LOOKALIKES)
    return re.sub(r"[^A-Z0-9]", "", d)


def _buscar_item_similar(existing_keys: dict, k):
    """Clave ('d', desc[, cantidad]) → ítem ya consolidado cuya descripción compacta sea
    ≥ 0.92 similar (difflib) con la MISMA cantidad; None si no hay. Evita el ítem duplicado
    por ruido OCR (total de mercado doble) sin fundir productos distintos."""
    import difflib
    if not k or k[0] != "d":
        return None
    desc = k[1]
    cant = k[2] if len(k) > 2 else None
    for k2, it in existing_keys.items():
        if k2[0] != "d" or (len(k2) > 2) != (len(k) > 2):
            continue
        if len(k2) > 2 and k2[2] != cant:
            continue
        if abs(len(k2[1]) - len(desc)) > max(4, int(0.15 * len(desc))):
            continue
        if difflib.SequenceMatcher(None, k2[1], desc).ratio() >= 0.92:
            return it
    return None


def _item_key(it: dict):
    """Clave semántica para dedup de ítems (fix #1): descripción normalizada +
    cantidad. Evita que el MISMO ítem, numerado distinto en dos documentos
    ('2' vs '02', '1.0' vs '01'), sobreviva duplicado y duplique el trabajo del
    market agent. Devuelve None si no hay descripción ni número."""
    desc = _desc_compacta(it.get("descripcion_corta") or it.get("descripcion") or "")
    if desc:
        req = (it.get("requerimiento_tecnico_detallado") or "").strip()
        # Cabeceras de objeto/agregador (SIN requerimiento): el mismo
        # "ADQUISICIÓN DE LLANTAS..." aparece como "ítem 1" en cada documento
        # (acta, reporte, contrato) → dedup por descripción SOLA para no
        # multiplicarlo. Ítems reales (con requerimiento) usan desc+cantidad
        # para no fusionar productos distintos del mismo rubro.
        return ("d", desc) if not req else ("d", desc, it.get("cantidad"))
    num = it.get("numero")
    if num is not None and str(num).strip():
        return ("n", str(num).strip())
    return None
