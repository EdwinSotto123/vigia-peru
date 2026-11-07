import { diasHasta, instante } from "./formato.ts";

/**
 * Las notificaciones de la app, desde dos fuentes reales de la cuenta:
 *  - los plazos de lo que sigues (GET /seguimiento) que vencen en los próximos 3 días: fin de consultas, cierre de una
 *    cotización, buena pro. Urgente si vence hoy o mañana.
 *  - lo nuevo que encontraron tus alertas (GET /bandeja: cada envío con sus oportunidades).
 * Cada una dice qué pasó y a dónde ir. Leídas o no se guarda en el navegador por su id (estable: el id de un plazo
 * lleva su fecha, así una prórroga vuelve a avisar).
 */

export interface PlazoN {
  clave: string;
  etiqueta: string;
  fecha: string;
}

export interface ItemN {
  tipo: string;
  ref: string;
  titulo: string | null;
  estado: string;
  plazos: PlazoN[];
}

export interface EnvioN {
  id: number;
  tipo: string;
  asunto: string | null;
  /** «YYYY-MM-DD HH:MI», hora de Lima (GET /bandeja). */
  creado: string;
  items: { ref: string; titulo: string; enlace: string }[];
  nItems: number;
}

export interface Notificacion {
  id: string;
  tipo: "vence" | "alerta";
  titulo: string;
  texto: string;
  /** Para ordenar y mostrar: el plazo (vence) o cuándo llegó (alerta). */
  fecha: string;
  /** A dónde lleva, dentro del producto. */
  href: string;
  urgente: boolean;
  /** Las primeras oportunidades de una alerta, para abrirlas desde la notificación. */
  items?: { titulo: string; enlace: string }[];
}

const ABIERTOS = new Set(["guardada", "preparando", "presentada"]);
const AVISA_DIAS = 3;

const cuando = (dias: number) => (dias <= 0 ? "vence hoy" : dias === 1 ? "vence mañana" : `vence en ${dias} días`);
const ruta = (i: ItemN) => (i.tipo === "menor" ? `/menor/${encodeURIComponent(i.ref)}` : `/app/oportunidad/${encodeURIComponent(i.ref)}?tab=cronograma`);
const isoLima = (creado: string) => (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(creado) ? `${creado.replace(" ", "T")}:00-05:00` : creado);

export function armarNotificaciones({ seguimiento, envios, ahora = Date.now() }: { seguimiento: ItemN[]; envios: EnvioN[]; ahora?: number }): Notificacion[] {
  const vencen: Notificacion[] = [];
  for (const i of seguimiento) {
    if (!ABIERTOS.has(i.estado)) continue;
    for (const p of i.plazos) {
      if (p.clave === "convocatoria" || !p.fecha) continue;
      const t = instante(p.fecha);
      if (Number.isNaN(t) || t < ahora) continue;
      const dias = diasHasta(p.fecha, ahora);
      if (dias > AVISA_DIAS) continue;
      vencen.push({
        id: `vence:${i.tipo}:${i.ref}:${p.clave}:${p.fecha}`,
        tipo: "vence",
        titulo: `${p.etiqueta}: ${cuando(dias)}`,
        texto: i.titulo || "Proceso sin descripción",
        fecha: p.fecha,
        href: ruta(i),
        urgente: dias <= 1,
      });
    }
  }
  vencen.sort((a, b) => instante(a.fecha) - instante(b.fecha));

  const alertas: Notificacion[] = envios
    .filter((e) => e.tipo === "alerta" && e.nItems > 0)
    .map((e) => ({
      id: `alerta:${e.id}`,
      tipo: "alerta" as const,
      titulo: e.asunto || "Lo nuevo de tu alerta",
      texto: e.nItems === 1 ? "1 oportunidad nueva que calza con tu alerta" : `${e.nItems} oportunidades nuevas que calzan con tu alerta`,
      fecha: isoLima(e.creado),
      href: "/app/notificaciones?ver=alertas",
      urgente: false,
      items: e.items.slice(0, 3).map((x) => ({ titulo: x.titulo, enlace: x.enlace })),
    }))
    .sort((a, b) => b.fecha.localeCompare(a.fecha));

  return [...vencen, ...alertas];
}

export const sinLeer = (ns: Notificacion[], leidas: ReadonlySet<string>) => ns.filter((n) => !leidas.has(n.id)).length;
