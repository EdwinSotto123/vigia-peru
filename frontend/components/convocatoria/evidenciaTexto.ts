/**
 * La evidencia de una señal como datos (sin JSX): lo que necesitan tanto el informe en el navegador como el servidor que
 * arma la cabecera del contrato. Antes vivía en sections/Evidencia.tsx, un módulo "use client": llamarla desde el
 * servidor (contar las señales que cuentan con `separarBanderas`) tiraba, porque el servidor sólo ve una referencia.
 */

export interface CitaEvidencia {
  cita: string;
  url?: string | null;
  documento?: string | null;
  pagina?: number | null;
  verificada?: boolean | null;
}

/** Cualquier forma de `evidencia` → lista de citas. Nunca tira: lo que no se reconoce se descarta. */
export function normalizarEvidencia(e: unknown): CitaEvidencia[] {
  if (e == null) return [];
  if (typeof e === "string") return e.trim() ? [{ cita: e.trim() }] : [];
  if (typeof e === "number") return [{ cita: String(e) }];
  if (Array.isArray(e)) return e.flatMap((x) => normalizarEvidencia(x));
  if (typeof e === "object") {
    const o = e as Record<string, unknown>;
    const cita = typeof o.cita === "string" ? o.cita.trim() : typeof o.texto === "string" ? o.texto.trim() : "";
    if (!cita) return [];
    const pagina = Number(o.pagina ?? o.folio);
    return [
      {
        cita,
        url: typeof o.url === "string" ? o.url : null,
        documento: typeof o.documento === "string" ? o.documento : null,
        pagina: Number.isFinite(pagina) && pagina > 0 ? pagina : null,
        verificada: typeof o.verificada === "boolean" ? o.verificada : null,
      },
    ];
  }
  return [];
}

/** La evidencia como texto plano (para un subtítulo o un `title`). */
export function evidenciaComoTexto(e: unknown): string {
  return normalizarEvidencia(e)
    .map((c) => c.cita)
    .join("; ");
}
