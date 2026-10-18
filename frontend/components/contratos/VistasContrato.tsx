import { Vistas } from "@/components/listado";
import { rutaContrato, type VistaContrato } from "@/lib/rutas";

/**
 * Las vistas de la página de un contrato: la ficha, el dictamen de su lectura y la lectura en vivo. Sólo aparecen las
 * que existen (sin lectura no hay dictamen; sin financiamiento no hay "en vivo"); con una sola, no se dibuja nada.
 */
export function VistasContrato({
  ocid,
  actual,
  dictamen,
  vivo,
}: {
  ocid: string;
  actual: VistaContrato;
  dictamen: boolean;
  vivo: boolean;
}) {
  const vistas = [
    { href: rutaContrato(ocid), etiqueta: "Ficha del contrato", activa: actual === "ficha" },
    ...(dictamen || actual === "dictamen" ? [{ href: rutaContrato(ocid, "dictamen"), etiqueta: "Dictamen", activa: actual === "dictamen" }] : []),
    ...(vivo || actual === "vivo" ? [{ href: rutaContrato(ocid, "vivo"), etiqueta: "Lectura en vivo", activa: actual === "vivo" }] : []),
  ];
  if (vistas.length < 2) return null;
  return <Vistas vistas={vistas} etiqueta="Vistas del contrato" />;
}
