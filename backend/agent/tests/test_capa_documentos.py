"""Tests OFFLINE de la auditoría de la capa de documentos (2026-11-13), sin red, modelo ni BD:

  · postores con RUC válidos distintos no se funden por nombre parecido;
  · personas con DNI distinto (o tres palabras en común sin ser subconjunto) no son el mismo firmante;
  · el precio contratado se cruza por número de ítem y con los números cortos de la descripción;
  · la misma cotización citada en dos documentos cuenta una vez y toda cotización del ganador es del ganador;
  · las reglas leen el texto de los documentos por sha256 (el lote sólo deja metadatos en el estado);
  · una bandera del analista legal no se respalda en `legal_analysis` (de donde sale);
  · documentos_gcs: vale la última fila de cada URL; la URL se casa con su `fileCode`;
  · OCR fallido y 2.ª pasada fallida no se cachean; la sección del documento pide los bloques del contrato;
  · un RUC 10 no sale de las lecturas; los números que llegan como cadena se convierten.
"""
from __future__ import annotations

import os
import sys

import pytest

_AGENT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _AGENT not in sys.path:
    sys.path.insert(0, _AGENT)

os.environ.pop("DOCAI_PROCESSOR_ID", None)

import tools.documentos as D  # noqa: E402
import tools.market as mk  # noqa: E402
from tools import doc_select, lecturas, verify  # noqa: E402
from tools.compliance_rules import _base as reglas_base, _rules_lote1  # noqa: E402
from tools.market.cotizaciones import _mercado_cotizaciones  # noqa: E402

SHA = "b" * 64


def _ruc(base10: str) -> str:
    """RUC con su dígito verificador."""
    s = sum(int(d) * w for d, w in zip(base10, (5, 4, 3, 2, 7, 6, 5, 4, 3, 2)))
    c = 11 - (s % 11)
    return base10 + str({10: 0, 11: 1}.get(c, c))


RUC_A, RUC_B = _ruc("2060123456"), _ruc("2060987654")


# ─── 5 · postores ────────────────────────────────────────────────────────────

def test_dos_ruc_validos_distintos_son_dos_postores():
    lista: list[dict] = []
    D._fusionar_postor(lista, {"ruc": RUC_A, "razon_social": "CONSORCIO SAN JUAN I", "monto_oferta": 100000.0}, True, "a", {})
    D._fusionar_postor(lista, {"ruc": RUC_B, "razon_social": "CONSORCIO SAN JUAN II", "monto_oferta": 99000.0}, True, "a", {})
    assert [p["ruc"] for p in lista] == [RUC_A, RUC_B]
    assert len(D._ofertas_desde_postores(lista)) == 2


def test_postor_sin_ruc_se_sigue_fundiendo_por_nombre():
    lista: list[dict] = []
    D._fusionar_postor(lista, {"ruc": None, "razon_social": "CARPIO COBOS ABEL"}, False, "a", {})
    D._fusionar_postor(lista, {"ruc": RUC_A, "razon_social": "ABEL CARPIO COBOS", "monto_oferta": 5000.0}, True, "b", {})
    assert len(lista) == 1 and lista[0]["ruc"] == RUC_A and lista[0]["monto_oferta"] == 5000.0


# ─── 7 · firmantes ───────────────────────────────────────────────────────────

def test_hermanos_no_son_el_mismo_firmante():
    a, b = {"nombre_completo": "LUIS ALBERTO QUISPE MAMANI"}, {"nombre_completo": "JOSE ALBERTO QUISPE MAMANI"}
    assert not D._mismo_firmante(a, b)


def test_dni_distinto_nunca_es_la_misma_persona():
    a = {"nombre_completo": "JUAN QUISPE MAMANI", "dni": "41234567"}
    b = {"nombre_completo": "Juan Quispe Mamani", "dni": "47654321"}
    assert not D._mismo_firmante(a, b)
    assert D._mismo_firmante(a, {**b, "dni": "41234567"}) and D._mismo_firmante(a, {**b, "dni": None})


def test_nombre_abreviado_sigue_siendo_la_misma_persona():
    assert D._mismo_firmante({"nombre_completo": "YHONY E. QUISPE CANAZA"}, {"nombre_completo": "Yhony Edwin Quispe Canaza"})


# ─── 6 · cruce de ítems contratados ──────────────────────────────────────────

def test_cruce_por_numero_y_medidas_aunque_la_orden_venga_en_otro_orden():
    cons = [{"numero": "1", "descripcion_corta": "LLANTA 11 R 22", "cantidad": 10},
            {"numero": "2", "descripcion_corta": "LLANTA 12 R 20", "cantidad": 10}]
    contr = [{"numero": "02", "descripcion": "LLANTA 12 R 20", "cantidad": 10, "precio_unitario_contratado": 900.0, "origen": "contrato"},
             {"numero": "01", "descripcion": "LLANTA 11 R 22", "cantidad": 10, "precio_unitario_contratado": 1500.0, "origen": "contrato"}]
    D._cruzar_items_contratados(cons, contr)
    assert [c["precio_unitario_ofertado"] for c in cons] == [1500.0, 900.0]


def test_cruce_sin_numero_no_mezcla_medidas_distintas():
    cons = [{"descripcion_corta": "LLANTA 11 R 22", "cantidad": 10}, {"descripcion_corta": "LLANTA 12 R 20", "cantidad": 10}]
    contr = [{"descripcion": "LLANTA 12 R 20", "cantidad": 10, "precio_unitario_contratado": 900.0, "origen": "contrato"}]
    D._cruzar_items_contratados(cons, contr)
    assert cons[0].get("precio_unitario_ofertado") is None and cons[1]["precio_unitario_ofertado"] == 900.0


def test_cruce_empatado_con_precios_distintos_no_se_adivina():
    cons = [{"descripcion_corta": "ARROZ SUPERIOR", "cantidad": 5}, {"descripcion_corta": "AZUCAR RUBIA", "cantidad": 5}]
    contr = [{"descripcion": "ARROZ SUPERIOR SACO", "cantidad": 5, "precio_unitario_contratado": 100.0, "origen": "contrato"},
             {"descripcion": "ARROZ SUPERIOR BOLSA", "cantidad": 5, "precio_unitario_contratado": 120.0, "origen": "contrato"}]
    D._cruzar_items_contratados(cons, contr)
    assert cons[0].get("precio_unitario_ofertado") is None


# ─── 8 · cotizaciones ────────────────────────────────────────────────────────

GANADOR = "20123456789"


def _directa(cotizaciones, adjudicado):
    return {"ocds": {"ocid": "ocds-dgv273-seacev3-1230001",
                     "tender": {"description": "SERVICIO DE VIGILANCIA", "procurementMethodDetails": "Contratación Directa"},
                     "awards": [{"id": "a1", "value": {"amount": adjudicado},
                                 "suppliers": [{"id": f"PE-RUC-{GANADOR}", "name": "SERVICIOS ANDINOS SAC"}]}]},
            "parser_raw_consolidated": {"sustento_directa": {"cotizaciones": cotizaciones}}}


@pytest.fixture
def _sin_comparables(monkeypatch):
    monkeypatch.setattr(mk.cotizaciones, "_comparables_convocatorias", lambda *a, **k: [])


def test_la_cotizacion_del_ganador_citada_en_tres_documentos_no_es_de_terceros(_sin_comparables):
    cots = [{"proveedor": "SERVICIOS ANDINOS S.A.C.", "ruc": GANADOR, "monto": 100000, "pagina": p, "documento_sha256": s}
            for p, s in ((3, "a" * 64), (7, "b" * 64), (2, "c" * 64))]
    r = _mercado_cotizaciones(_directa(cots, 100000.0))
    f = r["findings"][0]
    assert f["n_precios"] == 1 and f["n_cotizaciones_terceros"] == 0 and f["precio_mediana_mercado"] is None
    assert r["veredicto_global"] == "sin_dato" and len(r["cotizaciones"]) == 1


def test_cotizacion_de_tercero_repetida_cuenta_una_vez(_sin_comparables):
    cots = [{"proveedor": "SERVICIOS ANDINOS S.A.C.", "ruc": GANADOR, "monto": 100000},
            {"proveedor": "TRANSPORTES BELLAVISTA S.A.C.", "ruc": "20555555551", "monto": 130000, "documento_sha256": "a" * 64},
            {"proveedor": "Transportes Bellavista SAC", "ruc": None, "monto": 130000, "documento_sha256": "b" * 64},
            {"proveedor": "TRANSPORTES BELLAVISTA S.A.C.", "ruc": "20555555551", "monto": 135000}]
    f = _mercado_cotizaciones(_directa(cots, 100000.0))["findings"][0]
    assert f["n_precios"] == 3 and f["n_cotizaciones_terceros"] == 2   # 130 000 una vez; 135 000 es otra cotización


def test_dos_cotizaciones_del_ganador_son_las_dos_del_ganador(_sin_comparables):
    cots = [{"proveedor": "SERVICIOS ANDINOS S.A.C.", "ruc": GANADOR, "monto": 100000},
            {"proveedor": "SERVICIOS ANDINOS S.A.C.", "ruc": GANADOR, "monto": 110000},
            {"proveedor": "C S.A.C.", "ruc": "20666666662", "monto": 150000}]
    r = _mercado_cotizaciones(_directa(cots, 100000.0))
    f = r["findings"][0]
    assert f["n_cotizaciones_terceros"] == 1 and [o["es_ganador"] for o in f["precios_observados"]] == [True, True, False]


# ─── 9 · texto de los documentos por sha256 ──────────────────────────────────

def test_las_reglas_leen_el_texto_por_sha_y_no_del_estado(monkeypatch):
    textos = {SHA: "⟦p.4⟧ La oferta no incluye IGV (Ley 27037). El valor referencial no se dará a conocer."}
    monkeypatch.setattr(verify, "_texto_documento", lambda sha: textos.get(sha))
    st = {"documentos_texto": {SHA: {"n_paginas": 9, "chars": 90, "truncado": False}}}   # como lo deja el lote: sin `texto`
    assert reglas_base.exonerado_igv(st) is True
    assert _rules_lote1._cuantia_reservada(dict(st)) is True
    monkeypatch.setattr(verify, "_texto_documento", lambda sha: None)
    assert reglas_base.exonerado_igv({"documentos_texto": {"c" * 64: {"n_paginas": 1}}}) is False


# ─── 10 · banderas del analista legal ────────────────────────────────────────

@pytest.fixture
def _verify_sin_bd(monkeypatch):
    monkeypatch.setattr(verify, "_en_bd", lambda kind, valor: False)
    monkeypatch.setattr(verify, "_texto_documento", lambda sha: None)
    verify._bd_cache.clear()
    verify._texto_cache.clear()


def test_bandera_legal_no_se_respalda_en_su_propio_texto(_verify_sin_bd):
    falso = "20999999991"
    descr = f"Las bases favorecen a EMPRESA X (RUC {falso})."
    st = {"ocds": {"tender": {"title": "x"}}, "legal_analysis": {"red_flags_documentales": [{"descripcion": descr}]}}
    res = verify.verificar_bandera({"regla": "red_flag_documental", "severidad": "media", "evidencia": descr}, st)
    assert res["ok"] is False and f"ruc:{falso}:no_respaldado" in res["motivos"]
    # El mismo RUC en lo que leyó el parser sí la respalda; y las demás reglas siguen viendo `legal_analysis`.
    st2 = {**st, "parser_raw_consolidated": {"postores": [{"ruc": falso}]}}
    assert verify.verificar_bandera({"regla": "red_flag_documental", "evidencia": descr}, st2)["ok"] is True
    assert verify.verificar_bandera({"regla": "otra_regla", "evidencia": descr}, st)["ok"] is True


# ─── 11 · selección y descarga ───────────────────────────────────────────────

def test_documentos_gcs_vale_la_ultima_version_de_cada_url():
    u = "https://prod2.seace.gob.pe/descarga?fileCode=AAA"
    filas = [{"gcs_id": 1, "titulo": "Bases", "tipo": "biddingDocuments", "seccion": "tender", "url_gcs": "gs://b/v1.pdf",
              "sha256": "1" * 64, "url_origen": u, "formato": "pdf"},
             {"gcs_id": 2, "titulo": "Bases", "tipo": "biddingDocuments", "seccion": "tender", "url_gcs": "gs://b/v2.pdf",
              "sha256": "2" * 64, "url_origen": u, "formato": "pdf"}]
    for orden in (filas, filas[::-1]):
        elegidos, omitidos = doc_select.seleccionar_documentos("1230001", {}, {}, gcs_rows=[dict(f) for f in orden])
        assert [(d["gs"], d["sha256"]) for d in elegidos] == [("gs://b/v2.pdf", "2" * 64)]
        assert [(o["id"], o["motivo"]) for o in omitidos] == [("gcs:1", "version_anterior")]


def test_la_descarga_no_casa_otro_documento_de_la_misma_ruta(monkeypatch):
    pedidos = []
    monkeypatch.setattr(D.fetch, "_download_from_gcs", lambda gs: (pedidos.append(gs) or (b"%PDF" + b"x" * 200, None)))

    class _Ctx:
        state = {"doc_urls": {"https://prod2.seace.gob.pe/descarga?fileCode=AAA": "gs://b/bases.pdf",
                              "https://prod2.seace.gob.pe/descarga?fileCode=BBB": "gs://b/contrato.pdf"}}
    blob, fuente, _ = D._fetch_doc_bytes("https://PROD2.seace.gob.pe/descarga/?fileCode=BBB", _Ctx())
    assert fuente == "gcs" and pedidos == ["gs://b/contrato.pdf"] and blob


@pytest.mark.parametrize("url, permitido", [
    ("gs://vigia-peru-batch/docs/ocds-dgv273-seacev3-1230001/bases (1) 100%.pdf", True),
    ("gs://vigia-peru-documentos/convocatorias/1230001/BASES.pdf", True),
    ("https://storage.googleapis.com/vigia-peru-documentos/convocatorias/1230001/BASES%20INTEGRADAS.pdf", True),
    ("gs://vigia-peru-privado/comprobantes/1.jpg", False),
    ("gs://vigia-peru-reportes/x.pdf", False),
    ("gs://vigia-peru-batch", False),
    ("https://storage.googleapis.com/vigia-peru-privado/comprobantes/1.jpg", False),
    ("https://storage.googleapis.com/vigia-peru-documentos/../vigia-peru-privado/1.jpg", False),
    ("https://storage.googleapis.com/vigia-peru-documentos/%2e%2e/vigia-peru-privado/1.jpg", False),
    ("https://storage.googleapis.com/vigia-peru-documentos/%252e%252e/vigia-peru-privado/1.jpg", False),
    ("https://storage.googleapis.com.ejemplo.pe/vigia-peru-documentos/x.pdf", False),
    ("http://storage.googleapis.com/vigia-peru-documentos/x.pdf", False),
    ("https://169.254.169.254/latest/meta-data/", False),
    ("file:///etc/passwd", False),
])
def test_el_agente_solo_lee_de_los_almacenes_de_documentos(url, permitido):
    """Una dirección de `doc_urls` no puede pedir el almacén privado (comprobantes) ni una máquina ajena."""
    assert D.fetch._almacen_permitido(url) is permitido


def test_la_descarga_rechaza_un_almacen_ajeno_sin_salir_a_la_red(monkeypatch):
    def _no(*a, **k):
        raise AssertionError("no debió salir a la red")
    monkeypatch.setattr(D.fetch.requests, "get", _no)
    monkeypatch.setenv("ALMACEN_DOCS", "r2")
    for url in ("gs://vigia-peru-privado/comprobantes/1.jpg", "https://storage.googleapis.com/vigia-peru-privado/1.jpg",
                "https://ejemplo.pe/x.pdf"):
        assert D.fetch._download_from_gcs(url) == (None, "almacén no permitido")
    assert D.fetch._descargar_de_r2("gs://vigia-peru-privado/comprobantes/1.jpg") == (None, "almacén no permitido")


# ─── 1 · OCR fallido no se cachea ────────────────────────────────────────────

def test_ocr_fallido_marca_el_texto_y_no_se_lee_de_la_cache():
    ok = [{"donde": "contenedor:x", "limite": "duplicado_sha256", "omitido": "y"}]
    assert not D.ocr_texto._ocr_fallido(ok) and not D.ocr_texto._ocr_fallido(None)
    assert D.ocr_texto._ocr_fallido(ok + [{"donde": "ocr_gemini_vision", "limite": "fallo", "omitido": "p. 1"}])
    assert D.ocr_texto._ocr_fallido([{"donde": "ocr_docai", "limite": "chunk_fallido", "omitido": "p. 31-60"}])


def _pdf_escaneado() -> bytes:
    fitz = pytest.importorskip("fitz")
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 200, 280))
    pix.clear_with(200)
    page.insert_image(page.rect, pixmap=pix)
    datos = doc.tobytes()
    doc.close()
    return datos


def test_pdf_escaneado_con_vision_caida_no_guarda_texto_vacio(monkeypatch):
    pdf = _pdf_escaneado()
    guardados = []
    monkeypatch.setattr(D.ocr_texto, "_ocr_paginas_gemini", lambda lote: (_ for _ in ()).throw(ValueError("no lee imágenes")))
    monkeypatch.setattr(D.ocr_texto, "_UNIT_CACHE", type(D.ocr_texto._UNIT_CACHE)())
    monkeypatch.setattr(D.orquestacion, "_texto_cache_get", lambda sha: None)
    monkeypatch.setattr(D.orquestacion, "_texto_cache_put", lambda *a, **k: guardados.append(a[0]))
    monkeypatch.setattr(D.orquestacion, "_extraccion_cache_put", lambda *a, **k: True)
    monkeypatch.setattr(D.orquestacion, "_sha_por_url_get", lambda *a: None)
    monkeypatch.setattr(D.orquestacion, "_sha_por_url_put", lambda *a: None)
    monkeypatch.setattr(D.orquestacion, "_bytes_de_doc", lambda doc, state: (pdf, "gcs", None))
    monkeypatch.setattr(D.orquestacion, "_extraer_documento", lambda tx, label, bloque, ctx, hint: {"items": [], "_usos": [], "_recortes": []})
    doc = {"id": "d1", "titulo": "Contrato", "formato": "pdf", "seccion": "contract", "sha256": None, "url": None, "gs": "gs://b/c.pdf"}
    out = D._procesar_doc(doc, {"ocid": "1230001"}, None, (), {})
    assert out["tx"]["truncado"] is True and any(r["donde"] == "ocr_gemini_vision" for r in out["recortes"])
    assert guardados == []
    # Con la lectura de vuelta, el mismo documento sí se guarda.
    monkeypatch.setattr(D.ocr_texto, "_ocr_paginas_gemini", lambda lote: ["CONTRATO N° 12 por S/ 50 000" for _ in lote])
    out2 = D._procesar_doc(dict(doc), {"ocid": "1230001"}, None, (), {})
    assert out2["tx"]["truncado"] is False and len(guardados) == 1


# ─── 2 · 2.ª pasada fallida ──────────────────────────────────────────────────

def test_segunda_pasada_fallida_deja_recorte_y_no_cachea(monkeypatch):
    def _llm(texto, label, bloque, ocds_ctx, rango, tipo_hint):
        return ({"items": [], "_bloques_pendientes": ["contrato_final"], "_error_segunda_pasada": "RuntimeError: 429"}, False,
                {"modelo": "m", "segundos": 0, "finish_reason": "STOP", "tokens_prompt": 0, "tokens_output": 0, "tokens_thoughts": 0})
    monkeypatch.setattr(D.extractor, "_llamar_extractor", _llm)
    tx = {"paginas": [{"n": 1, "texto": "CONTRATO", "chars": 8}], "chars": 8, "n_paginas": 1, "motor": "pymupdf",
          "truncado": False, "recortes": [], "extraccion": {}}
    ext = D._extraer_documento(tx, "Contrato [pdf]", "servicio", {}, None)
    assert [r["limite"] for r in ext["_recortes"]] == ["segunda_pasada_fallida"]

    cacheadas = []
    monkeypatch.setattr(D.orquestacion, "_texto_cache_get", lambda sha: dict(tx))
    monkeypatch.setattr(D.orquestacion, "_extraccion_cache_put", lambda sha, clave, e: cacheadas.append(clave))
    monkeypatch.setattr(D.orquestacion, "_sha_por_url_put", lambda *a: None)
    doc = {"id": "d1", "titulo": "Contrato", "formato": "pdf", "seccion": "contract", "sha256": SHA, "url": None, "gs": None}
    out = D._procesar_doc(doc, {"ocid": "1230001"}, "servicio", (), {})
    assert cacheadas == [] and any(r["limite"] == "segunda_pasada_fallida" for r in out["recortes"])
    monkeypatch.setattr(D.extractor, "_llamar_extractor", lambda *a: ({"items": []}, False, _llm(*a)[2]))
    D._procesar_doc(dict(doc), {"ocid": "1230001"}, "servicio", (), {})
    assert len(cacheadas) == 1


# ─── 4 · bloques del contrato por sección ────────────────────────────────────

def test_seccion_y_paquetes_piden_los_bloques_del_contrato():
    S = D.secciones_para_documento
    assert "contrato_final" in S("OC 123 [pdf]", None, "contract")
    assert "contrato_final" in S("Documentos de Otorgamiento de Buena Pro [zip]", "awardNotice", "award")
    assert "contrato_final" in S("Documentos de Otorgamiento de Buena Pro [zip]", "awardNotice")
    assert S("Bases Administrativas [pdf]", "biddingDocuments", "tender") == set()


def test_la_seccion_del_documento_llega_al_extractor(monkeypatch):
    vistos = []

    def _extraer(tx, label, bloque, ctx, hint):
        vistos.append(ctx.get("_seccion"))
        return {"items": [], "_usos": [], "_recortes": []}
    tx = {"paginas": [{"n": 1, "texto": "x", "chars": 1}], "chars": 1, "n_paginas": 1, "motor": "pymupdf", "truncado": False,
          "recortes": [], "extraccion": {}}
    monkeypatch.setattr(D.orquestacion, "_extraer_documento", _extraer)
    monkeypatch.setattr(D.orquestacion, "_texto_cache_get", lambda sha: dict(tx))
    monkeypatch.setattr(D.orquestacion, "_extraccion_cache_put", lambda *a: True)
    monkeypatch.setattr(D.orquestacion, "_sha_por_url_put", lambda *a: None)
    ctx = {"objeto": "x"}
    D._procesar_doc({"id": "d", "titulo": "OC 123", "seccion": "contract", "sha256": SHA}, {"ocid": "1"}, None, (), ctx)
    assert vistos == ["contract"] and "_seccion" not in ctx


# ─── 12b · RUC 10 en las lecturas ────────────────────────────────────────────

class _Cur:
    def __init__(self, filas):
        self.filas = filas

    def execute(self, sql, params=()):
        pass

    def fetchall(self):
        return self.filas


class _Conn:
    def __init__(self, filas):
        self.filas = filas

    def cursor(self):
        return _Cur(self.filas)



# ─── 12c · números que llegan como cadena ────────────────────────────────────

@pytest.mark.parametrize("valor, dinero, esperado", [
    ("125,000.00", True, 125000.0), ("S/ 1 234,56", True, 1234.56), ("1.234", True, 1234.0), ("1.234.567", True, 1234567.0),
    ("1.234,5", True, 1234.5), ("12.50", True, 12.5), ("0.500", True, 0.5), ("1,234", True, 1234.0),
    ("1.234", False, 1.234), ("12,5", False, 12.5), ("1,234", False, "1,234"), ("1,234.56", False, 1234.56),
    ("sin dato", True, "sin dato"), (1500, True, 1500), (None, True, None),
])
def test_numero_desde_cadena(valor, dinero, esperado):
    assert D.extractor._a_numero(valor, dinero) == esperado


def test_la_extraccion_convierte_solo_los_campos_numericos():
    data = {"cuantia_total": "1.234", "resumen": "1.234",
            "items": [{"descripcion_corta": "CABLE 2.5 MM", "cantidad": "1.234", "precio_unitario_referencial": "3,50"}],
            "postores": [{"razon_social": "X", "monto_oferta": "125,000.00", "ruc": "20600000001"}],
            "sustento_directa": {"cotizaciones": [{"proveedor": "Y", "monto": "S/ 98.500"}]}}
    D.extractor._coaccionar_numeros(data)
    assert data["cuantia_total"] == 1234.0 and data["resumen"] == "1.234"
    assert data["items"][0]["cantidad"] == 1.234 and data["items"][0]["precio_unitario_referencial"] == 3.5
    assert data["postores"][0]["monto_oferta"] == 125000.0 and data["postores"][0]["ruc"] == "20600000001"
    assert data["sustento_directa"]["cotizaciones"][0]["monto"] == 98500.0
    assert len(D._ofertas_desde_postores(data["postores"])) == 1
