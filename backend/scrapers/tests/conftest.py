"""Permite `cd backend/scrapers && python -m pytest -q` además de `PYTHONPATH=. pytest backend/scrapers/tests`
desde la raíz: los tests importan `backend.scrapers.*`, así que la raíz del repo va al sys.path."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
