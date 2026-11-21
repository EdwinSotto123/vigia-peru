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
// Rediseño del 2026-11-21 («se ve muy saturada e info, no comunica bien qué hacemos»): la portada dice qué es Gobserva en
// una frase y abre con cinco puertas, una por producto, cada una con su persona de píxeles (personajes.js) parada en la
// misma calle y lo que necesita dicho por ella («Busco trabajo en el Estado»). Después, cómo funciona en tres pasos, el
// radar como muestra en vivo, cuatro reglas y lo que viene. Se fueron la consola, la cinta de cifras, los cuatro paneles,
// «Para quién», la ficha grande de Vigía, la lista de fuentes (sus siglas van en el primer paso) y los números de sección.
// Quedó en unas 4 pantallas de computadora (antes casi 8) y menos de la mitad en el celular (antes 17).
//
// Los archivos de publico/ (portada.js, mapa-peru.js, favicon, logo.png, og.png y el logo para descargar en /marca/) los
// sirve Cloudflare tal cual, antes de llegar a este código (wrangler.jsonc, "assets"). El logo va en línea desde marca.js
// (marca/generar_marca.py); la malla, desde publico/mapa-peru.js (mapa/generar_mapa.py).
//
// El nombre del Worker (gobserva-redirect) se mantiene: los custom domains están atados a él. Despliegue: README.md.

import { LOGO_INTERIOR, LOGO_VIEWBOX } from "./marca.js";
import { pixel } from "./pixeles.js";
import { personaje } from "./personajes.js";

const RAIZ = "https://gobserva.cloud";
const VIGIA = "https://vigia.gobserva.cloud";
const CLAVE_INDEXNOW = "70c4458a363841ee4aef67be90cc8565";
// La fecha de la última versión de la portada (sitemap y datos estructurados): cambiarla al cambiar el contenido.
const ACTUALIZADA = "2026-11-21";
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
  "Gobserva convierte lo que publica el Estado peruano en respuestas: revisa contratos, encuentra plazas CAS, véndele al Estado, sigue las obras y verifica tu clínica.";

// ─── Los datos de cada región (API de Vigía, con caché) ─────────────────────────────────────────────────────────────
// La API sólo atiende a los Workers de Vigía: los reconoce por el encabezado CF-Worker, que Cloudflare pone con la zona del
// que llama (gobserva.cloud está en WORKERS_PROPIOS de backend/api/wrangler.jsonc). Son 26 pedidos (los contratos por
// departamento y la corrupción de cada uno; el plan gratis de Workers admite 50), así que se guardan en la caché de
// Cloudflare y se renuevan cada 6 horas en segundo plano: un visitante nunca espera por ellos, salvo el primero de cada
// centro de datos. Hasta el rediseño del 2026-11-21 también se pedían lo leído este año y los procesos de cada año (38
// pedidos): eran para los paneles de cifras, que ya no están.
const CACHE_REGIONES = `${RAIZ}/__cache/regiones-v2`;
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
// ─── Lo que dice la portada ─────────────────────────────────────────────────────────────────────────────────────────
// Rediseño del 2026-11-21 (pedido del usuario: «se ve muy saturada e info, no comunica bien qué hacemos»). Antes eran seis
// secciones numeradas, una consola, una cinta y cuatro paneles de cifras: casi 8 pantallas en la computadora y 17 en el
// celular, y los productos recién en la cuarta sección. Ahora la página responde en orden lo que se pregunta quien llega:
// qué es Gobserva (una frase), qué puede hacer con ella (las cinco puertas, ahí mismo), cómo funciona, una prueba en vivo
// (el radar de las regiones) y en qué reglas confiar.

// [sigla, qué da, nombre completo]. Las que se leen para algún producto (SCRAPERS.md); la cuenta va en letras en la página.
const FUENTES = [
  ["OECE", "Contratos, órdenes de compra y servicio, postores y proveedores sancionados.", "Organismo Especializado para las Contrataciones Públicas Eficientes (antes OSCE), con el SEACE"],
  ["MEF", "Presupuesto y gasto de cada entidad, y los proyectos de Invierte.pe.", "Ministerio de Economía y Finanzas"],
  ["Contraloría", "Informes de control, obras de INFOBRAS y declaraciones juradas de intereses.", "Contraloría General de la República"],
  ["Procuraduría", "Casos de corrupción en trámite y con sentencia firme.", "Procuraduría Pública Especializada en Delitos de Corrupción"],
  ["SERVIR", "Plazas CAS que convoca cada entidad.", "Autoridad Nacional del Servicio Civil"],
  ["SUSALUD", "Establecimientos de salud registrados (RENIPRESS) y sus sanciones firmes.", "Superintendencia Nacional de Salud"],
  ["SUNAT", "Estado y domicilio fiscal de las empresas.", "Superintendencia Nacional de Aduanas y de Administración Tributaria"],
  ["JNE", "Autoridades electas y candidatos.", "Jurado Nacional de Elecciones"],
  ["ONPE", "Aportes y gastos de campaña.", "Oficina Nacional de Procesos Electorales"],
  ["Congreso", "Registro de visitas al Congreso.", "Congreso de la República"],
  ["PCM", "Visitas a las entidades, planillas del Portal de Transparencia y datos abiertos.", "Presidencia del Consejo de Ministros"],
];
const EN_LETRAS = { 9: "nueve", 10: "diez", 11: "once", 12: "doce", 13: "trece", 14: "catorce" };
const enLetras = (n) => EN_LETRAS[n] ?? String(n);

// Las puertas de la portada, una por producto: [su gente (personajes.js), lo que la persona necesita, dicho por ella,
// el producto, qué hace en una línea, enlace, nombre corto (el del «Entrar a…», que no se parta en dos líneas)].
// Primero lo cívico, después lo de todos los días.
const PRODUCTOS = [
  ["vigia", "Quiero saber en qué se gasta el dinero público", "Vigía", "Revisa los contratos del Estado y te dice cuáles mirar dos veces.", `${VIGIA}/`, "Vigía"],
  ["postulante", "Busco trabajo en el Estado", "Gobserva Empleo", "Todas las plazas CAS, con su sueldo, sus requisitos y cuándo cierran.", "https://empleo.gobserva.cloud", "Empleo"],
  ["emprendedora", "Quiero venderle al Estado", "Gobserva Licitaciones", "Las convocatorias de tu rubro y tu región, cada día, con quién gana y a qué precio.", "https://licitaciones.gobserva.cloud", "Licitaciones"],
  ["obrero", "Quiero saber qué obras se vienen", "Gobserva Obras", "Los proyectos de tu región antes de que se liciten, con su costo y su avance.", "https://obras.gobserva.cloud", "Obras"],
  ["vecina", "Quiero verificar una clínica o a un médico", "Gobserva Salud", "Si el establecimiento está registrado y activo, su categoría y sus sanciones.", "https://salud.gobserva.cloud", "Salud"],
];

// Cómo funciona: [ícono (pixeles.js), paso, qué pasa]. El primero lleva las siglas de las fuentes; el segundo, por dónde
// se cruza; el tercero, qué es una señal.
const PASOS = [
  ["institucion", "Leemos", `Cada día bajamos lo que publican ${enLetras(FUENTES.length)} instituciones del Estado: contratos, plazas, obras, presupuesto, empresas y establecimientos de salud.`],
  ["nodos", "Cruzamos", "Unimos sus registros por RUC, por entidad y por fecha, para que un dato explique al otro."],
  ["entiende", "Te lo explicamos", "En palabras simples y con el documento original al lado, para que lo compruebes tú. Una señal es una razón para mirar de nuevo, no una acusación."],
];

// Lo que viene (pedido del usuario: «secciones de próximos, por ejemplo Monitoreo del Congreso, Monitoreo histórico de
// políticos»): [ícono, nombre, qué hará]. Nada de esto está en línea todavía.
const PROXIMOS = [
  ["congreso", "Monitoreo del Congreso", "Cómo vota cada congresista, a quién recibe y qué leyes impulsa."],
  ["politicos", "Historia de cada político", "Partidos, cargos, declaraciones juradas, aportes de campaña y sentencias, en una línea de tiempo."],
  ["alertas", "Alertas de tu distrito", "Un aviso cuando tu municipalidad firme un contrato con señales o la Contraloría la revise."],
];

const PRINCIPIOS = [
  ["institucion", "Sólo datos oficiales", "Lo que el propio Estado publica, tal como lo publica cada institución y con la fecha de cada carga.", [`${VIGIA}/fuentes`, "Ver las fuentes"]],
  ["bandera", "Indicios, no acusaciones", "Una señal es una razón para mirar de nuevo, no una prueba. Aparecer en Gobserva no significa haber hecho algo malo.", [`${VIGIA}/glosario`, "Qué significa cada señal"]],
  ["escudo", "Las personas, protegidas", "Nunca publicamos un DNI, y de quien no es autoridad electa tapamos un apellido. Puedes pedir que corrijamos un dato.", [`${VIGIA}/privacidad`, "Cómo cuidamos tus datos"]],
  ["codigo", "Abierto y con cuentas claras", "Cualquiera puede revisar cómo se calcula cada señal, y publicamos cuánto cuesta mantener Vigía.", ["https://github.com/EdwinSotto123/vigia-peru", "Ver el código"]],
];

// Lo que mide el radar: [valor, nombre, pie, institución]. El mapa es siempre verde, como la pantalla de un radar; cada
// institución tiene su luz (la misma en los canales y en la lectura de la región).
const METRICAS = [
  ["tramite", "Corrupción", "casos en trámite en el país", "Procuraduría Anticorrupción"],
  ["penal", "Control", "informes con presunta responsabilidad penal", "Contraloría"],
  ["procesos", "Compras", "procesos de compra desde 2015", "OECE"],
];

// Las secciones, en el orden de la página: [id, nombre en el índice de la cabecera, que marca la que se está leyendo].
const SECCIONES = [
  ["productos", "Productos"],
  ["como-funciona", "Cómo funciona"],
  ["region", "Tu región"],
  ["principios", "Principios"],
];

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

/** El «entrar» de cada puerta: un cheurón de píxeles (un ícono, no una flecha de texto). */
const CHEURON = `<svg class="cheuron" viewBox="0 0 6 10" shape-rendering="crispEdges" aria-hidden="true" focusable="false"><path fill="currentColor" d="M0 0h2v2H0zM2 2h2v2H2zM4 4h2v2H4zM2 6h2v2H2zM0 8h2v2H0z"/></svg>`;

/** Las cinco puertas: cada persona parada en la misma calle, con lo que necesita y el producto que se lo resuelve. Toda la
 * puerta es el enlace. La gente entra en escena una tras otra (a pasos, como píxeles) y parpadea a destiempo. */
/** ` data-producto="salud"` para la puerta de un producto o de Vigía (su color: el bloque «Color por producto» del CSS). */
function productoDe(enlace) {
  const m = /^https:\/\/(vigia|empleo|licitaciones|obras|salud)\.gobserva\.cloud/.exec(enlace);
  return m ? ` data-producto="${m[1]}"` : "";
}

function puertas() {
  return `<ul class="calle">
        ${PRODUCTOS.map(([gente, necesidad, nombre, que, enlace, corto], k) => `<li style="--i:${k}"><a class="puerta"${productoDe(enlace)} href="${enlace}" aria-label="${necesidad}: ${nombre}" aria-describedby="puerta-${k}">
          <span class="puerta-gente">${personaje(gente, 4, "", 900 * k)}</span>
          <span class="puerta-necesidad">${necesidad}</span>
          <span class="puerta-que" id="puerta-${k}">${que}</span>
          <span class="puerta-ir" aria-hidden="true"><span>Entrar a ${corto}</span>${CHEURON}</span>
        </a></li>`).join("\n        ")}
      </ul>`;
}

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
  --cabecera-fondo: rgba(3, 11, 7, .84);
  /* El brillo del fósforo: halos y luces de color. De día no hay. */
  --halo: 0 0 14px rgba(61, 255, 138, .4);
  --halo-sel: 0 0 20px rgba(61, 255, 138, .12);
  --luz: 8px;
  /* El radar: cómo se suma el barrido a la pantalla, su luz y las líneas del tubo. */
  --mezcla: screen;
  --barrido: conic-gradient(from 0deg, transparent 0deg 285deg, rgba(61, 255, 138, .035) 285deg, rgba(61, 255, 138, .2) 356deg, rgba(168, 255, 208, .75) 359.5deg, transparent 360deg);
  --tubo: rgba(0, 0, 0, .2);
  /* El suelo de cuadros donde se para la gente de cada puerta. */
  --suelo: color-mix(in srgb, var(--tinta) 24%, transparent);
  --f-texto: Archivo, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --f-mono: "JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  --f-led: Doto, "JetBrains Mono", monospace;
  --t-small: .875rem;
  --t-caption: .8125rem;
  --t-mono: .75rem;
  /* Una vuelta del barrido del radar (portada.js lo lee para encender las regiones a su paso). */
  --periodo: 6s;
  /* Los personajes de píxeles de cada producto (personajes.js): la piel y los rasgos son los mismos de día y de noche. */
  --px-linea: var(--tinta); --px-fondo: var(--fondo); --px-marca: var(--lima);
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
  --cabecera-fondo: rgba(237, 244, 239, .88);
  --halo: 0 0 0 transparent; --halo-sel: 0 0 0 transparent;
  --luz: 0px;
  --mezcla: multiply;
  --barrido: conic-gradient(from 0deg, transparent 0deg 285deg, rgba(8, 122, 59, .03) 285deg, rgba(8, 122, 59, .14) 356deg, rgba(7, 92, 44, .45) 359.5deg, transparent 360deg);
  --tubo: rgba(0, 40, 20, .035);
  --px-marca: #2F6B10; --px-pelo: #34261E; --px-bata: #FAFBFB;
}
/* Color por producto (generado por frontend/scripts/colores/colores_producto.py): cada puerta lleva el color de su producto. */
.puerta[data-producto="salud"] { --px-marca: #3EE6C9; --fosforo: #3EE6C9; }
.puerta[data-producto="empleo"] { --px-marca: #B9A0FF; --fosforo: #B9A0FF; }
.puerta[data-producto="licitaciones"] { --px-marca: #6DB4FF; --fosforo: #6DB4FF; }
.puerta[data-producto="obras"] { --px-marca: #FF9A55; --fosforo: #FF9A55; }
.puerta[data-producto="vigia"] { --px-marca: #8C9DFF; --fosforo: #8C9DFF; }
:root[data-modo="dia"] .puerta[data-producto="salud"] { --px-marca: #0A7266; --fosforo: #0A7266; }
:root[data-modo="dia"] .puerta[data-producto="empleo"] { --px-marca: #5B35C9; --fosforo: #5B35C9; }
:root[data-modo="dia"] .puerta[data-producto="licitaciones"] { --px-marca: #1D5DB8; --fosforo: #1D5DB8; }
:root[data-modo="dia"] .puerta[data-producto="obras"] { --px-marca: #A9480C; --fosforo: #A9480C; }
:root[data-modo="dia"] .puerta[data-producto="vigia"] { --px-marca: #3346A8; --fosforo: #3346A8; }
/* Color por producto: fin */
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; scroll-behavior: smooth; scroll-padding-top: 5rem; scrollbar-color: var(--borde) var(--fondo); -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; background: var(--fondo); }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
body {
  margin: 0; color: var(--tinta); caret-color: var(--fosforo);
  font: 400 1rem/1.6 var(--f-texto);
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
h3 { font: 700 1.125rem/1.3 var(--f-texto); font-stretch: 108%; }
p { text-wrap: pretty; }
.logo { display: block; width: auto; max-width: 100%; }
.logo .gl-letras { fill: var(--logo-tinta); }
.logo .gl-aro { stroke: var(--logo-aro); }
.logo .gl-nodo { fill: var(--logo-nodo); }
.logo .gl-arista { fill: none; stroke: var(--logo-nodo); }
.logo .gl-cursor { fill: var(--logo-aro); }
/* El cursor titila, como el de «vigía_». */
@media (prefers-reduced-motion: no-preference) { .logo-cabecera .gl-cursor { animation: titila 1.1s steps(1) infinite; } }
@keyframes titila { 50% { opacity: 0; } }
.px { display: block; width: 1.5rem; height: 1.5rem; fill: currentColor; flex: none; }
.enlace { color: var(--fosforo); font-weight: 600; text-decoration: underline; }
.enlace:hover { text-decoration-thickness: 2px; }
/* La luz de una institución. */
.led { display: inline-block; width: .5rem; height: .5rem; border-radius: 50%; background: var(--c, var(--fosforo)); box-shadow: 0 0 var(--luz) var(--c, var(--fosforo)); flex: none; }
.m-tramite { --c: var(--c-tramite); } .m-penal { --c: var(--c-penal); } .m-procesos { --c: var(--c-procesos); } .m-vigia { --c: var(--c-vigia); }

/* Cabecera: la marca, el índice de secciones (marca la que se está leyendo) y día o noche; debajo, la regla de un
   instrumento */
.cabecera { position: sticky; top: 0; z-index: 10; background: var(--cabecera-fondo); -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); }
.cabecera::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 7px; pointer-events: none;
  background: linear-gradient(90deg, color-mix(in srgb, var(--fosforo) 50%, transparent) 1px, transparent 1px) 0 100% / 8px 3px repeat-x, linear-gradient(90deg, color-mix(in srgb, var(--fosforo) 80%, transparent) 1px, transparent 1px) 0 100% / 64px 7px repeat-x, linear-gradient(var(--linea), var(--linea)) 0 100% / 100% 1px no-repeat; }
.cabecera-fila { display: flex; align-items: center; justify-content: space-between; gap: 1rem 1.5rem; min-height: 3.75rem; }
.marca { display: block; padding-block: .5rem; }
.logo-cabecera { height: 1.875rem; }
.indice ol { display: flex; align-items: center; gap: .25rem 1.75rem; list-style: none; margin: 0; padding: 0; }
.indice a { display: inline-block; padding-block: .375rem; border-bottom: 2px solid transparent; font-weight: 500; font-size: var(--t-small); color: var(--tinta-suave); text-decoration: none; white-space: nowrap; }
.indice a:hover { color: var(--fosforo); }
.indice a[aria-current="true"] { color: var(--tinta); border-bottom-color: var(--fosforo); }
.cabecera-acciones { display: flex; align-items: center; gap: .625rem; }
/* Día o noche: un interruptor de dos posiciones, como el de un instrumento. */
.modo { display: inline-flex; border: 1px solid var(--borde); background: var(--panel); }
.modo[hidden] { display: none; }
.modo button { display: inline-flex; align-items: center; gap: .4rem; min-height: 2.25rem; padding: .3rem .65rem; border: 0; font: 600 .6875rem/1 var(--f-mono); letter-spacing: .06em; text-transform: uppercase; color: var(--tenue); background: transparent; cursor: pointer; }
.modo button + button { border-left: 1px solid var(--borde); }
.modo button:hover { color: var(--fosforo); }
.modo button[aria-pressed="true"] { color: var(--sobre-fosforo); background: var(--fosforo); }
.modo .px { width: .875rem; height: .875rem; }

/* La portada: qué es Gobserva en una frase y, ahí mismo, las cinco puertas. */
.portada { border-bottom: 1px solid var(--linea); }
.portada > .marco { padding-block: clamp(2.5rem, 6vw, 4.75rem) 0; }
.portada-texto { display: grid; gap: 1.25rem 3rem; align-items: end; }
.portada h1 { font: 800 clamp(2.25rem, 1.2rem + 3.6vw, 4.5rem)/1.02 var(--f-texto); font-stretch: 112%; letter-spacing: -0.025em; max-width: 15ch; }
.portada h1 em { font-style: normal; color: var(--fosforo); }
.entrada { margin: 0; max-width: 42ch; font-size: clamp(1.0625rem, 1rem + .35vw, 1.25rem); line-height: 1.55; color: var(--tinta-suave); }
.pregunta { margin: clamp(2.5rem, 5vw, 3.5rem) 0 0; font: 700 1.25rem/1.3 var(--f-texto); font-stretch: 108%; }

/* La calle: cinco puertas en fila sobre un mismo suelo de cuadros. Toda la puerta es el enlace. */
.calle { list-style: none; margin: .5rem 0 0; padding: 0; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); }
.calle > li { display: flex; min-width: 0; }
.puerta { flex: 1; display: flex; flex-direction: column; gap: .5rem; padding: 0 1.125rem 2rem; color: inherit; text-decoration: none; }
.puerta-gente { display: flex; align-items: flex-end; justify-content: center; height: 8rem; margin: 0 -1.125rem 1rem; border-bottom: 4px dashed var(--suelo); }
.puerta-gente .px-sprite { display: block; width: auto; height: 6.5rem; }
.puerta-necesidad { font: 700 1.125rem/1.3 var(--f-texto); font-stretch: 106%; text-wrap: balance; }
.puerta-que { color: var(--tinta-suave); font-size: .9375rem; line-height: 1.5; text-wrap: pretty; }
.puerta-ir { display: inline-flex; align-items: center; gap: .5rem; margin-top: auto; padding-top: .5rem; font-weight: 600; font-size: .9375rem; color: var(--fosforo); white-space: nowrap; }
.puerta-ir > span { text-decoration: underline; text-underline-offset: .22em; text-decoration-thickness: 1px; }
.cheuron { width: .4375rem; height: .75rem; flex: none; }
.puerta:hover { background: color-mix(in srgb, var(--fosforo) 6%, transparent); }
.puerta:hover .puerta-ir > span { text-decoration-thickness: 2px; }
.puerta:focus-visible { outline-offset: -2px; }
@media (prefers-reduced-motion: no-preference) {
  /* La gente entra en escena una tras otra, a pasos; al pasar el mouse, la de esa puerta da un saltito. */
  .puerta-gente .px-sprite { animation: entra .56s steps(4, end) calc(120ms + var(--i) * 150ms) both; }
  .puerta:hover .px-sprite { animation: salta .42s steps(3, end) 1; }
  .puerta:hover .cheuron { translate: 3px 0; }
  .puerta, .cheuron { transition: background-color .15s, translate .15s steps(2, end); }
}
@keyframes entra { from { opacity: 0; transform: translateY(16px); } }
@keyframes salta { 50% { transform: translateY(-8px); } }

/* Secciones */
.seccion { padding-block: clamp(4.5rem, 9vw, 7rem) 0; }
.seccion > h2 { font: 800 clamp(1.75rem, 1.15rem + 2.2vw, 2.875rem)/1.08 var(--f-texto); font-stretch: 110%; letter-spacing: -0.02em; max-width: 22ch; }
.intro { margin: 1rem 0 0; max-width: 58ch; font-size: 1.0625rem; color: var(--tinta-suave); }

/* Cómo funciona: tres pasos sobre un mismo riel punteado (el riel corre mientras se ve). */
.pasos { position: relative; list-style: none; margin: clamp(2.25rem, 4vw, 3rem) 0 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 2rem 3rem; }
.pasos::before { content: ""; position: absolute; left: 1.5rem; right: 0; top: 1.5rem; border-top: 3px dotted var(--fosforo-2); }
.paso { position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: .75rem; }
.paso-icono { display: grid; place-items: center; width: 3rem; height: 3rem; color: var(--fosforo); background: var(--fondo); border: 1px solid var(--fosforo-2); box-shadow: var(--halo-sel); }
.paso h3 { margin-top: .5rem; font-size: 1.375rem; font-stretch: 110%; }
.paso p { margin: 0; color: var(--tinta-suave); max-width: 38ch; }
.chips { list-style: none; margin: .25rem 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: .375rem; }
.chip { padding: .3rem .5rem; font: 500 .75rem/1.2 var(--f-mono); color: var(--tinta); background: var(--panel); border: 1px solid var(--linea); }

/* Tu región: el radar, entero, como prueba en vivo. Paneles con el bisel de un instrumento (escuadras en las esquinas). */
.panel { position: relative; min-width: 0; background: var(--panel); border: 1px solid var(--linea); }
.panel::before {
  content: ""; position: absolute; inset: -1px; pointer-events: none;
  background:
    linear-gradient(var(--fosforo-2), var(--fosforo-2)) 0 0 / 14px 1px, linear-gradient(var(--fosforo-2), var(--fosforo-2)) 0 0 / 1px 14px,
    linear-gradient(var(--fosforo-2), var(--fosforo-2)) 100% 0 / 14px 1px, linear-gradient(var(--fosforo-2), var(--fosforo-2)) 100% 0 / 1px 14px,
    linear-gradient(var(--fosforo-2), var(--fosforo-2)) 0 100% / 14px 1px, linear-gradient(var(--fosforo-2), var(--fosforo-2)) 0 100% / 1px 14px,
    linear-gradient(var(--fosforo-2), var(--fosforo-2)) 100% 100% / 14px 1px, linear-gradient(var(--fosforo-2), var(--fosforo-2)) 100% 100% / 1px 14px;
  background-repeat: no-repeat;
}
.instrumento { display: grid; gap: .625rem; margin-top: clamp(2rem, 4vw, 2.75rem); padding: .625rem; container-type: inline-size; }
.instrumento-cuerpo { display: grid; gap: .625rem; }
.metricas { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .5rem; width: 100%; margin: 0; padding: 0; border: 0; min-width: 0; }
.metrica { position: relative; display: grid; align-content: start; gap: .1rem; padding: .5rem .65rem .55rem; cursor: pointer; background: var(--fondo-2); border: 1px solid var(--linea); }
.metrica:hover { border-color: var(--borde); }
.metrica:has(input:checked) { border-color: var(--fosforo); background: color-mix(in srgb, var(--fosforo) 8%, var(--fondo-2)); box-shadow: var(--halo-sel); }
.metrica:has(input:focus-visible) { outline: 2px solid var(--fosforo); outline-offset: 2px; }
.metrica input { position: absolute; opacity: 0; inset: 0; margin: 0; cursor: pointer; }
.metrica-nombre { display: flex; align-items: center; gap: .45rem; font-weight: 600; font-size: var(--t-small); }
.metrica-cifra { font: 800 1.375rem/1.15 var(--f-led); color: var(--fosforo); text-shadow: var(--halo); font-variant-numeric: tabular-nums; }
.metrica-pie { font-size: .6875rem; line-height: 1.3; color: var(--tenue); }

/* El visor del radar */
.visor { position: relative; display: flex; flex-direction: column; min-width: 0; border: 1px solid var(--linea); background: var(--fondo-2); }
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
  .mapa { flex: 1 1 auto; max-width: none; aspect-ratio: auto; min-height: clamp(24rem, calc(100svh - 18rem), 38rem); }
  .pista { position: absolute; left: .75rem; top: .625rem; z-index: 3; max-width: 11rem; padding: 0; text-align: left; pointer-events: none; }
  .mapa-pie { position: absolute; left: .75rem; bottom: .625rem; z-index: 3; justify-items: start; padding: 0; text-align: left; max-width: 12.5rem; pointer-events: none; }
  .leyenda { justify-items: start; }
  .visor-coords { position: absolute; right: .75rem; bottom: .625rem; z-index: 3; grid-auto-flow: row; justify-items: end; gap: .2rem; padding: 0; }
}

/* Las 25 regiones en una tabla, plegada bajo el radar (para leerlo de corrido, y sin JavaScript). */
.tabla-regiones { margin-top: 1rem; }
.tabla-regiones summary { cursor: pointer; width: fit-content; color: var(--fosforo); font-weight: 600; font-size: var(--t-small); text-decoration: underline; text-underline-offset: .22em; }
.tabla-caja { overflow-x: auto; margin-top: .875rem; background: var(--fondo-2); border: 1px solid var(--linea); }
.tabla-caja table { width: 100%; border-collapse: collapse; font-size: var(--t-small); }
.tabla-caja caption { caption-side: bottom; text-align: left; padding: .625rem 1rem; color: var(--tenue); font-size: .75rem; }
.tabla-caja th, .tabla-caja td { padding: .4rem 1rem; border-bottom: 1px dashed var(--linea); text-align: right; white-space: nowrap; }
.tabla-caja thead th { font: 600 .6875rem/1.35 var(--f-mono); color: var(--tinta-suave); white-space: normal; vertical-align: bottom; }
.tabla-caja th[scope="row"], .tabla-caja thead th:first-child { text-align: left; }
.tabla-caja td { font: 800 .9375rem var(--f-led); color: var(--fosforo); font-variant-numeric: tabular-nums; }

/* Principios: cuatro reglas en fila, cada una bajo su raya. */
.principios { list-style: none; margin: clamp(2.25rem, 4vw, 3rem) 0 0; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 2rem 2.5rem; }
.principios li { display: flex; flex-direction: column; align-items: flex-start; gap: .5rem; padding-top: 1.25rem; border-top: 2px solid var(--fosforo-2); }
.principios .px { color: var(--fosforo); margin-bottom: .25rem; }
.principios p { margin: 0; color: var(--tinta-suave); font-size: .9375rem; }
.principios .enlace { margin-top: auto; padding-top: .25rem; font-size: var(--t-small); }

/* Lo que viene: en preparación, de borde punteado. */
.seccion-chica > h2 { font-size: clamp(1.375rem, 1.1rem + 1vw, 1.75rem); }
.proximos { list-style: none; margin: 1.5rem 0 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem; }
.proximo { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: .25rem .875rem; align-items: start; padding: 1rem 1.125rem; border: 1px dashed var(--borde); }
.proximo .px { grid-row: span 2; width: 1.75rem; height: 1.75rem; color: var(--fosforo-2); }
.proximo h3 { font-size: 1rem; }
.proximo p { margin: 0; color: var(--tinta-suave); font-size: .875rem; line-height: 1.5; }

/* Pie */
.pie { margin-top: clamp(4.5rem, 9vw, 7rem); border-top: 1px solid var(--linea); background: var(--fondo-2); }
.pie .marco { display: grid; grid-template-columns: minmax(0, 1.4fr) repeat(3, minmax(0, 1fr)); gap: 2rem; padding-block: 2.5rem 3rem; }
.logo-pie { height: 2.125rem; }
.pie .pie-eslogan { margin: .875rem 0 0; font: 800 1.0625rem/1.3 var(--f-led); color: var(--menta); }
.pie p { margin: .375rem 0 0; color: var(--tenue); font-size: var(--t-small); }
.pie h2 { margin: .25rem 0 .875rem; font: 500 var(--t-mono)/1.2 var(--f-mono); letter-spacing: .06em; text-transform: uppercase; color: var(--tenue); }
.pie ul { list-style: none; margin: 0; padding: 0; display: grid; gap: .5rem; font-size: var(--t-small); }
.pie a { text-decoration: none; }
.pie a:hover { color: var(--fosforo); text-decoration: underline; }

/* Los personajes de píxeles (personajes.js): capas que parpadean o laten, a pasos. */
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

/* Las animaciones del radar: sólo con JavaScript y sin movimiento reducido (la clase .anima la pone animaciones.js). El
   barrido gira mientras se ve; el visor se enciende la primera vez. */
.anima .radar-barrido { opacity: 1; animation: gira var(--periodo) linear infinite; }
.anima .blip { opacity: .3; animation: blip var(--periodo) linear var(--retraso, 0s) infinite; }
.anima .blip::after { animation: onda var(--periodo) cubic-bezier(.2, .7, .3, 1) var(--retraso, 0s) infinite; }
.anima .mapa:not(.en-pantalla) .radar-barrido, .anima .mapa:not(.en-pantalla) .blip, .anima .mapa:not(.en-pantalla) .blip::after { animation-play-state: paused; }
@keyframes gira { from { rotate: 0deg; } to { rotate: 360deg; } }
@keyframes blip { 0%, 3% { opacity: 1; } 55% { opacity: .3; } 100% { opacity: .3; } }
@keyframes onda { 0% { opacity: .9; scale: .3; } 30% { opacity: 0; scale: 2.4; } 100% { opacity: 0; scale: 2.4; } }
/* Pausar detiene todo lo que se mueve (botón del radar). */
.pausado *, .pausado *::before, .pausado *::after { animation-play-state: paused !important; }
@media (prefers-reduced-motion: no-preference) {
  .metrica, .pausa, .modo button, .indice a { transition: background-color .15s, box-shadow .15s, color .15s, border-color .15s; }
}
/* El cambio de día a noche: un fundido corto de toda la página (View Transitions, donde el navegador lo tiene). */
::view-transition-old(root), ::view-transition-new(root) { animation-duration: .35s; }

/* Desde la computadora: el título y la entrada lado a lado. */
@media (min-width: 64rem) {
  .portada-texto { grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); }
  .entrada { padding-bottom: .5rem; }
}
/* Tableta: las puertas pasan a filas (la persona a la izquierda, sobre su propio suelo) en dos columnas. */
@media (max-width: 63.99rem) {
  .indice ol { gap: .25rem 1.25rem; }
  .calle { grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 1.5rem; margin-top: 1rem; }
  .calle > li { border-top: 1px solid var(--linea); }
  .puerta { display: grid; grid-template-columns: 4.5rem minmax(0, 1fr); grid-template-rows: auto auto 1fr; column-gap: 1rem; row-gap: .25rem; align-items: start; padding: 1.125rem .5rem 1.25rem; }
  .puerta-gente { grid-row: 1 / -1; height: auto; margin: 0; padding-bottom: 0; border-bottom-width: 3px; }
  .puerta-gente .px-sprite { height: 4.875rem; }
  .puerta-necesidad { font-size: 1.0625rem; }
  .puerta-que { font-size: .875rem; }
  .puerta-ir { margin-top: .25rem; padding-top: .25rem; font-size: .875rem; }
  .pasos { grid-template-columns: minmax(0, 1fr); gap: 2rem; }
  .pasos::before { left: 1.5rem; right: auto; top: 1.5rem; bottom: 1.5rem; border-top: 0; border-left: 3px dotted var(--fosforo-2); translate: -1.5px 0; }
  .paso { display: grid; grid-template-columns: 3rem minmax(0, 1fr); column-gap: 1.25rem; row-gap: .5rem; align-items: start; }
  .paso-icono { grid-row: 1 / span 4; }
  .paso h3 { margin-top: .625rem; }
  .paso > :not(.paso-icono) { grid-column: 2; }
  .principios { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .proximos { grid-template-columns: minmax(0, 1fr); }
  .pie .marco { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .pie .marco > :first-child { grid-column: 1 / -1; }
}
@media (max-width: 51.99rem) {
  .indice { display: none; }
}
/* Teléfono: una puerta por fila. */
@media (max-width: 47.99rem) {
  .logo-cabecera { height: 1.75rem; }
  .modo span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .modo button { padding-inline: .55rem; }
  .calle { grid-template-columns: minmax(0, 1fr); }
  .lupa-dato { display: none; }
}
@media (max-width: 39.99rem) {
  .logo-cabecera { height: 1.5rem; }
  .metrica { padding: .5rem .5625rem; }
  .metrica-cifra { font-size: 1.125rem; }
  .metrica-pie { display: none; }
  .principios { grid-template-columns: minmax(0, 1fr); }
  .pie .marco { grid-template-columns: repeat(2, minmax(0, 1fr)); }
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
  const instituciones = enLetras(FUENTES.length);
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
        ${SECCIONES.map(([id, nombre]) => `<li><a href="#${id}">${nombre}</a></li>`).join("\n        ")}
      </ol>
    </nav>
    <div class="cabecera-acciones">
      ${BOTON_MODO}
    </div>
  </div>
</header>
<main id="contenido">
  <section class="portada" aria-labelledby="titulo">
    <div class="marco">
      <div class="portada-texto">
        <h1 id="titulo">Lo que publica el Estado, convertido en <em>respuestas</em></h1>
        <p class="entrada">Gobserva lee cada día lo que publican ${instituciones} instituciones del Estado peruano y te lo entrega ordenado, en palabras simples y con la fuente oficial al lado.</p>
      </div>
      <div class="puertas" id="productos">
        <h2 class="pregunta">¿Qué necesitas?</h2>
        ${puertas()}
      </div>
    </div>
  </section>

  <section class="marco seccion" id="como-funciona" aria-labelledby="t-como">
    <h2 id="t-como">El Estado publica miles de registros cada día. Casi nadie los lee.</h2>
    <p class="intro">Gobserva los lee por ti, en tres pasos.</p>
    <ol class="pasos">
      ${PASOS.map(([icono, titulo, texto], k) => `<li class="paso">
        <span class="paso-icono" aria-hidden="true">${pixel(icono)}</span>
        <h3>${titulo}</h3>
        <p>${texto}</p>
        ${k === 0 ? `<ul class="chips" aria-label="Las ${instituciones} instituciones">${FUENTES.map(([sigla, , nombre]) => `<li class="chip" title="${nombre}">${sigla}</li>`).join("")}</ul>` : ""}
        ${k === 1 ? `<ul class="chips" aria-label="Por dónde cruzamos"><li class="chip">RUC</li><li class="chip">Entidad</li><li class="chip">Fecha</li></ul>` : ""}
        ${k === 2 ? `<a class="enlace" href="${VIGIA}/glosario">Qué significa cada señal</a>` : ""}
      </li>`).join("\n      ")}
    </ol>
  </section>

  <section class="marco seccion" id="region" aria-labelledby="t-region">
    <h2 id="t-region">Pasa la lupa por tu región</h2>
    <p class="intro">Una muestra en vivo de lo que ya leemos: lo que la Procuraduría Anticorrupción, la Contraloría y la OECE dicen de cada región. Cada una cuenta distinto, por eso sus cifras no se suman.</p>
    ${instrumento(datos)}
    ${tabla(datos)}
    <p id="anuncio" class="sr" aria-live="polite"></p>
  </section>

  <section class="marco seccion" id="principios" aria-labelledby="t-principios">
    <h2 id="t-principios">Cuatro reglas que no negociamos</h2>
    <p class="intro">Vigilar el uso del dinero público exige que también se pueda vigilar a quien vigila.</p>
    <ul class="principios">
      ${PRINCIPIOS.map(([i, titulo, texto, [href, accion]]) => `<li>${pixel(i)}<h3>${titulo}</h3><p>${texto}</p><a class="enlace" href="${href}">${accion}</a></li>`).join("\n      ")}
    </ul>
  </section>

  <section class="marco seccion seccion-chica" aria-labelledby="t-viene">
    <h2 id="t-viene">Lo que viene</h2>
    <ul class="proximos">
      ${PROXIMOS.map(([icono, titulo, texto]) => `<li class="proximo">${pixel(icono)}<h3>${titulo}</h3><p>${texto}</p></li>`).join("\n      ")}
    </ul>
  </section>
</main>

<footer class="pie">
  <div class="marco">
    <div>
      <a class="marca" href="${RAIZ}/" aria-label="Gobserva, inicio">${logo("logo-pie")}</a>
      <p class="pie-eslogan">${ESLOGAN}</p>
      <p>Tecnología cívica desde Lima, Perú.</p>
      <p>© 2026 Gobserva</p>
    </div>
    <nav aria-labelledby="pie-productos">
      <h2 id="pie-productos">Productos</h2>
      <ul>
        ${PRODUCTOS.map(([, , nombre, , enlace]) => `<li><a href="${enlace}">${nombre}</a></li>`).join("\n        ")}
      </ul>
    </nav>
    <nav aria-labelledby="pie-cuentas">
      <h2 id="pie-cuentas">Cuentas claras</h2>
      <ul>
        <li><a href="${VIGIA}/fuentes">De dónde salen los datos</a></li>
        <li><a href="${VIGIA}/glosario">Glosario</a></li>
        <li><a href="${VIGIA}/privacidad">Privacidad</a></li>
        <li><a href="${VIGIA}/app/cuanto-cuesta">Cuánto cuesta Vigía</a></li>
        <li><a href="https://github.com/EdwinSotto123/vigia-peru">Código abierto</a></li>
      </ul>
    </nav>
    <nav aria-labelledby="pie-gobserva">
      <h2 id="pie-gobserva">Gobserva</h2>
      <ul>
        ${SECCIONES.map(([id, nombre]) => `<li><a href="#${id}">${nombre}</a></li>`).join("\n        ")}
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
