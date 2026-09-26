/**
 * ¿El navegador habla con la API nueva? COMPAT-API-VIEJA.
 *
 * La API nueva (fase 1) agrega `version` al resumen de procesamientos en el mismo despliegue
 * que `/alertas/puntos`, `/financiamiento/procesamientos/ritmo` y `/alertas/:id/traza`. El
 * navegador lo pregunta una vez por página y recién entonces pide esos endpoints: probarlos
 * a ciegas contra la API vieja deja un 404 (un error rojo en la consola) en cada visita.
 * Los pedidos del servidor no lo necesitan: ahí un 404 no se ve.
 *
 * Borrar junto con los respaldos cuando la API nueva esté en prod.
 */

import { PUBLIC_API_BASE } from "./auditoria";

let consulta: Promise<boolean> | null = null;

/** `true` si el resumen trae `version` (API nueva). Sin respuesta, `false` y se vuelve a preguntar la próxima vez. */
export function apiNueva(): Promise<boolean> {
  if (!consulta) {
    consulta = fetch(`${PUBLIC_API_BASE}/financiamiento/procesamientos/resumen`, { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => typeof (j as { version?: unknown } | null)?.version === "string")
      .catch(() => {
        consulta = null;
        return false;
      });
  }
  return consulta;
}

/** Quien ya tiene el resumen en la mano (auditoría, mapa) lo anota: nadie lo vuelve a pedir para esto. */
export function anotarResumen(resumen: unknown): void {
  if (resumen && typeof resumen === "object") consulta = Promise.resolve(typeof (resumen as { version?: unknown }).version === "string");
}
