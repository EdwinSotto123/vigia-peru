import { nombreCortoEmpresa } from "@/lib/empresas";
import { tituloNatural } from "@/lib/landing";

/** Las formas societarias escritas enteras, en su sigla: «Sociedad Anónima Cerrada» ocupaba media tarjeta. */
const FORMAS: [RegExp, string][] = [
  [/\bsociedad an[oó]nima cerrada\b/gi, "S.A.C."],
  [/\bsociedad an[oó]nima abierta\b/gi, "S.A.A."],
  [/\bsociedad comercial de responsabilidad limitada\b/gi, "S.R.L."],
  [/\bempresa individual de responsabilidad limitada\b/gi, "E.I.R.L."],
  [/\bsociedad an[oó]nima\b/gi, "S.A."],
];
const conSiglas = (t: string) => FORMAS.reduce((s, [re, sigla]) => s.replace(re, sigla), t).replace(/\s{2,}/g, " ").trim();

/**
 * El nombre de una empresa como se lee: el nombre corto si la razón social lo trae («… - GRUPO SANTA FE S.A.C.»), la forma
 * societaria en sigla y sin MAYÚSCULAS. Si las dos mitades dicen lo mismo con la sigla, una sola. `completo`: el nombre
 * entero, para el `title`, si es distinto. Lo usan las tarjetas de dueños y la cronología de un caso.
 */
export function nombreLegibleEmpresa(nombre: string | null): { texto: string; completo?: string } {
  if (!nombre) return { texto: "Empresa sin nombre" };
  const corto = nombreCortoEmpresa(nombre);
  let base = corto?.corto ?? nombre;
  if (!corto) {
    const i = nombre.lastIndexOf(" - ");
    if (i > 0 && conSiglas(nombre.slice(0, i)).toLowerCase() === conSiglas(nombre.slice(i + 3)).toLowerCase()) base = nombre.slice(i + 3);
  }
  const t = tituloNatural(conSiglas(base));
  const texto = t.charAt(0).toUpperCase() + t.slice(1);
  const entero = tituloNatural(nombre);
  return { texto, completo: entero.toLowerCase() !== texto.toLowerCase() ? entero : undefined };
}
