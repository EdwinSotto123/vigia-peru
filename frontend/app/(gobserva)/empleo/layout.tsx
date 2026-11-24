import type { Metadata } from "next";
import type { ReactNode } from "react";
import { MarcoProducto } from "@/components/gobserva/MarcoProducto";
import { PRODUCTOS } from "@/lib/gobserva";
import { COBROS_EN_PAUSA } from "@/lib/gobserva-planes";
import { baseProducto } from "@/lib/gobserva-servidor";
import { metadatosApp } from "@/lib/gobserva-pwa";

export const metadata: Metadata = {
  metadataBase: new URL(`https://${PRODUCTOS.empleo.host}`),
  title: { default: "Gobserva Empleo: todas las plazas CAS del Estado peruano", template: "%s | Gobserva Empleo" },
  description: PRODUCTOS.empleo.lema,
  openGraph: { siteName: "Gobserva Empleo", locale: "es_PE", type: "website" },
  ...metadatosApp("empleo"),
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
      // Con los cobros en pausa, las alertas vienen gratis con la cuenta: la acción lleva a crearla.
      accion={{ ruta: COBROS_EN_PAUSA ? "/entrar?crear=1" : "/planes", etiqueta: "Recibir alertas" }}
      fuentes={[{ nombre: "SERVIR, ofertas laborales del Estado", url: "https://app.servir.gob.pe/DifusionOfertasExterno/faces/consultas/ofertas_laborales.xhtml" }]}
    >
      {children}
    </MarcoProducto>
  );
}
