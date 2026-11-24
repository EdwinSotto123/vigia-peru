#!/usr/bin/env python3
"""LECTURA PREVIA: el texto COMPLETO de cada documento de un contrato antes de analizarlo, con sus páginas escaneadas
transcritas, y guardado donde el análisis lo toma (documentos_texto, version_parser del agente).

  python -X utf8 backend/scripts/lectura_previa.py prod 1231921
  python -X utf8 backend/scripts/lectura_previa.py prod --archivo ocids.txt --hilos 2 --tope-usd 5
  python -X utf8 backend/scripts/lectura_previa.py prod --medir 1231921        # qué falta, sin leer nada

Por qué (2026-11-24): el OCR corría DENTRO del análisis (una Lambda de 900 s) y con el límite de uso de Workers AI lleno
se perdía: en 7 días, 4 143 de 4 684 análisis perdieron parte de sus documentos y 3 387 terminaron con uno o ningún
ítem. En 1231921 el requerimiento (~40 ítems) estaba escaneado dentro del Word de un RAR: 26 páginas a ~18 s cada una
no caben en el tiempo del análisis. Aquí no hay apuro: cada página escaneada se transcribe con reintentos y sin tope de
páginas, y el análisis encuentra el texto hecho (no vuelve a hacer OCR).

Usa el MISMO código del agente para abrir los contenedores (ZIP, RAR, Word con sus imágenes, Excel) y transcribir
(tools/documentos: `_expandir_contenedor`, `_texto_de_unidades`), con el modelo abierto de visión por vigia-llm. Sólo
guarda un documento si TODAS sus páginas quedaron leídas; si no, lo dice y lo deja para la próxima pasada.
El gasto (estimado por tokens) se anota en el libro del masivo como «lectura previa».
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "backend"))
sys.path.insert(0, str(RAIZ / "backend" / "agent"))
sys.path.insert(0, str(RAIZ / "infrastructure" / "aws"))

# El agente con el modelo abierto por vigia-llm (nunca Vertex/Gemini) y un OCR sin apuro ni tope de páginas.
os.environ.setdefault("LLM_BACKEND", "compatible")
os.environ.setdefault("LLM_COMPAT_URL", "https://vigia-llm.vigiaperu.workers.dev/v1")
os.environ.setdefault("LLM_COMPAT_MODEL", "@cf/deepseek-ai/deepseek-v4.1-flash-1017")
os.environ.setdefault("OCR_MAX_PAGINAS", "400")
os.environ.setdefault("OCR_BUDGET_S", "3600")
os.environ.setdefault("OCR_PARALELO", "2")
os.environ.setdefault("PARSE_UNIT_WORKERS", "1")
os.environ.setdefault("PGHOST", "no-se-usa")          # el agente no abre su conexión: aquí se escribe con el túnel
os.environ.setdefault("DOCAI_ENABLED", "0")

from lector.base import bajar_r2, ssm  # noqa: E402
from tunel_rds import conexion  # noqa: E402

os.environ.setdefault("LLM_COMPAT_TOKEN", ssm("/vigia/llm/token"))

import subprocess  # noqa: E402
import tempfile  # noqa: E402

from tools.documentos import contenedores as _cont  # noqa: E402
from tools.documentos._base import VERSION_PARSER  # noqa: E402
from tools.documentos.contenedores import _expandir_contenedor  # noqa: E402

_TAR_WINDOWS = Path(r"C:\Windows\System32\tar.exe")


def _leer_rar_con_tar(blob: bytes) -> list[tuple[str, bytes]]:
    """En Windows, `rarfile` con el tar del sistema no lee el contenido («Failed the read enough data»): el RAR se extrae
    con tar.exe (libarchive, que no escribe fuera de la carpeta) a una carpeta temporal y se leen sus archivos. En la
    Lambda (Linux) sigue el `rarfile` del agente con unar."""
    with tempfile.TemporaryDirectory() as d:
        arch, dest = Path(d) / "x.rar", Path(d) / "x"
        arch.write_bytes(blob)
        dest.mkdir()
        subprocess.run([str(_TAR_WINDOWS), "-xf", str(arch), "-C", str(dest)], check=True, capture_output=True, timeout=300)
        return [(f.relative_to(dest).as_posix(), f.read_bytes()) for f in sorted(dest.rglob("*")) if f.is_file()]


if os.name == "nt" and _TAR_WINDOWS.exists():
    _cont._leer_rar = _leer_rar_con_tar
from tools.documentos.ocr_texto import _ocr_fallido, _texto_de_unidades  # noqa: E402

# Precio de lista de DeepSeek v4.1 flash en Workers AI (US$ por millón de tokens), para el estimado del gasto.
USD_IN, USD_OUT = 0.27, 1.10
TOKENS_POR_IMAGEN = 1600

DOCS_SQL = """SELECT sha256, url_gcs, formato, titulo FROM documentos_gcs
               WHERE ocid = %s AND borrado_at IS NULL AND url_gcs IS NOT NULL AND sha256 IS NOT NULL
               ORDER BY (tipo = 'biddingDocuments') DESC, bytes"""
HECHO_SQL = """SELECT 1 FROM documentos_texto WHERE sha256 = %s AND version_parser = %s
                 AND NOT (COALESCE(recortes::text, '') LIKE '%%ocr_gemini_vision%%')"""
GUARDAR_SQL = """INSERT INTO documentos_texto (sha256, ocid, url_gcs, formato, n_paginas, motor, version_parser, texto, paginas,
                                               truncado, recortes, actualizado_at)
                 VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s::jsonb, now())
                 ON CONFLICT (sha256) DO UPDATE SET
                   ocid = COALESCE(EXCLUDED.ocid, documentos_texto.ocid), url_gcs = COALESCE(EXCLUDED.url_gcs, documentos_texto.url_gcs),
                   formato = EXCLUDED.formato, n_paginas = EXCLUDED.n_paginas, motor = EXCLUDED.motor,
                   version_parser = EXCLUDED.version_parser, texto = EXCLUDED.texto, paginas = EXCLUDED.paginas,
                   truncado = EXCLUDED.truncado, recortes = EXCLUDED.recortes, extraccion = NULL, actualizado_at = now()"""

_lock = threading.Lock()
_db: dict = {}


def base(fn):
    with _lock:
        if "cn" not in _db:
            _db["cm"] = conexion(_db["entorno"])
            _db["cn"] = _db["cm"].__enter__()
        cn = _db["cn"]
        with cn.cursor() as cur:
            r = fn(cur)
        cn.commit()
        return r


def log(m: str) -> None:
    print(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {m}", flush=True)


def leer_doc(ocid: str, sha: str, url: str, formato: str, titulo: str, medir: bool) -> dict:
    if base(lambda c: (c.execute(HECHO_SQL, (sha, VERSION_PARSER)), c.fetchone())[1]):
        return {"estado": "ya_leido"}
    if medir:
        return {"estado": "falta"}
    t0 = time.monotonic()
    blob = bajar_r2(url)
    unidades, recortes = _expandir_contenedor(blob, titulo or url, None)
    if not unidades:
        return {"estado": "sin_contenido", "recortes": recortes}
    tx = _texto_de_unidades(unidades, time.monotonic() + float(os.environ["OCR_BUDGET_S"]))
    tx["recortes"] = list(recortes) + list(tx.get("recortes") or [])
    ocr = [p for p in tx["paginas"] if p.get("ocr")]
    usd = len(ocr) * TOKENS_POR_IMAGEN * USD_IN / 1e6 + sum(len(p.get("texto") or "") for p in ocr) / 3.5 * USD_OUT / 1e6
    if _ocr_fallido(tx["recortes"]) or tx.get("truncado"):
        return {"estado": "incompleto", "paginas": tx["n_paginas"], "ocr": len(ocr), "usd": usd, "segundos": time.monotonic() - t0,
                "recortes": [r for r in tx["recortes"] if "ocr" in str(r.get("donde"))][:3]}
    base(lambda c: c.execute(GUARDAR_SQL, (sha, ocid, url, formato, tx["n_paginas"], tx["motor"], VERSION_PARSER, tx["texto"],
                                           json.dumps(tx["paginas"], ensure_ascii=False), False,
                                           json.dumps(tx["recortes"], ensure_ascii=False))))
    return {"estado": "leido", "paginas": tx["n_paginas"], "ocr": len(ocr), "chars": sum(p.get("chars") or 0 for p in tx["paginas"]),
            "usd": usd, "segundos": time.monotonic() - t0}


def main() -> None:
    ap = argparse.ArgumentParser(description="Lectura previa (texto completo, con OCR de lo escaneado) de los documentos de unos contratos.")
    ap.add_argument("entorno", choices=["prod"])
    ap.add_argument("ocids", nargs="*")
    ap.add_argument("--archivo")
    ap.add_argument("--hilos", type=int, default=1, help="contratos a la vez (cada uno hace OCR con OCR_PARALELO lotes)")
    ap.add_argument("--tope-usd", type=float, default=5.0)
    ap.add_argument("--medir", action="store_true", help="sólo dice qué documentos faltan")
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    _db["entorno"] = a.entorno
    ocids = list(dict.fromkeys(a.ocids + ([x.strip() for x in Path(a.archivo).read_text(encoding="utf-8").splitlines() if x.strip()]
                                          if a.archivo else [])))
    total = {"usd": 0.0, "leidos": 0, "incompletos": 0, "ya": 0, "paginas_ocr": 0, "contratos_completos": 0}

    def uno(ocid: str) -> None:
        docs = base(lambda c: (c.execute(DOCS_SQL, (ocid,)), c.fetchall())[1])
        completo = True
        for sha, url, formato, titulo in docs:
            with _lock:
                if total["usd"] >= a.tope_usd:
                    log(f"[--] tope de US$ {a.tope_usd} alcanzado")
                    return
            try:
                r = leer_doc(ocid, sha, url, formato, titulo, a.medir)
            except Exception as e:  # noqa: BLE001
                r = {"estado": "error", "error": f"{type(e).__name__}: {str(e)[:150]}"}
            with _lock:
                total["usd"] += r.get("usd") or 0.0
                total["paginas_ocr"] += r.get("ocr") or 0
                total["leidos" if r["estado"] == "leido" else "ya" if r["estado"] == "ya_leido" else "incompletos"] += 1
            if r["estado"] not in ("leido", "ya_leido"):
                completo = False
            if r["estado"] != "ya_leido":
                log(f"[{r['estado']:>11}] {ocid} {sha[:8]} {formato} «{(titulo or '')[:40]}» "
                    + " ".join(f"{k}={round(v, 4) if isinstance(v, float) else v}" for k, v in r.items() if k not in ("estado",)))
        with _lock:
            total["contratos_completos"] += int(completo)
        log(f"[{'COMPLETO' if completo else 'FALTA'}] {ocid}: {len(docs)} documentos")

    try:
        with ThreadPoolExecutor(max(1, a.hilos)) as ex:
            list(ex.map(uno, ocids))
    finally:
        if total["usd"] > 0:
            try:
                base(lambda c: c.execute(
                    "INSERT INTO agente_masivo (red, estado, costo, motivo, origen, terminado_en) VALUES ('externo', 'externo', %s, %s, %s, now())",
                    (round(total["usd"], 4), f"lectura previa: OCR de {total['paginas_ocr']} páginas escaneadas (estimado por tokens)",
                     f"lectura-previa-{time.strftime('%Y%m%d-%H%M')}")))
            except Exception as e:  # noqa: BLE001
                log(f"[EXC] no pude anotar el gasto: {str(e)[:120]}")
        log(f"fin: {total}")
        if _db.get("cm") is not None:
            try:
                _db["cm"].__exit__(None, None, None)
            except Exception:  # noqa: BLE001
                pass


if __name__ == "__main__":
    main()
