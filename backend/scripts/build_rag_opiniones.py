"""
Construye los embeddings de las 723 opiniones normativas OECE y exporta
un Parquet listo para `Pinecone Bulk Import` desde un bucket GCS.

Pipeline:
  1. Lee `dataset/datos_complementarios/opiniones_normativas/CONOSCE_INTERPRETACIONNORMATIVA_1.xlsx`
  2. Por cada opinión arma el texto a embedder
       <NORMA> · Opinión <NUM> (<AÑO>) · Art.<ARTL>.<NUM_LIT>.<LIT> Reg.<ARTR>\n\n<INTERPRETACIÓN>
  3. Genera embeddings con `text-embedding-005` (Vertex AI, 768 dim).
  4. Escribe `opiniones_oece.parquet` con columnas:
       id (string), values (list<float>), metadata (string json)
  5. Sube a `gs://hacklatam-rag-leyes/opiniones/`
  6. Le da al usuario las instrucciones de Import Job en Pinecone.

Uso:
    python backend/scripts/build_rag_opiniones.py
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import openpyxl
import pyarrow as pa
import pyarrow.parquet as pq
from google import genai
from google.genai import types as gtypes

ROOT = Path(__file__).resolve().parent.parent.parent  # raíz del repo
XLSX = ROOT / "dataset" / "datos_complementarios" / "opiniones_normativas" / "CONOSCE_INTERPRETACIONNORMATIVA_1.xlsx"
OUT_PARQUET = ROOT / "dataset" / "_rag_build" / "opiniones_oece.parquet"
OUT_PARQUET.parent.mkdir(parents=True, exist_ok=True)

PROJECT = os.getenv("VERTEX_PROJECT", "vivid-spot-480905-a4")
LOCATION = os.getenv("VERTEX_LOCATION", "us-central1")
BUCKET = "hacklatam-rag-leyes"
EMBED_MODEL = "gemini-embedding-001"
OUTPUT_DIM = 768
BATCH = 1                  # gemini-embedding-001 acepta 1 contenido por request
THROTTLE_SECONDS = 1.2     # ~50 req/min, conservador para no chocar cuota
CHECKPOINT = OUT_PARQUET.parent / "embeddings_checkpoint.jsonl"


def read_opiniones() -> list[dict]:
    wb = openpyxl.load_workbook(XLSX, read_only=True, data_only=True)
    ws = wb["OPINIONES"]
    rows = list(ws.iter_rows(min_row=2, values_only=True))
    headers = ["ano", "norma", "num_opinion", "art_ley", "numeral", "literal",
               "art_reglamento", "interpretacion", "link"]
    out = []
    for r in rows:
        if not any(r):
            continue
        d = dict(zip(headers, r))
        if not d.get("num_opinion") or not d.get("interpretacion"):
            continue
        d["ano"] = str(d.get("ano") or "").strip()
        d["norma"] = str(d.get("norma") or "").strip()
        d["num_opinion"] = str(d.get("num_opinion") or "").strip()
        d["interpretacion"] = str(d.get("interpretacion") or "").strip()
        for k in ("art_ley", "numeral", "literal", "art_reglamento", "link"):
            d[k] = str(d.get(k) or "").strip() if d.get(k) is not None else ""
        out.append(d)
    return out


def text_to_embed(d: dict) -> str:
    norma = d["norma"]
    num = d["num_opinion"]
    ano = d["ano"]
    head_bits = [f"{norma} · Opinión {num} ({ano})"]
    if d["art_ley"]:
        a = f"Art.{d['art_ley']}"
        if d["numeral"]: a += f".{d['numeral']}"
        if d["literal"]: a += f".{d['literal']}"
        head_bits.append(a)
    if d["art_reglamento"]:
        head_bits.append(f"Reglamento Art.{d['art_reglamento']}")
    head = " · ".join(head_bits)
    return f"{head}\n\n{d['interpretacion']}"


def main():
    print(f"Leyendo {XLSX}...")
    opiniones = read_opiniones()
    print(f"  {len(opiniones)} opiniones cargadas")

    client = genai.Client(vertexai=True, project=PROJECT, location=LOCATION)
    print(f"Vertex AI client OK. Modelo: {EMBED_MODEL} ({OUTPUT_DIM} dim)")

    # Checkpoint: si existe, retomar desde donde quedamos
    done_ids: set[str] = set()
    cached_rows: list[dict] = []
    if CHECKPOINT.exists():
        with CHECKPOINT.open(encoding="utf-8") as f:
            for ln in f:
                row = json.loads(ln)
                cached_rows.append(row)
                done_ids.add(row["id"])
        print(f"  Checkpoint: {len(done_ids)} ya embebidos, retomando…")

    ckpt_handle = CHECKPOINT.open("a", encoding="utf-8")

    for idx, d in enumerate(opiniones):
        oid = d["num_opinion"]
        if oid in done_ids:
            continue
        text = text_to_embed(d)
        retries = 0
        while True:
            try:
                resp = client.models.embed_content(
                    model=EMBED_MODEL,
                    contents=[text],
                    config=gtypes.EmbedContentConfig(
                        task_type="RETRIEVAL_DOCUMENT",
                        output_dimensionality=OUTPUT_DIM,
                    ),
                )
                break
            except Exception as e:
                retries += 1
                if retries > 6:
                    print(f"  ERR {oid}: {e}")
                    raise
                msg = str(e)
                wait = 60 if "429" in msg or "RESOURCE_EXHAUSTED" in msg else 2 ** retries
                print(f"  retry {retries} after {wait}s ({msg[:80]})")
                time.sleep(wait)
        emb = list(resp.embeddings[0].values)
        row = {
            "id": oid,
            "values": emb,
            "metadata": {
                "norma": d["norma"],
                "num_opinion": d["num_opinion"],
                "ano": d["ano"],
                "art_ley": d["art_ley"],
                "numeral": d["numeral"],
                "literal": d["literal"],
                "art_reglamento": d["art_reglamento"],
                "interpretacion": d["interpretacion"][:8000],
                "link": d["link"],
            },
        }
        cached_rows.append(row)
        done_ids.add(oid)
        ckpt_handle.write(json.dumps(row, ensure_ascii=False) + "\n")
        ckpt_handle.flush()
        if (idx + 1) % 10 == 0:
            print(f"  {idx + 1}/{len(opiniones)} ✓")
        time.sleep(THROTTLE_SECONDS)

    ckpt_handle.close()

    ids = [r["id"] for r in cached_rows]
    values = [r["values"] for r in cached_rows]
    metadata_jsons = [json.dumps(r["metadata"], ensure_ascii=False) for r in cached_rows]

    print(f"Escribiendo Parquet en {OUT_PARQUET}...")
    table = pa.table({
        "id": pa.array(ids, type=pa.string()),
        "values": pa.array(values, type=pa.list_(pa.float32())),
        "metadata": pa.array(metadata_jsons, type=pa.string()),
    })
    pq.write_table(table, OUT_PARQUET, compression="snappy")
    print(f"  {OUT_PARQUET.stat().st_size/1024:.1f} KB")

    print()
    print("Próximos pasos:")
    print(f"  1. gsutil mb -l us-central1 gs://{BUCKET}/  (si no existe)")
    print(f"  2. gsutil iam ch allUsers:objectViewer gs://{BUCKET}/")
    print(f"  3. gsutil cp {OUT_PARQUET} gs://{BUCKET}/opiniones/")
    print(f"  4. En Pinecone consola: Import data → storage integration GCS → ")
    print(f"     namespace 'opiniones-oece' · path gs://{BUCKET}/opiniones/")


if __name__ == "__main__":
    main()
