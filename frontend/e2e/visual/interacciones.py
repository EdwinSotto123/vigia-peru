"""Pruebas de interacción de Vigía con agent-browser: lo que una captura no muestra.

- Enlace a pestaña: con la ficha cargada en ?seccion=contratos, pasar a Inicio y tocar una cifra de arriba que lleva a
  ?seccion=contratos debe abrir Contratos (Next reusa el árbol de esa URL y la barra no se volvía a renderizar).
- Paginador de abajo: lleva al inicio de SU lista (sin ancla en la URL ni ids repetidos), bajo lo fijo de arriba; en
  escritorio y en el celular.
- Panel anclado: en escritorio, una fila con detalle abre el panel (no modal) con «1 de N»; «Siguiente» cambia de fila.
- Filtro buscable: en la ficha de un partido, «Gobierno» dentro de Filtros se escribe y se elige; la lista se filtra y
  aparece su chip. Ninguna opción repetida (la opción se elige por su nombre).

Uso:
  python e2e/visual/interacciones.py [--base https://vigia-web.vigiaperu.workers.dev] [--usuario vigia --clave …]
                                     [--entidad /entidad/RUC] [--partido /app/partidos/clave]
En DEV (base chica) conviene una entidad liviana: --entidad /entidad/20191603941. Sale con 1 si alguna falla.
"""
from __future__ import annotations

import argparse
import base64
import json
import sys
from pathlib import Path

AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI))
from recorrer import ab, extraer_json  # noqa: E402

S = "vigia-interaccion"


def js(codigo: str) -> dict:
    """Corre `codigo` (el cuerpo de una función que devuelve un objeto) y lo trae como dict."""
    envuelto = f"JSON.stringify((() => {{ {codigo} }})())"
    salida = ab(S, "eval", "-b", base64.b64encode(envuelto.encode("utf-8")).decode("ascii"), plazo=60)
    return extraer_json(salida) or {"crudo": salida[-300:]}


def abrir(base: str, ruta: str, espera: int = 2500) -> None:
    ab(S, "open", base + ruta, plazo=180)
    ab(S, "wait", str(espera))


ACTIVA = r"""
  const t = [...document.querySelectorAll('[role="tab"]')].find((b) => b.getAttribute('aria-selected') === 'true' && b.closest('[role="tablist"]')?.offsetParent !== null);
  return { activa: t ? t.textContent.trim().replace(/\s+/g, ' ') : null, url: location.search };
"""

# Un enlace de «Siguiente»: el de `Paginacion` (aria-label) o el de `PaginacionCursor` (su texto).
SIGUIENTE = r"""(a) => (a.getAttribute('aria-label') === 'Página siguiente' || /^Siguiente/.test(a.textContent.trim())) && a.getAttribute('aria-disabled') !== 'true'"""


def prueba_pestana(base: str, ruta: str) -> dict:
    abrir(base, ruta + "?seccion=contratos", 4000)
    antes = js(ACTIVA)
    js(r"""
      const tab = [...document.querySelectorAll('[role="tab"]')].find((b) => /^Inicio/.test(b.textContent.trim()));
      tab?.click();
      return { ok: !!tab };
    """)
    ab(S, "wait", "800")
    en_inicio = js(ACTIVA)
    clic = js(r"""
      const lista = document.querySelector('[role="tablist"]');
      const enlaces = [...document.querySelectorAll('a[href*="seccion=contratos"]')].filter((a) => a.offsetParent !== null);
      // Uno de ARRIBA de la barra (las cifras): está antes de la barra en el documento.
      const a = enlaces.find((x) => lista && (x.compareDocumentPosition(lista) & Node.DOCUMENT_POSITION_FOLLOWING)) ?? enlaces[0];
      if (!a) return { ok: false, enlaces: enlaces.length };
      const href = a.getAttribute('href');
      a.click();
      return { ok: true, href, texto: a.textContent.trim().slice(0, 60) };
    """)
    ab(S, "wait", "6000")
    despues = js(ACTIVA)
    paso = bool((en_inicio.get("activa") or "").startswith("Inicio") and (despues.get("activa") or "").startswith("Contratos") and "seccion=contratos" in (despues.get("url") or ""))
    return {"prueba": "enlace a pestaña", "ruta": ruta, "antes": antes, "en_inicio": en_inicio, "clic": clic, "despues": despues, "paso": paso}


def prueba_paginador(base: str, ruta: str, vista: str) -> dict:
    abrir(base, ruta, 4000)
    prep = js(f"""
      const siguiente = {SIGUIENTE};
      const visibles = [...document.querySelectorAll('[data-paginado]')].filter((z) => z.offsetParent !== null);
      const zona = visibles.find((z) => [...z.querySelectorAll('a')].some(siguiente));
      if (!zona) return {{ ok: false, zonas: visibles.length }};
      const sig = [...zona.querySelectorAll('a')].filter(siguiente).pop();
      sig.scrollIntoView({{ block: 'center' }});
      window.__zona = zona;
      return {{ ok: true, zonas: visibles.length, idsResultados: document.querySelectorAll('#resultados').length, yAntes: Math.round(scrollY) }};
    """)
    if not prep.get("ok"):
        return {"prueba": "paginador de abajo", "ruta": ruta, "vista": vista, "prep": prep, "paso": False}
    js(f"""
      const sig = [...window.__zona.querySelectorAll('a')].filter({SIGUIENTE}).pop();
      sig.click();
      return {{ ok: true }};
    """)
    ab(S, "wait", "7000")
    medida = js(r"""
      const zonas = [...document.querySelectorAll('[data-paginado]')].filter((z) => z.offsetParent !== null);
      const zona = zonas.find((z) => z === window.__zona) ?? zonas[0];
      const top = Math.round(zona.getBoundingClientRect().top);
      // Lo fijo de arriba (barra del sitio, franja de pestañas): su borde de abajo.
      let fijo = 0;
      for (const el of document.querySelectorAll('header, [role="tablist"], nav, div')) {
        const cs = getComputedStyle(el);
        if (cs.position !== 'sticky' && cs.position !== 'fixed') continue;
        const r = el.getBoundingClientRect();
        if (r.top <= 1 && r.bottom > 0 && r.bottom < innerHeight / 2 && r.width > innerWidth / 2) fijo = Math.max(fijo, Math.round(r.bottom));
      }
      return { url: location.pathname + location.search, hash: location.hash, top, fijo, y: Math.round(scrollY) };
    """)
    paso = bool(prep.get("idsResultados") == 0 and medida.get("hash") == "" and medida.get("top") is not None
                and medida["top"] >= medida.get("fijo", 0) - 2 and medida["top"] < 400 and medida.get("y", 0) < prep.get("yAntes", 0))
    return {"prueba": "paginador de abajo", "ruta": ruta, "vista": vista, "prep": prep, "medida": medida, "paso": paso}


def prueba_panel(base: str, ruta: str) -> dict:
    abrir(base, ruta, 4000)
    a = js(r"""
      const b = [...document.querySelectorAll('button[data-detalle]')].find((x) => x.offsetParent !== null);
      if (!b) return { ok: false };
      b.click();
      return { ok: true };
    """)
    ab(S, "wait", "800")
    estado = js(r"""
      const panel = [...document.querySelectorAll('aside')].find((x) => /\d+ de \d+/.test(x.textContent || '') && getComputedStyle(x).position === 'fixed' && x.getBoundingClientRect().left > innerWidth / 3);
      const marcada = document.querySelector('button[data-detalle][aria-current="true"]')?.dataset.fila ?? null;
      const sig = panel ? [...panel.querySelectorAll('button')].find((x) => /Siguiente/i.test(x.getAttribute('aria-label') || '')) : null;
      const texto = panel ? (panel.textContent.match(/\d+ de \d+/) || [null])[0] : null;
      sig?.click();
      return { panel: !!panel, modal: !!document.querySelector('dialog[open]'), marcada: marcada ? 'sí' : null, texto, ancho: panel ? Math.round(panel.getBoundingClientRect().width) : 0, _fila: marcada };
    """)
    ab(S, "wait", "600")
    luego = js(r"""
      return { _fila: document.querySelector('button[data-detalle][aria-current="true"]')?.dataset.fila ?? null };
    """)
    cambio = bool(luego.get("_fila") and luego["_fila"] != estado.get("_fila"))
    # El id de la fila no se guarda en el informe (podría ser un código de persona).
    estado.pop("_fila", None)
    paso = bool(a.get("ok") and estado.get("panel") and not estado.get("modal") and cambio)
    return {"prueba": "panel anclado", "ruta": ruta, "estado": estado, "siguienteCambiaFila": cambio, "paso": paso}


def prueba_filtro_buscable(base: str, ruta: str) -> dict:
    abrir(base, ruta, 5000)
    js(r"""
      const b = [...document.querySelectorAll('button')].find((x) => /^Filtros/.test(x.textContent.trim()) && x.offsetParent !== null);
      b?.click();
      return { ok: !!b };
    """)
    ab(S, "wait", "700")
    campo = js(r"""
      const i = [...document.querySelectorAll('input[type="search"][list]')].find((x) => /gobiernos/i.test(x.placeholder));
      if (!i) return { ok: false, buscables: document.querySelectorAll('input[type="search"][list]').length };
      const opciones = [...document.getElementById(i.getAttribute('list')).options];
      const o = opciones[Math.min(3, opciones.length - 1)];
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(i, o.value);
      i.dispatchEvent(new Event('input', { bubbles: true }));
      return { ok: true, opciones: opciones.length, elegida: o.value, repetidas: opciones.length - new Set(opciones.map((x) => x.value)).size };
    """)
    ab(S, "wait", "7000")
    despues = js(r"""
      const u = new URL(location.href);
      const chip = [...document.querySelectorAll('button, a, span')].find((x) => /^Gobierno:/.test(x.textContent.trim()) && x.offsetParent !== null);
      return { ubigeo: u.searchParams.get('ubigeo'), seccion: u.searchParams.get('seccion'), chip: chip ? chip.textContent.trim().slice(0, 90) : null };
    """)
    paso = bool(campo.get("ok") and campo.get("repetidas") == 0 and despues.get("ubigeo") and despues.get("chip"))
    return {"prueba": "filtro buscable", "ruta": ruta, "campo": campo, "despues": despues, "paso": paso}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="https://vigia-web.vigiaperu.workers.dev")
    ap.add_argument("--usuario", default="")
    ap.add_argument("--clave", default="")
    ap.add_argument("--salida", default=str(AQUI / "salida" / "interacciones"))
    ap.add_argument("--entidad", default="/entidad/20131380951")
    ap.add_argument("--ordenes", default="/app/contratos?vista=ordenes")
    ap.add_argument("--partido", default="/app/partidos/renovacion-popular")
    a = ap.parse_args()
    salida = Path(a.salida)
    salida.mkdir(parents=True, exist_ok=True)
    if a.usuario:
        ab(S, "set", "credentials", a.usuario, a.clave)
    rs = []
    ab(S, "set", "viewport", "1366", "900")
    rs.append(prueba_pestana(a.base, a.entidad))
    rs.append(prueba_paginador(a.base, a.entidad + "?seccion=contratos", "escritorio"))
    ab(S, "screenshot", str(salida / "paginador-escritorio.png"), plazo=60)
    rs.append(prueba_panel(a.base, a.ordenes))
    ab(S, "screenshot", str(salida / "panel-escritorio.png"), plazo=60)
    rs.append(prueba_filtro_buscable(a.base, a.partido + "?seccion=procesos"))
    ab(S, "screenshot", str(salida / "filtro-buscable.png"), plazo=60)
    ab(S, "set", "viewport", "390", "844")
    rs.append(prueba_paginador(a.base, a.entidad + "?seccion=contratos", "celular"))
    ab(S, "screenshot", str(salida / "paginador-celular.png"), plazo=60)
    errores = ab(S, "errors").strip()
    ab(S, "close")
    sin_errores = not errores or "no errors" in errores.lower()
    (salida / "interacciones.json").write_text(json.dumps({"resultados": rs, "errores": "" if sin_errores else errores[-800:]}, ensure_ascii=False, indent=1), encoding="utf-8")
    for r in rs:
        print(f"{'PASA ' if r['paso'] else 'FALLA'} {r['prueba']:20} {r.get('vista', ''):10} {r['ruta']}", flush=True)
    print("errores de consola:", "ninguno" if sin_errores else errores[-300:])
    if not all(r["paso"] for r in rs) or not sin_errores:
        sys.exit(1)


if __name__ == "__main__":
    main()
