/**
 * Tipos y helpers de query de /app/alertas (mismo patrón que ContratosQuery/
 * parseContratosQuery/contratosQueryString en lib/contratos.ts).
 *
 * Viven en un módulo plano (sin "use client") a propósito: page.tsx (Server Component)
 * necesita LLAMAR a `parseAlertasQuery` directamente, no solo renderizarla como JSX. Un
 * export de un archivo "use client" se reemplaza en el bundle de servidor por un proxy
 * de referencia (solo válido como <Componente/>) — llamarlo como función normal revienta
 * en build ("X is not a function") aunque `tsc`/`next build`'s fase de compilación no lo
 * detecte. Por eso estos helpers están acá y no dentro de FiltrosAlertas.tsx.
 */

export type EstadoAlerta = "activa" | "confirmada" | "descartada" | "en_revision";

export interface AlertasQuery {
  region?: string;
  estado?: EstadoAlerta;
  scoreMin?: number;
}

export const ESTADOS_ALERTA_VALIDOS = new Set<string>(["activa", "confirmada", "descartada", "en_revision"]);

/** Arma la query string de /app/alertas; `pagina` se omite cuando es 1 (igual que contratosQueryString). */
export function alertasQueryString(q: AlertasQuery & { pagina?: number } = {}): string {
  const params = new URLSearchParams();
  if (q.region) params.set("region", q.region);
  if (q.estado) params.set("estado", q.estado);
  if (q.scoreMin != null) params.set("scoreMin", String(q.scoreMin));
  if (q.pagina && q.pagina > 1) params.set("pagina", String(q.pagina));
  return params.toString();
}

/** Lee `searchParams` de Next (strings sueltos) y deja solo lo válido. */
export function parseAlertasQuery(sp: Record<string, string | string[] | undefined> = {}): AlertasQuery & { pagina: number } {
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const pagina = Math.max(1, Number.parseInt(s("pagina") ?? "1", 10) || 1);
  const estado = s("estado");
  const scoreMinRaw = s("scoreMin");
  const scoreMin = scoreMinRaw && /^\d{1,3}$/.test(scoreMinRaw) ? Math.min(100, Math.max(0, Number(scoreMinRaw))) : undefined;
  return {
    pagina,
    region: s("region")?.trim().slice(0, 80) || undefined,
    estado: estado && ESTADOS_ALERTA_VALIDOS.has(estado) ? (estado as EstadoAlerta) : undefined,
    scoreMin,
  };
}
