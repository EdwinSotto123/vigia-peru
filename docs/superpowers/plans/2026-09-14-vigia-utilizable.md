# Vigía utilizable — cola real, procesamiento en vivo, mapa como interfaz, acto social

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir Vigía en un producto que una persona real pueda usar sin explicaciones: elige una zona en el mapa, ve cuántos contratos esperan auditoría, financia, y **ve en vivo** cómo se procesan; las herramientas técnicas (análisis a demanda, sorteo, generador editorial) pasan al admin; quienes aportan reciben reconocimiento público.

**Architecture:** Cuatro workstreams con archivos disjuntos que corren en paralelo. **A** llena la cola real desde la API OCDS del OECE (el buyer trae departamento/provincia/distrito → ubigeo exacto). **B** agrega un *dispatcher* (Cloud Run Job) que toma contratos asignados a contribuciones pagadas, los manda al orquestador por streaming y persiste cada fase en `procesamientos` para que el público lo vea en vivo. **C** construye el tablero público `/auditoria` (encolado → procesando → procesado), la vista en vivo por contrato, el muro de aliados y las tarjetas compartibles. **D** reorganiza la navegación: mapa como hub público, análisis a demanda al admin, landing con las secciones que hoy están escondidas en el dashboard.

**Tech Stack:** Postgres 16 (Cloud SQL) · Hono/TS (`backend/api`) · Python 3.12 (`backend/dispatcher`, `backend/scrapers`) · Next.js 14 App Router + Tailwind + d3-geo (`frontend`) · Cloud Run + Cloud Run Jobs + Cloud Scheduler · gcloud.

**Spec:** `docs/design/FINANCIA_UNA_AUDITORIA.md` (concepto, reglas de independencia §6) + este documento (§0 decisiones de producto).

## Global Constraints

- Nunca un campo para que el financiador elija contratos; la asignación es `asignar_contribucion()` (SQL FIFO). El dispatcher solo procesa lo ya asignado.
- Vocabulario: "financiar capacidad de auditoría", "auditoría financiada por X", "aliado de transparencia". Nunca "comprar", "patrocinar", "dueño", "controlar". Nunca "corrupto": "señal de riesgo".
- Sin menciones a asistentes de IA de terceros en código, docs ni commits (atribución del proyecto: Antigravity). Commits con la identidad del usuario, sin trailers de co-autoría.
- Datos personales: DNI y apellidos de personas naturales pasan por `components/Redact.tsx`. Emails de financiadores nunca salen por endpoints públicos.
- Todo endpoint nuevo público lleva `Cache-Control: public, s-maxage=<n>` (≤60 s si es "en vivo"). Todo endpoint admin va bajo `/admin/*` con `x-admin-token`.
- Rutas públicas nuevas viven en `frontend/app/(public)/` (Header + Footer). Nada nuevo entra en `(dashboard)` salvo lo que D indica.
- Copy en español peruano neutro. Código y commits en inglés.
- Cada workstream corre en un git worktree propio (`superpowers:using-git-worktrees`) y termina con `npx tsc --noEmit` (frontend y api) y `python -m compileall` (backend) en verde antes de pedir merge.
- Deploy: `bash infrastructure/deploy/<servicio>.sh`. El orquestador **no se toca** en este plan.

---

## 0. Decisiones de producto (lo que el plan implementa)

| Hoy | Después |
|---|---|
| `/app` "Inicio": pegar código, despachar agentes, sortear, análisis recientes | **Solo admin** (`/admin/analisis`). El público no analiza a demanda. |
| Sidebar: Mapa · Entidades · Alertas · Denuncias · Denunciar · IA Generador | Público: **Mapa** (hub) · **Auditoría en vivo** · **Aliados** · **Denunciar** · FAQ. Entidades y Alertas viven *dentro* del mapa (panel de zona). IA Generador → oculto (feature flag `NEXT_PUBLIC_EDITORIAL=0`). |
| Cola de 27 contratos (los 86 que alguien pegó a mano) | Cola real: releases OCDS de los últimos 90 días de **todo el Perú**, mapeados a distrito; ingesta diaria. |
| Al validar un aporte, los contratos quedan "asignados" y nadie los procesa | Dispatcher los procesa solos; el financiador ve **encolado → procesando (fase X de 8) → procesado** y entra al contrato para ver el análisis en vivo. |
| Ranking en `/financiar` | + **Muro de aliados** (`/aliados`) con reconocimiento por semana/mes, tarjeta compartible (OG image) por comprobante, sección "Gracias a…" en landing. |

Estados públicos de un contrato asignado (tabla `procesamientos.estado`): `encolado` (asignado, sin empezar) → `procesando` (dispatcher lo tomó; `fase_actual` avanza) → `procesado` (alerta persistida) · `error` (reintentable, máx 3).

Fases visibles (en orden real del `deterministic.py`): `compliance`, `document_parser`, `document_legal_analyst`, `market`, `web_research`, `news_research`, `entity_personnel`, `person_network`, `compliance_extended`, `report_writer`. Etiquetas humanas en `frontend/lib/auditoria.ts` (Task C1).

---

## Mapa de archivos por workstream (propiedad exclusiva)

| WS | Crea | Modifica |
|---|---|---|
| **A** | `backend/db/migrations/11_convocatorias_ubigeo.sql`, `backend/scrapers/_core/ubigeo.py`, `backend/scrapers/tests/test_ubigeo.py`, `backend/scrapers/oece_ocds/pipeline.py` (reescritura), `infrastructure/deploy/scrapers-job.sh` | `backend/db/apply_all.py` (ORDER), `backend/db/apply_all.sh`, `backend/scrapers/README.md` |
| **B** | `backend/db/migrations/12_procesamientos.sql`, `backend/dispatcher/{main.py,requirements.txt,Dockerfile,README.md}`, `backend/dispatcher/tests/test_events.py`, `backend/api/src/routes/procesamientos.ts`, `infrastructure/deploy/dispatcher.sh` | `backend/api/src/index.ts` (montar router), `backend/api/src/routes/admin.ts` (endpoints de monitor), `backend/db/apply_all.py`, `backend/db/apply_all.sh`, `cloudbuild.yaml` (paso dispatcher) |
| **C** | `frontend/lib/auditoria.ts`, `frontend/components/auditoria/{TableroAuditoria,ContratoEnVivo,FaseTimeline,EstadoPill}.tsx`, `frontend/components/aliados/{MuroAliados,TarjetaAliado}.tsx`, `frontend/app/(public)/auditoria/page.tsx`, `frontend/app/(public)/auditoria/[ocid]/page.tsx`, `frontend/app/(public)/aliados/page.tsx`, `frontend/app/(public)/impacto/[codigo]/opengraph-image.tsx` | `frontend/app/(public)/impacto/[codigo]/page.tsx` (usar `ContratoEnVivo` en lista), `frontend/app/(public)/financiar/[ubigeo]/page.tsx` (bloque "en vivo ahora") |
| **D** | `frontend/app/admin/analisis/page.tsx`, `frontend/components/mapa/{ZonaHubPanel,EntidadesDeZona,AlertasDeZona}.tsx`, `frontend/components/landing/{MapaHubSection,AliadosSection}.tsx`, `frontend/lib/flags.ts` | `frontend/components/Header.tsx`, `frontend/components/dashboard/DashboardSidebar.tsx`, `frontend/app/(dashboard)/app/page.tsx` (→ redirect a `/app/mapa`), `frontend/app/(dashboard)/app/mapa/page.tsx`, `frontend/components/MapaWrapper.tsx`, `frontend/components/RegionDetailPanel.tsx`, `frontend/app/(public)/page.tsx`, `frontend/components/admin/AdminShell.tsx` (item "Análisis"), `frontend/app/(dashboard)/noticia/page.tsx` (flag) |

**Interfaces compartidas** (definidas acá, cada WS las implementa/consume tal cual):

```ts
// GET /financiamiento/procesamientos?ubigeo=15&codigo=VIG-2026-00002&estado=procesando&limit=100
// → { data: Procesamiento[] }
export interface Procesamiento {
  ocid: string;
  estado: "encolado" | "procesando" | "procesado" | "error";
  faseActual: string | null;          // p.ej. "market"
  faseIndex: number | null;           // 0..9
  iniciadoAt: string | null;
  finalizadoAt: string | null;
  intentos: number;
  contribucionCodigo: string;         // VIG-2026-00002
  financiador: string;                // nombre público o "Anónimo"
  financiadorVisible: boolean;
  ubigeo: string;                     // zona de la contribución
  zona: string;
  titulo: string | null;              // convocatorias.objeto
  entidad: string | null;
  montoPen: number | null;            // cuantia_referencial
  alertaCodigo: string | null;        // cuando procesado
  score: number | null;
  banderas: number;                   // cuando procesado
}
// GET /financiamiento/procesamientos/:ocid → Procesamiento & { eventos: EventoFase[] }
export interface EventoFase { ts: string; kind: "phase" | "warn" | "error" | "final"; name: string; msg: string | null }
// GET /financiamiento/aliados?periodo=semana|mes|todo → { data: RankingRow[] }  (ya existe /financiamiento/ranking; se reutiliza)
```

---

# Workstream A — Cola real desde el OECE (OCDS → distrito)

### Task A1: Migración 11 — ubigeo en convocatorias y entidades

**Files:**
- Create: `backend/db/migrations/11_convocatorias_ubigeo.sql`
- Modify: `backend/db/apply_all.py` (lista `ORDER`), `backend/db/apply_all.sh`

**Interfaces:**
- Produces: columna `convocatorias.ubigeo CHAR(6)`, `convocatorias.categoria TEXT`, `convocatorias.estado_tender TEXT`; vista `convocatoria_zona` prioriza `c.ubigeo`.

- [ ] **Step 1: Escribir la migración**

```sql
-- 11 · ubigeo directo en convocatorias (viene del buyer.address del OCDS) + campos de listado.
ALTER TABLE convocatorias ADD COLUMN IF NOT EXISTS ubigeo CHAR(6) REFERENCES zonas (ubigeo);
ALTER TABLE convocatorias ADD COLUMN IF NOT EXISTS categoria TEXT;          -- goods | services | works
ALTER TABLE convocatorias ADD COLUMN IF NOT EXISTS estado_tender TEXT;      -- tender.status tal cual
ALTER TABLE convocatorias ADD COLUMN IF NOT EXISTS fuente TEXT DEFAULT 'ocds_api';
CREATE INDEX IF NOT EXISTS convocatorias_ubigeo_idx ON convocatorias (ubigeo);
CREATE INDEX IF NOT EXISTS convocatorias_fecha_idx ON convocatorias (fecha_convocatoria DESC);

ALTER TABLE entidades ALTER COLUMN tipo DROP NOT NULL;   -- la ingesta liviana no siempre sabe el tipo

CREATE OR REPLACE VIEW convocatoria_zona AS
SELECT c.ocid, c.fecha_convocatoria,
       COALESCE(
         c.ubigeo,
         NULLIF(e.ubigeo, ''),
         (SELECT z.ubigeo FROM zonas z
           WHERE z.nivel IN ('provincia','departamento')
             AND upper(unaccent(z.nombre)) = upper(unaccent(COALESCE(NULLIF(c.region,''), e.region, e.provincia, '')))
           ORDER BY CASE z.nivel WHEN 'provincia' THEN 0 ELSE 1 END
           LIMIT 1)
       ) AS ubigeo
FROM convocatorias c
LEFT JOIN entidades e ON e.ruc = c.entidad_ruc;
```

- [ ] **Step 2: Registrar en `apply_all.py` (`"11_convocatorias_ubigeo.sql"` al final de `ORDER`) y en `apply_all.sh` (misma lista)**
- [ ] **Step 3: Aplicar contra Cloud SQL** — `PGHOST=34.71.244.66 PGSSLMODE=require python backend/db/apply_all.py` (el IP autorizado ya está). Esperado: `→ aplicando 11_convocatorias_ubigeo.sql… ✓ ok`.
- [ ] **Step 4: Commit** `git commit -m "db: ubigeo, categoria and tender status on convocatorias (migration 11)"`

### Task A2: Resolver ubigeo desde el buyer OCDS (con tests)

**Files:**
- Create: `backend/scrapers/_core/ubigeo.py`, `backend/scrapers/tests/__init__.py`, `backend/scrapers/tests/test_ubigeo.py`

**Interfaces:**
- Produces: `resolve_ubigeo(zonas: ZonaIndex, department: str|None, region: str|None, locality: str|None) -> str|None` y `ZonaIndex.from_rows(rows: Iterable[tuple[str,str,str,str|None]])` (ubigeo, nivel, nombre, padre).

- [ ] **Step 1: Test que falla**

```python
# backend/scrapers/tests/test_ubigeo.py
from backend.scrapers._core.ubigeo import ZonaIndex, resolve_ubigeo

ROWS = [
    ("15", "departamento", "Lima", None), ("1501", "provincia", "Lima", "15"), ("150135", "distrito", "San Martin de Porres", "1501"),
    ("1505", "provincia", "Cañete", "15"), ("150501", "distrito", "San Vicente de Cañete", "1505"),
    ("06", "departamento", "Cajamarca", None), ("0611", "provincia", "San Ignacio", "06"), ("061106", "distrito", "Tabaconas", "0611"),
]

def idx(): return ZonaIndex.from_rows(ROWS)

def test_distrito_exacto():
    assert resolve_ubigeo(idx(), "CAJAMARCA", "SAN IGNACIO", "TABACONAS") == "061106"

def test_tildes_y_mayusculas():
    assert resolve_ubigeo(idx(), "Lima", "CAÑETE", "SAN VICENTE DE CAÑETE") == "150501"

def test_sin_distrito_cae_a_provincia():
    assert resolve_ubigeo(idx(), "LIMA", "LIMA", None) == "1501"

def test_sin_provincia_cae_a_departamento():
    assert resolve_ubigeo(idx(), "LIMA", None, None) == "15"

def test_distrito_no_encontrado_cae_a_provincia():
    assert resolve_ubigeo(idx(), "LIMA", "LIMA", "DISTRITO INEXISTENTE") == "1501"

def test_nada():
    assert resolve_ubigeo(idx(), None, None, None) is None
```

- [ ] **Step 2: Correr** `python -m pytest backend/scrapers/tests/test_ubigeo.py -v` desde la raíz → FAIL (módulo no existe). Si `pytest` no está: `pip install pytest`.
- [ ] **Step 3: Implementación**

```python
# backend/scrapers/_core/ubigeo.py
"""Resuelve el ubigeo INEI a partir de los nombres que trae el OCDS del OECE en
buyer.address: department (departamento), region (provincia), locality (distrito).
Match por nombre normalizado (mayúsculas, sin tildes, sin dobles espacios) y
descendiendo por jerarquía: departamento → provincia → distrito. Si un nivel no
matchea, devuelve el nivel superior resuelto (mejor un dpto que nada)."""
from __future__ import annotations
import unicodedata
from dataclasses import dataclass, field
from typing import Iterable

def norm(s: str | None) -> str:
    if not s: return ""
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return " ".join(s.upper().replace("-", " ").split())

@dataclass
class ZonaIndex:
    dptos: dict[str, str] = field(default_factory=dict)                 # norm(nombre) → ubigeo(2)
    provs: dict[tuple[str, str], str] = field(default_factory=dict)     # (dpto_ubigeo, norm) → ubigeo(4)
    dists: dict[tuple[str, str], str] = field(default_factory=dict)     # (prov_ubigeo, norm) → ubigeo(6)

    @classmethod
    def from_rows(cls, rows: Iterable[tuple[str, str, str, str | None]]) -> "ZonaIndex":
        ix = cls()
        for ubigeo, nivel, nombre, padre in rows:
            n = norm(nombre)
            if nivel == "departamento": ix.dptos[n] = ubigeo
            elif nivel == "provincia": ix.provs[(padre or "", n)] = ubigeo
            elif nivel == "distrito": ix.dists[(padre or "", n)] = ubigeo
        return ix

def resolve_ubigeo(ix: ZonaIndex, department: str | None, region: str | None, locality: str | None) -> str | None:
    d = ix.dptos.get(norm(department))
    if not d: return None
    p = ix.provs.get((d, norm(region))) if region else None
    if not p: return d
    z = ix.dists.get((p, norm(locality))) if locality else None
    return z or p
```

- [ ] **Step 4: Correr tests → PASS (6)**
- [ ] **Step 5: Commit** `git commit -m "scrapers: resolve INEI ubigeo from OCDS buyer address"`

### Task A3: Pipeline `oece_ocds` — ingesta liviana masiva con paginación

**Files:**
- Modify: `backend/scrapers/oece_ocds/pipeline.py` (reescribir `fetch`/`load`)

**Interfaces:**
- Consumes: `resolve_ubigeo`, `ZonaIndex` (A2); `backend/scrapers/_core/http.session()`; `pg_dsn()` de `_core/pipeline.py`.
- Produces: filas en `convocatorias` (ocid, codigo, entidad_ruc, objeto, cuantia_referencial, fecha_convocatoria, region, ubigeo, categoria, estado_tender, fuente='ocds_api', ocds_payload = release recortado) y `entidades` (ruc, nombre, region, provincia, distrito, ubigeo) con `ON CONFLICT DO UPDATE` solo de campos vacíos.

- [ ] **Step 1: Reescribir el pipeline**

```python
"""OECE Contrataciones Abiertas (API OCDS) → cola de auditoría real.

Verificado 2026-09-14: GET https://contratacionesabiertas.oece.gob.pe/api/v1/releases?limit=50&page=N&date_gte=YYYY-MM-DD
responde desde IP peruana (403 desde GCP → correr desde laptop/VPS). Cada release trae
buyer.address = {department, region (=provincia), locality (=distrito)} → ubigeo exacto.

Ingesta LIVIANA: no llama a SUNAT ni baja documentos; solo registra la convocatoria y la
entidad para que existan en la cola. El análisis completo lo hace el orquestador cuando
un aporte la financia (dispatcher).

  python -m backend.scrapers.oece_ocds.pipeline --since 2026-06-15          # backfill 90 días
  python -m backend.scrapers.oece_ocds.pipeline                             # diario: ayer
  python -m backend.scrapers.oece_ocds.pipeline --since 2026-09-01 --dry-run
"""
from __future__ import annotations
import argparse, datetime as dt, json
from pathlib import Path
from .._core import http
from .._core.pipeline import Pipeline, log, pg_dsn
from .._core.ubigeo import ZonaIndex, resolve_ubigeo

BASE = "https://contratacionesabiertas.oece.gob.pe/api/v1"
PAGE = 50

def _buyer_party(rel: dict) -> dict:
    for p in rel.get("parties") or []:
        roles = p.get("roles") or []
        if "buyer" in roles or "procuringEntity" in roles: return p
    return {}

def _buyer_ruc(party: dict) -> str | None:
    for ai in party.get("additionalIdentifiers") or []:
        if ai.get("scheme") == "PE-RUC" and len(str(ai.get("id", ""))) == 11: return str(ai["id"])
    ident = party.get("identifier") or {}
    if ident.get("scheme") == "PE-RUC" and len(str(ident.get("id", ""))) == 11: return str(ident["id"])
    return None

def normalize_release(rel: dict, ix: ZonaIndex) -> dict | None:
    """Release OCDS → fila de convocatorias (+ entidad). None si no hay ocid o buyer RUC."""
    ocid = rel.get("ocid"); party = _buyer_party(rel); ruc = _buyer_ruc(party)
    if not ocid or not ruc: return None
    addr = party.get("address") or {}
    tender = rel.get("tender") or {}
    value = tender.get("value") or {}
    fecha = (tender.get("datePublished") or rel.get("date") or "")[:10] or None
    return {
        "ocid": ocid, "codigo": str(tender.get("id") or ""),
        "entidad_ruc": ruc, "entidad_nombre": (rel.get("buyer") or {}).get("name") or party.get("name"),
        "objeto": (tender.get("title") or tender.get("description") or "")[:600] or None,
        "cuantia": value.get("amount_PEN") or value.get("amount"),
        "fecha": fecha, "region": addr.get("region"), "departamento": addr.get("department"),
        "provincia": addr.get("region"), "distrito": addr.get("locality"),
        "ubigeo": resolve_ubigeo(ix, addr.get("department"), addr.get("region"), addr.get("locality")),
        "categoria": tender.get("mainProcurementCategory"), "estado_tender": tender.get("status"),
        "payload": {k: rel.get(k) for k in ("ocid", "id", "date", "tag", "buyer", "tender") if k in rel},
    }

class OcdsIncrementalPipeline(Pipeline):
    name = "oece_ocds"
    description = "OECE OCDS API — releases nuevos por fecha → convocatorias + entidades (cola real)"
    schedule = "diario 06:00 (desde IP peruana)"

    def __init__(self, **kw):
        super().__init__(**kw)
        self.since = (dt.date.today() - dt.timedelta(days=1)).isoformat()
        self.max_pages = 400
        self.rows: list[dict] = []

    @classmethod
    def add_arguments(cls, ap: argparse.ArgumentParser) -> None:
        ap.add_argument("--since", default=None, help="YYYY-MM-DD (default: ayer)")
        ap.add_argument("--max-pages", type=int, default=400, help="tope de páginas de 50 (400 = 20 000 releases)")

    def configure(self, args: argparse.Namespace) -> None:
        self.since = args.since or self.since; self.max_pages = args.max_pages

    def _zona_index(self) -> ZonaIndex:
        import psycopg2
        conn = psycopg2.connect(pg_dsn())
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT ubigeo, nivel, nombre, padre_ubigeo FROM zonas")
                return ZonaIndex.from_rows(cur.fetchall())
        finally: conn.close()

    def fetch(self) -> list[Path]:
        ix = self._zona_index()
        out_dir = self.store.dir / dt.date.today().isoformat(); out_dir.mkdir(parents=True, exist_ok=True)
        raw = out_dir / f"releases_{self.since}.ndjson"
        seen: set[str] = set(); n_pages = 0
        with raw.open("w", encoding="utf-8") as f:
            for page in range(1, self.max_pages + 1):
                r = http.session().get(f"{BASE}/releases", params={"limit": PAGE, "page": page, "date_gte": self.since}, timeout=(15, 60))
                if r.status_code != 200: log.warning("página %d → HTTP %d, corto", page, r.status_code); break
                rels = r.json().get("releases") or []
                if not rels: break
                n_pages += 1
                for rel in rels:
                    row = normalize_release(rel, ix)
                    if not row or row["ocid"] in seen: continue
                    seen.add(row["ocid"]); self.rows.append(row); f.write(json.dumps(row, ensure_ascii=False) + "\n")
                if len(rels) < PAGE: break
        con_ubigeo = sum(1 for x in self.rows if x["ubigeo"])
        log.info("   %d páginas · %d releases · %d con ubigeo (%.0f%%)", n_pages, len(self.rows), con_ubigeo, 100 * con_ubigeo / max(1, len(self.rows)))
        return [raw]

    def load(self, paths: list[Path]) -> None:
        if self.dry_run: log.info("   [dry-run] %d filas", len(self.rows)); return
        import psycopg2
        from psycopg2.extras import Json, execute_values
        conn = psycopg2.connect(pg_dsn())
        try:
            with conn.cursor() as cur:
                ents = {r["entidad_ruc"]: r for r in self.rows}
                execute_values(cur, """
                    INSERT INTO entidades (ruc, nombre, region, provincia, distrito, ubigeo)
                    VALUES %s
                    ON CONFLICT (ruc) DO UPDATE SET
                      ubigeo = COALESCE(NULLIF(entidades.ubigeo,''), EXCLUDED.ubigeo),
                      region = COALESCE(entidades.region, EXCLUDED.region),
                      provincia = COALESCE(entidades.provincia, EXCLUDED.provincia),
                      distrito = COALESCE(entidades.distrito, EXCLUDED.distrito)""",
                    [(r["entidad_ruc"], (r["entidad_nombre"] or "")[:300], r["departamento"], r["provincia"], r["distrito"], r["ubigeo"]) for r in ents.values()])
                execute_values(cur, """
                    INSERT INTO convocatorias (ocid, codigo, entidad_ruc, objeto, cuantia_referencial, fecha_convocatoria, region, ubigeo, categoria, estado_tender, fuente, ocds_payload)
                    VALUES %s
                    ON CONFLICT (ocid) DO UPDATE SET
                      ubigeo = COALESCE(convocatorias.ubigeo, EXCLUDED.ubigeo),
                      objeto = COALESCE(convocatorias.objeto, EXCLUDED.objeto),
                      cuantia_referencial = COALESCE(convocatorias.cuantia_referencial, EXCLUDED.cuantia_referencial),
                      estado_tender = EXCLUDED.estado_tender, updated_at = now()""",
                    [(r["ocid"], r["codigo"], r["entidad_ruc"], r["objeto"], r["cuantia"], r["fecha"], r["provincia"], r["ubigeo"], r["categoria"], r["estado_tender"], "ocds_api", Json(r["payload"])) for r in self.rows],
                    page_size=500)
                cur.execute("SELECT refresh_financiamiento()")
            conn.commit()
            log.info("   → convocatorias upsert %d · entidades %d", len(self.rows), len(ents))
        finally: conn.close()

if __name__ == "__main__":
    OcdsIncrementalPipeline.cli()
```

- [ ] **Step 2: Dry-run de 2 páginas** — `python -m backend.scrapers.oece_ocds.pipeline --since 2026-09-13 --max-pages 2 --dry-run`. Esperado: `N releases · M con ubigeo (≥85%)`. Si el % es bajo, imprimir los `(department, region, locality)` sin match y ajustar `norm` (p. ej. "MARISCAL NIETO" vs "Mariscal Nieto" ya está cubierto; revisar "CALLAO" que en INEI es dpto `07` y provincia `0701`).
- [ ] **Step 3: Backfill real de 90 días** — `python -m backend.scrapers.oece_ocds.pipeline --since 2026-06-15 --max-pages 400`. Puede tardar 10-20 min. Verificar: `SELECT count(*), count(ubigeo) FROM convocatorias; SELECT nivel, count(*) FROM zona_estado WHERE total_cola>0 GROUP BY 1;` → miles de convocatorias, decenas de distritos con cola.
- [ ] **Step 4: Verificar `/financiamiento/estado`** en prod → `colaGlobal` ≫ 27.
- [ ] **Step 5: Commit** `git commit -m "scrapers: bulk OCDS ingestion with district-level ubigeo (real audit queue)"`

### Task A4: Corrida diaria desde fuera de GCP

**Files:**
- Create: `infrastructure/deploy/scrapers-job.sh` (documenta y programa la corrida; el host es la laptop o el VPS de Lima, no GCP)
- Modify: `backend/scrapers/README.md` (sección "Cola real")

- [ ] **Step 1: Script** — `infrastructure/deploy/scrapers-job.sh`:

```bash
#!/usr/bin/env bash
# Corre la ingesta diaria del OECE desde una IP peruana (la API bloquea GCP).
# Programar en el VPS de Lima (crontab):  0 6 * * *  /opt/vigia/infrastructure/deploy/scrapers-job.sh >> /var/log/vigia-scrapers.log 2>&1
# o en Windows (Task Scheduler) con Git Bash.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
export PGHOST="${PGHOST:-34.71.244.66}" PGSSLMODE="${PGSSLMODE:-require}"
python -m backend.scrapers.oece_ocds.pipeline --since "$(date -d 'yesterday' +%F 2>/dev/null || date -v-1d +%F)"
python -m backend.scrapers.run_all --only pnda_sancionados
```

- [ ] **Step 2: README** — agregar bajo "Frecuencia sugerida": la IP del host debe estar en `authorized-networks` de Cloud SQL (`gcloud sql instances patch vigia-db --authorized-networks=<IP>/32`).
- [ ] **Step 3: Commit** `git commit -m "infra: daily OECE ingestion job script (run from Peruvian IP)"`

---

# Workstream B — Dispatcher: procesamiento automático y en vivo

### Task B1: Migración 12 — `procesamientos`

**Files:**
- Create: `backend/db/migrations/12_procesamientos.sql`
- Modify: `backend/db/apply_all.py`, `backend/db/apply_all.sh`

**Interfaces:**
- Produces: tabla `procesamientos`, función `reclamar_procesamientos(n int, worker text) RETURNS SETOF text`, vista `procesamientos_publico`.

- [ ] **Step 1: Migración**

```sql
-- 12 · Estado de procesamiento en vivo de contratos asignados a contribuciones.
-- Lo escribe el dispatcher (backend/dispatcher); lo lee el público vía /financiamiento/procesamientos.
CREATE TABLE IF NOT EXISTS procesamientos (
  ocid             TEXT PRIMARY KEY REFERENCES convocatorias (ocid),
  contribucion_id  BIGINT NOT NULL REFERENCES contribuciones (id),
  estado           TEXT NOT NULL DEFAULT 'encolado' CHECK (estado IN ('encolado','procesando','procesado','error')),
  fase_actual      TEXT,
  fase_index       INT,
  worker           TEXT,
  intentos         INT NOT NULL DEFAULT 0,
  error            TEXT,
  eventos          JSONB NOT NULL DEFAULT '[]'::jsonb,      -- [{ts, kind, name, msg}] solo phase/warn/error/final
  encolado_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  iniciado_at      TIMESTAMPTZ,
  latido_at        TIMESTAMPTZ,                              -- heartbeat; si pasa >20 min sin latido, se re-encola
  finalizado_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS procesamientos_estado_idx ON procesamientos (estado, encolado_at);
CREATE INDEX IF NOT EXISTS procesamientos_contrib_idx ON procesamientos (contribucion_id);

-- Toda asignación nueva entra encolada (trigger), y las existentes se sincronizan una vez.
CREATE OR REPLACE FUNCTION encolar_procesamiento() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO procesamientos (ocid, contribucion_id) VALUES (NEW.ocid, NEW.contribucion_id) ON CONFLICT (ocid) DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_asignaciones_encolar ON asignaciones;
CREATE TRIGGER trg_asignaciones_encolar AFTER INSERT ON asignaciones FOR EACH ROW EXECUTE FUNCTION encolar_procesamiento();
INSERT INTO procesamientos (ocid, contribucion_id)
SELECT s.ocid, s.contribucion_id FROM asignaciones s WHERE s.procesada_at IS NULL ON CONFLICT DO NOTHING;
UPDATE procesamientos p SET estado = 'procesado', finalizado_at = COALESCE(p.finalizado_at, s.procesada_at)
FROM asignaciones s WHERE s.ocid = p.ocid AND s.procesada_at IS NOT NULL AND p.estado <> 'procesado';

-- Reclamo atómico para N workers en paralelo (SKIP LOCKED). Re-encola los colgados (>20 min sin latido).
CREATE OR REPLACE FUNCTION reclamar_procesamientos(n INT, p_worker TEXT) RETURNS SETOF TEXT LANGUAGE plpgsql AS $$
BEGIN
  UPDATE procesamientos SET estado = 'encolado', worker = NULL, error = 'timeout sin latido'
   WHERE estado = 'procesando' AND latido_at < now() - interval '20 minutes';
  RETURN QUERY
  WITH c AS (
    SELECT ocid FROM procesamientos
     WHERE estado = 'encolado' AND intentos < 3
     ORDER BY encolado_at LIMIT n FOR UPDATE SKIP LOCKED)
  UPDATE procesamientos p SET estado = 'procesando', worker = p_worker, intentos = p.intentos + 1,
         iniciado_at = now(), latido_at = now(), fase_actual = 'started', fase_index = 0, error = NULL
    FROM c WHERE p.ocid = c.ocid RETURNING p.ocid;
END $$;

-- Cuando el pipeline persiste la alerta, el trigger de 09 cierra la asignación; acá cerramos el procesamiento.
CREATE OR REPLACE FUNCTION cerrar_procesamiento_por_alerta() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE procesamientos SET estado = 'procesado', finalizado_at = now(), fase_actual = 'final', fase_index = 10
   WHERE ocid = NEW.ocid AND estado <> 'procesado';
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_alertas_cerrar_procesamiento ON alertas;
CREATE TRIGGER trg_alertas_cerrar_procesamiento AFTER INSERT ON alertas FOR EACH ROW EXECUTE FUNCTION cerrar_procesamiento_por_alerta();

-- Vista pública (sin email ni worker).
CREATE OR REPLACE VIEW procesamientos_publico AS
SELECT p.ocid, p.estado, p.fase_actual, p.fase_index, p.intentos, p.encolado_at, p.iniciado_at, p.finalizado_at,
       co.codigo AS contribucion_codigo, co.ubigeo, z.nombre AS zona,
       CASE WHEN f.visible THEN COALESCE(f.nombre_publico, 'Anónimo') ELSE 'Aliado no visible' END AS financiador,
       f.visible AS financiador_visible,
       cv.objeto AS titulo, e.nombre AS entidad, cv.cuantia_referencial AS monto_pen,
       a.codigo AS alerta_codigo, a.score,
       (SELECT count(*) FROM banderas b WHERE b.alerta_id = a.id) AS banderas
FROM procesamientos p
JOIN contribuciones co ON co.id = p.contribucion_id
JOIN financiadores f ON f.id = co.financiador_id
JOIN zonas z ON z.ubigeo = co.ubigeo
JOIN convocatorias cv ON cv.ocid = p.ocid
LEFT JOIN entidades e ON e.ruc = cv.entidad_ruc
LEFT JOIN alertas a ON a.ocid = p.ocid;
```

- [ ] **Step 2: Registrar en `apply_all.py`/`.sh` y aplicar en Cloud SQL** (mismo comando que A1). Verificar `SELECT estado, count(*) FROM procesamientos GROUP BY 1`.
- [ ] **Step 3: Commit** `git commit -m "db: procesamientos table, claim function and public view (migration 12)"`

### Task B2: Dispatcher (Cloud Run Job) con tests del parser de eventos

**Files:**
- Create: `backend/dispatcher/main.py`, `backend/dispatcher/events.py`, `backend/dispatcher/requirements.txt`, `backend/dispatcher/Dockerfile`, `backend/dispatcher/README.md`, `backend/dispatcher/tests/__init__.py`, `backend/dispatcher/tests/test_events.py`

**Interfaces:**
- Consumes: orquestador `POST {AGENT_URL}?stream=1` body `{"input": "<ocid>"}` → NDJSON con `{"kind":"phase","name":..,"msg":..}`, `warn`, `error`, `final`.
- Produces: `procesamientos.eventos` append, `fase_actual`/`fase_index`, heartbeat; env `AGENT_URL`, `PG*`, `DISPATCHER_PARALLEL` (default 2), `DISPATCHER_MAX_MINUTES` (default 55).

- [ ] **Step 1: Test del reductor de eventos**

```python
# backend/dispatcher/tests/test_events.py
from backend.dispatcher.events import FASES, reduce_event

def test_phase_conocida_da_indice():
    st = reduce_event({}, {"kind": "phase", "name": "market", "msg": "validando precios"})
    assert st["fase_actual"] == "market" and st["fase_index"] == FASES.index("market")

def test_phase_desconocida_no_rompe():
    st = reduce_event({"fase_actual": "market", "fase_index": 3}, {"kind": "phase", "name": "safety_net", "msg": "x"})
    assert st["fase_actual"] == "safety_net" and st["fase_index"] == 3

def test_final_marca_terminado():
    st = reduce_event({}, {"kind": "final", "final_response": "..."})
    assert st["terminado"] is True and st["fase_index"] == len(FASES)

def test_error_guarda_detalle():
    st = reduce_event({}, {"kind": "error", "agent": "pipeline", "detail": "boom"})
    assert st["error"] == "boom"

def test_eventos_ruidosos_se_ignoran():
    assert reduce_event({}, {"kind": "tool_call", "name": "x"}) == {}
```

- [ ] **Step 2: Correr** `python -m pytest backend/dispatcher/tests -v` → FAIL.
- [ ] **Step 3: `events.py`**

```python
# backend/dispatcher/events.py
"""Reduce el stream NDJSON del orquestador a lo que el público necesita ver."""
from __future__ import annotations
FASES = ["compliance", "document_parser", "document_legal_analyst", "market", "web_research",
         "news_research", "entity_personnel", "person_network", "compliance_extended", "report_writer"]
VISIBLES = {"phase", "warn", "error", "final"}

def reduce_event(state: dict, ev: dict) -> dict:
    """Devuelve SOLO los cambios de estado que produce `ev` (dict vacío si es ruido)."""
    kind = ev.get("kind")
    if kind not in VISIBLES: return {}
    out: dict = {}
    if kind == "phase":
        name = str(ev.get("name") or "")
        out["fase_actual"] = name
        if name in FASES: out["fase_index"] = FASES.index(name)
    elif kind == "final":
        out["terminado"] = True; out["fase_actual"] = "final"; out["fase_index"] = len(FASES)
    elif kind == "error":
        out["error"] = str(ev.get("detail") or ev.get("msg") or "error")[:500]
    return out
```

- [ ] **Step 4: Tests → PASS (5)**
- [ ] **Step 5: `main.py`**

```python
# backend/dispatcher/main.py
"""Dispatcher: toma contratos encolados (asignados a aportes pagados), los manda al
orquestador por streaming y persiste cada fase en `procesamientos` para el tablero público.

Corre como Cloud Run Job (Scheduler cada 5 min). Cada ejecución reclama hasta
DISPATCHER_PARALLEL contratos con SKIP LOCKED (varias ejecuciones pueden solaparse
sin pisarse) y termina al acabarlos o a los DISPATCHER_MAX_MINUTES."""
from __future__ import annotations
import concurrent.futures as cf, datetime as dt, json, logging, os, socket, time
import psycopg2, requests
from psycopg2.extras import Json
from .events import reduce_event

log = logging.getLogger("dispatcher")
AGENT_URL = os.environ["AGENT_URL"].rstrip("/")
PARALLEL = int(os.getenv("DISPATCHER_PARALLEL", "2"))
MAX_MIN = int(os.getenv("DISPATCHER_MAX_MINUTES", "55"))
WORKER = f"{socket.gethostname()}-{os.getpid()}"

def dsn() -> str:
    return (f"host={os.getenv('PGHOST','127.0.0.1')} port={os.getenv('PGPORT','5432')} dbname={os.getenv('PGDATABASE','vigia')} "
            f"user={os.getenv('PGUSER','postgres')} password={os.environ['PGPASSWORD']} sslmode={os.getenv('PGSSLMODE','prefer')}")

def reclamar(n: int) -> list[str]:
    with psycopg2.connect(dsn()) as c, c.cursor() as cur:
        cur.execute("SELECT reclamar_procesamientos(%s, %s)", (n, WORKER)); return [r[0] for r in cur.fetchall()]

def actualizar(ocid: str, cambios: dict, evento: dict | None = None) -> None:
    sets, vals = ["latido_at = now()"], []
    for k in ("fase_actual", "fase_index", "error"):
        if k in cambios: sets.append(f"{k} = %s"); vals.append(cambios[k])
    if evento is not None:
        sets.append("eventos = eventos || %s::jsonb"); vals.append(Json([evento]))
    with psycopg2.connect(dsn()) as c, c.cursor() as cur:
        cur.execute(f"UPDATE procesamientos SET {', '.join(sets)} WHERE ocid = %s", (*vals, ocid))

def terminar(ocid: str, ok: bool, error: str | None) -> None:
    with psycopg2.connect(dsn()) as c, c.cursor() as cur:
        if ok:
            # Si el trigger de alertas ya lo marcó procesado, respetarlo; si el pipeline terminó sin alerta, igual cerramos.
            cur.execute("UPDATE procesamientos SET estado='procesado', finalizado_at=COALESCE(finalizado_at, now()), fase_actual='final', fase_index=10 WHERE ocid=%s", (ocid,))
        else:
            cur.execute("UPDATE procesamientos SET estado = CASE WHEN intentos >= 3 THEN 'error' ELSE 'encolado' END, error=%s, worker=NULL WHERE ocid=%s", (error, ocid))

def procesar(ocid: str) -> None:
    log.info("▶ %s", ocid); state: dict = {}; ok = False; err = None
    try:
        with requests.post(f"{AGENT_URL}?stream=1", json={"input": ocid, "ocds": None, "docs_b64": {}, "doc_urls": {}},
                           stream=True, timeout=(30, 3600)) as r:
            r.raise_for_status()
            for line in r.iter_lines(decode_unicode=True):
                if not line: continue
                try: ev = json.loads(line)
                except json.JSONDecodeError: continue
                cambios = reduce_event(state, ev)
                if not cambios: continue
                state.update(cambios)
                evento = {"ts": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "kind": ev.get("kind"),
                          "name": ev.get("name") or ev.get("agent"), "msg": (ev.get("msg") or ev.get("detail") or "")[:200] or None}
                actualizar(ocid, cambios, evento)
                if cambios.get("terminado"): ok = True
        if not ok: err = state.get("error") or "stream terminó sin evento final"
    except Exception as e:  # noqa: BLE001
        err = str(e)[:500]; log.exception("✗ %s", ocid)
    terminar(ocid, ok, err); log.info("%s %s", "✓" if ok else "✗", ocid)

def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname).1s dispatcher · %(message)s")
    deadline = time.time() + MAX_MIN * 60
    with cf.ThreadPoolExecutor(max_workers=PARALLEL) as pool:
        futures: set = set()
        while time.time() < deadline:
            libres = PARALLEL - len(futures)
            for ocid in (reclamar(libres) if libres > 0 else []):
                futures.add(pool.submit(procesar, ocid))
            if not futures: log.info("cola vacía"); break
            done, futures = cf.wait(futures, timeout=30, return_when=cf.FIRST_COMPLETED)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 6: `requirements.txt`** (`requests==2.32.*`, `psycopg2-binary>=2.9`), **`Dockerfile`**:

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . ./backend/dispatcher
ENV PYTHONPATH=/app
CMD ["python", "-m", "backend.dispatcher.main"]
```
(Build context = `backend/dispatcher`; el `COPY . ./backend/dispatcher` reproduce el paquete para que `-m backend.dispatcher.main` funcione.)

- [ ] **Step 7: Prueba local contra prod** (DB real, orquestador real, 1 contrato): `AGENT_URL=https://agent-orchestrator-adk-oq3gq6a4ka-uc.a.run.app PGHOST=34.71.244.66 PGSSLMODE=require PGPASSWORD=… DISPATCHER_PARALLEL=1 DISPATCHER_MAX_MINUTES=15 python -m backend.dispatcher.main`. Antes: validar en `/admin` la contribución `VIG-2026-00002` (Loreto, 5 contratos) si el usuario ya no lo hizo, o crear una de prueba y borrarla después. Esperado: filas de `procesamientos` pasan a `procesando` con `fase_actual` avanzando y terminan `procesado`; aparece la alerta.
- [ ] **Step 8: Commit** `git commit -m "dispatcher: process assigned contracts through the orchestrator and persist live phases"`

### Task B3: Deploy del dispatcher (Cloud Run Job + Scheduler)

**Files:**
- Create: `infrastructure/deploy/dispatcher.sh`
- Modify: `cloudbuild.yaml` (paso `dispatcher`), `infrastructure/README.md`

- [ ] **Step 1: Script**

```bash
#!/usr/bin/env bash
# Cloud Run JOB vigia-dispatcher: procesa contratos asignados. Lo dispara Cloud Scheduler cada 5 min.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
AGENT_URL="${AGENT_URL:-$(gcloud run services describe agent-orchestrator-adk --region "$REGION" --format='value(status.url)')}"
cd "$REPO_ROOT/backend/dispatcher"
gcloud run jobs deploy vigia-dispatcher --source . --region "$REGION" \
  --tasks 1 --max-retries 0 --task-timeout 3600 --cpu 1 --memory 512Mi \
  --set-cloudsql-instances "$SQL_CONNECTION" \
  --set-env-vars "AGENT_URL=${AGENT_URL},PGHOST=/cloudsql/${SQL_CONNECTION},PGUSER=postgres,PGDATABASE=vigia,DISPATCHER_PARALLEL=2,DISPATCHER_MAX_MINUTES=55" \
  --set-secrets "PGPASSWORD=cloudsql-password:latest" --quiet
# Scheduler → ejecuta el job (necesita run.jobs.run en la SA por defecto; ya es editor)
gcloud scheduler jobs describe vigia-dispatcher-run --location "$REGION" >/dev/null 2>&1 \
  && gcloud scheduler jobs update http vigia-dispatcher-run --location "$REGION" --schedule '*/5 * * * *' \
       --uri "https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/jobs/vigia-dispatcher:run" \
       --http-method POST --oauth-service-account-email "36169102688-compute@developer.gserviceaccount.com" --quiet \
  || gcloud scheduler jobs create http vigia-dispatcher-run --location "$REGION" --schedule '*/5 * * * *' \
       --uri "https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/jobs/vigia-dispatcher:run" \
       --http-method POST --oauth-service-account-email "36169102688-compute@developer.gserviceaccount.com" --quiet
```

- [ ] **Step 2: Deploy y ejecución manual** — `bash infrastructure/deploy/dispatcher.sh && gcloud run jobs execute vigia-dispatcher --region us-central1 --wait`. Ver logs: `gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="vigia-dispatcher"' --limit 30`.
- [ ] **Step 3: `cloudbuild.yaml`** — paso `dispatcher` idéntico en forma al de `mcp` pero con `gcloud run jobs deploy vigia-dispatcher --source backend/dispatcher …` (mismos flags del script).
- [ ] **Step 4: README** — sección "Dispatcher" en `infrastructure/README.md` (qué es, cómo ver logs, cómo re-encolar: `UPDATE procesamientos SET estado='encolado', intentos=0 WHERE ocid=…`).
- [ ] **Step 5: Commit** `git commit -m "infra: deploy dispatcher as Cloud Run Job triggered every 5 minutes"`

### Task B4: API pública y admin de procesamientos

**Files:**
- Create: `backend/api/src/routes/procesamientos.ts`
- Modify: `backend/api/src/index.ts` (`app.route("/financiamiento/procesamientos", procesamientosRouter)` **antes** de `financiamientoRouter`), `backend/api/src/routes/admin.ts` (`GET /admin/procesamientos`, `POST /admin/procesamientos/:ocid/reencolar`)

**Interfaces:**
- Produces: exactamente `Procesamiento` y `EventoFase` de la sección "Interfaces compartidas".

- [ ] **Step 1: Router**

```ts
import { Hono } from "hono";
import { z } from "zod";
import { pool } from "../lib/db.js";

export const procesamientosRouter = new Hono();
const cache = (c: any, s: number) => c.header("Cache-Control", `public, s-maxage=${s}, stale-while-revalidate=10`);
const COLS = `ocid, estado, fase_actual AS "faseActual", fase_index AS "faseIndex", iniciado_at AS "iniciadoAt",
  finalizado_at AS "finalizadoAt", intentos, contribucion_codigo AS "contribucionCodigo", financiador,
  financiador_visible AS "financiadorVisible", ubigeo, zona, titulo, entidad, monto_pen::float AS "montoPen",
  alerta_codigo AS "alertaCodigo", score, banderas::int`;
const Q = z.object({
  ubigeo: z.string().regex(/^\d{2,6}$/).optional(), codigo: z.string().max(20).optional(),
  estado: z.enum(["encolado", "procesando", "procesado", "error"]).optional(),
  limit: z.coerce.number().int().min(1).max(300).default(100),
});

procesamientosRouter.get("/", async (c) => {
  const p = Q.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!p.success) return c.json({ error: "invalid_query" }, 400);
  const { ubigeo, codigo, estado, limit } = p.data; const vals: any[] = []; const w: string[] = [];
  if (ubigeo) { vals.push(ubigeo); w.push(`ubigeo LIKE $${vals.length} || '%'`); }
  if (codigo) { vals.push(codigo.toUpperCase()); w.push(`contribucion_codigo = $${vals.length}`); }
  if (estado) { vals.push(estado); w.push(`estado = $${vals.length}`); }
  vals.push(limit);
  const r = await pool.query(`SELECT ${COLS} FROM procesamientos_publico ${w.length ? "WHERE " + w.join(" AND ") : ""}
    ORDER BY CASE estado WHEN 'procesando' THEN 0 WHEN 'encolado' THEN 1 WHEN 'procesado' THEN 2 ELSE 3 END, COALESCE(finalizado_at, iniciado_at, encolado_at) DESC LIMIT $${vals.length}`, vals);
  cache(c, 5); return c.json({ data: r.rows });
});

procesamientosRouter.get("/resumen", async (c) => {
  const r = await pool.query(`SELECT estado, count(*)::int AS n FROM procesamientos GROUP BY estado`);
  const hoy = await pool.query(`SELECT count(*)::int AS n FROM procesamientos WHERE finalizado_at::date = current_date AND estado='procesado'`);
  cache(c, 10); return c.json({ porEstado: Object.fromEntries(r.rows.map((x) => [x.estado, x.n])), procesadosHoy: hoy.rows[0].n });
});

procesamientosRouter.get("/:ocid", async (c) => {
  const ocid = c.req.param("ocid");
  const r = await pool.query(`SELECT ${COLS}, (SELECT eventos FROM procesamientos p WHERE p.ocid = v.ocid) AS eventos FROM procesamientos_publico v WHERE ocid = $1`, [ocid]);
  if (!r.rows.length) return c.json({ error: "not_found" }, 404);
  cache(c, 3); return c.json(r.rows[0]);
});
```

- [ ] **Step 2: Admin** — en `admin.ts`: `GET /admin/procesamientos` (mismo `SELECT` sobre `procesamientos` + `worker`, `error`, `latido_at`, 200 filas) y `POST /admin/procesamientos/:ocid/reencolar` (`UPDATE procesamientos SET estado='encolado', intentos=0, error=NULL, worker=NULL WHERE ocid=$1` + `log(actor,'reencolar',…)`).
- [ ] **Step 3: `npx tsc --noEmit` en `backend/api` → OK. Deploy: `bash infrastructure/deploy/api.sh`. Probar `curl $API/financiamiento/procesamientos/resumen`.**
- [ ] **Step 4: Commit** `git commit -m "api: public live processing endpoints and admin requeue"`

---

# Workstream C — Tablero público en vivo + acto social

### Task C1: Tipos, cliente y etiquetas de fase

**Files:**
- Create: `frontend/lib/auditoria.ts`

```ts
import { API_BASE } from "./api-client";
export type EstadoProc = "encolado" | "procesando" | "procesado" | "error";
export interface Procesamiento { /* copiar EXACTO de "Interfaces compartidas" */ }
export interface EventoFase { ts: string; kind: "phase" | "warn" | "error" | "final"; name: string; msg: string | null }
export const FASES: { key: string; label: string; agente: string }[] = [
  { key: "compliance", label: "Reglas de contratación", agente: "compliance_agent" },
  { key: "document_parser", label: "Lectura del expediente", agente: "document_parser_agent" },
  { key: "document_legal_analyst", label: "Análisis legal de bases", agente: "document_legal_analyst_agent" },
  { key: "market", label: "Precios de mercado", agente: "market_price_agent" },
  { key: "web_research", label: "Investigación web", agente: "web_research_agent" },
  { key: "news_research", label: "Prensa", agente: "news_research_agent" },
  { key: "entity_personnel", label: "Funcionarios de la entidad", agente: "entity_personnel_agent" },
  { key: "person_network", label: "Red de personas", agente: "person_network_agent" },
  { key: "compliance_extended", label: "Cumplimiento extendido", agente: "compliance_extended_agent" },
  { key: "report_writer", label: "Dictamen", agente: "report_writer_agent" },
];
export const ESTADO_PROC: Record<EstadoProc, { label: string; cls: string }> = {
  encolado: { label: "En cola", cls: "bg-paperDeep text-mute" },
  procesando: { label: "Procesando", cls: "bg-amber-soft text-amber" },
  procesado: { label: "Procesado", cls: "bg-moss/10 text-moss" },
  error: { label: "Reintentando", cls: "bg-crimson-soft text-crimson" },
};
async function getJson<T>(path: string, revalidate = 5): Promise<T | null> { /* igual que lib/financiamiento.ts */ }
export const getProcesamientos = (q: { ubigeo?: string; codigo?: string; estado?: EstadoProc; limit?: number } = {}) =>
  getJson<{ data: Procesamiento[] }>(`/financiamiento/procesamientos?${new URLSearchParams(Object.entries(q).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]))}`).then((r) => r?.data ?? null);
export const getProcesamiento = (ocid: string) => getJson<Procesamiento & { eventos: EventoFase[] }>(`/financiamiento/procesamientos/${encodeURIComponent(ocid)}`, 3);
export const getResumenProcesamientos = () => getJson<{ porEstado: Record<string, number>; procesadosHoy: number }>(`/financiamiento/procesamientos/resumen`, 10);
```

- [ ] Commit `git commit -m "frontend: auditoria client and phase labels"`

### Task C2: Componentes de tablero y de contrato en vivo (cliente, con polling)

**Files:**
- Create: `frontend/components/auditoria/EstadoPill.tsx`, `FaseTimeline.tsx`, `TableroAuditoria.tsx`, `ContratoEnVivo.tsx`

- [ ] **`EstadoPill`**: `({estado}) => <span className={ESTADO_PROC[estado].cls + " rounded-full px-2 py-0.5 text-[11px]"}>{label}</span>` con punto pulsante (`animate-pulse`) cuando `procesando`.
- [ ] **`FaseTimeline`**: props `{ faseIndex: number|null; estado: EstadoProc; eventos?: EventoFase[] }`. Lista vertical de las 10 `FASES`: hechas (✓ verde), actual (spinner ámbar + último `msg` del evento con ese `name`), pendientes (gris). Si `estado==="procesado"` todas ✓. Debajo, `eventos` tipo `warn`/`error` como notas pequeñas.
- [ ] **`TableroAuditoria`** (`"use client"`): props `{ ubigeo?: string; codigo?: string; titulo?: string; autoRefreshMs?: number (5000) }`. Hace `fetch` a `${NEXT_PUBLIC_VIGIA_API_URL}/financiamiento/procesamientos?…` cada `autoRefreshMs` (sólo si `document.visibilityState==="visible"`), y renderiza **tres columnas** (`En cola`, `Procesando`, `Procesado`) con tarjetas: título (2 líneas), entidad, zona, monto, "gracias a {financiador}", `EstadoPill`, y en Procesando una mini-barra `faseIndex/10` con el label de fase; en Procesado el número de banderas (🔴 si >0, 🟢 si 0) y link a `/auditoria/{ocid}`. Cada tarjeta es `<Link href={`/auditoria/${ocid}`}>`. Encabezado con contadores por columna y "actualizado hace Ns". Mobile: columnas apiladas con tabs.
- [ ] **`ContratoEnVivo`** (`"use client"`): props `{ ocid: string; initial?: Procesamiento & { eventos: EventoFase[] } }`. Poll cada 3 s mientras `estado` ∈ {encolado, procesando}. Layout: cabecera (título, entidad, zona, monto, "Auditoría financiada por X · VIG-…"), `EstadoPill`, `FaseTimeline`, y al terminar: bloque "Resultado" con score, banderas y botón **"Ver dossier completo →"** a `/app/convocatoria/${ocid}`. Si `estado==="error"`: "Reintentando automáticamente (intento N de 3)".
- [ ] `npx tsc --noEmit` OK. Commit `git commit -m "frontend: live audit board and per-contract live view components"`

### Task C3: Páginas `/auditoria` y `/auditoria/[ocid]`; integrar en impacto y zona

**Files:**
- Create: `frontend/app/(public)/auditoria/page.tsx`, `frontend/app/(public)/auditoria/[ocid]/page.tsx`
- Modify: `frontend/app/(public)/impacto/[codigo]/page.tsx`, `frontend/app/(public)/financiar/[ubigeo]/page.tsx`

- [ ] **`/auditoria`** (server): hero corto "Auditoría en vivo" + `getResumenProcesamientos()` en 3 KPIs (en cola / procesando / procesados hoy) + filtros por región (select con `getZonas("departamento")` con `totalCola>0`, navega con `?ubigeo=`) + `<TableroAuditoria ubigeo={searchParams.ubigeo} />`. `metadata.title = "Auditoría en vivo — Vigía Perú"`. `export const revalidate = 10`.
- [ ] **`/auditoria/[ocid]`** (server → cliente): `getProcesamiento(ocid)`; si null → `notFound()`. Render `<ContratoEnVivo ocid initial={data} />`. Metadata con el título del contrato.
- [ ] **`/impacto/[codigo]`**: reemplazar la lista estática de `detalle` por `<TableroAuditoria codigo={c.codigo} autoRefreshMs={5000} />` debajo del resumen (mantener el resumen). Añadir botón "Compartir" que copie la URL y, si `navigator.share` existe, lo use.
- [ ] **`/financiar/[ubigeo]`**: entre "Qué hay en la cola" y "Provincias", bloque "En vivo ahora en {zona}" = `<TableroAuditoria ubigeo={zona.ubigeo} autoRefreshMs={8000} />` solo si `zona.financiados > 0`; si no, una línea "Cuando alguien financie esta zona, verás aquí cada contrato pasar de la cola al análisis".
- [ ] `npx next build` OK. Commit `git commit -m "frontend: /auditoria live board pages; live status in impact receipt and zone page"`

### Task C4: Muro de aliados + tarjeta OG compartible + sección landing (solo componente)

**Files:**
- Create: `frontend/components/aliados/TarjetaAliado.tsx`, `frontend/components/aliados/MuroAliados.tsx`, `frontend/app/(public)/aliados/page.tsx`, `frontend/app/(public)/impacto/[codigo]/opengraph-image.tsx`

- [ ] **`TarjetaAliado`**: `{row: RankingRow, posicion, destacado?: boolean}` — avatar/logo grande, nombre, "financió la auditoría de N contratos en Z zonas", "M señales halladas gracias a su aporte", medalla en top 3, link a `/aliado/[slug]`.
- [ ] **`MuroAliados`** (server): `getRanking("mes")` y `getRanking("todo")`. Secciones: "Aliados del mes" (grid de `TarjetaAliado` destacado top 3), "Todos los aliados" (grid compacto), "Personas que aportaron de forma anónima: N" (contar `tipo==="persona"` con nombre "Anónimo"). Encabezado: "Gracias a ellos, X contratos públicos fueron leídos este mes".
- [ ] **`/aliados`**: hero "Aliados de transparencia" + copy (vocabulario permitido) + `<MuroAliados />` + CTA a `/financiar`. `revalidate = 300`.
- [ ] **`opengraph-image.tsx`** (Next `ImageResponse`, `runtime = "edge"`, 1200×630): fondo `#14171A`, texto "Auditoría financiada por {financiador}", "{contratos} contratos · {zona}", "{senales} señales de riesgo halladas", pie "vigia.pe/impacto/{codigo}". Datos vía `getComprobante(codigo)`; si null, tarjeta genérica. Verificar con `curl -I https://…/impacto/VIG-2026-00002/opengraph-image` → 200 image/png.
- [ ] `npx next build` OK. Commit `git commit -m "frontend: aliados wall, shareable OG card for impact receipts"`

> La sección de aliados en la landing y el ítem "Aliados" del Header los cablea **D** (Task D4/D1) importando `MuroAliados` con prop `compact`. C debe exponer `MuroAliados({ compact?: boolean })` (compact = solo top 3 del mes + link).

---

# Workstream D — Navegación: mapa como hub, herramientas al admin, landing

### Task D1: Feature flags, Header y Sidebar

**Files:**
- Create: `frontend/lib/flags.ts` → `export const FLAGS = { editorial: process.env.NEXT_PUBLIC_EDITORIAL === "1" };`
- Modify: `frontend/components/Header.tsx` (NAV público: `Mapa → /app/mapa`, `Financiar → /financiar`, `Auditoría en vivo → /auditoria`, `Aliados → /aliados`, `Denunciar → /reporte/nuevo`, `FAQ → /preguntas`; el botón "Financiar" del lado derecho se mantiene), `frontend/components/dashboard/DashboardSidebar.tsx` (secciones: **Explorar**: Mapa `/app/mapa`, Auditoría en vivo `/auditoria`, Aliados `/aliados`; **Acción**: Financiar `/financiar`, Denunciar `/reporte/nuevo`; **Mi cuenta** igual; quitar `Analizar contrato`, `Entidades`, `Alertas`, `Denuncias` de la barra (siguen existiendo como rutas, accesibles desde el mapa); `IA · Generador` sólo si `FLAGS.editorial`).
- [ ] `frontend/app/(dashboard)/noticia/page.tsx`: al inicio `if (!FLAGS.editorial) redirect("/app/mapa")`.
- [ ] Commit `git commit -m "frontend: public navigation centered on map, live audit and allies; editorial behind flag"`

### Task D2: `/app` → mapa hub; panel de zona con entidades, alertas y CTA

**Files:**
- Create: `frontend/components/mapa/ZonaHubPanel.tsx`, `EntidadesDeZona.tsx`, `AlertasDeZona.tsx`
- Modify: `frontend/app/(dashboard)/app/page.tsx` → `export default function AppHome() { redirect("/app/mapa"); }` (**el contenido actual se mueve entero a `/admin/analisis`, Task D3**), `frontend/app/(dashboard)/app/mapa/page.tsx`, `frontend/components/MapaWrapper.tsx`, `frontend/components/RegionDetailPanel.tsx`

- [ ] **`ZonaHubPanel`** (`"use client"`, props `{ regionId: string; ubigeo: string; nombre: string }`): tabs **Resumen · Contratos en cola · Entidades · Alertas · Denuncias**. Resumen = `getZona(ubigeo)` (financiamiento) → cola, financiado, procesado, señales + 2 CTAs grandes: "Financiar auditoría de {nombre}" (`/financiar/{ubigeo}`) y "Denunciar una obra en {nombre}" (`/reporte/nuevo?region={regionId}`) + "Ver en vivo" (`/auditoria?ubigeo={ubigeo}`) si `financiados>0`.
- [ ] **`EntidadesDeZona`**: `getEntidades({region})` (ya existe en `lib/api-client.ts`) → lista con buscador local; cada fila link a `/entidad/[ruc]`.
- [ ] **`AlertasDeZona`**: `getAlertas({region, limit: 20})` → lista compacta (score, objeto, entidad) link a `/app/convocatoria/[ocid]` (o `/alerta/[id]`).
- [ ] **Mapa**: en `MapaWrapper`/`RegionDetailPanel`, al seleccionar región, el panel lateral usa `ZonaHubPanel` (mapear `regionId` → ubigeo de departamento con el `code` del geojson `peru-departments.json`; `REGIONES[].id` ↔ `feature.properties.code`). Mantener pines actuales. Añadir capa "estado de financiamiento" (toggle) que colorea departamentos con `ESTADO_FILL` usando `getZonas("departamento")`.
- [ ] `npx tsc --noEmit` OK. Commit `git commit -m "frontend: map as public hub with zone panel (queue, entities, alerts, actions)"`

### Task D3: Análisis a demanda → `/admin/analisis`

**Files:**
- Create: `frontend/app/admin/analisis/page.tsx`
- Modify: `frontend/components/admin/AdminShell.tsx` (NAV: `{ href: "/admin/analisis", label: "Análisis a demanda", icon: FlaskConical }`, y `{ href: "/admin/procesamientos", label: "Procesamiento", icon: Activity }` → página simple que lista `/api/admin/procesamientos` con botón "re-encolar")

- [ ] Mover el contenido actual de `frontend/app/(dashboard)/app/page.tsx` (buscador + despachar + sortear + análisis recientes) a `app/admin/analisis/page.tsx` envuelto en `<AdminShell title="Análisis a demanda">`. `ConvocatoriaSearch` es cliente y ya funciona fuera del dashboard; verificar que no dependa de `useAuth` (si depende, envolver la página en `AuthProvider` que ya está en el root layout).
- [ ] Crear `frontend/app/admin/procesamientos/page.tsx`: tabla (ocid, estado, fase, intentos, worker, latido, error) + botón re-encolar (`POST /api/admin/procesamientos/:ocid/reencolar`) + link a `/auditoria/[ocid]`.
- [ ] Commit `git commit -m "admin: on-demand analysis and processing monitor pages"`

### Task D4: Landing reorganizada

**Files:**
- Create: `frontend/components/landing/MapaHubSection.tsx`, `frontend/components/landing/AliadosSection.tsx`
- Modify: `frontend/app/(public)/page.tsx`

- [ ] Orden final de secciones: `CinematicHero` → **`MapaHubSection`** (mini `CampaignMap compact` + 3 KPIs: contratos en cola, procesados hoy [`getResumenProcesamientos`], señales halladas; CTA "Explorar el mapa") → `ComoFunciona` → `FinanciaSection` (ya existe) → **`AliadosSection`** (`<MuroAliados compact />` + "Ver todos los aliados") → sección Denuncias (reusar bloque existente de reporte ciudadano) → `PlataformaTabs` → `organizacion` → CTA final. Quitar de la landing cualquier bloque que hable de "IA Generador".
- [ ] `npx next build` OK. Commit `git commit -m "frontend: landing reorganized around map, financing and allies"`

---

## Integración y cierre (lo hace el coordinador después de los 4 WS)

- [ ] Merge de los 4 worktrees a `main` (orden: A, B, D, C — C depende de la API de B y del `MuroAliados` que D importa; resolver conflictos en `backend/api/src/index.ts` y `AdminShell.tsx` si los hay).
- [ ] `npx tsc --noEmit` (api, frontend), `npx next build`, `python -m compileall backend`, `python -m pytest backend/scrapers/tests backend/dispatcher/tests`.
- [ ] Deploy: `bash infrastructure/deploy/api.sh && bash infrastructure/deploy/frontend.sh && bash infrastructure/deploy/dispatcher.sh`.
- [ ] Prueba end-to-end en prod con navegador: `/` → `/app/mapa` → región → "Financiar" → `/financiar/15xx` → aporte → `/admin` validar → `/auditoria` muestra el contrato en cola → dispatcher lo toma → `/auditoria/[ocid]` avanza de fase → procesado → dossier. Capturas de pantalla de cada paso.
- [ ] Actualizar las notas operativas locales (mapa del repo, estado), `docs/design/FINANCIA_UNA_AUDITORIA.md` §8 (fases hechas), memoria.
- [ ] Commit final y push.

## Self-review (hecho al escribir)

- Cobertura: cola real (A), procesamiento automático + en vivo (B+C), mapa como interfaz y herramientas al admin (D), reconocimiento social (C4+D4). ✓
- Placeholders: ninguno; los componentes de UI se describen por props y contenido concreto.
- Consistencia de tipos: `Procesamiento`/`EventoFase` definidos una vez y referenciados por B4 y C1; `FASES` de C1 coincide con `FASES` de B2 (`events.py`).
