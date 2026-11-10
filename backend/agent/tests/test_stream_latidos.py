"""El stream NDJSON escribe un latido cuando la corrida pasa un rato sin eventos (2026-11-10: dos corridas terminaron en
la Lambda y el cliente nunca recibió el `final`)."""
import asyncio
import json

import pytest

main = pytest.importorskip("main")


def test_latido_en_el_silencio_y_final_al_cierre():
    async def fuente():
        yield {"kind": "phase", "name": "legal"}
        await asyncio.sleep(0.35)
        yield {"kind": "final", "state": {}}

    lineas = [json.loads(x) for x in main._ndjson_con_latidos(fuente, latido_s=0.1)]
    tipos = [x["kind"] for x in lineas]
    assert tipos[0] == "phase" and tipos[-1] == "final"
    assert tipos.count("latido") >= 2


def test_error_de_la_fuente_sale_como_evento():
    async def fuente():
        yield {"kind": "phase", "name": "x"}
        raise RuntimeError("se cayó")

    tipos = [json.loads(x)["kind"] for x in main._ndjson_con_latidos(fuente, latido_s=0)]
    assert tipos == ["phase", "error"]
