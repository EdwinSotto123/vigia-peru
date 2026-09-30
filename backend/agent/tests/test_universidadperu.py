"""Ficha de universidadperu.com leída por estructura (tools/universidadperu.py), sin red."""
from __future__ import annotations

from datetime import date

from tools import universidadperu as U

FICHA = """<html><body><h1>RVM MAQUINARIAS S.A.C.</h1>
<a href="/empresas/busqueda/?buscaempresa=20605100016">buscar</a>
<dl><dt>RUC</dt><dd>20605100016</dd>
<dt>Raz�n Social</dt><dd>RVM MAQUINARIAS S.A.C.</dd>
<dt>Tipo Empresa</dt><dd>Sociedad Anonima Cerrada</dd>
<dt>Fecha Inicio Actividades</dt><dd>08 / Agosto / 2019</dd>
<dt>CIIU</dt><dd>50203</dd>
<dt>Estado Domicilio</dt><dd>Habido</dd></dl></body></html>"""

SIN_RESULTADOS = """<html><head><link rel="canonical"
href="https://www.universidadperu.com/empresas/busqueda/?buscaempresa=10437873360"></head>
<body><p>No existe Dicha Empresa</p></body></html>"""


def test_lee_la_ficha_por_campos_aunque_venga_mal_decodificada():
    f = U.leer_ficha(FICHA)
    assert f["ruc"] == "20605100016" and f["ciiu"] == "50203" and f["tipo empresa"] == "Sociedad Anonima Cerrada"
    assert f["razn social"] == "RVM MAQUINARIAS S.A.C."          # "Raz�n" sin el carácter de reemplazo
    assert U.fecha_inicio(f["fecha inicio actividades"]) == date(2019, 8, 8)
    assert U.fecha_inicio("30 / Setiembre / 2023") == date(2023, 9, 30)
    assert U.fecha_inicio("sin fecha") is None


def test_solo_acepta_la_ficha_cuyo_campo_ruc_es_el_pedido():
    paginas = {f"{U.BASE}/busqueda/?buscaempresa=20605100016": FICHA}
    ficha, url, _ = U.ficha_por_ruc("20605100016", "RVM MAQUINARIAS S.A.C.", paginas.get)
    assert ficha and url.endswith("buscaempresa=20605100016")
    # La búsqueda sin resultados repite el RUC en sus enlaces: no es una ficha.
    ficha, _, motivo = U.ficha_por_ruc("10437873360", "CARI MULLISACA WALTER PERCY",
                                       lambda url: SIN_RESULTADOS)
    assert ficha is None and "persona natural" in motivo
    # El slug cayó en otra empresa: se descarta.
    ficha, _, motivo = U.ficha_por_ruc("20100047218", "RVM MAQUINARIAS S.A.C.", lambda url: FICHA)
    assert ficha is None and "otro RUC" in motivo


def test_slug_sin_forma_societaria_ni_articulos():
    assert U.slug("BANCO DE CRÉDITO DEL PERÚ S.A.A.") == "banco-credito-peru"
    assert U.slug("Jurado Nacional de Elecciones") == "jurado-nacional-elecciones"
    assert U.slug("RVM MAQUINARIAS S. A. C.") == "rvm-maquinarias"
    assert U.slug("GRUPO MURILLO E.I.R.LTDA.") == "grupo-murillo"
