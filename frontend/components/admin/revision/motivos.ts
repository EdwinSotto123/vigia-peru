/**
 * Por qué la autoevaluación no dejó publicar un análisis, dicho en palabras.
 *
 * El API trae el motivo de dos formas: el aviso que el pipeline dejó al bloquear
 * (`motivoPipeline`: "respaldo de banderas 50% < 60% (4 juzgadas)", con el umbral que aplicó
 * ESE día) y los motivos recalculados con los umbrales de hoy (`motivos`). Manda el del pipeline,
 * que es lo que pasó; si no quedó, se usan los recalculados. En los dos casos los conteos salen de
 * la autoevaluación guardada (n juzgadas, ok aprobadas), no de un porcentaje redondeado.
 */

import type { MotivoBloqueo, RevisionDetalle } from "@/lib/admin";

export interface MotivoLlano {
  clave: string;
  /** Una oración: qué no alcanzó y cuánto se pedía. */
  texto: string;
  /** Qué quiere decir para quien decide. */
  ayuda?: string;
}

type Clave = MotivoBloqueo["clave"];
type Crudo = { clave: Clave | "otro"; valor?: number | null; umbral?: number | null; texto?: string };
type Conteo = { n?: number; ok?: number } | null | undefined;

const pct = (x: number) => `${Math.round(x * 100)} %`;

/** "Sólo 2 de 4 señales quedaron respaldadas…", "Ninguna de las 3 señales…", "Sólo 1 de 4 señales quedó…". */
function soloDe(ok: number, n: number, nombre: string, verbo: [singular: string, plural: string]): string {
  if (ok <= 0) return `Ninguna de las ${n} ${nombre} ${verbo[0]}`;
  if (ok === 1) return `Sólo 1 de ${n} ${nombre} ${verbo[0]}`;
  return `Sólo ${ok} de ${n} ${nombre} ${verbo[1]}`;
}

/**
 * Con conteo, "Sólo 2 de 4 señales…"; sin él, "Sólo el 50 % de las señales…". Si el conteo guardado
 * no coincide con el porcentaje con que se bloqueó (la autoevaluación se volvió a correr), manda el
 * porcentaje del bloqueo y se avisa que el conteo de hoy es otro.
 */
function proporcion(c: Conteo, valor: number | null | undefined, nombre: string, verbo: [string, string]): { texto: string; aviso?: string } {
  const n = Number(c?.n ?? 0);
  const ok = Number(c?.ok ?? 0);
  if (n > 0 && (valor == null || Math.abs(ok / n - valor) < 0.01)) return { texto: soloDe(ok, n, nombre, verbo) };
  if (valor == null) return { texto: `Algunas ${nombre} no pasaron la comprobación` };
  if (n === 0) return { texto: `Sólo el ${pct(valor)} de las ${nombre} ${verbo[0]}` };
  return {
    texto: `Al bloquearse, sólo el ${pct(valor)} de las ${nombre} ${verbo[0]}`,
    aviso: ` La autoevaluación guardada hoy da ${ok} de ${n}: revisa el juicio de abajo.`,
  };
}

const minimo = (u: number | null | undefined) => (u != null ? ` (mínimo ${pct(u)})` : "");

/** El aviso del pipeline, ya partido en motivos. Lo que no se reconoce se devuelve como texto. */
function desdePipeline(msg: string | null | undefined): Crudo[] {
  if (!msg?.trim()) return [];
  const out: Crudo[] = [];
  const re = /respaldo de banderas\s+(\d+)\s*%\s*<\s*(\d+)\s*%/i.exec(msg);
  if (re) out.push({ clave: "respaldo", valor: Number(re[1]) / 100, umbral: Number(re[2]) / 100 });
  if (/tono acusatorio/i.test(msg)) out.push({ clave: "tono" });
  if (/incoherentes? con el objeto/i.test(msg)) out.push({ clave: "coherencia" });
  const ci = /sin norma\s*\/?\s*fuente\s+(\d+)\s*%/i.exec(msg);
  if (ci) out.push({ clave: "cita", valor: 1 - Number(ci[1]) / 100 });
  const pr = /precio plausibles?\s+(\d+)\s*%\s*<\s*(\d+)\s*%/i.exec(msg);
  if (pr) out.push({ clave: "precio", valor: Number(pr[1]) / 100, umbral: Number(pr[2]) / 100 });
  if (!out.length) out.push({ clave: "otro", texto: msg.trim() });
  return out;
}

export function motivosLlanos(d: Pick<RevisionDetalle, "motivoPipeline" | "motivos" | "autoevaluacion" | "umbrales">): MotivoLlano[] {
  const ae = d.autoevaluacion;
  const u = d.umbrales;
  const base: Crudo[] = desdePipeline(d.motivoPipeline);
  const crudos = base.length ? base : d.motivos.map((m) => ({ clave: m.clave, valor: m.valor, umbral: m.umbral, texto: m.texto }));

  /** Motivo por proporción: la oración, el mínimo exigido y, si hace falta, el aviso de conteo distinto. */
  const porProporcion = (clave: string, p: { texto: string; aviso?: string }, umbral: number | null | undefined, ayuda: string): MotivoLlano =>
    ({ clave, texto: `${p.texto}${minimo(umbral)}.`, ayuda: `${ayuda}${p.aviso ?? ""}` });

  const out = crudos.map((m): MotivoLlano => {
    switch (m.clave) {
      case "respaldo":
        return porProporcion(m.clave,
          proporcion(ae?.respaldo, m.valor, "señales", ["quedó respaldada por la evidencia", "quedaron respaldadas por la evidencia"]),
          m.umbral ?? u?.min_respaldo,
          "De las que no, el evaluador no encontró el dato en el expediente, en el registro OCDS ni en las fuentes consultadas.");
      case "cita":
        return porProporcion(m.clave,
          proporcion(ae?.cita, m.valor, "señales", ["cita su norma y su fuente", "citan su norma y su fuente"]),
          m.umbral ?? u?.min_cita,
          "Una señal sin la norma y el enlace oficial que la sostienen no se puede comprobar.");
      case "precio":
        return porProporcion(m.clave,
          proporcion(ae?.precio, m.valor, "comparaciones de precio con el mercado", ["parece razonable", "parecen razonables"]),
          m.umbral ?? u?.min_precio,
          "El evaluador duda de que los precios de referencia sean comparables con lo que se compró.");
      case "tono":
        return { clave: m.clave, texto: "El dictamen está escrito en un tono acusatorio.", ayuda: "Vigía señala riesgos, no acusa a nadie. Lee el dictamen antes de decidir." };
      case "coherencia":
        return { clave: m.clave, texto: "Los ítems no corresponden con el objeto del contrato.", ayuda: "Puede ser un error al leer los documentos: revisa la pestaña de ítems." };
      case "urls":
        return { clave: m.clave, texto: "Algún enlace, RUC o fecha citados no se pudo comprobar en fuentes oficiales." };
      default: {
        const t = (m.texto ?? "").trim();
        return { clave: m.clave, texto: t ? t.charAt(0).toUpperCase() + t.slice(1) : "La autoevaluación no alcanzó el mínimo para publicar." };
      }
    }
  });

  if (!out.length) {
    return [{ clave: "general", texto: "La autoevaluación no dejó un motivo legible.", ayuda: "Revisa las señales y el dictamen antes de decidir." }];
  }
  return out;
}
