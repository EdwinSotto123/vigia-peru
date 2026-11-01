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
// corrupción»): una malla de puntos del Perú (la identidad Píxel de Vigía) y la lupa de Gobserva que la recorre. Los datos de
// cada región los pide este Worker a la API de Vigía (casos de la Procuraduría Anticorrupción, informes de la Contraloría y
// procesos de compra de la OECE) y los guarda en la caché de Cloudflare: la página los lleva en #datos-regiones y
// publico/portada.js los dibuja. Sin datos, la página sale igual, con el mapa y un enlace a Vigía.
//
// Los archivos de publico/ (portada.js, mapa-peru.js, favicon, logo.png, og.png y el logo para descargar en /marca/) los
// sirve Cloudflare tal cual, antes de llegar a este código (wrangler.jsonc, "assets"). El logo va en línea desde marca.js
// (marca/generar_marca.py); la malla, desde publico/mapa-peru.js (mapa/generar_mapa.py).
//
// El nombre del Worker (gobserva-redirect) se mantiene: los custom domains están atados a él. Despliegue: README.md.

import { LOGO_INTERIOR, LOGO_VIEWBOX } from "./marca.js";

const RAIZ = "https://gobserva.cloud";
const VIGIA = "https://vigia.gobserva.cloud";
const CLAVE_INDEXNOW = "70c4458a363841ee4aef67be90cc8565";
// La fecha de la última versión de la portada (sitemap y datos estructurados): cambiarla al cambiar el contenido.
const ACTUALIZADA = "2026-11-01";
// Va en la URL de los scripts de publico/: subirla al cambiarlos (Cloudflare los guarda un día en el navegador).
const VERSION_JS = "2026-11-01a";
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

// ─── Piezas de la página ────────────────────────────────────────────────────────────────────────────────────────────

const [, , VB_ANCHO, VB_ALTO] = LOGO_VIEWBOX.split(" ").map(Number);
/** El logo en línea (decorativo: quien lo contiene pone el nombre accesible). Toma sus colores del CSS (.logo .gl-*). */
const logo = (clase) =>
  `<svg class="logo ${clase}" viewBox="${LOGO_VIEWBOX}" style="aspect-ratio:${VB_ANCHO} / ${VB_ALTO}" aria-hidden="true" focusable="false">${LOGO_INTERIOR}</svg>`;

// Íconos de trazo, 24 x 24, en currentColor.
const ICONOS = {
  lupa: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.3 15.3 5.2 5.2"/>',
  nodos: '<circle cx="6" cy="17.5" r="2.25"/><circle cx="12" cy="6" r="2.25"/><circle cx="18" cy="17.5" r="2.25"/><path d="m7.1 15.5 3.8-7.5M13.1 8l3.8 7.5M8.25 17.5h7.5"/>',
  entiende: '<path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z"/><path d="M14 3.5v5h5M9 14.5l2 2 4-4"/>',
  institucion: '<path d="M3 20.5h18M5 17.5h14M6 17.5v-7M10 17.5v-7M14 17.5v-7M18 17.5v-7M3.5 8 12 3.5 20.5 8z"/>',
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
};
const icono = (nombre) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONOS[nombre]}</svg>`;

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
  ["Procuraduría", "Casos de corrupción en trámite y con sentencia firme.", "Procuraduría Pública Especializada en Delitos de Corrupción"],
  ["JNE", "Autoridades electas y candidatos.", "Jurado Nacional de Elecciones"],
  ["ONPE", "Aportes y gastos de campaña.", "Oficina Nacional de Procesos Electorales"],
  ["SERVIR", "Plazas CAS que convoca cada entidad.", "Autoridad Nacional del Servicio Civil"],
  ["Congreso", "Registro de visitas al Congreso.", "Congreso de la República"],
  ["PCM", "Visitas a las entidades, planillas del Portal de Transparencia y datos abiertos.", "Presidencia del Consejo de Ministros"],
];

/** La ficha de una región: lo que dice cada institución, sin sumar unas con otras (docs/CORRUPCION.md). */
function ficha(datos, codigo) {
  const r = datos?.regiones.find((x) => x.c === codigo);
  const opciones = REGIONES_LISTA
    .map(([c, n]) => `<option value="${c}"${c === codigo ? " selected" : ""}>${n}</option>`)
    .join("");
  const cabeza = `<div class="ficha-cabeza">
        <label class="sr" for="region">Región</label>
        <select id="region">${opciones}</select>
        <a id="ficha-enlace" class="enlace" href="${VIGIA}/region/${codigo}">Ver ${REGIONES[codigo]} en Vigía</a>
      </div>`;
  if (!r) {
    return `<div class="ficha" id="ficha">
      ${cabeza}
      <p class="ficha-vacia">Ahora no pudimos traer las cifras de cada región. Están en Vigía, con su fuente: <a class="enlace" href="${VIGIA}/app/mapa">abre el mapa del Perú en Vigía</a>.</p>
    </div>`;
  }
  const boletin = datos.fuente
    ? `<a class="enlace" href="${escapar(datos.fuente)}">boletín de la Procuraduría</a>, al ${fechaLarga(datos.corte)}`
    : datos.corte ? `al ${fechaLarga(datos.corte)}` : "";
  return `<div class="ficha" id="ficha">
      ${cabeza}
      <div class="ficha-grupo">
        <p class="ficha-fuente">Procuraduría Anticorrupción<span>${boletin}</span></p>
        <p class="ficha-fila"><b data-campo="tramite">${numero(r.tramite)}</b><span>casos de corrupción en trámite</span></p>
        <p class="ficha-fila"><b data-campo="firme">${numero(r.firme)}</b><span>con sentencia firme</span></p>
      </div>
      <div class="ficha-grupo">
        <p class="ficha-fuente">Contraloría<span id="ficha-anios">${anios(r)}</span></p>
        <p class="ficha-fila"><b data-campo="informes">${numero(r.informes)}</b><span>informes de control con responsabilidad señalada</span></p>
        <p class="ficha-fila"><b data-campo="penal">${numero(r.penal)}</b><span>con presunta responsabilidad penal, que no es una condena</span></p>
      </div>
      <div class="ficha-grupo">
        <p class="ficha-fuente">OECE<span>procesos de compra desde 2015</span></p>
        <p class="ficha-fila"><b data-campo="procesos">${numero(r.procesos)}</b><span>procesos de compra, por <i data-campo="monto">${soles(r.monto)}</i> de valor referencial</span></p>
      </div>
      <p class="ficha-nota">Cada institución cuenta distinto: sus cifras no se suman.</p>
    </div>`;
}

/** Las 25 regiones en una tabla: lo mismo que la lupa, para leerlo de corrido (y sin JavaScript). */
function tabla(datos) {
  if (!datos) return "";
  const filas = datos.regiones
    .map((r) => `<tr><th scope="row"><a class="enlace" href="${VIGIA}/region/${r.c}">${REGIONES[r.c]}</a></th><td>${numero(r.tramite)}</td><td>${numero(r.firme)}</td><td>${numero(r.penal)}</td><td>${numero(r.procesos)}</td></tr>`)
    .join("\n          ");
  return `<details class="tabla-regiones marco">
      <summary>Las 25 regiones en una tabla</summary>
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

/** El mapa: lienzo, rótulos junto a la lupa, el selector de qué colorea y la leyenda. Lo anima publico/portada.js. */
function mapa(datos) {
  const tramites = (datos?.regiones ?? []).map((r) => r.tramite).filter((v) => v != null);
  const leyenda = tramites.length
    ? `<div class="leyenda">
        <p id="leyenda-titulo">Casos de corrupción en trámite, por región${datos.corte ? ` (Procuraduría Anticorrupción, al ${fechaLarga(datos.corte)})` : ""}</p>
        <div class="leyenda-escala"><span id="leyenda-min">${numero(Math.min(...tramites))}</span><span class="leyenda-tonos" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><span id="leyenda-max">${numero(Math.max(...tramites))}</span></div>
      </div>`
    : "";
  const metricas = tramites.length
    ? `<fieldset class="metricas">
        <legend class="sr">Qué colorea el mapa</legend>
        <label><input type="radio" name="metrica" value="tramite" checked><span>Corrupción</span></label>
        <label><input type="radio" name="metrica" value="penal"><span>Control</span></label>
        <label><input type="radio" name="metrica" value="procesos"><span>Compras</span></label>
      </fieldset>`
    : "";
  return `<div class="portada-mapa">
      ${metricas}
      <div id="mapa" class="mapa" tabindex="0" role="group" aria-roledescription="mapa" aria-label="Mapa del Perú por regiones. Las flechas cambian de región y Enter la abre en Vigía.">
        <canvas aria-hidden="true"></canvas>
        <div class="lupa-rotulos" aria-hidden="true">
          <p class="lupa-region"></p>
          <p class="lupa-dato"><b></b><span></span></p>
          <p class="lupa-dato"><b></b><span></span></p>
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
  --fondo: #0B0F0F; --superficie: #111717; --linea: #1F2A29; --borde: #2C3939;
  --tinta: #E7F0EE; --tinta-suave: #BECDCA; --tenue: #8FA3A0;
  --acento: #D4FF3F; --lima: #D4FF3F; --sobre-lima: #0B0F0F;
  --banda: #111717; --banda-tinta: #E7F0EE; --banda-tenue: #8FA3A0; --banda-linea: #243030;
  --mapa-1: #3B4D43; --mapa-2: #58763A; --mapa-3: #80A532; --mapa-4: #AAD835; --mapa-5: #D4FF3F; --mapa-sin: #26302E;
  --lupa-aro: #E7F0EE; --lupa-vidrio: rgba(212, 255, 63, .07); --rotulo: rgba(11, 15, 15, .88);
  --logo-tinta: var(--tinta);
}
@media (prefers-color-scheme: light) {
  :root {
    color-scheme: light;
    --fondo: #EFF3F2; --superficie: #FFFFFF; --linea: #D5DEDB; --borde: #BECAC7;
    --tinta: #111817; --tinta-suave: #374442; --tenue: #586764;
    --acento: #2F6B10;
    --banda: #163A1E; --banda-tinta: #E7F0EE; --banda-tenue: #B6CBB8; --banda-linea: #2A5032;
    --mapa-1: #A4B4AE; --mapa-2: #7C9B64; --mapa-3: #557F29; --mapa-4: #33610F; --mapa-5: #1A4204; --mapa-sin: #CBD5D1;
    --lupa-aro: #111817; --lupa-vidrio: rgba(212, 255, 63, .30); --rotulo: rgba(255, 255, 255, .94);
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; scroll-behavior: smooth; scroll-padding-top: 5.5rem; scrollbar-color: var(--borde) var(--fondo); }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
body {
  margin: 0; background: var(--fondo); color: var(--tinta); caret-color: var(--acento);
  font: 400 1.0625rem/1.65 Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
::selection { background: var(--lima); color: var(--sobre-lima); }
a { color: inherit; text-underline-offset: .22em; text-decoration-thickness: 1px; }
:focus-visible { outline: 2px solid var(--acento); outline-offset: 3px; border-radius: .25rem; }
.sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.saltar { position: absolute; left: 1rem; top: -4rem; z-index: 20; background: var(--lima); color: var(--sobre-lima); padding: .6rem 1rem; border-radius: .5rem; font-weight: 600; }
.saltar:focus { top: 1rem; }
.marco {
  max-width: 76rem; margin-inline: auto;
  padding-left: max(1.25rem, env(safe-area-inset-left, 0px)); padding-right: max(1.25rem, env(safe-area-inset-right, 0px));
}
h1, h2, h3 { font-family: "Space Grotesk", Inter, sans-serif; text-wrap: balance; }
.junto { white-space: nowrap; }
.logo { display: block; width: auto; max-width: 100%; }
.logo .gl-letras { fill: var(--logo-tinta); }
.logo .gl-aro { stroke: var(--logo-tinta); }
.logo .gl-vidrio { fill: var(--lima); }
.logo .gl-red { stroke: var(--sobre-lima); }
.logo .gl-nodo { fill: var(--sobre-lima); }
.ico { width: 1.375rem; height: 1.375rem; fill: none; stroke: currentColor; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; flex: none; }
.enlace { color: var(--acento); font-weight: 600; text-decoration: underline; }
.enlace:hover { text-decoration-thickness: 2px; }

/* Botones */
.boton {
  display: inline-flex; align-items: center; justify-content: center; min-height: 2.875rem; padding: .7rem 1.25rem;
  border-radius: .75rem; font-weight: 600; font-size: 1rem; line-height: 1.2; text-decoration: none; border: 1px solid transparent;
}
.boton.lima { background: var(--lima); color: var(--sobre-lima); }
.boton.lima:hover { filter: brightness(.93); }
.boton.borde { border-color: var(--borde); color: var(--tinta); background: transparent; }
.boton.borde:hover { border-color: var(--acento); }
.boton.chico { min-height: 2.5rem; padding: .5rem 1rem; font-size: .9375rem; }
.acciones { display: flex; flex-wrap: wrap; gap: .75rem; margin-top: 1.75rem; }

/* Cabecera */
.cabecera {
  position: sticky; top: 0; z-index: 10; border-bottom: 1px solid var(--linea);
  background: var(--fondo); background: color-mix(in srgb, var(--fondo) 86%, transparent);
  -webkit-backdrop-filter: saturate(1.4) blur(12px); backdrop-filter: saturate(1.4) blur(12px);
}
.cabecera-fila { display: flex; align-items: center; justify-content: space-between; gap: 1rem; min-height: 4.25rem; }
.marca { display: block; padding-block: .5rem; }
.logo-cabecera { height: 1.875rem; }
.cabecera ul { display: flex; align-items: center; gap: .25rem 1.75rem; list-style: none; margin: 0; padding: 0; }
.cabecera .ancla a { font-weight: 500; font-size: .9375rem; color: var(--tinta-suave); text-decoration: none; }
.cabecera .ancla a:hover { color: var(--tinta); text-decoration: underline; }

/* Portada: el titular y la ficha sobre el Pacífico, el mapa a su lado; en el teléfono, el mapa antes que la ficha. */
.portada-grilla {
  display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 6fr); grid-template-rows: auto 1fr;
  grid-template-areas: "texto mapa" "ficha mapa"; gap: 2rem 3.5rem; align-items: start;
  padding-block: clamp(1.75rem, 4vw, 3rem) clamp(1.5rem, 3vw, 2.5rem);
}
.portada-texto { grid-area: texto; }
.portada-mapa { grid-area: mapa; }
.ficha { grid-area: ficha; }
.portada h1 { font-weight: 500; font-size: clamp(2.5rem, 4.4vw, 3.875rem); line-height: 1.03; letter-spacing: -0.03em; margin: 0; }
.entrada { margin: 1.125rem 0 0; max-width: 46ch; color: var(--tinta-suave); font-size: 1.0625rem; }

.ficha { padding: 1rem 1.25rem .25rem; border: 1px solid var(--linea); border-radius: 1rem; background: var(--superficie); max-width: 32rem; }
.ficha-cabeza { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: .5rem 1rem; padding-bottom: .75rem; }
.ficha select {
  font: 700 1.5rem/1.2 "Space Grotesk", Inter, sans-serif; letter-spacing: -0.015em; color: var(--tinta); background-color: transparent;
  border: 0; border-bottom: 1px dashed var(--borde); border-radius: 0; padding: 0 1.75rem .1rem 0; max-width: 100%;
  -webkit-appearance: none; appearance: none; cursor: pointer;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238FA3A0' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right center; background-size: 1.1rem;
}
.ficha select:hover { border-bottom-color: var(--acento); }
.ficha select option { background: var(--superficie); color: var(--tinta); font: 500 1rem Inter, sans-serif; }
.ficha-grupo { padding-block: .625rem; border-top: 1px solid var(--linea); }
.ficha-fuente { display: flex; flex-wrap: wrap; gap: .1rem .6rem; align-items: baseline; margin: 0 0 .375rem; font-weight: 600; font-size: .875rem; }
.ficha-fuente span { font-weight: 400; color: var(--tenue); font-size: .8125rem; }
.ficha-fila { display: grid; grid-template-columns: 6.5rem minmax(0, 1fr); gap: .875rem; align-items: baseline; margin: .125rem 0; }
.ficha-fila b { font: 500 1.0625rem/1.4 "JetBrains Mono", ui-monospace, monospace; font-variant-numeric: tabular-nums; text-align: right; }
.ficha-fila span { color: var(--tinta-suave); font-size: .9375rem; line-height: 1.4; }
.ficha-fila i { font-style: normal; color: var(--tinta); font-weight: 600; white-space: nowrap; }
.ficha-nota, .ficha-vacia { margin: 0; padding-block: .5rem .625rem; border-top: 1px solid var(--linea); color: var(--tenue); font-size: .8125rem; line-height: 1.45; }

.portada-mapa { position: relative; display: grid; justify-items: center; gap: .875rem; min-width: 0; }
.metricas { display: inline-flex; flex-wrap: wrap; justify-content: center; gap: .25rem; margin: 0; padding: .25rem; border: 1px solid var(--borde); border-radius: 999px; }
.metricas label { position: relative; display: block; }
.metricas input { position: absolute; inset: 0; opacity: 0; margin: 0; cursor: pointer; }
.metricas span { display: block; padding: .45rem 1rem; border-radius: 999px; font-weight: 600; font-size: .875rem; color: var(--tinta-suave); }
.metricas input:checked + span { background: var(--lima); color: var(--sobre-lima); }
.metricas input:focus-visible + span { outline: 2px solid var(--acento); outline-offset: 2px; }
/* El mapa ocupa todo el alto de la pantalla; el lienzo centra la malla y deja el mar a los lados. */
.mapa { position: relative; width: 100%; height: clamp(26rem, calc(100svh - 12rem), 48rem); outline-offset: 6px; touch-action: manipulation; }
.mapa canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.con-mapa .mapa:not(.tactil) { cursor: none; }
.mapa:focus-visible { border-radius: 1rem; }
.sin-js { position: absolute; inset: auto 1rem 40% 1rem; margin: 0; text-align: center; color: var(--tenue); }
.lupa-rotulos { position: absolute; left: 0; top: 0; display: grid; justify-items: start; gap: .3rem; max-width: 14rem; pointer-events: none; transition: opacity .15s; }
.lupa-rotulos p { margin: 0; background: var(--rotulo); border: 1px solid var(--linea); border-radius: .5rem; box-shadow: 0 6px 18px rgba(0, 0, 0, .18); }
.lupa-region { padding: .25rem .6rem; font: 700 1.0625rem/1.3 "Space Grotesk", Inter, sans-serif; }
.lupa-dato { padding: .35rem .6rem; color: var(--tinta-suave); font-size: .8125rem; line-height: 1.3; }
.lupa-dato b { display: block; color: var(--tinta); font: 500 1rem/1.3 "JetBrains Mono", ui-monospace, monospace; font-variant-numeric: tabular-nums; }
.sobre-mar .lupa-rotulos, .lupa-rotulos:not(:has(.lupa-region:not(:empty))) { opacity: 0; }
@media (prefers-reduced-motion: no-preference) {
  .lupa-rotulos.entra > * { animation: aparece .26s cubic-bezier(.16, 1, .3, 1) backwards; }
  .lupa-rotulos.entra > :nth-child(2) { animation-delay: .05s; }
  .lupa-rotulos.entra > :nth-child(3) { animation-delay: .1s; }
}
@keyframes aparece { from { opacity: 0; transform: translateX(-6px); } }
.mapa-pie { display: grid; justify-items: center; gap: .5rem; text-align: center; }
.leyenda { display: grid; justify-items: center; gap: .375rem; max-width: 30rem; }
.leyenda p { margin: 0; color: var(--tenue); font-size: .8125rem; line-height: 1.4; text-wrap: balance; }
.leyenda-escala { display: flex; align-items: center; gap: .625rem; font: 500 .8125rem "JetBrains Mono", ui-monospace, monospace; color: var(--tinta-suave); font-variant-numeric: tabular-nums; }
.leyenda-tonos { display: flex; gap: 3px; }
.leyenda-tonos i { width: 1.375rem; height: .625rem; border-radius: 2px; background: var(--mapa-1); }
.leyenda-tonos i:nth-child(2) { background: var(--mapa-2); }
.leyenda-tonos i:nth-child(3) { background: var(--mapa-3); }
.leyenda-tonos i:nth-child(4) { background: var(--mapa-4); }
.leyenda-tonos i:nth-child(5) { background: var(--mapa-5); }
.pista { margin: 0; color: var(--tenue); font-size: .8125rem; }
.pista-toque { display: none; }
@media (hover: none), (pointer: coarse) { .pista-mouse { display: none; } .pista-toque { display: inline; } }

.tabla-regiones { padding-bottom: 1rem; }
.tabla-regiones summary { cursor: pointer; width: fit-content; color: var(--acento); font-weight: 600; text-decoration: underline; text-underline-offset: .22em; }
.tabla-caja { overflow-x: auto; margin-top: 1rem; border: 1px solid var(--linea); border-radius: .75rem; }
.tabla-caja table { width: 100%; border-collapse: collapse; font-size: .9375rem; }
.tabla-caja caption { caption-side: bottom; text-align: left; padding: .75rem 1rem; color: var(--tenue); font-size: .8125rem; }
.tabla-caja th, .tabla-caja td { padding: .5rem 1rem; border-bottom: 1px solid var(--linea); text-align: right; white-space: nowrap; }
.tabla-caja thead th { font-weight: 600; font-size: .8125rem; color: var(--tinta-suave); white-space: normal; vertical-align: bottom; }
.tabla-caja th[scope="row"], .tabla-caja thead th:first-child { text-align: left; }
.tabla-caja td { font-family: "JetBrains Mono", ui-monospace, monospace; font-variant-numeric: tabular-nums; }

/* Secciones */
.seccion { padding-block: clamp(4rem, 9vw, 7rem) 0; }
h2 { font-weight: 700; font-size: clamp(1.875rem, 3.8vw, 2.75rem); line-height: 1.08; letter-spacing: -0.025em; margin: 0; max-width: 24ch; }
.intro { margin: 1rem 0 0; color: var(--tinta-suave); font-size: 1.125rem; max-width: 58ch; }

.pasos { position: relative; list-style: none; margin: 3rem 0 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 2rem 3rem; }
.pasos::before {
  content: ""; position: absolute; left: 1.75rem; right: 1.75rem; top: 1.75rem; height: 2px;
  background: radial-gradient(circle, var(--borde) 1px, transparent 1.5px) 0 50% / 10px 2px repeat-x;
}
.pasos li { position: relative; min-width: 0; }
.paso-marca { display: grid; place-items: center; width: 3.5rem; height: 3.5rem; border-radius: 50%; background: var(--fondo); border: 2px solid var(--acento); color: var(--acento); }
.pasos h3 { font-size: 1.75rem; line-height: 1.1; letter-spacing: -0.02em; margin: 1.5rem 0 .625rem; }
.pasos p { margin: 0; color: var(--tinta-suave); max-width: 38ch; }

.vigia-grilla { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 2.5rem 4rem; align-items: start; }
.vigia-firma { display: flex; align-items: center; gap: .875rem; margin-top: 1.75rem; color: var(--tenue); font-size: .9375rem; }
.vigia-firma img { width: 3rem; height: 3rem; border-radius: .75rem; display: block; }
.funciones { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--linea); }
.funciones a { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 1rem; align-items: start; padding: 1rem .25rem; border-bottom: 1px solid var(--linea); text-decoration: none; }
.funciones .ico { color: var(--acento); margin-top: .1rem; }
.funciones strong { display: block; font: 700 1.125rem/1.3 "Space Grotesk", Inter, sans-serif; }
.funciones .d { display: block; color: var(--tenue); font-size: .9375rem; line-height: 1.45; margin-top: .125rem; }
.funciones a:hover strong { text-decoration: underline; }

.principios { list-style: none; margin: 2.75rem 0 0; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 4rem; }
.principios li { display: grid; grid-template-columns: auto minmax(0, 1fr); column-gap: 1rem; padding-block: 1.5rem; border-top: 1px solid var(--linea); }
.principios .ico { color: var(--acento); margin-top: .2rem; }
.principios h3 { font-size: 1.3125rem; line-height: 1.25; margin: 0 0 .375rem; }
.principios p { margin: 0; color: var(--tinta-suave); }
.principios .enlace { display: inline-block; margin-top: .625rem; }

.fuentes { list-style: none; margin: 2.5rem 0 0; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 4rem; border-top: 1px solid var(--linea); }
.fuentes li { display: grid; grid-template-columns: 8rem minmax(0, 1fr); gap: .25rem 1.25rem; padding-block: 1.125rem; border-bottom: 1px solid var(--linea); }
.sigla { font: 700 1.125rem/1.45 "Space Grotesk", Inter, sans-serif; }
.fuentes .que { margin: 0; }
.fuentes .nombre { margin: .25rem 0 0; color: var(--tenue); font-size: .875rem; line-height: 1.45; }
.ver-mas { margin: 1.75rem 0 0; }

/* Llamado y pie (la misma banda) */
.llamado, .pie { background: var(--banda); color: var(--banda-tinta); --acento: var(--lima); --logo-tinta: var(--banda-tinta); }
.llamado { margin-top: clamp(4rem, 9vw, 7rem); }
.llamado .marco { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1.5rem 2.5rem; padding-block: clamp(2.75rem, 6vw, 4.25rem); }
.llamado .intro { color: var(--banda-tenue); margin-top: .75rem; }
.pie .marco { display: grid; grid-template-columns: minmax(0, 1.5fr) repeat(2, minmax(0, 1fr)); gap: 2.5rem 2rem; padding-block: 2.75rem 3rem; border-top: 1px solid var(--banda-linea); }
.logo-pie { height: 2.125rem; }
.pie .pie-eslogan { font: 500 1.25rem/1.25 "Space Grotesk", Inter, sans-serif; margin: 1.125rem 0 0; color: var(--banda-tinta); }
.pie p { margin: .5rem 0 0; color: var(--banda-tenue); font-size: .9375rem; }
.pie h2 { font: 600 .9375rem/1.2 Inter, sans-serif; letter-spacing: 0; color: var(--banda-tenue); margin: .25rem 0 1rem; }
.pie ul { list-style: none; margin: 0; padding: 0; display: grid; gap: .625rem; }
.pie a { text-decoration: none; }
.pie a:hover { text-decoration: underline; }

@media (prefers-reduced-motion: no-preference) {
  .boton, .funciones a, .metricas span { transition: border-color .15s, filter .15s, color .15s, background-color .15s; }
}
@media (min-width: 64rem) {
  .mapa-pie { position: absolute; left: 0; bottom: .25rem; justify-items: start; text-align: left; max-width: 15rem; pointer-events: none; }
  .leyenda { justify-items: start; }
}
@media (max-width: 63.99rem) {
  .portada-grilla { grid-template-columns: minmax(0, 1fr); grid-template-rows: none; grid-template-areas: "texto" "mapa" "ficha"; }
  .ficha { max-width: none; }
  .mapa { height: auto; aspect-ratio: 58 / 85; max-width: min(30rem, 100%); }
  .pasos, .vigia-grilla { grid-template-columns: minmax(0, 1fr); }
  .pasos::before { display: none; }
}
@media (max-width: 47.99rem) {
  .cabecera .ancla { display: none; }
  .logo-cabecera { height: 1.625rem; }
  .principios, .fuentes { grid-template-columns: minmax(0, 1fr); }
  .pie .marco { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .pie .marco > :first-child { grid-column: 1 / -1; }
  .lupa-dato { display: none; }
}
@media (max-width: 29.99rem) {
  .fuentes li { grid-template-columns: minmax(0, 1fr); }
  .ficha-fila { grid-template-columns: 5.25rem minmax(0, 1fr); gap: .625rem; }
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
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500&family=Space+Grotesk:wght@500;700&display=swap">
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
        <li class="ancla"><a href="#principios">Principios</a></li>
        <li class="ancla"><a href="#fuentes">Fuentes</a></li>
        <li><a class="boton lima chico" href="${VIGIA}/">Entrar a Vigía</a></li>
      </ul>
    </nav>
  </div>
</header>
<main id="contenido">
  <section class="portada" aria-labelledby="titulo">
    <div class="marco portada-grilla">
      <div class="portada-texto">
        <h1 id="titulo"><span class="sr">Gobserva: </span>Lo de todos, <span class="junto">a la vista de todos.</span></h1>
        <p class="entrada">Gobserva hace tecnología cívica con los datos del Estado peruano. Pasa la lupa por el mapa: cada región muestra lo que la Procuraduría Anticorrupción, la Contraloría y la OECE ya registraron.</p>
        <div class="acciones">
          <a class="boton lima" href="${VIGIA}/">Entrar a Vigía</a>
          <a class="boton borde" href="#como-funciona">Cómo funciona</a>
        </div>
      </div>
      ${mapa(datos)}
      ${ficha(datos, INICIAL)}
    </div>
    ${tabla(datos)}
    <p id="anuncio" class="sr" aria-live="polite"></p>
  </section>

  <section class="marco seccion" id="como-funciona" aria-labelledby="t-como">
    <h2 id="t-como">Observa. Conecta. Entiende.</h2>
    <p class="intro">Tres pasos, todos los días, con lo que el Estado ya publica.</p>
    <ol class="pasos">
      ${PASOS.map(([i, titulo, texto]) => `<li><span class="paso-marca">${icono(i)}</span><h3>${titulo}</h3><p>${texto}</p></li>`).join("\n      ")}
    </ol>
  </section>

  <section class="marco seccion" id="vigia" aria-labelledby="t-vigia">
    <div class="vigia-grilla">
      <div>
        <h2 id="t-vigia">Vigía revisa los contratos del Estado y te dice cuáles mirar dos veces</h2>
        <p class="intro">Es nuestro primer producto. Lee los contratos y las órdenes de compra, los cruza con más de veinte registros oficiales y marca con una bandera los que merecen otra mirada: proveedores sancionados, empresas recién creadas que ganan contratos grandes, aportes a campañas, visitas antes de una buena pro. Cada bandera trae la norma que la sustenta y el enlace a su fuente.</p>
        <div class="acciones">
          <a class="boton lima" href="${VIGIA}/">Explorar Vigía</a>
          <a class="boton borde" href="${VIGIA}/fuentes">De dónde salen los datos</a>
        </div>
        <p class="vigia-firma"><img src="${VIGIA}/assets/logo/vigia_peru_512.png" alt="" width="48" height="48" loading="lazy">Vigía by Gobserva, en vigia.gobserva.cloud</p>
      </div>
      <ul class="funciones" aria-label="Qué puedes ver en Vigía">
        ${FUNCIONES.map(([i, titulo, d, ruta]) => `<li><a href="${VIGIA}${ruta}">${icono(i)}<span><strong>${titulo}</strong><span class="d">${d}</span></span></a></li>`).join("\n        ")}
      </ul>
    </div>
  </section>

  <section class="marco seccion" id="principios" aria-labelledby="t-principios">
    <h2 id="t-principios">Seis reglas que no negociamos</h2>
    <p class="intro">Vigilar el uso del dinero público exige que también se pueda vigilar a quien vigila.</p>
    <ul class="principios">
      ${PRINCIPIOS.map(([i, titulo, texto, enlace]) => `<li>${icono(i)}<div><h3>${titulo}</h3><p>${texto}</p>${enlace ? `<a class="enlace" href="${enlace[0]}">${enlace[1]}</a>` : ""}</div></li>`).join("\n      ")}
    </ul>
  </section>

  <section class="marco seccion" id="fuentes" aria-labelledby="t-fuentes">
    <h2 id="t-fuentes">De dónde salen los datos</h2>
    <p class="intro">Diez instituciones del Estado peruano y más de veinte registros públicos, cruzados entre sí.</p>
    <ul class="fuentes">
      ${FUENTES.map(([sigla, que, nombre]) => `<li><span class="sigla">${sigla}</span><div><p class="que">${que}</p><p class="nombre">${nombre}</p></div></li>`).join("\n      ")}
    </ul>
    <p class="ver-mas"><a class="enlace" href="${VIGIA}/fuentes">Cada fuente y su cobertura en Vigía</a></p>
  </section>
</main>

<section class="llamado" aria-labelledby="t-llamado">
  <div class="marco">
    <div>
      <h2 id="t-llamado">¿En qué se gasta el dinero de tu región?</h2>
      <p class="intro">En Vigía está cada contrato de tu región: quién lo ganó, por cuánto y con qué banderas.</p>
    </div>
    <a class="boton lima" href="${VIGIA}/app/mapa">Abrir el mapa del Perú en Vigía</a>
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
