"""Ingesta en Postgres de los lotes subidos a GCS (corre en GCP como Cloud Run Job `vigia-ingest`,
o localmente contra Cloud SQL para probar).

  python -m backend.batch.ingestar --lote <id> [--lote <id2>]   # lotes explícitos
  python -m backend.batch.ingestar                              # descubre manifiestos nuevos en el bucket
  python -m backend.batch.ingestar --lote <id> --dry-run        # parsea, no escribe
  python -m backend.batch.ingestar --lote <id> --forzar         # reprocesa ítems ya `ok`

Por tipo de lote (manifiesto `gs://<bucket>/<prefijo>lotes/<id>/manifest.jsonl`, ver subir.py):
  releases   → cada página → `normalize_release` (misma normalización que oece_ocds) → upsert
               entidades + convocatorias (payload recortado; no pisa lo que cargó el orquestador).
  records    → compiledRelease completo → mismo upsert + `ocds_payload` completo (si el existente
               es el recortado) + clasificación tipo×etapa (`backend.core.clasificacion`, si existe)
               con `proveedor_ruc` de awards/contracts.
  documentos → fila en `documentos_gcs` (ocid, tipo, url_gcs, sha256, bytes, url_origen, formato).

Idempotente por (lote_id, clave) en `lotes_items`; el lote queda en `lotes_ingesta` con conteos.
Al final llama `refresh_financiamiento()` si entraron convocatorias.

Env: PG* (+ `.cloudsql-password` local), BATCH_BUCKET (vigia-peru-batch), BATCH_PREFIJO (batch/).
"""

from __future__ import annotations

import argparse
import gzip
import json
import logging
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Iterable

from ..scrapers._core.pipeline import pg_dsn
from ..scrapers._core.ubigeo import ZonaIndex
from ..scrapers.oece_ocds.pipeline import normalize_release, slug_region
from . import BUCKET_DEFAULT, PREFIJO_DEFAULT
from .descargar import extension_de

try:  # lo crea el workstream C; si aún no está, se ingiere sin clasificar
    from ..core.clasificacion import clasificar as _clasificar
except ImportError:  # pragma: no cover
    _clasificar = None

log = logging.getLogger("batch.ingestar")

FLUSH_CADA = 200            # records por transacción
LECTORES = 8                # descargas de GCS en paralelo (records)

# ── SQL (misma semántica que oece_ocds.pipeline.load; se copia porque allí no está factorizada) ──
SQL_ENTIDADES = """
    INSERT INTO entidades (ruc, nombre, region, provincia, distrito, ubigeo)
    VALUES %s
    ON CONFLICT (ruc) DO UPDATE SET
      ubigeo    = COALESCE(NULLIF(entidades.ubigeo, ''), EXCLUDED.ubigeo),
      region    = COALESCE(entidades.region, EXCLUDED.region),
      provincia = COALESCE(entidades.provincia, EXCLUDED.provincia),
      distrito  = COALESCE(entidades.distrito, EXCLUDED.distrito),
      updated_at = now()"""

SQL_CONVOCATORIAS = """
    INSERT INTO convocatorias (ocid, codigo, entidad_ruc, objeto, cuantia_referencial, fecha_convocatoria,
                               region, ubigeo, categoria, estado_tender, fuente, ocds_payload)
    VALUES %s
    ON CONFLICT (ocid) DO UPDATE SET
      ubigeo              = COALESCE(convocatorias.ubigeo, EXCLUDED.ubigeo),
      objeto              = CASE WHEN convocatorias.objeto = '' THEN EXCLUDED.objeto ELSE convocatorias.objeto END,
      cuantia_referencial = COALESCE(convocatorias.cuantia_referencial, EXCLUDED.cuantia_referencial),
      fecha_convocatoria  = COALESCE(convocatorias.fecha_convocatoria, EXCLUDED.fecha_convocatoria),
      region              = COALESCE(convocatorias.region, EXCLUDED.region),
      categoria           = COALESCE(convocatorias.categoria, EXCLUDED.categoria),
      estado_tender       = COALESCE(EXCLUDED.estado_tender, convocatorias.estado_tender),
      -- el record completo (con parties/awards/contracts) reemplaza al payload recortado de la API,
      -- pero nunca al que registró el orquestador (que ya es completo).
      ocds_payload        = CASE WHEN EXCLUDED.fuente = 'ocds_record'
                                  AND (convocatorias.ocds_payload IS NULL OR NOT convocatorias.ocds_payload ? 'parties')
                                 THEN EXCLUDED.ocds_payload ELSE convocatorias.ocds_payload END,
      updated_at          = now()"""

SQL_CLASIFICACION = """
    UPDATE convocatorias AS c SET
      tipo_contratacion = v.tipo, etapa = v.etapa, modalidad = v.modalidad, procesable = v.procesable,
      motivo_no_procesable = v.motivo, agentes_aplicables = v.agentes, validaciones_pendientes = v.validaciones,
      proveedor_ruc = COALESCE(v.proveedor_ruc, c.proveedor_ruc), clasificado_at = now()
    FROM (VALUES %s) AS v (ocid, tipo, etapa, modalidad, procesable, motivo, agentes, validaciones, proveedor_ruc)
    WHERE c.ocid = v.ocid"""

SQL_DOCUMENTOS = """
    INSERT INTO documentos_gcs (ocid, tipo, titulo, seccion, url_gcs, sha256, bytes, url_origen, formato, publicado_at, lote_id)
    VALUES %s
    ON CONFLICT (ocid, sha256) DO UPDATE SET
      url_gcs = EXCLUDED.url_gcs, tipo = COALESCE(EXCLUDED.tipo, documentos_gcs.tipo),
      titulo = COALESCE(EXCLUDED.titulo, documentos_gcs.titulo), bytes = COALESCE(EXCLUDED.bytes, documentos_gcs.bytes),
      formato = COALESCE(EXCLUDED.formato, documentos_gcs.formato), lote_id = EXCLUDED.lote_id"""


# ── GCS ─────────────────────────────────────────────────────────────────
class Almacen:
    def __init__(self, bucket: str, prefijo: str):
        from google.cloud import storage

        self.cliente = storage.Client()
        self.bucket_name = bucket
        self.bucket = self.cliente.bucket(bucket)
        self.prefijo = prefijo if prefijo.endswith("/") or not prefijo else prefijo + "/"

    def leer(self, gs_uri: str) -> bytes:
        assert gs_uri.startswith("gs://"), gs_uri
        bucket, _, nombre = gs_uri[5:].partition("/")
        blob = self.cliente.bucket(bucket).blob(nombre) if bucket != self.bucket_name else self.bucket.blob(nombre)
        return blob.download_as_bytes()

    def leer_json_gz(self, gs_uri: str) -> dict:
        return json.loads(gzip.decompress(self.leer(gs_uri)))

    def manifiesto(self, lote_id: str) -> tuple[str, list[dict]]:
        uri = f"gs://{self.bucket_name}/{self.prefijo}lotes/{lote_id}/manifest.jsonl"
        texto = self.leer(uri).decode("utf-8")
        return uri, [json.loads(l) for l in texto.splitlines() if l.strip()]

    def lotes_en_bucket(self) -> list[str]:
        """Ids de lote con manifiesto en gs://<bucket>/<prefijo>lotes/<id>/manifest.jsonl."""
        pref = f"{self.prefijo}lotes/"
        ids = []
        for b in self.cliente.list_blobs(self.bucket_name, prefix=pref):
            if b.name.endswith("/manifest.jsonl"):
                ids.append(b.name[len(pref):].rsplit("/", 1)[0])
        return sorted(ids)


# ── normalización ──────────────────────────────────────────────────────
def fila_de_release(rel: dict, ix: ZonaIndex, fuente: str) -> dict | None:
    row = normalize_release(rel, ix)
    if not row:
        return None
    row["fuente"] = fuente
    if fuente == "ocds_record":
        row["payload"] = {k: rel.get(k) for k in ("ocid", "id", "date", "tag", "buyer", "planning", "tender", "parties",
                                                  "awards", "contracts") if k in rel}
    row["clasificacion"] = None
    if _clasificar is not None:
        try:
            c = _clasificar(rel, entidad_ruc_hint=row["entidad_ruc"])
            row["clasificacion"] = c.as_dict() if hasattr(c, "as_dict") else c.__dict__
        except Exception as e:  # noqa: BLE001 — la clasificación nunca frena la ingesta
            log.debug("   clasificar(%s) falló: %s", row["ocid"], e)
    return row


def tupla_entidad(r: dict) -> tuple:
    return (r["entidad_ruc"], (r["entidad_nombre"] or "")[:300],
            slug_region(r["departamento"]), slug_region(r["provincia"]), slug_region(r["distrito"]),
            r["ubigeo"] if r["ubigeo"] and len(r["ubigeo"]) == 6 else None)


def tupla_convocatoria(r: dict):
    from psycopg2.extras import Json

    return (r["ocid"], r["codigo"], r["entidad_ruc"], r["objeto"], r["cuantia"], r["fecha"], r["region"],
            r["ubigeo"], r["categoria"], r["estado_tender"], r["fuente"], Json(r["payload"]))


def tupla_clasificacion(r: dict) -> tuple | None:
    c = r.get("clasificacion")
    if not c:
        return None
    return (r["ocid"], c["tipo"], c["etapa"], c.get("modalidad"), bool(c["procesable"]), c.get("motivo_no_procesable"),
            list(c.get("agentes") or []), list(c.get("validaciones_pendientes") or []), c.get("proveedor_ruc"))


# ── ingesta ─────────────────────────────────────────────────────────────
class Ingesta:
    def __init__(self, alm: Almacen, dry_run: bool = False, forzar: bool = False):
        import psycopg2

        self.alm = alm
        self.dry_run = dry_run
        self.forzar = forzar
        self.conn = psycopg2.connect(pg_dsn())
        self.conn.autocommit = False
        self.ix = self._zona_index()
        self.hay_clasificacion = self._columna_existe("convocatorias", "tipo_contratacion")
        self.hay_documentos = self._tabla_existe("documentos_gcs")
        self.hay_lotes = self._tabla_existe("lotes_ingesta")
        if _clasificar is None:
            log.warning("backend.core.clasificacion no disponible: se ingiere sin clasificar")
        elif not self.hay_clasificacion:
            log.warning("convocatorias sin columnas de clasificación (migración 13 no aplicada): no se clasifica")
        if not self.hay_lotes:
            raise SystemExit("falta la migración 14 (lotes_ingesta): python backend/db/apply_all.py")
        self.convocatorias_tocadas = 0

    # ── helpers DB ──
    def _zona_index(self) -> ZonaIndex:
        with self.conn.cursor() as cur:
            cur.execute("SELECT ubigeo, nivel, nombre, padre_ubigeo FROM zonas")
            return ZonaIndex.from_rows(cur.fetchall())

    def _tabla_existe(self, nombre: str) -> bool:
        with self.conn.cursor() as cur:
            cur.execute("SELECT to_regclass(%s) IS NOT NULL", (nombre,))
            return bool(cur.fetchone()[0])

    def _columna_existe(self, tabla: str, col: str) -> bool:
        with self.conn.cursor() as cur:
            cur.execute("SELECT 1 FROM information_schema.columns WHERE table_name = %s AND column_name = %s", (tabla, col))
            return cur.fetchone() is not None

    def _items_ok(self, lote_id: str) -> set[str]:
        with self.conn.cursor() as cur:
            cur.execute("SELECT clave FROM lotes_items WHERE lote_id = %s AND estado = 'ok'", (lote_id,))
            return {r[0] for r in cur.fetchall()}

    def _abrir_lote(self, lote_id: str, tipo: str, uri: str, total: int) -> None:
        if self.dry_run:
            return
        with self.conn.cursor() as cur:
            cur.execute("""
                INSERT INTO lotes_ingesta (id, tipo, manifest_uri, estado, total, iniciado_at)
                VALUES (%s, %s, %s, 'procesando', %s, now())
                ON CONFLICT (id) DO UPDATE SET estado = 'procesando', total = EXCLUDED.total, manifest_uri = EXCLUDED.manifest_uri,
                  iniciado_at = COALESCE(lotes_ingesta.iniciado_at, now()), finalizado_at = NULL, error = NULL""",
                        (lote_id, tipo, uri, total))
        self.conn.commit()

    def _cerrar_lote(self, lote_id: str, error: str | None = None) -> dict:
        with self.conn.cursor() as cur:
            cur.execute("""SELECT count(*) FILTER (WHERE estado = 'ok'), count(*) FILTER (WHERE estado = 'error')
                             FROM lotes_items WHERE lote_id = %s""", (lote_id,))
            ok, fallidos = cur.fetchone()
            if not self.dry_run:
                cur.execute("""UPDATE lotes_ingesta SET ok = %s, fallidos = %s, finalizado_at = now(), error = %s,
                                 estado = CASE WHEN %s IS NOT NULL OR %s > 0 THEN 'error' ELSE 'ok' END WHERE id = %s""",
                            (ok, fallidos, error, error, fallidos, lote_id))
        self.conn.commit()
        return {"ok": ok, "fallidos": fallidos}

    def _marcar_items(self, lote_id: str, claves: Iterable[str], estado: str, error: str | None = None) -> None:
        from psycopg2.extras import execute_values

        if self.dry_run:
            return
        with self.conn.cursor() as cur:
            execute_values(cur, """
                INSERT INTO lotes_items (lote_id, clave, estado, error, procesado_at) VALUES %s
                ON CONFLICT (lote_id, clave) DO UPDATE SET estado = EXCLUDED.estado, error = EXCLUDED.error, procesado_at = now()""",
                           [(lote_id, c, estado, (error or "")[:500] or None) for c in claves], page_size=500,
                           template="(%s, %s, %s, %s, now())")

    def _upsert_convocatorias(self, rows: list[dict]) -> None:
        from psycopg2.extras import execute_values

        if not rows or self.dry_run:
            return
        ents = {r["entidad_ruc"]: r for r in rows}
        with self.conn.cursor() as cur:
            execute_values(cur, SQL_ENTIDADES, [tupla_entidad(r) for r in ents.values()], page_size=500)
            execute_values(cur, SQL_CONVOCATORIAS, [tupla_convocatoria(r) for r in rows], page_size=500)
            if self.hay_clasificacion:
                clas = [t for t in (tupla_clasificacion(r) for r in rows) if t]
                if clas:
                    execute_values(cur, SQL_CLASIFICACION, clas, page_size=500,
                                   template="(%s, %s, %s, %s, %s, %s, %s::text[], %s::text[], %s)")
        self.convocatorias_tocadas += len(rows)

    # ── por tipo ──
    def _ingerir_releases(self, lote_id: str, items: list[dict]) -> None:
        for it in items:
            rows: dict[str, dict] = {}
            try:
                for a in it.get("archivos") or []:
                    for rel in self.alm.leer_json_gz(a["gs"]).get("releases") or []:
                        row = fila_de_release(rel, self.ix, "ocds_api")
                        if row and (row["ocid"] not in rows or row["date"] > rows[row["ocid"]]["date"]):
                            rows[row["ocid"]] = row
                self._upsert_convocatorias(list(rows.values()))
                self._marcar_items(lote_id, [it["clave"]], "ok")
                self.conn.commit()
                log.info("   %s · %d páginas · %d convocatorias", it["clave"], len(it.get("archivos") or []), len(rows))
            except Exception as e:  # noqa: BLE001
                self.conn.rollback()
                log.warning("   %s falló: %s", it["clave"], str(e)[:300])
                self._marcar_items(lote_id, [it["clave"]], "error", str(e))
                self.conn.commit()

    def _ingerir_records(self, lote_id: str, items: list[dict]) -> None:
        pendientes: list[dict] = []
        claves: list[str] = []
        errores: list[tuple[str, str]] = []

        def flush() -> None:
            if not claves and not errores:
                return
            try:
                self._upsert_convocatorias(pendientes)
                self._marcar_items(lote_id, claves, "ok")
                for c, e in errores:
                    self._marcar_items(lote_id, [c], "error", e)
                self.conn.commit()
            except Exception as e:  # noqa: BLE001 — un lote entero de 200 no debe morir por 1 fila: reintento de a uno
                self.conn.rollback()
                log.warning("   flush de %d records falló (%s); reintento uno por uno", len(claves), str(e)[:200])
                for row, c in zip(pendientes, claves):
                    try:
                        self._upsert_convocatorias([row])
                        self._marcar_items(lote_id, [c], "ok")
                        self.conn.commit()
                    except Exception as e2:  # noqa: BLE001
                        self.conn.rollback()
                        self._marcar_items(lote_id, [c], "error", str(e2))
                        self.conn.commit()
                for c, e in errores:
                    self._marcar_items(lote_id, [c], "error", e)
                self.conn.commit()
            pendientes.clear()
            claves.clear()
            errores.clear()

        def leer(it: dict) -> tuple[dict, dict | None, str | None]:
            archivos = it.get("archivos") or []
            if not archivos:
                return it, None, "sin archivo en el manifiesto"
            try:
                return it, self.alm.leer_json_gz(archivos[0]["gs"]), None
            except Exception as e:  # noqa: BLE001
                return it, None, f"{e.__class__.__name__}: {str(e)[:200]}"

        with ThreadPoolExecutor(max_workers=LECTORES) as ex:
            for k in range(0, len(items), FLUSH_CADA):
                for it, rec, err in ex.map(leer, items[k:k + FLUSH_CADA]):
                    if err:
                        errores.append((it["clave"], err))
                        continue
                    try:
                        comp = rec.get("compiledRelease") or rec
                        row = fila_de_release(comp, self.ix, "ocds_record")
                        if not row:
                            raise ValueError("record sin ocid o sin RUC de comprador")
                        pendientes.append(row)
                        claves.append(it["clave"])
                    except Exception as e:  # noqa: BLE001
                        errores.append((it["clave"], str(e)[:300]))
                flush()
                log.info("   %d/%d records", min(k + FLUSH_CADA, len(items)), len(items))

    def _ingerir_documentos(self, lote_id: str, items: list[dict]) -> None:
        from psycopg2.extras import execute_values

        if not self.hay_documentos:
            raise SystemExit("falta la tabla documentos_gcs (migración 14)")
        filas, claves = [], []
        for it in items:
            meta = it.get("meta") or {}
            archivos = it.get("archivos") or []
            if not archivos or not it.get("sha256"):
                self._marcar_items(lote_id, [it["clave"]], "error", "sin archivo o sin sha256")
                continue
            ocid = meta.get("ocid_corto") or it["clave"].split("/", 1)[0]
            pub = meta.get("datePublished")
            filas.append((ocid, meta.get("documentType"), (meta.get("title") or None), meta.get("seccion"), archivos[0]["gs"],
                          it["sha256"], meta.get("bytes_reales") or it.get("bytes"), meta.get("url"),
                          extension_de(meta), pub, lote_id))
            claves.append(it["clave"])
        if not self.dry_run and filas:
            with self.conn.cursor() as cur:
                execute_values(cur, SQL_DOCUMENTOS, filas, page_size=500)
        self._marcar_items(lote_id, claves, "ok")
        self.conn.commit()
        log.info("   %d documentos registrados", len(filas))

    # ── lote ──
    def ingerir_lote(self, lote_id: str) -> dict:
        t0 = time.time()
        uri, items = self.alm.manifiesto(lote_id)
        tipo = items[0]["tipo"] if items else lote_id.split("-", 1)[0]
        hechos = set() if self.forzar else self._items_ok(lote_id)
        faltan = [it for it in items if it["clave"] not in hechos]
        log.info("━━ ingestar · lote %s (%s) · %d ítems en el manifiesto · %d ya ok · %d a procesar%s",
                 lote_id, tipo, len(items), len(items) - len(faltan), len(faltan), " [dry-run]" if self.dry_run else "")
        self._abrir_lote(lote_id, tipo, uri, len(items))
        error = None
        try:
            if tipo == "releases":
                self._ingerir_releases(lote_id, faltan)
            elif tipo == "records":
                self._ingerir_records(lote_id, faltan)
            elif tipo == "documentos":
                self._ingerir_documentos(lote_id, faltan)
            else:
                raise ValueError(f"tipo de lote desconocido: {tipo}")
        except Exception as e:  # noqa: BLE001
            self.conn.rollback()
            error = f"{e.__class__.__name__}: {str(e)[:400]}"
            log.error("   lote %s abortado: %s", lote_id, error)
        r = self._cerrar_lote(lote_id, error)
        log.info("━━ ingestar · lote %s · ok %d · fallidos %d · %.0fs", lote_id, r["ok"], r["fallidos"], time.time() - t0)
        return {"lote": lote_id, "tipo": tipo, **r, "error": error}

    def lotes_pendientes(self) -> list[str]:
        """Manifiestos del bucket que no están `ok` en lotes_ingesta."""
        en_bucket = self.alm.lotes_en_bucket()
        with self.conn.cursor() as cur:
            cur.execute("SELECT id FROM lotes_ingesta WHERE estado = 'ok'")
            listos = {r[0] for r in cur.fetchall()}
        return [l for l in en_bucket if l not in listos]

    def refrescar(self) -> None:
        if self.dry_run or not self.convocatorias_tocadas:
            return
        t0 = time.time()
        with self.conn.cursor() as cur:
            cur.execute("SELECT refresh_financiamiento()")
        self.conn.commit()
        log.info("   refresh_financiamiento() en %.0fs (%d convocatorias tocadas)", time.time() - t0, self.convocatorias_tocadas)

    def close(self) -> None:
        self.conn.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--lote", action="append", default=[], help="id de lote (repetible); sin esto, descubre los pendientes")
    ap.add_argument("--bucket", default=BUCKET_DEFAULT)
    ap.add_argument("--prefijo", default=PREFIJO_DEFAULT)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--forzar", action="store_true", help="reprocesar ítems ya ok")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname).1s %(name)s · %(message)s", datefmt="%H:%M:%S")
    logging.getLogger("urllib3").setLevel(logging.WARNING)

    alm = Almacen(args.bucket, args.prefijo)
    ing = Ingesta(alm, dry_run=args.dry_run, forzar=args.forzar)
    try:
        lotes = list(args.lote) or ing.lotes_pendientes()
        if not lotes:
            log.info("no hay lotes pendientes en gs://%s/%slotes/", args.bucket, alm.prefijo)
            return 0
        resultados = [ing.ingerir_lote(l) for l in lotes]
        ing.refrescar()
    finally:
        ing.close()
    con_error = [r for r in resultados if r["error"] or r["fallidos"]]
    for r in resultados:
        print(json.dumps(r, ensure_ascii=False), flush=True)
    return 1 if con_error else 0


if __name__ == "__main__":
    sys.exit(main())
