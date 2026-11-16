/**
 * Los nombres del dictamen, escritos de una sola manera (pedido del usuario del 2026-11-16: la red mezclaba «FERREYROS
 * SOCIEDAD ANÓNIMA» con «Ferreyros S.A.» y nombres en mayúsculas con nombres en minúsculas). Los registros (OCDS, RNP,
 * SUNAT) escriben en mayúsculas y el agente en título: aquí todo pasa a título, y dos formas de la misma empresa se
 * reconocen como una. Cambia la forma, nunca el dato: un apellido tapado («•••») sigue tapado.
 */

import { tituloNatural } from "@/lib/landing";

/** Un nombre en título («TITANMAQ S.R.L.» → «Titanmaq S.R.L.»); el que ya viene escrito así, tal cual. */
export function nombreLegible(nombre: string | null | undefined): string {
  const t = String(nombre ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return tituloNatural(t).replace(/\bS\.a\.a\.?(?=$|[\s,;)])/g, "S.A.A.");
}

/**
 * La clave de una empresa para saber si dos nombres son la misma: sin tildes ni puntuación y con la forma societaria
 * abreviada («FERREYROS SOCIEDAD ANÓNIMA» y «Ferreyros S.A.» → «FERREYROS SA»).
 */
export function claveEmpresa(nombre: string | null | undefined): string {
  return String(nombre ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[.,]/g, "")
    .replace(/[^A-Z0-9&]+/g, " ")
    .replace(/\bSOCIEDAD ANONIMA CERRADA\b/g, "SAC")
    .replace(/\bSOCIEDAD ANONIMA ABIERTA\b/g, "SAA")
    .replace(/\bSOCIEDAD ANONIMA\b/g, "SA")
    .replace(/\bSOCIEDAD COMERCIAL DE RESPONSABILIDAD LIMITADA\b/g, "SRL")
    .replace(/\bEMPRESA INDIVIDUAL DE RESPONSABILIDAD LIMITADA\b/g, "EIRL")
    .replace(/\bS A C\b/g, "SAC")
    .replace(/\bS A A\b/g, "SAA")
    .replace(/\bS R L\b/g, "SRL")
    .replace(/\bE I R L\b/g, "EIRL")
    .replace(/\bS A\b/g, "SA")
    .replace(/\s+/g, " ")
    .trim();
}

/** ¿Dos nombres son la misma empresa? */
export const mismaEmpresa = (a: string | null | undefined, b: string | null | undefined): boolean => {
  const x = claveEmpresa(a);
  return x.length > 3 && x === claveEmpresa(b);
};
