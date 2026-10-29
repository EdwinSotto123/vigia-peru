import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconoDato } from "./IconoDato";
import { CLASE_ICONO_DATO, ICONO_DATO, type TipoDato } from "./iconosDato";

export { ICONO_DATO, type TipoDato } from "./iconosDato";

/**
 * Un dato de la línea de contexto de una fila o tarjeta, con su ícono delante: qué es cada cosa se ve sin leerla
 * (la entidad, el lugar, el RUC, el servicio, el cargo…). Antes los datos iban separados sólo por aire y no se
 * distinguía la entidad del servicio ni el cargo de la dependencia.
 *
 * Va dentro de `Partes` o del `meta` de `CeldaPrincipal` (`meta={[<Dato tipo="entidad">…</Dato>, …]}`). Es texto en
 * línea, no una caja: dentro de una línea que se recorta (`truncate`) se recorta al final como cualquier texto. El
 * ícono lleva el nombre del dato para el lector de pantalla ("Entidad: Universidad…"); sin `sr-only`, que dentro de
 * una línea recortada escapaba del recorte (ver `Separador`). Server-safe (el ícono de su tipo lo dibuja `IconoDato`).
 */
export function Dato({
  tipo,
  icono,
  nombre,
  mono = false,
  children,
  className,
}: {
  /** Qué dato es: elige el ícono y el nombre que oye el lector de pantalla. */
  tipo?: TipoDato;
  /** Otro ícono, para un dato que no está en `ICONO_DATO`. */
  icono?: LucideIcon;
  /** El nombre del dato para el lector de pantalla, si no es el de `tipo`. */
  nombre?: string;
  /** Códigos, RUC, números: en mono tabular. */
  mono?: boolean;
  children: ReactNode;
  className?: string;
}) {
  // El de su tipo se dibuja en el navegador (IconoDato: viaja como texto); uno pasado aparte, aquí.
  const Icono = icono;
  const etiqueta = nombre ?? (tipo ? ICONO_DATO[tipo].nombre : undefined);
  return (
    <span className={className}>
      {Icono ? (
        <Icono size={12} strokeWidth={2} className={CLASE_ICONO_DATO} {...(etiqueta ? { role: "img", "aria-label": `${etiqueta}:` } : { "aria-hidden": true })} />
      ) : (
        tipo && <IconoDato tipo={tipo} nombre={nombre} />
      )}
      <span className={cn(mono && "font-mono text-[0.95em] tabular-nums")}>{children}</span>
    </span>
  );
}
