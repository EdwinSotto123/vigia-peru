"""Smoke tests LIVE de la migración a gemini-3.6-flash en Vertex AI (global).

Correr:  RUN_LIVE=1 python -m pytest backend/agent/tests -m live -q -s
(ADC de gcloud; GOOGLE_GENAI_USE_VERTEXAI=1 GOOGLE_CLOUD_LOCATION=global
GOOGLE_CLOUD_PROJECT=vivid-spot-480905-a4 — conftest los fija si faltan).

Qué verifica (resultado pegado en docs/design/PERFILES_AGENTES.md):
  1. `thinking_level` minimal/low/medium/high aceptados por 3.6-flash (y thoughts_token_count).
  2. `response_schema` + `google_search` en la MISMA llamada: JSON válido y si llega
     `grounding_metadata` (chunks) — decide el patrón de salida de los agentes con grounding.
  3. Function calling con 2 tools encadenadas + thinking en un LlmAgent de ADK (thought
     signatures round-trip) no da 400.
  4. Parser con `temperature` default vs 0.0 sobre un PDF corto de `documentos_gcs`: mismos ítems.
Los tests imprimen (-s) un resumen `LIVE[...]` por caso para el informe.
"""
from __future__ import annotations

import json
import os
import time

import pytest
from pydantic import BaseModel

pytestmark = pytest.mark.live

MODEL = os.getenv("LIVE_MODEL", "gemini-3.6-flash")


def _client():
    from google import genai
    return genai.Client()


def _retry(fn, n=4):
    """Solo 429/503 (cuota dinámica de Vertex); cualquier otro error se propaga."""
    last = None
    for i in range(n):
        try:
            return fn()
        except Exception as e:  # noqa: BLE001
            s = str(e)
            if "429" in s or "503" in s or "RESOURCE_EXHAUSTED" in s:
                last = e
                time.sleep(8 * (i + 1))
                continue
            raise
    raise last


# ── 1. thinking_level ────────────────────────────────────────────────────────
@pytest.mark.parametrize("level", ["minimal", "low", "medium", "high"])
def test_thinking_level_aceptado(level):
    from google.genai import types
    c = _client()
    t = time.time()
    r = _retry(lambda: c.models.generate_content(
        model=MODEL, contents="Responde en una línea: ¿cuál es la capital de Perú?",
        config=types.GenerateContentConfig(
            thinking_config=types.ThinkingConfig(thinking_level=level, include_thoughts=False))))
    um = r.usage_metadata
    thoughts = getattr(um, "thoughts_token_count", None)
    print(f"\nLIVE[thinking_level={level}] ok {time.time() - t:.1f}s thoughts={thoughts} "
          f"out={um.candidates_token_count} text={r.text[:40]!r}")
    assert "lima" in (r.text or "").lower()
    if level != "minimal":
        assert (thoughts or 0) > 0, "3.6-flash debe reportar thoughts_token_count con thinking"


def test_thinking_via_adk_planner_no_rechazado():
    """En ADK 1.19 el thinking va por planner; en generate_content_config lanza ValueError."""
    from google.adk.agents import LlmAgent
    from google.genai import types
    from agents._shared.models import build_planner
    planner = build_planner("x_agent", MODEL, "low")
    assert planner is not None
    assert str(planner.thinking_config.thinking_level).lower().endswith("low")
    LlmAgent(name="x_agent", model=MODEL, instruction="hola", planner=planner)
    with pytest.raises(ValueError):
        LlmAgent(name="y_agent", model=MODEL, instruction="hola",
                 generate_content_config=types.GenerateContentConfig(
                     thinking_config=types.ThinkingConfig(thinking_level="low")))


# ── 2. response_schema + google_search ───────────────────────────────────────
class _Precio(BaseModel):
    producto: str
    precio_soles: float | None = None
    tienda: str | None = None
    url: str | None = None


class _MarketOut(BaseModel):
    estado: str
    precios: list[_Precio]


def test_schema_mas_grounding_en_la_misma_llamada():
    from google.genai import types
    c = _client()
    prompt = ("¿Cuánto cuesta hoy en Perú una laptop HP 15 pulgadas core i5? Cita las tiendas "
              "y las URLs donde lo viste.")
    resultados = []
    for schema in (False, True):
        cfg = dict(tools=[types.Tool(google_search=types.GoogleSearch())],
                   thinking_config=types.ThinkingConfig(thinking_level="low"))
        if schema:
            cfg.update(response_mime_type="application/json", response_schema=_MarketOut)
        t = time.time()
        r = _retry(lambda: c.models.generate_content(
            model=MODEL, contents=prompt, config=types.GenerateContentConfig(**cfg)))
        gm = r.candidates[0].grounding_metadata
        chunks = list(getattr(gm, "grounding_chunks", None) or []) if gm else []
        queries = list(getattr(gm, "web_search_queries", None) or []) if gm else []
        valid = None
        if schema:
            try:
                _MarketOut.model_validate_json(r.text)
                valid = True
            except Exception:
                valid = False
        resultados.append((schema, len(chunks), len(queries), valid))
        print(f"\nLIVE[schema={schema}+google_search] {time.time() - t:.1f}s "
              f"grounding_chunks={len(chunks)} queries={len(queries)} json_valido={valid}")
    sin, con = resultados
    assert sin[2] > 0 and con[2] > 0, "la búsqueda debe ejecutarse en ambos casos"
    assert con[3] is True, "con response_schema el JSON debe validar"
    # Hallazgo documentado: con schema, grounding_chunks suele venir VACÍO en 3.x → las URLs
    # del JSON no son verificables por grounding_metadata. Si algún día llegan, este print lo
    # mostrará; el assert solo exige que SIN schema sí haya chunks (el patrón vigente).
    if con[1] == 0:
        print("LIVE[schema+grounding] NOTA: grounding_chunks=0 con response_schema → mantener "
              "'JSON en texto + validación pydantic en el driver' (models.OUTPUT_SCHEMA_NATIVO=0)")
    assert sin[1] > 0, "sin schema, el grounding debe traer chunks con URLs verificables"


# ── 3. function calling encadenado con thinking (thought signatures) en ADK ──
def test_dos_tools_encadenadas_con_thinking_en_adk():
    import asyncio
    from google.adk.agents import LlmAgent
    from google.adk.runners import Runner
    from google.adk.sessions import InMemorySessionService
    from google.genai import types
    from agents._shared.models import build_planner

    llamadas: list[str] = []

    def buscar_ruc(razon_social: str) -> dict:
        """Devuelve el RUC de una empresa a partir de su razón social."""
        llamadas.append("buscar_ruc")
        return {"ruc": "20100000001", "razon_social": razon_social}

    def sanciones_por_ruc(ruc: str) -> dict:
        """Devuelve las sanciones vigentes de un RUC."""
        llamadas.append("sanciones_por_ruc")
        return {"ruc": ruc, "sanciones": [], "estado": "sin_dato"}

    agent = LlmAgent(
        name="encadenado_agent", model=MODEL,
        instruction=("Sos un asistente de verificación. Para responder DEBÉS llamar primero a "
                     "buscar_ruc y DESPUÉS a sanciones_por_ruc con el RUC obtenido. Respondé en "
                     "una línea con el RUC y si tiene sanciones."),
        tools=[buscar_ruc, sanciones_por_ruc],
        planner=build_planner("encadenado_agent", MODEL, "low"),
    )
    ss = InMemorySessionService()
    runner = Runner(agent=agent, app_name="live", session_service=ss)

    async def _run():
        await ss.create_session(app_name="live", user_id="u", session_id="s")
        msg = types.Content(role="user", parts=[types.Part.from_text(
            text="Verificá a la empresa '<EMPRESA DE PRUEBA> S.A.C.'")])
        final = None
        n_fc = 0
        n_sig = 0
        async for ev in runner.run_async(user_id="u", session_id="s", new_message=msg):
            for p in ((ev.content.parts if ev.content else None) or []):
                if getattr(p, "function_call", None):
                    n_fc += 1
                if getattr(p, "thought_signature", None):
                    n_sig += 1
                if getattr(p, "text", None) and ev.is_final_response():
                    final = p.text
        return final, n_fc, n_sig

    t = time.time()
    final, n_fc, n_sig = _retry(lambda: asyncio.run(_run()))
    print(f"\nLIVE[2 tools + thinking en ADK] {time.time() - t:.1f}s function_calls={n_fc} "
          f"parts_con_thought_signature={n_sig} orden={llamadas} final={(final or '')[:80]!r}")
    assert llamadas == ["buscar_ruc", "sanciones_por_ruc"], llamadas
    assert final and "20100000001" in final


# ── 4. Parser: temperature default vs 0.0 sobre un PDF real de documentos_gcs ──
class _Item(BaseModel):
    descripcion: str
    cantidad: float | None = None
    unidad: str | None = None


class _ParserOut(BaseModel):
    objeto: str | None = None
    items: list[_Item]
    firmantes: list[str] = []


def _pdf_de_documentos_gcs() -> tuple[str, bytes] | None:
    """Un PDF corto (≤ 300 KB) vigente en documentos_gcs, bajado de GCS. None si no hay DB/GCS."""
    try:
        from tools import _pg
        conn = _pg()
        try:
            cur = conn.cursor()
            cur.execute("SELECT ocid, url_gcs FROM documentos_gcs WHERE borrado_at IS NULL "
                        "AND formato ILIKE 'pdf' AND bytes BETWEEN 30000 AND 300000 "
                        "ORDER BY bytes ASC LIMIT 1")
            row = cur.fetchone()
        finally:
            conn.close()
        if not row:
            return None
        ocid, gs = row
        from google.cloud import storage
        bucket, _, path = gs[len("gs://"):].partition("/")
        blob = storage.Client().bucket(bucket).blob(path).download_as_bytes()
        return f"{ocid}:{gs}", blob
    except Exception as e:  # noqa: BLE001
        print(f"\nLIVE[parser] sin acceso a documentos_gcs/GCS: {str(e)[:120]}")
        return None


def test_parser_temperature_default_vs_cero():
    from google.genai import types
    doc = _pdf_de_documentos_gcs()
    if doc is None:
        pytest.skip("sin DB/GCS (PGPASSWORD + ADC) para tomar un PDF de documentos_gcs")
    label, blob = doc
    c = _client()
    prompt = ("Extraé del documento: objeto, ítems (descripción, cantidad, unidad) y firmantes "
              "(nombre completo). Solo lo que aparezca literalmente; listas vacías si no hay.")
    salidas = {}
    for temp in (None, 0.0):
        kw = dict(response_mime_type="application/json", response_schema=_ParserOut,
                  thinking_config=types.ThinkingConfig(thinking_level="low"),
                  max_output_tokens=8192)
        if temp is not None:
            kw["temperature"] = temp
        t = time.time()
        r = _retry(lambda: c.models.generate_content(
            model=MODEL,
            contents=[types.Part.from_bytes(data=blob, mime_type="application/pdf"), prompt],
            config=types.GenerateContentConfig(**kw)))
        out = _ParserOut.model_validate_json(r.text)
        salidas[temp] = out
        print(f"\nLIVE[parser temp={temp}] {time.time() - t:.1f}s items={len(out.items)} "
              f"firmantes={len(out.firmantes)} thoughts={getattr(r.usage_metadata, 'thoughts_token_count', None)} "
              f"doc={label}")
    a, b = salidas[None], salidas[0.0]
    na, nb = len(a.items), len(b.items)
    desc_a = {i.descripcion.strip().lower()[:60] for i in a.items}
    desc_b = {i.descripcion.strip().lower()[:60] for i in b.items}
    inter = len(desc_a & desc_b)
    print(f"LIVE[parser] items default={na} cero={nb} coincidencias_exactas={inter}")
    # Misma cantidad de ítems (±1) entre temperaturas; la redacción puede variar.
    assert abs(na - nb) <= 1, f"items default={na} vs temp0={nb}"
