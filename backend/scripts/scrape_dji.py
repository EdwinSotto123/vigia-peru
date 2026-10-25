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


async def bajar(ctx, ruc: str, apellidos: str) -> dict:
    t0 = time.time()
    pg = await ctx.new_page()
    pg.set_default_timeout(30000)
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
        OUT.mkdir(parents=True, exist_ok=True)
        dest = OUT / f"{ruc}_{apellidos.replace(' ', '_')}.pdf"
        async with pg.expect_download(timeout=25000) as di:
            await pg.click("#btnDownloadDJ")
        d = await di.value
        await d.save_as(str(dest))
        return {"ruc": ruc, "apellidos": apellidos, "ok": True, "pdf": dest.name,
                "kb": round(dest.stat().st_size / 1024), "seg": round(time.time() - t0, 1)}
    except Exception as e:
        return {"ruc": ruc, "apellidos": apellidos, "ok": False, "motivo": str(e)[:80], "seg": round(time.time() - t0, 1)}
    finally:
        await pg.close()


async def correr(hilos: int, objetivos: list[tuple[str, str]]) -> None:
    t0 = time.time()
    sem = asyncio.Semaphore(hilos)
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True)

        async def tarea(ruc, ape):
            async with sem:
                for intento in range(3):  # reintentos: el portal se pone lento bajo concurrencia
                    ctx = await b.new_context(accept_downloads=True)
                    try:
                        r = await bajar(ctx, ruc, ape)
                        if r["ok"] or "sin resultados" in r.get("motivo", ""):
                            return r
                    finally:
                        await ctx.close()
                    await asyncio.sleep(2 + intento * 3)
                return r

        res = await asyncio.gather(*[tarea(r, a) for r, a in objetivos])
        await b.close()
    ok = sum(1 for r in res if r["ok"])
    print(f"\n=== {ok}/{len(res)} OK · {hilos} hilos · {time.time() - t0:.1f}s total ===")
    for r in res:
        print("  ", r)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--hilos", type=int, default=4)
    ap.add_argument("--n", type=int, default=4, help="cuántos objetivos de muestra probar")
    a = ap.parse_args()
    asyncio.run(correr(a.hilos, OBJETIVOS[: a.n]))


if __name__ == "__main__":
    main()
