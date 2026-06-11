/**
 * Metadata para las categorías de denuncias ciudadanas.
 */

import type { LucideIcon } from "lucide-react";
import {
  Construction,
  Ghost,
  UserMinus,
  AlertOctagon,
  Banknote,
  Package,
} from "lucide-react";

export type CategoriaDenuncia =
  | "obra_paralizada"
  | "obra_fantasma"
  | "funcionario_sospechoso"
  | "irregularidad_general"
  | "sobreprecio"
  | "calidad_deficiente";

export const CATEGORIA_META: Record<
  CategoriaDenuncia,
  {
    label: string;
    icon: LucideIcon;
    tone: string;        // tailwind bg + text classes
    color: string;       // hex para mapas/charts
    descripcion: string;
  }
> = {
  obra_paralizada: {
    label: "Obra paralizada",
    icon: Construction,
    tone: "bg-amber-soft text-amber border-amber/40",
    color: "#B5752C",
    descripcion: "La obra no avanza desde hace meses, sin trabajadores ni maquinaria.",
  },
  obra_fantasma: {
    label: "Obra fantasma",
    icon: Ghost,
    tone: "bg-crimson-soft text-rust border-rust/40",
    color: "#8B2A1E",
    descripcion: "Se declaró concluida o inaugurada, pero físicamente no existe o está incompleta.",
  },
  funcionario_sospechoso: {
    label: "Funcionario sospechoso",
    icon: UserMinus,
    tone: "bg-paperDeep text-clay border-line",
    color: "#A0512D",
    descripcion: "Patrimonio o conducta que no encaja con sus ingresos declarados.",
  },
  irregularidad_general: {
    label: "Irregularidad",
    icon: AlertOctagon,
    tone: "bg-paperSoft text-ink border-line",
    color: "#5C4F40",
    descripcion: "Cualquier otra anomalía detectada por el ciudadano.",
  },
  sobreprecio: {
    label: "Sobreprecio",
    icon: Banknote,
    tone: "bg-crimson-soft text-rust border-rust/40",
    color: "#7A2E18",
    descripcion: "Precio de bien o servicio muy por encima del mercado.",
  },
  calidad_deficiente: {
    label: "Calidad deficiente",
    icon: Package,
    tone: "bg-amber-soft text-amber border-amber/40",
    color: "#A05A1F",
    descripcion: "Material o ejecución defectuosa de la obra entregada.",
  },
};

export const TODAS_CATEGORIAS: CategoriaDenuncia[] = Object.keys(
  CATEGORIA_META,
) as CategoriaDenuncia[];
