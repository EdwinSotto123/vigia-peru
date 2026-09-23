/**
 * Utilidades compartidas del panel de zona del mapa.
 *
 * - `REGION_UBIGEO`: regionId (slug de `lib/peru-data` y `properties.id` del
 *   geojson) → ubigeo INEI de departamento (`properties.code`). Es la llave que
 *   une el mapa de alertas con "Financia una auditoría" (`/app/financiar/[ubigeo]`).
 * - `departamentoDe` / `belongsToRegion`: a qué departamento pertenece una
 *   alerta, entidad o denuncia.
 *
 * La coincidencia es EXACTA (sin tildes, sin espacios, sin mayúsculas) contra
 * las provincias del geojson y los 25 departamentos. Antes se comparaba por
 * subcadena y eso contaba señales en el departamento equivocado: "Castilla"
 * (Arequipa) caía en Loreto por "mariscalramoncastilla" y "Andahuaylas"
 * (Apurímac) en Áncash por "huaylas". Y siete señales de provincias que no
 * estaban en una lista escrita a mano (Carabaya, Lampa, Chumbivilcas…) no
 * caían en ningún lado.
 *
 * Medido el 2026-09-23 contra la API: con esta coincidencia, las señales de
 * `/alertas` con puntaje ≥ 40 cuadran departamento por departamento (25 de 25)
 * con el `conSenales` de `/contratos/geo`.
 */

import { REGIONES } from "@/lib/peru-data";
import { PROVINCIA_UBIGEO } from "./provincias";

export const REGION_UBIGEO: Record<string, string> = {
  amazonas: "01",
  ancash: "02",
  apurimac: "03",
  arequipa: "04",
  ayacucho: "05",
  cajamarca: "06",
  callao: "07",
  cusco: "08",
  huancavelica: "09",
  huanuco: "10",
  ica: "11",
  junin: "12",
  lalibertad: "13",
  lambayeque: "14",
  lima: "15",
  loreto: "16",
  madrededios: "17",
  moquegua: "18",
  pasco: "19",
  piura: "20",
  puno: "21",
  sanmartin: "22",
  tacna: "23",
  tumbes: "24",
  ucayali: "25",
};

export const UBIGEO_REGION: Record<string, string> = Object.fromEntries(
  Object.entries(REGION_UBIGEO).map(([id, code]) => [code, id]),
);

/** Nombre para mostrar de un departamento (con tildes: "Áncash", "San Martín"), por ubigeo de 2 dígitos. */
export function nombreDepartamento(ubigeo: string): string {
  const id = UBIGEO_REGION[ubigeo.slice(0, 2)];
  return REGIONES.find((r) => r.id === id)?.nombre ?? ubigeo;
}

/** Sin tildes, sin espacios ni signos, en minúsculas: "Huanca Sancos" → "huancasancos". */
export function normalizar(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

/** Nombre normalizado de departamento → ubigeo de 2 dígitos. */
const DEPARTAMENTO_UBIGEO: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const [id, code] of Object.entries(REGION_UBIGEO)) out[id] = code;
  for (const r of REGIONES) {
    const code = REGION_UBIGEO[r.id];
    if (code) out[normalizar(r.nombre)] = code;
  }
  // Nombres oficiales largos que usan el MEF y algunas bases.
  out.provinciaconstitucionaldelcallao = "07";
  out.limametropolitana = "15";
  out.limaprovincias = "15";
  return out;
})();

/** Ubigeo de 4 dígitos de una provincia, por nombre exacto (sin tildes ni espacios). */
export function provinciaUbigeo(nombre: string | null | undefined): string | null {
  const k = normalizar(nombre);
  if (!k) return null;
  if (k === "limametropolitana") return "1501";
  if (k === "provinciaconstitucionaldelcallao") return "0701";
  return PROVINCIA_UBIGEO[k] ?? null;
}

/** Ubigeo de 2 dígitos de un departamento, por nombre exacto. */
export function departamentoUbigeo(nombre: string | null | undefined): string | null {
  const k = normalizar(nombre);
  return k ? DEPARTAMENTO_UBIGEO[k] ?? null : null;
}

/**
 * Qué dice el campo `region` de cada fuente:
 * - `/alertas`: casi siempre el nombre de la PROVINCIA ("Carabaya", "Huamanga"),
 *   a veces el del departamento ("Áncash").
 * - `/entidades` y `/reportes`: el del DEPARTAMENTO.
 *
 * Importa en un solo caso: "Ucayali" es un departamento (25) y también una
 * provincia de Loreto (1606).
 */
export type RegionEs = "provincia" | "departamento";

/**
 * Ubigeo de la zona más fina que se puede afirmar de un registro: provincia
 * (4 dígitos) si se reconoce, si no departamento (2 dígitos), si no `null`.
 */
export function zonaDe(
  item: { region?: string | null; provincia?: string | null },
  regionEs: RegionEs = "departamento",
): string | null {
  const prov = provinciaUbigeo(item.provincia);
  if (prov) return prov;
  if (regionEs === "provincia") return provinciaUbigeo(item.region) ?? departamentoUbigeo(item.region);
  return departamentoUbigeo(item.region) ?? provinciaUbigeo(item.region);
}

/** Ubigeo de departamento (2 dígitos) de un registro, o `null` si no se reconoce. */
export function departamentoDe(
  item: { region?: string | null; provincia?: string | null },
  regionEs: RegionEs = "departamento",
): string | null {
  return zonaDe(item, regionEs)?.slice(0, 2) ?? null;
}

/** ¿Este registro (alerta, entidad, reporte) pertenece al departamento `regionId`? */
export function belongsToRegion(
  item: { region?: string | null; provincia?: string | null },
  regionId: string,
  regionEs: RegionEs = "departamento",
): boolean {
  const ub = REGION_UBIGEO[regionId];
  return !!ub && departamentoDe(item, regionEs) === ub;
}
