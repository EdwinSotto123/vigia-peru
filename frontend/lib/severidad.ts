/**
 * Fuente única de severidad del producto.
 *
 * Antes de este archivo había SIETE escaleras distintas para el mismo score
 * 0–100, y dos estaban invertidas entre sí: un contrato con score 75 se
 * pintaba ámbar en ProvinciasBars y clay en DetectionCarousel, en la misma
 * sesión. El usuario no podía aprender el código de color porque no existía
 * un código de color.
 *
 * Los cortes son los de `riesgoDe` (70/40) porque son los que el backend
 * usa. `clay` queda FUERA del vocabulario de severidad: era un cuarto tono
 * para un cuarto nivel que no existe — el backend sólo produce alta, media
 * y baja (SenalRiesgo["severidad"]).
 *
 * Regla que acompaña a estos tokens y no es negociable: **la severidad
 * jamás viaja sólo en color.** Siempre ícono dibujado + etiqueta. Incluso
 * con el rust corregido queda un par que se acerca bajo protanopía, y en
 * este producto confundir "media" con "alta" es confundir una pista con una
 * acusación. Por eso existe el componente <Severidad>, que ya trae los tres
 * canales juntos; usarlo es más corto que reimplementarlo mal.
 */

export type NivelSeveridad = "alta" | "media" | "baja" | "sin_analizar";

export type SeveridadUI = {
  nivel: NivelSeveridad;
  etiqueta: string;
  /** Clave de ícono lucide. String, no componente: cruza el límite server→client sin romperse. */
  icono: "alerta" | "atencion" | "ok" | "vacio";
  texto: string;
  punto: string;
  fondo: string;
  borde: string;
};

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
    icono: "atencion",
    texto: "text-amber",
    punto: "bg-amber",
    fondo: "bg-amber-soft",
    borde: "border-amber/40",
  },
  baja: {
    nivel: "baja",
    etiqueta: "Sin señal relevante",
    icono: "ok",
    texto: "text-moss",
    punto: "bg-moss",
    fondo: "bg-moss/10",
    borde: "border-moss/40",
  },
  sin_analizar: {
    nivel: "sin_analizar",
    etiqueta: "Sin leer todavía",
    icono: "vacio",
    texto: "text-mute",
    punto: "bg-mute",
    fondo: "bg-paperDeep",
    borde: "border-line",
  },
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

export function severidadDeScore(score: number | null | undefined): SeveridadUI {
  return SEVERIDAD[nivelDeScore(score)];
}

/** Para las banderas, que ya vienen clasificadas por el backend. */
export function severidadDeBandera(s: "alta" | "media" | "baja"): SeveridadUI {
  return SEVERIDAD[s];
}
