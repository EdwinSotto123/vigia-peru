/**
 * Datos de la portada, ya elegidos y formateados en el servidor.
 *
 * Las escenas de la portada son componentes cliente (necesitan el DOM para
 * animarse), pero no deben elegir ni formatear nada: reciben objetos planos. Así
 * nunca cruza una función el límite servidor/cliente —compila, pasa `tsc` y
 * revienta sólo en producción, y este repositorio ya se comió ese bug dos veces.
 */

import { esAlertaReal } from "./semillas";
import { fecha, soles } from "./formato";

export interface BanderaReal {
  regla: string;
  severidad: string;
  evidencia?: string | null;
  norma?: string | null;
}

export interface AlertaReal {
  id: string;
  /** Falta en las alertas viejas; sin código, la alerta no se muestra. */
  codigo?: string | null;
  codigoconvocatoria: string;
  objeto: string | null;
  score: number | null;
  entidad: string | null;
  proveedor: string | null;
  montoSoles: number | null;
  fechaBuenaPro: string | null;
  region: string | null;
  fuenteUrl: string | null;
  banderas: BanderaReal[] | null;
}

/** Lo que la portada muestra de un caso. Todo string, ya formateado. */
export interface CasoPortada {
  codigo: string;
  convocatoria: string;
  entidad: string;
  objeto: string;
  monto: string | null;
  proveedor: string | null;
  fecha: string | null;
  region: string | null;
  fuenteUrl: string | null;
  hallazgo: string;
  norma: string;
  severidad: "alta" | "media" | "baja";
  /** Cuántas señales más trae el mismo contrato, además de la que se muestra. */
  otrasSenales: number;
}

/**
 * Las 10 alertas `ALT-2026-00xx` son semillas del mock sembradas en la base de
 * producción (las únicas con coordenadas, por eso se colaban en cualquier mapa
 * de pines). La portada vivía mostrándolas en el ticker, y si la API caía,
 * mostraba `ALERTAS_MOCK` entero sin avisar. Acá se filtran siempre.
 */
export { esAlertaReal };

const PESO_SEVERIDAD: Record<string, number> = { alta: 3, media: 2, baja: 1 };

/**
 * Qué señales pueden ir en la portada. Sólo las que describen el PROCESO
 * (competencia, precios, plazos, forma de contratar), calculadas sobre datos
 * publicados. Quedan fuera, a propósito:
 *  - las que hablan de personas (vínculos, familiares, historial de un
 *    funcionario): la portada no es el lugar para poner un nombre propio junto a
 *    la palabra "riesgo", aunque el dato sea público;
 *  - `red_flag_documental`, la bandera genérica que un modelo redacta leyendo el
 *    PDF: es valiosa dentro del análisis, pero es la que más puede equivocarse, y
 *    en la portada un error se lee como el producto entero equivocándose.
 */
const REGLAS_DE_PROCESO =
  /^(unica_oferta_valida|unico_postor_alto|procedimiento_no_competitivo|sobreprecio_.*|oferta_igual_valor_referencial|cuantia_al_limite_del_tope|spec_restrictiva|plazo_convocatoria_minimo|emergencia_no_acreditada|directa_sin_fundamento|oferta_mas_barata_no_gana|ofertas_agrupadas)$/;

const MARCA_DE_ORGANIZACION =
  /\b(S\.?\s?A\.?\s?C|E\.?\s?I\.?\s?R\.?\s?L|S\.?\s?R\.?\s?L|S\.?\s?A|EMPRESA|SOCIEDAD|CONSORCIO|CORPORACI[OÓ]N|INVERSIONES|GRUPO|COMPA[NÑ][IÍ]A|LIMITADA|ASOCIACI[OÓ]N|CONTRATISTAS|DISTRIBUIDORA|SERVICIOS|IMPORT\w*|INC|LTDA|MUNICIPALIDAD|GOBIERNO|UNIVERSIDAD|HOSPITAL|MINISTERIO)\b/i;

/**
 * Tres o más palabras seguidas en mayúsculas sin ninguna marca de organización
 * son, casi siempre, el nombre de una persona natural (un postor que perdió, un
 * proveedor con negocio propio). Es conservador a propósito: si descarta una
 * señal de más, la portada elige otra; si deja pasar un nombre, ya no hay vuelta.
 */
const nombraAUnaPersona = (texto: string) =>
  (texto.match(/(?:\b[A-ZÁÉÍÓÚÑ]{2,}\b[ ,]*){3,}/g) ?? []).some((tramo) => !MARCA_DE_ORGANIZACION.test(tramo));

/** La bandera más fuerte que se puede mostrar: de proceso, con evidencia legible y norma citada. */
function mejorBandera(a: AlertaReal): BanderaReal | null {
  const legibles = (a.banderas ?? []).filter(
    (b) =>
      REGLAS_DE_PROCESO.test(b.regla) &&
      b.norma &&
      b.evidencia &&
      b.evidencia.length >= 80 &&
      b.evidencia.length <= 700 &&
      !nombraAUnaPersona(b.evidencia),
  );
  legibles.sort((x, y) => (PESO_SEVERIDAD[y.severidad] ?? 0) - (PESO_SEVERIDAD[x.severidad] ?? 0));
  return legibles[0] ?? null;
}


/**
 * El texto sale tal cual lo guardó el análisis, con arreglos de forma y
 * ninguno de fondo: el separador "·" que usan algunas reglas pasa a coma, y los
 * "¿" que deja SEACE donde había un carácter que no supo codificar (comillas o
 * guiones, según el caso). Suelto entre espacios era un guion; pegado a una
 * palabra, una comilla. Si el texto trae un "?", el "¿" es de verdad y no se
 * toca.
 */
function limpiar(t: string, raya = ", "): string {
  // "S/." es como lo escribe el análisis; la portada usa "S/" en todas partes.
  // La raya larga entre espacios pasa a coma en el texto y a dos puntos en la
  // cita de la norma ("Art. 5 Ley 32069: principio de competencia"), salvo
  // entre dos cifras: "2023 – 2024" es un rango y queda como está. Se mira el
  // carácter de cada lado con una función y no con un lookbehind, que no
  // compila en Safari anterior a 16.4.
  let r = t
    .replace(/S\/\.\s?/g, "S/ ")
    .replace(/(\S?)\s[—–]\s(\S?)/g, (m, antes: string, despues: string) =>
      /\d/.test(antes) && /\d/.test(despues) ? m : `${antes}${raya}${despues}`,
    )
    .replace(/\s*·\s*/g, ", ");
  if (!r.includes("?")) r = r.replace(/\s¿\s/g, " - ").replace(/¿/g, '"');
  return r.replace(/\s{2,}/g, " ").trim();
}

function aCaso(a: AlertaReal, b: BanderaReal): CasoPortada {
  const sev = (b.severidad === "alta" || b.severidad === "media" || b.severidad === "baja" ? b.severidad : "media") as CasoPortada["severidad"];
  return {
    codigo: a.codigo ?? "",
    convocatoria: a.codigoconvocatoria,
    entidad: a.entidad ?? "Entidad no identificada",
    objeto: a.objeto ? limpiar(a.objeto) : "Sin objeto declarado en el expediente",
    monto: a.montoSoles != null && a.montoSoles > 0 ? soles(a.montoSoles) : null,
    proveedor: a.proveedor,
    fecha: a.fechaBuenaPro ? fecha(a.fechaBuenaPro) : null,
    region: a.region,
    fuenteUrl: a.fuenteUrl,
    hallazgo: limpiar(b.evidencia!),
    norma: limpiar(b.norma!, ": "),
    severidad: sev,
    otrasSenales: Math.max(0, (a.banderas?.length ?? 1) - 1),
  };
}

/**
 * Elige los casos de la portada de forma DETERMINISTA: el de mayor score con una
 * señal legible, y después los siguientes de regiones distintas. No hay azar —
 * una portada que cambia de caso en cada recarga no se puede citar ni verificar.
 */
export function elegirCasos(alertas: AlertaReal[], cuantos = 4): CasoPortada[] {
  const candidatos = alertas
    .filter(esAlertaReal)
    // Sólo contratos que ganó una organización: un proveedor persona natural es
    // un nombre propio, y en la portada no va (ver `REGLAS_DE_PROCESO`).
    .filter((a) => !!a.proveedor && MARCA_DE_ORGANIZACION.test(a.proveedor))
    .map((a) => ({ a, b: mejorBandera(a) }))
    .filter((x): x is { a: AlertaReal; b: BanderaReal } => x.b !== null)
    .sort(
      (x, y) =>
        (y.a.score ?? 0) - (x.a.score ?? 0) ||
        (PESO_SEVERIDAD[y.b.severidad] ?? 0) - (PESO_SEVERIDAD[x.b.severidad] ?? 0) ||
        (y.a.fechaBuenaPro ?? "").localeCompare(x.a.fechaBuenaPro ?? ""),
    );

  const elegidos: CasoPortada[] = [];
  const regiones = new Set<string>();
  for (const { a, b } of candidatos) {
    const r = (a.region ?? "").toLowerCase();
    if (elegidos.length > 0 && r && regiones.has(r)) continue;
    elegidos.push(aCaso(a, b));
    if (r) regiones.add(r);
    if (elegidos.length === cuantos) break;
  }
  return elegidos;
}
