"""El JSON que contestan los modelos de Workers AI (lector/motor_workers.py, primer_json)."""
import json

import pytest

from lector.motor_workers import primer_json


def test_ignora_la_cerca_de_markdown_al_final():
    assert primer_json('{"comite": [], "confianza": "alta"}\n```') == {"comite": [], "confianza": "alta"}


def test_ignora_la_cerca_al_principio_y_al_final():
    assert primer_json('```json\n{"a": 1}\n```') == {"a": 1}


def test_un_objeto_cortado_sigue_siendo_invalido():
    with pytest.raises(json.JSONDecodeError):
        primer_json('{"comite": [{"nombre_completo": "X Y')
