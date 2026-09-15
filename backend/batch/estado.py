"""Estado local de los lotes nocturnos en SQLite (`dataset/_batch/estado.sqlite`).

Tablas
  lotes(id, tipo[releases|records|documentos], desde, hasta, estado, creado, actualizado,
        total, ok, fallidos, nota)
  items(lote_id, clave, estado[pending|processing|completed|failed], intentos, sha256, bytes,
        ruta, error, meta, actualizado, subido_at)   PK (lote_id, clave)

API
  Estado(path).nuevo_lote(tipo, desde, hasta, nota=None) -> id
  agregar_items(lote_id, claves | {clave: meta})       idempotente (INSERT OR IGNORE)
  reclamar(lote_id, n, stale_min=30) -> [clave]        BEGIN IMMEDIATE: dos procesos no toman lo mismo
  marcar(lote_id, clave, estado, **campos)             failed → intentos += 1
  pendientes(lote_id) · resumen(lote_id) · items(lote_id, estado=None)
  claves_completadas(tipo) · sha_presente(sha256) · completado_por_meta(tipo, campo, valor)
  reponer_procesando(lote_id)

`reclamar` devuelve `pending`, `failed` con intentos < MAX_INTENTOS y `processing` cuya última
actualización es más vieja que `stale_min` (proceso muerto). `Ctrl+C` deja los ítems en
`processing`; el mismo comando los retoma (o `--reponer` los devuelve a `pending` ya).

Una instancia puede compartirse entre hilos: un RLock serializa cada transacción completa
(sqlite3 solo serializa llamadas sueltas, no un BEGIN…COMMIT que abarca varias).
"""

from __future__ import annotations

import contextlib
import datetime as dt
import json
import sqlite3
import threading
from pathlib import Path
from typing import Iterable

from . import BATCH_DIR

MAX_INTENTOS = 3
TIPOS = ("releases", "records", "documentos")
ESTADOS_ITEM = ("pending", "processing", "completed", "failed")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS lotes (
  id          TEXT PRIMARY KEY,
  tipo        TEXT NOT NULL,
  desde       TEXT,
  hasta       TEXT,
  estado      TEXT NOT NULL DEFAULT 'pending',
  creado      TEXT NOT NULL,
  actualizado TEXT NOT NULL,
  total       INTEGER NOT NULL DEFAULT 0,
  ok          INTEGER NOT NULL DEFAULT 0,
  fallidos    INTEGER NOT NULL DEFAULT 0,
  nota        TEXT
);
CREATE TABLE IF NOT EXISTS items (
  lote_id     TEXT NOT NULL REFERENCES lotes (id),
  clave       TEXT NOT NULL,
  estado      TEXT NOT NULL DEFAULT 'pending',
  intentos    INTEGER NOT NULL DEFAULT 0,
  sha256      TEXT,
  bytes       INTEGER,
  ruta        TEXT,
  error       TEXT,
  meta        TEXT,
  actualizado TEXT NOT NULL,
  subido_at   TEXT,
  PRIMARY KEY (lote_id, clave)
);
CREATE INDEX IF NOT EXISTS items_estado_idx ON items (lote_id, estado);
CREATE INDEX IF NOT EXISTS items_clave_idx  ON items (clave);
CREATE INDEX IF NOT EXISTS items_sha_idx    ON items (sha256);
"""


def _ahora() -> str:
    return dt.datetime.now().isoformat(timespec="seconds")


class Estado:
    def __init__(self, path: Path | str | None = None):
        self.path = Path(path) if path else BATCH_DIR / "estado.sqlite"
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self.con = sqlite3.connect(str(self.path), timeout=60, isolation_level=None, check_same_thread=False)
        self.con.row_factory = sqlite3.Row
        self.con.execute("PRAGMA journal_mode=WAL")
        self.con.execute("PRAGMA synchronous=NORMAL")
        self.con.executescript(_SCHEMA)

    def close(self) -> None:
        with self._lock:
            self.con.close()

    def __enter__(self) -> "Estado":
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    # ── acceso serializado ──────────────────────────────────────────────
    def _q(self, sql: str, args: tuple = ()) -> list[sqlite3.Row]:
        with self._lock:
            return self.con.execute(sql, args).fetchall()

    def _uno(self, sql: str, args: tuple = ()) -> sqlite3.Row | None:
        rows = self._q(sql, args)
        return rows[0] if rows else None

    @contextlib.contextmanager
    def _tx(self):
        """BEGIN IMMEDIATE / COMMIT / ROLLBACK bajo el lock (el conector está en autocommit)."""
        with self._lock:
            self.con.execute("BEGIN IMMEDIATE")
            try:
                yield
            except BaseException:
                self.con.execute("ROLLBACK")
                raise
            self.con.execute("COMMIT")

    # ── lotes ───────────────────────────────────────────────────────────
    def nuevo_lote(self, tipo: str, desde: str | None = None, hasta: str | None = None, nota: str | None = None) -> str:
        if tipo not in TIPOS:
            raise ValueError(f"tipo inválido: {tipo!r} (esperado {TIPOS})")
        base = f"{tipo}-{dt.datetime.now():%Y%m%d-%H%M%S}"
        with self._tx():
            lote_id, k = base, 1
            while self._uno("SELECT 1 FROM lotes WHERE id = ?", (lote_id,)) is not None:   # dos lotes en el mismo segundo
                k += 1
                lote_id = f"{base}-{k}"
            self.con.execute(
                "INSERT INTO lotes (id, tipo, desde, hasta, estado, creado, actualizado, nota) VALUES (?,?,?,?,?,?,?,?)",
                (lote_id, tipo, desde, hasta, "pending", _ahora(), _ahora(), nota))
        return lote_id

    def lote(self, lote_id: str) -> dict | None:
        r = self._uno("SELECT * FROM lotes WHERE id = ?", (lote_id,))
        return dict(r) if r else None

    def lotes(self, tipo: str | None = None) -> list[dict]:
        q = "SELECT * FROM lotes" + (" WHERE tipo = ?" if tipo else "") + " ORDER BY creado"
        return [dict(r) for r in self._q(q, (tipo,) if tipo else ())]

    def actualizar_lote(self, lote_id: str, **campos) -> None:
        if not campos:
            return
        cols = ", ".join(f"{k} = ?" for k in campos)
        with self._tx():
            self.con.execute(f"UPDATE lotes SET {cols}, actualizado = ? WHERE id = ?", (*campos.values(), _ahora(), lote_id))

    # ── items ───────────────────────────────────────────────────────────
    def agregar_items(self, lote_id: str, claves: Iterable[str] | dict[str, dict]) -> int:
        """Añade ítems `pending` (ignora los que ya existen). Acepta lista de claves o {clave: meta}."""
        if isinstance(claves, dict):
            filas = [(lote_id, c, json.dumps(m, ensure_ascii=False) if m is not None else None, _ahora()) for c, m in claves.items()]
        else:
            filas = [(lote_id, c, None, _ahora()) for c in claves]
        with self._tx():
            cur = self.con.executemany(
                "INSERT OR IGNORE INTO items (lote_id, clave, meta, actualizado) VALUES (?,?,?,?)", filas)
            n = cur.rowcount if cur.rowcount is not None and cur.rowcount >= 0 else 0
            self._recontar(lote_id)
        return n

    def reclamar(self, lote_id: str, n: int, stale_min: int = 30) -> list[str]:
        """Toma hasta `n` ítems y los pasa a `processing` de forma atómica (BEGIN IMMEDIATE)."""
        limite = (dt.datetime.now() - dt.timedelta(minutes=stale_min)).isoformat(timespec="seconds")
        with self._tx():
            rows = self.con.execute(
                """SELECT clave FROM items
                    WHERE lote_id = ?
                      AND (estado = 'pending'
                           OR (estado = 'failed' AND intentos < ?)
                           OR (estado = 'processing' AND actualizado < ?))
                    ORDER BY estado = 'pending' DESC, clave LIMIT ?""",
                (lote_id, MAX_INTENTOS, limite, n)).fetchall()
            claves = [r["clave"] for r in rows]
            if claves:
                self.con.executemany(
                    "UPDATE items SET estado = 'processing', actualizado = ? WHERE lote_id = ? AND clave = ?",
                    [(_ahora(), lote_id, c) for c in claves])
                self.con.execute(
                    "UPDATE lotes SET estado = 'processing', actualizado = ? WHERE id = ? AND estado <> 'completed'",
                    (_ahora(), lote_id))
        return claves

    def marcar(self, lote_id: str, clave: str, estado: str, **campos) -> None:
        if estado not in ESTADOS_ITEM:
            raise ValueError(f"estado inválido: {estado!r}")
        if "meta" in campos and not isinstance(campos["meta"], (str, type(None))):
            campos["meta"] = json.dumps(campos["meta"], ensure_ascii=False)
        if estado == "completed":
            campos.setdefault("error", None)
        sets = ["estado = ?", "actualizado = ?"] + [f"{k} = ?" for k in campos]
        vals = [estado, _ahora(), *campos.values()]
        if estado == "failed":
            sets.append("intentos = intentos + 1")
        with self._tx():
            self.con.execute(f"UPDATE items SET {', '.join(sets)} WHERE lote_id = ? AND clave = ?", (*vals, lote_id, clave))
            self._recontar(lote_id)

    def item(self, lote_id: str, clave: str) -> dict | None:
        r = self._uno("SELECT * FROM items WHERE lote_id = ? AND clave = ?", (lote_id, clave))
        return self._fila(r) if r else None

    def items(self, lote_id: str, estado: str | None = None) -> list[dict]:
        q = "SELECT * FROM items WHERE lote_id = ?" + (" AND estado = ?" if estado else "") + " ORDER BY clave"
        args = (lote_id, estado) if estado else (lote_id,)
        return [self._fila(r) for r in self._q(q, args)]

    def pendientes(self, lote_id: str) -> list[str]:
        """Claves que aún pueden intentarse (pending, processing, failed con intentos < máx)."""
        rows = self._q(
            """SELECT clave FROM items WHERE lote_id = ?
                  AND (estado IN ('pending','processing') OR (estado = 'failed' AND intentos < ?)) ORDER BY clave""",
            (lote_id, MAX_INTENTOS))
        return [r["clave"] for r in rows]

    def resumen(self, lote_id: str) -> dict:
        rows = self._q(
            "SELECT estado, count(*) AS n, COALESCE(sum(bytes),0) AS b FROM items WHERE lote_id = ? GROUP BY estado",
            (lote_id,))
        out = {e: 0 for e in ESTADOS_ITEM}
        out["total"] = 0
        out["bytes"] = 0
        for r in rows:
            out[r["estado"]] = r["n"]
            out["total"] += r["n"]
            out["bytes"] += r["b"] or 0
        out["agotados"] = self._uno(
            "SELECT count(*) FROM items WHERE lote_id = ? AND estado = 'failed' AND intentos >= ?",
            (lote_id, MAX_INTENTOS))[0]
        out["subidos"] = self._uno(
            "SELECT count(*) FROM items WHERE lote_id = ? AND subido_at IS NOT NULL", (lote_id,))[0]
        return out

    def reponer_procesando(self, lote_id: str) -> int:
        with self._tx():
            cur = self.con.execute(
                "UPDATE items SET estado = 'pending', actualizado = ? WHERE lote_id = ? AND estado = 'processing'",
                (_ahora(), lote_id))
            return cur.rowcount or 0

    # ── consultas cruzadas (dedup entre lotes) ──────────────────────────
    def claves_completadas(self, tipo: str) -> set[str]:
        rows = self._q(
            "SELECT i.clave FROM items i JOIN lotes l ON l.id = i.lote_id WHERE l.tipo = ? AND i.estado = 'completed'",
            (tipo,))
        return {r["clave"] for r in rows}

    def completado_por_clave(self, tipo: str, clave: str) -> dict | None:
        r = self._uno(
            """SELECT i.* FROM items i JOIN lotes l ON l.id = i.lote_id
                WHERE l.tipo = ? AND i.clave = ? AND i.estado = 'completed' ORDER BY i.actualizado DESC LIMIT 1""",
            (tipo, clave))
        return self._fila(r) if r else None

    def sha_presente(self, sha256: str) -> dict | None:
        r = self._uno(
            "SELECT * FROM items WHERE sha256 = ? AND estado = 'completed' ORDER BY actualizado LIMIT 1", (sha256,))
        return self._fila(r) if r else None

    def completado_por_meta(self, tipo: str, campo: str, valor: str) -> dict | None:
        """Busca un ítem completado cuyo `meta` JSON tenga campo == valor (p. ej. url de un documento)."""
        r = self._uno(
            """SELECT i.* FROM items i JOIN lotes l ON l.id = i.lote_id
                WHERE l.tipo = ? AND i.estado = 'completed' AND json_extract(i.meta, ?) = ? LIMIT 1""",
            (tipo, f"$.{campo}", valor))
        return self._fila(r) if r else None

    # ── internos ────────────────────────────────────────────────────────
    def _recontar(self, lote_id: str) -> None:
        """Se llama dentro de una transacción abierta."""
        r = self.con.execute(
            """SELECT count(*) AS total,
                      sum(estado = 'completed') AS ok,
                      sum(estado = 'failed' AND intentos >= ?) AS fallidos,
                      sum(estado IN ('pending','processing') OR (estado = 'failed' AND intentos < ?)) AS abiertos
                 FROM items WHERE lote_id = ?""", (MAX_INTENTOS, MAX_INTENTOS, lote_id)).fetchone()
        total, ok, fallidos, abiertos = r["total"], r["ok"] or 0, r["fallidos"] or 0, r["abiertos"] or 0
        estado = "completed" if total and not abiertos else ("processing" if ok or fallidos else "pending")
        self.con.execute("UPDATE lotes SET total = ?, ok = ?, fallidos = ?, estado = ?, actualizado = ? WHERE id = ?",
                         (total, ok, fallidos, estado, _ahora(), lote_id))

    @staticmethod
    def _fila(r: sqlite3.Row) -> dict:
        d = dict(r)
        if d.get("meta"):
            try:
                d["meta"] = json.loads(d["meta"])
            except ValueError:
                pass
        return d


def abrir(path: Path | str | None = None) -> Estado:
    return Estado(path)
