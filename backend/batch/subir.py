"""Sube a GCS los ítems `completed` de un lote y escribe su manifiesto.

  python -m backend.batch.subir --lote <id> [--bucket vigia-peru-batch] [--prefijo batch/] [--paralelo 8]
  python -m backend.batch.subir --pendientes          # todos los lotes con ítems sin subir

Layout en el bucket (el objeto se nombra por CONTENIDO, no por lote, así un mismo record o PDF
re-descargado o deduplicado no se sube dos veces):
  gs://<bucket>/<prefijo>releases/<ventana>/page-0001.json.gz
  gs://<bucket>/<prefijo>records/<aa>/<ocid>.json.gz
  gs://<bucket>/<prefijo>documentos/<aa>/<ocid>/<sha8>.<ext>
  gs://<bucket>/<prefijo>lotes/<lote_id>/manifest.jsonl     una línea por ítem (clave, ruta, sha256, bytes, meta, archivos[])
  gs://<bucket>/<prefijo>lotes/<lote_id>/lote.json          cabecera (tipo, desde, hasta, conteos, subido_at)

Verificación: `upload_from_filename(checksum="md5")` hace que GCS rechace un objeto corrupto y
además se compara el md5 devuelto con el local. Si el objeto ya existe con el mismo md5 no se
re-sube. Reanudable: sólo toca ítems sin `subido_at`; el manifiesto se reescribe completo al final
(su presencia es la señal de "lote listo" para `ingestar.py`).

Credenciales: ADC (`gcloud auth application-default login`) o GOOGLE_APPLICATION_CREDENTIALS.
"""

from __future__ import annotations

import argparse
import base64
import datetime as dt
import hashlib
import json
import logging
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from . import BATCH_DIR, BUCKET_DEFAULT, PREFIJO_DEFAULT
from .descargar import configurar_logs
from .estado import Estado

log = logging.getLogger("batch.subir")


def md5_b64(path: Path) -> str:
    h = hashlib.md5()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return base64.b64encode(h.digest()).decode()


def archivos_de_item(item: dict) -> list[Path]:
    """Un ítem apunta a un archivo (records/documentos) o a una carpeta de páginas (releases)."""
    if not item.get("ruta"):
        return []
    p = BATCH_DIR / item["ruta"]
    if p.is_dir():
        return sorted(p.glob("page-*.json.gz"))
    return [p] if p.exists() else []


class Subidor:
    def __init__(self, bucket: str, prefijo: str, paralelo: int = 8, dry_run: bool = False, limpiar: bool = False):
        from google.cloud import storage  # import tardío: la laptop de descarga no siempre lo tiene

        self.cliente = storage.Client()
        self.bucket = self.cliente.bucket(bucket)
        self.bucket_name = bucket
        self.prefijo = prefijo if prefijo.endswith("/") or not prefijo else prefijo + "/"
        self.paralelo = paralelo
        self.dry_run = dry_run
        self.limpiar = limpiar          # borrar el archivo local una vez verificado en GCS (el bucket es el almacén)
        self.lock = threading.Lock()
        self.stats = {"subidos": 0, "saltados": 0, "bytes": 0, "fallidos": 0, "borrados": 0}

    def uri(self, ruta_relativa: str) -> str:
        return f"gs://{self.bucket_name}/{self.prefijo}{ruta_relativa}"

    def subir_archivo(self, path: Path) -> dict:
        rel = path.relative_to(BATCH_DIR).as_posix()
        nombre = f"{self.prefijo}{rel}"
        local_md5 = md5_b64(path)
        n = path.stat().st_size
        if self.dry_run:
            return {"gs": self.uri(rel), "bytes": n, "md5": local_md5, "saltado": True}
        from google.api_core.exceptions import PreconditionFailed

        blob = self.bucket.blob(nombre)
        try:
            # 1 sola llamada si el objeto no existe; GCS verifica el md5 y rechaza un cuerpo corrupto.
            blob.upload_from_filename(str(path), checksum="md5", timeout=300, if_generation_match=0)
        except PreconditionFailed:
            existente = self.bucket.get_blob(nombre)
            if existente is not None and existente.md5_hash == local_md5:
                with self.lock:
                    self.stats["saltados"] += 1
                return {"gs": self.uri(rel), "bytes": n, "md5": local_md5, "saltado": True}
            blob.upload_from_filename(str(path), checksum="md5", timeout=300)      # contenido distinto: se pisa
        if blob.md5_hash != local_md5:            # la respuesta del upload ya trae md5Hash
            raise RuntimeError(f"md5 no coincide tras subir {rel}: {blob.md5_hash} ≠ {local_md5}")
        with self.lock:
            self.stats["subidos"] += 1
            self.stats["bytes"] += n
        return {"gs": self.uri(rel), "bytes": n, "md5": local_md5, "saltado": False}

    def subir_item(self, est: Estado, lote_id: str, item: dict) -> None:
        archivos = archivos_de_item(item)
        if not archivos and (item.get("bytes") or 0) > 0:
            raise FileNotFoundError(f"{item['clave']}: no existe {item.get('ruta')!r} en {BATCH_DIR}")
        subidos = [self.subir_archivo(p) for p in archivos]        # [] = ventana vacía (0 páginas)
        meta = dict(item.get("meta") or {})
        meta["archivos"] = subidos
        if not self.dry_run:
            est.marcar(lote_id, item["clave"], "completed", subido_at=dt.datetime.now().isoformat(timespec="seconds"), meta=meta)
            if self.limpiar:
                for p in archivos:
                    try:
                        p.unlink()
                        with self.lock:
                            self.stats["borrados"] += 1
                    except OSError as e:
                        log.warning("   no pude borrar %s: %s", p, e)
                # carpeta vacía de documentos/<aa>/<ocid> o de la ventana de releases
                for p in {a.parent for a in archivos}:
                    try:
                        p.rmdir()
                    except OSError:
                        pass

    def subir_lote(self, est: Estado, lote_id: str) -> tuple[str | None, dict]:
        lote = est.lote(lote_id)
        if not lote:
            raise SystemExit(f"lote {lote_id} no existe")
        pendientes = [it for it in est.items(lote_id, "completed") if not it.get("subido_at")]
        log.info("━━ subir · lote %s (%s) · %d ítems completos · %d sin subir · %s",
                 lote_id, lote["tipo"], lote["ok"], len(pendientes), self.uri(""))
        t0 = time.time()
        fallidos = 0
        with ThreadPoolExecutor(max_workers=self.paralelo) as ex:
            futs = {ex.submit(self.subir_item, est, lote_id, it): it["clave"] for it in pendientes}
            for k, f in enumerate(as_completed(futs), 1):
                exc = f.exception()
                if exc:
                    fallidos += 1
                    log.warning("   %s falló: %s", futs[f], str(exc)[:200])
                if k % 200 == 0:
                    log.info("   %d/%d · %.1f MB · %.0fs", k, len(pendientes), self.stats["bytes"] / 1e6, time.time() - t0)
        self.stats["fallidos"] += fallidos
        if self.dry_run:
            log.info("   [dry-run] %d ítems, %d archivos; no se sube nada", len(pendientes),
                     sum(len(archivos_de_item(it)) for it in pendientes))
            return None, self.stats
        manifest_uri = self.escribir_manifiesto(est, lote_id)
        r = est.resumen(lote_id)
        log.info("━━ subir · lote %s · subidos %d · ya estaban %d · fallidos %d · %.1f MB · %.0fs · manifiesto %s (%d ítems)%s",
                 lote_id, self.stats["subidos"], self.stats["saltados"], fallidos, self.stats["bytes"] / 1e6,
                 time.time() - t0, manifest_uri, r["subidos"],
                 f" · {self.stats['borrados']} archivos locales borrados" if self.limpiar else "")
        return manifest_uri, self.stats

    def escribir_manifiesto(self, est: Estado, lote_id: str) -> str:
        lote = est.lote(lote_id)
        items = [it for it in est.items(lote_id, "completed") if it.get("subido_at")]
        lineas = []
        for it in items:
            meta = dict(it.get("meta") or {})
            archivos = meta.pop("archivos", [])
            lineas.append(json.dumps({
                "clave": it["clave"], "tipo": lote["tipo"], "ruta": it["ruta"], "sha256": it["sha256"],
                "bytes": it["bytes"], "subido_at": it["subido_at"], "meta": meta, "archivos": archivos,
            }, ensure_ascii=False))
        base = f"{self.prefijo}lotes/{lote_id}/"
        self.bucket.blob(base + "manifest.jsonl").upload_from_string(
            "\n".join(lineas) + ("\n" if lineas else ""), content_type="application/x-ndjson")
        cabecera = {**lote, "items_subidos": len(items), "manifest": self.uri(f"lotes/{lote_id}/manifest.jsonl"),
                    "subido_at": dt.datetime.now().isoformat(timespec="seconds")}
        self.bucket.blob(base + "lote.json").upload_from_string(json.dumps(cabecera, ensure_ascii=False, indent=1),
                                                                content_type="application/json")
        if cabecera["manifest"] not in (lote.get("nota") or ""):
            est.actualizar_lote(lote_id, nota=(lote.get("nota") or "") + f" · manifiesto {cabecera['manifest']}")
        return cabecera["manifest"]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--lote", action="append", default=[], help="lote a subir (repetible)")
    ap.add_argument("--pendientes", action="store_true", help="todos los lotes con ítems completos sin subir")
    ap.add_argument("--bucket", default=BUCKET_DEFAULT)
    ap.add_argument("--prefijo", default=PREFIJO_DEFAULT)
    ap.add_argument("--paralelo", type=int, default=8)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limpiar", action="store_true", help="borrar cada archivo local una vez verificado en GCS (el bucket es el almacén; el estado SQLite se conserva)")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args(argv)
    configurar_logs(args.verbose)

    est = Estado()
    lotes = list(args.lote)
    if args.pendientes:
        for l in est.lotes():
            if l["ok"] and est.resumen(l["id"])["subidos"] < l["ok"] and l["id"] not in lotes:
                lotes.append(l["id"])
    if not lotes:
        log.info("nada que subir (pasá --lote <id> o --pendientes)")
        return 0
    sub = Subidor(args.bucket, args.prefijo, args.paralelo, args.dry_run, limpiar=args.limpiar)
    codigo = 0
    for lote_id in lotes:
        manifest, stats = sub.subir_lote(est, lote_id)
        if stats["fallidos"]:
            codigo = 1
        if manifest:
            print(manifest, flush=True)
    est.close()
    return codigo


if __name__ == "__main__":
    sys.exit(main())
