"""Backend `chroma` de query_legal_rag (Chroma Cloud): misma forma de salida que RAG Engine, sin red."""
import json

from tools import legal


class _Col:
    def __init__(self, filas):
        self.filas = filas

    def query(self, query_texts, n_results, include):
        f = self.filas[:n_results]
        return {"documents": [[x[0] for x in f]], "metadatas": [[x[1] for x in f]], "distances": [[x[2] for x in f]]}


def test_chroma_devuelve_chunks_citables(monkeypatch):
    meta = {"uri": "gs://b/normas-vigentes/ley-32069/art-0029.txt", "documento": "Ley N° 32069", "numero": "Ley N° 32069", "tipo": "norma",
            "regimen": "32069", "articulo": "29", "pagina": 12, "url_oficial": "https://www.gob.pe/x", "corpus": "normas-vigentes"}
    cols = {"normas-vigentes": _Col([("Artículo 29. Plazos…", meta, 0.2)]), "criterios-vinculantes": _Col([])}
    monkeypatch.setattr(legal, "_chroma_coleccion", lambda c: cols[c])
    legal._RAG_QUERY_CACHE.clear()
    r = legal.query_legal_rag_chroma("plazo mínimo entre convocatoria y ofertas", regimen="32069")
    assert r["_source"] == "chroma" and r["n_matches"] == 1
    m = r["matches"][0]
    assert m["articulo"] == "29" and m["score"] == 0.8 and m["cita_formato"] == "Art. 29 de Ley N° 32069 (https://www.gob.pe/x)"
    json.dumps(r)  # serializable (se cachea)


def test_chroma_caido_no_revienta(monkeypatch):
    def boom(c):
        raise RuntimeError("sin red")
    monkeypatch.setattr(legal, "_chroma_coleccion", boom)
    legal._RAG_QUERY_CACHE.clear()
    r = legal.query_legal_rag_chroma("x", regimen="32069")
    assert "error" in r and r["n_matches"] == 0
