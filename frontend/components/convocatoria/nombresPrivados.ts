/**
 * Las personas PRIVADAS de un dossier cuyo apellido hay que tapar también en la
 * PROSA (síntesis, dictamen, evidencia), lista para `setRedactNames`.
 *
 * Salió de ResultadoView para que cualquier vista que pinte partes del mismo
 * dossier registre la misma lista desde su primer render: el panel de revisión
 * carga ResultadoView con next/dynamic, y sus otros paneles se pintaban antes,
 * con la lista vacía y los apellidos a la vista.
 *
 * Sin React. Sus dos ayudas vienen de components/Redact, que es "use client":
 * se llama desde componentes cliente, que son los únicos que registran nombres.
 */

import { esPersonaNatural, pareceEmpresa, type NombreConocido } from "../Redact";
import type { ApiResult } from "./types";

/** "CARPIO COBOS ABEL" (orden SUNAT) → "ABEL CARPIO COBOS": la misma persona como la escribe la prosa. */
function rotarSunat(n: string): string | null {
  const p = n.trim().split(/\s+/);
  if (p.length < 3) return null;
  return [...p.slice(2), p[0], p[1]].join(" ");
}

/**
 * Los funcionarios ELECTOS no se incluyen: son públicos. Un ganador o postor
 * persona natural (RUC 10) viene en orden SUNAT (APELLIDO APELLIDO NOMBRE): se
 * registra así y además rotado, porque la prosa del dictamen lo escribe con el
 * nombre primero ("ABEL CARPIO COBOS"). Los socios pueden ser empresas: esas
 * no van (una S.A.C. no tiene apellido que tapar).
 */
export function nombresPrivadosDe(result: ApiResult): NombreConocido[] {
  const da = result.document_analysis || {};
  const pn = result.person_network || {};
  const red = pn.red_empresarial || {};
  const persona = pn.persona_principal || {};
  // Solo el registro OCDS (y el RNP/SUNAT, de donde sale el gerente) garantiza el orden
  // SUNAT. Las actas escriben a la misma persona con el nombre primero.
  const enOrdenSunat = ((result.postores || []) as any[])
    .filter((p) => typeof p?.nombre === "string" && esPersonaNatural(p?.ruc))
    .map((p) => String(p.nombre).trim());
  const gerente = result.web_research?.empresa?.gerente_general?.nombre;
  if (typeof gerente === "string" && gerente.trim()) enOrdenSunat.push(gerente.trim());
  const clave = (n: string) => n.toLowerCase().split(/\s+/).sort().join(" ");
  const conocidas = new Set(enOrdenSunat.map(clave));
  const sunat: NombreConocido[] = [];
  for (const n of enOrdenSunat) {
    sunat.push({ nombre: n, orden: "sunat" });
    const rotado = rotarSunat(n);
    if (rotado) sunat.push(rotado);
  }
  // Personas naturales que aparecen solo en los documentos: su orden no se conoce; si
  // son la misma persona del OCDS ya quedaron cubiertas por la versión rotada.
  const deDocumentos = [
    ...((da.postores_consolidados || da.postores_extraidos || []) as any[]).map((p) => ({ nombre: p?.razon_social || p?.nombre, ruc: p?.ruc })),
    ...((da.motivos_adjudicacion || []) as any[]).map((m) => ({ nombre: m?.ganador_razon_social, ruc: m?.ganador_ruc })),
  ]
    .filter((p) => typeof p.nombre === "string" && esPersonaNatural(p.ruc) && !conocidas.has(clave(p.nombre)))
    .map((p) => String(p.nombre));
  const socios = [
    ...((result.web_research?.empresa?.socios || []) as any[]),
    ...(((result as any).proveedor?.socios || []) as any[]),
    ...((red.socios || []) as any[]),
  ]
    .filter((s) => !pareceEmpresa(s?.nombre, s?.ruc ?? s?.numero_documento))
    .map((s) => s?.nombre);
  return [
    ...sunat,
    ...deDocumentos,
    persona.nombre_completo,
    ...((da.firmantes || []) as any[]).map((f) => f?.nombre_completo),
    ...((da.comite_evaluacion || []) as any[]).map((m) => m?.nombre_completo || m?.nombre),
    ...((pn.cruce_firmantes_ganador || []) as any[]).map((c) => c?.firmante),
    ...(((result as any).entity_personnel?.funcionarios_designados || []) as any[]).map((f) => f?.nombre_completo || f?.nombre),
    ...((pn.pareja_o_familia || []) as any[]).map((f) => f?.nombre),
    ...socios,
  ];
}
