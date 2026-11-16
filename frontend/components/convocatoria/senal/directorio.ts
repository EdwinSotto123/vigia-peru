/**
 * De quién habla una señal del dictamen (pedido del usuario del 2026-11-16: «¿ese RUC es de la empresa ganadora?
 * ¿representante de QUÉ?… hay ventanas laterales que no contienen la suficiente información»).
 *
 * La señal llega de la API con su evidencia en una oración («Persona con documento 20100027292 figura como representante
 * de 3 empresas…») y nada estructurado: ni de quién es ese documento ni cuáles son las empresas. Lo que sí trae el
 * dictamen, en otras partes, es quién es cada RUC: el ganador, la entidad, los demás postores, los socios del ganador en
 * el RNP y las empresas de su red. Aquí se arma ese directorio (RUC de empresa → nombre y qué es en este contrato) para
 * que el panel de la señal lo diga. Nada se inventa: un RUC que el dictamen no nombra sale sin nombre.
 *
 * Sólo empresas (RUC 20). Un RUC 10 lleva el DNI de una persona: nunca entra aquí, ni se muestra, ni se enlaza.
 */

import type { ApiResult } from "../types";

export interface Aludido {
  ruc: string;
  nombre: string | null;
  /** Qué es en este contrato, en frases («Ganó la buena pro», «Socio del ganador según el RNP»). */
  roles: string[];
}

export interface ContextoSenal {
  ganador: { ruc: string | null; nombre: string | null } | null;
  entidad: { ruc: string | null; nombre: string | null } | null;
  directorio: Map<string, Aludido>;
}

const ES_RUC20 = /^20\d{9}$/;
export const esRucDeEmpresa = (v: unknown): v is string => typeof v === "string" && ES_RUC20.test(v.trim());

const texto = (v: unknown): string | null => {
  const t = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  return t ? t : null;
};

const CLAVES_RUC = ["ruc", "ruc_postor", "numero_documento", "ganador_ruc"];
const CLAVES_NOMBRE = ["razon_social", "nombre", "ganador_razon_social", "razon_social_ocds"];

/** El directorio de empresas del dictamen y quiénes son el ganador y la entidad. */
export function contextoDeSenales(result: ApiResult, ganador: any): ContextoSenal {
  const r = result as any;
  const conv = r.convocatoria ?? {};
  const dir = new Map<string, Aludido>();
  const poner = (ruc: unknown, nombre: unknown, rol?: string | null) => {
    const k = typeof ruc === "string" ? ruc.trim() : typeof ruc === "number" ? String(ruc) : "";
    if (!ES_RUC20.test(k)) return;
    const e = dir.get(k) ?? { ruc: k, nombre: null, roles: [] };
    // Un nombre con un apellido tapado es de una persona (así llegan de la API): nunca se toma por el de una empresa.
    const n = texto(nombre);
    if (!e.nombre && n && !n.includes("•")) e.nombre = n;
    if (rol && !e.roles.includes(rol)) e.roles.push(rol);
    dir.set(k, e);
  };
  const lista = (v: unknown): any[] => (Array.isArray(v) ? v : []);

  const rucGanador: string | null = texto(ganador?.ruc) ?? texto(r.proveedor_ruc);
  const rucEntidad: string | null = texto(conv.buyer_ruc) ?? texto(r.entidad_ruc);
  const nombreEntidad = texto(typeof conv.entidad === "string" ? conv.entidad : conv.entidad?.nombre) ?? texto(r.entidad);
  poner(rucGanador, ganador?.nombre, "Ganó la buena pro de este contrato");
  poner(rucEntidad, nombreEntidad, "Es la entidad que contrata");

  for (const p of lista(r.postores)) if (!p?.es_ganador) poner(p?.ruc, p?.nombre ?? p?.razon_social, "Participó en este proceso");
  const ctx = r.person_network_context ?? {};
  for (const p of lista(ctx.todos_postores)) if (!p?.es_ganador) poner(p?.ruc, p?.razon_social, "Participó en este proceso");

  // El RNP del ganador: una empresa puede ser su socia (un grupo), aunque el registro la anote con «tipo de documento DNI».
  const rnp = ctx.rnp_proveedor ?? {};
  for (const s of lista(rnp.socios)) poner(s?.numero_documento, s?.nombre, "Figura como socia del ganador en el RNP");
  for (const s of lista(rnp.representantes_legales)) poner(s?.numero_documento, s?.nombre, "Figura como representante legal del ganador en el RNP");
  for (const s of lista(rnp.organos_administracion)) poner(s?.numero_documento, s?.nombre, "Figura en el órgano de administración del ganador en el RNP");

  const persona = r.person_network?.persona_principal ?? {};
  for (const e of lista(persona.otras_empresas_vinculadas)) poner(e?.ruc, e?.razon_social, "La red de personas la vincula con el ganador");
  for (const e of lista(r.expediente_proveedor?.historial?.principales_entidades)) poner(e?.entidad_ruc, e?.entidad, "Entidad a la que el ganador le vende");
  for (const p of lista(r.lecturas_documentos?.acta?.salida?.postores)) poner(p?.ruc, p?.nombre, p?.ganador ? null : "Ofertó en este proceso, según el acta");

  // Lo demás: cualquier objeto del dictamen con un RUC de empresa y su nombre (sin rol: sólo para poder nombrarlo).
  const visitar = (o: unknown, fondo: number) => {
    if (!o || typeof o !== "object" || fondo > 7) return;
    if (Array.isArray(o)) {
      for (const x of o) visitar(x, fondo + 1);
      return;
    }
    const obj = o as Record<string, unknown>;
    // Cada RUC con SU nombre: el de la empresa con la razón social; el de la entidad, con la entidad (un contrato trae los dos).
    const nombre = CLAVES_NOMBRE.map((k) => texto(obj[k])).find(Boolean) ?? null;
    if (nombre) for (const k of CLAVES_RUC) poner(obj[k], nombre);
    poner(obj.entidad_ruc, obj.entidad);
    for (const [k, v] of Object.entries(obj)) if (k !== "ocds_payload" && v && typeof v === "object") visitar(v, fondo + 1);
  };
  visitar({ a: r.person_network, b: ctx, c: r.analisis_postores, d: r.web_research, e: r.document_analysis?.postores_consolidados, f: r.expediente_proveedor }, 0);

  return {
    ganador: ganador?.nombre || rucGanador ? { ruc: rucGanador, nombre: texto(ganador?.nombre) } : null,
    entidad: nombreEntidad || rucEntidad ? { ruc: rucEntidad, nombre: nombreEntidad } : null,
    directorio: dir,
  };
}

/** Los RUC de empresa que nombra un texto, en su orden y sin repetir. */
export function rucsDeEmpresaEn(t: string | null | undefined): string[] {
  const out: string[] = [];
  for (const m of String(t ?? "").matchAll(/(?<!\d)(20\d{9})(?!\d)/g)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

/** La evidencia llama «persona» a un documento que es un RUC de empresa («Persona con documento 20100027292…»). */
export function llamaPersonaAUnaEmpresa(t: string | null | undefined): string | null {
  return String(t ?? "").match(/persona[^.]{0,40}?documento\s+(20\d{9})(?!\d)/i)?.[1] ?? null;
}
