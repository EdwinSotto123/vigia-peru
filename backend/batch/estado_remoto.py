"""Estado del lote en GCS para las corridas en la nube (el disco de Cloud Run es efímero) + candado.

  gs://<bucket>/estado/estado.sqlite   copia de `estado.sqlite` (estado.py): se baja al empezar y se sube en
                                       cada punto de control y al final (también si la corrida falla)
  gs://<bucket>/estado/candado.json    una corrida a la vez: se crea con if_generation_match=0 (de dos que
                                       arrancan juntas gana una) y vence a las TTL horas, por si una corrida
                                       murió sin soltarlo; vencido, la siguiente lo toma.

Lo que se sube es `Estado.copia(..., sanear=<lotes de la corrida>)`: la copia nunca dice "bajado" de
algo que no llegó al bucket (lo `completed` sin `subido_at` y lo `processing` vuelven a `pending`).
La subida va con if_generation_match = la última generación conocida: si alguien pisó el objeto mientras
tanto (p. ej. un `nube sembrar` a mano) no se sobrescribe; la copia queda aparte como
estado/conflicto-<fecha>.sqlite y se lanza `Conflicto`.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import os
import socket
import tempfile
import time
from pathlib import Path

from google.api_core.exceptions import NotFound, PreconditionFailed

from .estado import Estado

log = logging.getLogger("batch.estado_remoto")

OBJETO_ESTADO = os.getenv("BATCH_ESTADO_OBJETO", "estado/estado.sqlite")
OBJETO_CANDADO = os.getenv("BATCH_CANDADO_OBJETO", "estado/candado.json")


class Ocupado(RuntimeError):
    """Otra corrida tiene el candado vigente."""


class Conflicto(RuntimeError):
    """El estado en GCS cambió desde que se bajó: no se pisó."""


def dueño() -> str:
    """Quién tiene el candado: la ejecución de Cloud Run o host:pid."""
    return os.getenv("CLOUD_RUN_EXECUTION") or f"{socket.gethostname()}:{os.getpid()}"


def _ts() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d-%H%M%S")


def apartar(destino: Path) -> Path | None:
    """Si ya hay un estado local, lo renombra (con su -wal/-shm) a estado.local-<fecha>.sqlite."""
    if not destino.exists():
        return None
    nuevo = destino.with_name(f"{destino.stem}.local-{_ts()}{destino.suffix}")
    for sufijo in ("-wal", "-shm"):
        extra = destino.with_name(destino.name + sufijo)
        if extra.exists():
            extra.replace(nuevo.with_name(nuevo.name + sufijo))
    destino.replace(nuevo)
    log.warning("estado local previo apartado en %s", nuevo)
    return nuevo


class EstadoRemoto:
    def __init__(self, bucket: str, objeto: str = OBJETO_ESTADO, candado: str = OBJETO_CANDADO, cliente=None):
        if cliente is None:
            from google.cloud import storage

            cliente = storage.Client()
        self.bucket = cliente.bucket(bucket)
        self.objeto = objeto
        self.candado = candado
        self.uri = f"gs://{bucket}/{objeto}"
        self.generacion = 0                 # 0 = el objeto todavía no existe (o no se bajó)
        self._gen_candado: int | None = None

    # ── candado ─────────────────────────────────────────────────────────
    def tomar(self, ttl_horas: float) -> dict:
        ahora = time.time()
        info = {"dueño": dueño(), "desde": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                "vence": ahora + ttl_horas * 3600,
                "vence_iso": dt.datetime.fromtimestamp(ahora + ttl_horas * 3600, dt.timezone.utc).isoformat(timespec="seconds")}
        for _ in range(2):
            blob = self.bucket.blob(self.candado)
            try:
                blob.upload_from_string(json.dumps(info, ensure_ascii=False), content_type="application/json",
                                        if_generation_match=0)
                self._gen_candado = blob.generation
                log.info("candado tomado · %s · vence %s", info["dueño"], info["vence_iso"])
                return info
            except PreconditionFailed:
                actual = self.bucket.get_blob(self.candado)
                if actual is None:
                    continue                                  # lo soltaron entre medio: otro intento
                datos = _json(actual)
                if float(datos.get("vence") or 0) > time.time():
                    raise Ocupado(f"otra corrida tiene el candado: {datos.get('dueño')} desde {datos.get('desde')} "
                                  f"(vence {datos.get('vence_iso')})") from None
                log.warning("candado vencido de %s (desde %s): lo tomo", datos.get("dueño"), datos.get("desde"))
                try:
                    actual.delete(if_generation_match=actual.generation)
                except (NotFound, PreconditionFailed):
                    pass
        raise Ocupado("no pude tomar el candado (otra corrida lo tomó al mismo tiempo)")

    def soltar(self) -> None:
        if self._gen_candado is None:
            return
        try:
            self.bucket.blob(self.candado).delete(if_generation_match=self._gen_candado)
            log.info("candado soltado")
        except (NotFound, PreconditionFailed):
            log.warning("el candado ya no era de esta corrida; no lo toco")
        self._gen_candado = None

    def ver_candado(self) -> dict | None:
        blob = self.bucket.get_blob(self.candado)
        return None if blob is None else {**_json(blob), "generacion": blob.generation}

    def forzar_soltar(self) -> bool:
        try:
            self.bucket.blob(self.candado).delete()
            return True
        except NotFound:
            return False

    # ── estado ──────────────────────────────────────────────────────────
    def info(self) -> dict | None:
        blob = self.bucket.get_blob(self.objeto)
        if blob is None:
            return None
        return {"generacion": blob.generation, "bytes": blob.size, "actualizado": str(blob.updated)}

    def bajar(self, destino: Path) -> bool:
        """GCS → `destino` (el estado local previo, si hay, se aparta). False si en GCS no hay estado."""
        blob = self.bucket.get_blob(self.objeto)
        if blob is None:
            self.generacion = 0
            return False
        destino.parent.mkdir(parents=True, exist_ok=True)
        tmp = destino.with_name(destino.name + ".bajando")
        blob.download_to_filename(str(tmp), if_generation_match=blob.generation)
        apartar(destino)
        tmp.replace(destino)
        self.generacion = blob.generation
        log.info("estado ← %s (gen %s, %.1f MB)", self.uri, blob.generation, (blob.size or 0) / 1e6)
        return True

    def subir(self, origen: Path, sanear=()) -> int:
        """Copia saneada de `origen` → GCS, sólo si nadie cambió el objeto desde la última generación
        conocida. Devuelve cuántos ítems se repusieron a `pending` en la copia."""
        with tempfile.TemporaryDirectory(prefix="vigia-estado-") as d:
            copia = Path(d) / "estado.sqlite"
            est = Estado(origen)
            try:
                repuestos = est.copia(copia, sanear)
            finally:
                est.close()
            blob = self.bucket.blob(self.objeto)
            try:
                blob.upload_from_filename(str(copia), content_type="application/vnd.sqlite3",
                                          if_generation_match=self.generacion, timeout=300)
            except PreconditionFailed:
                aparte = f"{self.objeto.rsplit('/', 1)[0]}/conflicto-{_ts()}.sqlite"
                self.bucket.blob(aparte).upload_from_filename(str(copia), content_type="application/vnd.sqlite3", timeout=300)
                raise Conflicto(f"{self.uri} cambió desde la generación {self.generacion}: no lo piso; "
                                f"esta copia quedó en gs://{self.bucket.name}/{aparte}") from None
            self.generacion = blob.generation
        return repuestos


def _json(blob) -> dict:
    try:
        return json.loads(blob.download_as_bytes().decode("utf-8"))
    except (ValueError, NotFound):
        return {}
