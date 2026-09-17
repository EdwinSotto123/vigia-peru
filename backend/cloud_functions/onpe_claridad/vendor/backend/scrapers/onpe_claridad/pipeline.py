"""ONPE Claridad — aportes a organizaciones políticas → `onpe_aportantes`.

Cómo funciona el portal (verificado 2026-09-16 con navegador real desde IP peruana):
  · Frontend Next.js en https://claridadportal.onpe.gob.pe (Cloudflare: el challenge JS pasa
    solo con Chromium **con ventana**; a `requests`, `curl` y a `page.request` les devuelve
    403 "Just a moment…"; con headless también suele quedarse en el challenge).
  · Backend JSON en https://claridad.onpe.gob.pe/claridad-backend/portal/… (también detrás de
    Cloudflare). Los endpoints de consulta exigen un token reCAPTCHA v3 (site key pública,
    acción "submit") que el propio frontend genera con `grecaptcha.execute` → lo generamos
    igual, **dentro de la página**, y hacemos `fetch` desde el mismo origen. No hay login.
  · Módulo "Consulta de aportantes" (/consulta-aportante):
      POST consult/org/find          {filters:[{code:"op",value:""}]}   → todas las (organización, proceso)
                                     con RUC y totales; procesos: ERM2018, ECE2020, EG2021, ERM2022,
                                     EMC*, EG2026 (234 pares el 2026-09-16)
      POST consult/org/find-detail   {ruc, opEqual, process, yearApo}  → lista de aportantes con
                                     apellidos, nombres/razón social, **DNI o RUC completos**,
                                     tipoAporte (F efectivo / E especie), fechaAporte, monto
                                     (paginado 1-based; size=500 funciona)
      POST consult/org/find-ifa / find-detail-ifa → lo mismo para la Información Financiera
                                     Anual (aportes al partido fuera de campaña, IFA2019…IFA2024)
      POST consult/candidate/find-lastname {filters:[{code:"candidato",value:""}]} → padrón de
                                     37 496 candidatos (2026-09-16) con DNI, organización,
                                     departamento y proceso → tabla onpe_candidatos (sirve para
                                     ponerle DNI a jne_autoridades, que el JNE publica sin documento)
    En la web la tabla muestra el documento completo; en la DB se guarda completo y el
    frontend de Vigía lo enmascara (Redact.tsx).

Estrategia del pipeline:
  1. fetch(): abre el portal (headed), enumera (org, proceso) y baja el detalle completo de
     cada par a un JSON crudo en dataset/_raw/onpe_claridad/<proceso>/<ruc>__<org>.json
     (+ GCS raw/onpe_claridad/<proceso>/…). Pausa 1-2 s entre llamadas.
  2. load(): normaliza cada JSON → onpe_aportantes (reemplazo por (proceso, organización);
     `aporte_clave` = hash estable de la fila para no duplicar) y registra en datasets_cargas
     (clave "<proceso>/<ruc>/<org>", sha256 del JSON).

  python -m backend.scrapers.onpe_claridad.pipeline --proceso EG2021 --proceso ERM2022 --proceso EG2026
  python -m backend.scrapers.onpe_claridad.pipeline --ifa                   # además, aportes anuales
  python -m backend.scrapers.onpe_claridad.pipeline --candidatos            # padrón de candidatos con DNI → onpe_candidatos
  python -m backend.scrapers.onpe_claridad.pipeline --json-dir dataset/_raw/onpe_claridad --fetch-none
  python -m backend.scrapers.onpe_claridad.pipeline --csv dataset/lista_aportantes/lista-aportantes.csv
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import re
import time
import unicodedata
from pathlib import Path

from .._core.pipeline import Pipeline, log, pg_dsn, run_loader
from .._core.registro import Carga, registrar, ya_cargado
from .._core.storage import RAW_ROOT, sha256_of

PORTAL_URL = "https://claridadportal.onpe.gob.pe/consulta-aportante"
BACKEND = "https://claridad.onpe.gob.pe/claridad-backend/portal/"
SITEKEY = "6Lf6p1UtAAAAACYJTSj2fVJhFIYrjduWSWWajOXp"   # reCAPTCHA v3 público del portal
PAGE_SIZE = 500
PAUSA = (1.0, 2.0)
TIPO_APORTE = {"F": "efectivo", "E": "especie", "A": "actividad", "O": "otros"}

_JS_CALL = """
async ([sitekey, action, url, body]) => {
  let token;
  try { token = await grecaptcha.execute(sitekey, {action}); } catch (e) { return [0, 'recaptcha: ' + e]; }
  body.token = token;
  try {
    const r = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});
    return [r.status, await r.text()];
  } catch (e) { return [-1, 'fetch: ' + e]; }
}"""


def slug(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:80]


def norm(s: str | None) -> str:
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return " ".join(s.upper().split())


def _fecha(s: str | None) -> dt.date | None:
    for fmt in ("%d/%m/%Y", "%Y-%m-%d"):
        try:
            return dt.datetime.strptime((s or "").strip(), fmt).date()
        except ValueError:
            pass
    return None


# ── normalización (pura, testeable con fixture) ─────────────────────────────────────────
def normalize_detail(doc: dict) -> list[dict]:
    """JSON crudo de find-detail(-ifa) (con la metadata que agrega fetch) → filas onpe_aportantes."""
    proceso = doc["proceso"]
    org = doc["organizacion"]
    ruc_org = doc.get("ruc")
    rows: list[dict] = []
    for a in doc.get("aportantes") or []:
        docn = (a.get("dni") or "").strip()
        razon = (a.get("razonSocial") or "").strip()
        apellidos = (a.get("apellidos") or "").strip()
        nombres = (a.get("nombres") or "").strip()
        if razon and razon.upper() != "N/A":
            nombre_orig = razon
        else:
            nombre_orig = " ".join(x for x in (apellidos, nombres) if x)
        if not nombre_orig and not docn:
            continue
        fecha = _fecha(a.get("fechaAporte"))
        monto = a.get("monto")
        tipo = TIPO_APORTE.get((a.get("tipoAporte") or "").strip().upper(), (a.get("tipoAporte") or None))
        anio = fecha.year if fecha else (int(a["anioEleccion"]) if str(a.get("anioEleccion") or "").isdigit() else None)
        clave = hashlib.sha1("|".join([
            proceso, ruc_org or "", org, docn, nombre_orig, a.get("fechaAporte") or "", f"{monto}", a.get("tipoAporte") or "",
        ]).encode()).hexdigest()
        rows.append({
            "numero_documento": docn if docn.isdigit() and len(docn) in (8, 11) else (docn or None),
            "nombre": norm(nombre_orig) or (docn or ""),
            "nombre_original": nombre_orig or None,
            "partido": org,
            "año": anio,
            "fecha_aporte": fecha,
            "monto": monto,
            "tipo_aporte": tipo,
            "nivel": "anual" if proceso.startswith("IFA") else "campaña",
            "fuente": "ONPE_Claridad",
            "fuente_url": PORTAL_URL,
            "proceso": proceso,
            "ruc_organizacion": ruc_org,
            "tipo_receptor": "organizacion",
            "receptor": None,
            "aporte_clave": clave,
        })
    return rows


COLS = ["numero_documento", "nombre", "nombre_original", "partido", "año", "fecha_aporte", "monto",
        "tipo_aporte", "nivel", "fuente", "fuente_url", "proceso", "ruc_organizacion", "tipo_receptor",
        "receptor", "aporte_clave"]


class ClaridadPipeline(Pipeline):
    name = "onpe_claridad"
    description = "ONPE Claridad (Playwright + API interna) — aportantes por proceso → onpe_aportantes"
    schedule = "mensual (en campaña, semanal): los partidos rinden por entregas"

    def __init__(self, **kw):
        super().__init__(**kw)
        self.procesos: list[str] = []
        self.headed = True
        self.ifa = False
        self.manual_csv: Path | None = None
        self.json_dir: Path | None = None
        self.max_orgs: int | None = None
        self.channel: str | None = None
        self.candidatos = False

    @classmethod
    def add_arguments(cls, ap: argparse.ArgumentParser) -> None:
        ap.add_argument("--proceso", action="append", default=[], help="EG2021, ERM2022, EG2026… (repetible; vacío = todos los de campaña)")
        ap.add_argument("--ifa", action="store_true", help="incluir Información Financiera Anual (IFA2019…)")
        ap.add_argument("--candidatos", action="store_true", help="bajar el padrón de candidatos con DNI → onpe_candidatos (y nada más)")
        ap.add_argument("--headless", action="store_true", help="intentar sin ventana (Cloudflare suele bloquear)")
        ap.add_argument("--channel", default=None, help="'chrome' para usar el Chrome instalado en vez del Chromium de Playwright")
        ap.add_argument("--max-orgs", type=int, default=None, help="tope de (org, proceso) a bajar (pruebas)")
        ap.add_argument("--json-dir", type=Path, default=None, help="cargar los JSON ya bajados en esta carpeta sin abrir el navegador")
        ap.add_argument("--csv", type=Path, default=None, help="cargar un CSV exportado a mano (formato antiguo de Claridad)")

    def configure(self, args: argparse.Namespace) -> None:
        self.procesos = [p.strip().upper() for p in args.proceso]
        self.headed = not args.headless
        self.ifa = args.ifa
        self.candidatos = args.candidatos
        self.manual_csv = args.csv
        self.json_dir = args.json_dir
        self.max_orgs = args.max_orgs
        self.channel = args.channel

    # ── fetch ────────────────────────────────────────────────────────────────────────
    def fetch(self) -> list[Path]:
        if self.manual_csv:
            return [self.manual_csv]
        if self.json_dir:
            return sorted(p for p in self.json_dir.rglob("*.json") if p.name != "manifest.json")
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            raise SystemExit("pip install playwright && python -m playwright install chromium")

        paths: list[Path] = []
        with sync_playwright() as pw:
            kw = {"headless": not self.headed}
            if self.channel:
                kw["channel"] = self.channel
            browser = pw.chromium.launch(**kw)
            ctx = browser.new_context(locale="es-PE", viewport={"width": 1400, "height": 900})
            page = ctx.new_page()
            page.goto(PORTAL_URL, wait_until="domcontentloaded", timeout=90_000)
            if not self._wait_cloudflare(page):
                raise RuntimeError("Cloudflare no dejó pasar (título sigue en 'Un momento…'); probar con ventana / --channel chrome")
            time.sleep(5)  # que cargue grecaptcha

            if self.candidatos:
                paths.append(self._fetch_candidatos(page))
                browser.close()
                return paths

            pares = self._listar(page, "consult/org/find")
            if self.ifa:
                pares += self._listar(page, "consult/org/find-ifa")
            if self.procesos:
                pares = [x for x in pares if x["proceso"].replace(" ", "").upper() in {p.replace(" ", "") for p in self.procesos}]
            if self.max_orgs:
                pares = pares[: self.max_orgs]
            log.info("   %d pares (organización, proceso) a bajar", len(pares))

            fallidos: list[str] = []
            for i, x in enumerate(pares, 1):
                proceso = x["proceso"].replace(" ", "")
                detail_path = "consult/org/find-detail-ifa" if proceso.startswith("IFA") else "consult/org/find-detail"
                dest = self.store.dir / proceso / f"{x['ruc'] or 'sin-ruc'}__{slug(x['organizacion'])}.json"
                if dest.exists() and not self.force:
                    # Reanudable: el JSON de una corrida anterior se conserva (la carga decide por sha256).
                    paths.append(dest)
                    continue
                try:
                    aportantes, declarado = self._detalle(page, detail_path, x)
                except RuntimeError as e:
                    # El backend devuelve 500 "Ocurrió un error inesperado" para algunas parejas
                    # (p. ej. FUERZA POPULAR · IFA2020…): se anota y se sigue con las demás.
                    log.warning("   [%d/%d] %s · %s: %s — se omite", i, len(pares), proceso, x["organizacion"][:50], e)
                    fallidos.append(f"{proceso} · {x['organizacion']}")
                    continue
                doc = {
                    "fuente": "ONPE Claridad · consulta de aportantes", "endpoint": BACKEND + detail_path,
                    "filters": {"ruc": x["ruc"], "opEqual": x["organizacion"], "process": x["proceso"]},
                    "proceso": proceso, "ruc": x["ruc"], "organizacion": x["organizacion"],
                    "totales_declarados": {k: x.get(k) for k in ("efectivo", "especie", "actividad", "otros", "total")},
                    "total_registros": declarado, "descargado_at": dt.datetime.now().isoformat(timespec="seconds"),
                    "aportantes": aportantes,
                }
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
                self.store.register(dest, url=f"{BACKEND}{detail_path}?ruc={x['ruc']}&process={x['proceso']}&op={slug(x['organizacion'])}")
                log.info("   [%d/%d] %s · %s · %d aportantes", i, len(pares), proceso, x["organizacion"][:50], len(aportantes))
                paths.append(dest)
                time.sleep(PAUSA[0])
            browser.close()
            if fallidos:
                log.warning("   %d parejas sin detalle (error del backend de Claridad): %s", len(fallidos), "; ".join(fallidos))
                self.fallidos = fallidos
        return paths

    def _fetch_candidatos(self, page) -> Path:
        """Padrón completo de candidatos (paginado, 500 por página) → un JSON."""
        out: list[dict] = []
        pg, pages = 0, 1
        while pg < pages:
            d = self._call(page, "consult/candidate/find-lastname",
                           {"filters": [{"code": "candidato", "value": ""}], "orders": {"field": "", "type": "DESC"}, "page": pg, "size": PAGE_SIZE})
            data = d.get("data") or []
            pages = d.get("pages") or 1
            out += data
            log.info("   candidatos página %d/%d (+%d, acumulado %d de %s)", pg + 1, pages, len(data), len(out), d.get("total"))
            if not data:
                break
            pg += 1
            time.sleep(PAUSA[0])
        doc = {"fuente": "ONPE Claridad · consulta de aportantes · candidatos", "endpoint": BACKEND + "consult/candidate/find-lastname",
               "descargado_at": dt.datetime.now().isoformat(timespec="seconds"), "total": len(out), "candidatos": out}
        dest = self.store.dir / "candidatos" / f"candidatos_{dt.date.today().isoformat()}.json"
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
        self.store.register(dest, url=doc["endpoint"])
        return dest

    @staticmethod
    def _wait_cloudflare(page, timeout: int = 90) -> bool:
        for _ in range(timeout):
            t = page.title() or ""
            if t and not t.startswith("Just a moment") and not t.startswith("Un momento"):
                return True
            time.sleep(1)
        return False

    def _call(self, page, path: str, body: dict, intentos: int = 4) -> dict:
        for k in range(intentos):
            st, txt = page.evaluate(_JS_CALL, [SITEKEY, "submit", BACKEND + path, body])
            if st == 200 and txt.startswith("{"):
                return json.loads(txt)
            log.warning("   %s → %s %s (intento %d)", path, st, str(txt)[:120].replace("\n", " "), k + 1)
            time.sleep(3 * (k + 1))
        raise RuntimeError(f"{path}: sin respuesta válida tras {intentos} intentos")

    def _listar(self, page, path: str) -> list[dict]:
        d = self._call(page, path, {"filters": [{"code": "op", "value": ""}], "orders": {"field": "", "type": "DESC"}, "page": 0, "size": 5000})
        data = d.get("data") or []
        log.info("   %s: %d pares (total declarado %s)", path, len(data), d.get("total"))
        time.sleep(PAUSA[0])
        return data

    def _detalle(self, page, path: str, x: dict) -> tuple[list[dict], int]:
        out: list[dict] = []
        pg, total = 1, None
        while True:
            body = {"filters": [{"code": "ruc", "value": x["ruc"] or ""}, {"code": "opEqual", "value": x["organizacion"]},
                                {"code": "process", "value": x["proceso"]}, {"code": "yearApo", "value": ""}],
                    "orders": {"field": "op", "type": "ASC"}, "page": pg, "size": PAGE_SIZE}
            d = self._call(page, path, body)
            data = d.get("data") or {}
            lista = data.get("listaAportantes") or []
            total = d.get("total", 0)
            out += lista
            if not lista or pg >= (d.get("pages") or 1):
                break
            pg += 1
            time.sleep(PAUSA[0])
        return out, total or len(out)

    # ── load ─────────────────────────────────────────────────────────────────────────
    def load(self, paths: list[Path]) -> None:
        if self.manual_csv:
            run_loader("load_aportantes_onpe.py", "--csv", str(self.manual_csv), dry_run=self.dry_run)
            return
        import psycopg2
        from psycopg2.extras import execute_values

        conn = None if self.dry_run else psycopg2.connect(pg_dsn())
        total = 0
        try:
            for p in paths:
                doc = json.loads(p.read_text(encoding="utf-8"))
                if "candidatos" in doc:
                    self._load_candidatos(conn, p, doc)
                    continue
                rows = normalize_detail(doc)
                sha, nbytes = sha256_of(p)
                clave = f"{doc['proceso']}/{doc.get('ruc') or 'sin-ruc'}/{slug(doc['organizacion'])}"
                if conn is None:
                    log.info("   [dry-run] %s → %d filas", clave, len(rows))
                    total += len(rows)
                    continue
                with conn.cursor() as cur:
                    if not self.force and ya_cargado(cur, self.name, clave, sha):
                        continue
                    cur.execute("DELETE FROM onpe_aportantes WHERE proceso=%s AND partido=%s AND COALESCE(ruc_organizacion,'')=%s",
                                (doc["proceso"], doc["organizacion"], doc.get("ruc") or ""))
                    if rows:
                        execute_values(
                            cur,
                            f"INSERT INTO onpe_aportantes ({', '.join(COLS)}, sha256, descargado_at) VALUES %s "
                            "ON CONFLICT (aporte_clave) WHERE aporte_clave IS NOT NULL DO NOTHING",
                            [tuple(r[c] for c in COLS) + (sha, dt.datetime.fromisoformat(doc["descargado_at"]).astimezone() if doc.get("descargado_at") else None) for r in rows], page_size=1000,
                        )
                    registrar(cur, Carga(
                        fuente=self.name, clave=clave, tabla="onpe_aportantes", archivo=str(p.relative_to(RAW_ROOT)) if p.is_relative_to(RAW_ROOT) else p.name,
                        gcs_uri=self.store.gcs_uri(p) if p.is_relative_to(RAW_ROOT) else None, sha256=sha, bytes=nbytes,
                        filas=len(rows), fuente_url=doc.get("endpoint"),
                        descargado_at=dt.datetime.fromisoformat(doc["descargado_at"]).astimezone() if doc.get("descargado_at") else None,
                    ))
                conn.commit()
                total += len(rows)
            log.info("   → onpe_aportantes: %d filas %s", total, "(dry-run)" if conn is None else "cargadas/actualizadas")
            if conn is not None and getattr(self, "fallidos", None):
                with conn.cursor() as cur:
                    for f in self.fallidos:
                        registrar(cur, Carga(fuente=self.name, clave=f"error/{slug(f)}", tabla="onpe_aportantes", sha256="-",
                                             estado="error", error="backend de Claridad devolvió 500 en find-detail", fuente_url=PORTAL_URL))
                conn.commit()
        finally:
            if conn is not None:
                conn.close()

    CAND_COLS = ["dni", "apellidos", "nombres", "organizacion", "departamento", "proceso", "total_ingresos", "fuente", "fuente_url"]

    def _load_candidatos(self, conn, p: Path, doc: dict) -> None:
        from psycopg2.extras import execute_values

        rows = normalize_candidatos(doc)
        sha, nbytes = sha256_of(p)
        if conn is None:
            log.info("   [dry-run] candidatos → %d filas (%d con DNI)", len(rows), sum(1 for r in rows if r["dni"]))
            return
        with conn.cursor() as cur:
            if not self.force and ya_cargado(cur, self.name, "candidatos", sha):
                log.info("   candidatos: ya cargado con el mismo sha256")
                return
            cur.execute("TRUNCATE onpe_candidatos")          # es una foto completa del padrón
            execute_values(
                cur,
                f"INSERT INTO onpe_candidatos ({', '.join(self.CAND_COLS)}, sha256, descargado_at) VALUES %s "
                "ON CONFLICT (COALESCE(dni,''), nombre_norm, COALESCE(organizacion,''), COALESCE(proceso,'')) DO NOTHING",
                [tuple(r[c] for c in self.CAND_COLS) + (sha, dt.datetime.fromisoformat(doc["descargado_at"]).astimezone() if doc.get("descargado_at") else None) for r in rows], page_size=1000,
            )
            cur.execute("SELECT count(*), count(dni) FROM onpe_candidatos")
            n, con_dni = cur.fetchone()
            registrar(cur, Carga(
                fuente=self.name, clave="candidatos", tabla="onpe_candidatos", archivo=p.name, gcs_uri=self.store.gcs_uri(p),
                sha256=sha, bytes=nbytes, filas=n, fuente_url=doc.get("endpoint"),
                descargado_at=dt.datetime.fromisoformat(doc["descargado_at"]).astimezone() if doc.get("descargado_at") else None,
            ))
        conn.commit()
        log.info("   → onpe_candidatos: %d filas (%d con DNI)", n, con_dni)


def normalize_candidatos(doc: dict) -> list[dict]:
    rows: list[dict] = []
    for c in doc.get("candidatos") or []:
        dni = (c.get("dni") or "").strip()
        rows.append({
            "dni": dni if dni.isdigit() else None,
            "apellidos": (c.get("apellidos") or "").strip() or None,
            "nombres": (c.get("nombres") or "").strip() or None,
            "organizacion": (c.get("organizacion") or "").strip() or None,
            "departamento": (c.get("departamento") or "").strip() or None,
            "proceso": (c.get("proceso") or "").replace(" ", "").strip() or None,
            "total_ingresos": c.get("totalIngresos"),
            "fuente": "onpe_claridad",
            "fuente_url": PORTAL_URL,
        })
    return rows


if __name__ == "__main__":
    ClaridadPipeline.cli()
