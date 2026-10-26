import { getRecientesPagina, type ContribucionReciente } from "@/lib/financiamiento";

/**
 * Los aportes confirmados agrupados por quien los hizo (/app/financiar, «Últimos aportes»): «Vigía Perú: 16 aportes,
 * 320 contratos, el último el 12 oct.» y los tres más recientes. Antes eran 16 filas casi idénticas («Vigía Perú
 * financió…») de un solo financiador, más largas que la lista de zonas que se viene a elegir.
 *
 * Las cuentas salen de los aportes mismos (`GET /financiamiento/recientes`, de a 100, hasta 500): con más de 500 se
 * agrupan los últimos 500 y se dice (`completo: false`). Sin JSX: lo usa el servidor.
 */

export interface GrupoAportes {
  clave: string;
  financiador: string;
  tipo: ContribucionReciente["tipo"];
  slug: string | null;
  logoUrl: string | null;
  aportes: number;
  contratos: number;
  /** El aporte más reciente (ISO). */
  ultimo: string;
}

export interface AportesAgrupados {
  /** Un grupo por financiador, el que aportó más recientemente primero. */
  grupos: GrupoAportes[];
  /** Los tres aportes más recientes, de cualquiera. */
  ultimos: ContribucionReciente[];
  /** Aportes confirmados en total (de quienes eligieron aparecer). */
  total: number;
  /** Se contaron todos los aportes; si no, los grupos cuentan los últimos `contados`. */
  completo: boolean;
  contados: number;
}

const POR_PAGINA = 100;
const TOPE = 500;
const ULTIMOS = 3;

const tiempo = (iso: string) => Date.parse(iso) || 0;

export function agruparAportes(items: ContribucionReciente[], total: number): AportesAgrupados {
  const porClave = new Map<string, GrupoAportes>();
  for (const c of items) {
    // El perfil identifica al aliado; sin perfil (anónimos o sin página), el nombre público.
    const clave = c.slug ? `slug:${c.slug}` : `nombre:${c.financiador}`;
    const g = porClave.get(clave);
    if (g) {
      g.aportes += 1;
      g.contratos += c.contratos;
      if (tiempo(c.pagadaAt) > tiempo(g.ultimo)) g.ultimo = c.pagadaAt;
    } else {
      porClave.set(clave, {
        clave,
        financiador: c.financiador,
        tipo: c.tipo,
        slug: c.slug,
        logoUrl: c.logoUrl,
        aportes: 1,
        contratos: c.contratos,
        ultimo: c.pagadaAt,
      });
    }
  }
  const ordenados = [...items].sort((a, b) => tiempo(b.pagadaAt) - tiempo(a.pagadaAt));
  return {
    grupos: [...porClave.values()].sort((a, b) => tiempo(b.ultimo) - tiempo(a.ultimo)),
    ultimos: ordenados.slice(0, ULTIMOS),
    total,
    completo: items.length >= total,
    contados: items.length,
  };
}

/** Pide los aportes (de a 100, hasta 500) y los agrupa. `null` si el API no respondió. */
export async function getAportesAgrupados(): Promise<AportesAgrupados | null> {
  const primera = await getRecientesPagina(POR_PAGINA, 0).catch(() => null);
  if (!primera) return null;
  let items = primera.data;
  const total = primera.total;
  const faltan = Math.min(total, TOPE) - items.length;
  if (faltan > 0 && items.length === POR_PAGINA) {
    const paginas = Math.ceil(faltan / POR_PAGINA);
    const mas = await Promise.all(
      Array.from({ length: paginas }, (_, i) => getRecientesPagina(POR_PAGINA, POR_PAGINA * (i + 1)).catch(() => null)),
    );
    for (const m of mas) if (m) items = items.concat(m.data);
  }
  return agruparAportes(items, total);
}
