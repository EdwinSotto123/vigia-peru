import type { Metadata } from "next";
import type { ReactNode } from "react";
import { MarcoProducto } from "@/components/gobserva/MarcoProducto";
import { PRODUCTOS } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";

export const metadata: Metadata = {
  metadataBase: new URL(`https://${PRODUCTOS.licitaciones.host}`),
  title: { default: "Gobserva Licitaciones: oportunidades para venderle al Estado peruano", template: "%s | Gobserva Licitaciones" },
  description: PRODUCTOS.licitaciones.lema,
  openGraph: { siteName: "Gobserva Licitaciones", locale: "es_PE", type: "website" },
};

/** Gobserva Licitaciones (licitaciones.gobserva.cloud): el marco de marca Gobserva, sin la cabecera ni el menú de Vigía. */
export default function LayoutLicitaciones({ children }: { children: ReactNode }) {
  const base = baseProducto("licitaciones");
  return (
    <MarcoProducto
      producto="licitaciones"
      base={base}
      menu={[
        { ruta: "/oportunidades", etiqueta: "Oportunidades" },
        { ruta: "/mercado", etiqueta: "Inteligencia de mercado" },
        { ruta: "/planes", etiqueta: "Planes" },
        { ruta: "/#mcp", etiqueta: "API y MCP" },
      ]}
      accion={{ ruta: "/planes#unete", etiqueta: "Probar gratis" }}
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
