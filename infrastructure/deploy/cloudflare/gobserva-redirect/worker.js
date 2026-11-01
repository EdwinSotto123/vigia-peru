// gobserva.cloud: la portada de Gobserva (2026-11-01, pedido del usuario: que «gobserva» y «gobserva cloud» aparezcan en
// los buscadores). Antes la raíz redirigía a Vigía y no había ninguna página que un buscador pudiera mostrar para la marca.
//
//   gobserva.cloud/                    la portada: el mapa del Perú bajo la lupa, con los datos de cada región
//   gobserva.cloud/robots.txt          los buscadores sí; los rastreadores de entrenamiento de IA, no (como Vigía)
//   gobserva.cloud/sitemap.xml         la portada
//   gobserva.cloud/<CLAVE_INDEXNOW>.txt  la clave pública de IndexNow (Bing y compañía se enteran al momento de un cambio)
//   gobserva.cloud/<otra ruta>         302 a la misma ruta en vigia.gobserva.cloud: los enlaces viejos siguen andando.
//                                      Temporal a propósito: un 301 queda guardado en el navegador para siempre (el 01-11 la
//                                      raíz vieja, un 301 a Vigía, seguía redirigiendo en los navegadores que ya la conocían)
//                                      y Gobserva puede tener más páginas.
//   www.gobserva.cloud/<ruta>          301 a gobserva.cloud/<ruta> (un solo dominio para los buscadores)
//
// El mapa (pedido del usuario, 2026-11-01: «una animación donde muevo el mouse sobre un mapa del Perú y se ven cosas como
// corrupción»): el Perú en píxeles (la identidad Píxel de Vigía) y la lupa de Gobserva que lo recorre. Los datos de cada
// región los pide este Worker a la API de Vigía (casos de la Procuraduría Anticorrupción, informes de la Contraloría y
// procesos de compra de la OECE) y los guarda en la caché de Cloudflare: la página los lleva en #datos-regiones y
// publico/portada.js los dibuja. Sin datos, la página sale igual, con el mapa y un enlace a Vigía.
//
// El diseño (tercera versión, el mismo día: «no tiene colores, falta píxeles, letras demasiado grandes»): cada institución
// tiene su color en el mapa, las cifras y la ficha (Procuraduría óxido, Contraloría ámbar, OECE lima); cada producto, el
// suyo (Vigía lima y los que vienen, en Próximamente); los íconos son de píxeles (pixeles.js) y las cifras van en Doto, una
// letra de puntos como el ojo de Vigía. La escala de letras sigue la skill better-typography (títulos de 22 a 44 px).
//
// Los archivos de publico/ (portada.js, mapa-peru.js, favicon, logo.png, og.png y el logo para descargar en /marca/) los
// sirve Cloudflare tal cual, antes de llegar a este código (wrangler.jsonc, "assets"). El logo va en línea desde marca.js
// (marca/generar_marca.py); la malla, desde publico/mapa-peru.js (mapa/generar_mapa.py).
//
// El nombre del Worker (gobserva-redirect) se mantiene: los custom domains están atados a él. Despliegue: README.md.

import { LOGO_INTERIOR, LOGO_VIEWBOX } from "./marca.js";
import { ojoVigia, pixel } from "./pixeles.js";

const RAIZ = "https://gobserva.cloud";
const VIGIA = "https://vigia.gobserva.cloud";
const CLAVE_INDEXNOW = "70c4458a363841ee4aef67be90cc8565";
// La fecha de la última versión de la portada (sitemap y datos estructurados): cambiarla al cambiar el contenido.
const ACTUALIZADA = "2026-11-01";
// Va en la URL de los scripts de publico/: subirla al cambiarlos (Cloudflare los guarda un día en el navegador).
const VERSION_JS = "2026-11-01b";
const ESLOGAN = "Lo de todos, a la vista de todos.";

// Una lista y no un objeto: en un objeto, JavaScript pone las claves "10" a "25" (índices) antes que "01" a "09".
const REGIONES_LISTA = [
  ["01", "Amazonas"], ["02", "Áncash"], ["03", "Apurímac"], ["04", "Arequipa"], ["05", "Ayacucho"], ["06", "Cajamarca"],
  ["07", "Callao"], ["08", "Cusco"], ["09", "Huancavelica"], ["10", "Huánuco"], ["11", "Ica"], ["12", "Junín"],
  ["13", "La Libertad"], ["14", "Lambayeque"], ["15", "Lima"], ["16", "Loreto"], ["17", "Madre de Dios"], ["18", "Moquegua"],
  ["19", "Pasco"], ["20", "Piura"], ["21", "Puno"], ["22", "San Martín"], ["23", "Tacna"], ["24", "Tumbes"], ["25", "Ucayali"],
];
const REGIONES = Object.fromEntries(REGIONES_LISTA);
// La región con que abre la página (y la ficha que sale sin JavaScript).
const INICIAL = "15";

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

// ─── Los datos de cada región (API de Vigía, con caché) ─────────────────────────────────────────────────────────────
// La API sólo atiende a los Workers de Vigía: los reconoce por el encabezado CF-Worker, que Cloudflare pone con la zona del
// que llama (gobserva.cloud está en WORKERS_PROPIOS de backend/api/wrangler.jsonc). Son 26 pedidos (contratos por
// departamento y la corrupción de cada uno), así que se guardan en la caché de Cloudflare y se renuevan cada 6 horas en
// segundo plano: un visitante nunca espera por ellos, salvo el primero de cada centro de datos.
const CACHE_REGIONES = `${RAIZ}/__cache/regiones-v1`;
const RENOVAR_MS = 6 * 3600 * 1000;

async function pedirJson(base, ruta) {
  const r = await fetch(`${base}${ruta}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`${ruta}: HTTP ${r.status}`);
  return r.json();
}

async function bajarRegiones(base) {
  const codigos = REGIONES_LISTA.map(([c]) => c);
  const [geo, ...corrupcion] = await Promise.all([
    pedirJson(base, "/v1/contratos/geo?nivel=departamento"),
    ...codigos.map((c) => pedirJson(base, `/v1/corrupcion/region/${c}?size=1`)),
  ]);
  const compras = new Map((geo.data ?? []).map((g) => [g.ubigeo, g]));
  let corte = null;
  let fuente = null;
  const regiones = codigos.map((c, k) => {
    const g = compras.get(c) ?? {};
    const inf = corrupcion[k]?.informes ?? {};
    const pr = corrupcion[k]?.procuraduria ?? {};
    if (pr.corte && (!corte || pr.corte > corte)) {
      corte = pr.corte;
      fuente = pr.url_fuente ?? fuente;
    }
    const n = (v) => (typeof v === "number" ? v : null);
    return {
      c,
      tramite: n(pr.en_tramite), // Procuraduría: casos en trámite (incluye los en ejecución, así los cuenta la PPEDC)
      firme: n(pr.en_ejecucion), // Procuraduría: en ejecución de sentencia, o sea con sentencia firme
      informes: n(inf.total), // Contraloría: informes con responsabilidad señalada (presunta)
      penal: n(inf.penal),
      desde: inf.desde ?? null,
      hasta: inf.hasta ?? null,
      procesos: n(g.total), // OECE: procesos de compra desde 2015
      monto: n(g.montoPen), // su valor referencial, en soles
    };
  });
  return { guardado: new Date().toISOString(), corte, fuente, regiones };
}

async function guardarRegiones(base, cache, clave) {
  const datos = await bajarRegiones(base);
  await cache.put(clave, new Response(JSON.stringify(datos), {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=604800" },
  }));
  return datos;
}

async function datosRegiones(env, ctx) {
  const base = env?.VIGIA_API_URL;
  if (!base || typeof caches === "undefined") return null;
  const cache = caches.default;
  const clave = new Request(CACHE_REGIONES);
  try {
    const guardado = await cache.match(clave);
    if (guardado) {
      const datos = await guardado.json();
      if (Date.now() - Date.parse(datos.guardado) > RENOVAR_MS) {
        ctx?.waitUntil?.(guardarRegiones(base, cache, clave).catch((e) => console.log(`regiones: ${e.message}`)));
      }
      return datos;
    }
    return await guardarRegiones(base, cache, clave);
  } catch (e) {
    console.log(`regiones: ${e.message}`);
    return null;
  }
}

// ─── Formatos ───────────────────────────────────────────────────────────────────────────────────────────────────────
const NUM = new Intl.NumberFormat("es-PE");
const NUM1 = new Intl.NumberFormat("es-PE", { maximumFractionDigits: 1 });
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const numero = (v) => (v == null ? "Sin dato" : NUM.format(v));
function soles(v) {
  if (v == null) return "Sin dato";
  if (v >= 1e9) return `S/ ${NUM1.format(v / 1e9)} mil millones`;
  if (v >= 1e6) return `S/ ${NUM.format(Math.round(v / 1e6))} millones`;
  return `S/ ${NUM.format(Math.round(v))}`;
}
function fechaLarga(iso) {
  const [a, m, d] = String(iso).split("-").map(Number);
  return a && m && d ? `${d} de ${MESES[m - 1]} de ${a}` : "";
}
const escapar = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const anios = (r) => (r?.desde && r?.hasta ? `informes de ${r.desde.slice(0, 4)} a ${r.hasta.slice(0, 4)}` : "informes publicados");
/** La suma de un campo en las 25 regiones, o null si ninguna lo trae. */
function suma(datos, campo) {
  const v = (datos?.regiones ?? []).map((r) => r[campo]).filter((x) => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) : null;
}

// ─── Piezas de la página ────────────────────────────────────────────────────────────────────────────────────────────

const [, , VB_ANCHO, VB_ALTO] = LOGO_VIEWBOX.split(" ").map(Number);
/** El logo en línea (decorativo: quien lo contiene pone el nombre accesible). Toma sus colores del CSS (.logo .gl-*). */
const logo = (clase) =>
  `<svg class="logo ${clase}" viewBox="${LOGO_VIEWBOX}" style="aspect-ratio:${VB_ANCHO} / ${VB_ALTO}" aria-hidden="true" focusable="false">${LOGO_INTERIOR}</svg>`;

// Lo que colorea el mapa: cada institución con su color (el mismo en el mapa, las cifras, la ficha y las fuentes).
const METRICAS = [
  ["tramite", "Corrupción", "casos en trámite en el país", "Procuraduría Anticorrupción"],
  ["penal", "Control", "informes con presunta responsabilidad penal", "Contraloría"],
  ["procesos", "Compras", "procesos de compra desde 2015", "OECE"],
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
    "Lo cruzamos por RUC, entidad y fecha. Así aparece lo que ninguna fuente muestra sola: la empresa recién creada que gana un contrato grande, el proveedor que aportó a la campaña de quien gobierna, la visita días antes de la buena pro.",
  ],
  [
    "entiende",
    "Entiende",
    "Te lo explicamos en palabras simples, con la norma que sustenta cada señal y el enlace al documento original. Tú decides qué mirar dos veces.",
  ],
];

const FUNCIONES = [
  ["Contratos", "con sus banderas, postores e historia", "/app/contratos"],
  ["Empresas", "cuánto ganaron, sus socios y antecedentes", "/app/empresas"],
  ["Mapa del Perú", "tu región, provincia o distrito", "/app/mapa"],
  ["Partidos y gobiernos", "qué contrató cada uno desde 2015", "/app/partidos"],
  ["Mapa de poder", "quién gobierna cada entidad", "/app/poder"],
  ["Personas contratadas", "locadores, planillas y plazas CAS", "/app/personas"],
];

// Lo que viene (pedido del usuario: «secciones de próximos, por ejemplo Monitoreo del Congreso, Monitoreo histórico de
// políticos»). «Ya leemos» dice qué fuente de cada uno ya carga Vigía hoy (SCRAPERS.md): nada de esto está en línea todavía.
const PROXIMOS = [
  [
    "congreso",
    "congreso",
    "Monitoreo del Congreso",
    "Cómo vota cada congresista, a quién recibe en su despacho y qué leyes impulsa, con el registro oficial de cada sesión.",
    "Ya leemos las visitas al Congreso.",
  ],
  [
    "politicos",
    "politicos",
    "Monitoreo histórico de políticos",
    "La trayectoria de cada político en una línea de tiempo: partidos, cargos, declaraciones juradas, aportes de campaña y sentencias.",
    "Ya leemos el JNE, la ONPE y las declaraciones juradas.",
  ],
  [
    "obras",
    "obras",
    "Monitoreo de obras públicas",
    "Las obras paralizadas o atrasadas de tu distrito: cuánto avanzan, cuánto cuestan y quién las ejecuta.",
    "Ya leemos INFOBRAS e Invierte.pe.",
  ],
  [
    "alertas",
    "alertas",
    "Alertas de tu distrito",
    "Un aviso cuando tu municipalidad firme un contrato con banderas o la Contraloría publique un informe sobre ella.",
    "Ya leemos los contratos y los informes de control.",
  ],
];

const PRINCIPIOS = [
  [
    "institucion",
    "Sólo datos oficiales",
    "Registros que el propio Estado publica, tal como los publica cada institución y con la fecha de cada carga.",
    ["#fuentes", "Ver las diez fuentes"],
  ],
  [
    "enlace",
    "La fuente al lado",
    "Cada cifra y cada bandera enlaza a su documento original y dice qué norma la sustenta. Lo compruebas tú.",
  ],
  [
    "bandera",
    "Indicios, no acusaciones",
    "Una bandera es una razón para mirar de nuevo, no una prueba. Aparecer en Vigía no significa haber hecho algo malo.",
    [`${VIGIA}/glosario`, "Qué significa cada señal"],
  ],
  [
    "escudo",
    "Las personas, protegidas",
    "Nunca publicamos un DNI, y de quien no es autoridad electa tapamos un apellido. Puedes pedir que corrijamos un dato.",
    [`${VIGIA}/privacidad`, "Cómo cuidamos tus datos"],
  ],
  [
    "codigo",
    "Código abierto",
    "Cualquiera puede revisar cómo se calcula cada bandera y que la regla es la misma para toda entidad, empresa y partido.",
    ["https://github.com/EdwinSotto123/vigia-peru", "Ver el código"],
  ],
  [
    "cuentas",
    "Cuentas claras",
    "Consultar Vigía es gratis, y publicamos cuánto cuesta mantenerlo, rubro por rubro y con la fuente de cada cifra.",
    [`${VIGIA}/app/cuanto-cuesta`, "Ver cuánto cuesta"],
  ],
];

// [sigla, qué da, nombre completo, color de la institución en el mapa (si está en él)]
const FUENTES = [
  ["OECE", "Contratos, órdenes de compra y servicio, postores y proveedores sancionados.", "Organismo Especializado para las Contrataciones Públicas Eficientes (antes OSCE), con el SEACE", "procesos"],
  ["Procuraduría", "Casos de corrupción en trámite y con sentencia firme.", "Procuraduría Pública Especializada en Delitos de Corrupción", "tramite"],
  ["Contraloría", "Informes de control, obras de INFOBRAS y declaraciones juradas de intereses.", "Contraloría General de la República", "penal"],
  ["MEF", "Presupuesto y gasto de cada entidad, y los proyectos de Invierte.pe.", "Ministerio de Economía y Finanzas"],
  ["SUNAT", "Estado y domicilio fiscal de las empresas.", "Superintendencia Nacional de Aduanas y de Administración Tributaria"],
  ["JNE", "Autoridades electas y candidatos.", "Jurado Nacional de Elecciones"],
  ["ONPE", "Aportes y gastos de campaña.", "Oficina Nacional de Procesos Electorales"],
  ["SERVIR", "Plazas CAS que convoca cada entidad.", "Autoridad Nacional del Servicio Civil"],
  ["Congreso", "Registro de visitas al Congreso.", "Congreso de la República"],
  ["PCM", "Visitas a las entidades, planillas del Portal de Transparencia y datos abiertos.", "Presidencia del Consejo de Ministros"],
];

/** La ficha de una región: lo que dice cada institución, sin sumar unas con otras (docs/CORRUPCION.md). */
function ficha(datos, codigo) {
  const r = datos?.regiones.find((x) => x.c === codigo);
  const opciones = REGIONES_LISTA.map(([c, n]) => `<option value="${c}"${c === codigo ? " selected" : ""}>${n}</option>`).join("");
  const cabeza = `<div class="ficha-cabeza">
        <label class="sr" for="region">Región</label>
        <select id="region">${opciones}</select>
        <a id="ficha-enlace" class="enlace" href="${VIGIA}/region/${codigo}">Ver ${REGIONES[codigo]} en Vigía</a>
      </div>`;
  if (!r) {
    return `<div class="ficha esq" id="ficha">
      ${cabeza}
      <p class="ficha-vacia">Ahora no pudimos traer las cifras de cada región. Están en Vigía, con su fuente: <a class="enlace" href="${VIGIA}/app/mapa">abre el mapa del Perú en Vigía</a>.</p>
    </div>`;
  }
  const boletin = datos.fuente
    ? `<a class="enlace" href="${escapar(datos.fuente)}">boletín</a> al ${fechaLarga(datos.corte)}`
    : datos.corte ? `al ${fechaLarga(datos.corte)}` : "";
  return `<div class="ficha esq" id="ficha">
      ${cabeza}
      <div class="ficha-grupo m-tramite">
        <p class="ficha-fuente"><i class="pxl"></i>Procuraduría Anticorrupción<span>${boletin}</span></p>
        <p class="ficha-fila"><b data-campo="tramite">${numero(r.tramite)}</b><span>casos de corrupción en trámite</span></p>
        <p class="ficha-fila"><b data-campo="firme">${numero(r.firme)}</b><span>con sentencia firme</span></p>
      </div>
      <div class="ficha-grupo m-penal">
        <p class="ficha-fuente"><i class="pxl"></i>Contraloría<span id="ficha-anios">${anios(r)}</span></p>
        <p class="ficha-fila"><b data-campo="informes">${numero(r.informes)}</b><span>informes de control con responsabilidad señalada</span></p>
        <p class="ficha-fila"><b data-campo="penal">${numero(r.penal)}</b><span>con presunta responsabilidad penal, que no es una condena</span></p>
      </div>
      <div class="ficha-grupo m-procesos">
        <p class="ficha-fuente"><i class="pxl"></i>OECE<span>procesos desde 2015</span></p>
        <p class="ficha-fila"><b data-campo="procesos">${numero(r.procesos)}</b><span>procesos de compra, por <i data-campo="monto">${soles(r.monto)}</i> de valor referencial</span></p>
      </div>
      <p class="ficha-nota">Cada institución cuenta distinto: sus cifras no se suman.</p>
    </div>`;
}

/** Las 25 regiones en una tabla: lo mismo que la lupa, para leerlo de corrido (y sin JavaScript). */
function tabla(datos) {
  if (!datos) return "";
  const filas = datos.regiones
    .map((r) => `<tr><th scope="row"><a class="enlace" href="${VIGIA}/region/${r.c}">${REGIONES[r.c]}</a></th><td class="t-tramite">${numero(r.tramite)}</td><td class="t-tramite">${numero(r.firme)}</td><td class="t-penal">${numero(r.penal)}</td><td class="t-procesos">${numero(r.procesos)}</td></tr>`)
    .join("\n          ");
  return `<details class="tabla-regiones marco">
      <summary>Ver las 25 regiones en una tabla</summary>
      <div class="tabla-caja">
        <table>
          <caption>Procuraduría Anticorrupción${datos.corte ? `, al ${fechaLarga(datos.corte)}` : ""}; informes de control de la Contraloría (presunta responsabilidad, no es una condena); procesos de compra de la OECE desde 2015.</caption>
          <thead><tr><th scope="col">Región</th><th scope="col">Casos de corrupción en trámite</th><th scope="col">Con sentencia firme</th><th scope="col">Informes con presunta responsabilidad penal</th><th scope="col">Procesos de compra</th></tr></thead>
          <tbody>
          ${filas}
          </tbody>
        </table>
      </div>
    </details>`;
}

/** El mapa: qué colorea (con la cifra del país), el lienzo, los rótulos de la lupa y la leyenda. Lo anima portada.js. */
function mapa(datos) {
  const tramites = (datos?.regiones ?? []).map((r) => r.tramite).filter((v) => v != null);
  const metricas = tramites.length
    ? `<fieldset class="metricas">
        <legend class="sr">Qué colorea el mapa</legend>
        ${METRICAS.map(([valor, nombre, pie, fuente], k) => `<label class="metrica esq m-${valor}">
          <input type="radio" name="metrica" value="${valor}"${k === 0 ? " checked" : ""}>
          <span class="metrica-nombre"><i class="pxl"></i>${nombre}</span>
          <b class="metrica-cifra">${numero(suma(datos, valor))}</b>
          <span class="metrica-pie">${pie}<span class="sr">, según ${fuente}</span></span>
        </label>`).join("\n        ")}
      </fieldset>`
    : "";
  const leyenda = tramites.length
    ? `<div class="leyenda">
        <p id="leyenda-titulo">Casos de corrupción en trámite, por región${datos.corte ? ` (Procuraduría Anticorrupción, al ${fechaLarga(datos.corte)})` : ""}</p>
        <div class="leyenda-escala"><span id="leyenda-min">${numero(Math.min(...tramites))}</span><span class="leyenda-tonos" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><span id="leyenda-max">${numero(Math.max(...tramites))}</span></div>
      </div>`
    : "";
  return `<div class="portada-mapa m-tramite">
      ${metricas}
      <div id="mapa" class="mapa" tabindex="0" role="group" aria-roledescription="mapa" aria-label="Mapa del Perú por regiones. Las flechas cambian de región y Enter la abre en Vigía.">
        <canvas aria-hidden="true"></canvas>
        <div class="lupa-rotulos" aria-hidden="true">
          <p class="lupa-region esq"></p>
          <p class="lupa-dato esq"><b></b><span></span></p>
          <p class="lupa-dato esq"><b></b><span></span></p>
        </div>
        <noscript><p class="sin-js">Con JavaScript, aquí pasas la lupa por el mapa. Las cifras de cada región están en la ficha y en la tabla de esta página.</p></noscript>
      </div>
      <div class="mapa-pie">
        ${leyenda}
        <p class="pista"><span class="pista-mouse">Pasa la lupa por una región; con un clic la abres en Vigía.</span><span class="pista-toque">Toca una región para ver sus cifras.</span></p>
      </div>
    </div>`;
}

const CSS = `
:root {
  color-scheme: dark;
  --fondo: #0B0F0F; --superficie: #111717; --superficie-2: #172020; --linea: #1F2A29; --borde: #2C3939;
  --puntos: rgba(231, 240, 238, .07);
  --tinta: #E7F0EE; --tinta-suave: #BECDCA; --tenue: #8FA3A0;
  --lima: #D4FF3F; --sobre-lima: #0B0F0F; --acento: #D4FF3F;
  /* Lo que se mide, por institución: Procuraduría, Contraloría y OECE. */
  --c-tramite: #FF5A4D; --c-penal: #FFB020; --c-procesos: #D4FF3F;
  /* Los productos que vienen. */
  --c-congreso: #B69CFF; --c-politicos: #4FD8F0; --c-obras: #FF9B5A; --c-alertas: #FF8FD0;
  /* Rampas del mapa: más brillo, más casos. */
  --rt1: #5C322E; --rt2: #873B34; --rt3: #B2463C; --rt4: #DA5146; --rt5: #FF5A4D;
  --rp1: #4C3B1D; --rp2: #7A5B1D; --rp3: #A97B1E; --rp4: #D6961F; --rp5: #FFB020;
  --rc1: #3B4D43; --rc2: #58763A; --rc3: #80A532; --rc4: #AAD835; --rc5: #D4FF3F;
  --mapa-sin: #26302E;
  --lupa-aro: #E7F0EE; --lupa-vidrio: rgba(212, 255, 63, .06); --rotulo: rgba(17, 23, 23, .94);
  --banda: #111717; --banda-tinta: #E7F0EE; --banda-tenue: #8FA3A0; --banda-linea: #243030;
  --logo-tinta: var(--tinta);
  --t-display: clamp(1.875rem, 1.35rem + 1.6vw, 2.625rem);
  --t-title: clamp(1.375rem, 1.18rem + .65vw, 1.75rem);
  --t-heading: 1.0625rem;
  --t-body: 1rem;
  --t-small: .875rem;
  --t-caption: .8125rem;
  --e: 4px;
}
@media (prefers-color-scheme: light) {
  :root {
    color-scheme: light;
    --fondo: #EFF3F2; --superficie: #FFFFFF; --superficie-2: #F6F9F8; --linea: #D5DEDB; --borde: #BECAC7;
    --puntos: rgba(17, 24, 23, .09);
    --tinta: #111817; --tinta-suave: #374442; --tenue: #586764;
    --acento: #2F6B10;
    --c-tramite: #C9342A; --c-penal: #8A5600; --c-procesos: #3F6B0E;
    --c-congreso: #6D4FD6; --c-politicos: #066F85; --c-obras: #A84B17; --c-alertas: #B23A7A;
    --rt1: #E6B9B3; --rt2: #D88A80; --rt3: #C65A4E; --rt4: #A9372C; --rt5: #7E1F16;
    --rp1: #DDC48E; --rp2: #CDA34E; --rp3: #B0841B; --rp4: #8C6408; --rp5: #5E4200;
    --rc1: #A4B4AE; --rc2: #7C9B64; --rc3: #557F29; --rc4: #33610F; --rc5: #1A4204;
    --mapa-sin: #CBD5D1;
    --lupa-aro: #111817; --lupa-vidrio: rgba(212, 255, 63, .28); --rotulo: rgba(255, 255, 255, .96);
    --banda: #163A1E; --banda-tinta: #E7F0EE; --banda-tenue: #B6CBB8; --banda-linea: #2A5032;
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; scroll-behavior: smooth; scroll-padding-top: 5rem; scrollbar-color: var(--borde) var(--fondo); -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
body {
  margin: 0; color: var(--tinta); caret-color: var(--acento);
  font: 400 var(--t-body)/1.6 Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  /* La trama de puntos de Vigía. */
  background: var(--fondo) radial-gradient(var(--puntos) 1px, transparent 1.3px) 0 0 / 22px 22px;
}
::selection { background: var(--lima); color: var(--sobre-lima); }
a { color: inherit; text-underline-offset: .22em; text-decoration-thickness: 1px; }
:focus-visible { outline: 2px solid var(--acento); outline-offset: 3px; }
.sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.saltar { position: absolute; left: 1rem; top: -4rem; z-index: 20; background: var(--lima); color: var(--sobre-lima); padding: .6rem 1rem; font-weight: 600; }
.saltar:focus { top: 1rem; }
.marco {
  max-width: 74rem; margin-inline: auto;
  padding-left: max(1.25rem, env(safe-area-inset-left, 0px)); padding-right: max(1.25rem, env(safe-area-inset-right, 0px));
}
h1, h2, h3 { margin: 0; text-wrap: balance; }
h2 { font: 700 var(--t-title)/1.2 "Space Grotesk", Inter, sans-serif; letter-spacing: -0.015em; max-width: 30ch; }
h3 { font: 600 var(--t-heading)/1.3 "Space Grotesk", Inter, sans-serif; }
p { text-wrap: pretty; }
.junto { white-space: nowrap; }
.logo { display: block; width: auto; max-width: 100%; }
.logo .gl-letras { fill: var(--logo-tinta); }
.logo .gl-aro { stroke: var(--logo-tinta); }
.logo .gl-vidrio { fill: var(--lima); }
.logo .gl-red { stroke: var(--sobre-lima); }
.logo .gl-nodo { fill: var(--sobre-lima); }
.px { display: block; width: 1.5rem; height: 1.5rem; fill: currentColor; flex: none; }
.enlace { color: var(--acento); font-weight: 600; text-decoration: underline; }
.enlace:hover { text-decoration-thickness: 2px; }

/* Esquinas de píxel: el borde se corta en escalones de var(--e). El foco va por dentro (el recorte taparía el contorno). */
.esq {
  clip-path: polygon(0 calc(var(--e) * 2), var(--e) calc(var(--e) * 2), var(--e) var(--e), calc(var(--e) * 2) var(--e), calc(var(--e) * 2) 0,
    calc(100% - var(--e) * 2) 0, calc(100% - var(--e) * 2) var(--e), calc(100% - var(--e)) var(--e), calc(100% - var(--e)) calc(var(--e) * 2), 100% calc(var(--e) * 2),
    100% calc(100% - var(--e) * 2), calc(100% - var(--e)) calc(100% - var(--e) * 2), calc(100% - var(--e)) calc(100% - var(--e)), calc(100% - var(--e) * 2) calc(100% - var(--e)), calc(100% - var(--e) * 2) 100%,
    calc(var(--e) * 2) 100%, calc(var(--e) * 2) calc(100% - var(--e)), var(--e) calc(100% - var(--e)), var(--e) calc(100% - var(--e) * 2), 0 calc(100% - var(--e) * 2));
}
.esq:focus-visible { outline: none; box-shadow: inset 0 0 0 3px var(--acento); }
/* Un píxel de color: la marca de cada institución o producto. */
.pxl { display: inline-block; width: .625rem; height: .625rem; background: var(--c, var(--lima)); flex: none; }
.m-tramite { --c: var(--c-tramite); --r1: var(--rt1); --r2: var(--rt2); --r3: var(--rt3); --r4: var(--rt4); --r5: var(--rt5); }
.m-penal { --c: var(--c-penal); --r1: var(--rp1); --r2: var(--rp2); --r3: var(--rp3); --r4: var(--rp4); --r5: var(--rp5); }
.m-procesos { --c: var(--c-procesos); --r1: var(--rc1); --r2: var(--rc2); --r3: var(--rc3); --r4: var(--rc4); --r5: var(--rc5); }
.estado { display: inline-flex; align-items: center; gap: .4rem; font: 400 .75rem/1 Silkscreen, "Space Grotesk", monospace; letter-spacing: .04em; text-transform: uppercase; color: var(--c, var(--lima)); white-space: nowrap; }
.estado::before { content: ""; width: .5rem; height: .5rem; background: currentColor; }

/* Botones */
.boton {
  display: inline-flex; align-items: center; justify-content: center; min-height: 2.75rem; padding: .625rem 1.125rem;
  font: 600 .9375rem/1.2 Inter, sans-serif; text-decoration: none; border: 0;
}
.boton.lima { background: var(--lima); color: var(--sobre-lima); }
.boton.lima:hover { filter: brightness(.93); }
.boton.borde { color: var(--tinta); background: var(--superficie-2); box-shadow: inset 0 0 0 1px var(--borde); }
.boton.borde:hover { box-shadow: inset 0 0 0 1px var(--acento); }
.boton.chico { min-height: 2.375rem; padding: .5rem .875rem; font-size: .875rem; }
.acciones { display: flex; flex-wrap: wrap; gap: .625rem; margin-top: 1.5rem; }

/* Cabecera, con la línea de puntos de Vigía debajo */
.cabecera { position: sticky; top: 0; z-index: 10; background: var(--fondo); background: color-mix(in srgb, var(--fondo) 88%, transparent); -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); }
.cabecera::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: radial-gradient(circle, var(--lima) 1.1px, transparent 1.4px) 0 50% / 9px 3px repeat-x; opacity: .7; }
.cabecera-fila { display: flex; align-items: center; justify-content: space-between; gap: 1rem; min-height: 3.75rem; }
.marca { display: block; padding-block: .5rem; }
.logo-cabecera { height: 1.625rem; }
.cabecera ul { display: flex; align-items: center; gap: .25rem 1.5rem; list-style: none; margin: 0; padding: 0; }
.cabecera .ancla a { font-weight: 500; font-size: var(--t-small); color: var(--tinta-suave); text-decoration: none; }
.cabecera .ancla a:hover { color: var(--tinta); text-decoration: underline; }

/* Portada */
.portada-grilla {
  display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 6fr); grid-template-rows: auto 1fr;
  grid-template-areas: "texto mapa" "ficha mapa"; gap: 1.75rem 3rem; align-items: start;
  padding-block: clamp(1.5rem, 3.5vw, 2.5rem) 1.5rem;
}
.portada-texto { grid-area: texto; }
.portada-mapa { grid-area: mapa; }
.ficha { grid-area: ficha; }
.sello { display: inline-flex; align-items: center; gap: .5rem; margin: 0 0 1.125rem; padding: .375rem .75rem; background: var(--superficie); box-shadow: inset 0 0 0 1px var(--borde); font-size: var(--t-caption); color: var(--tinta-suave); }
.sello b { font: 400 .75rem/1 Silkscreen, monospace; letter-spacing: .03em; color: var(--tinta); }
.cursor { width: .5rem; height: .875rem; background: var(--lima); }
@media (prefers-reduced-motion: no-preference) { .cursor { animation: titila 1.1s steps(1) infinite; } }
@keyframes titila { 50% { opacity: 0; } }
.portada h1 { font: 800 var(--t-display)/1.12 Doto, "Space Grotesk", monospace; letter-spacing: 0; }
.portada h1 em { font-style: normal; color: var(--acento); }
.entrada { margin: 1rem 0 0; max-width: 46ch; color: var(--tinta-suave); }

.metricas { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .5rem; width: 100%; margin: 0; padding: 0; border: 0; }
.metrica { --e: 4px; position: relative; display: grid; gap: .125rem; padding: .625rem .75rem .6875rem; cursor: pointer; background: color-mix(in srgb, var(--c) 8%, var(--superficie)); }
.metrica:hover { background: color-mix(in srgb, var(--c) 13%, var(--superficie)); }
.metrica:has(input:checked) { background: color-mix(in srgb, var(--c) 20%, var(--superficie)); box-shadow: inset 0 0 0 2px var(--c); }
.metrica:has(input:focus-visible) { box-shadow: inset 0 0 0 3px var(--acento); }
.metrica input { position: absolute; opacity: 0; inset: 0; margin: 0; cursor: pointer; }
.metrica-nombre { display: flex; align-items: center; gap: .4rem; font-weight: 600; font-size: var(--t-small); }
.metrica-cifra { font: 800 1.625rem/1.15 Doto, monospace; color: var(--c); font-variant-numeric: tabular-nums; }
.metrica-pie { font-size: .75rem; line-height: 1.35; color: var(--tenue); }

.ficha { --e: 5px; padding: .875rem 1.125rem .25rem; background: var(--superficie); max-width: 31rem; }
.ficha-cabeza { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: .375rem 1rem; padding-bottom: .625rem; font-size: var(--t-small); }
.ficha select {
  font: 700 1.25rem/1.25 "Space Grotesk", Inter, sans-serif; color: var(--tinta); background-color: transparent;
  border: 0; border-bottom: 2px dotted var(--borde); border-radius: 0; padding: 0 1.5rem .05rem 0; max-width: 100%;
  -webkit-appearance: none; appearance: none; cursor: pointer;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12' shape-rendering='crispEdges' fill='%238FA3A0'%3E%3Cpath d='M2 4h8v2H8v2H6v2H6V8H4V6H2z'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right center; background-size: .75rem;
}
.ficha select:hover { border-bottom-color: var(--acento); }
.ficha select option { background: var(--superficie); color: var(--tinta); font: 500 1rem Inter, sans-serif; }
.ficha-grupo { padding-block: .5rem; border-top: 1px dotted var(--borde); }
.ficha-fuente { display: flex; flex-wrap: wrap; gap: .1rem .5rem; align-items: center; margin: 0 0 .25rem; font-weight: 600; font-size: var(--t-caption); }
.ficha-fuente span { font-weight: 400; color: var(--tenue); }
.ficha-fila { display: grid; grid-template-columns: 5.25rem minmax(0, 1fr); gap: .75rem; align-items: baseline; margin: .0625rem 0; font-size: var(--t-small); line-height: 1.4; }
.ficha-fila b { font: 800 1.125rem/1.35 Doto, monospace; color: var(--c); text-align: right; font-variant-numeric: tabular-nums; }
.ficha-fila span { color: var(--tinta-suave); }
.ficha-fila i { font-style: normal; color: var(--tinta); font-weight: 600; white-space: nowrap; }
.ficha-nota, .ficha-vacia { margin: 0; padding-block: .5rem .625rem; border-top: 1px dotted var(--borde); color: var(--tenue); font-size: .75rem; line-height: 1.45; }

.portada-mapa { position: relative; display: grid; justify-items: center; gap: .75rem; min-width: 0; }
.mapa { position: relative; width: 100%; height: clamp(24rem, calc(100svh - 14rem), 44rem); touch-action: manipulation; }
.mapa canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.con-mapa .mapa:not(.tactil) { cursor: none; }
.mapa:focus-visible { outline-offset: 4px; }
.sin-js { position: absolute; inset: auto 1rem 40% 1rem; margin: 0; text-align: center; color: var(--tenue); }
.lupa-rotulos { position: absolute; left: 0; top: 0; display: grid; justify-items: start; gap: .25rem; max-width: 15.5rem; pointer-events: none; transition: opacity .15s; }
.lupa-rotulos p { --e: 3px; margin: 0; background: var(--rotulo); box-shadow: inset 0 0 0 1px var(--linea); }
.lupa-region { padding: .25rem .5rem; font: 700 .9375rem/1.3 "Space Grotesk", Inter, sans-serif; }
.lupa-dato { padding: .3rem .5rem; color: var(--tinta-suave); font-size: .75rem; line-height: 1.3; }
.lupa-dato b { display: block; color: var(--c); font: 800 1.0625rem/1.25 Doto, monospace; font-variant-numeric: tabular-nums; white-space: nowrap; }
.sobre-mar .lupa-rotulos, .lupa-rotulos:not(:has(.lupa-region:not(:empty))) { opacity: 0; }
@media (prefers-reduced-motion: no-preference) {
  .lupa-rotulos.entra > * { animation: aparece .24s steps(4, end) backwards; }
  .lupa-rotulos.entra > :nth-child(2) { animation-delay: .05s; }
  .lupa-rotulos.entra > :nth-child(3) { animation-delay: .1s; }
}
@keyframes aparece { from { opacity: 0; transform: translateX(-6px); } }
.mapa-pie { display: grid; justify-items: center; gap: .375rem; text-align: center; }
.leyenda { display: grid; justify-items: center; gap: .3rem; max-width: 30rem; }
.leyenda p { margin: 0; color: var(--tenue); font-size: .75rem; line-height: 1.4; text-wrap: balance; }
.leyenda-escala { display: flex; align-items: center; gap: .5rem; font: 800 .875rem Doto, monospace; color: var(--tinta-suave); font-variant-numeric: tabular-nums; }
.leyenda-tonos { display: flex; gap: 2px; }
.leyenda-tonos i { width: .75rem; height: .75rem; background: var(--r1); }
.leyenda-tonos i:nth-child(2) { background: var(--r2); }
.leyenda-tonos i:nth-child(3) { background: var(--r3); }
.leyenda-tonos i:nth-child(4) { background: var(--r4); }
.leyenda-tonos i:nth-child(5) { background: var(--r5); }
.pista { margin: 0; color: var(--tenue); font-size: .75rem; }
.pista-toque { display: none; }
@media (hover: none), (pointer: coarse) { .pista-mouse { display: none; } .pista-toque { display: inline; } }

.tabla-regiones { padding-bottom: .5rem; }
.tabla-regiones summary { cursor: pointer; width: fit-content; color: var(--acento); font-weight: 600; font-size: var(--t-small); text-decoration: underline; text-underline-offset: .22em; }
.tabla-caja { overflow-x: auto; margin-top: .875rem; background: var(--superficie); box-shadow: inset 0 0 0 1px var(--linea); }
.tabla-caja table { width: 100%; border-collapse: collapse; font-size: var(--t-small); }
.tabla-caja caption { caption-side: bottom; text-align: left; padding: .625rem 1rem; color: var(--tenue); font-size: .75rem; }
.tabla-caja th, .tabla-caja td { padding: .4rem 1rem; border-bottom: 1px dotted var(--linea); text-align: right; white-space: nowrap; }
.tabla-caja thead th { font-weight: 600; font-size: .75rem; color: var(--tinta-suave); white-space: normal; vertical-align: bottom; }
.tabla-caja th[scope="row"], .tabla-caja thead th:first-child { text-align: left; }
.tabla-caja td { font: 800 .9375rem Doto, monospace; font-variant-numeric: tabular-nums; }
.t-tramite { color: var(--c-tramite); } .t-penal { color: var(--c-penal); } .t-procesos { color: var(--c-procesos); }

/* Una franja de píxeles de todos los colores: separa la portada de lo demás y abre el pie. */
.franja { height: 6px; background: linear-gradient(90deg, var(--c-procesos) 0 6px, transparent 6px 12px, var(--c-penal) 12px 18px, transparent 18px 24px, var(--c-tramite) 24px 30px, transparent 30px 36px, var(--c-congreso) 36px 42px, transparent 42px 48px, var(--c-politicos) 48px 54px, transparent 54px 60px, var(--c-obras) 60px 66px, transparent 66px 72px, var(--c-alertas) 72px 78px, transparent 78px 84px) 0 0 / 84px 6px repeat-x; opacity: .85; }

/* Secciones */
.seccion { padding-block: clamp(3rem, 7vw, 5rem) 0; }
.intro { margin: .75rem 0 0; color: var(--tinta-suave); max-width: 60ch; }

.pasos { position: relative; list-style: none; margin: 2.25rem 0 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1.5rem 2.5rem; }
.pasos::before { content: ""; position: absolute; left: 3rem; right: 3rem; top: 1.5rem; height: 4px; background: linear-gradient(90deg, var(--borde) 0 4px, transparent 4px 10px) 0 0 / 10px 4px repeat-x; }
.pasos li { position: relative; min-width: 0; }
.paso-marca { --e: 4px; display: grid; place-items: center; width: 3rem; height: 3rem; background: color-mix(in srgb, var(--lima) 14%, var(--fondo)); color: var(--acento); }
.paso-marca .px { width: 1.75rem; height: 1.75rem; }
.pasos h3 { margin: 1rem 0 .375rem; font-size: 1.125rem; }
.pasos h3 span { font: 400 .75rem Silkscreen, monospace; color: var(--tenue); margin-right: .5rem; }
.pasos p { margin: 0; color: var(--tinta-suave); font-size: .9375rem; max-width: 40ch; }

.vigia { --e: 6px; --c: var(--acento); display: grid; grid-template-columns: auto minmax(0, 1fr) minmax(0, 1fr); gap: 1.5rem 2.5rem; align-items: start; padding: clamp(1.25rem, 3vw, 2rem); background: color-mix(in srgb, var(--lima) 7%, var(--superficie)); }
.vigia .ojo { width: 7.5rem; display: block; }
.ojo-parpado { fill: var(--acento); }
.ojo-pupila { fill: var(--tinta); }
.vigia-cabeza { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem 1rem; margin-bottom: .5rem; }
.vigia-dominio { color: var(--tenue); font-size: var(--t-caption); }
.vigia .intro { font-size: .9375rem; }
.funciones { list-style: none; margin: 0; padding: 0; display: grid; gap: 0; }
.funciones a { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: .75rem; align-items: baseline; padding: .5625rem 0; border-bottom: 1px dotted var(--borde); text-decoration: none; font-size: .9375rem; }
.funciones a:first-child { padding-top: 0; }
.funciones .pxl { width: .5rem; height: .5rem; transform: translateY(-.1rem); }
.funciones strong { font-weight: 600; }
.funciones span.d { color: var(--tenue); }
.funciones a:hover strong { text-decoration: underline; color: var(--acento); }

.proximos { list-style: none; margin: 2rem 0 0; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .75rem; }
.proximo { --e: 5px; display: flex; flex-direction: column; gap: .625rem; padding: 1.125rem 1.125rem 1rem; background: color-mix(in srgb, var(--c) 9%, var(--superficie)); }
.proximo .px { width: 2.25rem; height: 2.25rem; color: var(--c); }
.proximo h3 { font-size: 1.0625rem; }
.proximo p { margin: 0; color: var(--tinta-suave); font-size: .875rem; line-height: 1.5; }
.proximo .ya { margin-top: auto; padding-top: .5rem; border-top: 1px dotted color-mix(in srgb, var(--c) 45%, transparent); color: var(--tenue); font-size: .75rem; }
.p-congreso { --c: var(--c-congreso); } .p-politicos { --c: var(--c-politicos); } .p-obras { --c: var(--c-obras); } .p-alertas { --c: var(--c-alertas); }

.principios { list-style: none; margin: 2rem 0 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1.75rem 2.5rem; }
.principios li { display: grid; grid-template-columns: auto minmax(0, 1fr); column-gap: .875rem; align-items: start; }
.principios .px { color: var(--acento); width: 1.5rem; height: 1.5rem; margin-top: .05rem; }
.principios h3 { margin-bottom: .25rem; }
.principios p { margin: 0; color: var(--tinta-suave); font-size: .9375rem; }
.principios .enlace { display: inline-block; margin-top: .375rem; font-size: var(--t-small); }

.fuentes { list-style: none; margin: 2rem 0 0; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 3rem; }
.fuentes li { display: grid; grid-template-columns: 7.5rem minmax(0, 1fr); gap: .25rem 1rem; padding-block: .75rem; border-top: 1px dotted var(--borde); font-size: .9375rem; }
.sigla { display: flex; align-items: center; gap: .5rem; font: 700 1rem/1.5 "Space Grotesk", Inter, sans-serif; }
.sigla .pxl { background: var(--borde); }
.fuentes .que { margin: 0; }
.fuentes .nombre { margin: .125rem 0 0; color: var(--tenue); font-size: .8125rem; line-height: 1.45; }
.ver-mas { margin: 1.25rem 0 0; font-size: var(--t-small); }

/* Llamado y pie (la misma banda) */
.llamado, .pie { background: var(--banda); color: var(--banda-tinta); --acento: var(--lima); --logo-tinta: var(--banda-tinta); }
.llamado { margin-top: clamp(3rem, 7vw, 5rem); }
.llamado .marco { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1.25rem 2.5rem; padding-block: clamp(2rem, 5vw, 3rem); }
.llamado .intro { color: var(--banda-tenue); margin-top: .5rem; }
.pie .marco { display: grid; grid-template-columns: minmax(0, 1.5fr) repeat(2, minmax(0, 1fr)); gap: 2rem; padding-block: 2.25rem 2.5rem; border-top: 1px dotted var(--banda-linea); }
.logo-pie { height: 1.875rem; }
.pie .pie-eslogan { font: 800 1.0625rem/1.3 Doto, "Space Grotesk", monospace; margin: .875rem 0 0; color: var(--banda-tinta); }
.pie p { margin: .375rem 0 0; color: var(--banda-tenue); font-size: var(--t-small); }
.pie h2 { font: 400 .75rem/1.2 Silkscreen, monospace; letter-spacing: .04em; text-transform: uppercase; color: var(--banda-tenue); margin: .25rem 0 .875rem; }
.pie ul { list-style: none; margin: 0; padding: 0; display: grid; gap: .5rem; font-size: var(--t-small); }
.pie a { text-decoration: none; }
.pie a:hover { text-decoration: underline; }

@media (prefers-reduced-motion: no-preference) {
  .boton, .funciones a, .metrica { transition: filter .15s, background-color .15s, box-shadow .15s, color .15s; }
}
@media (min-width: 64rem) {
  .mapa-pie { position: absolute; left: 0; bottom: .25rem; justify-items: start; text-align: left; max-width: 14rem; pointer-events: none; }
  .leyenda { justify-items: start; }
}
@media (max-width: 63.99rem) {
  .portada-grilla { grid-template-columns: minmax(0, 1fr); grid-template-rows: none; grid-template-areas: "texto" "mapa" "ficha"; }
  .ficha { max-width: none; }
  .mapa { height: auto; aspect-ratio: 58 / 85; max-width: min(28rem, 100%); }
  .pasos, .vigia { grid-template-columns: minmax(0, 1fr); }
  .pasos::before { display: none; }
  .proximos { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .principios { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 47.99rem) {
  .cabecera .ancla { display: none; }
  .logo-cabecera { height: 1.5rem; }
  .fuentes { grid-template-columns: minmax(0, 1fr); }
  .pie .marco { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .pie .marco > :first-child { grid-column: 1 / -1; }
  .lupa-dato { display: none; }
}
@media (max-width: 39.99rem) {
  .sello-texto { display: none; }
  .proximos, .principios { grid-template-columns: minmax(0, 1fr); }
  .metrica { padding: .5rem .5625rem; }
  .metrica-cifra { font-size: 1.125rem; }
  .metrica-pie { display: none; }
  .fuentes li { grid-template-columns: minmax(0, 1fr); }
}
`;

function portada(datos) {
  // Los datos para portada.js: un bloque JSON que no se ejecuta (la CSP sólo deja correr los scripts propios). Sin «<»
  // crudo, para que nada de la API pueda cerrar el bloque.
  const json = datos
    ? `<script type="application/json" id="datos-regiones">${JSON.stringify({ corte: datos.corte, fuente: datos.fuente, regiones: datos.regiones }).replace(/</g, "\\u003c")}</script>`
    : "";
  return `<!doctype html>
<html lang="es-PE">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${TITULO}</title>
<meta name="description" content="${DESCRIPCION}">
<link rel="canonical" href="${RAIZ}/">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="color-scheme" content="dark light">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Gobserva">
<meta property="og:locale" content="es_PE">
<meta property="og:url" content="${RAIZ}/">
<meta property="og:title" content="${TITULO}">
<meta property="og:description" content="${DESCRIPCION}">
<meta property="og:image" content="${RAIZ}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Gobserva: ${ESLOGAN} El mapa del Perú en puntos, con una lupa sobre Lima.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${TITULO}">
<meta name="twitter:description" content="${DESCRIPCION}">
<meta name="twitter:image" content="${RAIZ}/og.png">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0B0F0F">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#EFF3F2">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Doto:wght@800&family=Inter:wght@400;500;600&family=Silkscreen&family=Space+Grotesk:wght@600;700&display=swap">
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
        <li class="ancla"><a href="#como-funciona">Cómo funciona</a></li>
        <li class="ancla"><a href="#proximamente">Próximamente</a></li>
        <li class="ancla"><a href="#principios">Principios</a></li>
        <li class="ancla"><a href="#fuentes">Fuentes</a></li>
        <li><a class="boton lima chico esq" href="${VIGIA}/">Entrar a Vigía</a></li>
      </ul>
    </nav>
  </div>
</header>
<main id="contenido">
  <section class="portada" aria-labelledby="titulo">
    <div class="marco portada-grilla">
      <div class="portada-texto">
        <p class="sello"><span class="cursor" aria-hidden="true"></span><b>GovTech peruana</b><span class="sello-texto">tecnología cívica con datos del Estado</span></p>
        <h1 id="titulo"><span class="sr">Gobserva: </span>Lo de todos, <span class="junto"><em>a la vista</em> de todos.</span></h1>
        <p class="entrada">Cruzamos lo que el Estado peruano publica y te lo mostramos con su fuente al lado. Pasa la lupa por el mapa: cada región muestra lo que la Procuraduría Anticorrupción, la Contraloría y la OECE ya registraron.</p>
        <div class="acciones">
          <a class="boton lima esq" href="${VIGIA}/">Entrar a Vigía</a>
          <a class="boton borde esq" href="#proximamente">Lo que viene</a>
        </div>
      </div>
      ${mapa(datos)}
      ${ficha(datos, INICIAL)}
    </div>
    ${tabla(datos)}
    <p id="anuncio" class="sr" aria-live="polite"></p>
  </section>

  <div class="franja" aria-hidden="true"></div>

  <section class="marco seccion" id="como-funciona" aria-labelledby="t-como">
    <h2 id="t-como">Observa. Conecta. Entiende.</h2>
    <p class="intro">Tres pasos, todos los días, con lo que el Estado ya publica.</p>
    <ol class="pasos">
      ${PASOS.map(([i, titulo, texto], k) => `<li><span class="paso-marca esq">${pixel(i)}</span><h3><span>0${k + 1}</span>${titulo}</h3><p>${texto}</p></li>`).join("\n      ")}
    </ol>
  </section>

  <section class="marco seccion" id="vigia" aria-labelledby="t-vigia">
    <div class="vigia esq">
      ${ojoVigia()}
      <div>
        <div class="vigia-cabeza"><span class="estado">En vivo</span><span class="vigia-dominio">vigia.gobserva.cloud</span></div>
        <h2 id="t-vigia">Vigía revisa los contratos del Estado y te dice cuáles mirar dos veces</h2>
        <p class="intro">Nuestro primer producto. Lee los contratos y las órdenes de compra, los cruza con más de veinte registros oficiales y marca con una bandera los que merecen otra mirada: proveedores sancionados, empresas recién creadas que ganan contratos grandes, aportes a campañas, visitas antes de una buena pro.</p>
        <div class="acciones">
          <a class="boton lima esq" href="${VIGIA}/">Explorar Vigía</a>
          <a class="boton borde esq" href="${VIGIA}/fuentes">De dónde salen los datos</a>
        </div>
      </div>
      <ul class="funciones" aria-label="Qué puedes ver en Vigía">
        ${FUNCIONES.map(([titulo, d, ruta]) => `<li><a href="${VIGIA}${ruta}"><i class="pxl"></i><span><strong>${titulo}</strong> <span class="d">${d}</span></span></a></li>`).join("\n        ")}
      </ul>
    </div>
  </section>

  <section class="marco seccion" id="proximamente" aria-labelledby="t-proximos">
    <h2 id="t-proximos">Próximamente</h2>
    <p class="intro">Vigía es el primero. Estos monitores vienen después, con los mismos principios: datos oficiales, la fuente al lado y señales, no acusaciones.</p>
    <ul class="proximos">
      ${PROXIMOS.map(([icono, clase, titulo, texto, ya]) => `<li class="proximo esq p-${clase}">${pixel(icono)}<span class="estado">En preparación</span><h3>${titulo}</h3><p>${texto}</p><p class="ya">${ya}</p></li>`).join("\n      ")}
    </ul>
  </section>

  <section class="marco seccion" id="principios" aria-labelledby="t-principios">
    <h2 id="t-principios">Seis reglas que no negociamos</h2>
    <p class="intro">Vigilar el uso del dinero público exige que también se pueda vigilar a quien vigila.</p>
    <ul class="principios">
      ${PRINCIPIOS.map(([i, titulo, texto, enlace]) => `<li>${pixel(i)}<div><h3>${titulo}</h3><p>${texto}</p>${enlace ? `<a class="enlace" href="${enlace[0]}">${enlace[1]}</a>` : ""}</div></li>`).join("\n      ")}
    </ul>
  </section>

  <section class="marco seccion" id="fuentes" aria-labelledby="t-fuentes">
    <h2 id="t-fuentes">De dónde salen los datos</h2>
    <p class="intro">Diez instituciones del Estado peruano y más de veinte registros públicos, cruzados entre sí. Las tres del mapa llevan su color.</p>
    <ul class="fuentes">
      ${FUENTES.map(([sigla, que, nombre, metrica]) => `<li><span class="sigla"><i class="pxl"${metrica ? ` style="background: var(--c-${metrica})"` : ""}></i>${sigla}</span><div><p class="que">${que}</p><p class="nombre">${nombre}</p></div></li>`).join("\n      ")}
    </ul>
    <p class="ver-mas"><a class="enlace" href="${VIGIA}/fuentes">Cada fuente y su cobertura en Vigía</a></p>
  </section>
</main>

<section class="llamado" aria-labelledby="t-llamado">
  <div class="franja" aria-hidden="true"></div>
  <div class="marco">
    <div>
      <h2 id="t-llamado">¿En qué se gasta el dinero de tu región?</h2>
      <p class="intro">En Vigía está cada contrato de tu región: quién lo ganó, por cuánto y con qué banderas.</p>
    </div>
    <a class="boton lima esq" href="${VIGIA}/app/mapa">Abrir el mapa del Perú en Vigía</a>
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
        <li><a href="#como-funciona">Cómo funciona</a></li>
        <li><a href="#proximamente">Próximamente</a></li>
        <li><a href="#principios">Principios</a></li>
        <li><a href="https://github.com/EdwinSotto123/vigia-peru">Código abierto</a></li>
        <li><a href="/marca/gobserva-logo.svg" download>Descarga el logo</a></li>
      </ul>
    </nav>
  </div>
</footer>
${json}
<script src="/mapa-peru.js?v=${VERSION_JS}" defer></script>
<script src="/portada.js?v=${VERSION_JS}" defer></script>
</body>
</html>`;
}

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

// Scripts: los propios (publico/) y el contador de visitas que Cloudflare agrega a la zona (Web Analytics, sin cookies),
// como en Vigía.
const SEGURIDAD = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self' https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com; " +
    "style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; " +
    `img-src 'self' data: ${VIGIA}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
};

function texto(cuerpo, tipo, cache = "public, max-age=3600") {
  return new Response(cuerpo, { headers: { "Content-Type": tipo, "Cache-Control": cache, ...SEGURIDAD } });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.hostname !== "gobserva.cloud") {
      return Response.redirect(`${RAIZ}${url.pathname}${url.search}`, 301);
    }
    switch (url.pathname) {
      case "/":
        // Diez minutos en el navegador: las cifras de las regiones cambian con las cargas de Vigía.
        return texto(portada(await datosRegiones(env, ctx)), "text/html; charset=utf-8", "public, max-age=600");
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
