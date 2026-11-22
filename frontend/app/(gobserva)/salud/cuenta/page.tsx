import type { Metadata } from "next";
import { MisGuardados } from "@/components/salud/cuenta/MisGuardados";
import { Encabezado, Ruta } from "@/components/salud/portada/Piezas";
import { rutaEn } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";

export const metadata: Metadata = { title: "Mis guardados", robots: { index: false, follow: false } };

/**
 * «Mis guardados» de Gobserva Salud (2026-11-21, el usuario: «que capaz se cree alguna cuenta sencilla»): lo que la
 * persona guardó con su cuenta gratis y lo nuevo desde que lo guardó. Se arma en el navegador (la sesión vive ahí).
 */
export default function Cuenta() {
  const base = baseProducto("salud");
  return (
    <div className="container-page pb-10 pt-5 sm:pb-14 sm:pt-6">
      <Ruta items={[{ etiqueta: "Inicio", href: rutaEn(base, "/") }, { etiqueta: "Mis guardados" }]} />
      <Encabezado
        figura="vecina"
        className="mt-2"
        titulo="Mis guardados"
        bajada="Las clínicas, los médicos y los medicamentos que guardaste. Si a alguno le aparece una sanción, un cambio en RENIPRESS o una alerta de DIGEMID, te lo marcamos aquí."
      />
      <MisGuardados base={base} />
    </div>
  );
}
