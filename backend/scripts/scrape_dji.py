#!/usr/bin/env python3
"""Scraper de las Declaraciones Juradas de Intereses del portal público DJIC (Contraloría), con Playwright.

El portal es ASP.NET WebForms y el captcha es de juguete: su respuesta viaja en claro en el campo oculto
`#hdnCaptchaImg`, así que NO hace falta OCR — se lee del DOM. Flujo por decisor (RUC de entidad + apellidos):
busca → lista declaraciones (con codigo_ddjj) → marca → escribe el captcha → descarga el PDF (SeccionSegunda).

Corre N contextos en paralelo (async). Data pública; se usa a tasa baja. Ver parse_dji_pdf.py para la lectura.

  python backend/scripts/scrape_dji.py --hilos 4           # prueba con los objetivos de muestra
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import time
from pathlib import Path

from playwright.async_api import async_playwright

OUT = Path(r"C:\Users\usuario\Desktop\PROYECTOS\vigia-peru\dataset\declaracion_jurada\pdfs")
BASE = "https://appdji.contraloria.gob.pe/DJIC/ConsultaPublicaDJICRUC.aspx?ruc="

# (ruc_entidad, apellidos) de muestra — decisores con más captura
OBJETIVOS = [
    ("20452393493", "OSCORIMA NUÑEZ"),
    ("20406325815", "HANCCO SONCCO"),
    ("20440374248", "CABRERA PIMENTEL"),
    ("20486021692", "CARDENAS MUJE"),
    ("20493196902", "CHAVEZ SILVANO"),
    ("20498390570", "SANCHEZ SANCHEZ"),
    ("20484004421", "NEYRA LEON"),
    ("20131366702", "ESPINOZA ROSALES"),
]


def destino(out_dir: Path, ruc: str, apellidos: str) -> Path:
    return out_dir / f"{ruc}_{apellidos.replace(' ', '_').replace('/', '-')}.pdf"


async def bajar(ctx, ruc: str, apellidos: str, out_dir: Path) -> dict:
    t0 = time.time()
    pg = await ctx.new_page()
    pg.set_default_timeout(40000)
    try:
        await pg.goto(BASE + ruc)
        await pg.wait_for_timeout(2000)
        await pg.fill("#txtApellidos", apellidos)
        await pg.click("#btnBuscarDec")
        await pg.wait_for_timeout(3000)
        # ¿hay resultados?
        filas = await pg.eval_on_selector_all("table tr",
            "els => els.map(e=>e.innerText.replace(/\\s+/g,' ').trim()).filter(t=>/declaracion/i.test(t)).length")
        cap = await pg.eval_on_selector("#hdnCaptchaImg", "e=>e.value")
        cbs = await pg.query_selector_all("#cb_gridBusqueda, tr input[type=checkbox]")
        if not cbs or not cap:
            return {"ruc": ruc, "apellidos": apellidos, "ok": False, "motivo": "sin resultados/captcha", "seg": round(time.time() - t0, 1)}
        await cbs[0].check()
        await pg.fill("#txtCaptchaPub", cap)
        out_dir.mkdir(parents=True, exist_ok=True)
        dest = destino(out_dir, ruc, apellidos)
        async with pg.expect_download(timeout=55000) as di:
            await pg.click("#btnDownloadDJ")
        d = await di.value
        await d.save_as(str(dest))
        return {"ruc": ruc, "apellidos": apellidos, "ok": True, "pdf": dest.name,
                "kb": round(dest.stat().st_size / 1024), "seg": round(time.time() - t0, 1)}
    except Exception as e:
        return {"ruc": ruc, "apellidos": apellidos, "ok": False, "motivo": str(e)[:80], "seg": round(time.time() - t0, 1)}
    finally:
        await pg.close()


async def correr(hilos: int, objetivos: list[tuple[str, str]], out_dir: Path, log_path: Path) -> None:
    t0 = time.time()
    out_dir.mkdir(parents=True, exist_ok=True)
    # resumible: saltar los que ya tienen PDF
    pendientes = [(r, a) for r, a in objetivos if not destino(out_dir, r, a).exists()]
    hechos0 = len(objetivos) - len(pendientes)
    print(f"{len(objetivos)} targets · {hechos0} ya bajados · {len(pendientes)} pendientes · {hilos} hilos")
    sem = asyncio.Semaphore(hilos)
    done = {"ok": 0, "fail": 0, "n": 0}
    logf = open(log_path, "a", encoding="utf-8", newline="")
    logw = csv.writer(logf)
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True)

        async def tarea(ruc, ape):
            async with sem:
                r = None
                for intento in range(2):  # 2 intentos por pase; los fallos se reintentan en un re-run (resume)
                    ctx = await b.new_context(accept_downloads=True)
                    try:
                        r = await bajar(ctx, ruc, ape, out_dir)
                        if r["ok"] or "sin resultados" in r.get("motivo", ""):
                            break
                    finally:
                        await ctx.close()
                    await asyncio.sleep(2 + intento * 3)
                done["n"] += 1
                done["ok" if r and r["ok"] else "fail"] += 1
                logw.writerow([ruc, ape, r["ok"], r.get("pdf") or r.get("motivo", "")[:60]])
                logf.flush()
                if done["n"] % 25 == 0:
                    el = time.time() - t0
                    rate = done["n"] / el * 3600
                    print(f"  {done['n']}/{len(pendientes)} · ok={done['ok']} fail={done['fail']} · {rate:.0f}/h · {el/60:.1f}min", flush=True)
                return r

        await asyncio.gather(*[tarea(r, a) for r, a in pendientes])
        await b.close()
    logf.close()
    print(f"\n=== fin: ok={done['ok']} fail={done['fail']} de {len(pendientes)} · {(time.time()-t0)/60:.1f} min ===")


def leer_targets(csv_path: str) -> list[tuple[str, str]]:
    out = []
    with open(csv_path, encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            if row.get("ruc") and row.get("apellidos"):
                out.append((row["ruc"].strip(), row["apellidos"].strip()))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--hilos", type=int, default=3)
    ap.add_argument("--targets", help="CSV con columnas ruc,apellidos")
    ap.add_argument("--out", default=str(OUT), help="carpeta de PDFs")
    ap.add_argument("--log", default=None, help="CSV de progreso (por defecto <out>/_log.csv)")
    ap.add_argument("--shard", help="i/N: procesa solo la porción i de N (para CI en paralelo)")
    ap.add_argument("--n", type=int, default=4, help="si no hay --targets, cuántos objetivos de muestra")
    a = ap.parse_args()
    objetivos = leer_targets(a.targets) if a.targets else OBJETIVOS[: a.n]
    if a.shard:
        i, nn = (int(x) for x in a.shard.split("/"))
        objetivos = objetivos[i::nn]
        print(f"shard {i}/{nn}: {len(objetivos)} targets")
    out_dir = Path(a.out)
    log_path = Path(a.log) if a.log else out_dir / "_log.csv"
    asyncio.run(correr(a.hilos, objetivos, out_dir, log_path))


if __name__ == "__main__":
    main()
