import type { ReactNode } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_SESION, rutaEn } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";

/**
 * La app (/app/*): sólo con la sesión abierta. Sin ella, a entrar, con la vuelta a donde ibas. El marco (barra lateral,
 * cabecera con buscador y pie) lo pone MarcoProducto → MarcoApp, el de toda la app: la cabecera de la portada nunca
 * aparece aquí.
 */
export default function LayoutApp({ children }: { children: ReactNode }) {
  if (cookies().get(COOKIE_SESION)?.value !== "1") {
    const base = baseProducto("empleo");
    const ruta = headers().get("x-gobserva-ruta") ?? "/app/para-ti";
    redirect(rutaEn(base, `/entrar?next=${encodeURIComponent(ruta)}`));
  }
  return children;
}
