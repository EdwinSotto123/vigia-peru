"""Páginas propias de Cloudflare para gobserva.cloud (bloqueo, límite, desafío, ataque y errores 5xx/1xxx).

    python paginas_error.py            # escribe errores/*.html en esta carpeta
    (después) subirlas a R2 y registrarlas: ver README, sección «Páginas de error»

Reglas de Cloudflare: cada página debe tener <head>, pesar menos de 1,5 MB, NO llevar <meta name="referrer"> (rompe los
desafíos) y llevar su marcador: ::CAPTCHA_BOX:: (desafío), ::IM_UNDER_ATTACK_BOX:: (modo ataque),
::CLOUDFLARE_ERROR_500S_BOX:: y ::CLOUDFLARE_ERROR_1000S_BOX::. ::RAY_ID:: es opcional (el código para escribirnos).
Cloudflare guarda una copia al registrarlas: después de cambiar una, volver a correr `proteger_zona.py paginas`.
Sin fuentes ni scripts externos: la página se muestra justo cuando algo falla.
"""
from pathlib import Path

CSS = """
:root { color-scheme: dark light; --fondo: #030B07; --panel: #071810; --borde: #1C4A33; --tinta: #E2F7EA;
  --suave: #A9CDB8; --tenue: #6F9D84; --acento: #3DFF8A; --lima: #D4FF3F; --sobre-lima: #04100A; }
@media (prefers-color-scheme: light) { :root { --fondo: #EDF4EF; --panel: #F8FCF9; --borde: #9FBFAC; --tinta: #0A1C12;
  --suave: #2F4A3B; --tenue: #4F6F5D; --acento: #087A3B; --lima: #2F6B10; --sobre-lima: #FFFFFF; } }
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--fondo); color: var(--tinta); }
body { font: 16px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px 16px; }
main { width: 100%; max-width: 620px; }
.marca { font: 600 20px/1 ui-monospace, "JetBrains Mono", "SFMono-Regular", Menlo, Consolas, monospace; color: var(--tinta);
  text-decoration: none; letter-spacing: -0.02em; }
.marca b { color: var(--lima); font-weight: 600; }
.codigo { display: block; margin: 28px 0 8px; font: 600 13px/1 ui-monospace, Menlo, Consolas, monospace;
  color: var(--acento); letter-spacing: 0.08em; text-transform: uppercase; }
h1 { font-size: clamp(26px, 6vw, 36px); line-height: 1.15; margin: 0 0 12px; letter-spacing: -0.01em; text-wrap: balance; }
p { margin: 0 0 14px; color: var(--suave); }
ol { margin: 18px 0; padding-left: 0; list-style: none; counter-reset: paso; }
ol li { counter-increment: paso; position: relative; padding: 10px 0 10px 44px; border-top: 1px solid var(--borde); color: var(--tinta); }
ol li::before { content: counter(paso); position: absolute; left: 0; top: 9px; width: 28px; height: 28px; border-radius: 50%;
  border: 1px solid var(--acento); color: var(--acento); font: 600 14px/26px ui-monospace, Menlo, monospace; text-align: center; }
a { color: var(--acento); text-underline-offset: 3px; }
.caja { margin: 22px 0; padding: 16px 18px; background: var(--panel); border: 1px solid var(--borde); border-radius: 12px; }
.caja strong { display: block; margin-bottom: 4px; color: var(--tinta); }
.caja p { margin: 0; }
.cf { margin: 20px 0; }
.ray { margin-top: 26px; font: 13px/1.5 ui-monospace, Menlo, Consolas, monospace; color: var(--tenue); word-break: break-all; }
.boton { display: inline-block; margin-top: 6px; padding: 10px 16px; border-radius: 8px; background: var(--lima);
  color: var(--sobre-lima); font-weight: 600; text-decoration: none; }
"""

MCP = ('<div class="caja"><strong>¿Necesitas los datos para investigar o para tu IA?</strong><p>No hace falta raspar el '
       'sitio: conecta Claude u otra IA al MCP de Vigía, con las mismas cifras y fuentes. Instrucciones en '
       '<a href="https://mcp.gobserva.cloud/">mcp.gobserva.cloud</a>.</p></div>')
RAY = '<p class="ray">Código del pedido: ::RAY_ID::</p>'


def pagina(titulo, codigo, cuerpo, pie=RAY):
    return f"""<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>{titulo} | Gobserva</title>
<style>{CSS}</style>
</head>
<body>
<main>
<a class="marca" href="https://gobserva.cloud/">gobserva<b>_</b></a>
<span class="codigo">{codigo}</span>
{cuerpo}
{pie}
</main>
</body>
</html>
"""


PAGINAS = {
    "bloqueo": pagina("Bloqueamos este pedido", "Pedido bloqueado", f"""
<h1>Bloqueamos este pedido</h1>
<p>El filtro de seguridad de Gobserva frenó esta visita. Pasa casi siempre con programas automáticos o con direcciones
que el sitio no tiene.</p>
<ol>
<li>Si llegaste navegando, vuelve a <a href="https://vigia.gobserva.cloud/">Vigía</a> y prueba otra vez.</li>
<li>Si usas una VPN o la red de una empresa, prueba sin ella.</li>
<li>Si sigue pasando, escríbenos a <a href="mailto:hello@gobserva.cloud">hello@gobserva.cloud</a> con el código de abajo.</li>
</ol>
{MCP}"""),
    "limite": pagina("Vas demasiado rápido", "Demasiados pedidos", f"""
<h1>Vas demasiado rápido</h1>
<p>Llegaron muchos pedidos desde tu conexión en poco tiempo. Es un freno contra el raspado automático.</p>
<ol>
<li>Espera un minuto.</li>
<li>Vuelve a cargar la página.</li>
<li>Si compartes la conexión con mucha gente y te pasa seguido, escríbenos a
<a href="mailto:hello@gobserva.cloud">hello@gobserva.cloud</a> con el código de abajo.</li>
</ol>
{MCP}"""),
    "desafio": pagina("Comprobamos que eres una persona", "Verificación", """
<h1>Un momento: comprobamos que eres una persona</h1>
<p>Lo pedimos cuando la visita llega desde una nube, una VPN o un programa. Suele resolverse solo en unos segundos.</p>
<div class="cf">::CAPTCHA_BOX::</div>"""),
    "ataque": pagina("Estamos recibiendo mucho tráfico", "Verificación", """
<h1>Estamos recibiendo mucho tráfico</h1>
<p>Para que el sitio siga en pie, revisamos cada visita antes de dejarla pasar. Espera unos segundos.</p>
<div class="cf">::IM_UNDER_ATTACK_BOX::</div>"""),
    "error500": pagina("Algo falló de nuestro lado", "Error del servidor", """
<h1>Algo falló de nuestro lado</h1>
<p>El sitio no respondió bien. No es tu conexión: ya nos llega el aviso.</p>
<ol>
<li>Vuelve a intentarlo en unos minutos.</li>
<li>Si sigue igual, escríbenos a <a href="mailto:hello@gobserva.cloud">hello@gobserva.cloud</a> con el código de abajo.</li>
</ol>
<div class="cf">::CLOUDFLARE_ERROR_500S_BOX::</div>"""),
    "error1000": pagina("No pudimos atender este pedido", "Error", """
<h1>No pudimos atender este pedido</h1>
<p>La dirección o la configuración del pedido no es válida para este sitio.</p>
<p><a class="boton" href="https://vigia.gobserva.cloud/">Ir a Vigía</a></p>
<div class="cf">::CLOUDFLARE_ERROR_1000S_BOX::</div>"""),
}

if __name__ == "__main__":
    carpeta = Path(__file__).with_name("errores")
    carpeta.mkdir(exist_ok=True)
    for nombre, html in PAGINAS.items():
        (carpeta / f"{nombre}.html").write_text(html, encoding="utf-8", newline="\n")
        print(nombre, len(html.encode()), "bytes")
