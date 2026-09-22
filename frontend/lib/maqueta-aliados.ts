/**
 * ALIADOS DE MAQUETA — datos INVENTADOS. Archivo pensado para borrarse de una.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Por qué existe: con un solo aliado real —que además es la propia
 * plataforma— no se puede evaluar cómo se comporta el muro de /app/aliados
 * cuando hay varios financiadores. VIGÍA 2, VIGÍA 3 y VIGÍA 4 existen para
 * mirar el diseño con volumen, y para nada más.
 *
 * Las tres reglas que hacen que esto no sea una mentira dentro de un producto
 * que acusa públicamente de falta de transparencia:
 *
 *  1. **No aparecen nunca por defecto.** Hacen falta dos condiciones: el
 *     interruptor `?maqueta=1` en la URL, y que la página lo pase
 *     explícitamente. Sin eso, `/app/aliados` y `/aliado/[slug]` se comportan
 *     exactamente como hoy — la ficha de un slug de maqueta da 404.
 *  2. **Se nombran como lo que son.** "VIGÍA 2" no es el nombre de ninguna
 *     organización peruana; los códigos de aporte llevan prefijo `MAQ-` en vez
 *     de `VIG-`; los contratos llevan `MAQUETA-…` en vez de un OCID real y no
 *     enlazan a ninguna parte. Ninguna entidad del Estado se nombra: el campo
 *     `entidad` va en `null` a propósito.
 *  3. **Las cifras cierran entre sí.** Por cada aporte, `procesados ≤
 *     contratos` y `senales + enRevision ≤ procesados`; los totales del aliado
 *     son la suma exacta de sus aportes, y sus `zonas` son los ubigeos
 *     distintos que tocó. El objetivo es evaluar el diseño con volumen
 *     realista, y un muro que no cuadra no sirve ni para eso.
 *
 * Para borrarlo: `rm lib/maqueta-aliados.ts` y `npx tsc --noEmit` marca los
 * pocos sitios que lo importan. Ninguna cifra real depende de este archivo.
 */

import type { Comprobante, ComprobanteContrato, RankingRow } from "./financiamiento";
import type { ContribucionAliado } from "@/components/aliados/CadenaAliado";

/** Interruptor de URL. Una sola grafía, en un solo lugar. */
export const PARAM_MAQUETA = "maqueta";

/** `?maqueta=1` y nada más: cualquier otro valor deja la vista real. */
/**
 * ¿Se mezclan los aliados inventados?
 *
 * En DESARROLLO sí, por defecto: la maqueta existe para poder mirar el diseño
 * con varios nombres, y esconderla detrás de un parámetro que hay que ir a
 * buscar al pie de la página la volvía inútil para eso. Se apaga con
 * `?maqueta=0` cuando hace falta ver la página real.
 *
 * En PRODUCCIÓN sigue apagada salvo que alguien escriba `?maqueta=1` a mano, y
 * entonces la página lo grita por todos lados. Un visitante nunca se topa con
 * datos inventados en un sitio que acusa a otros de falta de transparencia.
 */
export function maquetaActiva(valor: string | string[] | undefined): boolean {
  const v = Array.isArray(valor) ? valor[0] : valor;
  if (v === "1") return true;
  if (v === "0") return false;
  return process.env.NODE_ENV !== "production";
}

/** Sufijo listo para pegar a un href y conservar el interruptor al navegar. */
export const queryMaqueta = (activa: boolean) => (activa ? `?${PARAM_MAQUETA}=1` : "");

interface AporteMaqueta {
  codigo: string;
  contratos: number;
  estado: "pagada" | "en_proceso" | "procesada";
  pagadaAt: string;
  ubigeo: string;
  zona: string;
  procesados: number;
  senales: number;
  enRevision: number;
}

interface SemillaAliado {
  id: number;
  slug: string;
  nombre: string;
  tipo: RankingRow["tipo"];
  aportes: AporteMaqueta[];
  /**
   * Perfil público del aliado. El API real NO devuelve estos campos todavía:
   * existen acá para poder mirar cómo se ve una ficha con presentación, sitio
   * y contacto. Para que sean reales hace falta columna en `financiadores` y
   * campo en GET /financiamiento/aliados/:slug.
   */
  descripcion?: string;
  web?: string;
  email?: string;
}

/**
 * Los tres aliados inventados. Aportes en orden descendente por fecha, igual
 * que los devuelve `/financiamiento/aliados/:slug`.
 *
 * Los ids son NEGATIVOS: los reales son seriales positivos de Postgres, así
 * que un id de maqueta no puede colisionar con uno real ni siquiera por
 * accidente al concatenar listas.
 */
const SEMILLAS: SemillaAliado[] = [
  {
    id: -2,
    slug: "vigia-2",
    nombre: "VIGÍA 2",
    descripcion:
      "Organización de maqueta. Existe para poder mirar cómo se ve una ficha de aliado con varios aportes y varias regiones.",
    web: "https://ejemplo-maqueta.org",
    email: "contacto@ejemplo-maqueta.org",
    tipo: "empresa",
    aportes: [
      { codigo: "MAQ-2026-00034", contratos: 10, estado: "pagada", pagadaAt: "2026-09-19T14:10:00.000Z", ubigeo: "02", zona: "Áncash", procesados: 0, senales: 0, enRevision: 0 },
      { codigo: "MAQ-2026-00030", contratos: 12, estado: "pagada", pagadaAt: "2026-09-12T11:02:00.000Z", ubigeo: "16", zona: "Loreto", procesados: 0, senales: 0, enRevision: 0 },
      { codigo: "MAQ-2026-00026", contratos: 15, estado: "en_proceso", pagadaAt: "2026-08-28T16:45:00.000Z", ubigeo: "08", zona: "Cusco", procesados: 9, senales: 4, enRevision: 1 },
      { codigo: "MAQ-2026-00022", contratos: 18, estado: "en_proceso", pagadaAt: "2026-08-09T09:30:00.000Z", ubigeo: "12", zona: "Junín", procesados: 12, senales: 6, enRevision: 2 },
      { codigo: "MAQ-2026-00017", contratos: 20, estado: "procesada", pagadaAt: "2026-07-21T13:15:00.000Z", ubigeo: "20", zona: "Piura", procesados: 20, senales: 9, enRevision: 2 },
      { codigo: "MAQ-2026-00011", contratos: 20, estado: "procesada", pagadaAt: "2026-06-29T10:05:00.000Z", ubigeo: "13", zona: "La Libertad", procesados: 20, senales: 9, enRevision: 1 },
      { codigo: "MAQ-2026-00006", contratos: 25, estado: "procesada", pagadaAt: "2026-06-11T15:40:00.000Z", ubigeo: "15", zona: "Lima", procesados: 25, senales: 13, enRevision: 2 },
    ],
  },
  {
    id: -3,
    slug: "vigia-3",
    nombre: "VIGÍA 3",
    descripcion: "Organización de maqueta, con toda su cola ya leída.",
    web: "https://ejemplo-maqueta.pe",
    tipo: "organizacion",
    aportes: [
      { codigo: "MAQ-2026-00020", contratos: 14, estado: "procesada", pagadaAt: "2026-08-05T12:20:00.000Z", ubigeo: "18", zona: "Moquegua", procesados: 14, senales: 4, enRevision: 1 },
      { codigo: "MAQ-2026-00015", contratos: 20, estado: "procesada", pagadaAt: "2026-07-16T17:55:00.000Z", ubigeo: "04", zona: "Arequipa", procesados: 20, senales: 7, enRevision: 2 },
      { codigo: "MAQ-2026-00008", contratos: 30, estado: "procesada", pagadaAt: "2026-06-24T08:35:00.000Z", ubigeo: "21", zona: "Puno", procesados: 30, senales: 11, enRevision: 2 },
    ],
  },
  {
    id: -4,
    slug: "vigia-4",
    nombre: "VIGÍA 4",
    tipo: "persona",
    aportes: [
      { codigo: "MAQ-2026-00036", contratos: 8, estado: "pagada", pagadaAt: "2026-09-20T19:05:00.000Z", ubigeo: "25", zona: "Ucayali", procesados: 0, senales: 0, enRevision: 0 },
      { codigo: "MAQ-2026-00032", contratos: 10, estado: "en_proceso", pagadaAt: "2026-09-04T10:50:00.000Z", ubigeo: "06", zona: "Cajamarca", procesados: 7, senales: 2, enRevision: 1 },
    ],
  },
];

export const SLUGS_MAQUETA: readonly string[] = SEMILLAS.map((s) => s.slug);

/** Cuántos aliados inventados hay, para que el aviso no escriba "tres" a mano. */
export const CANTIDAD_MAQUETA = SEMILLAS.length;

/** Nombres en prosa: "VIGÍA 2, VIGÍA 3 y VIGÍA 4". */
export const NOMBRES_MAQUETA = SEMILLAS.map((s) => s.nombre).reduce(
  (txt, n, i, xs) => (i === 0 ? n : i === xs.length - 1 ? `${txt} y ${n}` : `${txt}, ${n}`),
  "",
);

export const esSlugMaqueta = (slug: string | null | undefined): boolean =>
  !!slug && SLUGS_MAQUETA.includes(slug);

/**
 * ¿Este aporte cae dentro del ámbito filtrado? Los aportes de maqueta viven a
 * nivel departamento (2 dígitos), así que un filtro provincial o distrital
 * cuenta si comparte departamento — que es como el backend agrupa la cola.
 */
const enAmbito = (ubigeo: string, region?: string) => !region || region.slice(0, 2) === ubigeo;

function aportesDe(semilla: SemillaAliado, region?: string): AporteMaqueta[] {
  return semilla.aportes.filter((a) => enAmbito(a.ubigeo, region));
}

const suma = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((n, x) => n + f(x), 0);

/**
 * Filas de ranking de los aliados de maqueta, con la misma forma exacta que
 * devuelve `/financiamiento/ranking`. Ordenadas por contratos financiados,
 * igual que el backend; `posicion` se recalcula en el muro al mezclarlas con
 * las reales, así que acá va 0.
 */
export function rankingMaqueta(region?: string): RankingRow[] {
  return SEMILLAS.map((s): RankingRow | null => {
    const aportes = aportesDe(s, region);
    if (aportes.length === 0) return null;
    return {
      posicion: 0,
      id: s.id,
      tipo: s.tipo,
      nombre: s.nombre,
      slug: s.slug,
      logoUrl: null,
      contratosFinanciados: suma(aportes, (a) => a.contratos),
      zonas: new Set(aportes.map((a) => a.ubigeo)).size,
      senalesHalladas: suma(aportes, (a) => a.senales),
      contratosProcesados: suma(aportes, (a) => a.procesados),
      enRevision: suma(aportes, (a) => a.enRevision),
      desde: aportes[aportes.length - 1].pagadaAt,
    };
  })
    .filter((r): r is RankingRow => r !== null)
    .sort((a, b) => b.contratosFinanciados - a.contratosFinanciados);
}

/**
 * Lo que hay que sumarle a la cascada colectiva para que siga cuadrando con el
 * muro. Sin esto, la página diría "45 financiados" arriba y listaría 247 abajo.
 */
export function totalesMaqueta(region?: string) {
  const aportes = SEMILLAS.flatMap((s) => aportesDe(s, region));
  return {
    aliados: SEMILLAS.filter((s) => aportesDe(s, region).length > 0).length,
    financiados: suma(aportes, (a) => a.contratos),
    leidos: suma(aportes, (a) => a.procesados),
    conSenal: suma(aportes, (a) => a.senales),
    enRevision: suma(aportes, (a) => a.enRevision),
  };
}

/** Perfil completo, con la misma forma que `/financiamiento/aliados/:slug`. */
export function perfilMaqueta(slug: string): {
  aliado: { id: number; tipo: RankingRow["tipo"]; nombre: string; slug: string; logoUrl: string | null; desde: string; descripcion?: string; web?: string; email?: string };
  contribuciones: ContribucionAliado[];
} | null {
  const s = SEMILLAS.find((x) => x.slug === slug);
  if (!s) return null;
  return {
    aliado: {
      id: s.id,
      tipo: s.tipo,
      nombre: s.nombre,
      slug: s.slug,
      logoUrl: null,
      desde: s.aportes[s.aportes.length - 1].pagadaAt,
      descripcion: s.descripcion,
      web: s.web,
      email: s.email,
    },
    contribuciones: s.aportes.map((a) => ({
      codigo: a.codigo,
      contratos: a.contratos,
      estado: a.estado,
      pagadaAt: a.pagadaAt,
      ubigeo: a.ubigeo,
      zona: a.zona,
      procesados: a.procesados,
      senales: a.senales,
      enRevision: a.enRevision,
    })),
  };
}

// ─── Comprobante de maqueta ──────────────────────────────────────────────────

/**
 * Objetos de contratación genéricos. A propósito no nombran ninguna entidad,
 * distrito ni proveedor: sirven para que la lista tenga longitudes de línea
 * realistas y nada más. El campo `entidad` de cada contrato va en `null`.
 */
const OBJETOS = [
  "Adquisición de equipos de cómputo para uso administrativo",
  "Servicio de mantenimiento correctivo de infraestructura vial urbana",
  "Adquisición de material médico e insumos de laboratorio",
  "Suministro de combustible para unidades de la flota institucional",
  "Adquisición de mobiliario escolar",
  "Servicio de limpieza pública y recolección de residuos sólidos",
  "Adquisición de materiales de construcción para obra de menor cuantía",
  "Servicio de consultoría para la elaboración de expediente técnico",
  "Adquisición de uniformes y equipo de protección personal",
  "Mejoramiento del servicio de agua potable en zona urbana",
  "Adquisición de kits de alimentos para programa social",
  "Servicio de alquiler de maquinaria pesada por horas máquina",
];

/** Generador determinista: el mismo código de aporte da siempre la misma lista. */
function semillaDe(txt: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < txt.length; i++) {
    h ^= txt.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

const dias = (iso: string, n: number) => new Date(new Date(iso).getTime() + n * 86_400_000).toISOString();

/**
 * Comprobante de un aporte de maqueta, con la misma forma que
 * `/financiamiento/impacto/:codigo`. El orden de los contratos no es aleatorio:
 * primero los que salieron con señal, después los que esperan revisión humana,
 * después los leídos sin señal y al final los que siguen en la cola — que es
 * el mismo orden de lectura que tiene un comprobante real interesante.
 */
export function comprobanteMaqueta(codigo: string): Comprobante | null {
  const semilla = SEMILLAS.find((s) => s.aportes.some((a) => a.codigo === codigo));
  const aporte = semilla?.aportes.find((a) => a.codigo === codigo);
  if (!semilla || !aporte) return null;

  const rnd = semillaDe(codigo);
  const asignados = aporte.estado === "pagada" ? 0 : aporte.contratos;
  const sinSenal = Math.max(0, aporte.procesados - aporte.senales - aporte.enRevision);

  const detalle: ComprobanteContrato[] = [];
  for (let i = 0; i < asignados; i++) {
    const conSenal = i < aporte.senales;
    const enRevision = !conSenal && i < aporte.senales + aporte.enRevision;
    const leido = i < aporte.procesados;
    // Una de cada cinco señales es alta. La proporción importa: si la mitad de
    // los contratos saliera con severidad alta, la maqueta estaría diciendo que
    // este producto reparte acusaciones, que es exactamente lo que no hace.
    const alta = conSenal && i % 5 === 0;
    const valor = Math.round((12_000 + rnd() * 1_450_000) / 100) * 100;
    detalle.push({
      ocid: `MAQUETA-${codigo.replace(/^MAQ-/, "")}-${String(i + 1).padStart(3, "0")}`,
      asignadaAt: aporte.pagadaAt,
      procesadaAt: leido ? dias(aporte.pagadaAt, 1 + (i % 9)) : null,
      titulo: OBJETOS[(i + codigo.length) % OBJETOS.length],
      valorReferencial: valor,
      entidad: null,
      alertaCodigo: null,
      alertaEstado: enRevision ? "revision" : conSenal ? "publicada" : null,
      score: conSenal ? (alta ? 72 + Math.floor(rnd() * 20) : 44 + Math.floor(rnd() * 24)) : leido ? Math.floor(rnd() * 30) : null,
      severidad: conSenal ? (alta ? "alta" : "media") : null,
      banderas: conSenal ? 1 + Math.floor(rnd() * 3) : 0,
    });
  }

  const montoAuditado = detalle.filter((d) => d.procesadaAt != null).reduce((n, d) => n + (d.valorReferencial ?? 0), 0);

  return {
    codigo: aporte.codigo,
    contratos: aporte.contratos,
    montoPen: aporte.contratos * 3,
    estado: aporte.estado,
    pagadaAt: aporte.pagadaAt,
    createdAt: aporte.pagadaAt,
    mensajePublico: null,
    ubigeo: aporte.ubigeo,
    zona: aporte.zona,
    nivel: "departamento",
    financiador: semilla.nombre,
    tipo: semilla.tipo,
    slug: semilla.slug,
    logoUrl: null,
    resumen: {
      asignados,
      procesados: aporte.procesados,
      pendientes: aporte.contratos - asignados,
      senales: detalle.reduce((n, d) => n + d.banderas, 0),
      contratosConSenal: aporte.senales,
      enRevision: aporte.enRevision,
      montoAuditado,
    },
    detalle,
  };
}

/** Sanity check del archivo: cada aporte cierra consigo mismo. Se corre en dev. */
if (process.env.NODE_ENV !== "production") {
  for (const s of SEMILLAS) {
    for (const a of s.aportes) {
      if (a.procesados > a.contratos || a.senales + a.enRevision > a.procesados) {
        // eslint-disable-next-line no-console
        console.warn(`[maqueta-aliados] cifras incoherentes en ${a.codigo}`);
      }
    }
  }
}
