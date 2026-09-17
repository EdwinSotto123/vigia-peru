"""Registro de cargas en `datasets_cargas` (migración 23_datasets.sql).

Cada pipeline que parte sus datos en claves (periodo AAAA-MM, proceso electoral, región)
consulta `ya_cargado(fuente, clave, sha256)` antes de cargar y llama `registrar(...)` al
terminar. Así:
  · el cron mensual es idempotente: un XLSX cuyo sha256 ya está cargado no se vuelve a insertar;
  · si la fuente republica el archivo (sha256 distinto) se reemplaza el periodo completo;
  · /admin/cobertura lee `datasets_cobertura` (vista) sin tocar cada tabla.

Sin dependencias fuera de psycopg2; recibe la conexión abierta por el pipeline.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Carga:
    fuente: str
    clave: str
    sha256: str
    tabla: str | None = None
    archivo: str | None = None
    gcs_uri: str | None = None
    bytes: int | None = None
    filas: int | None = None
    fuente_url: str | None = None
    descargado_at: dt.datetime | None = None
    estado: str = "ok"
    error: str | None = None


def ya_cargado(cur, fuente: str, clave: str, sha256: str) -> bool:
    """True si esa clave ya se cargó con ese mismo sha256 y sin error."""
    cur.execute(
        "SELECT 1 FROM datasets_cargas WHERE fuente=%s AND clave=%s AND sha256=%s AND estado='ok'",
        (fuente, clave, sha256),
    )
    return cur.fetchone() is not None


def registrar(cur, c: Carga) -> None:
    cur.execute(
        """INSERT INTO datasets_cargas (fuente, clave, tabla, archivo, gcs_uri, sha256, bytes, filas,
                                        fuente_url, descargado_at, cargado_at, estado, error)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,now(),%s,%s)
           ON CONFLICT (fuente, clave) DO UPDATE SET
             tabla=EXCLUDED.tabla, archivo=EXCLUDED.archivo, gcs_uri=EXCLUDED.gcs_uri,
             sha256=EXCLUDED.sha256, bytes=EXCLUDED.bytes, filas=EXCLUDED.filas,
             fuente_url=EXCLUDED.fuente_url, descargado_at=EXCLUDED.descargado_at,
             cargado_at=now(), estado=EXCLUDED.estado, error=EXCLUDED.error""",
        (c.fuente, c.clave, c.tabla, c.archivo, c.gcs_uri, c.sha256, c.bytes, c.filas,
         c.fuente_url, c.descargado_at, c.estado, c.error),
    )


def carga_desde_archivo(fuente: str, clave: str, path: Path, sha256: str, **kw) -> Carga:
    st = path.stat()
    return Carga(
        fuente=fuente, clave=clave, sha256=sha256, archivo=path.name, bytes=st.st_size,
        descargado_at=dt.datetime.fromtimestamp(st.st_mtime).astimezone(), **kw,
    )
