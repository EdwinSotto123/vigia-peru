"""Protección de la zona gobserva.cloud en Cloudflare (plan Free). Idempotente: correrlo de nuevo deja lo mismo.

    CLOUDFLARE_API_TOKEN=... python proteger_zona.py estado
    CLOUDFLARE_API_TOKEN=... python proteger_zona.py todo        # ajustes + bots + waf + limite

El token es uno de cuenta con permisos de zona (configuración, WAF, bots); nunca se imprime. Lo que hace cada parte:
  ajustes  HTTPS siempre, TLS 1.2 como mínimo, HSTS de 180 días (sin subdominios: el correo de IONOS cuelga de la zona) y
           sin ofuscación de correos (la web muestra correos como texto: reescribirlos rompe la hidratación de React).
  bots     bloquea los rastreadores de ENTRENAMIENTO de IA que Cloudflare reconoce (`ai_training`); los de búsqueda y los
           que abren una página porque una persona lo pidió siguen pasando.
  waf      tres reglas propias: los mismos rastreadores por nombre (el reconocimiento de Cloudflare va por IP y uno falso
           pasaba), rutas de escáneres que Vigía no tiene (.php, /wp-, /.env…) y un desafío a clientes de scripts sin
           navegador (python-requests, curl, Go…), salvo los bots verificados (buscadores, vistas previas de enlaces).
  limite   la regla de rate limiting del plan: 100 pedidos cada 10 s por IP fuera de /_next/ (los estáticos).
El resto del abuso lo frenan los Workers: frontend/worker-prod.js (páginas por IP) y backend/api/src/lib/antibots.ts.
"""
import json
import os
import sys
import urllib.error
import urllib.request

ZONA = "1324ec9688788a6080a56e529bd5fe53"   # gobserva.cloud
API = "https://api.cloudflare.com/client/v4"


def llamar(metodo, ruta, cuerpo=None):
    token = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()
    if not token:
        sys.exit("Falta CLOUDFLARE_API_TOKEN en el entorno.")
    req = urllib.request.Request(f"{API}{ruta}", method=metodo, data=json.dumps(cuerpo).encode() if cuerpo is not None else None,
                                 headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return json.loads(e.read() or b"{}")


def informar(nombre, d):
    print(nombre, "ok" if d.get("success") else json.dumps(d.get("errors"), ensure_ascii=False)[:800])


def ajustes():
    informar("ajustes", llamar("PATCH", f"/zones/{ZONA}/settings", {"items": [
        {"id": "always_use_https", "value": "on"},
        {"id": "min_tls_version", "value": "1.2"},
        {"id": "email_obfuscation", "value": "off"},
        {"id": "security_header", "value": {"strict_transport_security": {
            "enabled": True, "max_age": 15552000, "include_subdomains": False, "preload": False, "nosniff": True}}},
    ]}))


def bots():
    informar("bots", llamar("PUT", f"/zones/{ZONA}/bot_management", {"ai_training": "block"}))


# Los mismos nombres que frontend/app/robots.ts (menos los que sólo existen en robots.txt, como Google-Extended).
UA_ENTRENAMIENTO = ["gptbot", "claudebot", "anthropic-ai", "ccbot", "bytespider", "meta-externalagent", "facebookbot",
                    "amazonbot", "cohere-ai", "cohere-training-data-crawler", "diffbot", "omgili", "timpibot",
                    "imagesiftbot", "ai2bot", "pangubot", "img2dataset"]
RUTAS_ESCANER = [".php", "/wp-", "/.env", "/.git", "/.aws", "/.ssh", "/.ds_store", "/.vscode", "/cgi-bin", "phpmyadmin",
                 "/xmlrpc", "/actuator", "/server-status", "/vendor/phpunit", "/.htaccess", "/.svn"]
UA_SCRIPTS = ["python-requests", "python-urllib", "aiohttp", "httpx", "scrapy", "go-http-client", "curl/", "wget/",
              "libwww-perl", "okhttp", "java/", "apache-httpclient", "node-fetch", "axios/", "undici", "phantomjs", "colly",
              "mechanize", "guzzlehttp"]


def _alguno(campo, valores):
    return " or ".join(f'(lower({campo}) contains "{v}")' for v in valores)


def waf():
    reglas = [
        {"description": "Rastreadores de entrenamiento de IA, por nombre", "action": "block",
         "expression": _alguno("http.user_agent", UA_ENTRENAMIENTO), "enabled": True},
        {"description": "Escaneres de vulnerabilidades (rutas que Vigia no tiene)", "action": "block",
         "expression": _alguno("http.request.uri.path", RUTAS_ESCANER), "enabled": True},
        {"description": "Clientes de scripts sin navegador (los bots verificados pasan)", "action": "managed_challenge",
         "expression": f'(not cf.client.bot) and ((http.user_agent eq "") or {_alguno("http.user_agent", UA_SCRIPTS)})',
         "enabled": True},
    ]
    informar("waf", llamar("PUT", f"/zones/{ZONA}/rulesets/phases/http_request_firewall_custom/entrypoint",
                           {"description": "Vigia: reglas propias", "rules": reglas}))


def limite():
    informar("limite", llamar("PUT", f"/zones/{ZONA}/rulesets/phases/http_ratelimit/entrypoint", {
        "description": "Vigia: limite por IP",
        "rules": [{
            "description": "Pedidos por IP fuera de los estaticos (/_next/)",
            "expression": '(not starts_with(http.request.uri.path, "/_next/"))',
            "action": "block",
            "ratelimit": {"characteristics": ["ip.src", "cf.colo.id"], "period": 10, "requests_per_period": 100,
                          "mitigation_timeout": 10},
            "enabled": True,
        }],
    }))


def estado():
    s = llamar("GET", f"/zones/{ZONA}/settings").get("result") or []
    quiero = {"always_use_https", "min_tls_version", "email_obfuscation", "security_level", "browser_check", "ssl"}
    print("ajustes:", {x["id"]: x["value"] for x in s if x["id"] in quiero})
    b = llamar("GET", f"/zones/{ZONA}/bot_management").get("result") or {}
    print("bots:", {k: b.get(k) for k in ("ai_training", "ai_search", "ai_user", "fight_mode")})
    for fase in ("http_request_firewall_custom", "http_ratelimit"):
        r = llamar("GET", f"/zones/{ZONA}/rulesets/phases/{fase}/entrypoint").get("result") or {}
        for regla in r.get("rules") or []:
            print(f"{fase}: {regla.get('action')} | {regla.get('description')}")


ACCIONES = {"ajustes": ajustes, "bots": bots, "waf": waf, "limite": limite, "estado": estado}
if __name__ == "__main__":
    pedido = sys.argv[1] if len(sys.argv) > 1 else "estado"
    for accion in (["ajustes", "bots", "waf", "limite"] if pedido == "todo" else [pedido]):
        ACCIONES[accion]()
