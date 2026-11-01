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
const VERSION_JS = "2026-11-01c";
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
// que llama (gobserva.cloud está en WORKERS_PROPIOS de backend/api/wrangler.jsonc). Son unos 40 pedidos (contratos por
// departamento, la corrupción de cada uno, lo leído este año y los procesos de cada año desde 2016; el plan gratis de
// Workers admite 50), así que se guardan en la caché de Cloudflare y se renuevan cada 6 horas en segundo plano: un
// visitante nunca espera por ellos, salvo el primero de cada centro de datos.
const CACHE_REGIONES = `${RAIZ}/__cache/regiones-v2`;
const RENOVAR_MS = 6 * 3600 * 1000;
/** El año en Lima (UTC-5): el de las cifras «de este año», como en Vigía (frontend/lib/contratos.ts, anioLectura). */
const anioLima = () => new Date(Date.now() - 5 * 3600 * 1000).getUTCFullYear();

async function pedirJson(base, ruta) {
  const r = await fetch(`${base}${ruta}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`${ruta}: HTTP ${r.status}`);
  return r.json();
}

async function bajarRegiones(base) {
  const codigos = REGIONES_LISTA.map(([c]) => c);
  const anio = anioLima();
  // La serie de procesos por año empieza en 2016: el 2015 de la base trae el relleno histórico del OECE (125 mil, el
  // doble que cualquier otro año) y no se compara con los demás.
  const anios = Array.from({ length: anio - 2015 }, (_, k) => 2016 + k);
  const opcional = (ruta) => pedirJson(base, ruta).catch(() => null);
  const [geo, resumen, ...resto] = await Promise.all([
    pedirJson(base, "/v1/contratos/geo?nivel=departamento"),
    opcional(`/v1/contratos/resumen?desde=${anio}-01-01`),
    ...codigos.map((c) => pedirJson(base, `/v1/corrupcion/region/${c}?size=1`)),
    ...anios.map((a) => opcional(`/v1/contratos/resumen?desde=${a}-01-01&hasta=${a}-12-31`)),
  ]);
  const corrupcion = resto.slice(0, codigos.length);
  const porAnio = resto.slice(codigos.length);
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
  // Lo que Vigía leyó este año: «leído» es tener puntaje, la misma cuenta de su portada (frontend/lib/landing.ts).
  const r = resumen?.porRiesgo;
  const lectura = r && resumen.total
    ? { anio, publicados: resumen.total, leidos: (r.alto ?? 0) + (r.medio ?? 0) + (r.bajo ?? 0) + (r.en_revision ?? 0) + (r.descartado ?? 0), alto: r.alto ?? 0 }
    : null;
  const serie = anios.map((a, k) => ({ anio: a, total: typeof porAnio[k]?.total === "number" ? porAnio[k].total : null }));
  return { guardado: new Date().toISOString(), corte, fuente, regiones, lectura, serie };
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
    // Sin nada guardado (el primer visitante de cada centro de datos): se espera hasta 4 s y, si tarda más, la página
    // sale sin cifras mientras la carga sigue y queda guardada para los siguientes.
    const trabajo = guardarRegiones(base, cache, clave);
    ctx?.waitUntil?.(trabajo.catch((e) => console.log(`regiones: ${e.message}`)));
    return await Promise.race([trabajo.catch(() => null), new Promise((listo) => setTimeout(() => listo(null), 4000))]);
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

// La estimación de la Contraloría, la misma de Vigía (frontend/lib/costoCorrupcion.ts): es una ESTIMACIÓN, no un conteo,
// y así se dice. Cuando publique la del año siguiente, se cambia en los dos lugares.
const CONTRALORIA = {
  anio: 2023,
  millones: 24268,
  porCien: 12.7,
  inversionMillones: 8963,
  url: "https://www.gob.pe/institucion/contraloria/noticias/912182-corrupcion-e-inconducta-funcional-habrian-ocasionado-perdidas-por-s-24-268-millones-en-el-2023",
};

// Lo que sale del cruce: señales que Vigía ya marca (SCRAPERS.md y las migraciones de cruces).
const SENALES = [
  "Empresa recién creada que gana un contrato grande",
  "Proveedor que aportó a la campaña de quien gobierna",
  "Visita a la entidad días antes de la buena pro",
  "Proveedor sancionado por el Tribunal de Contrataciones",
];

// Para quién: [ícono, color, quién, qué gana, qué hace con Vigía].
const PUBLICOS = [
  [
    "ciudadania",
    "lima",
    "Ciudadanía",
    "Entiende en qué se gasta el dinero de tu distrito, sin saber de contrataciones.",
    ["Busca tu región, tu municipalidad o una empresa", "Mira quién ganó cada contrato y con qué banderas", "Comparte la evidencia oficial"],
  ],
  [
    "entiende",
    "cian",
    "Periodismo",
    "Encuentra el hilo y la evidencia para publicarlo sin que te desmientan.",
    ["Cruces ya hechos entre contratos, empresas, aportes y visitas", "La norma citada y el documento original al lado", "La evidencia lista para descargar en PDF"],
  ],
  [
    "escudo",
    "violeta",
    "Control y fiscalización",
    "Señales trazables para actuar rápido: qué fuente, qué documento y qué norma.",
    ["Cada señal con su traza y su fuente", "Prioridad por riesgo, región y entidad", "La misma regla para todos, con código abierto"],
  ],
];

// Lo que colorea el mapa: cada institución con su color (el mismo en el mapa, las cifras, la ficha y las fuentes).
const METRICAS = [
  ["tramite", "Corrupción", "casos en trámite en el país", "Procuraduría Anticorrupción"],
  ["penal", "Control", "informes con presunta responsabilidad penal", "Contraloría"],
  ["procesos", "Compras", "procesos de compra desde 2015", "OECE"],
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
  return `<details class="tabla-regiones marco" id="tabla-regiones">
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
    ? `<fieldset class="metricas" data-anima>
        <legend class="sr">Qué colorea el mapa</legend>
        ${METRICAS.map(([valor, nombre, pie, fuente], k) => `<label class="metrica esq m-${valor}">
          <input type="radio" name="metrica" value="${valor}"${k === 0 ? " checked" : ""}>
          <span class="metrica-nombre"><i class="pxl"></i>${nombre}</span>
          <b class="metrica-cifra"${suma(datos, valor) != null ? ` data-contar="${suma(datos, valor)}"` : ""}>${numero(suma(datos, valor))}</b>
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

// ─── La presentación: cinco capítulos, del problema a quién lo usa (pedido del usuario: «es la presentación: gráficas,
// datos, propuestas, valor»). Cada gráfica se anima al entrar en pantalla (publico/animaciones.js) y, sin JavaScript o
// con movimiento reducido, se ve quieta y completa.

/** 01: lo que se pierde, según la Contraloría. Cien cuadros, uno por cada sol de cien. */
function capProblema() {
  const marcados = Math.round(CONTRALORIA.porCien);
  const cuadros = Array.from({ length: 100 }, (_, k) => (k < marcados ? `<i class="on" style="--i:${k}"></i>` : "<i></i>")).join("");
  return `<section class="marco seccion" id="problema" aria-labelledby="t-problema">
    <h2 id="t-problema"><span class="cap">01</span>Casi 13 de cada 100 soles se pierden</h2>
    <p class="intro">La Contraloría estima que en ${CONTRALORIA.anio} la corrupción y la inconducta funcional se llevaron el ${NUM1.format(CONTRALORIA.porCien)} % del presupuesto que ejecutó el Estado.</p>
    <div class="problema" data-anima>
      <figure class="waffle-fig">
        <div class="waffle" role="img" aria-label="Cien cuadros, trece en rojo: casi 13 de cada 100 soles">${cuadros}</div>
        <figcaption>Cada cuadro es 1 de cada 100 soles del presupuesto ejecutado en ${CONTRALORIA.anio}.</figcaption>
      </figure>
      <div class="cifras-grandes">
        <p class="cifra-grande"><b>S/ <span data-contar="${CONTRALORIA.millones}">${NUM.format(CONTRALORIA.millones)}</span> millones</b><span>se habrían perdido en ${CONTRALORIA.anio} por corrupción e inconducta funcional</span></p>
        <p class="cifra-grande"><b>S/ <span data-contar="${CONTRALORIA.inversionMillones}">${NUM.format(CONTRALORIA.inversionMillones)}</span> millones</b><span>de eso, en inversión: carreteras, hospitales y colegios</span></p>
        <p class="fuente-dato">Es una estimación de la Contraloría General de la República, no un conteo. <a class="enlace" href="${CONTRALORIA.url}">Ver la fuente</a></p>
      </div>
    </div>
  </section>`;
}

/** 02, a la derecha: mil cuadros por los procesos publicados este año; los pocos leídos a fondo, en lima. */
function milCuadros(lect) {
  const total = 1000;
  const leidos = Math.min(total, Math.max(1, Math.round((lect.leidos / lect.publicados) * total)));
  const altos = lect.alto ? Math.min(leidos, Math.max(1, Math.round((lect.alto / lect.publicados) * total))) : 0;
  // Repartidos con una semilla fija (no al azar en cada visita): buscarlos es como buscar una aguja en un pajar.
  const pos = [];
  for (let x = 11; pos.length < leidos; ) {
    x = (x * 1103515245 + 12345) % 2147483648;
    const k = x % total;
    if (!pos.includes(k)) pos.push(k);
  }
  const altosEn = new Set(pos.slice(0, altos));
  const leidosEn = new Set(pos);
  const cuadros = Array.from({ length: total }, (_, k) => (leidosEn.has(k) ? `<i class="${altosEn.has(k) ? "alto" : "leido"}"></i>` : "<i></i>")).join("");
  return `<figure class="mil-fig" data-anima>
        <div class="mil" role="img" aria-label="Mil cuadros por los procesos publicados en ${lect.anio}: ${leidos} en lima, los leídos a fondo; ${altos} en rojo, con riesgo alto">${cuadros}</div>
        <figcaption>
          <span class="mil-dato"><b data-contar="${lect.publicados}">${NUM.format(lect.publicados)}</b>procesos publicados en ${lect.anio}</span>
          <span class="mil-dato m-procesos"><i class="pxl"></i><b data-contar="${lect.leidos}">${NUM.format(lect.leidos)}</b>leídos a fondo por Vigía</span>
          <span class="mil-dato m-tramite"><i class="pxl"></i><b data-contar="${lect.alto}">${NUM.format(lect.alto)}</b>con riesgo alto</span>
          <span class="mil-nota">Cada cuadro son unos ${NUM.format(Math.round(lect.publicados / total))} procesos. Hallar las señales a mano es buscar una aguja en un pajar: para eso es la lupa.</span>
        </figcaption>
      </figure>`;
}

/** 02: la escala. Los procesos de compra de cada año, y lo poco que alcanza a leerse. */
function capEscala(datos) {
  const serie = (datos?.serie ?? []).filter((x) => x.total != null);
  const lect = datos?.lectura;
  if (!serie.length && !lect) return "";
  const anio = anioLima();
  const completos = serie.filter((x) => x.anio < anio);
  const minimo = completos.length ? Math.min(...completos.map((x) => x.total)) : null;
  const max = Math.max(1, ...serie.map((x) => x.total));
  const barras = serie
    .map((x, k) => `<li style="--v:${(x.total / max).toFixed(3)};--i:${k}"><span class="sr">${x.anio}: ${NUM.format(x.total)} procesos</span><span class="valor-v" aria-hidden="true">${NUM.format(Math.round(x.total / 1000))} mil</span><span class="barra-v" aria-hidden="true"></span><span class="anio" aria-hidden="true">${x.anio}${x.anio === anio ? "*" : ""}</span></li>`)
    .join("");
  const grafica = serie.length
    ? `<figure class="anios-fig" data-anima>
        <ol class="anios" style="--n:${serie.length}">${barras}</ol>
        <figcaption>Procesos de compra publicados en el SEACE, por año (OECE).${serie.some((x) => x.anio === anio) ? ` * ${anio}, hasta hoy.` : ""}</figcaption>
      </figure>`
    : "";
  return `<section class="marco seccion" id="escala" aria-labelledby="t-escala">
    <h2 id="t-escala"><span class="cap">02</span>Más de lo que nadie alcanza a leer</h2>
    <p class="intro">${minimo ? `El Estado publica más de ${NUM.format(Math.floor(minimo / 1000))} mil procesos de compra cada año. ` : ""}Cada uno trae bases, actas y contratos: leerlos todos a mano es imposible.</p>
    <div class="escala">
      ${grafica}
      ${lect ? milCuadros(lect) : ""}
    </div>
  </section>`;
}

/** 03: dónde. Las diez regiones con más casos en trámite y, dentro de cada barra, los que ya tienen sentencia firme. */
function capDonde(datos) {
  const regs = (datos?.regiones ?? []).filter((r) => r.tramite).sort((a, b) => b.tramite - a.tramite).slice(0, 10);
  if (!regs.length) return "";
  const max = regs[0].tramite;
  const filas = regs
    .map((r, k) => `<li style="--v:${(r.tramite / max).toFixed(3)};--f:${r.firme != null ? Math.min(1, r.firme / r.tramite).toFixed(3) : 0};--i:${k}">
        <a class="ranking-nombre" href="${VIGIA}/region/${r.c}">${REGIONES[r.c]}</a>
        <span class="pista-barra" aria-hidden="true"><span class="barra-h"><span class="firme"></span></span></span>
        <span class="ranking-cifra"><b data-contar="${r.tramite}">${NUM.format(r.tramite)}</b>${r.firme != null ? `<span>${NUM.format(r.firme)} con sentencia firme</span>` : ""}</span>
      </li>`)
    .join("");
  return `<section class="marco seccion" id="donde" aria-labelledby="t-donde">
    <h2 id="t-donde"><span class="cap">03</span>Dónde están los casos</h2>
    <p class="intro">Los casos de corrupción que la Procuraduría Anticorrupción tiene en trámite, en las diez regiones con más, y cuántos ya tienen sentencia firme.</p>
    <figure class="ranking-fig" data-anima>
      <p class="ranking-leyenda" aria-hidden="true"><span><i class="pxl tenue"></i>En trámite</span><span><i class="pxl"></i>Con sentencia firme</span></p>
      <ol class="ranking">${filas}</ol>
      <figcaption>Procuraduría Pública Especializada en Delitos de Corrupción${datos.fuente ? `, <a class="enlace" href="${escapar(datos.fuente)}">boletín</a>` : ""}${datos.corte ? ` al ${fechaLarga(datos.corte)}` : ""}. Cuenta cada caso en la región de la sede que lo lleva. <a class="enlace" href="#tabla-regiones">Ver las 25 regiones</a></figcaption>
    </figure>
  </section>`;
}

/** La lupa de Gobserva, grande, para el centro del flujo (las mismas clases del logo: sus colores y su latido). */
const LUPA_GRANDE = `<svg class="lupa-grande" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><path class="gl-aro" d="M38.6 38.6L53 53" stroke-width="8.6"/><circle class="gl-aro" cx="27" cy="27" r="16.2" fill="none" stroke-width="7.2"/><path class="gl-arista" d="M27 20.2L21.4 30.4M27 20.2L32.6 30.4M21.4 30.4H32.6" stroke-width="1.3" stroke-linecap="round"/><circle class="gl-nodo" cx="27" cy="20.2" r="2.7"/><circle class="gl-nodo" cx="21.4" cy="30.4" r="2.7"/><circle class="gl-nodo" cx="32.6" cy="30.4" r="2.7"/></svg>`;

/** 04: la solución. Lo que entra (las diez instituciones), la lupa que cruza y lo que sale (señales). */
function capComo() {
  return `<section class="marco seccion" id="como-funciona" aria-labelledby="t-como">
    <h2 id="t-como"><span class="cap">04</span>El Estado publica. Gobserva lee y cruza.</h2>
    <p class="intro">Ningún portal del Estado lee sus propios contratos: los publica. Gobserva los lee, los cruza con los registros de diez instituciones y te dice cuáles mirar dos veces.</p>
    <div class="flujo" data-anima>
      <div class="flujo-paso">
        <h3><span class="cap chico">1</span>Observa</h3>
        <ul class="chips" aria-label="Las diez instituciones">${FUENTES.map(([sigla]) => `<li class="chip esq">${sigla}</li>`).join("")}</ul>
        <p>Leemos cada día lo que publican: contratos, presupuesto, empresas, planillas, visitas y aportes.</p>
      </div>
      <div class="flujo-via" aria-hidden="true"></div>
      <div class="flujo-paso flujo-centro">
        ${LUPA_GRANDE}
        <h3><span class="cap chico">2</span>Conecta</h3>
        <p>Lo cruzamos por RUC, por entidad y por fecha.</p>
      </div>
      <div class="flujo-via" aria-hidden="true"></div>
      <div class="flujo-paso">
        <h3><span class="cap chico">3</span>Entiende</h3>
        <ul class="senales">${SENALES.map((t, k) => `<li class="senal esq" style="--i:${k}">${pixel("bandera")}<span>${t}</span></li>`).join("")}</ul>
        <p>Cada señal llega con su norma y el enlace al documento original. Tú decides qué mirar dos veces.</p>
      </div>
    </div>
  </section>`;
}

/** 05: para quién, y qué hace cada uno con la evidencia. */
function capParaQuien() {
  return `<section class="marco seccion" id="para-quien" aria-labelledby="t-para">
    <h2 id="t-para"><span class="cap">05</span>La misma evidencia, para tres trabajos</h2>
    <p class="intro">Gobserva no reemplaza a nadie: le ahorra a cada uno las semanas de leer y cruzar a mano.</p>
    <ul class="publicos" data-anima>${PUBLICOS.map(([icono, color, titulo, valor, usos], k) => `<li class="publico esq q-${color}" style="--i:${k}">${pixel(icono)}<h3>${titulo}</h3><p class="valor">${valor}</p><ul>${usos.map((u) => `<li><i class="pxl"></i>${u}</li>`).join("")}</ul></li>`).join("")}</ul>
  </section>`;
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
  --logo-tinta: var(--tinta); --logo-aro: var(--lima); --logo-nodo: #FFFFFF;
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
    --logo-aro: #2F6B10; --logo-nodo: #111817;
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
.logo .gl-aro { stroke: var(--logo-aro); }
.logo .gl-nodo { fill: var(--logo-nodo); }
.logo .gl-arista { fill: none; stroke: var(--logo-nodo); }
.logo .gl-cursor { fill: var(--logo-aro); }
/* El cursor titila, como el de «vigía_». */
@media (prefers-reduced-motion: no-preference) { .logo-portada .gl-cursor, .logo-cabecera .gl-cursor { animation: titila 1.1s steps(1) infinite; } }
@keyframes titila { 50% { opacity: 0; } }
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
.logo-cabecera { height: 2rem; }
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
.portada h1 { margin: 0; line-height: 0; }
.logo-portada { height: clamp(3.25rem, 2.2rem + 3.2vw, 5.25rem); }
.eslogan { margin: 1.125rem 0 0; font: 800 clamp(1.375rem, 1.05rem + 1.1vw, 2rem)/1.2 Doto, "Space Grotesk", monospace; text-wrap: balance; }
.eslogan em { font-style: normal; color: var(--acento); }
.entrada { margin: .875rem 0 0; max-width: 46ch; color: var(--tinta-suave); }

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
.llamado, .pie { background: var(--banda); color: var(--banda-tinta); --acento: var(--lima); --logo-tinta: var(--banda-tinta); --logo-aro: var(--lima); --logo-nodo: #FFFFFF; }
.llamado { margin-top: clamp(3rem, 7vw, 5rem); }
.llamado .marco { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1.25rem 2.5rem; padding-block: clamp(2rem, 5vw, 3rem); }
.llamado .intro { color: var(--banda-tenue); margin-top: .5rem; }
.pie .marco { display: grid; grid-template-columns: minmax(0, 1.5fr) repeat(2, minmax(0, 1fr)); gap: 2rem; padding-block: 2.25rem 2.5rem; border-top: 1px dotted var(--banda-linea); }
.logo-pie { height: 2.25rem; }
.pie .pie-eslogan { font: 800 1.0625rem/1.3 Doto, "Space Grotesk", monospace; margin: .875rem 0 0; color: var(--banda-tinta); }
.pie p { margin: .375rem 0 0; color: var(--banda-tenue); font-size: var(--t-small); }
.pie h2 { font: 400 .75rem/1.2 Silkscreen, monospace; letter-spacing: .04em; text-transform: uppercase; color: var(--banda-tenue); margin: .25rem 0 .875rem; }
.pie ul { list-style: none; margin: 0; padding: 0; display: grid; gap: .5rem; font-size: var(--t-small); }
.pie a { text-decoration: none; }
.pie a:hover { text-decoration: underline; }

/* La presentación: capítulos con su número, en píxeles */
.cap { display: inline-block; margin-right: .625rem; padding: .3rem .4rem .25rem; font: 400 .75rem/1 Silkscreen, monospace; color: var(--sobre-lima); background: var(--lima); vertical-align: .3em; }
.cap.chico { margin-right: .4rem; padding: .2rem .3rem .15rem; font-size: .625rem; vertical-align: .2em; }
.fuente-dato { margin: 0; color: var(--tenue); font-size: var(--t-caption); }

.problema { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2rem 3.5rem; align-items: center; margin-top: 2rem; }
.waffle-fig { margin: 0; }
.waffle { display: grid; grid-template-columns: repeat(10, 1fr); gap: 4px; width: clamp(13rem, 24vw, 18rem); }
.waffle i { aspect-ratio: 1; background: var(--mapa-sin); }
.waffle i.on { background: var(--c-tramite); }
.waffle-fig figcaption { margin-top: .75rem; max-width: 18rem; color: var(--tenue); font-size: var(--t-caption); }
.cifras-grandes { display: grid; gap: 1.5rem; }
.cifra-grande { margin: 0; display: grid; gap: .25rem; }
.cifra-grande b { font: 800 clamp(1.75rem, 1.2rem + 1.6vw, 2.5rem)/1.1 Doto, monospace; color: var(--c-tramite); font-variant-numeric: tabular-nums; }
.cifra-grande > span { color: var(--tinta-suave); max-width: 42ch; }

.escala { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, .95fr); gap: 2.5rem 3.5rem; margin-top: 2rem; align-items: end; }
.anios-fig, .mil-fig { margin: 0; min-width: 0; }
.anios { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); gap: .375rem; height: 15rem; }
.anios li { position: relative; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; text-align: center; min-width: 0; }
.valor-v { font: 800 .6875rem/1.2 Doto, monospace; color: var(--tinta-suave); margin-bottom: .25rem; white-space: nowrap; }
.barra-v { display: block; height: calc(var(--v) * 80%); background: repeating-linear-gradient(0deg, var(--c-procesos) 0 6px, transparent 6px 8px); transform-origin: bottom; }
.anio { margin-top: .375rem; font: 400 .625rem/1 Silkscreen, monospace; color: var(--tenue); }
.anios-fig figcaption, .ranking-fig figcaption { margin-top: .875rem; color: var(--tenue); font-size: var(--t-caption); }
.mil { display: grid; grid-template-columns: repeat(50, 1fr); gap: 2px; }
.mil i { aspect-ratio: 1; background: color-mix(in srgb, var(--tinta) 10%, transparent); }
.mil i.leido { background: var(--c-procesos); }
.mil i.alto { background: var(--c-tramite); }
.mil-fig figcaption { display: grid; gap: .2rem; margin-top: .875rem; font-size: var(--t-small); color: var(--tinta-suave); }
.mil-dato { display: flex; align-items: baseline; gap: .4rem; }
.mil-dato b { font: 800 1.25rem/1.2 Doto, monospace; color: var(--tinta); font-variant-numeric: tabular-nums; }
.mil-dato.m-procesos b, .mil-dato.m-tramite b { color: var(--c); }
.mil-dato .pxl { transform: translateY(-.05rem); }
.mil-nota { margin-top: .375rem; color: var(--tenue); font-size: var(--t-caption); }

.ranking-fig { margin: 1.75rem 0 0; }
.ranking-leyenda { display: flex; gap: 1.25rem; margin: 0 0 .875rem; font-size: var(--t-caption); color: var(--tinta-suave); }
.ranking-leyenda span { display: inline-flex; align-items: center; gap: .4rem; }
.ranking-leyenda .pxl { background: var(--c-tramite); }
.ranking-leyenda .pxl.tenue { background: color-mix(in srgb, var(--c-tramite) 45%, var(--fondo)); }
/* Una sola grilla para las diez filas (subgrid): la columna de las cifras toma el ancho de la más larga y todas las barras
   miden sobre la misma pista, así se comparan entre sí. */
.ranking { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 7.5rem minmax(0, 1fr) max-content; gap: .5rem .875rem; }
.ranking li { grid-column: 1 / -1; display: grid; grid-template-columns: 7.5rem minmax(0, 1fr) 15.5rem; grid-template-columns: subgrid; row-gap: .25rem; align-items: center; }
.ranking-nombre { font-weight: 600; font-size: var(--t-small); text-decoration: none; }
.ranking-nombre:hover { color: var(--acento); text-decoration: underline; }
.pista-barra { display: block; height: 1.125rem; }
.barra-h { position: relative; display: block; height: 100%; width: calc(var(--v) * 100%); transform-origin: left; background: repeating-linear-gradient(90deg, color-mix(in srgb, var(--c-tramite) 45%, var(--fondo)) 0 7px, transparent 7px 9px); }
.barra-h .firme { position: absolute; inset: 0 auto 0 0; width: calc(var(--f) * 100%); background: repeating-linear-gradient(90deg, var(--c-tramite) 0 7px, transparent 7px 9px); }
.ranking-cifra { display: flex; align-items: baseline; gap: .5rem; font-size: var(--t-caption); color: var(--tenue); white-space: nowrap; }
.ranking-cifra b { font: 800 1.0625rem/1.2 Doto, monospace; color: var(--c-tramite); font-variant-numeric: tabular-nums; }

.flujo { display: grid; grid-template-columns: minmax(0, 1fr) minmax(2rem, 4.5rem) auto minmax(2rem, 4.5rem) minmax(0, 1fr); gap: 1rem; align-items: center; margin-top: 2.25rem; }
.flujo-paso h3 { margin-bottom: .75rem; font-size: 1.125rem; }
.flujo-paso p { margin: .75rem 0 0; color: var(--tinta-suave); font-size: .9375rem; }
.flujo-centro { display: grid; justify-items: center; text-align: center; max-width: 13rem; }
.lupa-grande { width: 8.5rem; height: 8.5rem; display: block; margin-bottom: .5rem; }
.lupa-grande .gl-aro { fill: none; stroke: var(--logo-aro); }
.lupa-grande .gl-arista { fill: none; stroke: var(--logo-nodo); }
.lupa-grande .gl-nodo { fill: var(--logo-nodo); }
.chips { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: .375rem; }
.chip { --e: 3px; padding: .3rem .55rem; font: 600 .8125rem/1.2 Inter, sans-serif; background: var(--superficie-2); box-shadow: inset 0 0 0 1px var(--borde); }
.senales { list-style: none; margin: 0; padding: 0; display: grid; gap: .375rem; }
.senal { --e: 3px; display: flex; align-items: center; gap: .5rem; padding: .45rem .625rem; font-size: .875rem; line-height: 1.35; background: color-mix(in srgb, var(--c-tramite) 12%, var(--superficie)); }
.senal .px { width: 1rem; height: 1rem; color: var(--c-tramite); }
.flujo-via { height: 4px; background: radial-gradient(circle, var(--c-procesos) 1.6px, transparent 2.1px) 0 50% / 12px 4px repeat-x; }

.publicos { list-style: none; margin: 2rem 0 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .75rem; }
.publico { --e: 5px; display: grid; gap: .625rem; align-content: start; padding: 1.25rem 1.25rem 1.375rem; background: color-mix(in srgb, var(--c) 9%, var(--superficie)); }
.publico .px { width: 2.25rem; height: 2.25rem; color: var(--c); }
.publico .valor { margin: 0; color: var(--tinta); }
.publico ul { list-style: none; margin: .25rem 0 0; padding: .625rem 0 0; display: grid; gap: .4rem; border-top: 1px dotted color-mix(in srgb, var(--c) 45%, transparent); font-size: .875rem; color: var(--tinta-suave); }
.publico ul li { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: .5rem; align-items: baseline; }
.publico ul .pxl { width: .4375rem; height: .4375rem; background: var(--c); transform: translateY(-.1rem); }
.q-lima { --c: var(--acento); } .q-cian { --c: var(--c-politicos); } .q-violeta { --c: var(--c-congreso); }

/* Las animaciones: sólo con JavaScript y sin movimiento reducido (la clase .anima la pone animaciones.js). Lo que todavía
   no entró en pantalla espera en su estado inicial; al entrar (.visible) se arma en escalones, como píxeles. */
.anima [data-anima]:not(.visible) .waffle i.on { background: var(--mapa-sin); }
.anima .problema .waffle i.on { transition: background-color 0s linear calc(250ms + var(--i) * 110ms); }
.anima .anios-fig:not(.visible) .barra-v { transform: scaleY(0); }
.anima .anios-fig .barra-v { transition: transform .9s steps(9) calc(var(--i) * 80ms); }
.anima .anios-fig:not(.visible) .valor-v { opacity: 0; }
.anima .anios-fig .valor-v { transition: opacity .2s steps(2) calc(.8s + var(--i) * 80ms); }
.anima .mil-fig:not(.visible) .mil { clip-path: inset(0 0 100% 0); }
.anima .mil-fig .mil { transition: clip-path 1.2s steps(20); }
.anima .mil-fig.visible .mil i.leido, .anima .mil-fig.visible .mil i.alto { animation: destella .5s steps(2) 1.4s 4; }
@keyframes destella { 50% { background: var(--tinta); } }
.anima .ranking-fig:not(.visible) .barra-h { transform: scaleX(0); }
.anima .ranking-fig .barra-h { transition: transform .8s steps(12) calc(var(--i) * 70ms); }
.anima .flujo:not(.visible) .senal { opacity: 0; transform: translateX(8px); }
.anima .flujo .senal { transition: opacity .3s steps(3) calc(.5s + var(--i) * 260ms), transform .3s steps(3) calc(.5s + var(--i) * 260ms); }
.anima .flujo.andando .flujo-via { animation: fluye .9s linear infinite; }
.anima .flujo.andando .lupa-grande .gl-nodo { animation: late 1.8s ease-in-out infinite; }
@keyframes fluye { to { background-position: 12px 50%; } }
@keyframes late { 50% { opacity: .3; } }
.anima .publicos:not(.visible) > li, .anima .proximos:not(.visible) > li { opacity: 0; transform: translateY(10px); }
.anima .publicos > li, .anima .proximos > li { transition: opacity .45s steps(5) calc(var(--i) * 120ms), transform .45s steps(5) calc(var(--i) * 120ms); }
.anima .vigia:not(.visible) .ojo circle { transform: scale(0); }
.anima .vigia .ojo circle { transform-box: fill-box; transform-origin: center; transition: transform .4s cubic-bezier(.22, 1, .36, 1) calc(var(--i) * 45ms); }

@media (max-width: 63.99rem) {
  .problema, .escala { grid-template-columns: minmax(0, 1fr); }
  .flujo { grid-template-columns: minmax(0, 1fr); justify-items: stretch; }
  .flujo-centro { justify-self: center; }
  .flujo-via { justify-self: center; width: 4px; height: 2.5rem; background: radial-gradient(circle, var(--c-procesos) 1.6px, transparent 2.1px) 50% 0 / 4px 12px repeat-y; }
  .anima .flujo.andando .flujo-via { animation-name: fluye-v; }
  .publicos { grid-template-columns: minmax(0, 1fr); }
  .ranking { grid-template-columns: 6.5rem minmax(0, 1fr); }
  .ranking li { grid-template-columns: 6.5rem minmax(0, 1fr); grid-template-columns: subgrid; }
  .ranking-cifra { grid-column: 2; }
}
@keyframes fluye-v { to { background-position: 50% 12px; } }
@media (max-width: 39.99rem) {
  .valor-v { display: none; }
  .anios { height: 11rem; gap: .25rem; }
}

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
  .vigia { grid-template-columns: minmax(0, 1fr); }
  .proximos { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .principios { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 47.99rem) {
  .cabecera .ancla { display: none; }
  .logo-cabecera { height: 1.75rem; }
  .fuentes { grid-template-columns: minmax(0, 1fr); }
  .pie .marco { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .pie .marco > :first-child { grid-column: 1 / -1; }
  .lupa-dato { display: none; }
}
@media (max-width: 39.99rem) {
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
        <li class="ancla"><a href="#problema">El problema</a></li>
        <li class="ancla"><a href="#como-funciona">Cómo funciona</a></li>
        <li class="ancla"><a href="#para-quien">Para quién</a></li>
        <li class="ancla"><a href="#proximamente">Próximamente</a></li>
        <li><a class="boton lima chico esq" href="${VIGIA}/">Entrar a Vigía</a></li>
      </ul>
    </nav>
  </div>
</header>
<main id="contenido">
  <section class="portada" aria-labelledby="titulo">
    <div class="marco portada-grilla">
      <div class="portada-texto">
        <h1 id="titulo"><span class="sr">Gobserva</span>${logo("logo-portada")}</h1>
        <p class="eslogan">Lo de todos, <span class="junto"><em>a la vista</em> de todos.</span></p>
        <p class="entrada">Somos una GovTech peruana: cruzamos lo que el Estado publica y te lo mostramos con su fuente al lado. Pasa la lupa por el mapa: cada región muestra lo que la Procuraduría Anticorrupción, la Contraloría y la OECE ya registraron.</p>
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

  ${capProblema()}
  ${capEscala(datos)}
  ${capDonde(datos)}
  ${capComo()}
  ${capParaQuien()}

  <section class="marco seccion" id="vigia" aria-labelledby="t-vigia">
    <div class="vigia esq" data-anima>
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
    <ul class="proximos" data-anima>
      ${PROXIMOS.map(([icono, clase, titulo, texto, ya], k) => `<li class="proximo esq p-${clase}" style="--i:${k}">${pixel(icono)}<span class="estado">En preparación</span><h3>${titulo}</h3><p>${texto}</p><p class="ya">${ya}</p></li>`).join("\n      ")}
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
        <li><a href="#problema">El problema</a></li>
        <li><a href="#como-funciona">Cómo funciona</a></li>
        <li><a href="#para-quien">Para quién</a></li>
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
<script src="/animaciones.js?v=${VERSION_JS}" defer></script>
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
