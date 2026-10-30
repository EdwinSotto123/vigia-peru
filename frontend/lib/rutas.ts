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

/**
 * El aporte al fondo común (/app/apoyar) con la entidad (RUC) o la zona (ubigeo) que se miraba como destino sugerido.
 * Va sólo el código: la página saca el nombre de la base. Antes el enlace llevaba `&nombre=` y la página lo mostraba tal
 * cual venía (auditoría de pagos del 2026-10-30, H14).
 */
export function rutaApoyar(para?: string | null): string {
  return para && /^(\d{11}|\d{2}(\d{2}(\d{2})?)?)$/.test(para) ? `/app/apoyar?para=${para}` : "/app/apoyar";
}
