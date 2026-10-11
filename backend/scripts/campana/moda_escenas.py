#!/usr/bin/env python3
"""Arma el markup de Moda y el programa de movimiento de cada escena de un video de TikTok (1080 x 1920).

Lee la configuración de escenas de un JSON (ver escenas_T1.json) y las marcas de voz alineadas
(marcas_alineadas.json de colocar_voz.py), y escribe en <salida>/ un archivo por página:

    <video>_<pagina>_markup.xml    para canvas_apply_markup   (diseño estático de la escena)
    <video>_<pagina>_motion.js     para canvas_edit            (movimiento: Ken Burns, fundidos, subtítulos palabra a palabra)

El movimiento busca los nodos por su nombre (metadata.name), así no hace falta leer los ids a mano.

Tipos de escena: foto (imagen generada a pantalla completa), mapa (el Perú hecho de puntos), telefono (captura real en un
teléfono), chispas (puntos que suben), cierre (ojo de puntos y llamada a la acción).

    python moda_escenas.py escenas_T1.json --voz ../../../../campanas-vigia/audio/voz/T1 --puntos ../../../../campanas-vigia/assets/tiktok/T1T2 --salida .../markup
"""

from __future__ import annotations

import argparse
import json
from html import escape
from pathlib import Path

LIMA, TINTA, CARBON, SUAVE = "#D4FF3F", "#E9F0EC", "#0B0F0F", "#B5C2BC"
ANCHO, ALTO = 1080, 1920
PAGINAS = "abcdefghijklmnop"


def partes_html(partes: list, estilo: str) -> str:
    """[['texto', 'lima'|None], ...] a <span> con color. `\n` en el texto se vuelve <br/>."""
    out = []
    for p in partes:
        txt, enf = (p[0], p[1]) if isinstance(p, (list, tuple)) else (p, None)
        txt = escape(txt).replace("\n", "<br/>")
        color = LIMA if enf else TINTA
        out.append(f'<span style="color:{color}">{txt}</span>')
    return f'<p style="{estilo}">{"".join(out)}</p>'


def texto_plano(partes: list) -> str:
    return "".join(p[0] if isinstance(p, (list, tuple)) else p for p in partes)


def nodo_sub(partes: list, y: int = 1150) -> str:
    """Subtítulo grabado: caja carbón al 70 % y texto Inter 700 de 62 px, máximo 2 líneas."""
    n = len(texto_plano(partes))
    lineas = 1 if n <= 24 else 2
    alto = 44 + lineas * 72
    estilo = "font-family:Inter;font-weight:700;font-size:62px;line-height:1.12"
    return (
        f'<rectangle name="caja_sub" x="90" y="{y}" width="900" height="{alto}" corner-radius="28" fill="rgba(11,15,15,0.72)"/>'
        f'<text name="sub" x="125" y="{y + 20}" width="830" height="{alto - 36}" max-lines="2" format="html">'
        f'{partes_html(partes, estilo)}</text>'
    )


def nodo_big(partes: list, y: int = 262, tam: int = 104, ancho: int = 900, lineas: int = 3) -> str:
    estilo = f"font-family:Space Grotesk;font-weight:700;font-size:{tam}px;line-height:1.02"
    return (f'<text name="big" x="90" y="{y}" width="{ancho}" height="{int(tam * 1.1 * lineas)}" max-lines="{lineas}" format="html">'
            f'{partes_html(partes, estilo)}</text>')


def nodo_aviso(texto: str, y: int = 1368) -> str:
    return (f'<text name="aviso" x="90" y="{y}" width="900" font-family="Space Grotesk" font-size="30" font-weight="600" '
            f'letter-spacing="2" color="{SUAVE}">{escape(texto.upper())}</text>')


def velos(arriba: int = 560) -> str:
    return (
        f'<rectangle name="velo_arriba" x="0" y="0" width="1080" height="{arriba}" fill="linear-gradient(180deg, rgba(11,15,15,0.66) 0%, rgba(11,15,15,0) 100%)"/>'
        '<rectangle name="velo_abajo" x="0" y="880" width="1080" height="1040" fill="linear-gradient(180deg, rgba(11,15,15,0) 0%, rgba(11,15,15,0.92) 100%)"/>'
    )


def ojo_destello(cx: int, cy: int) -> str:
    return f'<ellipse name="ojo" cx="{cx}" cy="{cy}" r="9" fill="{LIMA}" shadow="0,0,26,{LIMA}"/>'


NEGRO = f'<rectangle name="negro" x="0" y="0" width="{ANCHO}" height="{ALTO}" fill="{CARBON}" opacity="0"/>'


def franja_aguayo(y: int, alto: int = 12) -> str:
    colores = ["#B8372E", "#D9A441", "#1E7F74", LIMA, "#7A2E5B", "#D9A441"]
    return (f'<generate>const C={json.dumps(colores)};for(let i=0;i<36;i++){{emit("rectangle",{{name:"aguayo_"+i,x:i*30,y:{y},width:30,height:{alto},fill:C[i%C.length]}});}}</generate>')


def datos_mapa(puntos_dir: Path, escala: float, cx: float, y0: float) -> tuple[str, float, float, float]:
    m = json.loads((puntos_dir / "peru_puntos.json").read_text(encoding="utf-8"))
    xs = [p[0] for g in m["grupos"] for p in g["puntos"]]
    ys = [p[1] for g in m["grupos"] for p in g["puntos"]]
    xmin, xmax, ymin, ymax = min(xs), max(xs), min(ys), max(ys)
    ox = cx - (xmin + xmax) / 2 * escala
    oy = y0 - ymin * escala
    plano = []
    for gi, g in enumerate(m["grupos"]):
        for x, y in g["puntos"]:
            plano += [round(x * escala + ox), round(y * escala + oy), gi % 4]
    return json.dumps(plano, separators=(",", ":")), (xmax - xmin) * escala, (ymax - ymin) * escala, y0


def markup_mapa(puntos_dir: Path, big, sub, y_mapa: int, escala: float = 0.92) -> tuple[str, dict]:
    plano, w, h, y0 = datos_mapa(puntos_dir, escala, 540, y_mapa)
    r = round(3.6 * escala + 0.6, 1)
    gen = (f'<generate>const D={plano};const O=[1,0.78,0.92,0.66];for(let i=0;i<D.length;i+=3){{emit("ellipse",{{name:"punto_"+(i/3),cx:D[i],cy:D[i+1],r:{r},fill:"{LIMA}",opacity:O[D[i+2]]}});}}</generate>')
    cover_y = y0 - 20
    cover_h = h + 60
    cover = f'<rectangle name="tapa" x="0" y="{cover_y:.0f}" width="1080" height="{cover_h:.0f}" fill="{CARBON}"/>'
    barrido = (f'<rectangle name="barrido" x="0" y="{y0 + h - 40:.0f}" width="1080" height="110" '
               f'fill="linear-gradient(180deg, rgba(212,255,63,0) 0%, rgba(212,255,63,0.55) 50%, rgba(212,255,63,0) 100%)"/>')
    return gen + cover + barrido, {"cover_y": cover_y, "cover_h": cover_h, "y_base_barrido": y0 + h - 40, "y_tope": y0 - 60}


def markup_ojo(puntos_dir: Path, cx: int, cy: int, escala: float) -> str:
    e = json.loads((puntos_dir / "ojo_puntos.json").read_text(encoding="utf-8"))
    cols = {"contorno": LIMA, "iris1": LIMA, "iris2": LIMA, "iris3": LIMA, "pupila": "#FFFFFF", "ceja": LIMA}
    ops = {"contorno": 1.0, "iris1": 0.95, "iris2": 0.62, "iris3": 0.38, "pupila": 1.0, "ceja": 0.7}
    plano = []
    for x, y, r, capa in e["puntos"]:
        plano.append([round(cx + x * escala), round(cy + y * escala), round(r * escala, 1), capa])
    js = json.dumps(plano, separators=(",", ":"), ensure_ascii=False)
    return (f'<generate>const D={js};const C={json.dumps(cols)};const O={json.dumps(ops)};'
            f'for(let i=0;i<D.length;i++){{emit("ellipse",{{name:"ojo_"+i,cx:D[i][0],cy:D[i][1],r:D[i][2],fill:C[D[i][3]],opacity:O[D[i][3]]}});}}</generate>')


def markup_telefono(file_ref: str, y: int = 560, alto_pantalla: int = 840) -> str:
    # marco, ventana de pantalla con recorte y la captura real (470 de ancho)
    return (
        f'<rectangle name="marco" x="290" y="{y - 20}" width="500" height="{alto_pantalla + 40}" corner-radius="58" fill="#121818" stroke="#33423F" stroke-width="3" shadow="0,18,50,rgba(0,0,0,0.6)"/>'
        f'<group name="pantalla" clip="true"><rectangle name="mascara" x="305" y="{y}" width="470" height="{alto_pantalla}" corner-radius="44" fill="#000000"/>'
        f'<image name="captura" src="{file_ref}" x="305" y="{y}" width="470" height="1019" fit="cover"/></group>'
    )


def markup_pagina(e: dict, cfg: dict, puntos_dir: Path) -> tuple[str, dict]:
    """Devuelve (markup, info). `info` guarda lo que el programa de movimiento necesita saber."""
    t = e["tipo"]
    info: dict = {}
    partes = ['<content><background fill="#0B0F0F"/>']
    if t == "foto":
        partes.append('<rectangle name="foto" x="-60" y="-100" width="1200" height="2120" fill="#182020"/>')
        partes.append(velos())
        partes.append(ojo_destello(*e.get("ojo", (940, 330))))
    elif t == "mapa":
        sec, info = markup_mapa(puntos_dir, e.get("big"), e.get("sub"), e.get("y_mapa", 480))
        partes.append(sec)
        partes.append(ojo_destello(*e.get("ojo", (940, 330))))
    elif t == "telefono":
        partes.append(f'<rectangle name="fondo_tel" x="0" y="0" width="1080" height="1920" fill="linear-gradient(180deg, #0B0F0F 0%, #101818 100%)"/>')
        partes.append(markup_telefono(cfg["captura"], e.get("y_tel", 560), e.get("alto_tel", 840)))
        partes.append(ojo_destello(*e.get("ojo", (940, 330))))
    elif t == "chispas":
        n = e.get("n", 90)
        partes.append('<generate>let s=7;const R=()=>{s=(s*1103515245+12345)%2147483648;return s/2147483648;};'
                      f'for(let i=0;i<{n};i++){{const x=120+R()*840;const y=420+R()*820;emit("ellipse",{{name:"chispa_"+i,cx:Math.round(x),cy:Math.round(y),r:Math.round(3+R()*7),fill:"{LIMA}",opacity:Math.round((0.35+R()*0.65)*100)/100}});}}</generate>')
        partes.append(ojo_destello(*e.get("ojo", (940, 330))))
    elif t == "cierre":
        partes.append(markup_ojo(puntos_dir, 540, e.get("y_ojo", 520), e.get("escala_ojo", 0.9)))
        esc = e.get("escala_ojo", 0.9)
        cy_o = e.get("y_ojo", 520)
        partes.append(f'<rectangle name="parpado" x="{540 - 205 * esc:.0f}" y="{cy_o - 125 * esc:.0f}" width="{410 * esc:.0f}" height="{235 * esc:.0f}" fill="{CARBON}" opacity="0"/>')
        partes.append(franja_aguayo(1404))
    if e.get("big") and t != "cierre":
        partes.append(nodo_big(e["big"], e.get("y_big", 262), e.get("tam_big", 104), lineas=e.get("lineas_big", 3)))
    if t == "cierre":
        partes.append(nodo_big(e["big"], 860, 84, lineas=3))
        partes.append(f'<text name="cta1" x="90" y="1150" width="900" font-family="Space Grotesk" font-size="46" font-weight="700" color="{LIMA}">{escape(e["cta1"])}</text>')
        partes.append(f'<text name="cta2" x="90" y="1226" width="900" font-family="Inter" font-size="40" font-weight="600" color="{TINTA}">{escape(e["cta2"])}</text>')
        partes.append(f'<text name="firma" x="90" y="1306" width="900" font-family="Inter" font-size="30" font-weight="500" color="{SUAVE}" max-lines="2">{escape(e["firma"])}</text>')
    if e.get("sub"):
        partes.append(nodo_sub(e["sub"], e.get("y_sub", 1150)))
    if e.get("aviso"):
        partes.append(nodo_aviso(e["aviso"]))
    partes.append(NEGRO)
    partes.append("</content>")
    return "".join(partes), info


def programa(e: dict, vp: dict, info: dict, pid: str, dur_ms: int, fade_in: int, fade_out: int) -> str:
    """Programa canvas_edit (movimiento) de una escena. Tiempos de página en ms; la voz arranca en `vp['voz_rel']`."""
    L = []
    L.append("const N={};nodes.forEach(n=>{const k=n.metadata&&n.metadata.name;if(k)N[k]=n.id;});")
    L.append(f"motion.page('{pid}',{{durationMs:{dur_ms}}},(t)=>{{")
    t = e["tipo"]
    kb = e.get("kb", [1.0, 1.12])
    if t == "foto":
        dx = e.get("deriva_x", [-60, -20])
        L.append(f"t.tween(N.foto,'scale',[{kb[0]},{kb[1]}],{{durationMs:{dur_ms},easing:'easeInOut'}});")
        L.append(f"t.tween(N.foto,'x',[{dx[0]},{dx[1]}],{{durationMs:{dur_ms},easing:'easeInOut'}});")
    if t == "mapa":
        d_rev = e.get("rev_ms", 2600)
        ini = e.get("rev_ini", 300)
        L.append(f"t.tween(N.tapa,'height',[{info['cover_h']:.0f},0],{{startMs:{ini},durationMs:{d_rev},easing:'easeInOut'}});")
        L.append(f"t.tween(N.barrido,'y',[{info['y_base_barrido']:.0f},{info['y_tope']:.0f}],{{startMs:{ini},durationMs:{d_rev},easing:'easeInOut'}});")
        L.append(f"t.tween(N.barrido,'opacity',[1,0],{{startMs:{ini + d_rev - 300},durationMs:300}});")
    if t == "telefono":
        d0, d1 = e.get("scroll", [0, 0])
        if d1:
            L.append(f"t.tween(N.captura,'y',[{e.get('y_tel', 560)},{e.get('y_tel', 560) - d1}],{{startMs:400,durationMs:{dur_ms - 700},easing:'easeInOut'}});")
        L.append(f"t.tween(N.marco,'scale',[1,1.035],{{durationMs:{dur_ms},easing:'easeInOut'}});")
    if t == "chispas":
        L.append("nodes.filter(n=>n.metadata&&n.metadata.name&&n.metadata.name.indexOf('chispa_')===0).forEach((n,i)=>{"
                 f"t.tween(n.id,'y',[n.y+{e.get('sube', 300)},n.y],{{startMs:i*{e.get('cada', 22)},durationMs:1500,easing:'easeOut'}});"
                 f"t.tween(n.id,'opacity',[0,n.opacity===undefined?1:n.opacity],{{startMs:i*{e.get('cada', 22)},durationMs:500}});}});")
    if t == "cierre":
        L.append("nodes.filter(n=>n.metadata&&n.metadata.name&&n.metadata.name.indexOf('ojo_')===0).forEach((n,i)=>{"
                 "t.tween(n.id,'scale',[0,1],{startMs:Math.round(i*6),durationMs:420,easing:'easeOutCubic'});});")
        kfp = []
        for a_, b_ in e.get("parpadeos", [[1300, 1460], [2500, 2660]]):
            kfp += [f"{{tMs:{a_},value:0}}", f"{{tMs:{(a_ + b_) // 2},value:1}}", f"{{tMs:{b_},value:0}}"]
        L.append(f"t.keyframes(N.parpado,'opacity',[{{tMs:0,value:0}},{','.join(kfp)}]);")
        L.append(f"t.effect(N.big,'opacity-fade-in',{{startMs:{e.get('big_t', 700)},durationMs:500}});")
        L.append(f"t.effect(N.cta1,'opacity-fade-in',{{startMs:{e.get('cta_t', 1500)},durationMs:400}});")
        L.append(f"t.effect(N.cta2,'opacity-fade-in',{{startMs:{e.get('cta_t', 1500) + 350},durationMs:400}});")
        L.append(f"t.effect(N.firma,'opacity-fade-in',{{startMs:{e.get('cta_t', 1500) + 800},durationMs:500}});")
    if e.get("ojo_destello", True) and t != "cierre":
        L.append("t.effect(N.ojo,'pulse',{startMs:0});")
    # fundidos de entrada y de salida (cortes secos si valen 0)
    kf = []
    if fade_in:
        kf += [f"{{tMs:0,value:1}}", f"{{tMs:{fade_in},value:0}}"]
    else:
        kf += ["{tMs:0,value:0}"]
    if fade_out:
        if not fade_in:
            pass
        kf += [f"{{tMs:{dur_ms - fade_out},value:0}}", f"{{tMs:{dur_ms},value:1}}"]
    if fade_in or fade_out:
        L.append(f"t.keyframes(N.negro,'opacity',[{','.join(kf)}]);")
    else:
        L.append("t.keyframes(N.negro,'opacity',[{tMs:0,value:0},{tMs:10,value:0}]);")
    # texto grande
    if e.get("big") and t != "cierre":
        L.append(f"t.recipe(N.big,'recipe-fade-word',{{at:{e.get('big_t', 250)},speed:{e.get('big_speed', 3.2)}}});")
    if e.get("sub"):
        L.append(f"t.setLifetime(N.caja_sub,{{startMs:{vp['sub_t'] - 150},endMs:{dur_ms}}});")
        L.append(f"t.setLifetime(N.sub,{{startMs:{vp['sub_t'] - 150},endMs:{dur_ms}}});")
        L.append(f"t.recipe(N.sub,'recipe-fade-word',{{at:{vp['sub_t']},speed:{vp['sub_speed']}}});")
    if e.get("aviso"):
        a0, a1 = e["aviso_ms"]
        L.append(f"t.setLifetime(N.aviso,{{startMs:{a0},endMs:{a1}}});")
        L.append(f"t.effect(N.aviso,'opacity-fade-in',{{startMs:{a0},durationMs:350}});")
    L.append("});")
    return "".join(x for x in L if x)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("config")
    ap.add_argument("--voz", required=True, help="carpeta con marcas_alineadas.json")
    ap.add_argument("--puntos", required=True, help="carpeta con peru_puntos.json y ojo_puntos.json")
    ap.add_argument("--salida", required=True)
    a = ap.parse_args()

    cfg = json.loads(Path(a.config).read_text(encoding="utf-8"))
    marcas = json.loads((Path(a.voz) / "marcas_alineadas.json").read_text(encoding="utf-8"))
    out = Path(a.salida)
    out.mkdir(parents=True, exist_ok=True)
    puntos = Path(a.puntos)
    for i, (e, m) in enumerate(zip(cfg["escenas"], marcas["escenas"])):
        pid = PAGINAS[i]
        dur_ms = round((m["escena_fin_s"] - m["escena_inicio_s"]) * 1000)
        voz_rel = round((m["voz_inicio_s"] - m["escena_inicio_s"]) * 1000)
        pal = m["palabras"]
        # el subtítulo arranca en la palabra `sub_desde` (0 por defecto): útil cuando la escena tiene un texto grande antes
        d0 = e.get("sub_desde", 0)
        ini = round((pal[d0]["inicio_s"] - m["escena_inicio_s"]) * 1000) if pal else voz_rel
        fin = round((pal[-1]["fin_s"] - m["escena_inicio_s"]) * 1000) if pal else voz_rel + 1500
        n_sub = len(pal) - d0
        vp = {"sub_t": ini, "sub_speed": round(max(1.0, n_sub / max(0.6, (fin - ini) / 1000.0)), 2), "voz_rel": voz_rel}
        mk, info = markup_pagina(e, cfg, puntos)
        (out / f"{cfg['id']}_{pid}_markup.xml").write_text(mk, encoding="utf-8")
        pr = programa(e, vp, info, f"p_{pid}", dur_ms, e.get("fade_in", 0), e.get("fade_out", 0))
        (out / f"{cfg['id']}_{pid}_motion.js").write_text(pr, encoding="utf-8")
        print(f"{pid} {e['tipo']:8s} {dur_ms} ms  markup {len(mk):6d} car  motion {len(pr):5d} car  sub_t={vp['sub_t']} vel={vp['sub_speed']}")


if __name__ == "__main__":
    main()
