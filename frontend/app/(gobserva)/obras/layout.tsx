import type { Metadata } from "next";
import type { ReactNode } from "react";
import { MarcoProducto } from "@/components/gobserva/MarcoProducto";
import { urlCanonica } from "@/lib/gobserva";
import { PRODUCTOS } from "@/lib/gobserva";
import { COBROS_EN_PAUSA } from "@/lib/gobserva-planes";
import { CONTRATACIONES_ABIERTAS, INFOBRAS, SEGUIMIENTO_INVERSIONES } from "@/lib/fuentes";
import { baseProducto } from "@/lib/gobserva-servidor";
import { metadatosApp } from "@/lib/gobserva-pwa";

export const metadata: Metadata = {
  metadataBase: new URL(`https://${PRODUCTOS.obras.host}`),
  title: { default: "Gobserva Obras: las obras públicas que se vienen y las que están en marcha", template: "%s | Gobserva Obras" },
  description: PRODUCTOS.obras.lema,
  openGraph: { siteName: "Gobserva Obras", locale: "es_PE", type: "website" },
  ...metadatosApp("obras"),
};

/** Gobserva Obras (obras.gobserva.cloud): el marco de marca Gobserva, sin la cabecera ni el menú de Vigía. */
export default function LayoutObras({ children }: { children: ReactNode }) {
  const base = baseProducto("obras");
  return (
    <MarcoProducto
      producto="obras"
      base={base}
      menu={[
        { ruta: "/proyectos", etiqueta: "Proyectos" },
        { ruta: "/mercado", etiqueta: "Mercado" },
        // Obras viene incluido en los planes de Gobserva Licitaciones (2026-11-07).
        { ruta: urlCanonica("licitaciones", "/planes"), etiqueta: "Planes" },
        { ruta: "/mcp", etiqueta: "API y MCP" },
      ]}
      // Con los cobros en pausa, las alertas vienen gratis con la cuenta (la de Licitaciones): la acción lleva a crearla.
      accion={
        COBROS_EN_PAUSA
          ? { ruta: `/entrar?crear=1&next=${encodeURIComponent("/cuenta")}`, etiqueta: "Crear cuenta" }
          : { ruta: urlCanonica("licitaciones", "/planes"), etiqueta: "Recibir alertas" }
      }
      fuentes={[
        { nombre: "Invierte.pe, seguimiento de inversiones del MEF", url: SEGUIMIENTO_INVERSIONES },
        { nombre: "INFOBRAS, obras públicas de la Contraloría", url: INFOBRAS },
        { nombre: "Contrataciones abiertas del OECE (SEACE)", url: CONTRATACIONES_ABIERTAS },
        { nombre: "CONOSCE, buscador del OECE", url: "https://conosce.oece.gob.pe/buscador/" },
      ]}
    >
      {children}
    </MarcoProducto>
  );
}
