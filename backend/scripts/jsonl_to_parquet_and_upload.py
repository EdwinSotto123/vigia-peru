"""
Convierte el checkpoint JSONL de embeddings en Parquet con el schema que
Pinecone Bulk Import espera, y lo sube al bucket GCS público.

Pinecone Bulk Import schema (dense index):
  - id           string
  - values       list<float>
  - metadata     string (JSON serializado)

Organización de archivos para Pinecone:
  gs://<bucket>/<dataset-prefix>/<namespace>/file.parquet
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parent.parent.parent  # raíz del repo
CKPT = ROOT / "dataset" / "_rag_build" / "embeddings_checkpoint.jsonl"
BUCKET = "hacklatam-rag-leyes"
DATASET_PREFIX = "opiniones-dataset"
NAMESPACE = "opiniones-oece"


def main():
    if not CKPT.exists():
        sys.exit(f"Falta {CKPT}")

    ids: list[str] = []
    values: list[list[float]] = []
    metas: list[str] = []
    with CKPT.open(encoding="utf-8") as f:
        for ln in f:
            ln = ln.strip()
            if not ln:
                continue
            row = json.loads(ln)
            ids.append(str(row["id"]))
            values.append([float(x) for x in row["values"]])
            metas.append(json.dumps(row["metadata"], ensure_ascii=False))
    print(f"Leídas {len(ids)} filas")

    ns_dir = CKPT.parent / DATASET_PREFIX / NAMESPACE
    ns_dir.mkdir(parents=True, exist_ok=True)
    file_path = ns_dir / "opiniones-oece.parquet"

    table = pa.table({
        "id": pa.array(ids, type=pa.string()),
        "values": pa.array(values, type=pa.list_(pa.float32())),
        "metadata": pa.array(metas, type=pa.string()),
    })
    pq.write_table(table, file_path, compression="snappy")
    print(f"Parquet → {file_path} ({file_path.stat().st_size/1024:.1f} KB)")

    target = f"gs://{BUCKET}/{DATASET_PREFIX}/{NAMESPACE}/opiniones-oece.parquet"
    print(f"Subiendo a {target}...")
    subprocess.run(["gsutil", "cp", str(file_path), target], check=True)

    print()
    print("LISTO. En la consola de Pinecone:")
    print(f"  Storage URI para Import:  gs://{BUCKET}/{DATASET_PREFIX}/")
    print(f"  Namespace destino:        {NAMESPACE}")
    print(f"  El namespace se infiere automáticamente del path de cada parquet.")


if __name__ == "__main__":
    main()
