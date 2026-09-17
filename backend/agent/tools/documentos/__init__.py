"""Tools del dominio: documentos.

Paquete (antes archivo único): dos caminos conviven:
  · `parse_documentos_lote` / `parse_documentos_seleccionados` (WS D, 2026-09-15): selección
    determinista (tools/doc_select.py), OCR una sola vez por sha256 (tabla documentos_texto,
    páginas ⟦p.N⟧), extracción con schema base + bloque del perfil y evidencia verificable.
  · `list_documents` / `parse_document_pdf` (legacy, tool del LlmAgent): misma expansión de
    contenedores sin topes y mismo schema, pero por URL y sin caché entre corridas.

Este `__init__` reexporta todo lo que exponía el módulo plano original para que
`import tools.documentos as D` / `from tools.documentos import X` sigan funcionando igual.
"""

from tools._core import *  # noqa: F401,F403
from tools._core import downloader_base
from tools.doc_select import (  # noqa: F401  (re-exportado via `from tools import *`)
    seleccionar_documentos, rank_documento, recorte_seleccion, PRIORIDAD_DEFAULT, MAX_DOCS_DEFAULT,
)

from ._base import (  # noqa: F401
    PARSE_PAGES_PER_SHARD, PARSE_SHARD_THRESHOLD, PARSE_MAX_WORKERS, PARSE_CALL_TIMEOUT_MS,
    PARSE_OVERALL_TIMEOUT_S, PARSE_GLOBAL_BUDGET_S, VERSION_PARSER, PARSER_SCHEMA_VERSION,
    PARSE_MAX_CHARS_POR_LLAMADA, PARSE_LOTE_WORKERS, PARSE_REUSE_EXTRACCION, PARSE_SKIP_TEXTO_CACHE,
    PARSE_UNIT_WORKERS, TEXTO_LITERAL_MAX, CITA_MAX, _BLOQUES_VALIDOS, _IMG_EXTS,
    _norm_txt, _LOOKALIKES, _sha256_hex, _perfil_params, _norm_razon,
)
from .clasificacion import (  # noqa: F401
    _TIPOS_ADJUDICACION, _es_doc_de_adjudicacion, _TIPOS_REQUERIMIENTO_KW, _TIPOS_CONTRATACION_KW,
    _CATS_REQUERIMIENTO, _CATS_CONTRATACION, _es_doc_contratacion, _es_doc_resultado, _origen_precio,
)
from .entidades import (  # noqa: F401
    _RUC_PESOS, _solo_digitos, ruc_valido, _corregir_ruc, _rucs_ocds, _ganadores_ocds, _mismo_nombre,
    _CAMPOS_OFERTA, _pagina_principal, _fusionar_postor, _ofertas_desde_postores, _mismo_firmante,
)
from .item_matching import _desc_compacta, _buscar_item_similar, _item_key  # noqa: F401
from .pdf_utils import _analyze_pdf_layout, _render_pdf_pages_to_png, _split_pdf_by_pages  # noqa: F401
from .schema import (  # noqa: F401
    _schema_evidencia, _schema_bloque, _SECCIONES_OPCIONALES, PARSER_SCHEMA_MAX_CHARS,
    secciones_para_documento, _parser_schema, _ULTIMOS_DESCARTES, _schema_solo,
)
from .contenedores import (  # noqa: F401
    _unidad, _paginar_texto, _W_NS, _R_NS, _docx_rels_media, _docx_media_en_orden, _docx_bloques,
    _docx_a_unidades, _xlsx_a_unidades, _xls_a_unidades, _doc_a_unidades, _leer_rar,
    _expandir_contenedor, _es_xlsx_blob, _is_docx_blob, _docx_to_synthetic_pdf, _images_to_synthetic_pdf,
)
from .ocr_texto import (  # noqa: F401
    _paginas_pymupdf, _ocr_paginas_gemini, _texto_de_unidades, _UNIT_CACHE, _UNIT_CACHE_LOCK,
    _UNIT_CACHE_MAX, _unit_cache_get, _unit_cache_put, _n_paginas_pdf, _TX_MEM, _TX_MEM_LOCK,
    _TX_MEM_MAX, _tx_mem_get, _tx_mem_put, _texto_cache_get, _texto_cache_put, _extraccion_cache_put,
)
from .extractor import (  # noqa: F401
    _SYSTEM_LOTE, _prompt_lote, _finish_reason, _llamar_extractor, _merge_extraccion, _texto_rango,
    _extraer_rango, _extraer_documento,
)
from .evidencia import (  # noqa: F401
    _cita_en_pagina, _FOLIO_RX, _detectar_folio, _tokens_cita, _cita_tokens_en_pagina,
    _verificar_evidencia, _KW_MARCA, _marca_respaldada, _post_procesar,
)
from .fetch import _fetch_doc_bytes, _download_from_gcs  # noqa: F401
from .orquestacion import (  # noqa: F401
    _bytes_de_doc, _INFLIGHT_LOCK, _INFLIGHT, _sha_por_url_get, _sha_por_url_put, _esperar_sha,
    _liberar_sha, _procesar_doc, _procesar_doc_texto,
)
from .lote import (  # noqa: F401
    _ocds_ctx, parse_documentos_lote, _STOP_DESC, _raiz, _tokens_raiz, _cruzar_items_contratados,
    _mas_completo_lote, parse_documentos_seleccionados, parse_documentos_seleccionados_tool,
)
from .legacy_extract import _paginas_a_pdf_sintetico, _parse_single_pdf_with_gemini  # noqa: F401
from .legacy_tool import parse_document_pdf  # noqa: F401
from .sanitize import _CAMPOS_SOLO_REQUERIMIENTO, sanitize_items_with_llm  # noqa: F401


def list_documents(ocid: str, tool_context: ToolContext) -> dict:
    """Lista los documentos publicados en SEACE para esta convocatoria.

    Args:
        ocid: OCID de la convocatoria.

    Returns:
        Diccionario con documents (lista con id, title, documentType, url,
        format, has_b64).
    """
    cr = tool_context.state.get("ocds") or {}
    docs_b64 = tool_context.state.get("docs_b64") or {}
    # Recolectar documentos de TODAS las etapas, no solo `tender`. El contrato
    # firmado (Orden de Compra) vive en `contracts.documents` y antes quedaba
    # invisible → nunca se parseaba (contrato_final salía null). Mapeo de etapa
    # para que el agente priorice (Bases/Resumen→Convocatoria, Acta→Adjudicación,
    # Contrato/garantía→Contrato).
    docs: list[dict] = []
    for stage in ("tender", "awards", "contracts"):
        node = cr.get(stage)
        arr = node if isinstance(node, list) else ([node] if node else [])
        for nd in arr:
            if isinstance(nd, dict):
                for d in (nd.get("documents") or []):
                    if isinstance(d, dict):
                        docs.append({**d, "_stage": stage})
    return {
        "n_documents": len(docs),
        "documents": [
            {
                "id": d.get("id"), "title": d.get("title"),
                "documentType": d.get("documentType"), "url": d.get("url"),
                "format": d.get("format"), "stage": d.get("_stage"),
                "has_b64_preloaded": d.get("url") in docs_b64,
            }
            for d in docs
        ],
        "_note": "La selección y el parseo en lote los hace parse_documentos_seleccionados (determinista).",
    }


# ── FunctionTool wrappers ──
list_documents_tool = FunctionTool(func=list_documents)
parse_document_pdf_tool = FunctionTool(func=parse_document_pdf)
sanitize_items_with_llm_tool = FunctionTool(func=sanitize_items_with_llm)
