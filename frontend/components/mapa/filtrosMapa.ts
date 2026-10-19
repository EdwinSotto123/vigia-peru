/**
 * Filtros del mapa: los mismos de /app/contratos (GET /contratos/geo los entiende igual), para pintar sólo los
 * contratos que cumplen. Viven en la URL con los mismos nombres, así "Ver estos contratos" abre la lista ya filtrada.
 */
import { LECTURAS, TIPOS, type Lectura, type TipoContrato } from "@/lib/contratos";

export interface FiltrosMapa {
  /** Clave del partido que gobernaba la entidad al convocar. */
  partido?: string;
  tipo?: TipoContrato;
  lectura?: Lectura;
  /** Antecedentes del ganador: con alguno o con uno grave. */
  cruces?: "con" | "alta";
}

export const CLAVES_FILTRO = ["partido", "tipo", "lectura", "cruces"] as const;

export function filtrosDeUrl(sp: URLSearchParams): FiltrosMapa {
  const f: FiltrosMapa = {};
  const partido = sp.get("partido");
  if (partido && /^[a-z0-9-]{2,120}$/.test(partido)) f.partido = partido;
  const tipo = sp.get("tipo");
  if (TIPOS.some((t) => t.value === tipo)) f.tipo = tipo as TipoContrato;
  const lectura = sp.get("lectura");
  if (LECTURAS.some((l) => l.value === lectura)) f.lectura = lectura as Lectura;
  const cruces = sp.get("cruces");
  if (cruces === "con" || cruces === "alta") f.cruces = cruces;
  return f;
}

/** La lista de contratos con estos filtros (y la zona, si hay). */
export function hrefContratos(f: FiltrosMapa, ubigeo?: string | null): string {
  const q = new URLSearchParams();
  for (const k of CLAVES_FILTRO) if (f[k]) q.set(k, f[k]!);
  if (ubigeo) q.set("ubigeo", ubigeo);
  const qs = q.toString();
  return `/app/contratos${qs ? `?${qs}` : ""}`;
}
