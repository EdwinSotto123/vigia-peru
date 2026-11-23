import type { Metadata } from "next";
import type { ReactNode } from "react";
import { MarcoProducto } from "@/components/gobserva/MarcoProducto";
import { URL_CMP, URL_DATOS_SUSALUD, URL_RENIPRESS_CONSULTA, URL_SANCIONES, URL_SUNEDU } from "@/components/salud/fuentes/urls";
import { PRODUCTOS } from "@/lib/gobserva";
import { metadatosApp } from "@/lib/gobserva-pwa";
import { baseProducto } from "@/lib/gobserva-servidor";

export const metadata: Metadata = {
  metadataBase: new URL(`https://${PRODUCTOS.salud.host}`),
  title: { default: "Gobserva Salud: verifica tu clínica y a tu médico con fuentes oficiales", template: "%s | Gobserva Salud" },
  description: PRODUCTOS.salud.lema,
  openGraph: { siteName: "Gobserva Salud", locale: "es_PE", type: "website" },
  ...metadatosApp("salud"),
};

/**
 * Las fuentes oficiales del pie: las mismas de FUENTES_SALUD (backend/api/src/lib/gobservaSalud.ts), con la dirección donde
 * una persona las consulta.
 */
const FUENTES = [
  { nombre: "RENIPRESS, registro de establecimientos de SUSALUD", url: URL_RENIPRESS_CONSULTA },
  { nombre: "Registro de Sanciones de SUSALUD", url: URL_SANCIONES },
  { nombre: "Datos abiertos de SUSALUD (denuncias, recursos, cirugías)", url: URL_DATOS_SUSALUD },
  { nombre: "Conoce a tu médico, del Colegio Médico del Perú", url: URL_CMP },
  { nombre: "Grados y títulos de SUNEDU", url: URL_SUNEDU },
];

/** Gobserva Salud (salud.gobserva.cloud): abierto y sin cuenta (MarcoProducto no muestra «Entrar»). */
export default function LayoutSalud({ children }: { children: ReactNode }) {
  const base = baseProducto("salud");
  return (
    <MarcoProducto
      producto="salud"
      base={base}
      menu={[
        { ruta: "/cerca", etiqueta: "Cerca de mí" },
        { ruta: "/medico", etiqueta: "Verificar médico" },
        { ruta: "/establecimientos", etiqueta: "Establecimientos" },
        { ruta: "/mapa", etiqueta: "Mapa" },
        { ruta: "/sanciones", etiqueta: "Sanciones" },
        { ruta: "/asistente", etiqueta: "Asistente" },
        { ruta: "/fuentes", etiqueta: "Fuentes" },
      ]}
      accion={{ ruta: "/inicio", etiqueta: "Abrir la app" }}
      fuentes={FUENTES}
    >
      {children}
    </MarcoProducto>
  );
}
