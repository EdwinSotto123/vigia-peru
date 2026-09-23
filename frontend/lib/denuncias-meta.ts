/**
 * Metadata para las categorías de denuncias ciudadanas.
 *
 * Son dos familias, las mismas que ofrece el formulario de /reporte/nuevo:
 *  - denuncias de OBRA (FormObra): lo que un vecino ve en la calle.
 *  - denuncias de ENTIDAD (FormEntidad): un patrón dentro de una institución.
 * Antes sólo existían las de obra, así que una denuncia de entidad
 * (`malversacion`, `patron_corrupcion`…) caía sin etiqueta ni ícono y se
 * mostraba con su slug crudo.
 *
 * Tonos: sobre fondos claros, siempre los tokens de TEXTO (`amberTexto`,
 * `clayTexto`): `text-amber` da 3,2:1 sobre `amber-soft` y no pasa AA.
 */

import type { LucideIcon } from "lucide-react";
import {
  Construction,
  Ghost,
  UserMinus,
  AlertOctagon,
  Banknote,
  Package,
  Wallet,
  Scale,
  Gift,
  DoorClosed,
  Repeat,
  Building2,
} from "lucide-react";

export type CategoriaDenuncia =
  | "obra_paralizada"
  | "obra_fantasma"
  | "funcionario_sospechoso"
  | "irregularidad_general"
  | "sobreprecio"
  | "calidad_deficiente"
  | "malversacion"
  | "conflicto_interes"
  | "favoritismo"
  | "obstruccion"
  | "patron_corrupcion"
  | "otra_entidad";

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
    tone: "bg-amber-soft text-amberTexto border-amber/40",
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
    tone: "bg-paperDeep text-clayTexto border-line",
    color: "#A0512D",
    descripcion: "Patrimonio o conducta que no encaja con sus ingresos declarados.",
  },
  irregularidad_general: {
    label: "Irregularidad",
    icon: AlertOctagon,
    tone: "bg-paperSoft text-ink border-line",
    color: "#5C4F40",
    descripcion: "Cualquier otra anomalía que el vecino vio en una obra.",
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
    tone: "bg-amber-soft text-amberTexto border-amber/40",
    color: "#A05A1F",
    descripcion: "Material o ejecución defectuosa de la obra entregada.",
  },
  // ── Denuncias sobre una entidad (FormEntidad) ──
  malversacion: {
    label: "Malversación de fondos",
    icon: Wallet,
    tone: "bg-crimson-soft text-rust border-rust/40",
    color: "#8B2A1E",
    descripcion: "Dinero público usado para un fin distinto del que tenía asignado.",
  },
  conflicto_interes: {
    label: "Conflicto de interés",
    icon: Scale,
    tone: "bg-paperDeep text-clayTexto border-line",
    color: "#A0512D",
    descripcion: "Quien decide una contratación tiene un vínculo con quien se beneficia de ella.",
  },
  favoritismo: {
    label: "Favoritismo a un proveedor",
    icon: Gift,
    tone: "bg-amber-soft text-amberTexto border-amber/40",
    color: "#A05A1F",
    descripcion: "La entidad contrata una y otra vez al mismo proveedor sin una razón visible.",
  },
  obstruccion: {
    label: "Obstrucción a la transparencia",
    icon: DoorClosed,
    tone: "bg-paperSoft text-ink border-line",
    color: "#5C4F40",
    descripcion: "La entidad niega información pública o entorpece el control.",
  },
  patron_corrupcion: {
    label: "Patrón de corrupción",
    icon: Repeat,
    tone: "bg-crimson-soft text-rust border-rust/40",
    color: "#7A2E18",
    descripcion: "Una práctica que se repite en la institución y que el vecino puede documentar.",
  },
  otra_entidad: {
    label: "Otra irregularidad institucional",
    icon: Building2,
    tone: "bg-paperSoft text-ink border-line",
    color: "#5C4F40",
    descripcion: "Cualquier otra anomalía en el funcionamiento de una entidad del Estado.",
  },
};

export const TODAS_CATEGORIAS: CategoriaDenuncia[] = Object.keys(
  CATEGORIA_META,
) as CategoriaDenuncia[];

/**
 * Una denuncia está CONFIRMADA cuando la respaldan dos o más reportes
 * independientes. Se deriva de `confirmaciones`, no de la columna `confirmado`:
 * las filas de demo sembradas traían `confirmado = true` con una sola
 * confirmación, y esa bandera sola no prueba nada.
 */
export const estaConfirmada = (r: { confirmaciones?: number | null }) => Number(r.confirmaciones ?? 0) >= 2;

/**
 * ¿La denuncia trae un punto real en el mapa? Una denuncia sin GPS llega con
 * `lat`/`lon` nulos, y `Number(null)` es 0: sin este filtro se dibujaba un pin
 * en 0°, 0° (el golfo de Guinea) y se mostraban coordenadas "0.0000, 0.0000".
 */
export const tieneUbicacion = (r: { lat?: number | null; lon?: number | null }) => {
  const lat = r.lat == null ? NaN : Number(r.lat);
  const lon = r.lon == null ? NaN : Number(r.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0);
};
