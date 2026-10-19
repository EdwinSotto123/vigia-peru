"""Capturas (PC 1440x900 y celular 390x844) y chequeos automáticos de cada página. Uso: python auditoria_visual.py BASE CARPETA_IMG salida.json"""
import asyncio, sys, json
from playwright.async_api import async_playwright
B, OUT, JSON_OUT = sys.argv[1], sys.argv[2], sys.argv[3]
PAGINAS = [
    ("portada", "/"), ("inicio", "/app"), ("mapa", "/app/mapa"), ("mapa-region", "/app/mapa?region=cusco"),
    ("contratos", "/app/contratos"), ("contratos-filtrados", "/app/contratos?lectura=publicado&riesgo=alto"),
    ("ficha", "/app/contratos/1228396"), ("dictamen", "/app/contratos/1228810?vista=dictamen"), ("en-vivo", "/app/contratos/1228810?vista=vivo"),
    ("senales", "/app/hallazgos"), ("entidades", "/app/entidades"), ("entidad", "/entidad/20538298485"),
    ("partidos", "/app/partidos"), ("financiar", "/app/financiar"), ("auditoria", "/app/auditoria"), ("aliados", "/app/aliados"),
    ("denunciar", "/reporte/nuevo"), ("denuncias", "/app/denuncias"), ("preguntas", "/preguntas"),
]
CHEQUEOS = """() => {
  const vw = innerWidth, out = {};
  out.alto = document.documentElement.scrollHeight;
  out.desborde_horizontal = document.documentElement.scrollWidth > vw + 1 ? document.documentElement.scrollWidth - vw : 0;
  const visibles = [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; });
  // Elementos que salen por la derecha de la pantalla (causa del desborde)
  out.salen_por_derecha = visibles.filter(e => e.getBoundingClientRect().right > vw + 2 && !e.closest('[class*=overflow-x-auto],[class*=overflow-auto],[class*=overflow-hidden]')).slice(0, 5).map(e => (e.tagName + '.' + (e.className?.toString() || '').split(' ').slice(0, 3).join('.')).slice(0, 90));
  // Texto chico (< 12 px) con contenido propio
  const conTexto = visibles.filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 1));
  out.texto_menor_12px = conTexto.filter(e => parseFloat(getComputedStyle(e).fontSize) < 12).length;
  out.texto_total = conTexto.length;
  // Objetivos táctiles chicos (< 32 px de alto o ancho) en enlaces y botones visibles
  const toques = visibles.filter(e => e.matches('a,button,[role=button],select,input'));
  out.toques_chicos = toques.filter(e => { const r = e.getBoundingClientRect(); return (r.height < 32 || r.width < 32) && r.top < document.documentElement.scrollHeight; }).length;
  out.toques_total = toques.length;
  // Texto truncado (ellipsis): títulos que no se leen enteros
  out.truncados = visibles.filter(e => { const cs = getComputedStyle(e); return cs.textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 1; }).length;
  // Accesibilidad básica
  out.img_sin_alt = [...document.querySelectorAll('img')].filter(i => !i.hasAttribute('alt')).length;
  out.botones_sin_nombre = [...document.querySelectorAll('button,a')].filter(b => !(b.innerText || '').trim() && !b.getAttribute('aria-label') && !b.getAttribute('title') && !b.querySelector('[aria-label],img[alt],svg title')).length;
  out.h1 = [...document.querySelectorAll('h1')].map(h => h.innerText.trim().slice(0, 60));
  // Primer pantallazo: cuánto es contenido real (texto/medios) vs vacío (aprox. por muestreo)
  let llenos = 0, total = 0;
  for (let y = 10; y < innerHeight; y += 24) for (let x = 10; x < vw; x += 24) { total++; const e = document.elementFromPoint(x, y); if (e && (e.closest('h1,h2,h3,p,li,a,button,img,svg,canvas,table,select,input,label,span'))) llenos++; }
  out.primer_pantallazo_con_contenido = Math.round(100 * llenos / total);
  return out;
}"""
async def main():
    res = {}
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path="C:/Program Files/Google/Chrome/Application/chrome.exe", headless=True)
        for disp, vp, movil in (("pc", {"width": 1440, "height": 900}, False), ("movil", {"width": 390, "height": 844}, True)):
            ctx = await br.new_context(viewport=vp, is_mobile=movil, has_touch=movil, device_scale_factor=1,
                                       user_agent=("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148" if movil else None))
            for slug, ruta in PAGINAS:
                pg = await ctx.new_page(); errs = []
                pg.on("pageerror", lambda e: errs.append(str(e)[:120]))
                try:
                    await pg.goto(B + ruta, wait_until="networkidle", timeout=180000)
                except Exception:
                    pass
                await pg.wait_for_timeout(2500)
                await pg.screenshot(path=f"{OUT}/{slug}-{disp}.jpg", type="jpeg", quality=72)
                await pg.screenshot(path=f"{OUT}/{slug}-{disp}-completa.jpg", type="jpeg", quality=60, full_page=True)
                m = await pg.evaluate(CHEQUEOS); m["errores_js"] = errs
                res[f"{slug}|{disp}"] = m
                print(disp, slug, json.dumps({k: m[k] for k in ("alto", "desborde_horizontal", "texto_menor_12px", "toques_chicos", "truncados", "img_sin_alt", "botones_sin_nombre", "primer_pantallazo_con_contenido")}), m["salen_por_derecha"][:2], errs[:1], flush=True)
                await pg.close()
            await ctx.close()
        await br.close()
    json.dump(res, open(JSON_OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
asyncio.run(main())
