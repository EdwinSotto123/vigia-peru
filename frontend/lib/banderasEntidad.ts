import type { ApiEntidad } from "@/lib/api-client";
import { numero, plural } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";

/**
 * Las banderas de una entidad: lo que cuentan los filtros de la lista (captura, nepotismo, planilla con señal alta,
 * informes penales, plazas a la medida), cada una con su cuenta y el enlace a la evidencia en la ficha (los mismos
 * filtros que usa su Inicio). Las usan la fila de la lista (`EntidadesPanel`) y la cabecera de la ficha, que las lleva
 * fijas en todas sus pestañas: la misma bandera dice lo mismo en los dos lados.
 */
export interface BanderaEntidad {
  tipo: string;
  severidad: "alta" | "media" | "baja";
  /** El nombre de la bandera, corto y entero («Posible nepotismo»). */
  chip: string;
  /** Lo que se encontró, con su número («3 contratos los ganaron…»). */
  titulo: string;
  explica: string;
  href: string;
  /** Cuántos casos la sostienen, si se cuentan. */
  n: number | null;
}

const NEPOTISMO = "Un pariente que un funcionario declaró en su DJI figura entre sus locadores (indicio, no acusación)";
const TIPOS_CAPTURA = "partido_gobernante,vendio_gobernante,socio_en_entidad";

/**
 * `nepotismo`: cuántos parientes declarados son sus locadores (la ficha los cuenta), o sólo si hay (la lista trae un sí o
 * no). `null`: la API no trajo las señales (la celda dice «Sin dato», no «Ninguna»).
 */
export function banderasEntidad(
  ruc: string,
  s: ApiEntidad["senales"] | null | undefined,
  inf: ApiEntidad["informes"] | null | undefined,
  nepotismo: number | boolean | null | undefined,
): BanderaEntidad[] | null {
  const nep = typeof nepotismo === "number" ? (nepotismo > 0 ? nepotismo : null) : nepotismo ? 0 : null;
  if (!s || !inf) return nep != null ? [banderaNepotismo(ruc, nep)] : null;
  const ficha = `/entidad/${ruc}`;
  const partido = s.capturaPartido ? tituloNatural(s.capturaPartido) : null;
  const periodo = new URLSearchParams({ seccion: "contratos", vista: "contratos", cruce: TIPOS_CAPTURA, ...(s.capturaDesde ? { desde: s.capturaDesde } : {}), ...(s.capturaHasta ? { hasta: s.capturaHasta } : {}) });
  const out: BanderaEntidad[] = [];
  // El nepotismo primero entre las graves: es lo que más pesa y lo que menos se ve (está en sus locadores).
  if (nep != null) out.push(banderaNepotismo(ruc, nep));
  // Quienes financiaron la campaña del que gobierna y después trabajaron para él (migración 177): locadores y planilla.
  const financio = (s.financioLocadores ?? 0) + (s.financioPlanilla ?? 0);
  if (financio > 0) {
    const partidoF = s.financioPartido ? tituloNatural(s.financioPartido) : null;
    out.push({
      tipo: "financio_campana", severidad: "alta", chip: "Financiaron su campaña", n: financio,
      titulo: `${plural(financio, "persona que aportó", "personas que aportaron")} a la campaña${partidoF ? ` de ${partidoF}` : " del que gobierna"} ${financio === 1 ? "trabaja" : "trabajan"} para la entidad`,
      explica: "Aportaron (ONPE) a la campaña de la organización en la elección que la llevó a gobernar la entidad y después recibieron órdenes de servicio o entraron a su planilla. Aportar es legal: es un dato para revisar.",
      href: (s.financioLocadores ?? 0) > 0 ? `${ficha}?seccion=personas&psenal=financio_campana` : `${ficha}?seccion=planilla&lsenal=financio_campana`,
    });
  }
  if (s.captura > 0) {
    out.push({
      tipo: "captura", severidad: "alta", chip: "Captura política", n: s.captura,
      titulo: s.captura === 1 ? "1 contrato lo ganó una empresa ligada a la gestión" : `${numero(s.captura)} contratos los ganaron empresas ligadas a la gestión`,
      explica: `La empresa ganadora, o alguien detrás de ella, financió${partido ? ` a ${partido}, que la gobierna,` : " al partido que la gobierna"} o le vendió a su campaña, o un socio suyo trabaja en la entidad (ONPE, JNE, RNP). Contratos de su gobierno actual.`,
      href: `${ficha}?${periodo}`,
    });
  }
  if (s.planillaAlta > 0) {
    out.push({
      tipo: "planilla", severidad: "alta", chip: "Planilla con señal alta", n: s.planillaAlta,
      titulo: `${plural(s.planillaAlta, "persona de su planilla tiene", "personas de su planilla tienen")} una señal alta`,
      explica: "En su planilla del Portal de Transparencia: por ejemplo, cobran también por órdenes de servicio o fueron candidatos del partido que la gobierna.",
      href: `${ficha}?seccion=planilla&lsev=alta`,
    });
  }
  if (inf.penal > 0) {
    out.push({
      tipo: "penal", severidad: "media", chip: "Resp. penal presunta", n: inf.penal,
      titulo: `${plural(inf.penal, "informe de la Contraloría señala", "informes de la Contraloría señalan")} presunta responsabilidad penal`,
      explica: "De sus funcionarios, según los informes de control de la Contraloría. Es una presunción: no es una condena.",
      href: `${ficha}?seccion=control`,
    });
  }
  if (s.plazasSenales > 0) {
    out.push({
      tipo: "plazas", severidad: "media", chip: "Plazas a la medida", n: s.plazasSenales,
      titulo: `${plural(s.plazasSenales, "plaza CAS tiene", "plazas CAS tienen")} señales de plaza a la medida`,
      explica: "Convocatorias de SERVIR Talento Perú con rasgos de una plaza hecha a la medida de alguien: piden experiencia en la propia entidad, pagan mucho y piden poco o estuvieron publicadas muy poco tiempo. No prueban un direccionamiento.",
      href: `${ficha}?seccion=plazas&zsev=con`,
    });
  }
  return out;
}

/** `n` = 0: se sabe que hay, no cuántos (la lista). */
function banderaNepotismo(ruc: string, n: number): BanderaEntidad {
  return {
    tipo: "nepotismo", severidad: "alta", chip: "Posible nepotismo", n: n > 0 ? n : null,
    titulo: n > 0 ? `${plural(n, "pariente declarado por un funcionario es su locador", "parientes declarados por funcionarios son sus locadores")}` : "Posible nepotismo",
    explica: `${NEPOTISMO}.`,
    href: `/entidad/${ruc}?seccion=personas&psenal=nepotismo`,
  };
}
