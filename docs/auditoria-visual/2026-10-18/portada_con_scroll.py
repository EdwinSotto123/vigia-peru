import asyncio, sys
from playwright.async_api import async_playwright
B, OUT = sys.argv[1], sys.argv[2]
async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path="C:/Program Files/Google/Chrome/Application/chrome.exe", headless=True)
        for disp, vp, movil in (("pc", {"width": 1440, "height": 900}, False), ("movil", {"width": 390, "height": 844}, True)):
            ctx = await br.new_context(viewport=vp, is_mobile=movil, has_touch=movil)
            pg = await ctx.new_page()
            await pg.goto(B + "/", wait_until="networkidle", timeout=180000)
            alto = await pg.evaluate("document.documentElement.scrollHeight")
            y, i, vacios = 0, 0, []
            while y < alto:
                await pg.evaluate(f"window.scrollTo(0, {y})"); await pg.wait_for_timeout(1300)
                # ¿cuánto de la pantalla tiene contenido visible?
                lleno = await pg.evaluate("""() => { let l=0,t=0; for (let yy=10; yy<innerHeight; yy+=30) for (let xx=10; xx<innerWidth; xx+=30) { t++; const e=document.elementFromPoint(xx,yy); if (e && e.closest('h1,h2,h3,p,li,a,button,img,svg,canvas,table,span') && getComputedStyle(e).opacity !== '0') l++; } return Math.round(100*l/t); }""")
                vacios.append((i, y, lleno))
                if i % 2 == 0 or lleno < 8:
                    await pg.screenshot(path=f"{OUT}/portada-{disp}-tramo{i:02d}.jpg", type="jpeg", quality=65)
                y += vp["height"]; i += 1
                alto = await pg.evaluate("document.documentElement.scrollHeight")
            print(disp, "alto", alto, "pantallas", i, "con poco contenido (<8%):", [(a, b, c) for a, b, c in vacios if c < 8])
            await ctx.close()
        await br.close()
asyncio.run(main())
