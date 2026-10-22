import type { ReactNode } from "react";
import {
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  FileText,
  Hash,
  IdCard,
  Landmark,
  Layers,
  MapPin,
  Network,
  Tag,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Un dato de la línea de contexto de una fila o tarjeta, con su ícono delante: qué es cada cosa se ve sin leerla
 * (la entidad, el lugar, el RUC, el servicio, el cargo…). Antes los datos iban separados sólo por aire y no se
 * distinguía la entidad del servicio ni el cargo de la dependencia.
 *
 * Va dentro de `Partes` o del `meta` de `CeldaPrincipal` (`meta={[<Dato tipo="entidad">…</Dato>, …]}`). Es texto en
 * línea, no una caja: dentro de una línea que se recorta (`truncate`) se recorta al final como cualquier texto. El
 * ícono lleva el nombre del dato para el lector de pantalla ("Entidad: Universidad…"); sin `sr-only`, que dentro de
 * una línea recortada escapaba del recorte (ver `Separador`). Server-safe.
 */

export const ICONO_DATO = {
  entidad: { icono: Building2, nombre: "Entidad" },
  lugar: { icono: MapPin, nombre: "Lugar" },
  ruc: { icono: Hash, nombre: "RUC" },
  codigo: { icono: Hash, nombre: "Código" },
  servicio: { icono: Tag, nombre: "Tipo de servicio" },
  tipo: { icono: Layers, nombre: "Tipo" },
  cargo: { icono: BriefcaseBusiness, nombre: "Cargo" },
  dependencia: { icono: Network, nombre: "Dependencia" },
  regimen: { icono: IdCard, nombre: "Régimen" },
  fecha: { icono: CalendarDays, nombre: "Fecha" },
  personas: { icono: Users, nombre: "Personas" },
  partido: { icono: Landmark, nombre: "Partido" },
  documento: { icono: FileText, nombre: "Documento" },
} satisfies Record<string, { icono: LucideIcon; nombre: string }>;

export type TipoDato = keyof typeof ICONO_DATO;

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
  const base = tipo ? ICONO_DATO[tipo] : undefined;
  const Icono = icono ?? base?.icono;
  const etiqueta = nombre ?? base?.nombre;
  return (
    <span className={className}>
      {Icono && (
        <Icono
          size={12}
          strokeWidth={2}
          className="mr-1 inline-block shrink-0 align-[-1px] text-mute/80"
          {...(etiqueta ? { role: "img", "aria-label": `${etiqueta}:` } : { "aria-hidden": true })}
        />
      )}
      <span className={cn(mono && "font-mono text-[0.95em] tabular-nums")}>{children}</span>
    </span>
  );
}
