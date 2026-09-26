/**
 * Catálogo de reglas (JSON estático generado por backend/scripts/exportar_reglas.py): etiqueta
 * humana de cada regla. Lo usan los motivos de revisión (procesamientos.ts) y GET /senales.
 */

import reglasJson from "../data/reglas.json" with { type: "json" };

export { reglasJson };

const etiquetas = new Map<string, string>();
{
  const rj = reglasJson as any;
  for (const p of Object.values(rj.perfiles ?? {}) as any[]) {
    for (const r of p.reglas ?? []) if (r?.id && r?.etiqueta && !etiquetas.has(r.id)) etiquetas.set(r.id, r.etiqueta);
  }
  for (const [id, v] of Object.entries(rj.otras_senales ?? {}) as [string, any][]) {
    if (v?.etiqueta && !etiquetas.has(id)) etiquetas.set(id, v.etiqueta);
  }
}

/** Etiqueta humana de una regla (reglas.json: perfiles + otras señales); cae al id legible. */
export function etiquetaRegla(id: string): string {
  return etiquetas.get(id) ?? id.replace(/_/g, " ").replace(/^\w/, (c: string) => c.toUpperCase());
}
