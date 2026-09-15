import threading

import pytest

from backend.batch.estado import MAX_INTENTOS, Estado


@pytest.fixture
def db(tmp_path):
    e = Estado(tmp_path / "estado.sqlite")
    yield e
    e.close()


def test_ciclo_basico_reclamar_marcar(db):
    lote = db.nuevo_lote("records", "2026-09-08", "2026-09-15")
    assert lote.startswith("records-")
    assert db.agregar_items(lote, ["a", "b", "c"]) == 3
    assert db.agregar_items(lote, ["a"]) == 0                    # idempotente

    tomados = db.reclamar(lote, 2)
    assert tomados == ["a", "b"]
    assert db.reclamar(lote, 5) == ["c"]                         # no repite los que están en processing

    db.marcar(lote, "a", "completed", sha256="x" * 64, bytes=10, ruta="records/aa/a.json.gz")
    db.marcar(lote, "b", "failed", error="HTTP 500")
    db.marcar(lote, "c", "completed", bytes=5)

    assert db.item(lote, "b")["intentos"] == 1
    r = db.resumen(lote)
    assert r["completed"] == 2 and r["failed"] == 1 and r["total"] == 3 and r["bytes"] == 15
    assert r["agotados"] == 0
    assert db.pendientes(lote) == ["b"]

    # el failed vuelve a salir hasta agotar los intentos
    assert db.reclamar(lote, 5) == ["b"]
    db.marcar(lote, "b", "failed", error="HTTP 500")
    assert db.reclamar(lote, 5) == ["b"]
    db.marcar(lote, "b", "failed", error="HTTP 500")
    assert db.item(lote, "b")["intentos"] == MAX_INTENTOS
    assert db.reclamar(lote, 5) == []
    assert db.pendientes(lote) == []
    r = db.resumen(lote)
    assert r["agotados"] == 1
    assert db.lote(lote)["estado"] == "completed" and db.lote(lote)["ok"] == 2 and db.lote(lote)["fallidos"] == 1


def test_meta_y_dedup_entre_lotes(db):
    l1 = db.nuevo_lote("documentos")
    db.agregar_items(l1, {"1/doc1": {"url": "https://x/1", "documentType": "biddingDocuments"}})
    db.reclamar(l1, 1)
    db.marcar(l1, "1/doc1", "completed", sha256="abc", bytes=3, ruta="documentos/01/1/abc.pdf")
    assert db.item(l1, "1/doc1")["meta"]["url"] == "https://x/1"
    assert db.sha_presente("abc")["ruta"] == "documentos/01/1/abc.pdf"
    assert db.sha_presente("zzz") is None
    assert db.completado_por_meta("documentos", "url", "https://x/1")["clave"] == "1/doc1"
    assert db.completado_por_meta("documentos", "url", "https://x/2") is None
    assert db.claves_completadas("documentos") == {"1/doc1"}
    assert db.claves_completadas("records") == set()


def test_reponer_procesando_y_subido(db):
    lote = db.nuevo_lote("releases", "2026-01-01", "2026-01-07")
    db.agregar_items(lote, ["v1", "v2"])
    db.reclamar(lote, 2)
    assert db.reponer_procesando(lote) == 2
    assert db.reclamar(lote, 2) == ["v1", "v2"]
    db.marcar(lote, "v1", "completed", subido_at="2026-09-15T00:00:00")
    assert db.resumen(lote)["subidos"] == 1


def test_dos_conexiones_no_reclaman_lo_mismo(tmp_path):
    path = tmp_path / "estado.sqlite"
    a = Estado(path)
    lote = a.nuevo_lote("records")
    a.agregar_items(lote, [f"{i:04d}" for i in range(200)])

    vistos: list[list[str]] = []
    lock = threading.Lock()

    def worker():
        e = Estado(path)
        try:
            while True:
                got = e.reclamar(lote, 7)
                if not got:
                    break
                with lock:
                    vistos.append(got)
        finally:
            e.close()

    hilos = [threading.Thread(target=worker) for _ in range(4)]
    for h in hilos:
        h.start()
    for h in hilos:
        h.join()
    todos = [c for g in vistos for c in g]
    assert len(todos) == 200 and len(set(todos)) == 200
    a.close()


def test_lote_id_unico_en_el_mismo_segundo(db):
    a = db.nuevo_lote("records")
    b = db.nuevo_lote("records")
    assert a != b and db.lote(a) and db.lote(b)


def test_tipo_invalido(db):
    with pytest.raises(ValueError):
        db.nuevo_lote("otro")


def test_una_conexion_compartida_entre_hilos(tmp_path):
    """descargar.py comparte UNA instancia entre los hilos del pool: las transacciones no se pisan."""
    e = Estado(tmp_path / "estado.sqlite")
    lote = e.nuevo_lote("documentos")
    e.agregar_items(lote, [f"d{i:03d}" for i in range(120)])

    def worker():
        while True:
            got = e.reclamar(lote, 3)
            if not got:
                return
            for c in got:
                e.marcar(lote, c, "completed", bytes=1)

    hilos = [threading.Thread(target=worker) for _ in range(6)]
    for h in hilos:
        h.start()
    for h in hilos:
        h.join()
    r = e.resumen(lote)
    assert r["completed"] == 120 and r["bytes"] == 120 and e.lote(lote)["estado"] == "completed"
    e.close()
