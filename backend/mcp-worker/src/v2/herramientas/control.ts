// El informe de indicios en formato de control de un contrato: las señales y su evidencia con la forma de un informe de
// control de la Contraloría (la API lo arma y lo guarda: GET /v1/contratos/:ocid/informe-control, migración 306). La
// primera vez lo redacta un modelo abierto con la evidencia del contrato (hasta un minuto); después sale lo guardado.
import { z } from "zod";
import { api, ErrorApi } from "../api";
import { AVISO, ErrorUsuario, ocid as aOcid, recortar } from "../formato";
import { definir } from "../registro";

type Fila = Record<string, any>;

/** «Ley N.° 32069, artículo 30»; si el documento ya nombra el artículo, no se repite (como el documento de la API). */
function tituloNorma(n: Fila): string {
  const doc = String(n.documento ?? "");
  if (!n.articulo) return doc;
  return new RegExp(`art[ií]culo\\s+${String(n.articulo).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\w)`, "i").test(doc) ? doc : `${doc}, artículo ${n.articulo}`;
}

export const informeControlContrato = definir({
  nombre: "informe_control_contrato",
  titulo: "Informe para control de un contrato",
  descripcion:
    "Las señales de un contrato y su evidencia con la forma de un informe de control de la Contraloría: información " +
    "general, alcance y fuentes, una observación por hecho (condición, criterio con la norma vigente a la fecha, efecto, " +
    "causa, evidencia con enlaces y precedentes de informes de control reales), conclusión y recomendaciones al órgano " +
    "de control. Son indicios, no atribuye responsabilidades. Sólo contratos con señales; la primera vez se redacta (hasta " +
    "un minuto). Úsala cuando pidan un informe, un documento para la Contraloría o el sustento formal de las señales.",
  entrada: {
    ocid: z.string().min(1).max(64).describe("OCID o código del proceso: «1250529»."),
    formato: z.enum(["estructurado", "markdown"]).default("estructurado").describe("«estructurado»: las partes en JSON; «markdown»: el documento entero en texto."),
  },
  async ejecutar({ ocid, formato }, cx) {
    const id = aOcid(ocid);
    let r: Fila;
    try {
      r = await api<Fila>(cx.env, `/contratos/${encodeURIComponent(id)}/informe-control`);
    } catch (e) {
      // Sin señales no hay informe: se dice y no se cobra (ErrorUsuario no descuenta créditos).
      if (e instanceof ErrorApi && e.codigo === "sin_senales") {
        throw new ErrorUsuario("Este contrato no tiene señales: no hay indicios que reunir en un informe para control. Revisa su ficha con ficha_contrato.");
      }
      throw e;
    }
    if (r.estado === "generando" || !r.informe) {
      throw new ErrorUsuario("El informe de este contrato se está redactando en este momento: vuelve a pedirlo en un minuto.");
    }
    const d = r.informe as Fila;
    const web = `${cx.env.VIGIA_URL}/app/contratos/${encodeURIComponent(String(r.ocid))}`;
    const enlace = d.enlaces?.dictamen ? `${web}?vista=dictamen&tab=control` : web;
    const meta = {
      ocid: r.ocid,
      numero: d.numero,
      version: r.version,
      redactado: r.generadoAt,
      modelo: r.modelo ?? "sin modelo (texto armado con los datos)",
      ...(r.desactualizado ? { desactualizado: true, nota: r.aviso } : {}),
      ...(r.provisional ? { provisional: true, nota: r.aviso } : {}),
      enlace,
    };
    if (formato === "markdown") return { ...meta, documento: r.markdown, aviso: AVISO };
    const g = d.general as Fila;
    return {
      ...meta,
      titulo: g.titulo,
      objetivo: g.objetivo,
      entidad: g.entidad,
      procedimiento: g.proceso,
      montos_soles: { referencial: g.montos?.referencial, adjudicado: g.montos?.adjudicado, contratado: g.montos?.contratado },
      contratistas: g.contratistas,
      fechas: g.fechas,
      alcance: { periodo: d.alcance?.periodo, registros: d.alcance?.registros, normativa: d.alcance?.regimen },
      observaciones: (d.observaciones ?? []).map((o: Fila) => ({
        numero: o.numero,
        nivel: o.severidad,
        sumilla: o.sumilla,
        condicion: (o.condicion ?? []).join("\n\n"),
        criterio: {
          a_la_fecha: o.criterio?.fecha,
          ley: o.criterio?.ley,
          normas: (o.criterio?.normas ?? []).map((n: Fila) => ({
            norma: tituloNorma(n), tema: n.epigrafe ?? undefined, version: n.version ?? undefined,
            extracto: recortar(n.extracto, 400), enlace: n.url ?? undefined,
          })),
        },
        efecto: o.efecto,
        causa: o.causa,
        evidencia: (o.evidencia ?? []).map((e: Fila) => ({ texto: e.texto, enlace: e.copia ?? e.url, seace: e.copia ? e.url : undefined })),
        precedentes: (o.precedentes ?? []).map((q: Fila) => ({ informe: q.numero ?? q.codigo, entidad: q.entidad, anio: q.anio, observacion: recortar(q.observacion ?? q.titulo, 300), enlace: q.url ?? undefined })),
      })),
      otras_senales: d.otrasSenales,
      conclusion: d.conclusion,
      recomendaciones: d.recomendaciones,
      fuentes: (d.fuentes ?? []).length,
      aviso: AVISO,
    };
  },
});

export const HERRAMIENTAS_CONTROL = [informeControlContrato];
