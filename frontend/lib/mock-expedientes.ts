/**
 * Mock del EXPEDIENTE de una convocatoria — items, postores, market validation,
 * buena pro y documentos.
 *
 * Caso real demoable: PSNC Nº 01/2026-GRP-PECHP-406000 (Chira Piura · maquinaria
 * pesada por emergencia). Data sacada de los PDFs en /documentos.
 */

export type MarketVerdict = "alineado" | "elevado" | "muy_elevado";

export interface MarketReference {
  promedio: number;
  rangoMin: number;
  rangoMax: number;
  fuente: string;
  veredicto: MarketVerdict;
  diferenciaPct: number; // % vs oferta (negativo = barato, positivo = caro)
  nota: string;
}

export interface ExpedienteItem {
  numero: number;
  descripcion: string;
  descripcionCorta: string;
  cantidad: number;
  unidad: string;
  cuantiaReferencial: number;     // total del item
  precioUnitarioReferencial: number;
  especsRedFlag?: string;          // texto breve si la especificación es restrictiva
  marketRef?: MarketReference;     // del market_price_agent
}

export interface PostorOferta {
  itemNumero: number;
  montoOfertado: number;
  porcentajeReferencial: number;   // 100.00 = al techo
  admitida: boolean;
  calificada: boolean;
  ganador: boolean;
}

export interface ExpedientePostor {
  ruc: string;
  razonSocial: string;
  tipo: "persona_juridica" | "consorcio" | "persona_natural";
  rnpVigente: boolean;
  ofertas: PostorOferta[];
  banderas: string[];               // breves
}

export interface ExpedienteDocumento {
  tipo:
    | "bases"
    | "expediente_tecnico"
    | "acta_buena_pro"
    | "reporte_buena_pro"
    | "informe_dec"
    | "contrato"
    | "propuesta_postor";
  nombre: string;
  fecha: string;
  paginas?: number;
  tamano?: string;
  url: string;
  agente?: string;                  // qué agente lo analizó
  resumenAgente?: string;
}

export interface CasoExpediente {
  /** Vincular a una alerta. Si null, sirve para cualquier alerta del demo. */
  alertaIdHint: string | null;
  codigoProceso: string;
  objeto: string;
  entidad: { ruc: string; nombre: string; ubicacion: string };
  tipoProceso: string;
  fundamentoLegal: string[];
  modalidadPago: string;
  fechaConvocatoria: string;
  fechaPresentacion: string;
  fechaBuenaPro: string;
  cuantiaTotal: number;
  fuenteFinanciamiento: string;
  items: ExpedienteItem[];
  postores: ExpedientePostor[];
  ganadores: {
    itemNumero: number;
    postorRuc: string;
    postorNombre: string;
    monto: number;
    fundamento: string;
  }[];
  documentos: ExpedienteDocumento[];
  marketAnalysis: {
    totalOfertado: number;
    totalEstimadoMercado: number;
    sobreprecio: number;
    sobreprecioPct: number;
    veredicto: MarketVerdict;
    notas: string[];
  };
}

// ─── CASO REAL · CHIRA PIURA ──────────────────────────────────────

export const CHIRA_PIURA_EXPEDIENTE: CasoExpediente = {
  alertaIdHint: null,
  codigoProceso: "01/2026-GRP-PECHP-406000",
  objeto:
    "ADQUISICIÓN DE MAQUINARIA PESADA — Expediente técnico 'Mejoramiento de los servicios operativos o misionales institucionales en la Dirección de Operación y Mantenimiento del PECHP, Distrito de Piura, Provincia de Piura' · CUI 2644512 · II Etapa Componente Equipamiento.",
  entidad: {
    ruc: "20154477536",
    nombre: "Proyecto Especial Chira Piura",
    ubicacion: "Panamericana Norte Km 3.5, Piura - Sullana",
  },
  tipoProceso: "Procedimiento de Selección No Competitivo · Contratación Directa por Emergencia",
  fundamentoLegal: [
    "Ley 32069 — Art. 55.1 lit. b (situación de emergencia)",
    "Reglamento (D.S. 009-2025-EF) — Art. 100 lit. b",
    "D.S. 005-2026-PCM — Estado de Emergencia por lluvias",
    "D.S. 039-2026-PCM — Prórroga del estado de emergencia",
  ],
  modalidadPago: "Suma Alzada · Pago Único",
  fechaConvocatoria: "2026-04-14",
  fechaPresentacion: "2026-04-15",
  fechaBuenaPro: "2026-04-15",
  cuantiaTotal: 7_110_018.88,
  fuenteFinanciamiento: "Recursos Ordinarios",
  items: [
    {
      numero: 1,
      descripcion:
        "Excavadora Hidráulica Sobre Orugas, con Alcance Horizontal a Nivel de Suelo de 9 metros",
      descripcionCorta: "Excavadora hidráulica 9m alcance",
      cantidad: 2,
      unidad: "UND",
      cuantiaReferencial: 2_042_744.26,
      precioUnitarioReferencial: 1_021_372.13,
      especsRedFlag:
        "Homologación MTC del fabricante + emisiones Tier 3 + alcance 9m + potencia ≥ 210 HP → universo restringido a Caterpillar, Komatsu y similares de gama alta",
      marketRef: {
        promedio: 985_000,
        rangoMin: 920_000,
        rangoMax: 1_080_000,
        fuente: "Mediana Q1 2026 (CAT 320GC, Komatsu PC200 nuevas en Perú)",
        veredicto: "alineado",
        diferenciaPct: 3.7,
        nota: "Precio compatible con gama premium (Caterpillar/Komatsu). Marcas chinas (XCMG, SANY) hubieran ofertado ~25% menos pero no califican por especs MTC.",
      },
    },
    {
      numero: 2,
      descripcion: "Cargador Frontal Sobre Ruedas",
      descripcionCorta: "Cargador frontal",
      cantidad: 2,
      unidad: "UND",
      cuantiaReferencial: 1_686_074.62,
      precioUnitarioReferencial: 843_037.31,
      especsRedFlag: "Mismas restricciones que el ítem 1 (homologación MTC + Tier 3)",
      marketRef: {
        promedio: 820_000,
        rangoMin: 760_000,
        rangoMax: 880_000,
        fuente: "Mediana Q1 2026 (CAT 950GC, Komatsu WA320)",
        veredicto: "alineado",
        diferenciaPct: 2.8,
        nota: "Alineado con gama premium. Volvo y Hyundai HL están dentro del rango.",
      },
    },
    {
      numero: 3,
      descripcion: "Camión Rígido Volquete 6x4 de 15 m³",
      descripcionCorta: "Volquete 6×4 · 15 m³",
      cantidad: 4,
      unidad: "UND",
      cuantiaReferencial: 3_381_200.0,
      precioUnitarioReferencial: 845_300.0,
      especsRedFlag: undefined,
      marketRef: {
        promedio: 695_000,
        rangoMin: 600_000,
        rangoMax: 790_000,
        fuente: "Mediana Q1 2026 (FAW J6P, Hino 700, Mercedes Axor en Perú)",
        veredicto: "elevado",
        diferenciaPct: 21.6,
        nota: "+S/. 150K por unidad sobre la mediana de mercado. Los volquetes son commodity con múltiples marcas competidoras — no hay justificación técnica para el premium. Sobreprecio agregado: S/. 600K en las 4 unidades.",
      },
    },
  ],
  postores: [
    {
      ruc: "20100028698",
      razonSocial: "FERREYROS SOCIEDAD ANÓNIMA",
      tipo: "persona_juridica",
      rnpVigente: true,
      ofertas: [
        {
          itemNumero: 1,
          montoOfertado: 2_042_744.26,
          porcentajeReferencial: 100.0,
          admitida: true,
          calificada: true,
          ganador: true,
        },
        {
          itemNumero: 2,
          montoOfertado: 1_686_074.62,
          porcentajeReferencial: 100.0,
          admitida: true,
          calificada: true,
          ganador: true,
        },
      ],
      banderas: [
        "Único postor en ítems 1 y 2",
        "Oferta exactamente al 100% del valor referencial",
        "Representante autorizado Caterpillar — gama coincide con especs MTC",
      ],
    },
    {
      ruc: "20612103624",
      razonSocial: "CORPVECA S.A.C.",
      tipo: "persona_juridica",
      rnpVigente: true,
      ofertas: [
        {
          itemNumero: 3,
          montoOfertado: 3_381_200.0,
          porcentajeReferencial: 100.0,
          admitida: true,
          calificada: true,
          ganador: true,
        },
      ],
      banderas: [
        "Único postor en ítem 3",
        "Oferta exactamente al 100% del valor referencial",
        "Sobreprecio del 22% sobre mediana de mercado (volquete commodity)",
      ],
    },
  ],
  ganadores: [
    {
      itemNumero: 1,
      postorRuc: "20100028698",
      postorNombre: "FERREYROS S.A.",
      monto: 2_042_744.26,
      fundamento:
        "Único postor admitido y calificado. Cumple experiencia y especificaciones técnicas conforme a numeral 3.5 del Capítulo III de las bases.",
    },
    {
      itemNumero: 2,
      postorRuc: "20100028698",
      postorNombre: "FERREYROS S.A.",
      monto: 1_686_074.62,
      fundamento:
        "Único postor admitido y calificado. Cumple experiencia y especificaciones técnicas.",
    },
    {
      itemNumero: 3,
      postorRuc: "20612103624",
      postorNombre: "CORPVECA S.A.C.",
      monto: 3_381_200.0,
      fundamento:
        "Único postor admitido y calificado. Cumple experiencia y especificaciones técnicas.",
    },
  ],
  documentos: [
    {
      tipo: "bases",
      nombre: "Bases Administrativas Estándar",
      fecha: "2026-04-14",
      paginas: 25,
      tamano: "21.7 MB",
      url: "/documentos/caso-chira-piura/bases-administrativas.pdf",
      agente: "document_parser_agent",
      resumenAgente:
        "Extrajo cuantía total (S/. 7.11M), 3 ítems, fuente RRO, modalidad suma alzada, especs técnicas detalladas en cap. III.",
    },
    {
      tipo: "acta_buena_pro",
      nombre: "Acta de Otorgamiento de Buena Pro",
      fecha: "2026-04-15",
      paginas: 3,
      tamano: "866 KB",
      url: "/documentos/caso-chira-piura/acta-buena-pro.pdf",
      agente: "document_parser_agent",
      resumenAgente:
        "2 postores únicos. Cada ítem con 1 solo postor. Todos al 100% del valor referencial. Sin descuento competitivo.",
    },
    {
      tipo: "reporte_buena_pro",
      nombre: "Reporte de Otorgamiento de Buena Pro",
      fecha: "2026-04-15",
      tamano: "412 KB",
      url: "/documentos/caso-chira-piura/reporte-buena-pro.pdf",
      agente: "document_parser_agent",
      resumenAgente:
        "Confirma adjudicación. Ferreyros se lleva ítems 1+2 (S/. 3.73M), Corpveca ítem 3 (S/. 3.38M).",
    },
  ],
  marketAnalysis: {
    totalOfertado: 7_110_018.88,
    totalEstimadoMercado: 6_490_000,
    sobreprecio: 620_018.88,
    sobreprecioPct: 9.6,
    veredicto: "elevado",
    notas: [
      "Excavadora y cargador frontal: alineados con gama premium (Caterpillar). Justificable por homologación MTC.",
      "Volquetes: 22% sobre mediana de mercado. Commodity con múltiples marcas calificables — no se justifica el premium.",
      "Patrón sistemático: las 3 ofertas son exactamente al 100% del valor referencial. Sin competencia real.",
      "Especificaciones técnicas restrictivas reducen el universo de proveedores → único postor por ítem.",
    ],
  },
};

/**
 * Para el demo: cualquier alerta devuelve este expediente.
 * En producción, esto consulta la base con el OCID/codigoConvocatoria.
 */
export function getExpedienteForAlerta(_alertaId: string): CasoExpediente {
  return CHIRA_PIURA_EXPEDIENTE;
}
