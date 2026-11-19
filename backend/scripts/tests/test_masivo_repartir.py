"""El reparto de hilos del masivo: sólo a las colas con trabajo, sin pasar el total (≤ 9 análisis a la vez en Workers AI)."""
import importlib.util
from pathlib import Path

_spec = importlib.util.spec_from_file_location("masivo_agentes", Path(__file__).resolve().parents[1] / "masivo_agentes.py")
masivo = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(masivo)

PLAN = {"bienes": 2, "servicios,consultoria": 2, "obras": 5}


def test_una_red_sin_pendientes_no_se_queda_con_sus_hilos():
    # Así corría el 2026-11-19: obras en 0 y el plan de 9 lanzaba 4.
    r = masivo.repartir(PLAN, {"bienes": 1257, "servicios,consultoria": 1790, "obras": 0}, 9)
    assert r["obras"] == 0 and sum(r.values()) == 9


def test_con_reanalisis_el_total_baja_a_seis():
    r = masivo.repartir(PLAN, {"bienes": 1257, "servicios,consultoria": 1790, "obras": 300}, masivo.HILOS_CON_REANALISIS)
    assert sum(r.values()) == 6 and all(h >= 1 for h in r.values())


def test_todas_con_trabajo_respeta_el_plan():
    assert masivo.repartir(PLAN, {"bienes": 9, "servicios,consultoria": 9, "obras": 9}, 9) == PLAN


def test_nunca_mas_hilos_que_pendientes():
    r = masivo.repartir(PLAN, {"bienes": 1, "servicios,consultoria": 2, "obras": 0}, 9)
    assert r == {"bienes": 1, "servicios,consultoria": 2, "obras": 0}


def test_sin_trabajo_ninguno():
    assert sum(masivo.repartir(PLAN, {}, 9).values()) == 0


def test_mas_colas_que_hilos():
    r = masivo.repartir(PLAN, {"bienes": 5, "servicios,consultoria": 5, "obras": 5}, 2)
    assert sum(r.values()) == 2
