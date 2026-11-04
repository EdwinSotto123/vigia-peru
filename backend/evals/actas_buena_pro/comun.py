"""Lo que comparten el armador, el ejecutor y el calificador del set de actas de buena pro.

El extractor y las llamadas viven en backend/lector (base.py, buena_pro.py): el set prueba exactamente lo que corre en
producción.

"""
from __future__ import annotations

import base64
import os
import re
import subprocess
import unicodedata
from functools import lru_cache
from pathlib import Path

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from lector.base import *  # noqa: E402,F401,F403
from lector.base import bloques_pdf
from lector.buena_pro import *  # noqa: E402,F401,F403
from lector.buena_pro import PEDIDO

AQUI = Path(__file__).resolve().parent
DATOS = AQUI / "datos"                      # en .gitignore: nombres de personas
CASOS = DATOS / "casos.jsonl"
PDFS = DATOS / "pdfs"


def mensajes(pdfs: list[Path]) -> list[dict]:
    return bloques_pdf([(p.name, p.read_bytes()) for p in pdfs], PEDIDO)
