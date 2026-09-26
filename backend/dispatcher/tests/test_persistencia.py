"""Qué escribe el dispatcher en `procesamientos` por cada evento visible (sin DB: se captura el SQL)."""
from backend.dispatcher import main


def test_evento_usa_el_nombre_canonico():
    ts = "2026-09-15T18:00:00+00:00"
    assert main._evento({"kind": "phase", "name": "legal", "msg": "análisis legal"}, {"fase_actual": "document_legal_analyst"}, ts) == {
        "ts": ts, "kind": "phase", "name": "document_legal_analyst", "msg": "análisis legal"}
    # omitido: la bitácora conserva la fase omitida (cambios no trae fase_actual)
    assert main._evento({"kind": "phase", "name": "person_network", "msg": "omitido: no aplica"}, {"fase_index": 3}, ts)["name"] == "person_network"
    # warn/error de un sub-agente: sin sufijo _agent
    ev = main._evento({"kind": "error", "agent": "entity_personnel_agent", "detail": "boom"}, {"error": "boom"}, ts)
    assert ev["name"] == "entity_personnel" and ev["msg"] == "boom"


def test_actualizar_persiste_fases_enteras(monkeypatch):
    capturado: list[tuple[str, tuple]] = []
    monkeypatch.setattr(main, "_query", lambda sql, params: capturado.append((sql, params)) or [])
    fases = {"market": {"estado": "corriendo", "desde": "t", "hasta": None}}
    main.actualizar("1225030", {"fase_actual": "market", "fase_index": 4, "fases": fases, "fases_completadas": []},
                    {"ts": "t", "kind": "phase", "name": "market", "msg": "x"})
    sql, params = capturado[0]
    assert "fase_actual = %s" in sql and "fase_index = %s" in sql and "fases = %s::jsonb" in sql
    # Anexa el evento con tope: pasado MAX_EVENTOS descarta el más viejo antes de agregar.
    assert "jsonb_array_length(eventos) >= %s THEN eventos - 0" in sql and "|| %s::jsonb" in sql
    assert params[0] == "market" and params[1] == 4
    assert params[2].adapted == fases          # psycopg2 Json
    assert params[3] == main.MAX_EVENTOS and params[4].adapted == [{"ts": "t", "kind": "phase", "name": "market", "msg": "x"}]
    assert params[-1] == "1225030"


def test_plazo_de_reclamo_deja_terminar_el_peor_analisis(monkeypatch):
    # Tarea de 2 h, análisis de hasta 1 h, gracia de 20 min y margen de 5 min: se reclama hasta el minuto 25
    # (la ventana MAX_MIN manda). Con una tarea de 1 h no alcanza: el plazo queda antes del inicio.
    monkeypatch.setattr(main, "TASK_TIMEOUT_S", 7200)
    monkeypatch.setattr(main, "ANALISIS_MAX_S", 3600)
    monkeypatch.setattr(main, "GRACE_MIN", 20)
    monkeypatch.setattr(main, "MAX_MIN", 25)
    assert main.plazo_de_reclamo(0) == 25 * 60
    monkeypatch.setattr(main, "MAX_MIN", 55)
    assert main.plazo_de_reclamo(0) == 7200 - 3600 - 1200 - 300
    monkeypatch.setattr(main, "TASK_TIMEOUT_S", 3600)
    assert main.plazo_de_reclamo(0) < 0


def test_refrescar_zonas_usa_el_refresco_condicional(monkeypatch):
    capturado: list[str] = []
    monkeypatch.setattr(main, "_query", lambda sql, params: capturado.append(sql) or [])
    assert main.refrescar_vistas(zonas=True) is True
    assert capturado == ["SELECT refresh_financiamiento_si_hace_falta()"]


def test_actualizar_sin_fases_no_toca_la_columna(monkeypatch):
    capturado: list[tuple[str, tuple]] = []
    monkeypatch.setattr(main, "_query", lambda sql, params: capturado.append((sql, params)) or [])
    main.actualizar("x", {"error": "boom"}, None)
    sql, params = capturado[0]
    assert "fases" not in sql and "eventos" not in sql and params == ("boom", "x")


def test_terminar_ok_cierra_con_hora_real(monkeypatch):
    capturado: list[tuple[str, tuple]] = []
    monkeypatch.setattr(main, "_query", lambda sql, params: capturado.append((sql, params)) or [])
    main.terminar("x", main.OK, None)
    sql, _ = capturado[0]
    assert "WHEN estado = 'procesando' THEN now()" in sql and "estado = 'procesado'" in sql and "fase_index = 10" in sql


def test_terminar_ok_refresca_el_ranking(monkeypatch):
    capturado: list[tuple[str, tuple]] = []
    monkeypatch.setattr(main, "_query", lambda sql, params: capturado.append((sql, params)) or [])
    main.terminar("x", main.OK, None)
    assert any("refresh_ranking()" in sql for sql, _ in capturado)
    # zona_estado (2 s) no se refresca por contrato: solo al final de la corrida
    assert not any("refresh_financiamiento()" in sql for sql, _ in capturado)


def test_terminar_fail_no_refresca(monkeypatch):
    capturado: list[tuple[str, tuple]] = []
    monkeypatch.setattr(main, "_query", lambda sql, params: capturado.append((sql, params)) or [])
    main.terminar("x", main.FAIL, "boom")
    assert not any("refresh" in sql for sql, _ in capturado)


def test_refrescar_vistas_no_tumba_si_la_db_falla(monkeypatch):
    def boom(sql, params):
        raise RuntimeError("db caída")
    monkeypatch.setattr(main, "_query", boom)
    assert main.refrescar_vistas(zonas=True) is False
