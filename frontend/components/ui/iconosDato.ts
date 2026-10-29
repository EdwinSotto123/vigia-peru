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

/**
 * Los íconos de `Dato` por tipo. Módulo aparte (sin "use client") porque lo leen los dos lados: el servidor, para el nombre
 * que oye el lector de pantalla, y `IconoDato` en el navegador, para dibujarlo.
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

/** La clase del ícono de un dato: el de su tipo (`IconoDato`) y el que se le pasa aparte (`icono`). */
export const CLASE_ICONO_DATO = "mr-1 inline-block shrink-0 align-[-1px] text-mute/80";
