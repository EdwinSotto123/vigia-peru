// gobserva.cloud: la portada de Gobserva (2026-11-01, pedido del usuario: que «gobserva» y «gobserva cloud» aparezcan en
// los buscadores). Antes la raíz redirigía a Vigía y no había ninguna página que un buscador pudiera mostrar para la marca.
//
//   gobserva.cloud/                    la portada (HTML con los datos estructurados de la organización)
//   gobserva.cloud/robots.txt          los buscadores sí; los rastreadores de entrenamiento de IA, no (como Vigía)
//   gobserva.cloud/sitemap.xml         la portada
//   gobserva.cloud/<CLAVE_INDEXNOW>.txt  la clave pública de IndexNow (Bing y compañía se enteran al momento de un cambio)
//   gobserva.cloud/<otra ruta>         302 a la misma ruta en vigia.gobserva.cloud: los enlaces viejos siguen andando.
//                                      Temporal a propósito: un 301 queda guardado en el navegador para siempre (el 01-11 la
//                                      raíz vieja, un 301 a Vigía, seguía redirigiendo en los navegadores que ya la conocían)
//                                      y Gobserva puede tener más páginas.
//   www.gobserva.cloud/<ruta>          301 a gobserva.cloud/<ruta> (un solo dominio para los buscadores)
//
// El nombre del Worker (gobserva-redirect) se mantiene: los custom domains están atados a él. Despliegue: README.md.

const RAIZ = "https://gobserva.cloud";
const VIGIA = "https://vigia.gobserva.cloud";
const CLAVE_INDEXNOW = "70c4458a363841ee4aef67be90cc8565";
// La fecha de la última versión de la portada (sitemap y datos estructurados): cambiarla al cambiar el contenido.
const ACTUALIZADA = "2026-11-01";

const ORGANIZACION = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${RAIZ}/#organizacion`,
      name: "Gobserva",
      alternateName: ["Gobserva Cloud", "gobserva.cloud"],
      url: `${RAIZ}/`,
      logo: `${VIGIA}/assets/logo/vigia_peru_512.png`,
      description:
        "Gobserva es una GovTech peruana: hace tecnología cívica con datos abiertos del Estado para que cualquiera pueda vigilar el uso del dinero público.",
      areaServed: { "@type": "Country", name: "Perú" },
      knowsAbout: ["contrataciones públicas", "transparencia", "datos abiertos", "tecnología cívica"],
    },
    {
      "@type": "WebSite",
      "@id": `${RAIZ}/#sitio`,
      url: `${RAIZ}/`,
      name: "Gobserva",
      alternateName: "Gobserva Cloud",
      inLanguage: "es-PE",
      publisher: { "@id": `${RAIZ}/#organizacion` },
      dateModified: ACTUALIZADA,
    },
    {
      "@type": "WebSite",
      "@id": `${VIGIA}/#sitio`,
      url: `${VIGIA}/`,
      name: "Vigía by Gobserva",
      alternateName: ["Vigía", "Vigía Perú"],
      inLanguage: "es-PE",
      publisher: { "@id": `${RAIZ}/#organizacion` },
    },
  ],
};

const TITULO = "Gobserva: tecnología cívica para vigilar el Estado peruano";
const DESCRIPCION =
  "Gobserva hace tecnología cívica con datos del Estado peruano. Su primer producto, Vigía, revisa los contratos públicos y te muestra cuáles mirar dos veces.";

// El ícono de la pestaña: la G de Gobserva en lima sobre carbón, sin archivos aparte.
const ICONO =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0B0F0F"/>' +
      '<text x="32" y="44" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="38" font-weight="700" fill="#D4FF3F">G</text></svg>',
  );

const FUENTES = ["OECE y SEACE", "MEF", "SUNAT", "Contraloría", "INFOBRAS", "JNE", "ONPE", "SERVIR", "Congreso", "PCM"];

const PORTADA = `<!doctype html>
<html lang="es-PE">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${TITULO}</title>
<meta name="description" content="${DESCRIPCION}">
<link rel="canonical" href="${RAIZ}/">
<meta name="robots" content="index, follow">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Gobserva">
<meta property="og:locale" content="es_PE">
<meta property="og:url" content="${RAIZ}/">
<meta property="og:title" content="${TITULO}">
<meta property="og:description" content="${DESCRIPCION}">
<meta property="og:image" content="${VIGIA}/opengraph-image">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${TITULO}">
<meta name="twitter:description" content="${DESCRIPCION}">
<meta name="twitter:image" content="${VIGIA}/opengraph-image">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#EFF3F2">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0B0F0F">
<link rel="icon" href="${ICONO}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@500;700&display=swap">
<script type="application/ld+json">${JSON.stringify(ORGANIZACION)}</script>
<style>
:root {
  --fondo: #EFF3F2; --tarjeta: #FFFFFF; --borde: #BECAC7; --tinta: #111817; --tinta-suave: #374442; --tenue: #586764;
  --acento: #2F6B10; --lima: #D4FF3F; --sobre-lima: #0B0F0F; --banda: #163A1E; --banda-tinta: #E7F0EE;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --fondo: #0B0F0F; --tarjeta: #111717; --borde: #2C3939; --tinta: #E7F0EE; --tinta-suave: #BECDCA; --tenue: #8FA3A0;
    --acento: #D4FF3F; --banda: #111717; --banda-tinta: #E7F0EE;
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0; background: var(--fondo); color: var(--tinta);
  font: 400 1.0625rem/1.65 Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
a { color: inherit; }
.marco { max-width: 64rem; margin: 0 auto; padding-left: max(1.25rem, env(safe-area-inset-left, 0px)); padding-right: max(1.25rem, env(safe-area-inset-right, 0px)); }
header.marco { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding-block: 1.5rem; }
.palabra { font: 700 1.375rem/1 "Space Grotesk", Inter, sans-serif; letter-spacing: -0.02em; text-decoration: none; display: inline-flex; align-items: center; gap: .6rem; }
.palabra .g { display: inline-grid; place-items: center; width: 2rem; height: 2rem; border-radius: .55rem; background: var(--sobre-lima); color: var(--lima); font-size: 1.15rem; box-shadow: inset 0 0 0 1px var(--borde); }
nav a { font-weight: 600; text-decoration: none; color: var(--acento); }
nav a:hover { text-decoration: underline; }
.portada { padding-block: 3.5rem 4rem; }
.antetitulo { font: 600 .8125rem/1 Inter, sans-serif; letter-spacing: .14em; text-transform: uppercase; color: var(--acento); margin: 0 0 1rem; }
h1 { font: 700 clamp(3.25rem, 11vw, 6.5rem)/0.95 "Space Grotesk", Inter, sans-serif; letter-spacing: -0.045em; margin: 0; }
.lema { font: 500 clamp(1.5rem, 4vw, 2.25rem)/1.15 "Space Grotesk", Inter, sans-serif; letter-spacing: -0.02em; margin: 1.25rem 0 0; max-width: 22ch; text-wrap: balance; }
.entrada { margin: 1.5rem 0 0; max-width: 60ch; color: var(--tinta-suave); font-size: 1.125rem; }
.acciones { display: flex; flex-wrap: wrap; gap: .75rem; margin-top: 2rem; }
.boton { display: inline-flex; align-items: center; gap: .5rem; min-height: 2.875rem; padding: .7rem 1.25rem; border-radius: .75rem; font-weight: 600; text-decoration: none; border: 1px solid transparent; }
.boton.lima { background: var(--lima); color: var(--sobre-lima); }
.boton.lima:hover { filter: brightness(.95); }
.boton.borde { border-color: var(--borde); color: var(--tinta); background: var(--tarjeta); }
.boton.borde:hover { border-color: var(--acento); }
.boton:focus-visible, nav a:focus-visible, .palabra:focus-visible { outline: 3px solid var(--acento); outline-offset: 3px; }
section { padding-block: 2.5rem; }
h2 { font: 700 clamp(1.5rem, 3.5vw, 2rem)/1.15 "Space Grotesk", Inter, sans-serif; letter-spacing: -0.02em; margin: 0 0 1.25rem; text-wrap: balance; }
.producto { display: grid; grid-template-columns: auto 1fr; gap: 1.5rem 2rem; align-items: start; background: var(--tarjeta); border: 1px solid var(--borde); border-radius: 1.25rem; padding: clamp(1.25rem, 4vw, 2.25rem); }
.producto img { width: 5.5rem; height: 5.5rem; border-radius: 1.1rem; display: block; }
.producto h3 { font: 700 1.5rem/1.2 "Space Grotesk", Inter, sans-serif; margin: 0; }
.producto .firma { color: var(--tenue); font-size: .9375rem; margin: .2rem 0 0; }
.producto p.texto { margin: 1rem 0 0; color: var(--tinta-suave); max-width: 62ch; }
.fuentes { display: flex; flex-wrap: wrap; gap: .5rem; margin: 1.25rem 0 0; padding: 0; list-style: none; }
.fuentes li { font-size: .875rem; font-weight: 500; padding: .3rem .7rem; border-radius: 999px; border: 1px solid var(--borde); color: var(--tinta-suave); }
.producto .acciones { margin-top: 1.5rem; }
.principios { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem; margin: 0; padding: 0; list-style: none; }
.principios li { background: var(--tarjeta); border: 1px solid var(--borde); border-radius: 1rem; padding: 1.25rem 1.25rem 1.4rem; min-width: 0; }
.principios .num { font: 700 .875rem/1 "Space Grotesk", Inter, sans-serif; color: var(--acento); letter-spacing: .08em; }
.principios h3 { font: 700 1.1875rem/1.25 "Space Grotesk", Inter, sans-serif; margin: .6rem 0 .5rem; }
.principios p { margin: 0; color: var(--tinta-suave); font-size: 1rem; }
footer { margin-top: 3rem; background: var(--banda); color: var(--banda-tinta); }
footer .marco { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 1.5rem; padding-block: 2.5rem; }
footer .nombre { font: 700 1.25rem/1 "Space Grotesk", Inter, sans-serif; margin: 0 0 .5rem; }
footer p { margin: 0; opacity: .8; font-size: .9375rem; }
footer ul { list-style: none; margin: 0; padding: 0; display: grid; gap: .5rem; }
footer a { text-decoration: none; opacity: .9; }
footer a:hover { text-decoration: underline; opacity: 1; }
@media (max-width: 47.99rem) {
  .producto { grid-template-columns: 1fr; }
  .principios { grid-template-columns: 1fr; }
  .portada { padding-block: 2rem 3rem; }
}
</style>
</head>
<body>
<header class="marco">
  <a class="palabra" href="${RAIZ}/" aria-label="Gobserva, inicio"><span class="g" aria-hidden="true">G</span>Gobserva</a>
  <nav aria-label="Principal"><a href="${VIGIA}/">Ir a Vigía</a></nav>
</header>
<main>
  <div class="marco portada">
    <p class="antetitulo">GovTech peruana</p>
    <h1>Gobserva</h1>
    <p class="lema">Tecnología cívica para vigilar el Estado peruano.</p>
    <p class="entrada">Hacemos herramientas abiertas que leen los registros públicos del Perú, los cruzan entre sí y te muestran qué revisar, siempre con la fuente oficial al lado para que lo compruebes tú.</p>
    <div class="acciones">
      <a class="boton lima" href="${VIGIA}/">Entrar a Vigía</a>
      <a class="boton borde" href="${VIGIA}/fuentes">Ver las fuentes de datos</a>
    </div>
  </div>

  <section class="marco" aria-labelledby="producto">
    <h2 id="producto">Nuestro primer producto</h2>
    <article class="producto">
      <img src="${VIGIA}/assets/logo/vigia_peru_512.png" alt="Logo de Vigía" width="88" height="88" loading="lazy">
      <div>
        <h3>Vigía</h3>
        <p class="firma">Vigía by Gobserva</p>
        <p class="texto">Lee los contratos del Estado, los cruza con registros oficiales y marca los que merecen una segunda mirada: proveedores sancionados, empresas recién fundadas que ganan contratos grandes, aportes a campañas, visitas antes de una buena pro. Cada señal trae la norma que la sustenta y el enlace a su fuente.</p>
        <ul class="fuentes" aria-label="Fuentes oficiales que cruza">
          ${FUENTES.map((f) => `<li>${f}</li>`).join("")}
        </ul>
        <div class="acciones">
          <a class="boton lima" href="${VIGIA}/">Explorar Vigía</a>
          <a class="boton borde" href="${VIGIA}/app/mapa">Ver el mapa del Perú</a>
        </div>
      </div>
    </article>
  </section>

  <section class="marco" aria-labelledby="como">
    <h2 id="como">Cómo trabajamos</h2>
    <ol class="principios">
      <li><span class="num">01</span><h3>Datos oficiales</h3><p>Sólo registros públicos del Estado, cargados como los publica cada institución y con la fecha de cada carga.</p></li>
      <li><span class="num">02</span><h3>La fuente al lado</h3><p>Cada señal dice qué norma la sustenta y enlaza al documento original. Nada se cree por fe.</p></li>
      <li><span class="num">03</span><h3>Indicios, no acusaciones</h3><p>Una señal es una razón para mirar de nuevo, no una prueba. Y las personas están protegidas: nunca su DNI.</p></li>
    </ol>
  </section>
</main>
<footer>
  <div class="marco">
    <div>
      <p class="nombre">Gobserva</p>
      <p>Tecnología cívica desde Lima, Perú.</p>
      <p>© 2026 Gobserva</p>
    </div>
    <ul aria-label="Enlaces">
      <li><a href="${VIGIA}/">Vigía</a></li>
      <li><a href="${VIGIA}/fuentes">Fuentes de datos</a></li>
      <li><a href="https://github.com/EdwinSotto123/vigia-peru">Código abierto</a></li>
    </ul>
  </div>
</footer>
</body>
</html>`;

// Los rastreadores de entrenamiento de IA, fuera (la misma lista que el robots.txt de Vigía); los buscadores, bienvenidos.
const ROBOTS = `User-Agent: GPTBot
User-Agent: ClaudeBot
User-Agent: anthropic-ai
User-Agent: CCBot
User-Agent: Google-Extended
User-Agent: Applebot-Extended
User-Agent: Bytespider
User-Agent: Meta-ExternalAgent
User-Agent: FacebookBot
User-Agent: Amazonbot
User-Agent: cohere-ai
User-Agent: cohere-training-data-crawler
User-Agent: Diffbot
User-Agent: omgili
User-Agent: Timpibot
User-Agent: ImagesiftBot
User-Agent: AI2Bot
User-Agent: PanguBot
User-Agent: Kangaroo Bot
User-Agent: ICC-Crawler
User-Agent: Webzio-Extended
User-Agent: img2dataset
Disallow: /

User-Agent: *
Allow: /

Sitemap: ${RAIZ}/sitemap.xml
`;

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>${RAIZ}/</loc><lastmod>${ACTUALIZADA}</lastmod></url>
</urlset>
`;

const SEGURIDAD = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; " +
    `img-src data: ${VIGIA}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
};

function texto(cuerpo, tipo, extra = {}) {
  return new Response(cuerpo, {
    headers: { "Content-Type": tipo, "Cache-Control": "public, max-age=3600", ...SEGURIDAD, ...extra },
  });
}

export default {
  fetch(request) {
    const url = new URL(request.url);
    if (url.hostname !== "gobserva.cloud") {
      return Response.redirect(`${RAIZ}${url.pathname}${url.search}`, 301);
    }
    switch (url.pathname) {
      case "/":
        return texto(PORTADA, "text/html; charset=utf-8");
      case "/robots.txt":
        return texto(ROBOTS, "text/plain; charset=utf-8");
      case "/sitemap.xml":
        return texto(SITEMAP, "application/xml; charset=utf-8");
      case `/${CLAVE_INDEXNOW}.txt`:
        return texto(CLAVE_INDEXNOW, "text/plain; charset=utf-8");
      case "/favicon.ico":
        return new Response(null, { status: 204 });
      default:
        return Response.redirect(`${VIGIA}${url.pathname}${url.search}`, 302);
    }
  },
};
