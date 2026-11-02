import type { Metadata } from "next";
import type { ReactNode } from "react";
import { MarcoProducto } from "@/components/gobserva/MarcoProducto";
import { PRODUCTOS } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";

export const metadata: Metadata = {
  metadataBase: new URL(`https://${PRODUCTOS.empleo.host}`),
  title: { default: "Gobserva Empleo: todas las plazas CAS del Estado peruano", template: "%s | Gobserva Empleo" },
  description: PRODUCTOS.empleo.lema,
  openGraph: { siteName: "Gobserva Empleo", locale: "es_PE", type: "website" },
};

/** Gobserva Empleo (empleo.gobserva.cloud): el marco de marca Gobserva, sin la cabecera ni el menú de Vigía. */
export default function LayoutEmpleo({ children }: { children: ReactNode }) {
  const base = baseProducto("empleo");
  return (
    <MarcoProducto
      producto="empleo"
      base={base}
      menu={[
        { ruta: "/plazas", etiqueta: "Plazas abiertas" },
        { ruta: "/planes", etiqueta: "Planes" },
        { ruta: "/mcp", etiqueta: "Con tu IA (MCP)" },
      ]}
      accion={{ ruta: "/planes", etiqueta: "Recibir alertas" }}
      fuentes={[{ nombre: "SERVIR, ofertas laborales del Estado", url: "https://app.servir.gob.pe/DifusionOfertasExterno/faces/consultas/ofertas_laborales.xhtml" }]}
    >
      {children}
    </MarcoProducto>
  );
}
