"""
Cliente OECE Contrataciones Abiertas · OCDS API v1.

Doc oficial: https://contratacionesabiertas.oece.gob.pe/api/docs

Endpoints útiles:
  GET /api/v1/releases                                  → lista paginada
  GET /api/v1/releases?date_gte=YYYY-MM-DD              → filtro fecha
  GET /api/v1/record/<ocid>                             → 1 record completo
  GET /api/v1/release/<release-id>                      → 1 release puntual
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://contratacionesabiertas.oece.gob.pe/api/v1"
HEADERS = {"User-Agent": "vigia-peru/0.1", "Accept": "application/json"}


def fetch_record(ocid: str, timeout: int = 30) -> dict | None:
    """Devuelve el compiledRelease del OCID, o None si no existe."""
    if not ocid:
        return None
    url = f"{BASE}/record/{urllib.parse.quote(ocid)}"
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = json.loads(r.read().decode("utf-8"))
            recs = data.get("records") or []
            if not recs:
                return None
            return recs[0].get("compiledRelease")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise
    except Exception as e:
        print(f"  ⚠ OECE error {type(e).__name__}: {e}")
        return None


def list_releases(since: str | None = None, limit: int = 20, page: int = 1) -> list[dict]:
    """Lista releases ordenados desc por fecha de publicación."""
    qs = {"limit": str(limit), "page": str(page)}
    if since:
        qs["date_gte"] = since
    url = f"{BASE}/releases?{urllib.parse.urlencode(qs)}"
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read().decode("utf-8"))
        return data.get("releases", [])


# ─── Helpers para extraer campos OCDS ──────────────────────────────

def buyer_ruc(cr: dict) -> str | None:
    """Extrae el RUC de 11 dígitos del buyer (no el PE-CONSUCODE)."""
    parties = cr.get("parties") or []
    for p in parties:
        if "buyer" in (p.get("roles") or []) or "procuringEntity" in (p.get("roles") or []):
            for ai in (p.get("additionalIdentifiers") or []):
                if ai.get("scheme") == "PE-RUC" and len(ai.get("id", "")) == 11:
                    return ai["id"]
            ident = p.get("identifier") or {}
            if ident.get("scheme") == "PE-RUC" and len(ident.get("id", "")) == 11:
                return ident["id"]
    return None


def buyer_name(cr: dict) -> str | None:
    return (cr.get("buyer") or {}).get("name")


def suppliers(cr: dict) -> list[dict]:
    """Devuelve [{ruc, name, roles}] de los suppliers/tenderers."""
    out = []
    for p in (cr.get("parties") or []):
        if not any(r in (p.get("roles") or []) for r in ("supplier", "tenderer")):
            continue
        ident = p.get("identifier") or {}
        if ident.get("scheme") == "PE-RUC" and len(ident.get("id", "")) == 11:
            out.append({
                "ruc": ident["id"],
                "name": p.get("name") or ident.get("legalName"),
                "roles": p.get("roles", []),
            })
    return out


def tender_value(cr: dict) -> float:
    v = (cr.get("tender") or {}).get("value") or {}
    return float(v.get("amount") or 0)


def tender_items(cr: dict) -> list[dict]:
    return ((cr.get("tender") or {}).get("items") or [])


def tender_documents(cr: dict) -> list[dict]:
    return ((cr.get("tender") or {}).get("documents") or [])


def awards(cr: dict) -> list[dict]:
    return cr.get("awards") or []


def fecha_buena_pro(cr: dict) -> str | None:
    """Saca la fecha más tardía de awards.date, o tender.tenderPeriod.endDate."""
    aws = awards(cr)
    dates = [a.get("date") for a in aws if a.get("date")]
    if dates:
        return max(dates)[:10]
    tp = (cr.get("tender") or {}).get("tenderPeriod") or {}
    return (tp.get("endDate") or "")[:10] or None


def fecha_convocatoria(cr: dict) -> str | None:
    tp = (cr.get("tender") or {}).get("tenderPeriod") or {}
    return (tp.get("startDate") or "")[:10] or None


def region_from_buyer(cr: dict) -> str | None:
    """Saca la región del address del buyer."""
    for p in (cr.get("parties") or []):
        if "buyer" in (p.get("roles") or []):
            return (p.get("address") or {}).get("region")
    return None


def codigo_convocatoria(ocid: str) -> str:
    """Extrae el código de SEACE del OCID. Ej: ocds-dgv273-seacev3-1202858 → 1202858."""
    parts = ocid.split("-")
    return parts[-1] if parts else ocid
