/**
 * Perfiles del equipo y qué puede hacer cada uno. Un solo lugar: lo usan el
 * proxy del servidor (que es quien de verdad deja pasar o no cada pedido al
 * API), la navegación del panel y los botones de cada página.
 *
 *  · admin   · todo: además de operar, la plata (validar aportes, financiadores,
 *              medios de pago), la configuración (umbrales, qué tipos se
 *              procesan) y el equipo.
 *  · revisor · opera: revisa las alertas frenadas y decide publicarlas o
 *              descartarlas, lee el informe y los documentos, procesa (lotes a
 *              nombre de Vigía, re-análisis, reintentos, análisis a demanda) y
 *              mira cobertura, clasificación y bitácora. No toca plata,
 *              configuración ni equipo.
 *
 * Puro (sin `server-only` ni hooks): corre en el servidor y en el navegador.
 */

export type Rol = "admin" | "revisor";

export const ROLES: Record<Rol, { nombre: string; descripcion: string }> = {
  admin: {
    nombre: "Administrador",
    descripcion: "Todo el panel: operación, aportes y pagos, configuración y equipo.",
  },
  revisor: {
    nombre: "Revisor",
    descripcion: "Revisa y publica alertas, lee informes y documentos, y procesa contratos. Sin acceso a aportes, pagos, configuración ni equipo.",
  },
};

export const esRol = (x: unknown): x is Rol => x === "admin" || x === "revisor";

/** Secciones del panel que el revisor NO ve (el resto, sí). */
const SOLO_ADMIN_SECCIONES = ["/admin/contribuciones", "/admin/financiadores", "/admin/pagos", "/admin/equipo"];

export function puedeVerSeccion(rol: Rol, pathname: string): boolean {
  if (rol === "admin") return true;
  return !SOLO_ADMIN_SECCIONES.some((s) => pathname === s || pathname.startsWith(`${s}/`));
}

/**
 * Pedidos al API (bajo /admin) que puede hacer el revisor. Todo lo que no está
 * acá es sólo del admin: aportes, financiadores, medios de pago, re-asignación,
 * escribir umbrales o el alcance del procesamiento, y el equipo.
 */
const REVISOR_API: [metodo: string, ruta: RegExp][] = [
  ["GET", /^\/(ping|resumen|operacion|salud|log|procesamientos|pedidos|cobertura|cobertura\/progreso|clasificacion\/resumen)$/],
  ["GET", /^\/revision$/],
  ["GET", /^\/revision\/[^/]+$/],
  ["GET", /^\/revision\/[^/]+\/informe$/],
  // Leer (no cambiar) la configuración que explica lo que se ve: umbrales y alcance.
  ["GET", /^\/config\/(self_eval|procesamiento)$/],
  ["GET", /^\/procesar-lote\/preview$/],
  // Decidir sobre una alerta en revisión: publicarla o descartarla (con motivo, queda en la bitácora).
  ["PUT", /^\/alertas\/[^/]+\/estado$/],
  // Procesar.
  ["POST", /^\/procesar-lote$/],
  ["POST", /^\/procesamientos\/[^/]+\/(reanalizar|reencolar)$/],
  ["POST", /^\/procesamientos\/reencolar-errores$/],
  ["POST", /^\/dispatcher\/run$/],
  ["POST", /^\/pedidos\/[^/]+\/reintentar$/],
];

/** ¿Este perfil puede hacer `metodo` sobre `/admin<ruta>` del API? `ruta` sin query string. */
export function puedeApi(rol: Rol, metodo: string, ruta: string): boolean {
  if (rol === "admin") return true;
  const m = metodo.toUpperCase() === "HEAD" ? "GET" : metodo.toUpperCase();
  return REVISOR_API.some(([mm, re]) => mm === m && re.test(ruta));
}

/** Acciones que las páginas muestran u ocultan según el perfil (el proxy igual las frena). */
export type Accion =
  | "editar_umbrales"
  | "editar_alcance"
  | "ver_financiamiento"
  | "gestionar_equipo"
  | "subir_medios_pago";

const ACCIONES_REVISOR: Accion[] = [];

export const puede = (rol: Rol | null | undefined, accion: Accion): boolean =>
  rol === "admin" || (rol === "revisor" && ACCIONES_REVISOR.includes(accion));
