import type { Metadata } from "next";
import { MisGuardados } from "@/components/salud/cuenta/MisGuardados";
import { VistosRecientes } from "@/components/salud/vistos/Vistos";
import { Encabezado, Ruta } from "@/components/salud/portada/Piezas";
import { rutaEn } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";

export const metadata: Metadata = { title: "Guardados y vistos", robots: { index: false, follow: false } };

/**
 * «Mis guardados» de Gobserva Salud (2026-11-21, el usuario: «que capaz se cree alguna cuenta sencilla»): lo que la
 * persona guardó con su cuenta gratis y lo nuevo desde que lo guardó. Se arma en el navegador (la sesión vive ahí).
 */
export default function Cuenta() {
  const base = baseProducto("salud");
  return (
    <div className="container-page pb-10 pt-5 sm:pb-14 sm:pt-6">
      <Ruta items={[{ etiqueta: "Inicio", href: rutaEn(base, "/") }, { etiqueta: "Guardados y vistos" }]} />
      <Encabezado
        className="mt-2"
        titulo="Guardados y vistos"
        bajada="Lo que abriste hace poco (sin cuenta, sólo en este dispositivo) y lo que guardaste con tu cuenta, con lo nuevo marcado: una sanción, un cambio en RENIPRESS o una alerta de DIGEMID."
      />
      <VistosRecientes base={base} className="mt-6" />
      <h2 className="mt-10 font-display text-bloque font-bold text-ink">Lo que guardaste</h2>
      <MisGuardados base={base} />
    </div>
  );
}
