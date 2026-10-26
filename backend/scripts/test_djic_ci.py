#!/usr/bin/env python3
"""Prueba en CI: flujo completo DJIC con navegador (buscar → captcha del DOM → descargar → parsear).
Confirma que el runner de GitLab puede operar el portal de punta a punta. Portable (Linux/CI)."""
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from parse_dji_pdf import familiares_pdf  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

RUC, APELLIDOS = "20131378034", "MALDONADO AMAO"
BASE = "https://appdji.contraloria.gob.pe/DJIC/ConsultaPublicaDJICRUC.aspx?ruc="
DEST = "/tmp/djic_ci.pdf"


async def main() -> int:
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True)
        ctx = await b.new_context(accept_downloads=True)
        pg = await ctx.new_page()
        pg.set_default_timeout(40000)
        await pg.goto(BASE + RUC)
        await pg.wait_for_timeout(2500)
        await pg.fill("#txtApellidos", APELLIDOS)
        await pg.click("#btnBuscarDec")
        await pg.wait_for_timeout(3500)
        cap = await pg.eval_on_selector("#hdnCaptchaImg", "e=>e.value")
        cbs = await pg.query_selector_all("#cb_gridBusqueda, tr input[type=checkbox]")
        print(f"captcha(DOM)={cap!r} checkboxes={len(cbs)}")
        if not cap or not cbs:
            print("FALLO: sin captcha/resultados (posible bloqueo o flujo roto)")
            return 1
        await cbs[0].check()
        await pg.fill("#txtCaptchaPub", cap)
        async with pg.expect_download(timeout=30000) as di:
            await pg.click("#btnDownloadDJ")
        d = await di.value
        await d.save_as(DEST)
        await b.close()
    kb = os.path.getsize(DEST) // 1024
    fams = familiares_pdf(DEST)
    print(f"PDF {kb}KB · familiares parseados: {len(fams)}")
    for f in fams[:5]:
        print("  ", f["doc"], f["grado"], f["parentesco"][:22], f["nombre"][:28])
    print("CI DJIC FLOW OK" if fams else "FALLO: sin familiares")
    return 0 if fams else 1


sys.exit(asyncio.run(main()))
