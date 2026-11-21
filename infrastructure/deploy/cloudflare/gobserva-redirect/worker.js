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
// El diseño (radar cívico, el mismo día: «un layout más complejo, más tecnológico, colores verdes, animaciones, mensajes;
// recuerda que es el punto de entrada»): la portada es un instrumento de observación. El mapa es la pantalla de un radar
// (anillos, rumbos, un barrido que aclara los puntos a su paso, las tres regiones con más casos encendidas en rojo y las
// coordenadas de la lupa); una consola escribe lo que Gobserva lee y sigue al radar región por región; las cifras van en
// paneles de instrumentos y los monitores (Vigía en línea, los demás en preparación) son la entrada a cada producto. Verde
// es la señal; rojo, la alerta (lo que se pierde, la sentencia firme, el riesgo alto). Cada institución conserva su luz
// (Procuraduría roja, Contraloría ámbar, OECE verde). Letras: Archivo (títulos anchos y texto), JetBrains Mono (la consola
// y los rótulos, la misma del logo) y Doto, de puntos, para las cifras.
//
// Después («ordénalo mejor y haz un botón de día y noche»): el radar y la lectura de la región en un solo instrumento; las
// secciones numeradas en orden (SECCIONES), con un índice en la cabecera que marca la que se está leyendo; y dos modos,
// noche (el de siempre, el radar) y día (papel verde claro, sin neón), con el botón Día | Noche (publico/interfaz.js).
//
// Los archivos de publico/ (portada.js, mapa-peru.js, favicon, logo.png, og.png y el logo para descargar en /marca/) los
// sirve Cloudflare tal cual, antes de llegar a este código (wrangler.jsonc, "assets"). El logo va en línea desde marca.js
// (marca/generar_marca.py); la malla, desde publico/mapa-peru.js (mapa/generar_mapa.py).
//
// El nombre del Worker (gobserva-redirect) se mantiene: los custom domains están atados a él. Despliegue: README.md.

import { LOGO_INTERIOR, LOGO_VIEWBOX } from "./marca.js";
import { ojoVigia, pixel } from "./pixeles.js";
import { personaje } from "./personajes.js";

const RAIZ = "https://gobserva.cloud";
const VIGIA = "https://vigia.gobserva.cloud";
const CLAVE_INDEXNOW = "70c4458a363841ee4aef67be90cc8565";
// La fecha de la última versión de la portada (sitemap y datos estructurados): cambiarla al cambiar el contenido.
const ACTUALIZADA = "2026-11-01";
// Va en la URL de los scripts de publico/: subirla al cambiarlos (Cloudflare los guarda un día en el navegador).
const VERSION_JS = "2026-11-20a";
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

// Para quién: [ícono, quién, qué gana, qué hace con Vigía].
const PUBLICOS = [
  [
    "ciudadania",
    "Ciudadanía",
    "Entiende en qué se gasta el dinero de tu distrito, sin saber de contrataciones.",
    ["Busca tu región, tu municipalidad o una empresa", "Mira quién ganó cada contrato y con qué banderas", "Comparte la evidencia oficial"],
  ],
  [
    "entiende",
    "Periodismo",
    "Encuentra el hilo y la evidencia para publicarlo sin que te desmientan.",
    ["Cruces ya hechos entre contratos, empresas, aportes y visitas", "La norma citada y el documento original al lado", "La evidencia lista para descargar en PDF"],
  ],
  [
    "escudo",
    "Control y fiscalización",
    "Señales trazables para actuar rápido: qué fuente, qué documento y qué norma.",
    ["Cada señal con su traza y su fuente", "Prioridad por riesgo, región y entidad", "La misma regla para todos, con código abierto"],
  ],
];

// Lo que muestra el radar: [valor, nombre, pie, institución]. El mapa es siempre verde, como la pantalla de un radar; cada
// institución tiene su luz (la misma en los canales, la lectura de la región y las fuentes).
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

// Los productos de Gobserva en línea además de Vigía (2026-11-01, pedido del usuario: ganar plata con lo que Vigía ya
// captura): [ícono, nombre, dominio, lema, qué hace, enlace, acción]. Marca propia, planes con precio de fundador.
// La gente de cada producto (personajes.js): quién lo usa y dónde. Decorativa.
const ESCENA_PRODUCTO = {
  ciudadania: ["postulante", "tablero"],
  institucion: ["emprendedora", "camion"],
  obras: ["obrero", "grua"],
  salud: ["vecina", "clinica"],
};

const PRODUCTOS_GOB = [
  [
    "ciudadania",
    "Gobserva Empleo",
    "empleo.gobserva.cloud",
    "Todas las plazas CAS del Estado, con sus requisitos claros.",
    "Miles de plazas abiertas a la vez, con sueldo, vacantes, cuándo cierran y lo que nadie te dice: si la plaza se repite o si ya hay alguien haciendo ese trabajo. Alertas por correo: gratis cada semana o cada mañana con precio de fundador.",
    "https://empleo.gobserva.cloud",
    "Buscar plazas",
  ],
  [
    "institucion",
    "Gobserva Licitaciones",
    "licitaciones.gobserva.cloud",
    "Las oportunidades para venderle al Estado, cada día.",
    "Las convocatorias del SEACE de tu rubro y tu región, con inteligencia de mercado: qué entidades compran, quién gana y a qué precio. Alertas diarias, API y MCP para conectar tu IA.",
    "https://licitaciones.gobserva.cloud",
    "Ver oportunidades",
  ],
  [
    "obras",
    "Gobserva Obras",
    "obras.gobserva.cloud",
    "Las obras públicas que se vienen, antes de que se liciten.",
    "Los proyectos de inversión de tu región y tu sector: los viables que todavía no se licitan, las obras en marcha y las paralizadas, con su costo, su avance y quién las ejecuta. Alertas diarias y MCP para conectar tu IA.",
    "https://obras.gobserva.cloud",
    "Ver proyectos",
  ],
  [
    "salud",
    "Gobserva Salud",
    "salud.gobserva.cloud",
    "Verifica tu clínica y a tu médico con fuentes oficiales.",
    "Las 36 mil instituciones prestadoras de salud del RENIPRESS: si están activas, su categoría, si tienen centro quirúrgico y sus sanciones firmes de SUSALUD, cada dato con su fecha. Cómo verificar a un médico en el Colegio Médico. Abierto y gratis, con un asistente y un MCP sin cuenta.",
    "https://salud.gobserva.cloud",
    "Verificar ahora",
  ],
];

// Los monitores que vienen (pedido del usuario: «secciones de próximos, por ejemplo Monitoreo del Congreso, Monitoreo
// histórico de políticos»): [ícono, nombre, qué hará, qué fuente ya carga Vigía hoy (SCRAPERS.md)]. Nada de esto está en
// línea todavía.
const PROXIMOS = [
  [
    "congreso",
    "Monitoreo del Congreso",
    "Cómo vota cada congresista, a quién recibe en su despacho y qué leyes impulsa, con el registro oficial de cada sesión.",
    "Ya leemos las visitas al Congreso.",
  ],
  [
    "politicos",
    "Monitoreo histórico de políticos",
    "La trayectoria de cada político en una línea de tiempo: partidos, cargos, declaraciones juradas, aportes de campaña y sentencias.",
    "Ya leemos el JNE, la ONPE y las declaraciones juradas.",
  ],
  [
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

// [sigla, qué da, nombre completo, la métrica del radar que mide (si mide una): su luz es la de esa métrica]
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

// Las secciones, en el orden de la página (del problema a la confianza): [id, nombre en el índice de la cabecera]. El
// número de cada una (01 a 06) sale de este orden: va en su título y en el índice, que marca la que se está leyendo.
const SECCIONES = [
  ["datos", "Datos"],
  ["como-funciona", "Cómo funciona"],
  ["para-quien", "Para quién"],
  ["monitores", "Monitores"],
  ["principios", "Principios"],
  ["fuentes", "Fuentes"],
];
const numeroSeccion = (id) => String(SECCIONES.findIndex(([s]) => s === id) + 1).padStart(2, "0");
/** El título de una sección, con su número. */
const tituloSeccion = (id, tituloId, texto) =>
  `<h2 id="${tituloId}"><span class="sec-num" aria-hidden="true">${numeroSeccion(id)}</span>${texto}</h2>`;

/** La lectura de una región: lo que dice cada institución, sin sumar unas con otras (docs/CORRUPCION.md). */
function ficha(datos, codigo) {
  const r = datos?.regiones.find((x) => x.c === codigo);
  const opciones = REGIONES_LISTA.map(([c, n]) => `<option value="${c}"${c === codigo ? " selected" : ""}>${n}</option>`).join("");
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
    ? `<a class="enlace" href="${escapar(datos.fuente)}">boletín</a> al ${fechaLarga(datos.corte)}`
    : datos.corte ? `al ${fechaLarga(datos.corte)}` : "";
  return `<div class="ficha" id="ficha">
        ${cabeza}
        <div class="ficha-grupos">
          <div class="ficha-grupo m-tramite">
            <p class="ficha-fuente"><i class="led"></i>Procuraduría Anticorrupción<span>${boletin}</span></p>
            <p class="ficha-fila"><b data-campo="tramite">${numero(r.tramite)}</b><span>casos de corrupción en trámite</span></p>
            <p class="ficha-fila"><b data-campo="firme">${numero(r.firme)}</b><span>con sentencia firme</span></p>
          </div>
          <div class="ficha-grupo m-penal">
            <p class="ficha-fuente"><i class="led"></i>Contraloría<span id="ficha-anios">${anios(r)}</span></p>
            <p class="ficha-fila"><b data-campo="informes">${numero(r.informes)}</b><span>informes con responsabilidad señalada</span></p>
            <p class="ficha-fila"><b data-campo="penal">${numero(r.penal)}</b><span>con presunta responsabilidad penal, que no es una condena</span></p>
          </div>
          <div class="ficha-grupo m-procesos">
            <p class="ficha-fuente"><i class="led"></i>OECE<span>procesos desde 2015</span></p>
            <p class="ficha-fila"><b data-campo="procesos">${numero(r.procesos)}</b><span>procesos de compra, por <i data-campo="monto">${soles(r.monto)}</i> de valor referencial</span></p>
          </div>
        </div>
        <p class="ficha-nota">Cada institución cuenta distinto: sus cifras no se suman.</p>
      </div>`;
}

/** Las 25 regiones en una tabla: lo mismo que el radar, para leerlo de corrido (y sin JavaScript). */
function tabla(datos) {
  if (!datos) return "";
  const filas = datos.regiones
    .map((r) => `<tr><th scope="row"><a class="enlace" href="${VIGIA}/region/${r.c}">${REGIONES[r.c]}</a></th><td>${numero(r.tramite)}</td><td>${numero(r.firme)}</td><td>${numero(r.penal)}</td><td>${numero(r.procesos)}</td></tr>`)
    .join("\n            ");
  return `<details class="tabla-regiones" id="tabla-regiones">
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

// La retícula del radar, en unidades de un visor de 200 x 200 con el centro en el medio (recorta los costados en un visor
// alto). pathLength="360" vuelve grados los guiones: una marca cada 5° y una larga cada 30°, como el rumbo de un radar.
const RETICULA = `<svg class="radar-reticula" viewBox="-100 -100 200 200" preserveAspectRatio="xMidYMid slice" focusable="false">
              <circle r="26"/><circle r="52"/><circle r="78"/><circle r="104"/>
              <path d="M-140 0H140M0-140V140"/>
              <circle class="rumbo" r="91" pathLength="360" stroke-dasharray=".35 4.65"/>
              <circle class="rumbo mayor" r="91" pathLength="360" stroke-dasharray=".7 29.3"/>
              <text x="0" y="-80">N</text>
            </svg>`;

/** El instrumento de la portada, en un solo marco: los canales (qué muestra el radar, con la cifra del país), el visor
 * con el mapa, la retícula y el barrido, la lupa y sus coordenadas, y al lado la lectura de la región. Lo anima
 * portada.js. Se acomoda a su propio ancho (container queries): angosto, la lectura va debajo del visor. */
function instrumento(datos) {
  const tramites = (datos?.regiones ?? []).map((r) => r.tramite).filter((v) => v != null);
  const metricas = tramites.length
    ? `<fieldset class="metricas" data-anima>
        <legend class="sr">Qué muestra el radar</legend>
        ${METRICAS.map(([valor, nombre, pie, fuente], k) => `<label class="metrica m-${valor}">
          <input type="radio" name="metrica" value="${valor}"${k === 0 ? " checked" : ""}>
          <span class="metrica-nombre"><i class="led"></i>${nombre}</span>
          <b class="metrica-cifra"${suma(datos, valor) != null ? ` data-contar="${suma(datos, valor)}"` : ""}>${numero(suma(datos, valor))}</b>
          <span class="metrica-pie">${pie}<span class="sr">, según ${fuente}</span></span>
        </label>`).join("\n        ")}
      </fieldset>`
    : "";
  const leyenda = tramites.length
    ? `<div class="leyenda">
              <div class="leyenda-escala"><span id="leyenda-min">${numero(Math.min(...tramites))}</span><span class="leyenda-tonos" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><span id="leyenda-max">${numero(Math.max(...tramites))}</span></div>
              <p class="leyenda-blips"><i aria-hidden="true"></i>Las tres regiones con más</p>
              <p id="leyenda-titulo">Casos de corrupción en trámite, por región${datos.corte ? ` (Procuraduría Anticorrupción, al ${fechaLarga(datos.corte)})` : ""}</p>
            </div>`
    : "";
  return `<div class="portada-mapa instrumento panel m-tramite">
      ${metricas}
      <div class="instrumento-cuerpo">
        <div class="visor">
          <div id="mapa" class="mapa" tabindex="0" role="group" aria-roledescription="mapa" aria-label="Mapa del Perú por regiones. Las flechas cambian de región y Enter la abre en Vigía.">
            <canvas aria-hidden="true"></canvas>
            <div class="radar" aria-hidden="true">
              ${RETICULA}
              <div class="radar-barrido"></div>
              <div class="radar-blips"></div>
            </div>
            <div class="lupa-rotulos" aria-hidden="true">
              <p class="lupa-region"></p>
              <p class="lupa-dato"><b></b><span></span></p>
              <p class="lupa-dato"><b></b><span></span></p>
            </div>
            <noscript><p class="sin-js">Con JavaScript, aquí pasas la lupa por el mapa. Las cifras de cada región están en la lectura de al lado y en la tabla de esta página.</p></noscript>
          </div>
          <p class="visor-coords" aria-hidden="true"><span>Lupa</span><span id="coords">12°03′ S 77°03′ O</span></p>
          <button type="button" class="pausa" id="pausa" aria-pressed="false"><i aria-hidden="true"></i>Pausar animación</button>
          <p class="pista"><span class="pista-mouse">Pasa la lupa por una región; con un clic la abres en Vigía.</span><span class="pista-toque">Toca una región para ver sus cifras.</span></p>
          <div class="mapa-pie">${leyenda}</div>
        </div>
        ${ficha(datos, INICIAL)}
      </div>
    </div>`;
}

/** Lo que escribe la consola de la portada: preguntas y respuestas con las cifras de esta misma página. Sin JavaScript se
 * ve así, quieta; con él, animaciones.js la escribe letra por letra y sigue al radar región por región. */
function lineasConsola(datos) {
  const l = [["cmd", "fuentes"], ["res", "10 instituciones del Estado, más de 20 registros públicos"]];
  const lect = datos?.lectura;
  if (lect) {
    l.push(["cmd", `procesos ${lect.anio}`], ["res", `${NUM.format(lect.publicados)} publicados en el SEACE`]);
    l.push(["cmd", "leídos a fondo"], ["res", `${NUM.format(lect.leidos)} por Vigía`], ["res alerta", `${NUM.format(lect.alto)} con riesgo alto`]);
  }
  l.push(["cmd", "privacidad"], ["res", "nunca publicamos un DNI"]);
  const inicial = datos?.regiones?.find((r) => r.c === INICIAL);
  if (inicial?.tramite != null) {
    l.push(["cmd", `región ${REGIONES[INICIAL]}`], ["res", `${NUM.format(inicial.tramite)} casos de corrupción en trámite`]);
    if (inicial.firme != null) l.push(["res alerta", `${NUM.format(inicial.firme)} con sentencia firme`]);
  }
  return l;
}

function consola(datos) {
  return `<div class="consola" aria-hidden="true">
        <p class="consola-barra"><span>gobserva / consola</span><span class="estado">En línea</span></p>
        <ol class="consola-lineas">${lineasConsola(datos).map(([clase, t]) => `<li class="${clase}">${escapar(t)}</li>`).join("")}<li class="cmd escribiendo"></li></ol>
      </div>`;
}

/** La cinta de cifras bajo la portada. Va dos veces para dar la vuelta sin corte; la copia no se lee. */
function cinta(datos) {
  const t = [];
  const pais = (campo) => suma(datos, campo);
  if (pais("procesos") != null) t.push([pais("procesos"), "procesos de compra desde 2015", "OECE"]);
  if (pais("tramite") != null) t.push([pais("tramite"), "casos de corrupción en trámite", "Procuraduría"]);
  if (pais("penal") != null) t.push([pais("penal"), "informes con presunta responsabilidad penal", "Contraloría"]);
  const lect = datos?.lectura;
  if (lect) t.push([lect.publicados, `procesos publicados en ${lect.anio}`, "OECE"], [lect.leidos, "leídos a fondo", "Vigía"], [lect.alto, "con riesgo alto", "Vigía"]);
  t.push([`S/ ${NUM.format(CONTRALORIA.millones)} millones`, `perdidos en ${CONTRALORIA.anio}, según su estimación`, "Contraloría"]);
  t.push([10, "instituciones conectadas", "Gobserva"]);
  const fila = t.map(([v, d, f]) => `<li><b>${typeof v === "number" ? NUM.format(v) : v}</b>${d}<span>${f}</span></li>`).join("");
  return `<div class="cinta">
    <ul class="cinta-fila" aria-label="Cifras del Estado peruano">${fila}</ul>
    <ul class="cinta-fila" aria-hidden="true">${fila}</ul>
  </div>`;
}

// ─── 01, lo que el radar detecta: cuatro paneles de instrumentos (pedido del usuario: «es la presentación: gráficas,
// datos, propuestas, valor»). Cada uno dice de qué institución sale (su luz, en la cabecera) y, abajo, la fuente
// completa. Cada gráfica se arma al entrar en pantalla (publico/animaciones.js) y, sin JavaScript o con movimiento
// reducido, se ve quieta y completa.

/** Un panel de instrumento: su título, de dónde sale, lo de adentro, la fuente y, si hace falta, algo más al pie. */
function panel(clase, [luz, institucion], id, titulo, cuerpo, pie, extra = "") {
  return `<div class="panel ${clase}" data-anima>
        <div class="panel-cabeza"><h3 id="${id}">${titulo}</h3><span class="panel-fuente ${luz}"><i class="led"></i>${institucion}</span></div>
        ${cuerpo}
        ${pie ? `<p class="panel-pie">${pie}</p>` : ""}
        ${extra}
      </div>`;
}

/** Lo que se pierde, según la Contraloría. Cien cuadros, uno por cada sol de cien. */
function panelPerdida() {
  const marcados = Math.round(CONTRALORIA.porCien);
  const cuadros = Array.from({ length: 100 }, (_, k) => (k < marcados ? `<i class="on" style="--i:${k}"></i>` : "<i></i>")).join("");
  return panel("p-perdida", ["m-penal", "Contraloría"], "t-perdida", "Casi 13 de cada 100 soles se pierden", `<div class="perdida">
          <figure class="waffle-fig">
            <div class="waffle" role="img" aria-label="Cien cuadros, trece en rojo: casi 13 de cada 100 soles">${cuadros}</div>
            <figcaption>1 cuadro = 1 de cada 100 soles ejecutados en ${CONTRALORIA.anio}</figcaption>
          </figure>
          <div class="cifras-grandes">
            <p class="cifra-grande"><b>S/ <span data-contar="${CONTRALORIA.millones}">${NUM.format(CONTRALORIA.millones)}</span> millones</b><span>se habrían perdido en ${CONTRALORIA.anio} por corrupción e inconducta funcional: el ${NUM1.format(CONTRALORIA.porCien)} % del presupuesto que ejecutó el Estado</span></p>
            <p class="cifra-grande"><b>S/ <span data-contar="${CONTRALORIA.inversionMillones}">${NUM.format(CONTRALORIA.inversionMillones)}</span> millones</b><span>de eso, en inversión: carreteras, hospitales y colegios</span></p>
          </div>
        </div>`, `Es una estimación de la Contraloría General de la República, no un conteo. <a class="enlace" href="${CONTRALORIA.url}">Ver la fuente</a>`);
}

/** Los procesos de compra de cada año (la serie empieza en 2016: ver bajarRegiones). */
function panelAnios(datos) {
  const serie = (datos?.serie ?? []).filter((x) => x.total != null);
  if (!serie.length) return "";
  const anio = anioLima();
  const completos = serie.filter((x) => x.anio < anio);
  const minimo = completos.length ? Math.min(...completos.map((x) => x.total)) : Math.min(...serie.map((x) => x.total));
  const max = Math.max(1, ...serie.map((x) => x.total));
  const barras = serie
    .map((x, k) => `<li style="--v:${(x.total / max).toFixed(3)};--i:${k}"><span class="sr">${x.anio}: ${NUM.format(x.total)} procesos</span><span class="valor-v" aria-hidden="true">${NUM.format(Math.round(x.total / 1000))}</span><span class="barra-v" aria-hidden="true"></span><span class="anio" aria-hidden="true">${String(x.anio).slice(2)}${x.anio === anio ? "*" : ""}</span></li>`)
    .join("");
  const hoy = serie.some((x) => x.anio === anio) ? ` * ${anio}, hasta hoy.` : "";
  return panel("p-anios", ["m-procesos", "OECE"], "t-anios", `Más de ${NUM.format(Math.floor(minimo / 1000))} mil procesos de compra al año`,
    `<ol class="anios" style="--n:${serie.length}" aria-label="Procesos de compra publicados por año">${barras}</ol>`,
    `Procesos publicados en el SEACE por año, en miles, de ${serie[0].anio} a ${serie[serie.length - 1].anio}.${hoy}`);
}

// El orden en que se encienden los mil cuadros de la aguja: una baraja (Fisher-Yates) con semilla fija, la misma en cada
// visita, hecha una sola vez. Antes se sacaban al azar hasta juntar los leídos, multiplicando en coma flotante: el
// producto pasaba de 2^53, perdía los bits bajos y el generador sólo alcanzaba 170 cuadros distintos. Con más de 17 % de
// leídos el bucle no terminaba y Cloudflare cortaba la portada a los 30 s de CPU (error 1102, 2026-11-21). Math.imul
// multiplica en 32 bits exactos, y la baraja termina siempre en mil pasos, sea cual sea la cifra.
const MIL = 1000;
const ORDEN_AGUJA = (() => {
  const orden = Array.from({ length: MIL }, (_, k) => k);
  let x = 11;
  for (let k = MIL - 1; k > 0; k--) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    const j = Math.floor((x / 4294967296) * (k + 1)); // los bits altos: los bajos de un congruencial se repiten pronto
    [orden[k], orden[j]] = [orden[j], orden[k]];
  }
  return orden;
})();

/** Mil cuadros por los procesos publicados este año; los pocos leídos a fondo se encienden. */
function panelAguja(datos) {
  const lect = datos?.lectura;
  if (!lect) return "";
  const total = MIL;
  const leidos = Math.min(total, Math.max(1, Math.round((lect.leidos / lect.publicados) * total)));
  const altos = lect.alto ? Math.min(leidos, Math.max(1, Math.round((lect.alto / lect.publicados) * total))) : 0;
  // Repartidos con una semilla fija (no al azar en cada visita): buscarlos es como buscar una aguja en un pajar.
  const pos = ORDEN_AGUJA.slice(0, leidos);
  const altosEn = new Set(pos.slice(0, altos));
  const leidosEn = new Set(pos);
  const cuadros = Array.from({ length: total }, (_, k) => (leidosEn.has(k) ? `<i class="${altosEn.has(k) ? "alto" : "leido"}"></i>` : "<i></i>")).join("");
  return panel("p-aguja", ["m-vigia", "Vigía"], "t-aguja", "Una aguja en un pajar", `<figure class="mil-fig">
          <div class="mil" role="img" aria-label="Mil cuadros por los procesos publicados en ${lect.anio}: ${leidos} encendidos, los leídos a fondo; ${altos} en rojo, con riesgo alto">${cuadros}</div>
          <figcaption class="mil-datos">
            <span class="mil-dato"><b data-contar="${lect.publicados}">${NUM.format(lect.publicados)}</b>procesos publicados en ${lect.anio}</span>
            <span class="mil-dato m-procesos"><i class="led"></i><b data-contar="${lect.leidos}">${NUM.format(lect.leidos)}</b>leídos a fondo por Vigía</span>
            <span class="mil-dato m-tramite"><i class="led"></i><b data-contar="${lect.alto}">${NUM.format(lect.alto)}</b>con riesgo alto</span>
          </figcaption>
        </figure>`, `Cada cuadro son unos ${NUM.format(Math.round(lect.publicados / total))} procesos publicados en el SEACE (OECE). Hallar las señales a mano es buscar una aguja en un pajar: para eso es la lupa.`);
}

/** Dónde: las diez regiones con más casos en trámite y, dentro de cada barra, los que ya tienen sentencia firme. Debajo,
 * las 25 regiones en una tabla. */
function panelDonde(datos) {
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
  return panel("p-donde", ["m-tramite", "Procuraduría"], "t-donde", "Dónde están los casos", `<p class="ranking-leyenda" aria-hidden="true"><span><i></i>En trámite</span><span><i class="firme"></i>Con sentencia firme</span></p>
        <ol class="ranking" aria-labelledby="t-donde">${filas}</ol>`,
    `Casos de corrupción en trámite en la Procuraduría Pública Especializada en Delitos de Corrupción${datos.fuente ? ` (<a class="enlace" href="${escapar(datos.fuente)}">boletín</a>${datos.corte ? ` al ${fechaLarga(datos.corte)}` : ""})` : ""}, en las diez regiones con más. Cuenta cada caso en la región de la sede que lo lleva.`,
    tabla(datos));
}

/** La lupa de Gobserva, grande, para la etapa «Conecta» (las mismas clases del logo: sus colores y su latido). */
const LUPA_GRANDE = `<svg class="lupa-grande" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><path class="gl-aro" d="M38.6 38.6L53 53" stroke-width="8.6"/><circle class="gl-aro" cx="27" cy="27" r="16.2" fill="none" stroke-width="7.2"/><path class="gl-arista" d="M27 20.2L21.4 30.4M27 20.2L32.6 30.4M21.4 30.4H32.6" stroke-width="1.3" stroke-linecap="round"/><circle class="gl-nodo" cx="27" cy="20.2" r="2.7"/><circle class="gl-nodo" cx="21.4" cy="30.4" r="2.7"/><circle class="gl-nodo" cx="32.6" cy="30.4" r="2.7"/></svg>`;

/** El botón de día y noche (publico/interfaz.js): dos opciones, una apretada. Sin JavaScript no sirve, así que llega
 * oculto y el script lo muestra. */
const BOTON_MODO = `<div class="modo" role="group" aria-label="Modo de color" hidden>
        <button type="button" data-modo="dia" aria-pressed="false">${pixel("sol")}<span>Día</span></button>
        <button type="button" data-modo="noche" aria-pressed="true">${pixel("luna")}<span>Noche</span></button>
      </div>`;

const CSS = `
:root {
  /* Noche, el modo de siempre: la pantalla de un instrumento de observación. Verde es la señal; rojo, la alerta. */
  color-scheme: dark;
  --fondo: #030B07; --fondo-2: #051209; --panel: #071810; --linea: #12301F; --borde: #1C4A33;
  --reticula: rgba(61, 255, 138, .045);
  --tinta: #E2F7EA; --tinta-suave: #A9CDB8; --tenue: #6F9D84;
  --fosforo: #3DFF8A; --fosforo-2: #27C76B; --musgo: #123F28; --menta: #A8FFD0;
  --lima: #D4FF3F; --sobre-lima: #04100A; --sobre-fosforo: #04100A; --borde-lima: #D4FF3F;
  --alerta: #FF5A4D; --ambar: #FFB020;
  /* La luz de cada institución: Procuraduría, Contraloría y OECE; y la de Vigía. */
  --c-tramite: var(--alerta); --c-penal: var(--ambar); --c-procesos: var(--fosforo); --c-vigia: var(--lima);
  /* El mapa: una sola rampa verde para las tres métricas (más brillo, más casos), como la pantalla de un radar. */
  --r1: #0F3A24; --r2: #165C38; --r3: #1E8A50; --r4: #2BBF6A; --r5: #3DFF8A;
  --mapa-sin: #0B2417;
  --lupa-aro: #A8FFD0; --lupa-vidrio: rgba(61, 255, 138, .06); --rotulo: rgba(4, 16, 10, .92);
  --logo-tinta: var(--tinta); --logo-aro: var(--lima); --logo-nodo: #FFFFFF; --ojo: var(--lima);
  --cabecera-fondo: rgba(3, 11, 7, .84); --consola-fondo: rgba(5, 18, 9, .88);
  /* El brillo del fósforo: halos, luces y sombras de color. De día no hay. */
  --halo: 0 0 14px rgba(61, 255, 138, .4);
  --halo-alerta: 0 0 14px rgba(255, 90, 77, .4);
  --halo-lima: 0 0 24px rgba(212, 255, 63, .22);
  --halo-sel: 0 0 20px rgba(61, 255, 138, .12);
  --halo-filtro: drop-shadow(0 0 6px rgba(61, 255, 138, .28));
  --halo-lupa: drop-shadow(0 0 14px rgba(212, 255, 63, .3));
  --luz: 8px;
  /* El radar: cómo se suma el barrido a la pantalla, su luz y las líneas del tubo. */
  --mezcla: screen;
  --barrido: conic-gradient(from 0deg, transparent 0deg 285deg, rgba(61, 255, 138, .035) 285deg, rgba(61, 255, 138, .2) 356deg, rgba(168, 255, 208, .75) 359.5deg, transparent 360deg);
  --tubo: rgba(0, 0, 0, .2);
  --f-texto: Archivo, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --f-mono: "JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  --f-led: Doto, "JetBrains Mono", monospace;
  --t-display: clamp(1.5rem, 1.1rem + 1.4vw, 2.125rem);
  --t-title: clamp(1.375rem, 1.15rem + .7vw, 1.875rem);
  --t-heading: 1.0625rem;
  --t-body: 1rem;
  --t-small: .875rem;
  --t-caption: .8125rem;
  --t-mono: .75rem;
  /* Una vuelta del barrido del radar (portada.js lo lee para encender las regiones a su paso). */
  --periodo: 6s;
  /* Los personajes de píxeles de cada producto (personajes.js): la piel y los rasgos son los mismos de día y de noche. */
  --px-linea: var(--tinta); --px-fondo: var(--panel); --px-marca: var(--lima);
  --px-piel: #C98E5F; --px-pelo: #8B644A; --px-rasgo: #281C16; --px-bata: #DCE6E3;
}
:root[data-modo="dia"] {
  /* Día: papel verde claro y tinta de bosque, sin neón ni brillos (como el modo día de Vigía). Contraste de 4.5:1 o más
     sobre el fondo para todo lo que es texto. */
  color-scheme: light;
  --fondo: #EDF4EF; --fondo-2: #E3EDE6; --panel: #F8FCF9; --linea: #CADBD0; --borde: #9FBFAC;
  --reticula: rgba(20, 90, 50, .06);
  --tinta: #0A1C12; --tinta-suave: #2F4A3B; --tenue: #4F6F5D;
  --fosforo: #087A3B; --fosforo-2: #0E7F43; --musgo: #CFE3D6; --menta: #075C2C;
  --sobre-fosforo: #FFFFFF; --borde-lima: #8DB300;
  --alerta: #C9301F; --ambar: #8F5A00; --c-vigia: #2F6B10;
  --r1: #CFE6D7; --r2: #9ED1B2; --r3: #5DB081; --r4: #23854F; --r5: #075C2C;
  --mapa-sin: #DDE9E1;
  --lupa-aro: #0A3F22; --lupa-vidrio: rgba(8, 122, 59, .07); --rotulo: rgba(255, 255, 255, .95);
  --logo-tinta: #0A1C12; --logo-aro: #2F6B10; --logo-nodo: #0A1C12; --ojo: #2F6B10;
  --cabecera-fondo: rgba(237, 244, 239, .88); --consola-fondo: var(--panel);
  --halo: 0 0 0 transparent; --halo-alerta: 0 0 0 transparent; --halo-lima: 0 0 0 transparent; --halo-sel: 0 0 0 transparent;
  --halo-filtro: drop-shadow(0 0 0 transparent); --halo-lupa: drop-shadow(0 0 0 transparent);
  --luz: 0px;
  --mezcla: multiply;
  --barrido: conic-gradient(from 0deg, transparent 0deg 285deg, rgba(8, 122, 59, .03) 285deg, rgba(8, 122, 59, .14) 356deg, rgba(7, 92, 44, .45) 359.5deg, transparent 360deg);
  --tubo: rgba(0, 40, 20, .035);
  --px-marca: #2F6B10; --px-pelo: #34261E; --px-bata: #FAFBFB;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; scroll-behavior: smooth; scroll-padding-top: 5rem; scrollbar-color: var(--borde) var(--fondo); -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; background: var(--fondo); }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
body {
  margin: 0; color: var(--tinta); caret-color: var(--fosforo);
  font: 400 var(--t-body)/1.6 var(--f-texto);
  /* La cuadrícula de un visor. */
  background: linear-gradient(var(--reticula) 1px, transparent 1px) 0 0 / 48px 48px, linear-gradient(90deg, var(--reticula) 1px, transparent 1px) 0 0 / 48px 48px, var(--fondo);
}
::selection { background: var(--fosforo); color: var(--sobre-fosforo); }
a { color: inherit; text-underline-offset: .22em; text-decoration-thickness: 1px; }
:focus-visible { outline: 2px solid var(--fosforo); outline-offset: 3px; }
.sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.saltar { position: absolute; left: 1rem; top: -4rem; z-index: 20; background: var(--lima); color: var(--sobre-lima); padding: .6rem 1rem; font-weight: 600; }
.saltar:focus { top: 1rem; }
.marco {
  max-width: 80rem; margin-inline: auto;
  padding-left: max(1.25rem, env(safe-area-inset-left, 0px)); padding-right: max(1.25rem, env(safe-area-inset-right, 0px));
}
h1, h2, h3 { margin: 0; text-wrap: balance; }
h2 { font: 700 var(--t-title)/1.2 var(--f-texto); font-stretch: 115%; letter-spacing: -0.01em; max-width: 34ch; }
h3 { font: 700 var(--t-heading)/1.3 var(--f-texto); font-stretch: 108%; }
p { text-wrap: pretty; }
/* El número de cada sección, el mismo del índice de la cabecera. */
.sec-num { display: inline-block; margin-right: .75rem; padding: .3rem .45rem .28rem; font: 600 .8125rem/1 var(--f-mono); letter-spacing: .02em; color: var(--sobre-fosforo); background: var(--fosforo); box-shadow: var(--halo); vertical-align: .3em; }
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
.enlace { color: var(--fosforo); font-weight: 600; text-decoration: underline; }
.enlace:hover { text-decoration-thickness: 2px; }
/* La luz de una institución o de un estado. */
.led { display: inline-block; width: .5rem; height: .5rem; border-radius: 50%; background: var(--c, var(--fosforo)); box-shadow: 0 0 var(--luz) var(--c, var(--fosforo)); flex: none; }
.m-tramite { --c: var(--c-tramite); } .m-penal { --c: var(--c-penal); } .m-procesos { --c: var(--c-procesos); } .m-vigia { --c: var(--c-vigia); }
.estado { display: inline-flex; align-items: center; gap: .45rem; margin: 0; font: 500 var(--t-mono)/1 var(--f-mono); letter-spacing: .06em; text-transform: uppercase; color: var(--c, var(--fosforo)); white-space: nowrap; }
.estado::before { content: ""; width: .45rem; height: .45rem; border-radius: 50%; background: currentColor; box-shadow: 0 0 var(--luz) currentColor; }
.estado.apagado { color: var(--tenue); }
.estado.apagado::before { background: transparent; box-shadow: inset 0 0 0 1px currentColor; }

/* Botones */
.boton {
  display: inline-flex; align-items: center; justify-content: center; gap: .5rem; min-height: 2.75rem; padding: .625rem 1.125rem;
  font: 600 .9375rem/1.2 var(--f-texto); text-decoration: none; border: 0;
}
.boton.lima { background: var(--lima); color: var(--sobre-lima); box-shadow: var(--halo-lima), inset 0 0 0 1px var(--borde-lima); }
.boton.lima:hover { filter: brightness(1.07); }
.boton.borde { color: var(--tinta); background: color-mix(in srgb, var(--fosforo) 4%, transparent); box-shadow: inset 0 0 0 1px var(--borde); }
.boton.borde:hover { color: var(--fosforo); box-shadow: inset 0 0 0 1px var(--fosforo); }
.boton.chico { min-height: 2.375rem; padding: .5rem .875rem; font-size: .875rem; }
.acciones { display: flex; flex-wrap: wrap; gap: .625rem; margin-top: 1.5rem; }

/* Cabecera: la marca, el índice de secciones (marca la que se está leyendo), día o noche y la entrada a Vigía; debajo, la
   regla de un instrumento */
.cabecera { position: sticky; top: 0; z-index: 10; background: var(--cabecera-fondo); -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); }
.cabecera::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 7px; pointer-events: none;
  background: linear-gradient(90deg, color-mix(in srgb, var(--fosforo) 50%, transparent) 1px, transparent 1px) 0 100% / 8px 3px repeat-x, linear-gradient(90deg, color-mix(in srgb, var(--fosforo) 80%, transparent) 1px, transparent 1px) 0 100% / 64px 7px repeat-x, linear-gradient(var(--linea), var(--linea)) 0 100% / 100% 1px no-repeat; }
.cabecera-fila { display: flex; align-items: center; justify-content: space-between; gap: 1rem 1.5rem; min-height: 3.75rem; }
.marca { display: block; padding-block: .5rem; }
.logo-cabecera { height: 1.875rem; }
.indice ol { display: flex; align-items: center; gap: .25rem 1.25rem; list-style: none; margin: 0; padding: 0; }
.indice a { display: inline-flex; align-items: baseline; gap: .375rem; padding-block: .375rem; border-bottom: 2px solid transparent; font-weight: 500; font-size: var(--t-small); color: var(--tinta-suave); text-decoration: none; white-space: nowrap; }
.indice .nav-num { font: 500 .6875rem/1 var(--f-mono); color: var(--tenue); }
.indice a:hover { color: var(--fosforo); }
.indice a[aria-current="true"] { color: var(--tinta); border-bottom-color: var(--fosforo); }
.indice a[aria-current="true"] .nav-num { color: var(--fosforo); }
.cabecera-acciones { display: flex; align-items: center; gap: .625rem; }
.cabecera-acciones .boton { white-space: nowrap; }
/* Día o noche: un interruptor de dos posiciones, como el de un instrumento. */
.modo { display: inline-flex; border: 1px solid var(--borde); background: var(--panel); }
.modo[hidden] { display: none; }
.modo button { display: inline-flex; align-items: center; gap: .4rem; min-height: 2.25rem; padding: .3rem .65rem; border: 0; font: 600 .6875rem/1 var(--f-mono); letter-spacing: .06em; text-transform: uppercase; color: var(--tenue); background: transparent; cursor: pointer; }
.modo button + button { border-left: 1px solid var(--borde); }
.modo button:hover { color: var(--fosforo); }
.modo button[aria-pressed="true"] { color: var(--sobre-fosforo); background: var(--fosforo); }
.modo .px { width: .875rem; height: .875rem; }

/* Paneles: el bisel de un instrumento, con escuadras de fósforo en las esquinas */
.panel { position: relative; min-width: 0; background: linear-gradient(180deg, var(--panel), var(--fondo-2)); border: 1px solid var(--linea); }
.panel::before {
  content: ""; position: absolute; inset: -1px; pointer-events: none;
  background:
    linear-gradient(var(--fosforo-2), var(--fosforo-2)) 0 0 / 14px 1px, linear-gradient(var(--fosforo-2), var(--fosforo-2)) 0 0 / 1px 14px,
    linear-gradient(var(--fosforo-2), var(--fosforo-2)) 100% 0 / 14px 1px, linear-gradient(var(--fosforo-2), var(--fosforo-2)) 100% 0 / 1px 14px,
    linear-gradient(var(--fosforo-2), var(--fosforo-2)) 0 100% / 14px 1px, linear-gradient(var(--fosforo-2), var(--fosforo-2)) 0 100% / 1px 14px,
    linear-gradient(var(--fosforo-2), var(--fosforo-2)) 100% 100% / 14px 1px, linear-gradient(var(--fosforo-2), var(--fosforo-2)) 100% 100% / 1px 14px;
  background-repeat: no-repeat;
}

/* Portada. Teléfono: el texto, el instrumento y la consola, uno debajo del otro. Desde 48rem: el texto y la consola arriba,
   el instrumento entero debajo. Desde 80rem: el texto arriba y la consola abajo a la izquierda (al ras del instrumento),
   y el instrumento a la derecha. */
.portada { position: relative; background: radial-gradient(55% 60% at 64% 36%, color-mix(in srgb, var(--fosforo) 8.5%, transparent), transparent 72%); border-bottom: 1px solid var(--linea); }
.portada-grilla { display: grid; grid-template-columns: minmax(0, 1fr); grid-template-areas: "texto" "instrumento" "consola"; gap: 1.5rem; align-items: start; padding-block: 1.75rem 2.25rem; }
.portada-texto { grid-area: texto; }
.instrumento { grid-area: instrumento; }
.consola { grid-area: consola; }
.portada h1 { margin: 0; line-height: 0; }
.logo-portada { height: clamp(3rem, 2rem + 3vw, 4.75rem); }
.eslogan { margin: 1rem 0 0; font: 800 var(--t-display)/1.18 var(--f-led); color: var(--menta); text-shadow: var(--halo); text-wrap: balance; }
.entrada { margin: .875rem 0 0; max-width: 44ch; color: var(--tinta-suave); }

/* La consola */
.consola { border: 1px solid var(--borde); background: var(--consola-fondo); font: 400 .8125rem/1.65 var(--f-mono); }
.consola-barra { display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin: 0; padding: .45rem .75rem; border-bottom: 1px solid var(--linea); color: var(--tenue); font-size: .6875rem; letter-spacing: .03em; }
.consola-barra .estado { font-size: .625rem; }
.consola-lineas { list-style: none; margin: 0; padding: .625rem .875rem .75rem; height: calc(10 * 1.65em + 1.375rem); overflow: hidden; display: flex; flex-direction: column; justify-content: flex-end; -webkit-mask-image: linear-gradient(transparent, #000 3.5em); mask-image: linear-gradient(transparent, #000 3.5em); }
.consola li { flex: none; min-height: 1.65em; overflow-wrap: anywhere; }
.consola .cmd { color: var(--tinta); }
.consola .cmd::before { content: "gobserva ›"; margin-right: .6em; color: var(--fosforo); }
.consola .res { padding-left: 1.4em; color: var(--fosforo-2); }
.consola .res.alerta { color: var(--alerta); }
.consola .escribiendo::after { content: "_"; margin-left: .1em; color: var(--fosforo); font-weight: 700; }
@media (prefers-reduced-motion: no-preference) { .consola .escribiendo::after { animation: titila 1s steps(1) infinite; } }

/* El instrumento: un solo marco con los canales arriba, el visor del radar y la lectura de la región. Se acomoda a su
   propio ancho: angosto (teléfono), la lectura va debajo del visor; desde 42rem, al lado. */
.instrumento { display: grid; gap: .625rem; padding: .625rem; container-type: inline-size; }
.instrumento-cuerpo { display: grid; gap: .625rem; }
.metricas { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .5rem; width: 100%; margin: 0; padding: 0; border: 0; min-width: 0; }
.metrica { position: relative; display: grid; align-content: start; gap: .1rem; padding: .5rem .65rem .55rem; cursor: pointer; background: var(--fondo-2); border: 1px solid var(--linea); }
.metrica:hover { border-color: var(--borde); }
.metrica:has(input:checked) { border-color: var(--fosforo); background: linear-gradient(180deg, color-mix(in srgb, var(--fosforo) 11%, transparent), color-mix(in srgb, var(--fosforo) 2%, transparent)); box-shadow: var(--halo-sel); }
.metrica:has(input:focus-visible) { outline: 2px solid var(--fosforo); outline-offset: 2px; }
.metrica input { position: absolute; opacity: 0; inset: 0; margin: 0; cursor: pointer; }
.metrica-nombre { display: flex; align-items: center; gap: .45rem; font-weight: 600; font-size: var(--t-small); }
.metrica-cifra { font: 800 1.375rem/1.15 var(--f-led); color: var(--fosforo); text-shadow: var(--halo); font-variant-numeric: tabular-nums; }
.metrica-pie { font-size: .6875rem; line-height: 1.3; color: var(--tenue); }

/* El visor del radar */
.visor { position: relative; display: flex; flex-direction: column; min-width: 0; border: 1px solid var(--linea); background: radial-gradient(closest-side, color-mix(in srgb, var(--fosforo) 7%, transparent), transparent), var(--fondo-2); }
.visor::before {
  content: ""; position: absolute; inset: -1px; z-index: 3; pointer-events: none;
  background:
    linear-gradient(var(--fosforo), var(--fosforo)) 0 0 / 18px 2px, linear-gradient(var(--fosforo), var(--fosforo)) 0 0 / 2px 18px,
    linear-gradient(var(--fosforo), var(--fosforo)) 100% 0 / 18px 2px, linear-gradient(var(--fosforo), var(--fosforo)) 100% 0 / 2px 18px,
    linear-gradient(var(--fosforo), var(--fosforo)) 0 100% / 18px 2px, linear-gradient(var(--fosforo), var(--fosforo)) 0 100% / 2px 18px,
    linear-gradient(var(--fosforo), var(--fosforo)) 100% 100% / 18px 2px, linear-gradient(var(--fosforo), var(--fosforo)) 100% 100% / 2px 18px;
  background-repeat: no-repeat;
}
/* Las líneas de barrido de un tubo de fósforo, sobre el mapa y bajo los rótulos. */
.visor::after { content: ""; position: absolute; inset: 0; z-index: 2; pointer-events: none; background: repeating-linear-gradient(0deg, var(--tubo) 0 1px, transparent 1px 3px); }
.mapa { position: relative; flex: none; width: 100%; max-width: min(30rem, 100%); margin-inline: auto; aspect-ratio: 58 / 85; touch-action: manipulation; }
.mapa canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.con-mapa .mapa:not(.tactil) { cursor: none; }
.mapa:focus-visible { outline-offset: -3px; }
.sin-js { position: absolute; inset: auto 1rem 40% 1rem; margin: 0; text-align: center; color: var(--tenue); }
/* El radar se suma a la luz del mapa: de noche, el barrido aclara los puntos que pasa (screen), como el fósforo; de día
   los oscurece (multiply), como tinta. */
.radar { position: absolute; inset: 0; overflow: hidden; pointer-events: none; mix-blend-mode: var(--mezcla); }
.radar-reticula { position: absolute; inset: 0; width: 100%; height: 100%; }
.radar-reticula circle, .radar-reticula path { fill: none; stroke: var(--fosforo); stroke-opacity: .16; stroke-width: 1; vector-effect: non-scaling-stroke; }
.radar-reticula .rumbo { stroke-opacity: .34; stroke-width: 2.6; vector-effect: none; }
.radar-reticula .rumbo.mayor { stroke-opacity: .6; stroke-width: 5.5; }
.radar-reticula text { fill: var(--fosforo); fill-opacity: .75; font: 700 6px var(--f-mono); text-anchor: middle; dominant-baseline: middle; }
.radar-barrido { position: absolute; left: 50%; top: 50%; width: 190%; aspect-ratio: 1; translate: -50% -50%; border-radius: 50%; opacity: 0; background: var(--barrido); }
.blip { position: absolute; left: 0; top: 0; width: 9px; height: 9px; margin: -4.5px 0 0 -4.5px; border-radius: 50%; background: var(--alerta); box-shadow: 0 0 var(--luz) calc(var(--luz) / 4) color-mix(in srgb, var(--alerta) 70%, transparent); translate: var(--x) var(--y); }
.blip::after { content: ""; position: absolute; inset: -7px; border: 1px solid var(--alerta); border-radius: 50%; opacity: 0; }
.lupa-rotulos { position: absolute; left: 0; top: 0; z-index: 3; display: grid; justify-items: start; gap: .25rem; max-width: 15rem; pointer-events: none; transition: opacity .15s; }
.lupa-rotulos p { margin: 0; background: var(--rotulo); border: 1px solid var(--borde); }
.lupa-region { padding: .25rem .5rem; font: 700 .8125rem/1.3 var(--f-mono); color: var(--fosforo); text-transform: uppercase; letter-spacing: .05em; }
.lupa-dato { padding: .3rem .5rem; color: var(--tinta-suave); font-size: .75rem; line-height: 1.3; }
.lupa-dato b { display: block; color: var(--tinta); font: 800 1.0625rem/1.25 var(--f-led); font-variant-numeric: tabular-nums; white-space: nowrap; }
.sobre-mar .lupa-rotulos, .lupa-rotulos:not(:has(.lupa-region:not(:empty))) { opacity: 0; }
@media (prefers-reduced-motion: no-preference) {
  .lupa-rotulos.entra > * { animation: aparece .24s steps(4, end) backwards; }
  .lupa-rotulos.entra > :nth-child(2) { animation-delay: .05s; }
  .lupa-rotulos.entra > :nth-child(3) { animation-delay: .1s; }
}
@keyframes aparece { from { opacity: 0; transform: translateX(-6px); } }
.visor-coords { display: grid; grid-auto-flow: column; justify-content: end; gap: .5rem; margin: 0; padding: .375rem .75rem 0; font: 500 .6875rem/1.2 var(--f-mono); color: var(--fosforo); letter-spacing: .04em; font-variant-numeric: tabular-nums; pointer-events: none; }
.visor-coords span:first-child { color: var(--tenue); }
.pausa { position: absolute; right: .5rem; top: .5rem; z-index: 4; display: none; align-items: center; gap: .45rem; min-height: 2rem; padding: .3rem .6rem; font: 500 .6875rem/1 var(--f-mono); color: var(--tinta-suave); background: var(--rotulo); border: 1px solid var(--borde); cursor: pointer; }
.anima .pausa { display: inline-flex; }
.pausa:hover, .pausa[aria-pressed="true"] { color: var(--fosforo); border-color: var(--fosforo); }
.pausa i { width: .5rem; height: .625rem; border-inline: 2px solid currentColor; }
.pausa[aria-pressed="true"] i { width: 0; height: 0; border-inline: .5rem solid currentColor; border-inline-end: 0; border-block: .3125rem solid transparent; }
.pista { margin: 0; padding: .5rem .75rem 0; color: var(--tenue); font: 400 .6875rem/1.4 var(--f-mono); text-align: center; }
.pista-toque { display: none; }
@media (hover: none), (pointer: coarse) { .pista-mouse { display: none; } .pista-toque { display: inline; } }
.mapa-pie { display: grid; justify-items: center; gap: .375rem; padding: .5rem .75rem .75rem; text-align: center; }
.leyenda { display: grid; justify-items: center; gap: .3rem; max-width: 30rem; }
.leyenda p { margin: 0; color: var(--tenue); font-size: .6875rem; line-height: 1.4; text-wrap: balance; }
.leyenda-escala { display: flex; align-items: center; gap: .5rem; font: 800 .875rem var(--f-led); color: var(--tinta-suave); font-variant-numeric: tabular-nums; }
.leyenda-tonos { display: flex; gap: 2px; }
.leyenda-tonos i { width: .75rem; height: .75rem; background: var(--r1); }
.leyenda-tonos i:nth-child(2) { background: var(--r2); }
.leyenda-tonos i:nth-child(3) { background: var(--r3); }
.leyenda-tonos i:nth-child(4) { background: var(--r4); }
.leyenda-tonos i:nth-child(5) { background: var(--r5); }
.leyenda .leyenda-blips { display: inline-flex; align-items: center; gap: .45rem; }
.leyenda-blips i { width: .5rem; height: .5rem; border-radius: 50%; background: var(--alerta); box-shadow: 0 0 var(--luz) var(--alerta); }

/* La lectura de la región: la otra pantalla del instrumento */
.ficha { container-type: inline-size; min-width: 0; padding: .875rem 1rem .25rem; border: 1px solid var(--linea); background: var(--fondo-2); }
.ficha-cabeza { display: grid; justify-items: start; gap: .3rem; padding-bottom: .75rem; font-size: var(--t-small); }
.ficha select {
  font: 700 1.25rem/1.25 var(--f-texto); font-stretch: 112%; color: var(--tinta); background-color: transparent;
  border: 0; border-bottom: 2px dashed var(--borde); border-radius: 0; padding: 0 1.5rem .05rem 0; max-width: 100%;
  -webkit-appearance: none; appearance: none; cursor: pointer;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12' shape-rendering='crispEdges' fill='%2327C76B'%3E%3Cpath d='M2 4h8v2H8v2H6v2H6V8H4V6H2z'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right center; background-size: .75rem;
}
.ficha select:hover { border-bottom-color: var(--fosforo); }
.ficha select option { background: var(--panel); color: var(--tinta); font: 500 1rem var(--f-texto); }
.ficha-grupos { display: grid; }
@container (min-width: 40rem) { .ficha-grupos { grid-template-columns: repeat(3, minmax(0, 1fr)); column-gap: 1.5rem; } }
.ficha-grupo { padding-block: .55rem; border-top: 1px dashed var(--linea); }
.ficha-fuente { display: flex; flex-wrap: wrap; gap: .1rem .5rem; align-items: center; margin: 0 0 .3rem; font: 600 .6875rem/1.4 var(--f-mono); letter-spacing: .02em; }
.ficha-fuente span { font-weight: 400; color: var(--tenue); }
.ficha-fila { display: grid; grid-template-columns: 4.75rem minmax(0, 1fr); gap: .625rem; align-items: baseline; margin: .0625rem 0; font-size: var(--t-caption); line-height: 1.4; }
.ficha-fila b { font: 800 1.0625rem/1.35 var(--f-led); color: var(--fosforo); text-align: right; font-variant-numeric: tabular-nums; }
.ficha-fila span { color: var(--tinta-suave); }
.ficha-fila i { font-style: normal; color: var(--tinta); font-weight: 600; white-space: nowrap; }
.ficha-nota, .ficha-vacia { margin: 0; padding-block: .5rem .625rem; border-top: 1px dashed var(--linea); color: var(--tenue); font-size: .75rem; line-height: 1.45; }

/* El instrumento ancho: el visor y la lectura lado a lado, a la misma altura; la pista, la leyenda y las coordenadas van
   sobre el visor (en el mar y en las esquinas vacías del mapa). */
@container (min-width: 42rem) {
  .instrumento-cuerpo { grid-template-columns: minmax(0, 1.3fr) minmax(16rem, 1fr); }
  .mapa { flex: 1 1 auto; max-width: none; aspect-ratio: auto; min-height: clamp(24rem, calc(100svh - 18rem), 40rem); }
  .pista { position: absolute; left: .75rem; top: .625rem; z-index: 3; max-width: 11rem; padding: 0; text-align: left; pointer-events: none; }
  .mapa-pie { position: absolute; left: .75rem; bottom: .625rem; z-index: 3; justify-items: start; padding: 0; text-align: left; max-width: 12.5rem; pointer-events: none; }
  .leyenda { justify-items: start; }
  .visor-coords { position: absolute; right: .75rem; bottom: .625rem; z-index: 3; grid-auto-flow: row; justify-items: end; gap: .2rem; padding: 0; }
}

/* La cinta de cifras */
.cinta { display: flex; overflow: hidden; border-bottom: 1px solid var(--linea); background: var(--fondo-2); font: 500 .8125rem/1.2 var(--f-mono); color: var(--tinta-suave); }
.cinta-fila { display: flex; flex: none; gap: 2.75rem; margin: 0; padding: .8rem 1.375rem; list-style: none; white-space: nowrap; }
.cinta-fila li { display: flex; align-items: baseline; gap: .5rem; }
.cinta-fila li::before { content: ""; align-self: center; width: .375rem; height: .375rem; background: var(--fosforo); box-shadow: 0 0 calc(var(--luz) * .75) var(--fosforo); }
.cinta b { font: 800 1rem/1 var(--f-led); color: var(--fosforo); font-variant-numeric: tabular-nums; }
.cinta span { color: var(--tenue); }
html:not(.anima) .cinta-fila { flex: 1 1 100%; min-width: 0; flex-wrap: wrap; white-space: normal; gap: .5rem 2rem; }
html:not(.anima) .cinta-fila + .cinta-fila { display: none; }

/* Secciones: todas con el mismo encabezado (número, título y una línea que dice de qué se trata) */
.seccion { padding-block: clamp(3.5rem, 7vw, 5.5rem) 0; }
.intro { margin: .75rem 0 0; color: var(--tinta-suave); max-width: 62ch; }

/* 01: los cuatro paneles. Arriba la pérdida y los procesos por año; debajo, la aguja y las regiones, a lo ancho. */
.tablero { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 1rem; margin-top: 2rem; }
.tablero > .panel { display: flex; flex-direction: column; padding: 1.25rem 1.375rem 1.125rem; }
.p-perdida { grid-column: span 7; }
.p-anios { grid-column: span 5; }
.p-aguja, .p-donde { grid-column: 1 / -1; }
.tablero:not(:has(.p-anios)) > .panel { grid-column: 1 / -1; }
.panel-cabeza { display: flex; align-items: center; justify-content: space-between; gap: .5rem 1rem; padding-bottom: .875rem; margin-bottom: 1.125rem; border-bottom: 1px dashed var(--linea); }
.panel-cabeza h3 { font-size: 1.125rem; }
.panel-fuente { display: inline-flex; align-items: center; gap: .45rem; flex: none; font: 500 var(--t-mono)/1 var(--f-mono); letter-spacing: .04em; color: var(--tenue); white-space: nowrap; }
.panel-pie { margin: auto 0 0; padding-top: 1rem; color: var(--tenue); font-size: var(--t-caption); }

.perdida { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 1.5rem 2.25rem; align-items: center; }
.waffle-fig { margin: 0; }
.waffle { display: grid; grid-template-columns: repeat(10, 1fr); gap: 3px; width: clamp(10rem, 15vw, 13rem); }
.waffle i { aspect-ratio: 1; background: var(--musgo); }
.waffle i.on { background: var(--alerta); box-shadow: 0 0 var(--luz) color-mix(in srgb, var(--alerta) 55%, transparent); }
.waffle-fig figcaption { margin-top: .625rem; max-width: 13rem; color: var(--tenue); font: 400 .6875rem/1.45 var(--f-mono); }
.cifras-grandes { display: grid; gap: 1.25rem; }
.cifra-grande { margin: 0; display: grid; gap: .25rem; }
.cifra-grande b { font: 800 clamp(1.625rem, 1.2rem + 1.3vw, 2.25rem)/1.1 var(--f-led); color: var(--alerta); text-shadow: var(--halo-alerta); font-variant-numeric: tabular-nums; }
.cifra-grande > span { color: var(--tinta-suave); font-size: .9375rem; max-width: 42ch; }

.tablero > .p-anios { display: grid; grid-template-rows: auto minmax(12rem, 1fr) auto; }
.anios { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); grid-template-rows: 100%; gap: .3rem; min-height: 12rem; filter: var(--halo-filtro); }
.anios li { position: relative; display: flex; flex-direction: column; justify-content: flex-end; text-align: center; min-width: 0; }
.valor-v { font: 800 .75rem/1.2 var(--f-led); color: var(--tinta-suave); margin-bottom: .25rem; }
.barra-v { display: block; height: calc(var(--v) * 80%); background: repeating-linear-gradient(0deg, var(--fosforo) 0 5px, transparent 5px 7px); transform-origin: bottom; }
.anio { margin-top: .4rem; font: 500 .6875rem/1 var(--f-mono); color: var(--tenue); }

.mil-fig { margin: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(12rem, 15rem); gap: 1.25rem 2rem; align-items: center; }
.mil { --cols: 100; display: grid; grid-template-columns: repeat(var(--cols), 1fr); gap: 2px; }
.mil i { aspect-ratio: 1; background: color-mix(in srgb, var(--fosforo) 10%, transparent); }
.mil i.leido { background: var(--fosforo); box-shadow: 0 0 calc(var(--luz) * .75) var(--fosforo); }
.mil i.alto { background: var(--alerta); box-shadow: 0 0 calc(var(--luz) * .75) var(--alerta); }
.mil-datos { display: grid; gap: .4rem; font-size: var(--t-small); color: var(--tinta-suave); }
.mil-dato { display: flex; align-items: baseline; flex-wrap: wrap; gap: .1rem .5rem; }
.mil-dato b { font: 800 1.375rem/1.15 var(--f-led); color: var(--tinta); font-variant-numeric: tabular-nums; }
.mil-dato.m-procesos b { color: var(--fosforo); }
.mil-dato.m-tramite b { color: var(--alerta); }
.mil-dato .led { align-self: center; }

.ranking-leyenda { display: flex; flex-wrap: wrap; gap: .5rem 1.25rem; margin: 0 0 .875rem; font-size: var(--t-caption); color: var(--tinta-suave); }
.ranking-leyenda span { display: inline-flex; align-items: center; gap: .4rem; }
.ranking-leyenda i { width: .625rem; height: .625rem; background: color-mix(in srgb, var(--fosforo) 55%, transparent); }
.ranking-leyenda i.firme { background: var(--alerta); }
/* Una sola grilla para las diez filas (subgrid): la columna de las cifras toma el ancho de la más larga y todas las barras
   miden sobre la misma pista, así se comparan entre sí. */
.ranking { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 7.5rem minmax(0, 1fr) max-content; gap: .5rem .875rem; }
.ranking li { grid-column: 1 / -1; display: grid; grid-template-columns: 7.5rem minmax(0, 1fr) 15.5rem; grid-template-columns: subgrid; row-gap: .25rem; align-items: center; }
.ranking-nombre { font-weight: 600; font-size: var(--t-small); text-decoration: none; }
.ranking-nombre:hover { color: var(--fosforo); text-decoration: underline; }
.pista-barra { display: block; height: 1.125rem; }
.barra-h { position: relative; display: block; height: 100%; width: calc(var(--v) * 100%); transform-origin: left; background: repeating-linear-gradient(90deg, color-mix(in srgb, var(--fosforo) 55%, transparent) 0 6px, transparent 6px 8px); }
.barra-h .firme { position: absolute; inset: 0 auto 0 0; width: calc(var(--f) * 100%); background: repeating-linear-gradient(90deg, var(--alerta) 0 6px, transparent 6px 8px); }
.ranking-cifra { display: flex; align-items: baseline; gap: .5rem; font-size: var(--t-caption); color: var(--tenue); white-space: nowrap; }
.ranking-cifra b { font: 800 1.0625rem/1.2 var(--f-led); color: var(--fosforo); font-variant-numeric: tabular-nums; }

.tabla-regiones { margin-top: 1rem; padding-top: .875rem; border-top: 1px dashed var(--linea); }
.tabla-regiones summary { cursor: pointer; width: fit-content; color: var(--fosforo); font: 600 var(--t-small) var(--f-mono); text-decoration: underline; text-underline-offset: .22em; }
.tabla-caja { overflow-x: auto; margin-top: .875rem; background: var(--fondo-2); border: 1px solid var(--linea); }
.tabla-caja table { width: 100%; border-collapse: collapse; font-size: var(--t-small); }
.tabla-caja caption { caption-side: bottom; text-align: left; padding: .625rem 1rem; color: var(--tenue); font-size: .75rem; }
.tabla-caja th, .tabla-caja td { padding: .4rem 1rem; border-bottom: 1px dashed var(--linea); text-align: right; white-space: nowrap; }
.tabla-caja thead th { font: 600 .6875rem/1.35 var(--f-mono); color: var(--tinta-suave); white-space: normal; vertical-align: bottom; }
.tabla-caja th[scope="row"], .tabla-caja thead th:first-child { text-align: left; }
.tabla-caja td { font: 800 .9375rem var(--f-led); color: var(--fosforo); font-variant-numeric: tabular-nums; }

/* 02: la cadena. Cuatro etapas parejas sobre un mismo riel; los paquetes corren por el riel entre una y otra. */
.cadena { position: relative; list-style: none; margin: 2.25rem 0 0; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1.5rem; align-items: stretch; }
.cadena::before { content: ""; position: absolute; left: 0; right: 0; top: 2rem; height: 4px; translate: 0 -50%; background: radial-gradient(circle, var(--fosforo) 1.5px, transparent 2px) 0 50% / 10px 4px repeat-x; }
.etapa { position: relative; display: flex; flex-direction: column; gap: .875rem; padding: 1.125rem 1.25rem 1.25rem; }
.etapa-cabeza { display: flex; align-items: center; gap: .625rem; }
.etapa-cabeza h3 { font-size: 1.125rem; }
.etapa-cabeza .px { margin-left: auto; width: 1.5rem; height: 1.5rem; color: var(--fosforo); }
.etapa-num { display: inline-flex; align-items: center; justify-content: center; width: 1.75rem; height: 1.75rem; flex: none; font: 600 .75rem/1 var(--f-mono); color: var(--fosforo); border: 1px solid var(--fosforo); background: var(--panel); box-shadow: var(--halo); }
.etapa p { margin: 0; color: var(--tinta-suave); font-size: .9375rem; }
.etapa .enlace { margin-top: auto; font-size: var(--t-small); }
.etapa-lupa { display: grid; place-items: center; margin-top: auto; padding-top: .25rem; }
.lupa-grande { width: 5.5rem; height: 5.5rem; display: block; filter: var(--halo-lupa); }
.lupa-grande .gl-aro { fill: none; stroke: var(--logo-aro); }
.lupa-grande .gl-arista { fill: none; stroke: var(--logo-nodo); }
.lupa-grande .gl-nodo { fill: var(--logo-nodo); }
.chips { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: .375rem; }
.chip { padding: .3rem .5rem; font: 500 .75rem/1.2 var(--f-mono); color: var(--tinta); background: color-mix(in srgb, var(--fosforo) 5%, transparent); border: 1px solid var(--linea); }
.senales { list-style: none; margin: 0; padding: 0; display: grid; gap: .375rem; }
.senal { display: flex; align-items: center; gap: .55rem; padding: .4rem .55rem; font-size: .8125rem; line-height: 1.35; background: color-mix(in srgb, var(--alerta) 8%, transparent); border: 1px solid color-mix(in srgb, var(--alerta) 30%, transparent); }
.senal .px { width: 1rem; height: 1rem; color: var(--alerta); }

/* 03: para quién, una ficha técnica de tres filas */
.publicos { list-style: none; margin: 2rem 0 0; padding: 0; border-top: 1px solid var(--linea); }
.publico { display: grid; grid-template-columns: 2.75rem minmax(0, 19rem) minmax(0, 1fr); gap: .75rem 2rem; align-items: start; padding-block: 1.25rem; border-bottom: 1px solid var(--linea); }
.publico .px { width: 2.25rem; height: 2.25rem; color: var(--fosforo); }
.publico h3 { font-size: 1.125rem; margin-bottom: .3rem; }
.publico .valor { margin: 0; color: var(--tinta-suave); font-size: .9375rem; }
.publico ul { list-style: none; margin: 0; padding: 0; display: grid; gap: .4rem; font-size: .9375rem; }
.publico ul li { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: .55rem; align-items: baseline; }
.publico ul li::before { content: "›"; color: var(--fosforo); font: 700 1rem/1 var(--f-mono); }

/* 04: los monitores. Vigía en línea y los que vienen, de borde punteado mientras se arman. */
.monitores { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 1rem; margin-top: 2rem; align-items: stretch; }
.monitor-vigia { display: grid; gap: 1rem; align-content: start; padding: clamp(1.25rem, 2.5vw, 1.75rem); background: radial-gradient(80% 60% at 0% 0%, color-mix(in srgb, var(--c-vigia) 8%, transparent), transparent 60%), linear-gradient(180deg, var(--panel), var(--fondo-2)); }
.vigia-cabeza { display: flex; flex-wrap: wrap; align-items: center; gap: .75rem 1.25rem; }
.vigia-cabeza .ojo { width: 5.5rem; display: block; }
.ojo-parpado { fill: var(--ojo); }
.ojo-pupila { fill: var(--tinta); }
.vigia-cabeza h3 { font-size: 1.5rem; font-stretch: 115%; }
.vigia-dominio { margin: .2rem 0 0; color: var(--tenue); font: 400 var(--t-mono) var(--f-mono); }
.vigia-lema { margin: 0; font-size: 1.0625rem; color: var(--tinta); }
.monitor-vigia > p:not(.vigia-lema) { margin: 0; color: var(--tinta-suave); font-size: .9375rem; }
.monitor-vigia .acciones { margin-top: .25rem; }
.funciones { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 1.5rem; }
.funciones a { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: .6rem; align-items: baseline; padding: .55rem 0; border-bottom: 1px dashed var(--linea); text-decoration: none; font-size: .9375rem; }
.funciones .led { transform: translateY(-.1rem); }
.funciones strong { font-weight: 600; }
.funciones .d { display: block; color: var(--tenue); font-size: .8125rem; line-height: 1.4; }
.funciones a:hover strong { color: var(--fosforo); text-decoration: underline; }
.proximos { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
.productos-gob { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; margin-top: 1rem; }
/* La gente de cada producto, parada sobre su suelo de cuadros. */
.monitor-producto { display: flex; flex-direction: column; }
.monitor-producto .escena-producto { margin-top: auto; }
.escena-producto { display: flex; align-items: flex-end; justify-content: space-between; gap: .75rem; padding: .25rem .5rem 0; border-bottom: 5px dashed color-mix(in srgb, var(--tinta) 25%, transparent); min-height: 6.5rem; }
.escena-producto .px-sprite { display: block; flex: none; }
.escena-producto .px-lugar { max-width: 62%; height: auto; }
@keyframes pxParpadeo { 0%, 94%, 100% { opacity: 1; } 95%, 98% { opacity: 0; } }
@keyframes pxLate { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }
@keyframes pxAlternaA { 0%, 49.9% { opacity: 1; } 50%, 100% { opacity: 0; } }
@keyframes pxAlternaB { 0%, 49.9% { opacity: 0; } 50%, 100% { opacity: 1; } }
.px-alternaB { opacity: 0; }
@media (prefers-reduced-motion: no-preference) {
  .px-parpadeo { animation: pxParpadeo 4.8s steps(1, end) infinite; }
  .px-late { animation: pxLate 2.4s steps(3, end) infinite; }
  .px-alternaA { animation: pxAlternaA .6s steps(1, end) infinite; }
  .px-alternaB { animation: pxAlternaB .6s steps(1, end) infinite; }
}
.monitor-producto .vigia-cabeza svg { width: 3rem; height: 3rem; display: block; }
@media (max-width: 64rem) { .productos-gob { grid-template-columns: minmax(0, 1fr); } }
.proximos > li:last-child:nth-child(odd) { grid-column: 1 / -1; }
.proximo { display: flex; flex-direction: column; gap: .5rem; padding: 1rem 1.125rem; border: 1px dashed var(--borde); background: color-mix(in srgb, var(--fosforo) 2.5%, transparent); }
.proximo .px { width: 2rem; height: 2rem; color: var(--fosforo-2); }
.proximo h3 { font-size: 1rem; }
.proximo p { margin: 0; color: var(--tinta-suave); font-size: .875rem; line-height: 1.5; }
.proximo .ya { margin-top: auto; padding-top: .5rem; border-top: 1px dashed var(--linea); color: var(--tenue); font: 400 .75rem/1.45 var(--f-mono); }

/* 05: los principios, el protocolo, en una grilla de celdas */
.principios { list-style: none; margin: 2rem 0 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-top: 1px solid var(--linea); border-left: 1px solid var(--linea); }
.principios li { display: grid; grid-template-columns: auto minmax(0, 1fr); column-gap: .875rem; align-items: start; padding: 1.25rem 1.25rem 1.375rem; border-right: 1px solid var(--linea); border-bottom: 1px solid var(--linea); }
.principios .px { color: var(--fosforo); width: 1.5rem; height: 1.5rem; margin-top: .1rem; }
.principios h3 { margin-bottom: .3rem; }
.principios p { margin: 0; color: var(--tinta-suave); font-size: .9375rem; }
.principios .enlace { display: inline-block; margin-top: .4rem; font-size: var(--t-small); }

/* 06: las fuentes */
.fuentes { list-style: none; margin: 2rem 0 0; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 3rem; }
.fuentes li { display: grid; grid-template-columns: 8rem minmax(0, 1fr); gap: .25rem 1rem; padding-block: .8rem; border-top: 1px dashed var(--linea); font-size: .9375rem; }
.sigla { display: flex; align-items: center; gap: .55rem; font: 600 .875rem/1.5 var(--f-mono); color: var(--fosforo); }
.fuentes .que { margin: 0; }
.fuentes .nombre { margin: .125rem 0 0; color: var(--tenue); font-size: .8125rem; line-height: 1.45; }
.ver-mas { margin: 1.25rem 0 0; font-size: var(--t-small); }

/* Llamado y pie */
.llamado { margin-top: clamp(3.5rem, 7vw, 5.5rem); border-block: 1px solid var(--linea); background: radial-gradient(45% 140% at 88% 50%, color-mix(in srgb, var(--c-vigia) 9%, transparent), transparent 70%), var(--fondo-2); }
.llamado .marco { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1.25rem 2.5rem; padding-block: clamp(2.25rem, 5vw, 3.25rem); }
.llamado .intro { margin-top: .5rem; }
.pie .marco { display: grid; grid-template-columns: minmax(0, 1.5fr) repeat(2, minmax(0, 1fr)); gap: 2rem; padding-block: 2.25rem 2.5rem; }
.logo-pie { height: 2.125rem; }
.pie .pie-eslogan { font: 800 1.0625rem/1.3 var(--f-led); margin: .875rem 0 0; color: var(--menta); }
.pie p { margin: .375rem 0 0; color: var(--tenue); font-size: var(--t-small); }
.pie .pie-datos { font: 400 .6875rem/1.5 var(--f-mono); }
.pie h2 { font: 500 var(--t-mono)/1.2 var(--f-mono); letter-spacing: .06em; text-transform: uppercase; color: var(--tenue); margin: .25rem 0 .875rem; max-width: none; }
.pie ul { list-style: none; margin: 0; padding: 0; display: grid; gap: .5rem; font-size: var(--t-small); }
.pie a { text-decoration: none; }
.pie a:hover { color: var(--fosforo); text-decoration: underline; }

/* Las animaciones: sólo con JavaScript y sin movimiento reducido (la clase .anima la pone animaciones.js). */
/* El radar: gira mientras se ve; el visor se enciende al abrir la página. */
.anima .radar-barrido { opacity: 1; animation: gira var(--periodo) linear infinite; }
.anima .blip { opacity: .3; animation: blip var(--periodo) linear var(--retraso, 0s) infinite; }
.anima .blip::after { animation: onda var(--periodo) cubic-bezier(.2, .7, .3, 1) var(--retraso, 0s) infinite; }
.anima .mapa:not(.en-pantalla) .radar-barrido, .anima .mapa:not(.en-pantalla) .blip, .anima .mapa:not(.en-pantalla) .blip::after { animation-play-state: paused; }
@keyframes gira { from { rotate: 0deg; } to { rotate: 360deg; } }
@keyframes blip { 0%, 3% { opacity: 1; } 55% { opacity: .3; } 100% { opacity: .3; } }
@keyframes onda { 0% { opacity: .9; scale: .3; } 30% { opacity: 0; scale: 2.4; } 100% { opacity: 0; scale: 2.4; } }
.anima .visor { animation: enciende 1s steps(8) both; }
@keyframes enciende { 0% { opacity: 0; } 30% { opacity: .5; filter: brightness(1.8); } 60% { opacity: .35; } 100% { opacity: 1; filter: none; } }
/* La cinta corre sola y se detiene bajo el mouse. */
.anima .cinta-fila { animation: desliza 75s linear infinite; }
.anima .cinta:hover .cinta-fila { animation-play-state: paused; }
@keyframes desliza { to { translate: -100% 0; } }
/* Pausar detiene todo lo que se mueve (botón del radar). */
.pausado *, .pausado *::before, .pausado *::after { animation-play-state: paused !important; }
/* Cada panel se enciende con una línea que lo recorre de arriba abajo; lo de adentro se arma en escalones, como píxeles. */
.anima .panel[data-anima]::after { content: ""; position: absolute; inset: 0; pointer-events: none; opacity: 0; background: linear-gradient(180deg, transparent 0 45%, color-mix(in srgb, var(--fosforo) 10%, transparent) 48%, color-mix(in srgb, var(--menta) 45%, transparent) 50%, transparent 51%) 0 100% / 100% 220% no-repeat; }
.anima .panel.visible::after { animation: escanea 1.1s ease-out 1; }
@keyframes escanea { 0% { opacity: 1; background-position: 0 100%; } 90% { opacity: 1; } 100% { opacity: 0; background-position: 0 0; } }
.anima [data-anima]:not(.visible) .waffle i.on { background: var(--musgo); box-shadow: none; }
.anima .p-perdida .waffle i.on { transition: background-color 0s linear calc(250ms + var(--i) * 110ms), box-shadow 0s linear calc(250ms + var(--i) * 110ms); }
.anima .p-anios:not(.visible) .barra-v { transform: scaleY(0); }
.anima .p-anios .barra-v { transition: transform .9s steps(9) calc(var(--i) * 80ms); }
.anima .p-anios:not(.visible) .valor-v { opacity: 0; }
.anima .p-anios .valor-v { transition: opacity .2s steps(2) calc(.8s + var(--i) * 80ms); }
.anima .p-aguja:not(.visible) .mil { clip-path: inset(0 0 100% 0); }
.anima .p-aguja .mil { transition: clip-path 1.2s steps(20); }
.anima .p-aguja.visible .mil i.leido, .anima .p-aguja.visible .mil i.alto { animation: destella .5s steps(2) 1.4s 4; }
@keyframes destella { 50% { background: var(--tinta); } }
.anima .p-donde:not(.visible) .barra-h { transform: scaleX(0); }
.anima .p-donde .barra-h { transition: transform .8s steps(12) calc(var(--i) * 70ms); }
.anima .cadena:not(.visible) .senal { opacity: 0; transform: translateX(8px); }
.anima .cadena .senal { transition: opacity .3s steps(3) calc(.5s + var(--i) * 260ms), transform .3s steps(3) calc(.5s + var(--i) * 260ms); }
.anima .cadena.andando::before { animation: fluye .8s linear infinite; }
.anima .cadena.andando .lupa-grande .gl-nodo { animation: late 1.8s ease-in-out infinite; }
@keyframes fluye { to { background-position: 10px 50%; } }
@keyframes late { 50% { opacity: .3; } }
.anima .publicos:not(.visible) > li, .anima .proximos:not(.visible) > li { opacity: 0; transform: translateY(10px); }
.anima .publicos > li, .anima .proximos > li { transition: opacity .45s steps(5) calc(var(--i) * 120ms), transform .45s steps(5) calc(var(--i) * 120ms); }
.anima .monitor-vigia:not(.visible) .ojo circle { transform: scale(0); }
.anima .monitor-vigia .ojo circle { transform-box: fill-box; transform-origin: center; transition: transform .4s cubic-bezier(.22, 1, .36, 1) calc(var(--i) * 45ms); }
@media (prefers-reduced-motion: no-preference) {
  .boton, .funciones a, .metrica, .pausa, .modo button, .indice a { transition: filter .15s, background-color .15s, box-shadow .15s, color .15s, border-color .15s; }
}
/* El cambio de día a noche: un fundido corto de toda la página (View Transitions, donde el navegador lo tiene). */
::view-transition-old(root), ::view-transition-new(root) { animation-duration: .35s; }

/* La portada desde 48rem y desde 80rem (ver arriba) */
@media (min-width: 48rem) {
  .portada-grilla { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-template-areas: "texto consola" "instrumento instrumento"; gap: 1.75rem 2rem; }
  .consola { align-self: end; }
}
@media (min-width: 80rem) {
  .portada-grilla { grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); grid-template-rows: auto 1fr; grid-template-areas: "texto instrumento" "consola instrumento"; gap: 1.5rem 2.5rem; }
  .consola { align-self: stretch; display: flex; flex-direction: column; }
  .consola-lineas { flex: 1 1 auto; height: auto; min-height: calc(8 * 1.65em + 1.375rem); }
}
@media (max-width: 79.99rem) {
  .indice { display: none; }
}
@media (max-width: 63.99rem) {
  .tablero > .panel { grid-column: 1 / -1; grid-row: auto; }
  .mil { --cols: 50; }
  .cadena { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .cadena::before { display: none; }
  .monitores { grid-template-columns: minmax(0, 1fr); }
  .principios { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ranking { grid-template-columns: 6.5rem minmax(0, 1fr); }
  .ranking li { grid-template-columns: 6.5rem minmax(0, 1fr); grid-template-columns: subgrid; }
  .ranking-cifra { grid-column: 2; flex-wrap: wrap; white-space: normal; row-gap: 0; }
}
@media (max-width: 47.99rem) {
  .logo-cabecera { height: 1.75rem; }
  .modo span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .modo button { padding-inline: .55rem; }
  .perdida, .mil-fig { grid-template-columns: minmax(0, 1fr); }
  .cadena { grid-template-columns: minmax(0, 1fr); }
  .cadena::before { display: block; left: 2.125rem; right: auto; top: 0; bottom: 0; width: 4px; height: auto; translate: -50% 0; background: radial-gradient(circle, var(--fosforo) 1.5px, transparent 2px) 50% 0 / 4px 10px repeat-y; }
  .anima .cadena.andando::before { animation-name: fluye-v; }
  .fuentes { grid-template-columns: minmax(0, 1fr); }
  .publico { grid-template-columns: 2.75rem minmax(0, 1fr); }
  .publico ul { grid-column: 2; }
  .pie .marco { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .pie .marco > :first-child { grid-column: 1 / -1; }
  .lupa-dato { display: none; }
}
@keyframes fluye-v { to { background-position: 50% 10px; } }
@media (max-width: 39.99rem) {
  .logo-cabecera { height: 1.5rem; }
  .cabecera-acciones { gap: .5rem; }
  .cabecera-acciones .boton { padding-inline: .625rem; font-size: .8125rem; }
  .proximos, .principios, .funciones { grid-template-columns: minmax(0, 1fr); }
  .metrica { padding: .5rem .5625rem; }
  .metrica-cifra { font-size: 1.125rem; }
  .metrica-pie { display: none; }
  .fuentes li { grid-template-columns: minmax(0, 1fr); }
  .valor-v { display: none; }
  .anio { font-size: .5625rem; }
  .tablero > .p-anios { grid-template-rows: auto 11rem auto; }
  .anios { min-height: 11rem; gap: .2rem; }
  .panel-cabeza { flex-wrap: wrap; }
}
`;

// El modo (día o noche) antes de pintar: lo que la persona eligió con el botón (publico/interfaz.js lo guarda en este
// navegador); si nunca eligió, noche. Es el único script en línea y la CSP lo deja correr por su hash (cabeceras()).
const MODO_INICIAL = `try{var m=localStorage.getItem("gobserva-modo");if(m==="dia"||m==="noche")document.documentElement.dataset.modo=m}catch(e){}`;

function portada(datos) {
  // Los datos para portada.js: un bloque JSON que no se ejecuta (la CSP sólo deja correr los scripts propios). Sin «<»
  // crudo, para que nada de la API pueda cerrar el bloque.
  const json = datos
    ? `<script type="application/json" id="datos-regiones">${JSON.stringify({ corte: datos.corte, fuente: datos.fuente, regiones: datos.regiones }).replace(/</g, "\\u003c")}</script>`
    : "";
  return `<!doctype html>
<html lang="es-PE" data-modo="noche">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<script>${MODO_INICIAL}</script>
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
<meta property="og:image:alt" content="Gobserva: ${ESLOGAN} El mapa del Perú en puntos verdes, en la pantalla de un radar.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${TITULO}">
<meta name="twitter:description" content="${DESCRIPCION}">
<meta name="twitter:image" content="${RAIZ}/og.png">
<meta name="theme-color" content="#030B07">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@100..125,400..800&family=Doto:wght@800&family=JetBrains+Mono:wght@400;500;600;700&display=swap">
<script type="application/ld+json">${JSON.stringify(ORGANIZACION)}</script>
<style>${CSS}</style>
</head>
<body>
<a class="saltar" href="#contenido">Saltar al contenido</a>
<header class="cabecera">
  <div class="marco cabecera-fila">
    <a class="marca" href="${RAIZ}/" aria-label="Gobserva, inicio">${logo("logo-cabecera")}</a>
    <nav class="indice" aria-label="Secciones">
      <ol>
        ${SECCIONES.map(([id, nombre]) => `<li><a href="#${id}"><span class="nav-num" aria-hidden="true">${numeroSeccion(id)}</span>${nombre}</a></li>`).join("\n        ")}
      </ol>
    </nav>
    <div class="cabecera-acciones">
      ${BOTON_MODO}
      <a class="boton lima chico" href="${VIGIA}/">Entrar a Vigía</a>
    </div>
  </div>
</header>
<main id="contenido">
  <section class="portada" aria-labelledby="titulo">
    <div class="marco portada-grilla">
      <div class="portada-texto">
        <h1 id="titulo"><span class="sr">Gobserva</span>${logo("logo-portada")}</h1>
        <p class="eslogan">${ESLOGAN}</p>
        <p class="entrada">Somos una GovTech peruana. Leemos lo que el Estado publica, lo cruzamos entre diez instituciones y te mostramos dónde mirar dos veces, con la fuente al lado.</p>
        <div class="acciones">
          <a class="boton lima" href="${VIGIA}/">Entrar a Vigía</a>
          <a class="boton borde" href="#como-funciona">Cómo funciona</a>
        </div>
      </div>
      ${consola(datos)}
      ${instrumento(datos)}
    </div>
    <p id="anuncio" class="sr" aria-live="polite"></p>
  </section>
  ${cinta(datos)}

  <section class="marco seccion" id="datos" aria-labelledby="t-datos">
    ${tituloSeccion("datos", "t-datos", "Lo que el radar detecta")}
    <p class="intro">Tres instituciones miden el mismo problema de tres maneras. Sus cifras no se suman: cada una cuenta distinto.</p>
    <div class="tablero">
      ${panelPerdida()}
      ${panelAnios(datos)}
      ${panelAguja(datos)}
      ${panelDonde(datos)}
    </div>
  </section>

  <section class="marco seccion" id="como-funciona" aria-labelledby="t-como">
    ${tituloSeccion("como-funciona", "t-como", "El Estado publica. Gobserva lee y cruza.")}
    <p class="intro">Ningún portal del Estado lee sus propios contratos: los publica. Nosotros los leemos cada día, los cruzamos entre instituciones y te decimos cuáles mirar dos veces.</p>
    <ol class="cadena" data-anima>
      <li class="etapa panel">
        <div class="etapa-cabeza"><span class="etapa-num" aria-hidden="true">1</span><h3>Observa</h3>${pixel("institucion")}</div>
        <p>Leemos lo que publican diez instituciones: contratos, presupuesto, empresas, planillas, visitas y aportes.</p>
        <ul class="chips" aria-label="Las diez instituciones">${FUENTES.map(([sigla]) => `<li class="chip">${sigla}</li>`).join("")}</ul>
      </li>
      <li class="etapa panel">
        <div class="etapa-cabeza"><span class="etapa-num" aria-hidden="true">2</span><h3>Conecta</h3>${pixel("nodos")}</div>
        <p>Cruzamos los registros por RUC, por entidad y por fecha.</p>
        <ul class="chips" aria-label="Por dónde cruzamos"><li class="chip">RUC</li><li class="chip">Entidad</li><li class="chip">Fecha</li></ul>
        <div class="etapa-lupa">${LUPA_GRANDE}</div>
      </li>
      <li class="etapa panel">
        <div class="etapa-cabeza"><span class="etapa-num" aria-hidden="true">3</span><h3>Señala</h3>${pixel("bandera")}</div>
        <ul class="senales">${SENALES.map((t, k) => `<li class="senal" style="--i:${k}">${pixel("bandera")}<span>${t}</span></li>`).join("")}</ul>
      </li>
      <li class="etapa panel">
        <div class="etapa-cabeza"><span class="etapa-num" aria-hidden="true">4</span><h3>Tú decides</h3>${pixel("entiende")}</div>
        <p>Cada señal llega con su norma y el enlace al documento original. Es una razón para mirar de nuevo, no una prueba.</p>
        <a class="enlace" href="${VIGIA}/glosario">Qué significa cada señal</a>
      </li>
    </ol>
  </section>

  <section class="marco seccion" id="para-quien" aria-labelledby="t-para">
    ${tituloSeccion("para-quien", "t-para", "La misma evidencia, para tres trabajos")}
    <p class="intro">Gobserva no reemplaza a nadie: le ahorra a cada uno las semanas de leer y cruzar a mano.</p>
    <ul class="publicos" data-anima>
      ${PUBLICOS.map(([icono, titulo, valor, usos], k) => `<li class="publico" style="--i:${k}">${pixel(icono)}<div><h3>${titulo}</h3><p class="valor">${valor}</p></div><ul>${usos.map((u) => `<li>${u}</li>`).join("")}</ul></li>`).join("\n      ")}
    </ul>
  </section>

  <section class="marco seccion" id="monitores" aria-labelledby="t-monitores">
    ${tituloSeccion("monitores", "t-monitores", "Elige por dónde entrar")}
    <p class="intro">Vigía, Empleo, Licitaciones y Obras ya están en línea. Los demás monitores se arman sobre los mismos datos y las mismas reglas: datos oficiales, la fuente al lado y señales, no acusaciones.</p>
    <div class="monitores">
      <div class="monitor-vigia panel" data-anima>
        <div class="vigia-cabeza">
          ${ojoVigia()}
          <div>
            <h3>Vigía</h3>
            <p class="vigia-dominio">vigia.gobserva.cloud</p>
          </div>
          <p class="estado">En línea</p>
        </div>
        <p class="vigia-lema">Revisa los contratos del Estado y te dice cuáles mirar dos veces.</p>
        <p>Lee los contratos y las órdenes de compra, los cruza con más de veinte registros oficiales y marca con una bandera los que merecen otra mirada: proveedores sancionados, empresas recién creadas que ganan contratos grandes, aportes a campañas, visitas antes de una buena pro.</p>
        <ul class="funciones" aria-label="Qué puedes ver en Vigía">
          ${FUNCIONES.map(([titulo, d, ruta]) => `<li><a href="${VIGIA}${ruta}"><i class="led"></i><span><strong>${titulo}</strong><span class="d">${d}</span></span></a></li>`).join("\n          ")}
        </ul>
        <div class="acciones">
          <a class="boton lima" href="${VIGIA}/">Entrar a Vigía</a>
          <a class="boton borde" href="${VIGIA}/fuentes">De dónde salen los datos</a>
        </div>
      </div>
      <ul class="proximos" data-anima aria-label="Monitores en preparación">
        ${PROXIMOS.map(([icono, titulo, texto, ya], k) => `<li class="proximo" style="--i:${k}">${pixel(icono)}<p class="estado apagado">En preparación</p><h3>${titulo}</h3><p>${texto}</p><p class="ya">${ya}</p></li>`).join("\n        ")}
      </ul>
    </div>
    <div class="productos-gob">
      ${PRODUCTOS_GOB.map(([icono, nombre, dominio, lema, texto, enlace, accion]) => `<article class="monitor-vigia monitor-producto panel" data-anima>
        <div class="vigia-cabeza">${pixel(icono)}<div><h3>${nombre}</h3><p class="vigia-dominio">${dominio}</p></div><p class="estado">En línea</p></div>
        <p class="vigia-lema">${lema}</p>
        <p>${texto}</p>
        ${ESCENA_PRODUCTO[icono] ? `<div class="escena-producto" aria-hidden="true">${personaje(ESCENA_PRODUCTO[icono][0], 3, "px-persona", 400 * PRODUCTOS_GOB.findIndex((x) => x[0] === icono))}${personaje(ESCENA_PRODUCTO[icono][1], 3, "px-lugar")}</div>` : ""}
        <div class="acciones"><a class="boton lima" href="${enlace}">${accion}</a></div>
      </article>`).join("\n      ")}
    </div>
  </section>

  <section class="marco seccion" id="principios" aria-labelledby="t-principios">
    ${tituloSeccion("principios", "t-principios", "Seis reglas que no negociamos")}
    <p class="intro">Vigilar el uso del dinero público exige que también se pueda vigilar a quien vigila.</p>
    <ul class="principios">
      ${PRINCIPIOS.map(([i, titulo, texto, enlace]) => `<li>${pixel(i)}<div><h3>${titulo}</h3><p>${texto}</p>${enlace ? `<a class="enlace" href="${enlace[0]}">${enlace[1]}</a>` : ""}</div></li>`).join("\n      ")}
    </ul>
  </section>

  <section class="marco seccion" id="fuentes" aria-labelledby="t-fuentes">
    ${tituloSeccion("fuentes", "t-fuentes", "Diez fuentes oficiales, conectadas")}
    <p class="intro">Diez instituciones del Estado peruano y más de veinte registros públicos, cruzados entre sí. Las tres que mide el radar llevan su luz.</p>
    <ul class="fuentes">
      ${FUENTES.map(([sigla, que, nombre, metrica]) => `<li><span class="sigla"><i class="led"${metrica ? ` style="--c: var(--c-${metrica})"` : ' style="--c: var(--fosforo-2)"'}></i>${sigla}</span><div><p class="que">${que}</p><p class="nombre">${nombre}</p></div></li>`).join("\n      ")}
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
      <p class="pie-datos">Cifras de la API de Vigía, renovadas cada 6 horas.</p>
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
        ${SECCIONES.map(([id, nombre]) => `<li><a href="#${id}">${nombre}</a></li>`).join("\n        ")}
        <li><a href="https://github.com/EdwinSotto123/vigia-peru">Código abierto</a></li>
        <li><a href="/marca/gobserva-logo.svg" download>Descarga el logo</a></li>
      </ul>
    </nav>
  </div>
</footer>
${json}
<script src="/interfaz.js?v=${VERSION_JS}" defer></script>
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

// Scripts: los propios (publico/), el del modo antes de pintar (MODO_INICIAL, por su hash) y el contador de visitas que
// Cloudflare agrega a la zona (Web Analytics, sin cookies), como en Vigía.
const SEGURIDAD = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};
const csp = (hashModo) =>
  `default-src 'none'; script-src 'self' 'sha256-${hashModo}' https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com; ` +
  "style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; " +
  `img-src 'self' data: ${VIGIA}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;

// El hash de MODO_INICIAL se calcula una vez, al primer pedido: si alguien cambia el script, la CSP lo sigue sola.
let CABECERAS = null;
async function cabeceras() {
  if (!CABECERAS) {
    const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(MODO_INICIAL)));
    CABECERAS = { ...SEGURIDAD, "Content-Security-Policy": csp(btoa(String.fromCharCode(...d))) };
  }
  return CABECERAS;
}

async function texto(cuerpo, tipo, cache = "public, max-age=3600") {
  return new Response(cuerpo, { headers: { "Content-Type": tipo, "Cache-Control": cache, ...(await cabeceras()) } });
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
