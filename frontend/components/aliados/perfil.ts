import { API_BASE } from "@/lib/api-client";
import { getComprobante, type Comprobante } from "@/lib/financiamiento";
import { comprobanteMaqueta, esSlugMaqueta, perfilMaqueta } from "@/lib/maqueta-aliados";
import type { ContribucionAliado } from "./CadenaAliado";

/**
 * Lectura del perfil de un aliado, compartida por el muro y por la ficha.
 *
 * Antes este fetch vivía suelto dentro de `app/(public)/aliado/[slug]/page.tsx`
 * y el muro no lo llamaba nunca — por eso cada tarjeta tenía que enviarte a
 * otra página para contarte algo. Ahora el resumen del panel lateral y la
 * ficha se alimentan del mismo lugar, así que no se pueden contradecir.
 *
 * `maqueta` no es un fallback: si está en false, un slug de maqueta devuelve
 * `null` (o sea 404). Los aliados inventados no existen sin el interruptor.
 */

export interface AliadoPerfil {
  /** El API lo devuelve como string; la maqueta usa enteros negativos. */
  id: number | string;
  tipo: "empresa" | "persona" | "organizacion";
  nombre: string;
  slug: string;
  logoUrl: string | null;
  desde: string;
}

export interface PerfilAliado {
  aliado: AliadoPerfil;
  contribuciones: ContribucionAliado[];
  esMaqueta: boolean;
}

/**
 * `revalidate` se pasa a mano porque en Next 14 el TTL de una ruta es el MÍNIMO
 * de todos sus fetches: si el muro pidiera doce perfiles a 30 s, toda
 * /app/aliados pasaría de regenerarse cada 300 s a cada 30 s sin que nadie lo
 * hubiera pedido. La ficha sí quiere 30; el muro, 300.
 */
export async function getPerfilAliado(slug: string, maqueta = false, revalidate = 30): Promise<PerfilAliado | null> {
  if (esSlugMaqueta(slug)) {
    if (!maqueta) return null;
    const p = perfilMaqueta(slug);
    return p ? { aliado: p.aliado, contribuciones: p.contribuciones, esMaqueta: true } : null;
  }
  try {
    const r = await fetch(`${API_BASE}/financiamiento/aliados/${encodeURIComponent(slug)}`, {
      next: { revalidate },
    } as any);
    if (!r.ok) return null;
    const data = (await r.json()) as { aliado: AliadoPerfil; contribuciones: ContribucionAliado[] };
    return { aliado: data.aliado, contribuciones: data.contribuciones ?? [], esMaqueta: false };
  } catch {
    return null;
  }
}

/** Comprobante de un aporte: del API si es real, generado si el aporte es de maqueta. */
export function getComprobanteDe(codigo: string, esMaqueta: boolean): Promise<Comprobante | null> {
  return esMaqueta ? Promise.resolve(comprobanteMaqueta(codigo)) : getComprobante(codigo);
}

export interface RegionAlcanzada {
  ubigeo: string;
  zona: string;
  aportes: number;
  contratos: number;
  procesados: number;
  senales: number;
}

export interface ResumenPerfil {
  aportes: number;
  financiados: number;
  leidos: number;
  conSenal: number;
  enRevision: number;
  /** Leídos que salieron limpios: ni señal publicada ni revisión pendiente. */
  sinSenal: number;
  regiones: RegionAlcanzada[];
}

/**
 * Agrega la línea de aportes en las cifras que la ficha y el panel muestran.
 * Una sola función para que el muro no sume de una manera y la ficha de otra.
 */
export function resumirContribuciones(contribuciones: ContribucionAliado[]): ResumenPerfil {
  const porZona = new Map<string, RegionAlcanzada>();
  let financiados = 0;
  let leidos = 0;
  let conSenal = 0;
  let enRevision = 0;

  for (const c of contribuciones) {
    financiados += c.contratos;
    leidos += c.procesados;
    conSenal += c.senales;
    enRevision += c.enRevision ?? 0;
    const previa = porZona.get(c.ubigeo);
    if (previa) {
      previa.aportes += 1;
      previa.contratos += c.contratos;
      previa.procesados += c.procesados;
      previa.senales += c.senales;
    } else {
      porZona.set(c.ubigeo, {
        ubigeo: c.ubigeo,
        zona: c.zona,
        aportes: 1,
        contratos: c.contratos,
        procesados: c.procesados,
        senales: c.senales,
      });
    }
  }

  return {
    aportes: contribuciones.length,
    financiados,
    leidos,
    conSenal,
    enRevision,
    sinSenal: Math.max(0, leidos - conSenal - enRevision),
    regiones: [...porZona.values()].sort((a, b) => b.contratos - a.contratos || a.zona.localeCompare(b.zona, "es")),
  };
}
