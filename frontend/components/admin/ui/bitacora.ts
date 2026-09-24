/**
 * Bitácora (admin_log) en palabras llanas: cada `accion` del API → una frase,
 * una categoría para filtrar y, si se puede, un enlace al objeto que tocó.
 * Las acciones salen de backend/api/src/routes/admin*.ts (log(actor, accion, objeto, detalle)).
 * Lo que no esté acá se muestra humanizado y con el detalle crudo plegado.
 */

import { humanizar, plural } from "./formato";
import { MOTIVO_NO_VISIBLE } from "./estados";
import type { Tone } from "./tono";

export type CategoriaBitacora = "aportes" | "procesamiento" | "revision" | "ajustes" | "otras";

export const CATEGORIA_BITACORA: Record<CategoriaBitacora, { label: string; tono: Tone }> = {
  aportes: { label: "Aportes", tono: "warn" },
  procesamiento: { label: "Procesamiento", tono: "neutral" },
  revision: { label: "Revisión", tono: "pending" },
  ajustes: { label: "Ajustes", tono: "brand" },
  otras: { label: "Otras", tono: "muted" },
};

export interface EntradaBitacora { actor: string; accion: string; objeto: string; detalle: unknown; createdAt: string }

export interface AccionLegible {
  frase: string;
  categoria: CategoriaBitacora;
  tono: Tone;
  /** El objeto en palabras ("aporte VIG-2026-00014", "contrato 1226370"). */
  objeto: string | null;
  href: string | null;
  externo?: boolean;
  /** Lo que importa del detalle, en una línea. */
  resumen: string | null;
}

const ACCION: Record<string, { frase: string; categoria: CategoriaBitacora; tono?: Tone }> = {
  validar: { frase: "confirmó el pago de un aporte", categoria: "aportes", tono: "ok" },
  rechazar: { frase: "rechazó un aporte", categoria: "aportes", tono: "danger" },
  editar_financiador: { frase: "editó un financiador", categoria: "aportes" },
  procesar_lote: { frase: "procesó un lote a nombre de Vigía", categoria: "procesamiento", tono: "brand" },
  reanalizar: { frase: "pidió re-analizar un contrato", categoria: "procesamiento", tono: "warn" },
  reencolar: { frase: "volvió a encolar un contrato", categoria: "procesamiento" },
  reencolar_errores: { frase: "volvió a encolar los contratos con error", categoria: "procesamiento", tono: "warn" },
  reintentar_pedido: { frase: "reintentó la descarga de documentos", categoria: "procesamiento" },
  dispatcher_run: { frase: "adelantó la corrida del dispatcher", categoria: "procesamiento" },
  alerta_publicar: { frase: "publicó una alerta revisada", categoria: "revision", tono: "ok" },
  alerta_descartar: { frase: "descartó una alerta revisada", categoria: "revision", tono: "danger" },
  editar_self_eval: { frase: "cambió los umbrales de la revisión automática", categoria: "revision" },
  editar_pagos: { frase: "editó los medios de pago", categoria: "ajustes" },
  editar_procesamiento: { frase: "cambió qué contratos entran a la cola", categoria: "ajustes" },
  equipo_agregar: { frase: "agregó a alguien al equipo", categoria: "ajustes", tono: "ok" },
  equipo_cambiar: { frase: "cambió el acceso de alguien del equipo", categoria: "ajustes" },
  equipo_quitar: { frase: "quitó a alguien del equipo", categoria: "ajustes", tono: "danger" },
};

const obj = (d: unknown): Record<string, unknown> => (d && typeof d === "object" && !Array.isArray(d) ? (d as Record<string, unknown>) : {});
const esNum = (v: unknown): v is number | string => typeof v === "number" || (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)));
const n = (v: unknown) => (esNum(v) ? Number(v).toLocaleString("es-PE") : null);
/** "1 contrato asignado", "3 contratos asignados"; sin número → null. */
const cuenta = (v: unknown, uno: string, varios: string) => (esNum(v) ? plural(v, uno, varios) : null);
const txt = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const unir = (partes: (string | null | false | undefined)[]) => partes.filter(Boolean).join(" · ") || null;

/** "contribucion:VIG-1" → { objeto, href } según el prefijo que usa el API. */
function objetoDe(accion: string, objeto: string, d: Record<string, unknown>): Pick<AccionLegible, "objeto" | "href" | "externo"> {
  const [tipo, ...resto] = objeto.split(":");
  const id = resto.join(":");
  if (accion === "procesar_lote") return { objeto: `lote ${objeto}`, href: `/admin/procesamientos?lote=${encodeURIComponent(objeto)}` };
  switch (tipo) {
    case "contribucion": return { objeto: `aporte ${id}`, href: "/admin/contribuciones?estado=todas" };
    case "procesamiento": return { objeto: `contrato ${id}`, href: `/app/auditoria/${encodeURIComponent(id)}`, externo: true };
    case "alerta": return { objeto: txt(d.codigo) ? `alerta ${d.codigo}` : "una alerta", href: `/admin/revision/${encodeURIComponent(id)}` };
    case "financiador": return { objeto: `financiador n.º ${id}`, href: "/admin/financiadores" };
    case "pedido": return { objeto: txt(d.ocid) ? `contrato ${d.ocid}` : `pedido n.º ${id}`, href: "/admin/procesamientos" };
    case "job": return { objeto: null, href: "/admin/procesamientos" };
    case "procesamientos": return { objeto: null, href: "/admin/procesamientos?estado=error" };
    case "equipo": return { objeto: id || null, href: "/admin/equipo" };
    case "ajustes":
      if (id === "pagos") return { objeto: null, href: "/admin/pagos" };
      if (id === "procesamiento") return { objeto: null, href: "/admin/clasificacion" };
      if (id === "self_eval") return { objeto: null, href: "/admin/revision" };
      return { objeto: humanizar(id), href: null };
    default: return { objeto: objeto || null, href: null };
  }
}

function resumenDe(accion: string, d: Record<string, unknown>): string | null {
  switch (accion) {
    case "validar": return cuenta(d.asignados, "contrato asignado", "contratos asignados");
    case "rechazar":
    case "alerta_publicar":
    case "alerta_descartar":
      return txt(d.motivo) ? `Motivo: ${txt(d.motivo)}` : null;
    case "reanalizar": return unir([txt(d.motivo) ? `Motivo: ${txt(d.motivo)}` : "Sin motivo anotado", n(d.costoEstimadoUsd) ? `≈ US$ ${d.costoEstimadoUsd}` : null]);
    case "procesar_lote":
      return unir([cuenta(d.asignados, "contrato", "contratos"), n(d.conDocumentos) && `${n(d.conDocumentos)} con documentos`, cuenta(d.pedidos, "espera descarga", "esperan descarga")]);
    case "reencolar_errores": return cuenta(d.n, "contrato", "contratos");
    case "editar_financiador":
      return unir([
        d.visible === false && `lo ocultó${txt(d.motivoNoVisible) ? ` (${MOTIVO_NO_VISIBLE[d.motivoNoVisible as string] ?? humanizar(d.motivoNoVisible as string)})` : ""}`,
        d.visible === true && "lo volvió visible",
        // Un null no borraba nada (el API conserva el valor anterior): sólo se dice lo que cambió.
        txt(d.nombrePublico) && `nombre: ${d.nombrePublico}`,
        txt(d.logoUrl) && "cambió el logo",
      ]);
    case "equipo_agregar":
    case "equipo_cambiar":
    case "equipo_quitar": {
      const rol = d.rol === "admin" ? "administrador" : d.rol === "revisor" ? "revisor" : null;
      const antes = obj(d.antes);
      return unir([
        rol && `perfil ${rol}`,
        !!antes.rol && antes.rol !== d.rol && `antes ${antes.rol === "admin" ? "administrador" : "revisor"}`,
        d.activo === false && "acceso pausado",
        d.activo === true && antes.activo === false && "acceso reactivado",
      ]);
    }
    case "editar_procesamiento": {
      const tipos = Array.isArray(d.tipos_activos) ? (d.tipos_activos as string[]).map((t) => humanizar(t)).join(", ") : null;
      const etapas = Array.isArray(d.etapas_activas) ? (d.etapas_activas as string[]).map((t) => humanizar(t)?.toLowerCase()).join(", ") : null;
      return unir([tipos && `tipos: ${tipos}`, etapas && `etapas: ${etapas}`]);
    }
    default: return null;
  }
}

export function leerAccion(e: EntradaBitacora): AccionLegible {
  const d = obj(e.detalle);
  const a = ACCION[e.accion];
  return {
    frase: a?.frase ?? (humanizar(e.accion)?.toLowerCase() ?? e.accion),
    categoria: a?.categoria ?? "otras",
    tono: a?.tono ?? CATEGORIA_BITACORA[a?.categoria ?? "otras"].tono,
    ...objetoDe(e.accion, e.objeto ?? "", d),
    resumen: resumenDe(e.accion, d),
  };
}

/** Correo → lo que va antes de la @ ("edwin.soto.c"); nombres sueltos ("sistema") quedan igual. */
export const actorCorto = (actor: string | null | undefined) => (actor ? actor.split("@")[0] : "Sin autor");
