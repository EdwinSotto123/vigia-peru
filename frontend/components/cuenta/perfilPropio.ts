import type { RedSocial } from "@/components/aliados/perfil";
import { CuentaError, type CambiosCuenta, type Perfil } from "@/lib/cuentas";
import { REDES, esCorreoValido, validarPerfil, type CampoPerfil } from "@/lib/perfilAliado";

/**
 * El perfil propio en /app/configuracion, sin JSX: el borrador que edita el formulario, qué se
 * manda al guardar (PUT /cuentas/me, contrato A6) y cómo un rechazo del API vuelve a su campo.
 */

export type TipoAliado = "persona" | "empresa" | "organizacion";

export interface BorradorPerfil {
  visible: boolean;
  nombre: string;
  tipo: TipoAliado;
  logoUrl: string | null;
  descripcion: string;
  sitioWeb: string;
  emailPublico: string;
  portadaUrl: string;
  redes: Partial<Record<RedSocial, string>>;
  /** Sólo se escribe si la cuenta aún no tiene RUC. */
  ruc: string;
  rucConfirmado: boolean;
}

/** Campos que pueden llevar un error: los del perfil, las redes por su clave, y los de la cuenta. */
export type CampoForm = CampoPerfil | "nombre" | "logoUrl" | "redes" | "ruc" | "rucConfirmado" | "correo";
export type ErroresForm = Partial<Record<CampoForm, string>>;

/** El id del control de cada campo: el error se enlaza con él y el foco va ahí. */
export const idCampo = (c: CampoForm) => `cuenta-${c}`;

/** Orden en la página: al guardar con errores, el foco va al primero. */
export const ORDEN_CAMPOS: CampoForm[] = [
  "nombre", "logoUrl", "descripcion", "sitioWeb", "emailPublico",
  ...REDES.map((r) => r.red), "redes", "portadaUrl", "ruc", "rucConfirmado", "correo",
];

export function borradorDesde(p: Perfil): BorradorPerfil {
  return {
    visible: p.visible,
    nombre: p.nombrePublico ?? "",
    tipo: p.tipo ?? "persona",
    logoUrl: p.logoUrl,
    descripcion: p.descripcion ?? "",
    sitioWeb: p.sitioWeb ?? "",
    emailPublico: p.emailPublico ?? "",
    portadaUrl: p.portadaUrl ?? "",
    redes: { ...(p.redes ?? {}) },
    ruc: "",
    rucConfirmado: false,
  };
}

/**
 * Valida todo y arma el cuerpo del PUT. `completo`: la API acepta el perfil público entero
 * (si no, sólo viajan nombre, tipo, logo y visibilidad, como antes).
 */
export function prepararCambios(
  perfil: Perfil,
  b: BorradorPerfil,
  cuenta: { correo: string; notificaciones: Record<string, boolean> },
  completo: boolean,
): { cuerpo: CambiosCuenta; errores: ErroresForm } {
  const errores: ErroresForm = {};
  const nombre = b.nombre.trim();
  if (b.visible && nombre.length < 2) errores.nombre = "Para aparecer en público necesitas un nombre de al menos 2 caracteres.";
  const correo = cuenta.correo.trim();
  if (correo && !esCorreoValido(correo.toLowerCase())) errores.correo = "No es un correo válido. Revisa que tenga la forma nombre@dominio.pe.";

  const cuerpo: CambiosCuenta = {
    nombrePublico: nombre || null,
    tipo: b.tipo,
    visible: b.visible,
    logoUrl: b.logoUrl,
    correo: correo || null,
    notificaciones: cuenta.notificaciones,
  };

  if (completo) {
    const r = validarPerfil(perfil, b);
    Object.assign(errores, r.errores);
    Object.assign(cuerpo, r.cambios);
    const ruc = b.ruc.trim();
    if (!perfil.ruc && ruc) {
      if (!/^\d{11}$/.test(ruc)) errores.ruc = `El RUC tiene 11 dígitos y escribiste ${ruc.length}.`;
      else if (!b.rucConfirmado) errores.rucConfirmado = "Confirma que el RUC es correcto: después no se puede cambiar.";
      else cuerpo.ruc = ruc;
    }
  }
  return { cuerpo, errores };
}

const CAMPOS_DIRECTOS = new Set<string>(["descripcion", "sitioWeb", "emailPublico", "portadaUrl", "logoUrl", "ruc", "correo"]);
const esRed = (c: string): c is RedSocial => REDES.some((r) => r.red === c);

/** "redes.facebook", "facebook", "nombrePublico"… → el campo del formulario, o null si no es uno de ellos. */
function campoDelApi(c: string | null): CampoForm | null {
  if (!c) return null;
  const [a, b] = c.split(/[./]/);
  if (a === "nombrePublico") return "nombre";
  if (a === "redes") return b && esRed(b) ? b : "redes";
  if (esRed(a)) return a;
  return CAMPOS_DIRECTOS.has(a) ? (a as CampoForm) : null;
}

/** Un rechazo del API, en su campo si se sabe cuál es; si no, como aviso general. */
export function erroresDelApi(e: unknown): { errores: ErroresForm; general: string | null; rucFijado: boolean } {
  if (!(e instanceof CuentaError)) return { errores: {}, general: (e as Error)?.message || "No pudimos guardar tus cambios.", rucFijado: false };
  if (e.codigo === "ruc_inmutable") {
    return { errores: { ruc: "Tu cuenta ya tiene un RUC registrado y no se puede cambiar." }, general: null, rucFijado: true };
  }
  if (e.status >= 500) return { errores: {}, general: "No pudimos guardar tus cambios. Inténtalo otra vez en un momento.", rucFijado: false };
  if (e.status === 401) return { errores: {}, general: "Tu sesión venció. Vuelve a entrar para guardar tus cambios.", rucFijado: false };
  const campo = campoDelApi(e.campo);
  // `perfil_invalido` trae el motivo en palabras; zod (`invalid_body`) sólo el código.
  const texto = e.codigo === "perfil_invalido" && e.message ? e.message : "No se aceptó este dato. Revísalo.";
  if (campo) return { errores: { [campo]: texto }, general: null, rucFijado: false };
  return { errores: {}, general: e.codigo === "perfil_invalido" && e.message ? e.message : "No se aceptaron los datos. Revisa lo que escribiste.", rucFijado: false };
}

/**
 * Si el equipo de Vigía ocultó el perfil (moderación o conflicto de interés), qué decirle a
 * quien aporta, en palabras. null si no está oculto por moderación.
 */
export function motivoOculto(p: Perfil): string | null {
  if (p.aliadoVisible !== false || !p.motivoNoVisible || p.motivoNoVisible === "cuenta_borrada") return null;
  switch (p.motivoNoVisible) {
    case "sancion_vigente_osce":
      return "Tu perfil no se muestra en público: el RUC registrado tiene una sanción vigente del OECE.";
    case "proveedor_con_alertas_activas":
      return "Tu perfil no se muestra en público: el RUC registrado figura como proveedor en contratos con señales activas.";
    case "solicitud_del_financiador":
      return "Ocultamos tu perfil del ranking, de tu página y de los comprobantes públicos porque lo pediste.";
    default:
      return "El equipo de Vigía ocultó tu perfil del ranking, de tu página y de los comprobantes públicos.";
  }
}
