import type { TipoEntidad } from "./mock-entities";
import { TIPO_LABELS, TIPO_SHORT } from "./mock-entities";

/**
 * De qué tipo es una entidad del Estado.
 *
 * El backend devuelve `tipo: null` para la mayoría de las 2.121 entidades
 * reales, y el frontend hacía `e.tipo || "organismo_autonomo"`. El resultado
 * verificado en producción: la MUNICIPALIDAD DISTRITAL DE YARABAMBA aparecía
 * etiquetada como "Organismo Autónomo". Un valor por defecto elegido por
 * comodidad se convirtió en una afirmación falsa sobre una entidad pública
 * real, publicada por una plataforma cuyo argumento entero es la exactitud.
 *
 * Los nombres oficiales peruanos son muy regulares, así que el tipo se infiere
 * del nombre con alta confianza. Y cuando no se puede inferir, se dice: no se
 * inventa una categoría.
 */

const REGLAS: { re: RegExp; tipo: TipoEntidad }[] = [
  { re: /\bMUNICIPALIDAD\s+(DISTRITAL|DE\s+CENTRO\s+POBLADO)\b/i, tipo: "municipal_distrital" },
  { re: /\bMUNICIPALIDAD\s+PROVINCIAL\b/i, tipo: "municipal_provincial" },
  // "MUNICIPALIDAD METROPOLITANA DE LIMA" y cualquier municipalidad sin
  // calificativo: provincial es el encuadre correcto por defecto.
  { re: /\bMUNICIPALIDAD\b/i, tipo: "municipal_provincial" },
  { re: /\bGOBIERNO\s+REGIONAL\b|\bREGION\s+[A-ZÁÉÍÓÚÑ]/i, tipo: "gobierno_regional" },
  { re: /\bMINISTERIO\b/i, tipo: "ministerio" },
  { re: /\b(EMPRESA|E\.?P\.?S\.?|SEDAPAL|ELECTRO|EGEMSA|ENAPU|SERPOST)\b/i, tipo: "empresa_publica" },
  { re: /\b(ORGANISMO|SUPERINTENDENCIA|INSTITUTO|AUTORIDAD|CONTRALORIA|CONTRALORÍA|DEFENSORIA|DEFENSORÍA|JURADO|REGISTRO)\b/i, tipo: "organismo_autonomo" },
];

/** Devuelve el tipo inferido del nombre oficial, o null si no se puede determinar. */
export function inferirTipoEntidad(nombre: string | null | undefined): TipoEntidad | null {
  if (!nombre) return null;
  for (const r of REGLAS) if (r.re.test(nombre)) return r.tipo;
  return null;
}

/**
 * El tipo que corresponde mostrar: el que declara la API, si no el inferido del
 * nombre, y si ninguno, null — que la interfaz debe rendir como "no declarado",
 * nunca como una categoría concreta.
 */
export function tipoEntidad(
  tipoApi: string | null | undefined,
  nombre: string | null | undefined,
): TipoEntidad | null {
  if (tipoApi && tipoApi in TIPO_LABELS) return tipoApi as TipoEntidad;
  return inferirTipoEntidad(nombre);
}

export function etiquetaTipoEntidad(
  tipoApi: string | null | undefined,
  nombre: string | null | undefined,
  formato: "largo" | "corto" = "largo",
): string {
  const t = tipoEntidad(tipoApi, nombre);
  if (!t) return formato === "corto" ? "Sin clasificar" : "Tipo no declarado";
  return formato === "corto" ? TIPO_SHORT[t] : TIPO_LABELS[t];
}
