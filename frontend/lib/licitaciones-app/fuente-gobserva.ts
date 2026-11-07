import "server-only";
import { pedir } from "@/lib/licitaciones";
import { aDetalle, aOportunidad, comprador, type FichaCruda, type FilaCruda } from "./mapeo";
import { aParams } from "./filtros";
import type { FuenteLicitaciones } from "./fuente-tipo";
import type { Conteo, ResultadoBandeja } from "./tipos";

/** Lo que devuelve GET /licitaciones/bandeja (backend/api/src/lib/bandeja.ts). */
interface RespuestaBandeja {
  total: number;
  pagina: number;
  paginas: number;
  tam: number;
  resumen: { total: number; conValor: number; valorTotal: number; entidades: number; vencenSemana: number };
  data: FilaCruda[];
  facetas: { tipo: Conteo[]; region: Conteo[]; proc: Conteo[] };
}

/** La ficha de GET /licitaciones/oportunidades/:ocid, con la fila que la encabeza. */
type FichaApi = FichaCruda & Omit<FilaCruda, "consultasHasta" | "items" | "comprador"> & { items?: FichaCruda["items"] };

/**
 * El adaptador en vivo: la bandeja y el detalle desde la API de Gobserva Licitaciones. La URL de la app pasa tal cual
 * (mismos nombres de filtros que /licitaciones/bandeja). Si la API falla, la página muestra su estado de error.
 */
export function crearFuenteGobserva(): FuenteLicitaciones {
  return {
    nombre: "gobserva",
    tomada: null,
    registros: null,
    capacidades: { senal: false },

    async buscar(f) {
      const r = await pedir<RespuestaBandeja>(`/bandeja?${aParams(f).toString()}`, 120);
      if (!r) throw new Error("La API de licitaciones no respondió.");
      const resultado: ResultadoBandeja = {
        data: r.data.map((x) => aOportunidad(x, comprador(x.comprador))),
        total: r.total,
        pagina: r.pagina,
        tamano: r.tam,
        paginas: r.paginas,
        facetas: r.facetas,
        resumen: { valorTotal: r.resumen.valorTotal, conValor: r.resumen.conValor, entidades: r.resumen.entidades, conSenales: null, vencenSemana: r.resumen.vencenSemana },
      };
      return resultado;
    },

    async oportunidad(id) {
      const f = await pedir<FichaApi>(`/oportunidades/${encodeURIComponent(id)}`, 300);
      if (!f) return null;
      const fila: FilaCruda = { ...f, consultasHasta: f.consultas?.hasta ?? null, items: f.items?.length ?? 0 };
      return aDetalle(aOportunidad(fila, comprador(f.inteligencia)), f);
    },
  };
}
