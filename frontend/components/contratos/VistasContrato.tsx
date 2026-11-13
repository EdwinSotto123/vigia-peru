import type { ReactNode } from "react";
import { Cargando, PestanaAPedido, Pestanas } from "@/components/patrones";
import type { VistaContrato } from "@/lib/rutas";

export interface VistaDisponible {
  clave: VistaContrato;
  etiqueta: string;
}

/**
 * Las vistas de la página de un contrato, en pestañas bajo su cabecera única (`?vista=`): la ficha, el dictamen de su
 * lectura y cómo se leyó (la lectura en vivo, si la hay; si no, el registro de los agentes). Sólo las que existen; con
 * una sola, no se dibuja la barra.
 *
 * Antes era un selector de enlaces ARRIBA de todo, encima de la ruta y del título, y cada vista traía su propia cabecera:
 * al cambiar de vista cambiaba la página entera (auditoría visual del 2026-11-13). Ahora la cabecera queda y sólo cambia
 * lo de abajo. Cada vista arma lo suyo en el servidor (el dictamen pesa cientos de KB): la abierta llega con la página y
 * las otras se piden al abrirlas (`PestanaAPedido`), sin mover la vista. Va como píldoras (`variante="segunda"`) para no
 * confundirse con las pestañas de cada vista, que van debajo.
 */
export function VistasContrato({
  activa,
  vistas,
  children,
}: {
  activa: VistaContrato;
  vistas: VistaDisponible[];
  /** El contenido de la vista abierta. */
  children: ReactNode;
}) {
  if (vistas.length < 2) return <>{children}</>;
  return (
    <Pestanas
      key={activa}
      variante="segunda"
      param="vista"
      activa={activa}
      etiqueta="Vistas del contrato"
      pestanas={vistas.map((v) => ({
        clave: v.clave,
        etiqueta: v.etiqueta,
        contenido:
          v.clave === activa ? (
            children
          ) : (
            <PestanaAPedido clave={v.clave} param="vista">
              <Cargando texto={`Abriendo «${v.etiqueta}»…`} lineas={4} />
            </PestanaAPedido>
          ),
      }))}
    />
  );
}
