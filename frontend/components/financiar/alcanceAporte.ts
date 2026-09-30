/**
 * Qué se financia en un aporte: una ZONA (sus contratos en cola, por antigüedad, mínimo 5)
 * o una ENTIDAD (sus contratos en cola, al azar, primero los que ya tienen documentos;
 * mínimo 1, porque una entidad puede tener menos de 5).
 *
 * Datos planos: el alcance lo arma un server component y viaja como prop al formulario.
 */

import { MIN_CONTRATOS, MIN_CONTRATOS_ENTIDAD } from "@/lib/financiamiento";
import { numero, plural } from "@/lib/formato";

export type AlcanceAporte =
  | { tipo: "zona"; ubigeo: string; nombre: string }
  | { tipo: "entidad"; ruc: string; nombre: string };

export const minimoDe = (a: AlcanceAporte) => (a.tipo === "zona" ? MIN_CONTRATOS : MIN_CONTRATOS_ENTIDAD);

/** Lo que va en el cuerpo de POST /contribuciones y POST /admin/procesar-lote. */
export const cuerpoAlcance = (a: AlcanceAporte): { ubigeo: string } | { entidadRuc: string } =>
  a.tipo === "zona" ? { ubigeo: a.ubigeo } : { entidadRuc: a.ruc };

/** La página donde se financia este alcance. */
export const hrefAlcance = (a: AlcanceAporte) => (a.tipo === "zona" ? `/app/financiar/${a.ubigeo}` : `/app/financiar/entidad/${a.ruc}`);

/**
 * Clave del borrador local (lib/cuentas lo guarda en `vigia:financiar:<clave>`): la zona
 * sigue usando su ubigeo, como siempre; la entidad, `entidad-<ruc>`, que no choca con ningún
 * ubigeo (sólo dígitos). También sirve de sufijo para los `id` y `name` del formulario.
 */
export const claveAlcance = (a: AlcanceAporte) => (a.tipo === "zona" ? a.ubigeo : `entidad-${a.ruc}`);

/** Cómo salen los contratos de la cola, para "se asignan N contratos de X …". */
export const ASIGNACION: Record<AlcanceAporte["tipo"], string> = {
  zona: "por antigüedad",
  entidad: "al azar, primero los que ya tienen sus documentos",
};

/** Opciones rápidas de cantidad: por zona se piensa en decenas; una entidad puede tener 1. */
export const PRESETS: Record<AlcanceAporte["tipo"], number[]> = {
  zona: [10, 20, 50, 100],
  entidad: [1, 5, 10],
};

/** Cuántos quedan, dicho como tope: "En Cusco quedan 12 contratos sin financiar…". */
export function mensajeTope(a: AlcanceAporte, restantes: number): string {
  return a.tipo === "zona"
    ? `En ${a.nombre} quedan ${numero(restantes)} contratos sin financiar: no se puede pedir más.`
    : `${a.nombre} tiene ${plural(restantes, "contrato", "contratos")} en cola: no se puede pedir más.`;
}

// ─── Errores del API → castellano (nunca un "invalid_body" crudo) ────────────

export const ERRORES_API: Record<string, string> = {
  ruc_required: "Empresas y organizaciones deben indicar su RUC.",
  email_required: "Sin sesión necesitamos un correo para asociar el aporte.",
  zona_not_found: "No encontramos esa zona. Vuelve a elegirla desde la lista.",
  entidad_no_encontrada: "No encontramos esa entidad. Vuelve a elegirla desde la lista.",
  entidad_sin_cola: "Esta entidad ya no tiene contratos en cola. Recarga la página para ver su estado.",
  excede_cola: "Pediste más contratos de los que hay en cola. Recarga la página y elige otra cantidad.",
  alcance_requerido: "Falta elegir una zona o una entidad. Vuelve a elegirla desde la lista.",
  minimo_contratos: `El mínimo por zona son ${MIN_CONTRATOS} contratos por aporte.`,
  sin_migracion: "Todavía no se puede financiar una entidad: estamos terminando de habilitarlo. Mientras tanto puedes financiar una zona.",
  internal: "No pudimos registrar el aporte por un error del servidor. Inténtalo de nuevo en un momento.",
  unauthorized: "Tu sesión de administrador venció. Vuelve a entrar al panel.",
};

export function erroresCampo(minimo: number): Record<string, string> {
  return {
    contratos: `La cantidad debe ser un número entero desde ${minimo}.`,
    email: "Ese correo no parece válido.",
    nombrePublico: "El nombre a mostrar debe tener entre 2 y 80 caracteres.",
    ruc: "El RUC debe tener 11 dígitos.",
    mensajePublico: "El mensaje público admite hasta 140 caracteres.",
    ubigeo: "La zona no es válida. Vuelve a elegirla desde la lista.",
    entidadRuc: "La entidad no es válida. Vuelve a elegirla desde la lista.",
  };
}

export interface RespuestaError {
  error?: string;
  issues?: { path?: (string | number)[] }[];
  /** `excede_cola`: cuántos contratos quedan en cola. */
  disponibles?: number;
  /** `minimo_contratos`: el mínimo que exige el backend. */
  minimo?: number;
}

export function mensajeDeError(j: RespuestaError | null, fallback: string, minimo: number): string {
  if (!j?.error) return fallback;
  if (j.error === "invalid_body") {
    const campo = j.issues?.[0]?.path?.slice(-1)[0];
    return (campo != null && erroresCampo(minimo)[String(campo)]) || "Revisa los datos: algún campo no tiene el formato esperado.";
  }
  if (j.error === "excede_cola" && typeof j.disponibles === "number") {
    return j.disponibles > 0
      ? `Quedan ${plural(j.disponibles, "contrato", "contratos")} en cola: elige ${j.disponibles === 1 ? "1" : `hasta ${numero(j.disponibles)}`}.`
      : ERRORES_API.entidad_sin_cola;
  }
  if (j.error === "minimo_contratos" && typeof j.minimo === "number") return `El mínimo son ${j.minimo} contratos por aporte.`;
  return ERRORES_API[j.error] ?? fallback;
}
