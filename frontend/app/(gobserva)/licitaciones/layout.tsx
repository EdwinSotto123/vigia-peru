import type { Metadata } from "next";
import type { ReactNode } from "react";
import { MarcoProducto } from "@/components/gobserva/MarcoProducto";
import { PRODUCTOS } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";
import { metadatosApp } from "@/lib/gobserva-pwa";

export const metadata: Metadata = {
  metadataBase: new URL(`https://${PRODUCTOS.licitaciones.host}`),
  title: { default: "Gobserva Licitaciones: oportunidades para venderle al Estado peruano", template: "%s | Gobserva Licitaciones" },
  description: PRODUCTOS.licitaciones.lema,
  openGraph: { siteName: "Gobserva Licitaciones", locale: "es_PE", type: "website" },
  ...metadatosApp("licitaciones"),
};

/** Gobserva Licitaciones (licitaciones.gobserva.cloud): el marco de marca Gobserva, sin la cabecera ni el menú de Vigía. */
export default function LayoutLicitaciones({ children }: { children: ReactNode }) {
  const base = baseProducto("licitaciones");
  return (
    <MarcoProducto
      producto="licitaciones"
      base={base}
      // «Planes» no va en el menú: es la acción de la cabecera («Ver planes»), y repetida no dejaba entrar la fila del
      // menú en el celular (a 390 px se cortaba «Inteligencia de mercado»).
      menu={[
        { ruta: "/oportunidades", etiqueta: "Oportunidades" },
        { ruta: "/mercado", etiqueta: "Mercado" },
        { ruta: "/#mcp", etiqueta: "API y MCP" },
      ]}
      accion={{ ruta: "/planes", etiqueta: "Ver planes" }}
      fuentes={[
        { nombre: "Contrataciones abiertas del OECE (OCDS)", url: "https://contratacionesabiertas.oece.gob.pe/" },
        { nombre: "CONOSCE, buscador del OECE", url: "https://conosce.oece.gob.pe/buscador/" },
        { nombre: "Buscador público del SEACE", url: "https://prod6.seace.gob.pe/buscador-publico" },
      ]}
    >
      {children}
    </MarcoProducto>
  );
}
