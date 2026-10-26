/**
 * Helpers compartidos de los grafos y las tablas del mapa de poder (components/grafo, components/entidad/*Viz/Explorador*).
 * Antes cada grafo reimplementaba corto/rad/ángulos/anchor/radio: acá viven una sola vez. Sólo lógica, sin JSX
 * ni clases de color (los colores son tokens y se arman en los primitivos, components/grafo/primitivos.tsx).
 */
import { tituloNatural } from "@/lib/landing";
import { TIPO_CRUCE } from "@/lib/cruces";

/** Lienzo cuadrado por defecto de los radiales (viewBox 0 0 VB VB) y su centro. */
export const VB = 1000;
export const C = VB / 2;

export const rad = (grados: number) => (grados * Math.PI) / 180;

/** Título natural recortado a n caracteres con elipsis. La forma repetida en 9 grafos. */
export function corto(s: string, n: number): string {
  const t = tituloNatural(s);
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** Ángulo (en grados) del i-ésimo de N nodos repartidos en un anillo; arranca arriba (-90). */
export const anguloEnAnillo = (i: number, n: number, desde = -90) => desde + (i * 360) / Math.max(n, 1);

/** Radio del nodo por raíz del valor (área ~ valor), acotado. El patrón de todos los radiales. */
export const radioPorRaiz = (valor: number, max: number, base: number, k: number) =>
  base + k * Math.sqrt(Math.max(valor, 0) / Math.max(max, 1));

/** Ancla del rótulo según de qué lado del centro cae el nodo (coseno del ángulo). */
export const anchorDeCos = (cosAng: number): "start" | "end" => (cosAng >= 0 ? "start" : "end");

/** Un lazo «fuerte»: la empresa financió al partido que gobierna o tiene un socio contratado por la entidad. */
export const esLazoFuerte = (lazos: string[]) =>
  lazos.includes("partido_gobernante") || lazos.includes("socio_en_entidad");

/**
 * Texto humano de un tipo de lazo empresa↔partido/entidad: el nombre corto del catálogo de cruces (lib/cruces.ts), el
 * mismo que en la lista de contratos. Antes cada grafo tenía el suyo («socio en la entidad», «socio adentro», «socio
 * dentro»: tres nombres para el mismo cruce).
 */
export const etiquetaLazo = (l: string) => TIPO_CRUCE[l]?.corto ?? l;

/**
 * El nombre sin el tipo de institución, para donde todas son del mismo tipo (un anillo de municipalidades, los
 * distritos de una provincia): "Municipalidad Distrital de San Marcos" → "San Marcos". Sin prefijo, el nombre entero.
 */
const PREFIJOS_TIPO = /^(municipalidad (distrital|provincial|metropolitana)( de| del)?|gobierno regional( de| del)?|ministerio( de| del)?)\s+/i;
export const nombreSinTipo = (nombre: string) => tituloNatural(nombre.trim().replace(PREFIJOS_TIPO, "")) || tituloNatural(nombre);

/** Nivel de gobierno de una entidad territorial, en palabras. */
export const nivelTxt = (n: string) =>
  n === "regional" ? "Gobierno regional"
    : n === "provincial" ? "Municipalidad provincial"
    : n === "distrital" ? "Municipalidad distrital"
    : n;

// ─── Los tres indicios de captura (migración 125) ────────────────────────────

export type SeveridadIndicio = "alta" | "media" | "baja";

/**
 * Los cruces que cuenta el mapa de poder, con el campo de su conteo (contratos, no empresas) y la severidad del tipo
 * en el catálogo: financiar al partido y el socio contratado por la entidad son graves; venderle a la campaña es media
 * desde S/ 1,000 (migración 87), así que el conjunto se muestra como media. En el orden en que se muestran.
 */
export const TIPOS_CAPTURA = [
  { tipo: "partido_gobernante", campo: "n_financiaron", severidad: "alta" },
  { tipo: "socio_en_entidad", campo: "n_socio", severidad: "alta" },
  { tipo: "vendio_gobernante", campo: "n_vendieron", severidad: "media" },
] as const satisfies readonly { tipo: string; campo: string; severidad: SeveridadIndicio }[];

export type TipoCaptura = (typeof TIPOS_CAPTURA)[number]["tipo"];

/** Lo que trae cada fila del mapa de poder sobre sus indicios (los conteos son de CONTRATOS). */
export interface ConteosCaptura {
  n_financiaron?: number | null;
  n_vendieron?: number | null;
  n_socio?: number | null;
}

export interface Indicio {
  tipo: TipoCaptura;
  n: number;
  severidad: SeveridadIndicio;
  corto: string;
  /** El nombre para el chip angosto (lib/cruces.ts `chip`); sin él, `corto`. */
  chip?: string;
  explica: string;
}

const RANGO_SEV: Record<SeveridadIndicio, number> = { alta: 0, media: 1, baja: 2 };

/** Los indicios con al menos un contrato, el más grave primero y, a igual gravedad, el de más contratos. */
export function indiciosDe(x: ConteosCaptura | null | undefined): Indicio[] {
  if (!x) return [];
  return TIPOS_CAPTURA.map((t) => ({
    tipo: t.tipo,
    n: Number(x[t.campo] ?? 0) || 0,
    severidad: t.severidad,
    corto: TIPO_CRUCE[t.tipo]?.corto ?? t.tipo,
    chip: TIPO_CRUCE[t.tipo]?.chip ?? TIPO_CRUCE[t.tipo]?.corto ?? t.tipo,
    explica: TIPO_CRUCE[t.tipo]?.explica ?? "",
  }))
    .filter((i) => i.n > 0)
    .sort((a, b) => RANGO_SEV[a.severidad] - RANGO_SEV[b.severidad] || b.n - a.n);
}

/** ¿La fila trae el desglose por tipo? (una API vieja manda sólo el total). */
export const traeDesglose = (x: ConteosCaptura | null | undefined) =>
  !!x && TIPOS_CAPTURA.some((t) => typeof x[t.campo] === "number");

/** Suma los conteos de varias filas (los totales de un departamento, de una provincia). */
export function sumarConteos(xs: (ConteosCaptura & { n_captura?: number | null; monto_captura?: number | null })[]) {
  const s = { n_captura: 0, monto_captura: 0, n_financiaron: 0, n_vendieron: 0, n_socio: 0, conIndicio: 0, total: xs.length, desglose: false };
  for (const x of xs) {
    const n = Number(x.n_captura ?? 0) || 0;
    s.n_captura += n;
    s.monto_captura += Number(x.monto_captura ?? 0) || 0;
    s.n_financiaron += Number(x.n_financiaron ?? 0) || 0;
    s.n_vendieron += Number(x.n_vendieron ?? 0) || 0;
    s.n_socio += Number(x.n_socio ?? 0) || 0;
    if (n > 0) s.conIndicio += 1;
    if (traeDesglose(x)) s.desglose = true;
  }
  return s;
}

/**
 * Los contratos con indicio de una entidad en la lista de contratos (/app/contratos acepta `entidad` y `cruces`/`cruce`,
 * backend/api/src/routes/contratos.ts): con un tipo, sólo ese; sin tipo, los tres. Es el mismo universo que cuenta el
 * mapa de poder (casos_cruce de esa entidad), así el número del enlace y el de la lista coinciden.
 */
/**
 * La lista de contratos con indicio de una entidad. Con `periodo` (el del gobierno vigente, `periodoInicio`/`periodoFin`)
 * cuenta lo mismo que su cifra: la captura de un partido es la de SU gobierno (migración 140), no la de gestiones
 * anteriores.
 */
export function rutaContratosIndicio(entidadRuc: string, tipo?: TipoCaptura, periodo?: { desde?: string | null; hasta?: string | null }): string {
  const p = new URLSearchParams({ entidad: entidadRuc });
  if (tipo) p.set("cruces", tipo);
  else p.set("cruce", TIPOS_CAPTURA.map((t) => t.tipo).join(","));
  if (periodo?.desde) p.set("desde", periodo.desde);
  if (periodo?.hasta) p.set("hasta", periodo.hasta);
  return `/app/contratos?${p.toString()}`;
}

/** La parte (0 a 1) de `de` que es `con`; 0 sin denominador. */
export const parte = (con: number, de: number) => (de > 0 ? con / de : 0);

/**
 * Las pestañas de /app/poder (`?vista=`), con su nombre. Vive aquí y no en el componente de las pestañas (cliente)
 * porque la página (servidor) también las nombra en la ruta de navegación.
 */
export const VISTAS_PODER = {
  partidos: "Partidos",
  entidades: "Entidades",
  territorio: "Territorio",
  nacional: "Gobierno Nacional",
  instituciones: "Instituciones",
} as const;
