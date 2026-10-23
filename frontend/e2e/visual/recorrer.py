"""Recorrido visual de Vigía con agent-browser (Vercel Labs): cada página clave en escritorio y celular, de día y de noche,
con su captura completa y los chequeos de e2e/visual/chequeos.js (separadores «·», desborde, Migas, listas sin
buscador, texto suelto, colores fijos, tamaños de letra, contraste, controles sin nombre) y los errores de la consola.

Uso:
  python e2e/visual/recorrer.py [--base https://vigia-web.vigiaperu.workers.dev] [--salida e2e/visual/salida]
                                [--solo empresas,contratos] [--usuario vigia --clave …]   (DEV pide Basic auth)
Escribe <salida>/resultados.json, <salida>/informe.md y las capturas <salida>/<pagina>-<vista>-<modo>.png.

Necesita agent-browser (`npm install -g agent-browser` y `agent-browser install`). En Windows su daemon hereda la salida
estándar: si se lee por una tubería, el comando no termina nunca. Por eso cada llamada escribe a un archivo.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

AQUI = Path(__file__).resolve().parent
CHEQUEOS = (AQUI / "chequeos.js").read_text(encoding="utf-8")

# Las páginas clave: una de cada tipo (lista y ficha), con datos reales.
PAGINAS = {
    "inicio": "/app",
    "mapa": "/app/mapa",
    "contratos": "/app/contratos",
    "contrato": "/app/contratos/1247629",
    "entidades": "/app/entidades",
    "entidad": "/entidad/20131370645",
    "empresas": "/app/empresas",
    "empresa": "/empresa/20604968772",
    "empresa-contratos": "/empresa/20511037001?seccion=contratos",
    "partidos": "/app/partidos",
    "partido": "/app/partidos/partido-democratico-somos-peru",
    "region": "/region/15",
    "personas": "/app/personas",
    "persona": "/app/personas/e2e2d5f77000",
    "planilla": "/app/personas/planilla/7833cf4509d1",
    "senales": "/app/hallazgos",
    "denuncias": "/app/denuncias",
    "financiar": "/app/financiar",
    "aliados": "/app/aliados",
    "auditoria": "/app/auditoria",
    "portada": "/",
}
VISTAS = {"escritorio": (1366, 900), "celular": (390, 844)}
MODOS = ("dia", "noche")


def binario() -> str:
    """El ejecutable de agent-browser (en Windows, el .exe nativo: el .cmd de npm no se puede lanzar sin shell)."""
    exe = Path(os.environ.get("APPDATA", "")) / "npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe"
    if sys.platform == "win32" and exe.exists():
        return str(exe)
    return shutil.which("agent-browser") or "agent-browser"


AB = binario()


def ab(sesion: str, *args: str, plazo: int = 120) -> str:
    """Una orden a agent-browser, con la salida a un archivo (ver la nota del módulo sobre Windows)."""
    with tempfile.TemporaryFile(mode="w+", encoding="utf-8", errors="replace") as out:
        p = subprocess.Popen([AB, "--session", sesion, *args], stdout=out, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL)
        try:
            p.wait(timeout=plazo)
        except subprocess.TimeoutExpired:
            p.kill()
            return f"[plazo de {plazo} s vencido]"
        out.seek(0)
        return out.read()


def extraer_json(salida: str) -> dict | None:
    """El JSON que devuelve chequeos.js, dentro de lo que imprime `eval` (puede venir entre comillas)."""
    s = salida.strip()
    for intento in (s, s.splitlines()[-1] if s else ""):
        try:
            v = json.loads(intento)
            if isinstance(v, str):
                v = json.loads(v)
            if isinstance(v, dict):
                return v
        except (json.JSONDecodeError, IndexError):
            continue
    i, j = s.find("{"), s.rfind("}")
    if i >= 0 and j > i:
        try:
            return json.loads(s[i:j + 1].replace('\\"', '"'))
        except json.JSONDecodeError:
            return None
    return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="https://vigia-web.vigiaperu.workers.dev")
    ap.add_argument("--salida", default=str(AQUI / "salida"))
    ap.add_argument("--solo", default="")
    ap.add_argument("--vistas", default="escritorio,celular")
    ap.add_argument("--modos", default="dia,noche")
    ap.add_argument("--usuario", default="")
    ap.add_argument("--clave", default="")
    a = ap.parse_args()

    salida = Path(a.salida)
    salida.mkdir(parents=True, exist_ok=True)
    paginas = {k: v for k, v in PAGINAS.items() if not a.solo or k in a.solo.split(",")}
    sesion = "vigia-visual"
    codigo = base64.b64encode(CHEQUEOS.encode("utf-8")).decode("ascii")
    if a.usuario:
        ab(sesion, "set", "credentials", a.usuario, a.clave)

    resultados = []
    for vista in a.vistas.split(","):
        w, h = VISTAS[vista]
        ab(sesion, "set", "viewport", str(w), str(h))
        for modo in a.modos.split(","):
            ab(sesion, "set", "media", "dark" if modo == "noche" else "light")
            for nombre, ruta in paginas.items():
                t0 = time.time()
                ab(sesion, "open", a.base + ruta, plazo=180)
                # El modo de la web (html[data-modo], lib/modoScript.ts) y su preferencia guardada.
                ab(sesion, "eval", f"localStorage.setItem('vigia-modo','{modo}'); document.documentElement.dataset.modo='{modo}'; 1")
                ab(sesion, "wait", "1500")
                captura = salida / f"{nombre}-{vista}-{modo}.png"
                ab(sesion, "screenshot", "--full", str(captura), plazo=120)
                bruto = ab(sesion, "eval", "-b", codigo, plazo=120)
                datos = extraer_json(bruto) or {"error": bruto[-400:]}
                errores = ab(sesion, "errors").strip()
                datos.update({"pagina": nombre, "vista": vista, "modo": modo, "captura": captura.name,
                              "errores": errores[-600:] if errores and "No errors" not in errores and "no errors" not in errores.lower() else "",
                              "segundos": round(time.time() - t0, 1)})
                # Una página sin título no cargó (una clave Basic mal puesta da 401 y la página en blanco): sin esto, el
                # recorrido la daba por limpia.
                datos["noCargo"] = bool(datos.get("error")) or not (datos.get("titulo") or "").strip()
                resultados.append(datos)
                if datos["noCargo"]:
                    print(f"{nombre:18} {vista:10} {modo:6} NO CARGÓ ({a.base + ruta})", flush=True)
                    continue
                print(f"{nombre:18} {vista:10} {modo:6} {datos.get('segundos')}s sep={datos.get('nSeparadores', '?')} "
                      f"desborde={'sí' if datos.get('desborde') else 'no'} migas={datos.get('migas')} "
                      f"sueltos={datos.get('nTextoSuelto', '?')} contraste={datos.get('nContraste', '?')}", flush=True)
    ab(sesion, "close")
    (salida / "resultados.json").write_text(json.dumps(resultados, ensure_ascii=False, indent=1), encoding="utf-8")
    (salida / "informe.md").write_text(informe(resultados), encoding="utf-8")
    print(f"listo: {salida / 'informe.md'}")
    sin_cargar = [r for r in resultados if r.get("noCargo")]
    if sin_cargar:
        print(f"{len(sin_cargar)} de {len(resultados)} páginas no cargaron: revisa --base y la clave.", file=sys.stderr)
        sys.exit(1)


def informe(rs: list[dict]) -> str:
    """El resumen por regla: qué páginas la rompen y con qué ejemplo."""
    L = ["# Recorrido visual de Vigía", ""]
    def fila(r: dict) -> str:
        return f"{r['pagina']} ({r['vista']}, {r['modo']})"
    reglas = [
        ("La página no cargó", lambda r: bool(r.get("noCargo")), lambda r: (r.get("error") or r.get("url") or "")[:200]),
        ("Títulos más chicos que su nivel", lambda r: r.get("nJerarquia", 0) > 0, lambda r: "; ".join(f"{x['nivel']} {x['px']}px «{x['texto']}»" for x in r["jerarquia"][:3])),
        ("Texto bajo 11 px", lambda r: r.get("textoChico", 0) > 0, lambda r: f"{r['textoChico']} elementos"),
        ("Separadores «·» o «•» en texto", lambda r: r.get("nSeparadores", 0) > 0, lambda r: "; ".join(x["texto"] for x in r["separadores"][:3])),
        ("Desborde horizontal", lambda r: bool(r.get("desborde")), lambda r: json.dumps(r["desborde"], ensure_ascii=False)[:200]),
        ("Sin ruta (Migas)", lambda r: r.get("migas") is False and r["pagina"] not in ("portada", "inicio"), lambda r: r["url"]),
        ("Lista larga sin buscador", lambda r: any(not l["buscador"] for l in r.get("listas", [])), lambda r: "; ".join(f"{l['lista']} ({l['filas']})" for l in r["listas"] if not l["buscador"])[:200]),
        ("Texto suelto fuera de una tarjeta", lambda r: r.get("nTextoSuelto", 0) > 0, lambda r: r["textoSuelto"][0]["texto"] if r.get("textoSuelto") else ""),
        ("Color fijo en estilo en línea", lambda r: bool(r.get("colorFijo")), lambda r: r["colorFijo"][0]["style"]),
        ("Contraste bajo", lambda r: r.get("nContraste", 0) > 0, lambda r: f"{r['nContraste']} textos; p. ej. «{r['contraste'][0]['texto']}» {r['contraste'][0]['ratio']}:1"),
        ("Controles sin nombre o imágenes sin alt", lambda r: bool(r.get("sinNombre")) or r.get("imgSinAlt", 0) > 0, lambda r: f"{len(r.get('sinNombre', []))} controles, {r.get('imgSinAlt', 0)} imágenes"),
        ("Errores en la consola", lambda r: bool(r.get("errores")), lambda r: r["errores"][:160]),
    ]
    for titulo, falla, ejemplo in reglas:
        malas = [r for r in rs if "error" not in r and falla(r)]
        L.append(f"## {titulo}: {len(malas)} de {len(rs)}")
        for r in malas[:40]:
            L.append(f"- {fila(r)}: {ejemplo(r)}")
        L.append("")
    tam = {}
    for r in rs:
        for k, v in (r.get("tamanos") or {}).items():
            tam[k] = tam.get(k, 0) + v
    L.append(f"## Tamaños de letra en uso: {len(tam)}")
    L.append(", ".join(f"{k} ({v})" for k, v in sorted(tam.items(), key=lambda x: float(x[0].rstrip('px')))))
    fallidas = [r for r in rs if "error" in r]
    if fallidas:
        L += ["", f"## Páginas que no se pudieron revisar: {len(fallidas)}"] + [f"- {fila(r)}: {r['error'][:160]}" for r in fallidas]
    return "\n".join(L) + "\n"


if __name__ == "__main__":
    main()
