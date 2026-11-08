/**
 * Cuentas separadas por app (2026-11-07, el usuario: «tenemos 1 solo inicio para las 3 apps, comparten correo y
 * contraseña, es algo que en diseño está mal»; y «¿se puede con AWS Cognito?»). Cada app de Gobserva tiene su propio
 * grupo de usuarios en Cognito (infrastructure/aws/cognito_gobserva.py), o sea su propio registro: una cuenta de Empleo
 * no entra a Licitaciones, y el mismo correo puede tener una cuenta en cada una con otra contraseña. Obras es parte de
 * Licitaciones (una sola suscripción): usa la cuenta de Licitaciones. Vigía y su MCP siguen con Firebase.
 *
 * Como cada grupo da sus propios uid (`sub`), todo lo de la cuenta (planes, alertas, guardados, búsquedas) ya queda de
 * una sola app: borrar la cuenta de Empleo no toca Licitaciones. Aquí, lo puro: qué grupo es de qué app, el emisor de un
 * token (para elegir con qué se verifica) y si una cuenta puede usar el pedido que hace.
 */

export type AppCuenta = "empleo" | "licitaciones";

export interface GrupoCognito {
  app: AppCuenta;
  pool: string;
  cliente: string;
  /** https://cognito-idp.<región>.amazonaws.com/<pool>: el `iss` de sus tokens. */
  emisor: string;
}

/** «empleo|us-east-2_X|cliente,licitaciones|us-east-2_Y|cliente» (COGNITO_GOBSERVA). Lo que no se entiende se ignora. */
export function leerCognito(texto: string | undefined): GrupoCognito[] {
  const r: GrupoCognito[] = [];
  for (const parte of (texto ?? "").split(",")) {
    const [app, pool, cliente] = parte.split("|").map((x) => x.trim());
    const region = /^([a-z]{2}-[a-z]+-\d)_[A-Za-z0-9]+$/.exec(pool ?? "")?.[1];
    if ((app === "empleo" || app === "licitaciones") && region && /^[a-z0-9]{20,40}$/.test(cliente ?? "")) {
      r.push({ app, pool, cliente, emisor: `https://cognito-idp.${region}.amazonaws.com/${pool}` });
    }
  }
  return r;
}

/**
 * Lo que dice un JWT (`iss`, `aud`) SIN verificarlo: sólo para elegir con qué se verifica (la firma, el emisor y la
 * audiencia se comprueban después). null si no es un JWT legible.
 */
export function reclamosSinVerificar(token: string): { iss: string | null; aud: string | null } | null {
  const partes = token.split(".");
  if (partes.length !== 3) return null;
  try {
    const b64 = partes[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4))) as { iss?: unknown; aud?: unknown };
    return { iss: typeof json.iss === "string" ? json.iss : null, aud: typeof json.aud === "string" ? json.aud : null };
  } catch {
    return null;
  }
}

/** El grupo de Cognito de un token, por su emisor (null: no es de una app de Gobserva, va con el Firebase de Vigía). */
export function grupoDelToken(token: string, grupos: GrupoCognito[]): GrupoCognito | null {
  const iss = reclamosSinVerificar(token)?.iss;
  return iss ? grupos.find((g) => g.emisor === iss) ?? null : null;
}

/** La app de la cuenta que corresponde a un producto: Obras va con Licitaciones. */
export function appDelProducto(p: unknown): AppCuenta | null {
  if (p === "empleo") return "empleo";
  if (p === "licitaciones" || p === "obras") return "licitaciones";
  return null;
}

/** Las rutas de la cuenta que son de una sola app aunque no digan el producto. */
export function appDeRuta(ruta: string): AppCuenta | null {
  if (/\/(lineas|para-ti|asistente|checklist)(\/|$)/.test(ruta)) return "licitaciones";
  if (/\/cv(\/|$)/.test(ruta)) return "empleo";
  return null;
}

export const NOMBRE_APP: Record<AppCuenta, string> = { empleo: "Gobserva Empleo", licitaciones: "Gobserva Licitaciones" };

/**
 * ¿Puede esta cuenta hacer este pedido? `cuenta`: la app del proyecto del token (null = cuenta de Vigía). `pedida`: la
 * app del producto que pide (null si el pedido no dice). Una cuenta de Vigía sólo pasa en la transición (`vigia` =
 * "todas") o, después, a leer sus planes (el MCP los consulta con la cuenta de Vigía). null = pasa.
 */
export function revisarApp(
  cuenta: AppCuenta | null,
  pedida: AppCuenta | null,
  o: { vigia: "todas" | "planes"; metodo: string; ruta: string },
): { error: string; detail: string } | null {
  if (cuenta === null) {
    if (o.vigia === "todas") return null;
    if (o.metodo === "GET" && /\/(planes|mcp)$/.test(o.ruta)) return null;
    return { error: "cuenta_vigia", detail: "Esa es una cuenta de Vigía. Cada app de Gobserva tiene su propia cuenta: créala o entra en esta app." };
  }
  if (pedida && pedida !== cuenta) {
    return {
      error: "otra_app",
      detail: `Esta es tu cuenta de ${NOMBRE_APP[cuenta]}. ${NOMBRE_APP[pedida]} tiene su propia cuenta: entra allá con su correo y su contraseña.`,
    };
  }
  return null;
}
