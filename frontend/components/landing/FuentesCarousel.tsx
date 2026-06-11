"use client";

import {
  Database,
  Wifi,
  Globe,
  FileText,
  Scale,
  Newspaper,
  type LucideIcon,
} from "lucide-react";
import { Carousel } from "@/components/Carousel";

type Fuente = {
  nombre: string;
  detalle: string;
  metodo: string;
  uso: string;
  categoria: "contratos" | "personas" | "politica" | "judicial" | "prensa" | "ambiental";
};

const FUENTES_DETALLE: Fuente[] = [
  {
    nombre: "OECE · Contrataciones Abiertas",
    detalle: "OCDS 1.1 · convocatorias, postores, contratos",
    metodo: "API REST · descargas masivas",
    uso: "Espina dorsal del análisis: todo arranca con el OCID",
    categoria: "contratos",
  },
  {
    nombre: "SEACE V3",
    detalle: "Bases, actas, fundamentos legales · PDFs",
    metodo: "Scraping + parser multimodal Gemini",
    uso: "Lectura de comité, firmantes, causales de directa",
    categoria: "contratos",
  },
  {
    nombre: "SUNAT vía apis.net.pe",
    detalle: "Consulta RUC enriquecida · ubigeo, CIIU, tipo",
    metodo: "API REST tokenizada",
    uso: "Edad del RUC ganador, congruencia rubro vs objeto",
    categoria: "personas",
  },
  {
    nombre: "RNP · Registro Nacional de Proveedores",
    detalle: "1.44M filas · socios, representantes, órgano admin",
    metodo: "Snapshot cargado a Postgres + pg_trgm",
    uso: "Cinco capas de red empresarial por caso",
    categoria: "personas",
  },
  {
    nombre: "OSCE · Inhabilitados",
    detalle: "17,303 registros · sanciones vigentes y multas",
    metodo: "Tabla local con cruce por RUC/DNI",
    uso: "Bandera dura: ganador con sanción vigente",
    categoria: "personas",
  },
  {
    nombre: "ONPE Claridad",
    detalle: "7,189 aportes a campañas políticas 2015-2022",
    metodo: "Dataset normalizado · pg_trgm fuzzy DNI/RUC",
    uso: "Cruce C3: aportante de partido = ganador",
    categoria: "politica",
  },
  {
    nombre: "JNE · Plataforma Electoral",
    detalle: "319,066 candidaturas y hojas de vida",
    metodo: "Indexación + extracción de electos 2022",
    uso: "Identificar alcaldes, regidores, gobernadores activos",
    categoria: "politica",
  },
  {
    nombre: "Registro Único de Visitas",
    detalle: "24,535 visitas a entidades públicas",
    metodo: "Carga normalizada · cruce por DNI",
    uso: "Detectar lobby pre-convocatoria (Ley 28024)",
    categoria: "politica",
  },
  {
    nombre: "MEF · Datos Abiertos",
    detalle: "8M+ filas presupuestales · PIA, PIM, devengado",
    metodo: "API CKAN + descargas CSV",
    uso: "Validar avance financiero vs físico de obras",
    categoria: "contratos",
  },
  {
    nombre: "INFOBRAS · Contraloría",
    detalle: "Estado físico de obras públicas",
    metodo: "Scraping del mapa ciudadano",
    uso: "Detectar obras fantasma vs devengado MEF",
    categoria: "judicial",
  },
  {
    nombre: "Poder Judicial · CEJ",
    detalle: "Expedientes y resoluciones judiciales",
    metodo: "Scraping autenticado",
    uso: "Inhabilitación judicial vigente del ganador",
    categoria: "judicial",
  },
  {
    nombre: "El Peruano · Normas Legales",
    detalle: "Designaciones de funcionarios y altos cargos",
    metodo: "Scraping + parser PDF",
    uso: "Capa 3: gerente municipal, procurador, jefe OCI",
    categoria: "prensa",
  },
  {
    nombre: "Prensa peruana indexada",
    detalle: "OjoPúblico · IDL · Convoca · La República · Comercio",
    metodo: "Google Search dirigido · agente periodista",
    uso: "Antecedentes mediáticos del proveedor y la entidad",
    categoria: "prensa",
  },
  {
    nombre: "OEFA · Registro Ambiental",
    detalle: "Infractores ambientales sancionados",
    metodo: "Scraping del registro público",
    uso: "Cruce reputacional para obras de impacto",
    categoria: "ambiental",
  },
];

// Páginas de 4 fuentes
const PAGE_SIZE = 4;
const TOTAL_PAGES = Math.ceil(FUENTES_DETALLE.length / PAGE_SIZE);

const CAT_META: Record<
  Fuente["categoria"],
  { label: string; color: string; icon: LucideIcon }
> = {
  contratos: { label: "Contratos", color: "rust", icon: FileText },
  personas: { label: "Personas y empresas", color: "clay", icon: Database },
  politica: { label: "Política", color: "amber", icon: Globe },
  judicial: { label: "Judicial", color: "ink", icon: Scale },
  prensa: { label: "Prensa", color: "moss", icon: Newspaper },
  ambiental: { label: "Ambiental", color: "moss", icon: Wifi },
};

export function FuentesCarousel() {
  return (
    <Carousel
      total={TOTAL_PAGES}
      ariaLabel="Fuentes oficiales integradas"
      activeDotClass="bg-clay"
      renderSlide={(pageIdx) => {
        const items = FUENTES_DETALLE.slice(
          pageIdx * PAGE_SIZE,
          (pageIdx + 1) * PAGE_SIZE,
        );
        return (
          <div className="grid gap-3 sm:grid-cols-2">
            {items.map((f) => (
              <FuenteDetalleCard key={f.nombre} fuente={f} />
            ))}
          </div>
        );
      }}
    />
  );
}

function FuenteDetalleCard({ fuente }: { fuente: Fuente }) {
  const cat = CAT_META[fuente.categoria];
  const Icon = cat.icon;
  const colorMap: Record<string, string> = {
    rust: "bg-rust/10 text-rust",
    clay: "bg-clay/10 text-clay",
    amber: "bg-amber/20 text-clay",
    ink: "bg-ink/10 text-ink",
    moss: "bg-moss/15 text-moss",
  };
  return (
    <div className="surface flex flex-col gap-2 p-5">
      <div className="flex items-start justify-between gap-2">
        <span
          className={
            "inline-flex h-8 w-8 items-center justify-center rounded-lg " +
            colorMap[cat.color]
          }
        >
          <Icon size={15} />
        </span>
        <span className="rounded-full bg-paperDeep px-2 py-0.5 text-[9px] font-medium uppercase tracking-widest text-mute">
          {cat.label}
        </span>
      </div>
      <h3 className="font-serif text-base font-bold leading-tight text-ink">
        {fuente.nombre}
      </h3>
      <p className="text-[12px] leading-snug text-mute">{fuente.detalle}</p>
      <div className="mt-2 border-t border-line pt-2.5 space-y-1.5">
        <div className="flex items-baseline gap-2 text-[11px]">
          <span className="font-mono text-[9px] uppercase tracking-widest text-clay">Método</span>
          <span className="text-ink/85">{fuente.metodo}</span>
        </div>
        <div className="flex items-baseline gap-2 text-[11px]">
          <span className="font-mono text-[9px] uppercase tracking-widest text-clay">Uso</span>
          <span className="text-ink/85">{fuente.uso}</span>
        </div>
      </div>
    </div>
  );
}
