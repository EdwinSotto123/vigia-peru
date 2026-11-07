import type { Conteo, Oportunidad, ResultadoBandeja } from "./tipos.ts";
import { aDetalle, aOportunidad, comprador, type FichaCruda, type FilaCruda } from "./mapeo.ts";
import type { FiltrosBandeja } from "./filtros.ts";
import { normalizar } from "./filtros.ts";
import { conRiesgo } from "./senales.ts";
import { instante } from "./formato.ts";
import type { FuenteLicitaciones } from "./fuente-tipo.ts";

/**
 * El adaptador de demostración: una muestra real de Gobserva Licitaciones (convocatorias abiertas y sus fichas, bajadas
 * de nuestra API) sobre la que se filtra, se ordena, se pagina y se cuentan las facetas de verdad, en memoria. La UI no
 * sabe que es una muestra: el día que el adaptador `gobserva` lea la API en vivo, nada de la UI cambia.
 */

export type { FichaCruda, FilaCruda } from "./mapeo.ts";

export interface Muestra {
  tomada: string;
  oportunidades: FilaCruda[];
  fichas: Record<string, FichaCruda>;
}

const DIA = 86_400_000;

/** Lo que pasa cada filtro, salvo el que se nombra en `sin` (para contar su faceta con los demás puestos). */
function pasa(o: Oportunidad, f: FiltrosBandeja, ahora: number, texto: Map<string, string>, sin?: "tipo" | "region" | "proc"): boolean {
  if (f.q) {
    const t = texto.get(o.id) ?? "";
    if (!normalizar(f.q).split(" ").every((p) => t.includes(p))) return false;
  }
  if (sin !== "tipo" && f.tipo.length && !f.tipo.includes((o.tipo ?? "") as never)) return false;
  if (sin !== "region" && f.region.length && !f.region.includes(o.region ?? "")) return false;
  if (sin !== "proc" && f.proc && o.procedimiento !== f.proc) return false;
  if (f.min != null && (o.valor == null || o.valor < f.min)) return false;
  if (f.max != null && (o.valor == null || o.valor > f.max)) return false;
  if (instante(o.publicada, "inicio") < ahora - f.pub * DIA) return false;
  if (f.cons) {
    const fin = o.consultasHasta ? instante(o.consultasHasta) : NaN;
    if (Number.isNaN(fin)) return false;
    if (f.cons === "vencidas" ? fin >= ahora : fin < ahora) return false;
    if (f.cons === "3d" && fin > ahora + 3 * DIA) return false;
    if (f.cons === "7d" && fin > ahora + 7 * DIA) return false;
  }
  if (f.senal && !conRiesgo(o.senales)) return false;
  return true;
}

const conValorPrimero = (a: number | null, b: number | null, dir: 1 | -1) =>
  a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : (a - b) * dir;

function ordenar(xs: Oportunidad[], orden: FiltrosBandeja["orden"], ahora: number): Oportunidad[] {
  const desempate = (a: Oportunidad, b: Oportunidad) => b.publicada.localeCompare(a.publicada) || a.id.localeCompare(b.id);
  const fin = (o: Oportunidad) => {
    const t = o.consultasHasta ? instante(o.consultasHasta) : NaN;
    // Lo abierto primero, del que vence antes al que vence después; lo vencido y lo que no tiene plazo, al final.
    return Number.isNaN(t) ? Infinity : t < ahora ? Number.MAX_SAFE_INTEGER : t;
  };
  const cmp: Record<FiltrosBandeja["orden"], (a: Oportunidad, b: Oportunidad) => number> = {
    recientes: desempate,
    valor_desc: (a, b) => conValorPrimero(a.valor, b.valor, -1) || desempate(a, b),
    valor_asc: (a, b) => conValorPrimero(a.valor, b.valor, 1) || desempate(a, b),
    vence: (a, b) => fin(a) - fin(b) || desempate(a, b),
    entidad: (a, b) => (a.entidad.nombre ?? "~").localeCompare(b.entidad.nombre ?? "~", "es") || desempate(a, b),
  };
  return [...xs].sort(cmp[orden]);
}

function contar(xs: Oportunidad[], clave: (o: Oportunidad) => string | null): Conteo[] {
  const m = new Map<string, number>();
  for (const o of xs) {
    const k = clave(o);
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m].map(([clave, n]) => ({ clave, n })).sort((a, b) => b.n - a.n || a.clave.localeCompare(b.clave, "es"));
}

export function crearFuenteDemo(m: Muestra, reloj: () => number = Date.now): FuenteLicitaciones {
  const todas = m.oportunidades.map((f) => {
    const ficha = m.fichas[f.ocid];
    return aOportunidad(f, comprador(ficha?.inteligencia), f.consultasHasta ?? ficha?.consultas?.hasta ?? null);
  });
  const porId = new Map(todas.map((o) => [o.id, o]));
  const texto = new Map(
    todas.map((o) => [o.id, normalizar([o.objeto, o.codigo, o.entidad.nombre, o.entidad.ruc, m.fichas[o.id]?.descripcion].filter(Boolean).join(" "))]),
  );

  return {
    nombre: "demo",
    tomada: m.tomada,
    registros: todas.length,
    capacidades: { senal: true },

    async buscar(f) {
      const ahora = reloj();
      const filtradas = todas.filter((o) => pasa(o, f, ahora, texto));
      const total = filtradas.length;
      const paginas = Math.max(1, Math.ceil(total / f.tam));
      const pagina = Math.min(Math.max(1, f.pag), paginas);
      const data = ordenar(filtradas, f.orden, ahora).slice((pagina - 1) * f.tam, pagina * f.tam);
      const r: ResultadoBandeja = {
        data,
        total,
        pagina,
        tamano: f.tam,
        paginas,
        facetas: {
          tipo: contar(todas.filter((o) => pasa(o, f, ahora, texto, "tipo")), (o) => o.tipo),
          region: contar(todas.filter((o) => pasa(o, f, ahora, texto, "region")), (o) => o.region),
          proc: contar(todas.filter((o) => pasa(o, f, ahora, texto, "proc")), (o) => o.procedimiento),
        },
        resumen: {
          valorTotal: filtradas.reduce((s, o) => s + (o.valor ?? 0), 0),
          conValor: filtradas.filter((o) => o.valor != null).length,
          entidades: new Set(filtradas.map((o) => o.entidad.ruc ?? o.entidad.nombre)).size,
          conSenales: filtradas.filter((o) => conRiesgo(o.senales)).length,
          vencenSemana: filtradas.filter((o) => {
            const t = o.consultasHasta ? instante(o.consultasHasta) : NaN;
            return t >= ahora && t <= ahora + 7 * DIA;
          }).length,
        },
      };
      return r;
    },

    async oportunidad(id) {
      const o = porId.get(id);
      return o ? aDetalle(o, m.fichas[id]) : null;
    },
  };
}
