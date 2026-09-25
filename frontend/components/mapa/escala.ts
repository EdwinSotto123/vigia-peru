/**
 * Escala del coropleto del mapa. Cinco escalones por **cuantiles**, nunca por
 * `valor / máximo`.
 *
 * Por qué: medido contra `/contratos/geo?nivel=departamento` el 2026-09-22,
 * Lima contrata S/ 5 723 M y Tumbes S/ 25 M. Con la escala lineal que tenía el
 * mapa (`t < 0.2` → escalón más bajo) **21 de los 25 departamentos caían en el
 * mismo escalón**: el país entero se veía de un solo color y el mapa no decía
 * nada. Con cuantiles cada escalón tiene cinco departamentos por construcción,
 * y la leyenda publica los valores de cada corte para que el usuario sepa qué
 * significa cada tono en vez de adivinar "más/menos".
 *
 * Todas las medidas salen de datos reales de la API (`ContratoZona`), en los
 * tres niveles que devuelve `/contratos/geo`. No hay ninguna métrica local.
 */

import type { ContratoZona } from "@/lib/contratos";
import { numero, solesCompacto } from "@/lib/formato";

export type MedidaId = "monto" | "contratos" | "cola" | "leidos" | "senales";

export interface Medida {
  id: MedidaId;
  /** Etiqueta del control (corta: entra en la barra de filtros). */
  label: string;
  /** Qué se está pintando, en palabras, para el encabezado del mapa. */
  titulo: string;
  /** Una línea que explica el dato y de dónde sale. */
  ayuda: string;
  valor: (z: ContratoZona) => number;
  /** Formato compacto para la leyenda y el popover. */
  formato: (n: number) => string;
  /** Sustantivo para el popover: "892 en cola". */
  sustantivo: (n: number) => string;
}

const enteros = (n: number) => numero(n);

/**
 * Montos del mapa, compactos: "S/ 5.7 mil M" · "S/ 196.0 M" · "S/ 840 mil". Es el
 * formato compacto ÚNICO de `lib/formato` (DESIGN_SYSTEM.md §10.3); el nombre queda
 * por compatibilidad con los importadores.
 */
export function formatoSoles(n: number): string {
  return solesCompacto(n);
}

export const MEDIDAS: Medida[] = [
  {
    id: "monto",
    label: "Monto",
    // Es la suma del valor REFERENCIAL de las convocatorias, no lo pagado ni lo adjudicado
    // (auditoría de coherencia 2026-09-24, punto 11), y la zona es la sede de la entidad.
    titulo: "Valor referencial convocado",
    ayuda: "Suma del valor referencial de las convocatorias publicadas en el SEACE, por la sede de la entidad que compra. No es lo pagado.",
    valor: (z) => z.montoPen ?? 0,
    formato: formatoSoles,
    sustantivo: (n) => `${formatoSoles(n)} en valor referencial`,
  },
  {
    id: "contratos",
    label: "Contratos",
    titulo: "Contratos publicados",
    ayuda: "Convocatorias publicadas en el SEACE (datos abiertos del OECE) que Vigía tiene en su base, sin importar su estado.",
    valor: (z) => z.total ?? 0,
    formato: enteros,
    sustantivo: (n) => `${enteros(n)} ${n === 1 ? "contrato publicado" : "contratos publicados"}`,
  },
  {
    id: "cola",
    label: "En cola",
    titulo: "Contratos en cola de lectura",
    ayuda: "Contratos que esperan financiamiento para leerse: su tipo y etapa ya se pueden analizar hoy.",
    valor: (z) => z.enCola ?? 0,
    formato: enteros,
    sustantivo: (n) => `${enteros(n)} en cola`,
  },
  {
    id: "leidos",
    label: "Leídos",
    titulo: "Contratos leídos por los agentes",
    ayuda: "Contratos cuyo análisis terminó, por cualquier vía: publicados, en revisión o descartados.",
    valor: (z) => z.procesados ?? 0,
    formato: enteros,
    sustantivo: (n) => `${enteros(n)} leído${n === 1 ? "" : "s"}`,
  },
  {
    id: "senales",
    // No es "con señales" (DESIGN_SYSTEM.md §10.1: al menos una señal publicada, de
    // cualquier peso): `conSenales` de /contratos/geo cuenta score ≥ 40, o sea el peso
    // del riesgo medio o alto. Se nombra por lo que mide.
    label: "Riesgo medio o alto",
    titulo: "Contratos con peso del riesgo medio o alto",
    ayuda: "Leídos cuyo dictamen publicado suma un peso del riesgo de 40 o más, con la norma citada en cada señal.",
    valor: (z) => z.conSenales ?? 0,
    formato: enteros,
    sustantivo: (n) => `${enteros(n)} de riesgo medio o alto`,
  },
];

export const medidaPorId = (id: MedidaId): Medida => MEDIDAS.find((m) => m.id === id) ?? MEDIDAS[0];

/**
 * Rampa del coropleto, en añil (el azul del tejido del isotipo).
 *
 * La anterior era cálida (#D9B97A → #4A150C) y tenía tres problemas medidos:
 *
 * 1. No pertenecía a ningún lado. El hub del producto estaba pintado con una
 *    paleta que no existe en el resto del sitio; ni el color de marca de
 *    entonces aparecía en todo el mapa.
 * 2. Chocaba de TONO con la severidad. Los puntos de señal son rojos (rust
 *    #A81E12) y caían sobre marrones rojizos: mismo tono, apenas distinta
 *    luminancia (1,28:1 sobre el cuarto escalón). Un punto de alarma rojo
 *    sobre un fondo rojizo es exactamente lo que un mapa no debe hacer.
 * 3. Su escalón más claro daba 1,88:1 contra el lienzo blanco.
 *
 * Esta rampa es AÑIL, el azul del tejido del isotipo (textil-anil #2D3E6F,
 * DESIGN_SYSTEM.md §3.9). No es granate a propósito: el punto de señal es rojo
 * (rust) y un rojo sobre granate volvería al problema 2. Añil y rojo son tonos
 * opuestos, así que el punto se separa por matiz y no sólo por brillo, que es
 * la separación que sobrevive a una pantalla barata y al sol de la calle.
 * (Hasta sept 2026 era violeta, el color de marca de entonces.)
 *
 * Mismas luminancias que la rampa violeta anterior (el umbral de tinta de
 * abajo no cambia): claro 2,51:1 contra blanco, oscuro 13,42:1, separación
 * mínima entre escalones adyacentes 1,50.
 */
export const RAMPA = ["#8DA2DE", "#6480CB", "#4360B0", "#314781", "#202D54"] as const;

/**
 * "Sin dato" es neutro, no un sexto escalón. Antes era un crema (#E8DFC7) que
 * pertenecía a la familia de la rampa cálida y se leía como "poquito", cuando
 * significa "no sabemos". En gris no compite con la escala.
 */
export const SIN_DATO = "#EEF0F3";
export const SIN_DATO_TRAMA = "#C2C8D0";
export const ESCALONES = RAMPA.length;

/**
 * Cortes por cuantil sobre los valores presentes. Devuelve como máximo
 * `ESCALONES - 1` cortes; si hay empates (p. ej. muchos ceros) se colapsan,
 * y la escala queda con menos escalones en vez de fingir que los distingue.
 */
export function cortesPorCuantil(valores: number[], escalones = ESCALONES): number[] {
  const v = valores.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (v.length < 2) return [];
  const cortes: number[] = [];
  for (let i = 1; i < escalones; i++) {
    const idx = Math.min(v.length - 1, Math.floor((i / escalones) * v.length));
    const c = v[idx];
    if (cortes.length === 0 ? c > v[0] : c > cortes[cortes.length - 1]) cortes.push(c);
  }
  return cortes;
}

/** Índice de escalón (0 … cortes.length) de un valor dentro de la escala. */
export function escalonDe(valor: number, cortes: number[]): number {
  for (let i = 0; i < cortes.length; i++) if (valor < cortes[i]) return i;
  return cortes.length;
}

export interface Escala {
  cortes: number[];
  min: number;
  max: number;
  /** Colores efectivamente en uso (tantos como escalones reales). */
  colores: string[];
  /** Límites [desde, hasta] de cada escalón, para rotular la leyenda con números. */
  tramos: { desde: number; hasta: number; color: string }[];
  color: (valor: number | null | undefined) => string;
  vacia: boolean;
}

/** Construye la escala completa a partir de los valores reales de las zonas visibles. */
export function construirEscala(valores: number[]): Escala {
  const limpios = valores.filter((n) => Number.isFinite(n));
  const cortes = cortesPorCuantil(limpios);
  const min = limpios.length ? Math.min(...limpios) : 0;
  const max = limpios.length ? Math.max(...limpios) : 0;
  const n = cortes.length + 1;
  // Con menos de 5 escalones reales se usan los tonos de los extremos hacia
  // adentro, así el más oscuro siempre significa "lo más alto que hay".
  const colores = RAMPA.slice(RAMPA.length - n);
  const tramos = colores.map((color, i) => ({
    desde: i === 0 ? min : cortes[i - 1],
    hasta: i === colores.length - 1 ? max : cortes[i],
    color,
  }));
  return {
    cortes,
    min,
    max,
    colores: [...colores],
    tramos,
    vacia: limpios.length === 0,
    color: (valor) => (valor == null ? SIN_DATO : colores[escalonDe(valor, cortes)] ?? SIN_DATO),
  };
}

/* ── Tinta sobre el relleno ────────────────────────────────────────────────
   Las 25 etiquetas se pintaban todas con una sola tinta (ink) sobre una
   rampa que recorre todo el rango de luminancia. El contraste medido escalón
   por escalón daba 9,57 / 5,90 / 3,41 / 1,91 / 1,20: quince de veinticinco
   nombres por debajo del piso de 4,5:1, y el más oscuro en 1,20, o sea
   invisible. Lo único que los sostenía era un halo blanco tan grueso que lo
   que el ojo leía era un bulto blanco con una palabra adentro — literalmente
   el aspecto sucio del mapa.

   La solución no es más halo: es que la tinta invierta según el fondo. */

/** Luminancia relativa WCAG de un hex. */
export function luminancia(hex: string): number {
  const h = hex.replace("#", "");
  const v = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}

/**
 * Umbral de inversión. Cae limpio entre el segundo escalón de la rampa
 * (L≈0,29) y el tercero (L≈0,15), que es donde la tinta oscura deja de
 * alcanzar el piso de contraste.
 */
const UMBRAL_TINTA = 0.22;

/** Qué color de texto y de halo corresponden sobre un relleno dado. */
export function tintaSobre(fill: string): { texto: string; halo: string } {
  const claro = !fill.startsWith("#") || luminancia(fill) >= UMBRAL_TINTA;
  return claro
    ? { texto: "#1E191B", halo: "#FFFFFF" }
    : { texto: "#FFFFFF", halo: "rgba(30,25,27,0.55)" };
}

/**
 * Peso visual del nombre, derivado de la luminancia del relleno: cuanto más
 * oscuro el departamento, más alto está en la medida activa y más grande se
 * imprime su nombre. En un mapa el tamaño del nombre ES un dato, y hoy los 25
 * se imprimían idénticos: Lima (S/ 5.723 millones) igual que Madre de Dios
 * (S/ 25 millones).
 *
 * Se deriva del color en vez de pasar el escalón como prop para no cambiar el
 * contrato de ZonaPintada, y funciona igual cuando la escala colapsa a 3 o 4
 * escalones porque hay poco dato.
 */
export function nivelDeEtiqueta(fill: string): "alto" | "medio" | "bajo" {
  if (!fill.startsWith("#")) return "bajo";
  const L = luminancia(fill);
  if (L < 0.10) return "alto";
  if (L < 0.35) return "medio";
  return "bajo";
}

/* ── Filtro "ver solo" ─────────────────────────────────────────────────────
   Acota el mapa a lo que importa para una tarea concreta, atenuando lo que
   no cumple en vez de esconderlo: el país tiene que seguir entero para que
   "dónde sí pasa esto" se lea contra "dónde no". */

export type FiltroZona = "todas" | "senal" | "financiadas" | "sinleer";

export const FILTROS: { id: FiltroZona; label: string; ayuda: string }[] = [
  { id: "todas", label: "Todas", ayuda: "Los 25 departamentos, sin acotar." },
  { id: "senal", label: "Riesgo medio o alto", ayuda: "Sólo donde hay contratos leídos con peso del riesgo medio o alto." },
  { id: "financiadas", label: "Financiadas", ayuda: "Sólo donde alguien pagó para que se leyeran contratos." },
  { id: "sinleer", label: "Sin financiar", ayuda: "Sólo donde hay contratos esperando lectura y todavía nadie financió ninguno." },
];

/**
 * ¿Esta zona pasa el filtro? Recibe las cifras ya resueltas por el contenedor.
 *
 * "Financiadas" y "Sin financiar" preguntan por el FINANCIAMIENTO, así que se
 * contestan con `/financiamiento/zonas` (`financiados`), no con `procesados` de
 * `/contratos/geo`: un contrato puede estar leído sin que nadie lo haya
 * financiado (lo leyó el equipo) y uno financiado puede no estar leído todavía.
 * Medido el 2026-09-23: "Financiadas" encendía 21 departamentos; financiados hay 5.
 */
export function pasaFiltro(
  f: FiltroZona,
  z: { conSenales?: number; enCola?: number } | undefined,
  fin?: { financiados?: number; pendientes?: number } | undefined,
): boolean {
  if (f === "todas") return true;
  if (f === "senal") return (z?.conSenales ?? 0) > 0;
  if (f === "financiadas") return (fin?.financiados ?? 0) > 0;
  if (f === "sinleer") return (fin?.pendientes ?? z?.enCola ?? 0) > 0 && (fin?.financiados ?? 0) === 0;
  return true;
}
