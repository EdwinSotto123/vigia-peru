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
// Los archivos de publico/ (favicon, logo.png, og.png, el logo para descargar en /marca/) los sirve Cloudflare tal cual,
// antes de llegar a este código (wrangler.jsonc, "assets"). El logo y la ilustración van en línea desde marca.js; los dos
// los genera marca/generar_marca.py, que también explica cómo está hecho el logo (marca/README.md).
//
// El nombre del Worker (gobserva-redirect) se mantiene: los custom domains están atados a él. Despliegue: README.md.

import { ILUSTRACION, LOGO_INTERIOR, LOGO_VIEWBOX } from "./marca.js";

const RAIZ = "https://gobserva.cloud";
const VIGIA = "https://vigia.gobserva.cloud";
const CLAVE_INDEXNOW = "70c4458a363841ee4aef67be90cc8565";
// La fecha de la última versión de la portada (sitemap y datos estructurados): cambiarla al cambiar el contenido.
const ACTUALIZADA = "2026-11-01";
const ESLOGAN = "Lo de todos, a la vista de todos.";

const ORGANIZACION = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${RAIZ}/#organizacion`,
      name: "Gobserva",
      alternateName: ["Gobserva Cloud", "gobserva.cloud"],
      url: `${RAIZ}/`,
      logo: {
        "@type": "ImageObject",
        "@id": `${RAIZ}/#logo`,
        url: `${RAIZ}/logo.png`,
        contentUrl: `${RAIZ}/logo.png`,
        width: 512,
        height: 512,
        caption: "Gobserva",
      },
      image: { "@id": `${RAIZ}/#logo` },
      slogan: ESLOGAN,
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

// ─── Piezas de la página ────────────────────────────────────────────────────────────────────────────────────────────

const [, , VB_ANCHO, VB_ALTO] = LOGO_VIEWBOX.split(" ").map(Number);
/** El logo en línea (decorativo: quien lo contiene pone el nombre accesible). Toma sus colores del CSS (.logo .gl-*). */
const logo = (clase) =>
  `<svg class="logo ${clase}" viewBox="${LOGO_VIEWBOX}" style="aspect-ratio:${VB_ANCHO} / ${VB_ALTO}" aria-hidden="true" focusable="false">${LOGO_INTERIOR}</svg>`;

// Íconos de trazo, 24 x 24, en currentColor.
const ICONOS = {
  calendario: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  ubicacion: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.5"/>',
  institucion: '<path d="M3 20.5h18M5 17.5h14M6 17.5v-7M10 17.5v-7M14 17.5v-7M18 17.5v-7M3.5 8 12 3.5 20.5 8z"/>',
  actualiza: '<path d="M19.5 11A7.5 7.5 0 0 0 6.2 6.6L4.5 8.5M4.5 4.5v4h4M4.5 13a7.5 7.5 0 0 0 13.3 4.4l1.7-1.9M19.5 19.5v-4h-4"/>',
  lupa: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.3 15.3 5.2 5.2"/>',
  nodos: '<circle cx="6" cy="17.5" r="2.25"/><circle cx="12" cy="6" r="2.25"/><circle cx="18" cy="17.5" r="2.25"/><path d="m7.1 15.5 3.8-7.5M13.1 8l3.8 7.5M8.25 17.5h7.5"/>',
  entiende: '<path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z"/><path d="M14 3.5v5h5M9 14.5l2 2 4-4"/>',
  enlace: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/>',
  bandera: '<path d="M5.5 21V4M5.5 4.5h12l-2.5 4 2.5 4h-12"/>',
  escudo: '<path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.1 7.5 9.5 4.4-1.4 7.5-4.9 7.5-9.5V6z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
  codigo: '<path d="m8 8-4.5 4L8 16M16 8l4.5 4L16 16M13.5 5l-3 14"/>',
  cuentas: '<path d="M6 3.5h12v17l-2.4-1.6-2.4 1.6-2.4-1.6-2.4 1.6L6 20.5z"/><path d="M9 8.5h6M9 12h6M9 15.5h3.5"/>',
  contratos: '<path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z"/><path d="M14 3.5v5h5M8.5 13h7M8.5 16.5h5"/>',
  empresas: '<path d="M4.5 20.5v-15a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v15M14.5 9.5h3a2 2 0 0 1 2 2v9M2.5 20.5h19M8 7.5h3M8 11h3M8 14.5h3"/>',
  mapa: '<path d="m9 4.5-5.5 2v13l5.5-2 6 2 5.5-2v-13l-5.5 2z"/><path d="M9 4.5v13M15 6.5v13"/>',
  partidos: '<rect x="3.5" y="12" width="17" height="8.5" rx="1.5"/><path d="M8 12V4.5h8V12M10.2 8.3l1.3 1.3 2.4-2.4"/>',
  poder: '<rect x="9" y="3.5" width="6" height="4.5" rx="1"/><rect x="3" y="16" width="6" height="4.5" rx="1"/><rect x="15" y="16" width="6" height="4.5" rx="1"/><path d="M12 8v4M6 16v-2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2"/>',
  personas: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.2a6.5 6.5 0 0 1 3 5.8"/>',
  flecha: '<path d="M5 12h14M13 6l6 6-6 6"/>',
};
const icono = (nombre) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONOS[nombre]}</svg>`;
const chip = (nombre) => `<span class="chip">${icono(nombre)}</span>`;

const CIFRAS = [
  ["calendario", "Desde 2015", "los procesos de compra del Estado"],
  ["ubicacion", "25 regiones", "de todo el Perú, hasta el distrito"],
  ["institucion", "10 instituciones", "con sus registros cruzados entre sí"],
  ["actualiza", "Cada día", "entran los contratos nuevos"],
];

const PASOS = [
  [
    "lupa",
    "Observa",
    "Leemos todos los días lo que el Estado publica: contratos y órdenes de compra, presupuesto, empresas, planillas, visitas a las entidades y aportes de campaña.",
  ],
  [
    "nodos",
    "Conecta",
    "Lo cruzamos por RUC, por entidad y por fecha. Así aparece lo que ninguna fuente muestra sola: la empresa recién creada que gana un contrato grande, el proveedor que aportó a la campaña de quien gobierna, la visita días antes de la buena pro.",
  ],
  [
    "entiende",
    "Entiende",
    "Te lo explicamos en palabras simples, con la norma que sustenta cada señal y el enlace al documento original. Tú decides qué mirar dos veces.",
  ],
];

const FUNCIONES = [
  ["contratos", "Contratos", "Cada contrato con sus banderas, sus postores y su historia.", "/app/contratos"],
  ["empresas", "Empresas", "Cuánto ganaron, con qué entidades, sus socios y antecedentes.", "/app/empresas"],
  ["mapa", "Mapa del Perú", "Tu región, provincia o distrito: qué contrató y dónde hay señales.", "/app/mapa"],
  ["partidos", "Partidos y gobiernos", "Qué contrataron los gobiernos de cada partido desde 2015.", "/app/partidos"],
  ["poder", "Mapa de poder", "Qué partido gobierna cada entidad y con quién contrata.", "/app/poder"],
  ["personas", "Personas contratadas", "Locadores, planillas y plazas CAS de cada entidad.", "/app/personas"],
];

const PRINCIPIOS = [
  [
    "institucion",
    "Sólo datos oficiales",
    "Usamos registros que el propio Estado publica, tal como los publica cada institución y con la fecha de cada carga. Nada de rumores ni filtraciones.",
    ["#fuentes", "Ver las diez fuentes"],
  ],
  [
    "enlace",
    "La fuente al lado",
    "Cada cifra y cada bandera enlaza a su documento original y dice qué norma la sustenta. No tienes que creernos: lo compruebas tú.",
  ],
  [
    "bandera",
    "Indicios, no acusaciones",
    "Una bandera es una razón para mirar de nuevo, no una prueba ni una sentencia. Aparecer en Vigía no significa haber hecho algo malo.",
    [`${VIGIA}/glosario`, "Qué significa cada señal"],
  ],
  [
    "escudo",
    "Las personas, protegidas",
    "Nunca publicamos un DNI, y de quien no es autoridad electa tapamos un apellido. Si apareces, puedes pedir que corrijamos o retiremos un dato.",
    [`${VIGIA}/privacidad`, "Cómo cuidamos tus datos"],
  ],
  [
    "codigo",
    "Código abierto",
    "Cualquiera puede revisar cómo se calcula cada bandera y comprobar que la regla es la misma para toda entidad, empresa y partido.",
    ["https://github.com/EdwinSotto123/vigia-peru", "Ver el código"],
  ],
  [
    "cuentas",
    "Cuentas claras",
    "Consultar Vigía es gratis. Publicamos cuánto cuesta mantenerlo, rubro por rubro y con la fuente de cada cifra.",
    [`${VIGIA}/app/cuanto-cuesta`, "Ver cuánto cuesta"],
  ],
];

const FUENTES = [
  ["OECE", "Contratos, órdenes de compra y servicio, postores y proveedores sancionados.", "Organismo Especializado para las Contrataciones Públicas Eficientes (antes OSCE), con el SEACE"],
  ["MEF", "Presupuesto y gasto de cada entidad, y los proyectos de Invierte.pe.", "Ministerio de Economía y Finanzas"],
  ["SUNAT", "Estado y domicilio fiscal de las empresas.", "Superintendencia Nacional de Aduanas y de Administración Tributaria"],
  ["Contraloría", "Informes de control, obras de INFOBRAS y declaraciones juradas de intereses.", "Contraloría General de la República"],
  ["Procuraduría", "Condenas por corrupción con sentencia firme.", "Procuraduría Pública Especializada en Delitos de Corrupción"],
  ["JNE", "Autoridades electas y candidatos.", "Jurado Nacional de Elecciones"],
  ["ONPE", "Aportes y gastos de campaña.", "Oficina Nacional de Procesos Electorales"],
  ["SERVIR", "Plazas CAS que convoca cada entidad.", "Autoridad Nacional del Servicio Civil"],
  ["Congreso", "Registro de visitas al Congreso.", "Congreso de la República"],
  ["PCM", "Visitas a las entidades, planillas del Portal de Transparencia y datos abiertos.", "Presidencia del Consejo de Ministros"],
];

const CSS = `
:root {
  --fondo: #EFF3F2; --tarjeta: #FFFFFF; --borde: #BECAC7; --linea: #D5DEDB;
  --tinta: #111817; --tinta-suave: #374442; --tenue: #586764;
  --acento: #2F6B10; --lima: #D4FF3F; --sobre-lima: #0B0F0F;
  --banda: #163A1E; --banda-tinta: #E7F0EE; --banda-tenue: #B6CBB8; --banda-linea: #2A5032;
  --chip: #D4FF3F; --chip-tinta: #0B0F0F;
  --red: #C9D3D0; --red-nodo: #A6B4B1;
  --logo-tinta: var(--tinta);
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --fondo: #0B0F0F; --tarjeta: #111717; --borde: #2C3939; --linea: #1F2A29;
    --tinta: #E7F0EE; --tinta-suave: #BECDCA; --tenue: #8FA3A0;
    --acento: #D4FF3F;
    --banda: #121A19; --banda-tinta: #E7F0EE; --banda-tenue: #8FA3A0; --banda-linea: #243030;
    --chip: #1B2622; --chip-tinta: #D4FF3F;
    --red: #243131; --red-nodo: #3A4C49;
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; scroll-behavior: smooth; scroll-padding-top: 5.5rem; }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
body {
  margin: 0; background: var(--fondo); color: var(--tinta);
  font: 400 1.0625rem/1.65 Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
a { color: inherit; }
:focus-visible { outline: 3px solid var(--acento); outline-offset: 3px; border-radius: .25rem; }
.sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.saltar { position: absolute; left: 1rem; top: -4rem; z-index: 20; background: var(--lima); color: var(--sobre-lima); padding: .6rem 1rem; border-radius: .5rem; font-weight: 600; }
.saltar:focus { top: 1rem; }
.marco {
  max-width: 72rem; margin-inline: auto;
  padding-left: max(1.25rem, env(safe-area-inset-left, 0px)); padding-right: max(1.25rem, env(safe-area-inset-right, 0px));
}
.titulo, h2, h3 { font-family: "Space Grotesk", Inter, sans-serif; }
.logo { display: block; width: auto; max-width: 100%; }
.logo .gl-letras { fill: var(--logo-tinta); }
.logo .gl-aro { stroke: var(--logo-tinta); }
.logo .gl-vidrio { fill: var(--lima); }
.logo .gl-red { stroke: var(--sobre-lima); }
.logo .gl-nodo { fill: var(--sobre-lima); }
.ico { width: 1.375rem; height: 1.375rem; fill: none; stroke: currentColor; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; flex: none; }
.chip { flex: none; display: inline-grid; place-items: center; width: 2.75rem; height: 2.75rem; border-radius: .875rem; background: var(--chip); color: var(--chip-tinta); }
.ante { font: 600 .8125rem/1.2 Inter, sans-serif; letter-spacing: .14em; text-transform: uppercase; color: var(--acento); margin: 0 0 1rem; }

/* Botones */
.boton {
  display: inline-flex; align-items: center; justify-content: center; gap: .5rem; min-height: 2.875rem; padding: .7rem 1.25rem;
  border-radius: .75rem; font-weight: 600; font-size: 1rem; line-height: 1.2; text-decoration: none; border: 1px solid transparent;
}
.boton .ico { width: 1.125rem; height: 1.125rem; }
.boton.lima { background: var(--lima); color: var(--sobre-lima); }
.boton.lima:hover { filter: brightness(.94); }
.boton.borde { border-color: var(--borde); color: var(--tinta); background: var(--tarjeta); }
.boton.borde:hover { border-color: var(--acento); }
.boton.chico { min-height: 2.5rem; padding: .5rem 1rem; font-size: .9375rem; }
.acciones { display: flex; flex-wrap: wrap; gap: .75rem; margin-top: 2rem; }

/* Cabecera */
.cabecera {
  position: sticky; top: 0; z-index: 10; border-bottom: 1px solid var(--linea);
  background: var(--fondo); background: color-mix(in srgb, var(--fondo) 88%, transparent);
  -webkit-backdrop-filter: saturate(1.4) blur(12px); backdrop-filter: saturate(1.4) blur(12px);
}
.cabecera-fila { display: flex; align-items: center; justify-content: space-between; gap: 1rem; min-height: 4.25rem; }
.marca { display: block; padding-block: .5rem; }
.logo-cabecera { height: 1.875rem; }
.cabecera ul { display: flex; align-items: center; gap: .25rem 1.75rem; list-style: none; margin: 0; padding: 0; }
.cabecera .ancla a { font-weight: 500; font-size: .9375rem; color: var(--tinta-suave); text-decoration: none; }
.cabecera .ancla a:hover { color: var(--tinta); text-decoration: underline; text-underline-offset: .3em; }

/* Portada */
.portada {
  display: grid; grid-template-columns: minmax(0, 1.08fr) minmax(0, .92fr); gap: 2.5rem 3.5rem; align-items: center;
  padding-block: clamp(2.75rem, 6vw, 5rem) clamp(2.5rem, 5vw, 4.5rem);
}
.portada h1 { margin: 0; line-height: 0; }
.logo-portada { height: clamp(3.5rem, 8.2vw, 6.5rem); }
.eslogan { font: 500 clamp(1.75rem, 4.1vw, 3rem)/1.08 "Space Grotesk", Inter, sans-serif; letter-spacing: -.025em; margin: 1.75rem 0 0; }
.junto { white-space: nowrap; }
.entrada { margin: 1.25rem 0 0; max-width: 54ch; color: var(--tinta-suave); font-size: 1.125rem; }
.ilustracion { margin: 0; min-width: 0; }
.ilustracion svg { display: block; width: 100%; height: auto; max-width: 34rem; margin-inline: auto; }
.ilustracion figcaption { text-align: center; color: var(--tenue); font-size: .875rem; margin-top: .75rem; text-wrap: balance; }
.il-red { stroke: var(--red); }
.il-nodo { fill: var(--red-nodo); }
.il-etiqueta { fill: var(--tenue); font: 500 16px Inter, sans-serif; }
.il-vidrio { fill: var(--lima); }
.il-dentro { fill: var(--sobre-lima); }
.il-dentro-red { stroke: var(--sobre-lima); }
.il-texto { fill: var(--sobre-lima); font: 600 17px Inter, sans-serif; }
.il-aro { stroke: var(--tinta); }

/* Cifras */
.cifras-banda { background: var(--tarjeta); border-block: 1px solid var(--linea); }
.cifras { list-style: none; margin: 0 auto; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1.5rem 2rem; padding-block: 1.75rem; }
.cifras li { display: flex; gap: .875rem; align-items: flex-start; min-width: 0; }
.valor { font: 700 1.375rem/1.15 "Space Grotesk", Inter, sans-serif; letter-spacing: -.01em; margin: .125rem 0 0; }
.etq { margin: .25rem 0 0; color: var(--tenue); font-size: .9375rem; line-height: 1.4; }

/* Secciones */
.seccion { padding-block: clamp(3.5rem, 8vw, 6rem) 0; }
.seccion-cabeza { max-width: 48rem; margin-bottom: 2.25rem; }
h2 { font-weight: 700; font-size: clamp(1.75rem, 3.6vw, 2.5rem); line-height: 1.1; letter-spacing: -.025em; margin: 0; text-wrap: balance; }
.intro { margin: 1rem 0 0; color: var(--tinta-suave); font-size: 1.125rem; max-width: 60ch; }
.tarjeta { background: var(--tarjeta); border: 1px solid var(--linea); border-radius: 1.25rem; min-width: 0; }

.pasos { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem; }
.pasos li { padding: 1.5rem 1.5rem 1.75rem; }
.paso-cabeza { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; }
.paso-num { font: 700 .875rem/1 "Space Grotesk", Inter, sans-serif; letter-spacing: .08em; color: var(--tenue); }
.pasos h3 { font-size: 1.625rem; line-height: 1.1; letter-spacing: -.02em; margin: 0 0 .625rem; }
.pasos p { margin: 0; color: var(--tinta-suave); }

.producto { display: grid; grid-template-columns: minmax(0, .9fr) minmax(0, 1.1fr); gap: 2rem 3rem; padding: clamp(1.5rem, 4vw, 2.75rem); border-radius: 1.5rem; }
.producto-cabeza { display: flex; align-items: center; gap: 1rem; }
.producto-cabeza img { width: 4rem; height: 4rem; border-radius: 1rem; display: block; flex: none; }
.producto-cabeza h3 { font-size: 1.75rem; line-height: 1.1; margin: 0; }
.producto-cabeza p { margin: .2rem 0 0; color: var(--tenue); font-size: .9375rem; }
.producto .texto { margin: 1.25rem 0 0; color: var(--tinta-suave); }
.funciones { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .75rem; align-content: start; }
.funciones a {
  display: flex; gap: .875rem; align-items: flex-start; height: 100%; padding: 1rem; border-radius: 1rem;
  border: 1px solid var(--linea); background: var(--fondo); text-decoration: none;
}
.funciones a:hover { border-color: var(--acento); }
.funciones .chip { width: 2.5rem; height: 2.5rem; border-radius: .75rem; }
.funciones strong { display: block; font: 700 1.0625rem/1.25 "Space Grotesk", Inter, sans-serif; }
.funciones .d { display: block; color: var(--tenue); font-size: .9375rem; line-height: 1.45; margin-top: .25rem; }

.principios { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem; }
.principios li { display: flex; flex-direction: column; gap: .875rem; padding: 1.5rem; }
.principios h3 { font-size: 1.25rem; line-height: 1.2; margin: .25rem 0 0; }
.principios p { margin: 0; color: var(--tinta-suave); }
.mas { margin-top: auto; display: inline-flex; align-items: center; gap: .35rem; font-weight: 600; color: var(--acento); text-decoration: none; }
.mas .ico { width: 1rem; height: 1rem; }
.mas:hover { text-decoration: underline; text-underline-offset: .25em; }

.fuentes { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 3rem; border-top: 1px solid var(--linea); }
.fuentes li { display: grid; grid-template-columns: 8rem minmax(0, 1fr); gap: .25rem 1.25rem; padding-block: 1.125rem; border-bottom: 1px solid var(--linea); }
.sigla { font: 700 1.125rem/1.45 "Space Grotesk", Inter, sans-serif; }
.fuentes .que { margin: 0; }
.fuentes .nombre { margin: .25rem 0 0; color: var(--tenue); font-size: .875rem; line-height: 1.45; }
.ver-mas { margin-top: 1.75rem; }

/* Llamado y pie (la misma banda) */
.llamado, .pie { background: var(--banda); color: var(--banda-tinta); --acento: var(--lima); --logo-tinta: var(--banda-tinta); }
.llamado { margin-top: clamp(3.5rem, 8vw, 6rem); }
.llamado .marco { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1.5rem 2.5rem; padding-block: clamp(2.75rem, 6vw, 4.25rem); }
.llamado .intro { color: var(--banda-tenue); margin-top: .75rem; }
.pie .marco { display: grid; grid-template-columns: minmax(0, 1.5fr) repeat(2, minmax(0, 1fr)); gap: 2.5rem 2rem; padding-block: 2.75rem 3rem; border-top: 1px solid var(--banda-linea); }
.logo-pie { height: 2.125rem; }
.pie-eslogan { font: 500 1.25rem/1.25 "Space Grotesk", Inter, sans-serif; margin: 1.125rem 0 0; }
.pie p { margin: .5rem 0 0; color: var(--banda-tenue); font-size: .9375rem; }
.pie h2 { font: 600 .8125rem/1.2 Inter, sans-serif; letter-spacing: .14em; text-transform: uppercase; color: var(--banda-tenue); margin: .25rem 0 1rem; }
.pie ul { list-style: none; margin: 0; padding: 0; display: grid; gap: .625rem; }
.pie a { text-decoration: none; }
.pie a:hover { text-decoration: underline; text-underline-offset: .25em; }

@media (prefers-reduced-motion: no-preference) {
  .boton, .funciones a, .mas { transition: border-color .15s, filter .15s, color .15s; }
}
@media (max-width: 59.99rem) {
  .portada { grid-template-columns: minmax(0, 1fr); }
  .ilustracion svg { max-width: 28rem; }
  .cifras { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .pasos, .producto { grid-template-columns: minmax(0, 1fr); }
  .principios { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 47.99rem) {
  .cabecera .ancla { display: none; }
  .logo-cabecera { height: 1.625rem; }
  .fuentes { grid-template-columns: minmax(0, 1fr); }
  .pie .marco { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .pie .marco > :first-child { grid-column: 1 / -1; }
}
@media (max-width: 39.99rem) {
  .principios, .funciones { grid-template-columns: minmax(0, 1fr); }
  .fuentes li { grid-template-columns: minmax(0, 1fr); }
  .il-etiqueta { font-size: 19px; }
  .il-texto { font-size: 20px; }
}
@media (max-width: 29.99rem) {
  .cifras { grid-template-columns: minmax(0, 1fr); }
}
`;

const PORTADA = `<!doctype html>
<html lang="es-PE">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${TITULO}</title>
<meta name="description" content="${DESCRIPCION}">
<link rel="canonical" href="${RAIZ}/">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="color-scheme" content="light dark">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Gobserva">
<meta property="og:locale" content="es_PE">
<meta property="og:url" content="${RAIZ}/">
<meta property="og:title" content="${TITULO}">
<meta property="og:description" content="${DESCRIPCION}">
<meta property="og:image" content="${RAIZ}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Gobserva: ${ESLOGAN} Una lupa sobre una empresa, un contrato y una entidad conectados.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${TITULO}">
<meta name="twitter:description" content="${DESCRIPCION}">
<meta name="twitter:image" content="${RAIZ}/og.png">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#EFF3F2">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0B0F0F">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@500;700&display=swap">
<script type="application/ld+json">${JSON.stringify(ORGANIZACION)}</script>
<style>${CSS}</style>
</head>
<body>
<a class="saltar" href="#contenido">Saltar al contenido</a>
<header class="cabecera">
  <div class="marco cabecera-fila">
    <a class="marca" href="${RAIZ}/" aria-label="Gobserva, inicio">${logo("logo-cabecera")}</a>
    <nav aria-label="Principal">
      <ul>
        <li class="ancla"><a href="#que-hacemos">Qué hacemos</a></li>
        <li class="ancla"><a href="#principios">Principios</a></li>
        <li class="ancla"><a href="#fuentes">Fuentes</a></li>
        <li><a class="boton lima chico" href="${VIGIA}/">Entrar a Vigía</a></li>
      </ul>
    </nav>
  </div>
</header>
<main id="contenido">
  <section class="marco portada" aria-labelledby="titulo">
    <div>
      <p class="ante">GovTech peruana</p>
      <h1 id="titulo"><span class="sr">Gobserva</span>${logo("logo-portada")}</h1>
      <p class="eslogan">Lo de todos, <span class="junto">a la vista de todos.</span></p>
      <p class="entrada">Gobserva hace tecnología cívica con los datos del Estado peruano: los leemos, los cruzamos entre sí y te mostramos qué revisar, con la fuente oficial al lado para que lo compruebes tú.</p>
      <div class="acciones">
        <a class="boton lima" href="${VIGIA}/">Entrar a Vigía ${icono("flecha")}</a>
        <a class="boton borde" href="#principios">Nuestros principios</a>
      </div>
    </div>
    <figure class="ilustracion">
      <svg viewBox="0 0 560 520" role="img" aria-labelledby="il-titulo"><title id="il-titulo">Una lupa sobre la red de datos públicos: adentro, una empresa, un contrato y una entidad conectados; alrededor, aportes, visitas, socios y sanciones.</title>${ILUSTRACION}</svg>
      <figcaption>Cada contrato, cruzado con aportes de campaña, visitas, socios y sanciones.</figcaption>
    </figure>
  </section>

  <section class="cifras-banda" aria-label="Gobserva en cifras">
    <ul class="marco cifras">
      ${CIFRAS.map(([i, valor, etq]) => `<li>${chip(i)}<div><p class="valor">${valor}</p><p class="etq">${etq}</p></div></li>`).join("\n      ")}
    </ul>
  </section>

  <section class="marco seccion" id="que-hacemos" aria-labelledby="t-que">
    <div class="seccion-cabeza">
      <p class="ante">Qué hacemos</p>
      <h2 id="t-que">Observa. Conecta. Entiende.</h2>
      <p class="intro">Tres pasos, todos los días, con los datos que el Estado ya publica.</p>
    </div>
    <ol class="pasos">
      ${PASOS.map(([i, titulo, texto], k) => `<li class="tarjeta"><div class="paso-cabeza">${chip(i)}<span class="paso-num">0${k + 1}</span></div><h3>${titulo}</h3><p>${texto}</p></li>`).join("\n      ")}
    </ol>
  </section>

  <section class="marco seccion" id="vigia" aria-labelledby="t-vigia">
    <div class="seccion-cabeza">
      <p class="ante">Nuestro primer producto</p>
      <h2 id="t-vigia">Vigía revisa los contratos del Estado y te dice cuáles mirar dos veces</h2>
    </div>
    <article class="tarjeta producto">
      <div>
        <div class="producto-cabeza">
          <img src="${VIGIA}/assets/logo/vigia_peru_512.png" alt="" width="64" height="64" loading="lazy">
          <div><h3>Vigía</h3><p>vigia.gobserva.cloud</p></div>
        </div>
        <p class="texto">Lee los contratos y las órdenes de compra del Estado, los cruza con más de veinte registros oficiales y marca con una bandera los que merecen otra mirada: proveedores sancionados, empresas recién creadas que ganan contratos grandes, aportes a campañas, visitas antes de una buena pro. Cada bandera trae la norma que la sustenta y el enlace a su fuente.</p>
        <div class="acciones">
          <a class="boton lima" href="${VIGIA}/">Explorar Vigía ${icono("flecha")}</a>
          <a class="boton borde" href="${VIGIA}/fuentes">De dónde salen los datos</a>
        </div>
      </div>
      <ul class="funciones" aria-label="Qué puedes ver en Vigía">
        ${FUNCIONES.map(([i, titulo, d, ruta]) => `<li><a href="${VIGIA}${ruta}">${chip(i)}<span><strong>${titulo}</strong><span class="d">${d}</span></span></a></li>`).join("\n        ")}
      </ul>
    </article>
  </section>

  <section class="marco seccion" id="principios" aria-labelledby="t-principios">
    <div class="seccion-cabeza">
      <p class="ante">Principios</p>
      <h2 id="t-principios">Seis reglas que no negociamos</h2>
      <p class="intro">Vigilar el uso del dinero público exige que también se pueda vigilar a quien vigila.</p>
    </div>
    <ul class="principios">
      ${PRINCIPIOS.map(([i, titulo, texto, enlace]) => `<li class="tarjeta">${chip(i)}<h3>${titulo}</h3><p>${texto}</p>${enlace ? `<a class="mas" href="${enlace[0]}">${enlace[1]} ${icono("flecha")}</a>` : ""}</li>`).join("\n      ")}
    </ul>
  </section>

  <section class="marco seccion" id="fuentes" aria-labelledby="t-fuentes">
    <div class="seccion-cabeza">
      <p class="ante">Fuentes</p>
      <h2 id="t-fuentes">De dónde salen los datos</h2>
      <p class="intro">Diez instituciones del Estado peruano y más de veinte registros públicos, cruzados entre sí.</p>
    </div>
    <ul class="fuentes">
      ${FUENTES.map(([sigla, que, nombre]) => `<li><span class="sigla">${sigla}</span><div><p class="que">${que}</p><p class="nombre">${nombre}</p></div></li>`).join("\n      ")}
    </ul>
    <p class="ver-mas"><a class="mas" href="${VIGIA}/fuentes">Cada fuente y su cobertura en Vigía ${icono("flecha")}</a></p>
  </section>
</main>

<section class="llamado" aria-labelledby="t-llamado">
  <div class="marco">
    <div>
      <h2 id="t-llamado">¿En qué se gasta el dinero de tu región?</h2>
      <p class="intro">Elige tu región en el mapa: quién ganó sus contratos, por cuánto y con qué banderas.</p>
    </div>
    <a class="boton lima" href="${VIGIA}/app/mapa">Abrir el mapa del Perú ${icono("flecha")}</a>
  </div>
</section>
<footer class="pie">
  <div class="marco">
    <div>
      <a class="marca" href="${RAIZ}/" aria-label="Gobserva, inicio">${logo("logo-pie")}</a>
      <p class="pie-eslogan">${ESLOGAN}</p>
      <p>Tecnología cívica desde Lima, Perú.</p>
      <p>© 2026 Gobserva</p>
    </div>
    <nav aria-labelledby="pie-vigia">
      <h2 id="pie-vigia">Vigía</h2>
      <ul>
        <li><a href="${VIGIA}/">Entrar a Vigía</a></li>
        <li><a href="${VIGIA}/fuentes">Fuentes de datos</a></li>
        <li><a href="${VIGIA}/glosario">Glosario</a></li>
        <li><a href="${VIGIA}/privacidad">Privacidad</a></li>
        <li><a href="${VIGIA}/app/cuanto-cuesta">Cuánto cuesta Vigía</a></li>
      </ul>
    </nav>
    <nav aria-labelledby="pie-gobserva">
      <h2 id="pie-gobserva">Gobserva</h2>
      <ul>
        <li><a href="#que-hacemos">Qué hacemos</a></li>
        <li><a href="#principios">Principios</a></li>
        <li><a href="https://github.com/EdwinSotto123/vigia-peru">Código abierto</a></li>
        <li><a href="/marca/gobserva-logo.svg" download>Descarga el logo</a></li>
      </ul>
    </nav>
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
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
<url><loc>${RAIZ}/</loc><lastmod>${ACTUALIZADA}</lastmod><image:image><image:loc>${RAIZ}/og.png</image:loc></image:image></url>
</urlset>
`;

const SEGURIDAD = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; " +
    `img-src 'self' ${VIGIA}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
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
      default:
        return Response.redirect(`${VIGIA}${url.pathname}${url.search}`, 302);
    }
  },
};
