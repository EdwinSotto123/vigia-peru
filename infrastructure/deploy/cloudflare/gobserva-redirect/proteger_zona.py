"""Protección y rendimiento de la zona gobserva.cloud en Cloudflare (plan Business desde el 2026-11-06). Idempotente:
correrlo de nuevo deja lo mismo, y cada parte reemplaza su juego entero (PUT), así que lo vivo debe salir de aquí.

    CLOUDFLARE_API_TOKEN=... GOBSERVA_PRUEBA=... python proteger_zona.py estado
    CLOUDFLARE_API_TOKEN=... python proteger_zona.py todo          # todas las partes menos `sala`
    CLOUDFLARE_API_TOKEN=... python proteger_zona.py sala on|off   # sala de espera (armada y apagada por defecto)

El token es uno de cuenta con permisos de zona (configuración, WAF, bots, caché, reglas, alertas); nunca se imprime.
Lo que hace cada parte:
  ajustes        HTTPS siempre, TLS ≥ 1.2, HSTS de 180 días sin subdominios (el correo de IONOS cuelga de la zona), sin
                 ofuscación de correos (rompe la hidratación de React), HTTP/3, 0-RTT, Early Hints, Brotli y Polish sin
                 pérdida con WebP (sólo toca imágenes en caché: medios.gobserva.cloud).
  cache          caché por niveles (Smart Tiered Cache) y una regla para medios.gobserva.cloud (R2): un día en el borde.
  bots           Super Bot Fight Mode: «seguro automatizado» → desafío; «probablemente automatizado» y los verificados
                 pasan. Sin detecciones por JavaScript: la portada de gobserva.cloud tiene CSP estricta con hash.
  waf            reglas propias (tope Business: 100). Ver `reglas_propias()`.
  administradas  reglas administradas de Cloudflare (todas) y OWASP nivel 1, sensibilidad baja, sólo en GET/HEAD de la web
                 y con desafío en vez de bloqueo.
  limite         las 5 reglas de rate limiting del plan. Ver `reglas_limite()`.
  paginas        páginas propias de bloqueo, límite, desafío y errores (servidas desde medios.gobserva.cloud/errores/).
  escudo         Page Shield: vigila qué scripts y conexiones carga cada página; aviso si aparece un dominio nuevo.
  salud          chequeos de salud de cada sitio y de la API, y avisos por correo (salud, ataques DDoS, picos del WAF).
  sala           sala de espera de vigia.gobserva.cloud (una sola en Business). Se crea APAGADA: prenderla sólo ante una
                 avalancha anunciada (`sala on`). Business no tiene respuestas JSON en la cola: mientras está activa, los
                 pedidos del navegador a /v1 reciben la página de espera.
El resto del abuso lo frenan los Workers: frontend/worker-prod.js (páginas por IP) y backend/api/src/lib/antibots.ts.
"""
import json
import os
import sys
import urllib.error
import urllib.request

ZONA = "1324ec9688788a6080a56e529bd5fe53"   # gobserva.cloud
CUENTA = "1cd0748daa880a849a2dae0baadfce34"
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
    return bool(d.get("success"))


# ─── Hosts y listas ──────────────────────────────────────────────────────────────────────────────────────────────────
MCP = "mcp.gobserva.cloud"
MEDIOS = "medios.gobserva.cloud"
PROGRAMAS = f'{{"{MCP}" "{MEDIOS}"}}'        # los usan programas, no navegadores: nada de desafíos
# Todo claude.ai (y sus conectores) sale de este rango: miles de personas por pocas IP. El MCP las cuenta por cuenta en
# su Durable Object; un límite por IP en el borde los cortaría a todos juntos.
ANTHROPIC = "160.79.104.0/21"
# Cloudflare pone `cf.worker.upstream_zone` en los subpedidos de un Worker y un cliente no puede falsificarlo.
ZONAS_PROPIAS = '{"gobserva.cloud" "vigiaperu.workers.dev"}'

# Los mismos nombres que frontend/app/robots.ts (menos los que sólo existen en robots.txt, como Google-Extended).
UA_ENTRENAMIENTO = ["gptbot", "claudebot", "anthropic-ai", "ccbot", "bytespider", "meta-externalagent", "facebookbot",
                    "amazonbot", "cohere-ai", "cohere-training-data-crawler", "diffbot", "omgili", "timpibot",
                    "imagesiftbot", "ai2bot", "pangubot", "img2dataset", "kangaroo bot", "icc-crawler"]
RUTAS_ESCANER = [".php", "/wp-", "/.env", "/.git", "/.aws", "/.ssh", "/.ds_store", "/.vscode", "/cgi-bin", "phpmyadmin",
                 "/xmlrpc", "/actuator", "/server-status", "/vendor/phpunit", "/.htaccess", "/.svn"]
# Lo que las listas de arriba no alcanzan (regex: Business). Visto en noviembre: `/.env_gcp`, `/aws.env.json`,
# `/constants.js` en medios, `.asp`, `/boaform`… Nada de esto existe en los sitios (Next sirve todo bajo /_next/).
REGEX_ESCANER = (r"(?i)(\.(php[0-9]?|aspx?|jsp|cgi|ini|bak|sql|swp|old|log)$)|(\.env)|(/\.(svn|hg|idea|docker|htpasswd))"
                 r"|(/boaform)|(/hnap1)|(/owa/)|(/telescope/)|(/_profiler)|(/debug/default)|(/config\.json$)"
                 r"|(/aws\.(json|ya?ml)$)|(/constants\.js$)|(/sftp-config)|(/\.well-known/(acme-challenge/)?[^/]*\.php)")
UA_SCRIPTS = ["python-requests", "python-urllib", "aiohttp", "httpx", "scrapy", "go-http-client", "curl/", "wget/",
              "libwww-perl", "okhttp", "java/", "apache-httpclient", "node-fetch", "axios/", "undici", "phantomjs", "colly",
              "mechanize", "guzzlehttp"]
# Scripts propios contra vigia.gobserva.cloud/v1 desde la PC: backend/scripts/precalentar_api.py y
# generar_graficos_readme.py. Sólo saltan Super Bot Fight Mode (el repo es público: el nombre no da más que eso).
UA_PROPIOS = ["VigiaPeru/", "vigia-readme/"]

# Redes de nubes y hosting (AWS, Google Cloud, Azure, DigitalOcean, Hetzner, OVH, Linode, Vultr, Contabo, Oracle,
# Alibaba, Tencent, Scaleway, Huawei, Hostinger, ColoCrossing, netcup, M247 y Datacamp de VPN): de ahí sale casi todo el
# scraping, y una persona casi nunca navega desde un servidor. Un desafío (no un bloqueo): quien usa una VPN lo resuelve.
# Sin 15169 (Google): ahí están el traductor y la precarga de Chrome. Los bots verificados (buscadores, vistas previas)
# pasan igual.
ASN_NUBES = [16509, 14618, 8987, 396982, 8075, 14061, 24940, 16276, 63949, 20473, 51167, 40021, 31898, 45102, 132203,
             12876, 136907, 47583, 36352, 197540, 9009, 60068]

# Buscadores e indexadores: pasan sin reglas administradas, límites ni Super Bot Fight Mode, sólo si Cloudflare los
# verifica por su IP (cf.client.bot): un nombre copiado no alcanza. El 2026-10-30 la regla de entrenamiento de IA
# (BOBA-199) bloqueaba a Googlebot y a Bingbot: Search Console no podía leer el sitemap (403).
UA_BUSCADORES = ["googlebot", "google-inspectiontool", "bingbot", "duckduckbot", "applebot", "yandexbot"]

# La clave pública de IndexNow (la misma en gobserva.cloud y vigia.gobserva.cloud: worker.js de esta carpeta y
# frontend/public/<clave>.txt). Sin esta excepción, el desafío a clientes sin navegador y a redes de nubes le daba 403 al
# verificador de IndexNow y la API rechazaba los avisos (probado el 2026-11-01).
CLAVE_INDEXNOW = "70c4458a363841ee4aef67be90cc8565"
SIN_CLAVE = f'(http.request.uri.path ne "/{CLAVE_INDEXNOW}.txt")'

# Vistas previas de enlaces: la tarjeta de un post (título, imagen) la arma un bot de la red social, que no resuelve un
# desafío, y Cloudflare no siempre lo verifica por su IP. El 2026-11-02 y el 11-03 LinkedInBot (su UA dice
# «Apache-HttpClient», que está en UA_SCRIPTS) recibió 403 desde Google Cloud y desde la red de LinkedIn: los posts salían
# sin imagen. Pasan las dos reglas de desafío y Super Bot Fight Mode por nombre: quien copie el nombre recibe páginas
# públicas, con los límites de la zona y el de la web (worker-comun.js).
UA_VISTAS_PREVIAS = ["linkedinbot", "facebookexternalhit", "whatsapp/", "twitterbot", "telegrambot", "slackbot",
                     "discordbot"]


def _alguno(campo, valores):
    return " or ".join(f'(lower({campo}) contains "{v}")' for v in valores)


DESAFIABLE = f'{SIN_CLAVE} and not ({_alguno("http.user_agent", UA_VISTAS_PREVIAS)})'
FUERA_PROGRAMAS = f"(not http.host in {PROGRAMAS})"
ESTATICO = r'(http.request.uri.path matches "(?i)\.(js|mjs|css|png|jpe?g|webp|avif|gif|svg|ico|woff2?|ttf|map|txt|xml|webmanifest)$")'


# ─── ajustes ─────────────────────────────────────────────────────────────────────────────────────────────────────────
def ajustes():
    informar("ajustes", llamar("PATCH", f"/zones/{ZONA}/settings", {"items": [
        {"id": "always_use_https", "value": "on"},
        {"id": "min_tls_version", "value": "1.2"},
        {"id": "tls_1_3", "value": "on"},
        {"id": "email_obfuscation", "value": "off"},
        {"id": "security_header", "value": {"strict_transport_security": {
            "enabled": True, "max_age": 15552000, "include_subdomains": False, "preload": False, "nosniff": True}}},
        {"id": "http3", "value": "on"},
        # 0-RTT: Cloudflare sólo lo acepta en pedidos idempotentes y marca los repetibles con Cf-0rtt-Unique.
        {"id": "0rtt", "value": "on"},
        {"id": "early_hints", "value": "on"},
        {"id": "brotli", "value": "on"},
        # Polish actúa sobre imágenes servidas desde la caché (medios.gobserva.cloud). Sin pérdida: hay QR de pago.
        {"id": "polish", "value": "lossless"},
        {"id": "webp", "value": "on"},
    ]}))


# ─── cache ───────────────────────────────────────────────────────────────────────────────────────────────────────────
def cache():
    informar("cache: niveles", llamar("PATCH", f"/zones/{ZONA}/cache/tiered_cache_smart_topology_enable", {"value": "on"}))
    # Las páginas y la API son Workers: la caché de la zona sólo sirve a lo que va a un origen, o sea a R2.
    # Un día en el borde: si se reemplaza un archivo con el mismo nombre, purgarlo (o esperar un día).
    informar("cache: medios", llamar("PUT", f"/zones/{ZONA}/rulesets/phases/http_request_cache_settings/entrypoint", {
        "description": "Gobserva: cache",
        "rules": [{
            "description": "medios.gobserva.cloud (R2): un dia en el borde",
            "expression": f'(http.host eq "{MEDIOS}")',
            "action": "set_cache_settings",
            "action_parameters": {"cache": True, "edge_ttl": {"mode": "override_origin", "default": 86400},
                                  "browser_ttl": {"mode": "respect_origin"}},
            "enabled": True,
        }],
    }))


# ─── bots ────────────────────────────────────────────────────────────────────────────────────────────────────────────
def bots():
    # ai_training "disabled" desde el 2026-10-30: con "block", la regla administrada «Block AI training crawlers»
    # (BOBA-199) devolvía 403 a Googlebot y a Bingbot y corre ANTES que las reglas propias. Los de entrenamiento quedan
    # fuera por nombre (regla propia) y por robots.txt.
    # Super Bot Fight Mode corre DESPUÉS de las reglas propias, que lo saltan para el MCP, medios, nuestros Workers, las
    # vistas previas y los buscadores (fase http_request_sbfm). «Probablemente automatizado» queda libre: también marca
    # a personas, y un desafío a un fetch del navegador (/v1, ?_rsc=) rompe la página en vez de pedir la verificación.
    informar("bots", llamar("PUT", f"/zones/{ZONA}/bot_management", {
        "ai_training": "disabled",
        "sbfm_definitely_automated": "managed_challenge",
        "sbfm_likely_automated": "allow",
        "sbfm_verified_bots": "allow",
        "sbfm_static_resource_protection": False,
        "enable_js": False,
        "optimize_wordpress": False,
    }))


# ─── waf (reglas propias) ────────────────────────────────────────────────────────────────────────────────────────────
def _llave_de_prueba():
    # Navegadores sin cabeza propios (Playwright, agent-browser) contra PROD: Super Bot Fight Mode los toma por bots.
    # Mandan `x-gobserva-prueba: <GOBSERVA_PRUEBA>` (C:/Users/usuario/.simplia/secretos.env). El valor NO va en el repo,
    # que es público: se lee del entorno al aplicar, y sin él no se aplica nada (el PUT borraría la regla).
    llave = os.environ.get("GOBSERVA_PRUEBA", "").strip()
    if len(llave) < 24:
        sys.exit("Falta GOBSERVA_PRUEBA en el entorno (de secretos.env).")
    return llave


def reglas_propias():
    saltar_todo = ["http_request_firewall_managed", "http_ratelimit", "http_request_sbfm"]
    return [
        {"description": "Navegadores de prueba propios (cabecera secreta): sin SBFM, limites, BIC ni nivel de seguridad",
         "action": "skip",
         "action_parameters": {"phases": ["http_ratelimit", "http_request_sbfm"], "products": ["bic", "securityLevel"]},
         "expression": f'any(http.request.headers["x-gobserva-prueba"][*] eq "{_llave_de_prueba()}")'},
        {"description": "Metodos HTTP que ningun sitio usa", "action": "block",
         "expression": 'not http.request.method in {"GET" "HEAD" "POST" "OPTIONS" "PUT" "PATCH" "DELETE"}'},
        {"description": "Escaneres de vulnerabilidades (rutas que Vigia no tiene)", "action": "block",
         "expression": f'({_alguno("http.request.uri.path", RUTAS_ESCANER)}) or (http.request.uri.path matches "{REGEX_ESCANER}")'},
        {"description": "Buscadores verificados (Google, Bing...): sin administradas, limites ni SBFM", "action": "skip",
         "action_parameters": {"phases": saltar_todo},
         "expression": f'cf.client.bot and ({_alguno("http.user_agent", UA_BUSCADORES)})'},
        {"description": "Nuestros Workers: sin SBFM, limites, BIC ni nivel de seguridad", "action": "skip",
         "action_parameters": {"phases": ["http_ratelimit", "http_request_sbfm"], "products": ["bic", "securityLevel"]},
         "expression": f"(cf.worker.upstream_zone in {ZONAS_PROPIAS})"},
        {"description": "MCP y medios los usan programas: sin SBFM, BIC ni nivel de seguridad", "action": "skip",
         "action_parameters": {"phases": ["http_request_sbfm"], "products": ["bic", "securityLevel"]},
         "expression": f"(http.host in {PROGRAMAS})"},
        {"description": "MCP desde Anthropic (claude.ai): sin limite por IP, el MCP cuenta por cuenta", "action": "skip",
         "action_parameters": {"phases": ["http_ratelimit"]},
         "expression": f'(http.host eq "{MCP}") and (ip.src in {{{ANTHROPIC}}})'},
        {"description": "Vistas previas, IndexNow y scripts propios: sin SBFM", "action": "skip",
         "action_parameters": {"phases": ["http_request_sbfm"]},
         "expression": f'(not {SIN_CLAVE}) or ({_alguno("http.user_agent", UA_VISTAS_PREVIAS)}) or '
                       + " or ".join(f'starts_with(http.user_agent, "{u}")' for u in UA_PROPIOS)},
        {"description": "Rastreadores de entrenamiento de IA, por nombre", "action": "block",
         "expression": f'{FUERA_PROGRAMAS} and ({_alguno("http.user_agent", UA_ENTRENAMIENTO)})'},
        {"description": "Clientes de scripts sin navegador (los bots verificados pasan)", "action": "managed_challenge",
         "expression": f'{FUERA_PROGRAMAS} and ((not cf.client.bot) and {DESAFIABLE} and ((http.user_agent eq "") or {_alguno("http.user_agent", UA_SCRIPTS)}))'},
        {"description": "Redes de nubes y hosting: desafio (los bots verificados pasan)", "action": "managed_challenge",
         "expression": f'{FUERA_PROGRAMAS} and ((not cf.client.bot) and {DESAFIABLE} and (ip.geoip.asnum in {{{" ".join(str(a) for a in ASN_NUBES)}}}))'},
    ]


def waf():
    reglas = [dict(r, enabled=True) for r in reglas_propias()]
    informar("waf", llamar("PUT", f"/zones/{ZONA}/rulesets/phases/http_request_firewall_custom/entrypoint",
                           {"description": "Vigia: reglas propias", "rules": reglas}))


# ─── administradas ───────────────────────────────────────────────────────────────────────────────────────────────────
ADMINISTRADAS_CF = "efb7b8c949ac4650a09736fc376e9aee"   # Cloudflare Managed Ruleset
OWASP = "4814384a9e5d4991b9815dcfc25d2f1f"              # Cloudflare OWASP Core Ruleset
OWASP_UMBRAL = "6179ae15870a4bb7b2d480d4843b323c"       # 949110: Inbound Anomaly Score Exceeded


def administradas():
    # OWASP da falsos positivos con texto libre (preguntas al chat, JSON del MCP, archivos subidos): sólo GET/HEAD de los
    # sitios, nivel de paranoia 1, umbral 60 (sensibilidad baja) y desafío, que una persona resuelve.
    informar("administradas", llamar("PUT", f"/zones/{ZONA}/rulesets/phases/http_request_firewall_managed/entrypoint", {
        "description": "Gobserva: reglas administradas",
        "rules": [
            {"description": "Reglas administradas de Cloudflare", "action": "execute", "expression": "true", "enabled": True,
             "action_parameters": {"id": ADMINISTRADAS_CF}},
            {"description": "OWASP nivel 1, sensibilidad baja, solo GET de los sitios", "action": "execute", "enabled": True,
             "expression": f'(http.request.method in {{"GET" "HEAD"}}) and {FUERA_PROGRAMAS}',
             "action_parameters": {"id": OWASP, "overrides": {
                 "categories": [{"category": f"paranoia-level-{n}", "enabled": False} for n in (2, 3, 4)],
                 "rules": [{"id": OWASP_UMBRAL, "action": "managed_challenge", "score_threshold": 60}]}}},
        ],
    }))


# ─── limite (5 reglas de rate limiting) ──────────────────────────────────────────────────────────────────────────────
# Calibrado el 2026-11-06 con 72 h de tráfico: la persona que más navegó hizo ~320 páginas en 15 min (≈210 en 10) y
# 66 pedidos ?_rsc= en un minuto. «IP con NAT» (cf.unique_visitor_id, Business) separa a quienes comparten IP (CGNAT de
# las móviles). Nuestros Workers, Anthropic en el MCP y los buscadores verificados saltan esta fase (reglas propias).
VISITANTE = ["cf.colo.id", "cf.unique_visitor_id"]
PAGINAS = (f'{FUERA_PROGRAMAS} and (not cf.client.bot) and (not starts_with(http.request.uri.path, "/_next/")) '
           f'and (not starts_with(http.request.uri.path, "/cdn-cgi/")) and (not {ESTATICO})')


def reglas_limite():
    return [
        {"description": "Escaneres: 30 rutas inexistentes (404) por minuto -> bloqueo 1 h", "action": "block",
         "expression": '(not cf.client.bot) and (not starts_with(http.request.uri.path, "/_next/"))',
         "ratelimit": {"characteristics": VISITANTE, "period": 60, "requests_per_period": 30, "mitigation_timeout": 3600,
                       "counting_expression": "(http.response.code eq 404)"}},
        {"description": "Acceso y formularios: 30 por minuto (OAuth del MCP y POST de la web) -> bloqueo 10 min",
         "action": "block",
         "expression": (f'((http.host eq "{MCP}") and (starts_with(http.request.uri.path, "/authorize") or '
                        f'starts_with(http.request.uri.path, "/oauth/"))) or ((http.request.method eq "POST") and '
                        f'{FUERA_PROGRAMAS} and (not starts_with(http.request.uri.path, "/api/admin/")) and '
                        f'(not starts_with(http.request.uri.path, "/cdn-cgi/")))'),
         "ratelimit": {"characteristics": VISITANTE, "period": 60, "requests_per_period": 30, "mitigation_timeout": 600}},
        {"description": "Rafaga: 150 pedidos en 10 s por visitante (sin estaticos) -> bloqueo 1 min", "action": "block",
         "expression": PAGINAS,
         "ratelimit": {"characteristics": VISITANTE, "period": 10, "requests_per_period": 150, "mitigation_timeout": 60}},
        {"description": "Lectura sostenida: 600 paginas o /v1 en 10 min por visitante -> desafio", "action": "managed_challenge",
         "expression": f'{PAGINAS} and (not http.request.uri.query contains "_rsc=") and (not http.host contains "-dev.")',
         "ratelimit": {"characteristics": VISITANTE, "period": 600, "requests_per_period": 600, "mitigation_timeout": 0}},
        {"description": "MCP fuera de Anthropic: 300 por minuto por IP -> bloqueo 10 min", "action": "block",
         "expression": f'(http.host eq "{MCP}")',
         "ratelimit": {"characteristics": ["cf.colo.id", "ip.src"], "period": 60, "requests_per_period": 300,
                       "mitigation_timeout": 600}},
    ]


def limite():
    informar("limite", llamar("PUT", f"/zones/{ZONA}/rulesets/phases/http_ratelimit/entrypoint", {
        "description": "Gobserva: limites", "rules": [dict(r, enabled=True) for r in reglas_limite()]}))


# ─── paginas (bloqueo, límite, desafío, errores) ─────────────────────────────────────────────────────────────────────
# Las genera paginas_error.py en esta carpeta; se suben a R2 (vigia-peru-reportes/errores/) y Cloudflare guarda una copia
# al registrarlas: después de cambiar una, volver a correr esta parte.
PAGINAS_ERROR = {"waf_block": "bloqueo", "ip_block": "bloqueo", "ratelimit_block": "limite",
                 "managed_challenge": "desafio", "country_challenge": "desafio", "under_attack": "ataque",
                 "500_errors": "error500", "1000_errors": "error1000"}


def paginas():
    for tipo, archivo in PAGINAS_ERROR.items():
        informar(f"pagina {tipo}", llamar("PUT", f"/zones/{ZONA}/custom_pages/{tipo}",
                                          {"url": f"https://{MEDIOS}/errores/{archivo}.html", "state": "customized"}))


# ─── escudo (Page Shield) ────────────────────────────────────────────────────────────────────────────────────────────
def escudo():
    informar("escudo", llamar("PUT", f"/zones/{ZONA}/page_shield", {"enabled": True, "use_cloudflare_reporting_endpoint": True}))


# ─── salud y avisos ──────────────────────────────────────────────────────────────────────────────────────────────────
# Rutas livianas: /robots.txt no toca la base; /health de la API sí (SELECT 1): avisa si la base no responde.
CHEQUEOS = [
    ("vigia", "vigia.gobserva.cloud", "/robots.txt"),
    ("obras", "obras.gobserva.cloud", "/robots.txt"),
    ("licitaciones", "licitaciones.gobserva.cloud", "/robots.txt"),
    ("empleo", "empleo.gobserva.cloud", "/robots.txt"),
    ("portada", "gobserva.cloud", "/robots.txt"),
    ("mcp", MCP, "/"),
    ("medios", MEDIOS, "/errores/bloqueo.html"),
    ("api-y-base", "vigia-api.vigiaperu.workers.dev", "/health"),
]


def _correo_de_la_cuenta():
    # El aviso va al correo con el que ya está registrada la cuenta de Cloudflare (sin escribirlo en el repo).
    miembros = llamar("GET", f"/accounts/{CUENTA}/members?per_page=50").get("result") or []
    for m in miembros:
        correo = (m.get("user") or {}).get("email")
        if correo:
            return correo
    sys.exit("No se encontró el correo de la cuenta de Cloudflare.")


def _politica(nombre, tipo, correo, filtros=None, descripcion=""):
    actuales = llamar("GET", f"/accounts/{CUENTA}/alerting/v3/policies").get("result") or []
    cuerpo = {"name": nombre, "description": descripcion, "alert_type": tipo, "enabled": True,
              "mechanisms": {"email": [{"id": correo}]}, "filters": filtros or {}}
    previa = next((p for p in actuales if p.get("name") == nombre), None)
    if previa:
        return llamar("PUT", f"/accounts/{CUENTA}/alerting/v3/policies/{previa['id']}", cuerpo)
    return llamar("POST", f"/accounts/{CUENTA}/alerting/v3/policies", cuerpo)


def salud():
    vivos = {h["name"]: h for h in (llamar("GET", f"/zones/{ZONA}/healthchecks?per_page=50").get("result") or [])}
    ids = []
    for nombre, host, ruta in CHEQUEOS:
        cuerpo = {"name": nombre, "address": host, "type": "HTTPS", "interval": 60, "retries": 2, "timeout": 10,
                  "consecutive_fails": 2, "consecutive_successes": 1, "check_regions": ["SSAM", "ENAM"],
                  "description": f"https://{host}{ruta}",
                  "http_config": {"method": "GET", "path": ruta, "port": 443, "expected_codes": ["200"],
                                  "follow_redirects": False, "allow_insecure": False,
                                  "header": {"Host": [host], "User-Agent": ["Gobserva-Salud/1.0 (Cloudflare Health Checks)"]}}}
        if nombre in vivos:
            r = llamar("PUT", f"/zones/{ZONA}/healthchecks/{vivos[nombre]['id']}", cuerpo)
        else:
            r = llamar("POST", f"/zones/{ZONA}/healthchecks", cuerpo)
        if informar(f"salud {nombre}", r):
            ids.append(r["result"]["id"])
    correo = _correo_de_la_cuenta()
    informar("aviso salud", _politica("Gobserva: un sitio dejo de responder", "health_check_status_notification", correo,
                                      {"health_check_id": ids, "status": ["Unhealthy", "Healthy"]},
                                      "Cambios de estado de los chequeos de salud de gobserva.cloud y de la API"))
    informar("aviso ddos", _politica("Gobserva: ataque DDoS HTTP", "dos_attack_l7", correo))  # de cuenta: no admite filtro de zona
    informar("aviso waf", _politica("Gobserva: pico de eventos del WAF", "clickhouse_alert_fw_anomaly", correo, {"zones": [ZONA]}))
    informar("aviso scripts", _politica("Gobserva: dominio nuevo en los scripts", "scriptmonitor_alert_new_hosts", correo,
                                        {"zones": [ZONA]}))


# ─── sala de espera ──────────────────────────────────────────────────────────────────────────────────────────────────
def sala(prender=False):
    cuerpo = {"name": "vigia_avalancha", "host": "vigia.gobserva.cloud", "path": "/",
              "description": "Freno ante una avalancha: se prende a mano (proteger_zona.py sala on)",
              "new_users_per_minute": 600, "total_active_users": 2000, "session_duration": 5,
              "default_template_language": "es-ES", "search_engine_crawler_bypass": True,
              "queueing_method": "fifo", "queueing_status_code": 200, "suspended": not prender}
    vivas = llamar("GET", f"/zones/{ZONA}/waiting_rooms").get("result") or []
    previa = next((s for s in vivas if s.get("name") == cuerpo["name"]), None)
    if previa:
        informar(f"sala {'on' if prender else 'off'}", llamar("PUT", f"/zones/{ZONA}/waiting_rooms/{previa['id']}", cuerpo))
    else:
        informar(f"sala {'on' if prender else 'off'}", llamar("POST", f"/zones/{ZONA}/waiting_rooms", cuerpo))


# ─── estado ──────────────────────────────────────────────────────────────────────────────────────────────────────────
def estado():
    s = llamar("GET", f"/zones/{ZONA}/settings").get("result") or []
    quiero = {"always_use_https", "min_tls_version", "email_obfuscation", "security_level", "browser_check", "ssl", "http3",
              "0rtt", "early_hints", "brotli", "polish", "webp"}
    print("ajustes:", {x["id"]: x["value"] for x in s if x["id"] in quiero})
    b = llamar("GET", f"/zones/{ZONA}/bot_management").get("result") or {}
    print("bots:", {k: b.get(k) for k in ("ai_training", "sbfm_definitely_automated", "sbfm_likely_automated",
                                           "sbfm_verified_bots", "enable_js")})
    for fase in ("http_request_firewall_custom", "http_request_firewall_managed", "http_ratelimit",
                 "http_request_cache_settings"):
        r = llamar("GET", f"/zones/{ZONA}/rulesets/phases/{fase}/entrypoint").get("result") or {}
        for regla in r.get("rules") or []:
            print(f"{fase}: {regla.get('action')} | {regla.get('description')}")
    ps = llamar("GET", f"/zones/{ZONA}/page_shield").get("result") or {}
    print("page shield:", ps.get("enabled"))
    for h in llamar("GET", f"/zones/{ZONA}/healthchecks").get("result") or []:
        print(f"salud {h['name']}: {h.get('status')} {h.get('failure_reason') or ''}")
    for w in llamar("GET", f"/zones/{ZONA}/waiting_rooms").get("result") or []:
        print(f"sala {w['name']}: {'apagada' if w.get('suspended') else 'PRENDIDA'}")
    print("paginas:", {p["id"]: p.get("state") for p in (llamar("GET", f"/zones/{ZONA}/custom_pages").get("result") or [])})


ACCIONES = {"ajustes": ajustes, "cache": cache, "bots": bots, "waf": waf, "administradas": administradas,
            "limite": limite, "paginas": paginas, "escudo": escudo, "salud": salud, "estado": estado}
TODO = ["ajustes", "cache", "waf", "bots", "administradas", "limite", "paginas", "escudo", "salud"]
if __name__ == "__main__":
    pedido = sys.argv[1] if len(sys.argv) > 1 else "estado"
    if pedido == "sala":
        sala(prender=len(sys.argv) > 2 and sys.argv[2] == "on")
    else:
        for accion in (TODO if pedido == "todo" else [pedido]):
            ACCIONES[accion]()
