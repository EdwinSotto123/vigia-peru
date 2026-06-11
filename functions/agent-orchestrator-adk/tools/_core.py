"""Núcleo compartido de tools: imports, config y helpers usados por
múltiples dominios. Los módulos de dominio hacen `from tools._core import *`."""

from __future__ import annotations

from __future__ import annotations
import base64
import concurrent.futures
import io
import json
import os
import random
import re
import threading
import time
import zipfile
import pg8000.dbapi
import requests
from google.adk.tools import FunctionTool, ToolContext
import datetime as _dt

_GEMINI_CALL_SEM = threading.Semaphore(2)
_GEMINI_LAST_CALL_T = [0.0]
_GEMINI_LAST_CALL_LOCK = threading.Lock()
_GEMINI_MIN_INTERVAL_S = 0.25
PG_HOST = os.getenv("PGHOST", "/cloudsql/vivid-spot-480905-a4:us-central1:vigia-db")
PG_USER = os.getenv("PGUSER", "postgres")
PG_PASS = os.getenv("PGPASSWORD", "")
PG_DB = os.getenv("PGDATABASE", "vigia")
OECE_BASE = "https://contratacionesabiertas.oece.gob.pe/api/v1"
BROWSER = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "*/*",
    "Referer": "https://contratacionesabiertas.oece.gob.pe/",
}
_CAUSALES_DIRECTA = [
    ("a", r"(situaci[oó]n de emergencia|desastre|catastrofe|cat[áa]strofe|"
          r"emergencia\s+(?:nacional|sanitaria|ambiental)|lluvias intensas|sismo|terremoto)",
     "Situación de emergencia / desastre", True),
    ("b", r"desabastecimiento(\s+inminente)?", "Desabastecimiento inminente", True),
    ("c", r"contrataci[oó]n\s+(entre|con)\s+entidad(es)?\s+p[uú]blica",
     "Contratación entre entidades públicas", False),
    ("d", r"servicios?\s+p[uú]blicos?\s+.{0,30}\s+tarifa(s)?\s+regulad",
     "Servicio público con tarifa regulada", False),
    ("e", r"servicios?\s+financieros?\s+del\s+estado",
     "Servicios financieros del Estado", False),
    ("f", r"(propiedad\s+(intelectual|industrial)|patente|marca\s+registrada|"
          r"derechos?\s+de\s+autor)\s+.{0,40}(únic|exclusiv)",
     "Bien con propiedad intelectual única", False),
    ("g", r"servicio\s+personal[ií]simo|notoria\s+especializaci[oó]n",
     "Servicio personalísimo / notoria especialización", False),
    ("h", r"servicios?\s+de\s+publicidad\s+(en\s+medios|por\s+medios)",
     "Servicio de publicidad en medios", False),
    ("i", r"servicios?\s+de\s+consultor[ií]a(\s+especializa)?",
     "Servicios de consultoría especializada", False),
    ("j", r"asesor[ií]a\s+legal\s+(en\s+casos\s+excepcionales|excepcional)",
     "Asesoría legal en casos excepcionales", False),
    ("k", r"capacitaci[oó]n\s+(institucional|necesaria)|pasant[ií]a",
     "Capacitación / pasantía", False),
]
DECOLECTA_BASE = os.getenv("DECOLECTA_BASE", "https://api.decolecta.com/v1")
DECOLECTA_API_KEY = os.getenv("DECOLECTA_API_KEY", "")
_MAX_RENDER_PAGES = 30
DEFAULT_GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash")
PINECONE_HOST = "https://rag-leyes-k8u4w2h.svc.gcp-us-central1-4a9f.pinecone.io"
PINECONE_API_KEY = os.getenv("PINECONE_API_KEY", "")
RAG_NAMESPACE = "opiniones-oece"
EMBED_MODEL_RAG = "gemini-embedding-001"

def _table_exists(cur, table_name: str) -> bool:
    cur.execute(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema='public' AND table_name=%s LIMIT 1",
        (table_name,),
    )
    return cur.fetchone() is not None

def _gemini_call_with_retry(fn, *, max_attempts: int = 6, base_delay: float = 2.0):
    """Llama a `fn()` (sync) con retry exponencial + jitter en caso de 429.
    `fn` ya debe estar dentro del semáforo si aplica. Devuelve el resultado
    de fn() o re-raisea la última excepción si se agotaron los attempts.
    """
    last_exc = None
    for attempt in range(max_attempts):
        try:
            return fn()
        except Exception as e:
            msg = str(e)
            # Reintentamos sólo 429 / RESOURCE_EXHAUSTED / 5xx transitorios
            transient = (
                "429" in msg or "RESOURCE_EXHAUSTED" in msg
                or "503" in msg or "UNAVAILABLE" in msg
                or "500 INTERNAL" in msg or "DeadlineExceeded" in msg
            )
            if not transient or attempt == max_attempts - 1:
                last_exc = e
                break
            sleep_s = base_delay * (2 ** attempt) + random.uniform(0, 1.0)
            time.sleep(min(sleep_s, 60.0))
            last_exc = e
    if last_exc:
        raise last_exc

def _throttle_gemini():
    """Bloquea hasta que haya cupo en el semáforo y respete el interval
    mínimo entre llamadas. Usar como context manager.
    """
    class _Ctx:
        def __enter__(self):
            _GEMINI_CALL_SEM.acquire()
            with _GEMINI_LAST_CALL_LOCK:
                dt = time.time() - _GEMINI_LAST_CALL_T[0]
                if dt < _GEMINI_MIN_INTERVAL_S:
                    time.sleep(_GEMINI_MIN_INTERVAL_S - dt + random.uniform(0, 0.15))
                _GEMINI_LAST_CALL_T[0] = time.time()
            return self
        def __exit__(self, *a):
            _GEMINI_CALL_SEM.release()
    return _Ctx()

def _safe_parse_json(s):
    """Best-effort JSON parse. Devuelve dict (o el valor original si ya es dict).
    NUNCA levanta excepción. Útil para parsear outputs de LLM que pueden venir
    como JSON string, JSON malformado, fenced markdown, o ya como dict.
    """
    if s is None:
        return {}
    if isinstance(s, dict):
        return s
    if isinstance(s, list):
        return s
    if not isinstance(s, str):
        return {}
    s = s.strip()
    if not s:
        return {}
    # Intento 1: parse directo
    try:
        return json.loads(s)
    except Exception:
        pass
    # Intento 2: buscar primer { … último } con regex y parsear
    try:
        m = re.search(r"\{[\s\S]+\}", s)
        if m:
            return json.loads(m.group(0))
    except Exception:
        pass
    # Intento 3: extraer de fenced ```json … ```
    try:
        m2 = re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", s, re.IGNORECASE)
        if m2:
            return json.loads(m2.group(1))
    except Exception:
        pass
    # Intento 4: JSON truncado por max_output_tokens. Cerramos braces/brackets
    # pendientes para recuperar lo máximo posible. Útil cuando Gemini Flash
    # genera schemas grandes y el output se corta a mitad de un objeto.
    try:
        # Empezamos del primer { que vemos
        start = s.find("{")
        if start < 0:
            return {}
        candidate = s[start:]
        # Si termina con coma o medio-string, recortamos hasta el último } o ] sano
        # Estrategia: contar braces/brackets y cerrar los faltantes
        depth_obj = 0
        depth_arr = 0
        in_string = False
        escape = False
        last_safe = -1
        for i, ch in enumerate(candidate):
            if escape:
                escape = False
                continue
            if ch == "\\":
                escape = True
                continue
            if ch == '"' and not escape:
                in_string = not in_string
                continue
            if in_string:
                continue
            if ch == "{":
                depth_obj += 1
            elif ch == "}":
                depth_obj -= 1
                if depth_obj == 0 and depth_arr == 0:
                    last_safe = i
            elif ch == "[":
                depth_arr += 1
            elif ch == "]":
                depth_arr -= 1
                if depth_obj == 0 and depth_arr == 0:
                    last_safe = i
        # Si el JSON cerró bien en algún punto, usar hasta ahí
        if last_safe > 0:
            try:
                return json.loads(candidate[:last_safe + 1])
            except Exception:
                pass
        # Si quedaron braces/brackets pendientes, cerrarlos en el último punto
        # sano (último , antes del corte → reemplazar por nada, cerrar)
        truncated = candidate
        # Si está en mitad de string, cerrarla
        if in_string:
            truncated += '"'
        # Eliminar coma final si la hay
        truncated = re.sub(r",\s*$", "", truncated.rstrip())
        # Cerrar brackets pendientes
        truncated += "]" * max(depth_arr, 0)
        truncated += "}" * max(depth_obj, 0)
        try:
            return json.loads(truncated)
        except Exception:
            pass
    except Exception:
        pass
    return {}

def _pg():
    if PG_HOST.startswith("/cloudsql/"):
        return pg8000.dbapi.connect(
            user=PG_USER, password=PG_PASS, database=PG_DB,
            unix_sock=f"{PG_HOST}/.s.PGSQL.5432",
        )
    return pg8000.dbapi.connect(
        host=PG_HOST, port=5432, user=PG_USER, password=PG_PASS,
        database=PG_DB, ssl_context=True,
    )

def _normalize_name_for_search(s: str) -> str:
    """UPPER + sin tildes + colapso de espacios — mismo formato que el ETL."""
    import unicodedata, re as _re
    s = "".join(c for c in unicodedata.normalize("NFD", s or "")
                if not unicodedata.combining(c))
    return _re.sub(r"\s+", " ", s.upper()).strip()

def _short_ocid(ocid: str) -> str:
    """Normaliza el OCID al formato corto (sólo el sufijo numérico) que es como
    está guardado en `convocatorias.ocid` y `convocatoria_items.ocid` en SQL.

    Ejemplos:
      'ocds-dgv273-seacev3-1212353' → '1212353'
      '1212353' → '1212353'
    """
    if not ocid:
        return ocid
    s = str(ocid)
    if s.startswith("ocds-"):
        return s.rsplit("-", 1)[-1]
    return s

def _normalize_persona(s: str) -> str:
    """Quita acentos + uppercase + colapsa espacios. Para match en datasets."""
    if not s:
        return ""
    import unicodedata
    nfkd = unicodedata.normalize("NFKD", str(s))
    ascii_only = "".join(c for c in nfkd if not unicodedata.combining(c))
    return " ".join(ascii_only.upper().split())

def _annotate_future_date(date_str: str | None) -> bool:
    """Devuelve True si la fecha (yyyy-mm-dd) es estrictamente posterior a hoy."""
    if not date_str:
        return False
    try:
        d = _dt.date.fromisoformat(str(date_str)[:10])
        return d > _dt.date.today()
    except Exception:
        return False

def _gemini_client():
    """Devuelve un cliente genai apuntando a Gemini API (si GOOGLE_API_KEY está
    configurado) o a Vertex AI (fallback). Permite cambiar de provider con solo
    una env var, sin tocar el código.

    Razón: Vertex AI en proyectos nuevos sin historial sufre rate limiting
    dinámico agresivo (429 RESOURCE_EXHAUSTED). Gemini API (AI Studio) tiene
    cuotas separadas y mucho más generosas en Paid Tier 1 (1000 RPM vs los
    bursts impredecibles de Vertex).
    """
    from google import genai
    # GOOGLE_GENAI_USE_VERTEXAI=true fuerza Vertex aunque haya GOOGLE_API_KEY
    # (reversible por env, sin tocar código). Default: AI Studio si hay key.
    use_vertex = os.getenv("GOOGLE_GENAI_USE_VERTEXAI", "").strip().lower() in ("true", "1", "yes")
    api_key = os.getenv("GOOGLE_API_KEY", "").strip()
    if api_key and not use_vertex:
        return genai.Client(api_key=api_key)
    # Vertex: el endpoint `global` enruta a la región menos saturada → minimiza
    # 429 RESOURCE_EXHAUSTED (us-central1 es la más saturada). Lee tanto las env
    # custom (VERTEX_*) como las estándar de google-genai (GOOGLE_CLOUD_*).
    return genai.Client(
        vertexai=True,
        project=os.getenv("VERTEX_PROJECT") or os.getenv("GOOGLE_CLOUD_PROJECT", "vivid-spot-480905-a4"),
        location=os.getenv("VERTEX_LOCATION") or os.getenv("GOOGLE_CLOUD_LOCATION", "global"),
    )

def _today_iso() -> str:
    """Fecha de hoy en ISO (yyyy-mm-dd) — UTC para consistencia."""
    return _dt.date.today().isoformat()

__all__ = ['BROWSER', 'DECOLECTA_API_KEY', 'DECOLECTA_BASE', 'DEFAULT_GEMINI_MODEL', 'EMBED_MODEL_RAG', 'FunctionTool', 'OECE_BASE', 'PG_DB', 'PG_HOST', 'PG_PASS', 'PG_USER', 'PINECONE_API_KEY', 'PINECONE_HOST', 'RAG_NAMESPACE', 'ToolContext', '_CAUSALES_DIRECTA', '_GEMINI_CALL_SEM', '_GEMINI_LAST_CALL_LOCK', '_GEMINI_LAST_CALL_T', '_GEMINI_MIN_INTERVAL_S', '_MAX_RENDER_PAGES', '_annotate_future_date', '_dt', '_gemini_call_with_retry', '_gemini_client', '_normalize_name_for_search', '_normalize_persona', '_pg', '_safe_parse_json', '_short_ocid', '_table_exists', '_throttle_gemini', '_today_iso', 'annotations', 'base64', 'concurrent', 'io', 'json', 'os', 'pg8000', 'random', 're', 'requests', 'threading', 'time', 'zipfile']
