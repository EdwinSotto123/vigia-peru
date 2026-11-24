"""Documentos casi idénticos dentro de un contrato se extraen una sola vez (tools/documentos/orquestacion.py
`_duplicado_de`): en 1226674 «Otorgamiento» y «Calificación» eran la misma acta, un tercio del expediente (2026-11-24)."""
from __future__ import annotations

import os
import sys

_AGENT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _AGENT not in sys.path:
    sys.path.insert(0, _AGENT)

from tools.documentos import orquestacion as O  # noqa: E402


def _tx(textos):
    return {"paginas": [{"n": i + 1, "texto": t} for i, t in enumerate(textos)]}


ACTA = [f"ACTA DE OTORGAMIENTO página {i} " + "x" * 300 for i in range(10)]


def test_la_misma_acta_en_dos_documentos_se_extrae_una_vez():
    O._HUELLAS.clear()
    assert O._duplicado_de("999", "a" * 64, _tx(ACTA), "Documentos de Otorgamiento de Buena Pro") is None
    # Otra copia, con una página distinta (91 %): duplicado del primero.
    copia = ACTA[:9] + ["CUADRO distinto " + "y" * 300] + ACTA[9:]
    assert O._duplicado_de("999", "b" * 64, _tx(copia), "Documentos de Calificación y Evaluación") == "Documentos de Otorgamiento de Buena Pro"


def test_documentos_distintos_o_de_otro_contrato_no_son_duplicados():
    O._HUELLAS.clear()
    assert O._duplicado_de("999", "a" * 64, _tx(ACTA), "Acta") is None
    assert O._duplicado_de("999", "c" * 64, _tx([f"BASES página {i} " + "z" * 300 for i in range(10)]), "Bases") is None
    assert O._duplicado_de("888", "d" * 64, _tx(ACTA), "Acta en otro contrato") is None
    # El mismo sha (el mismo archivo releído) no es un duplicado de sí mismo.
    assert O._duplicado_de("999", "a" * 64, _tx(ACTA), "Acta") is None
    # Con menos de 3 páginas con texto no se decide.
    assert O._duplicado_de("999", "e" * 64, _tx(ACTA[:2]), "Hoja suelta") is None
