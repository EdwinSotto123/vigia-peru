"""El correo de Gobserva por Resend (2026-11-08: AWS negó sacar a SES del sandbox; el dueño eligió Resend).

Qué hace, en orden, y sin imprimir secretos:
  1. Lee RESEND_API_KEY y el token de Cloudflare (CF_TOKEN_DESPLIEGUE, si no CF_TOKEN_OPERACION) de
     ~/.simplia/secretos.env.
  2. Da de alta gobserva.cloud en Resend (o usa el que ya está) y pide sus registros (DKIM y SPF del subdominio de
     rebotes «send»).
  3. Los crea en la zona de Cloudflare si faltan (sin proxy). Si no hay DMARC, agrega uno en modo observación (p=none).
  4. Pide a Resend que verifique y espera hasta 3 minutos.
  5. Sólo con el dominio verificado, guarda RESEND_API_KEY como secreto del Worker de la API (prod y dev): desde ese
     momento lib/correo.ts manda por Resend y los avisos llegan a cualquiera.

Uso:
  python infrastructure/deploy/correo_resend.py               # todo lo de arriba
  python infrastructure/deploy/correo_resend.py --estado      # sólo mira cómo está el dominio
  python infrastructure/deploy/correo_resend.py --probar a@b  # además manda un correo de prueba a esa dirección

La llave se crea en https://resend.com/api-keys (permiso «Full access» para poder dar de alta el dominio).
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

DOMINIO = "gobserva.cloud"
REGION = "us-east-1"
API = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "backend", "api")
UA = "gobserva-correo/1.0"


def secreto(nombre: str) -> str | None:
    ruta = os.path.expanduser("~/.simplia/secretos.env")
    if not os.path.exists(ruta):
        return None
    m = re.search(rf"^{nombre}=(.+)$", open(ruta, encoding="utf-8").read(), re.M)
    return m.group(1).strip().strip('"').strip("'") if m else None


def pedir(metodo: str, url: str, token: str, cuerpo: dict | None = None) -> tuple[int, dict]:
    datos = json.dumps(cuerpo).encode() if cuerpo is not None else None
    req = urllib.request.Request(url, data=datos, method=metodo,
                                 headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except ValueError:
            return e.code, {}


def dominio_resend(llave: str, crear: bool) -> dict | None:
    st, j = pedir("GET", "https://api.resend.com/domains", llave)
    if st != 200:
        sys.exit(f"Resend no aceptó la llave (HTTP {st}: {j.get('message', '')[:120]}). ¿Es «Full access»?")
    d = next((x for x in j.get("data", []) if x.get("name") == DOMINIO), None)
    if not d and crear:
        st, d = pedir("POST", "https://api.resend.com/domains", llave, {"name": DOMINIO, "region": REGION})
        if st not in (200, 201):
            sys.exit(f"No se pudo dar de alta {DOMINIO} en Resend (HTTP {st}: {d.get('message', '')[:160]})")
        print(f"dominio dado de alta en Resend ({REGION})")
    if not d:
        return None
    st, completo = pedir("GET", f"https://api.resend.com/domains/{d['id']}", llave)
    return completo if st == 200 else d


def zona_cloudflare(token: str) -> str:
    st, j = pedir("GET", f"https://api.cloudflare.com/client/v4/zones?name={DOMINIO}", token)
    if st != 200 or not j.get("result"):
        sys.exit(f"El token de Cloudflare no ve la zona {DOMINIO} (HTTP {st})")
    return j["result"][0]["id"]


def asegurar_registro(token: str, zona: str, tipo: str, nombre: str, valor: str, prioridad: int | None = None) -> None:
    fqdn = nombre if nombre.endswith(DOMINIO) else f"{nombre}.{DOMINIO}"
    st, j = pedir("GET", f"https://api.cloudflare.com/client/v4/zones/{zona}/dns_records?type={tipo}&name={fqdn}", token)
    existentes = j.get("result", []) if st == 200 else []
    limpio = lambda v: v.strip().strip('"')  # noqa: E731
    if any(limpio(r.get("content", "")) == limpio(valor) for r in existentes):
        print(f"  {tipo:4} {fqdn}: ya estaba")
        return
    if tipo == "TXT" and any(limpio(r.get("content", "")).startswith("v=spf1") for r in existentes) and valor.startswith("v=spf1"):
        print(f"  {tipo:4} {fqdn}: ya hay otro SPF; revísalo a mano (no se pisa)")
        return
    cuerpo = {"type": tipo, "name": fqdn, "content": valor, "ttl": 1, "proxied": False}
    if prioridad is not None:
        cuerpo["priority"] = prioridad
    st, j = pedir("POST", f"https://api.cloudflare.com/client/v4/zones/{zona}/dns_records", token, cuerpo)
    ok = st in (200, 201) and j.get("success")
    errores = "; ".join(e.get("message", "") for e in j.get("errors", []))[:160]
    print(f"  {tipo:4} {fqdn}: {'creado' if ok else f'NO se pudo (HTTP {st}: {errores})'}")


def secreto_worker(nombre: str, valor: str) -> None:
    for extra in ([], ["--env", "dev"]):
        r = subprocess.run(["npx", "--yes", "wrangler", "secret", "put", nombre, *extra], cwd=API, input=valor, text=True,
                           encoding="utf-8", errors="replace", capture_output=True, shell=sys.platform == "win32")
        estado = "ok" if r.returncode == 0 else f"falló ({r.stderr.strip().splitlines()[-1][:120] if r.stderr.strip() else r.returncode})"
        print(f"secreto {nombre} {'dev' if extra else 'prod'}: {estado}")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    llave = secreto("RESEND_API_KEY")
    if not llave:
        sys.exit("Falta RESEND_API_KEY en ~/.simplia/secretos.env (créala en https://resend.com/api-keys, «Full access»).")
    solo_estado = "--estado" in sys.argv
    d = dominio_resend(llave, crear=not solo_estado)
    if not d:
        sys.exit(f"{DOMINIO} no está en Resend todavía.")
    print(f"Resend: {DOMINIO} está «{d.get('status')}»")
    if solo_estado:
        for r in d.get("records", []):
            print(f"  {r.get('record')}: {r.get('type')} {r.get('name')} → {r.get('status')}")
        return

    token = secreto("CF_TOKEN_DESPLIEGUE") or secreto("CF_TOKEN_OPERACION")
    if not token:
        sys.exit("Falta el token de Cloudflare en ~/.simplia/secretos.env")
    zona = zona_cloudflare(token)
    print("DNS en Cloudflare:")
    for r in d.get("records", []):
        asegurar_registro(token, zona, r["type"], r["name"], r["value"], r.get("priority"))
    st, j = pedir("GET", f"https://api.cloudflare.com/client/v4/zones/{zona}/dns_records?type=TXT&name=_dmarc.{DOMINIO}", token)
    if st == 200 and not j.get("result"):
        asegurar_registro(token, zona, "TXT", f"_dmarc.{DOMINIO}", "v=DMARC1; p=none;")

    if d.get("status") != "verified":
        pedir("POST", f"https://api.resend.com/domains/{d['id']}/verify", llave, {})
        print("verificando en Resend…", end="", flush=True)
        for _ in range(18):
            time.sleep(10)
            d = dominio_resend(llave, crear=False) or d
            print(".", end="", flush=True)
            if d.get("status") == "verified":
                break
        print(f" «{d.get('status')}»")
    if d.get("status") != "verified":
        sys.exit("Todavía no verifica (el DNS puede tardar). Vuelve a correr el script en unos minutos; no se tocó el Worker.")

    secreto_worker("RESEND_API_KEY", llave)

    if "--probar" in sys.argv:
        i = sys.argv.index("--probar")
        para = sys.argv[i + 1] if len(sys.argv) > i + 1 else None
        if para:
            st, j = pedir("POST", "https://api.resend.com/emails", llave, {
                "from": "Gobserva <alertas@gobserva.cloud>", "to": [para], "reply_to": "hello@gobserva.cloud",
                "subject": "Prueba de correo de Gobserva", "text": "Si te llegó, los avisos de Gobserva ya salen por Resend.",
            })
            detalle = str(j.get("message", ""))[:120]
            print("correo de prueba: enviado" if st in (200, 201) else f"correo de prueba: falló (HTTP {st}: {detalle})")
    print("listo: el correo de Gobserva sale por Resend")


if __name__ == "__main__":
    main()
