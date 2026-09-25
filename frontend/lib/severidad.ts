/**
 * Fuente única de severidad del producto (DESIGN_SYSTEM.md §3.7, §10.1 y §10.4).
 *
 * Antes de este archivo había SIETE escaleras distintas para el mismo score
 * 0–100, y dos estaban invertidas entre sí: un contrato con score 75 se
 * pintaba ámbar en ProvinciasBars y clay en DetectionCarousel, en la misma
 * sesión. El usuario no podía aprender el código de color porque no existía
 * un código de color.
 *
 * Dos vocabularios, porque son dos preguntas distintas:
 *
 *   · La severidad de UNA SEÑAL — "Señal alta", "Señal media", "Señal baja"
 *     (`SEVERIDAD`, `severidadDeBandera`).
 *   · El PESO DEL RIESGO de un CONTRATO — el tramo de su score, que sólo existe
 *     si tiene señales: "Riesgo alto", "Riesgo medio", "Riesgo bajo"; o "Sin
 *     señales" si el análisis terminó sin ninguna (`severidadDeScore`).
 *
 * Un contrato de riesgo bajo puede traer una señal alta (OECE-1226168: score 35,
 * una señal alta), así que las dos escalas nunca comparten palabra.
 *
 * Reglas que acompañan a estos tokens y no son negociables:
 *   1. **Tres canales, siempre**: color + ícono + palabra. Por eso existe el
 *      componente <Severidad>, que ya trae los tres juntos.
 *   2. **Nunca un check verde sobre un contrato con señales.** El check y el
 *      verde (`moss`) son sólo para "Sin señales" y lo verificado. Hasta
 *      2026-09 un score 1–39 decía "Sin señal relevante" con el check: 29
 *      contratos con señales publicadas —11 con una señal alta— se veían
 *      limpios en la lista mientras /app/hallazgos los listaba.
 *   3. **La marca no es severidad**: ningún token de este archivo es granate.
 *
 * Los cortes son los de `riesgoDe` (70/40) porque son los que el backend usa.
 * `clay` queda FUERA del vocabulario: era un cuarto tono para un cuarto nivel
 * que no existe.
 */

export type NivelSeveridad = "alta" | "media" | "baja" | "sin_analizar";

export type SeveridadUI = {
  nivel: NivelSeveridad;
  etiqueta: string;
  /**
   * Clave de ícono lucide. String, no componente: cruza el límite server→client sin romperse.
   * alerta = AlertTriangle · atencion = CircleAlert · info = Info · ok = CircleCheck (sólo positivo) · vacio = CircleDashed.
   */
  icono: "alerta" | "atencion" | "info" | "ok" | "vacio";
  texto: string;
  punto: string;
  fondo: string;
  borde: string;
};

/**
 * Severidad de UNA SEÑAL. `baja` es una señal real de poco peso: tono neutro
 * (§3.7: "Señal baja / sin dato → mute · paperDeep, texto inkSoft"), nunca el
 * verde de lo positivo — ese verde es el del sello "Cotejada", y en una columna
 * de 25 filas una señal baja se vería idéntica a una verificación correcta.
 */
export const SEVERIDAD: Record<NivelSeveridad, SeveridadUI> = {
  alta: {
    nivel: "alta",
    etiqueta: "Señal alta",
    icono: "alerta",
    texto: "text-rust",
    punto: "bg-rust",
    fondo: "bg-crimson-soft",
    borde: "border-rust/40",
  },
  media: {
    nivel: "media",
    etiqueta: "Señal media",
    // `text-amber` daba 3.47:1 sobre papel — por debajo del piso de 4.5. El punto
    // y el fondo siguen en `amber`, correcto como relleno; sólo el texto cambia.
    icono: "atencion",
    texto: "text-amberTexto",
    punto: "bg-amber",
    fondo: "bg-amber-soft",
    borde: "border-amber/40",
  },
  baja: {
    nivel: "baja",
    etiqueta: "Señal baja",
    // §7: `Info` para la baja — ni el triángulo de la alta ni el círculo de la media.
    icono: "info",
    texto: "text-inkSoft",
    punto: "bg-mute",
    fondo: "bg-paperDeep",
    borde: "border-mute/30",
  },
  sin_analizar: {
    nivel: "sin_analizar",
    // "Sin leer": la palabra de la columna de lectura y del filtro (§10.1), y entra en una celda.
    etiqueta: "Sin leer",
    icono: "vacio",
    texto: "text-mute",
    punto: "bg-mute",
    fondo: "bg-paperDeep",
    borde: "border-line",
  },
};

/**
 * Lo positivo: contrato leído y publicado SIN ninguna señal, precio alineado al
 * mercado, dato verificado. Es el único que lleva el check y el verde. `nivel`
 * queda en "baja" sólo para ordenar (el tipo no tiene un nivel "ninguno").
 */
export const SIN_SENALES: SeveridadUI = {
  nivel: "baja",
  etiqueta: "Sin señales",
  icono: "ok",
  texto: "text-mossTexto",
  punto: "bg-moss",
  fondo: "bg-moss/10",
  borde: "border-moss/40",
};

/** Alias con el nombre del propósito, para lo positivo que no es "sin señales" (mercado alineado). */
export const POSITIVO = SIN_SENALES;

/**
 * Alerta frenada para revisión humana (§10.4): se dice "En revisión" y NADA más
 * —sin puntaje, sin señales, sin montos cuestionados—. Tono neutro: no es un
 * veredicto, es una espera.
 */
export const EN_REVISION: SeveridadUI = {
  nivel: "sin_analizar",
  etiqueta: "En revisión",
  icono: "vacio",
  texto: "text-inkSoft",
  punto: "bg-inkSoft",
  fondo: "bg-paperDeep",
  borde: "border-inkSoft/30",
};

/** Nombre del eje de los tramos por score, para cabeceras de columna, filtros y leyendas. */
export const ETIQUETA_PESO = "Peso del riesgo";

/** Los tramos del peso del riesgo de un contrato CON señales (el score es la suma de sus pesos). */
const PESO: Record<"alta" | "media" | "baja", SeveridadUI> = {
  alta: { ...SEVERIDAD.alta, etiqueta: "Riesgo alto" },
  media: { ...SEVERIDAD.media, etiqueta: "Riesgo medio" },
  baja: { ...SEVERIDAD.baja, etiqueta: "Riesgo bajo" },
};

/** Los dos únicos cortes que existen. No se redefinen en ningún componente. */
export const CORTE_ALTA = 70;
export const CORTE_MEDIA = 40;

export function nivelDeScore(score: number | null | undefined): NivelSeveridad {
  if (score == null) return "sin_analizar";
  if (score >= CORTE_ALTA) return "alta";
  if (score >= CORTE_MEDIA) return "media";
  return "baja";
}

/**
 * Peso del riesgo de un CONTRATO a partir de su score.
 *
 * El score es la suma de los pesos de sus señales y todo peso es ≥ 5
 * (backend/agent/tools/persistence/shared.py), así que score 0 ⇔ ninguna señal:
 *   · null      → "Sin leer";
 *   · 0         → "Sin señales" (el único caso con el check verde);
 *   · 1–39      → "Riesgo bajo": HAY señales, de poco peso — tono neutro;
 *   · 40–69/≥70 → "Riesgo medio" / "Riesgo alto".
 */
export function severidadDeScore(score: number | null | undefined): SeveridadUI {
  const nivel = nivelDeScore(score);
  if (nivel === "sin_analizar") return SEVERIDAD.sin_analizar;
  if (score === 0) return SIN_SENALES;
  return PESO[nivel];
}

/**
 * Lo mismo, con todo lo que la fila de un contrato sabe: si la alerta está en
 * revisión manda "En revisión" (el API manda score null y no hay que leerlo como
 * "sin leer"), y si se conoce el número de señales PUBLICADAS, un leído con 0 es
 * "Sin señales" — la palabra nunca contradice el conteo.
 */
export function severidadDeContrato(c: {
  score: number | null | undefined;
  banderas?: number | null;
  enRevision?: boolean | null;
}): SeveridadUI {
  if (c.enRevision) return EN_REVISION;
  if (c.score != null && c.banderas === 0) return SIN_SENALES;
  return severidadDeScore(c.score);
}

/** Severidad de UNA SEÑAL (bandera) ya clasificada por el backend. */
export function severidadDeBandera(s: "alta" | "media" | "baja"): SeveridadUI {
  return SEVERIDAD[s] ?? SEVERIDAD.baja;
}
