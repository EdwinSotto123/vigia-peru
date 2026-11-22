/**
 * Cada app de Gobserva con su propia cuenta (2026-11-07): Empleo y Licitaciones tienen cada una su grupo de usuarios en
 * AWS Cognito (infrastructure/aws/cognito_gobserva.py). Una cuenta de Empleo no entra a Licitaciones y el mismo correo
 * puede tener una cuenta en cada una, con otra contraseña. Obras es parte de Licitaciones (una sola suscripción): usa la
 * cuenta de Licitaciones. Vigía sigue con su Firebase.
 *
 * Aquí lo puro (se prueba con node --test, sin «@/»): de qué app es el sitio, los ids públicos de cada grupo (un
 * cliente sin secreto: no son claves), leer un token sin verificarlo (la API sí lo verifica) y los errores de Cognito
 * dichos para quien entra.
 */

// Gobserva Salud (2026-11-21): una cuenta gratis y sencilla, también con su propio grupo (guarda clínicas, médicos y
// medicamentos; sin planes).
export type AppCuenta = "empleo" | "licitaciones" | "salud";

export const NOMBRE_APP: Record<AppCuenta, string> = { empleo: "Gobserva Empleo", licitaciones: "Gobserva Licitaciones", salud: "Gobserva Salud" };

export const COGNITO: Record<AppCuenta, { region: string; pool: string; cliente: string }> = {
  empleo: { region: "us-east-2", pool: "us-east-2_6NbPbjwJL", cliente: "44beeckthuc0fbd5kcglljsngq" },
  licitaciones: { region: "us-east-2", pool: "us-east-2_crVrk38vW", cliente: "3o2hsar23q2hn064eg69cqn9ic" },
  salud: { region: "us-east-2", pool: "us-east-2_n5EEwMklV", cliente: "2h67lbj9l2qdrntc00iefr13dd" },
};

/** La app del sitio: por el subdominio (empleo., licitaciones-dev., obras.) o, en DEV por ruta, por el primer tramo. */
export function appDelSitio(host: string, ruta = "/"): AppCuenta | null {
  const h = host.toLowerCase().match(/^(empleo|licitaciones|obras|salud)(-dev)?\.gobserva\.cloud$/);
  const r = h ? null : ruta.match(/^\/(empleo|licitaciones|obras|salud)(\/|$)/);
  const p = h?.[1] ?? r?.[1];
  if (!p) return null;
  return p === "empleo" ? "empleo" : p === "salud" ? "salud" : "licitaciones";
}

/** La app de un producto: Obras va con Licitaciones. */
export const appDelProducto = (p: string): AppCuenta => (p === "empleo" ? "empleo" : p === "salud" ? "salud" : "licitaciones");

/** Lo que trae el token de identidad de Cognito (sin verificar: sólo para mostrar quién entró y cuándo vence). */
export interface Reclamos {
  sub: string;
  email: string | null;
  emailVerificado: boolean;
  nombre: string | null;
  /** Vencimiento, en milisegundos. */
  vence: number;
}

export function leerToken(token: string): Reclamos | null {
  const partes = token.split(".");
  if (partes.length !== 3) return null;
  try {
    const b64 = partes[1].replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const texto = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    const j = JSON.parse(texto) as Record<string, unknown>;
    if (typeof j.sub !== "string" || typeof j.exp !== "number") return null;
    return {
      sub: j.sub,
      email: typeof j.email === "string" ? j.email : null,
      emailVerificado: j.email_verified === true || j.email_verified === "true",
      nombre: typeof j.name === "string" && j.name.trim() ? j.name : null,
      vence: j.exp * 1000,
    };
  } catch {
    return null;
  }
}

/** El error de Cognito (su `__type`) dicho para quien entra. */
export function mensajeCognito(tipo: string): string {
  const M: Record<string, string> = {
    NotAuthorizedException: "El correo o la contraseña no coinciden.",
    UserNotFoundException: "El correo o la contraseña no coinciden.",
    UsernameExistsException: "Ya tienes una cuenta en esta app con ese correo.",
    UserNotConfirmedException: "Falta confirmar tu correo con el código que te mandamos.",
    CodeMismatchException: "Ese código no es el que te mandamos. Revísalo y vuelve a escribirlo.",
    ExpiredCodeException: "Ese código venció. Pide uno nuevo.",
    InvalidPasswordException: "La contraseña debe tener al menos 8 caracteres.",
    InvalidParameterException: "Revisa lo que escribiste: el correo o la contraseña no son válidos.",
    LimitExceededException: "Hiciste muchos intentos. Espera unos minutos y vuelve a probar.",
    TooManyRequestsException: "Hiciste muchos intentos. Espera unos minutos y vuelve a probar.",
    TooManyFailedAttemptsException: "Hiciste muchos intentos. Espera unos minutos y vuelve a probar.",
    CodeDeliveryFailureException: "No pudimos mandarte el correo ahora. Vuelve a intentarlo en unos minutos.",
    PasswordResetRequiredException: "Tienes que elegir una contraseña nueva: usa «¿La olvidaste?».",
    red: "No pudimos conectarnos. Revisa tu internet y vuelve a intentarlo.",
  };
  return M[tipo] ?? "No pudimos completar eso. Vuelve a intentarlo.";
}
