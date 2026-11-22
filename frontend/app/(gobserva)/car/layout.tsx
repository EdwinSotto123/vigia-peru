import type { Metadata } from "next";
import type { ReactNode } from "react";
import { MarcoProducto } from "@/components/gobserva/MarcoProducto";
import { CONSULTAS } from "@/components/car/consultas";
import licencia from "@/data/car/licencia.json";
import gas from "@/data/car/gas.json";
import { PRODUCTOS } from "@/lib/gobserva";
import { metadatosApp } from "@/lib/gobserva-pwa";
import { baseProducto } from "@/lib/gobserva-servidor";

export const metadata: Metadata = {
  metadataBase: new URL(`https://${PRODUCTOS.car.host}`),
  title: { default: "Gobserva Car: verifica un auto antes de comprarlo o de subirte", template: "%s | Gobserva Car" },
  description: PRODUCTOS.car.lema,
  openGraph: { siteName: "Gobserva Car", locale: "es_PE", type: "website" },
  ...metadatosApp("car"),
};

/** Las fuentes del pie: los centros de revisión técnica del MTC y las consultas oficiales por placa. */
const FUENTES = [
  { nombre: "Centros de Inspección Técnica Vehicular autorizados (MTC)", url: "https://rec.mtc.gob.pe/AutorizaEntiComplementarias/ArCITVConfiguracion" },
  { nombre: licencia.fuentes.medicos.nombre, url: licencia.fuentes.medicos.url },
  { nombre: gas.fuentes.talleres.nombre, url: gas.fuentes.talleres.url },
  ...CONSULTAS.filter((c) => ["sunarp", "soat", "revision", "sat-lima", "sutran"].includes(c.clave)).map((c) => ({ nombre: c.fuente, url: c.url })),
];

/**
 * Gobserva Car (car.gobserva.cloud, 2026-11-22): abierto y sin cuenta. Verificar una placa (las consultas oficiales, con
 * la placa lista), los centros de revisión técnica, la licencia de conducir y el auto a gas, con los locales que autoriza
 * el MTC; más adelante, combustible y seguridad vial.
 */
export default function LayoutCar({ children }: { children: ReactNode }) {
  const base = baseProducto("car");
  return (
    <MarcoProducto
      producto="car"
      base={base}
      menu={[
        { ruta: "/placa", etiqueta: "Verificar una placa" },
        { ruta: "/revision-tecnica", etiqueta: "Revisión técnica" },
        { ruta: "/licencia", etiqueta: "Licencia" },
        { ruta: "/gas", etiqueta: "Auto a gas" },
        { ruta: "/fuentes", etiqueta: "Fuentes" },
      ]}
      accion={{ ruta: "/placa", etiqueta: "Verificar" }}
      fuentes={FUENTES}
    >
      {children}
    </MarcoProducto>
  );
}
