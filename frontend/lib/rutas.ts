/**
 * La página de un contrato es una sola: /app/contratos/[id], con tres vistas (antes, tres rutas):
 *   · ficha (por defecto): datos del proceso, cruces del ganador, evidencia oficial y el resumen de su lectura;
 *   · `?vista=dictamen`: el informe completo de la lectura (antes /app/convocatoria/[id]);
 *   · `?vista=vivo`: la lectura en vivo, con sus carriles y su bitácora (antes /app/auditoria/[ocid]).
 * `id` puede ser el OCID, el OCID largo o el código SEACE (la página resuelve y redirige).
 */
export type VistaContrato = "ficha" | "dictamen" | "vivo";

export function rutaContrato(id: string, vista: VistaContrato = "ficha", extra: Record<string, string | undefined> = {}): string {
  const q = new URLSearchParams();
  if (vista !== "ficha") q.set("vista", vista);
  for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
  const qs = q.toString();
  return `/app/contratos/${encodeURIComponent(id.replace(/^OECE-/i, ""))}${qs ? `?${qs}` : ""}`;
}
