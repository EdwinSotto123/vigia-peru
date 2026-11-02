import type { Metadata } from "next";
import type { ReactNode } from "react";
import { MarcoProducto } from "@/components/gobserva/MarcoProducto";
import { PRODUCTOS } from "@/lib/gobserva";
import { CONTRATACIONES_ABIERTAS, INFOBRAS, SEGUIMIENTO_INVERSIONES } from "@/lib/fuentes";
import { baseProducto } from "@/lib/gobserva-servidor";

export const metadata: Metadata = {
  metadataBase: new URL(`https://${PRODUCTOS.obras.host}`),
  title: { default: "Gobserva Obras: las obras públicas que se vienen y las que están en marcha", template: "%s | Gobserva Obras" },
  description: PRODUCTOS.obras.lema,
  openGraph: { siteName: "Gobserva Obras", locale: "es_PE", type: "website" },
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
        { ruta: "/planes", etiqueta: "Planes" },
        { ruta: "/mcp", etiqueta: "API y MCP" },
      ]}
      accion={{ ruta: "/planes", etiqueta: "Recibir alertas" }}
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
