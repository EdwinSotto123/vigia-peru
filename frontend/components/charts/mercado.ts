/**
 * Vocabulario y armado de datos de la comparación de precios.
 *
 * Vive junto al gráfico porque es su fuente: el rango, la mediana y el
 * ofertado que se dibujan salen de acá ya resueltos, y el componente solo
 * los posiciona. Tres reglas que este archivo existe para sostener en un
 * solo lugar:
 *
 *  1. **El porcentaje del lote no se recalcula nunca.** Si el backend dejó
 *     `sobreprecio_pct` en null es porque su juez de plausibilidad decidió
 *     que el lote no es comparable. Recalcularlo en el cliente sobre un
 *     subconjunto de ítems es el bug histórico de este repo: resucitaba un
 *     "+105 % LOTE MUY ELEVADO" que el backend ya había descartado por
 *     falso. Acá `pct` sale del backend o es null, y punto.
 *  2. **La estimación del modelo nunca mueve el sobreprecio.** Los ítems
 *     con `precio_estimado_ia` traen `medido: false`; el gráfico los dibuja
 *     con textura y jamás les pinta el segmento de sobreprecio.
 *  3. **La severidad sale de `lib/severidad.ts`.** Acá se traduce el
 *     veredicto del backend (que ya trae sus propios umbrales) a un nivel,
 *     y el nivel trae sus tokens. Ningún umbral escrito a mano.
 */

import { AlertTriangle, CircleAlert, CircleCheck, CircleDashed } from "lucide-react";
import { SEVERIDAD, type NivelSeveridad, type SeveridadUI } from "@/lib/severidad";

/**
 * El ícono dibujado que acompaña a cada nivel de severidad. Es el canal
 * redundante del color: la severidad de este producto nunca viaja sola en
 * color. Mismo juego que usa `components/ui/Severidad.tsx`.
 */
export const ICONO_SEVERIDAD = {
  alerta: AlertTriangle,
  atencion: CircleAlert,
  ok: CircleCheck,
  vacio: CircleDashed,
} as const;

/** Número real o null. El backend manda números, strings, nulls y vacíos. */
function num(x: any): number | null {
  if (x === null || x === undefined || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function positivo(x: any): number | null {
  const n = num(x);
  return n !== null && n > 0 ? n : null;
}

// ── Vocabulario de veredictos ────────────────────────────────────────────

export type VeredictoMercado = {
  clave: string;
  etiqueta: string;
  ui: SeveridadUI;
  /** Salió de una medición con fuentes (no de una estimación del modelo ni de un "sin dato"). */
  medido: boolean;
};

const VOCABULARIO: Record<string, { etiqueta: string; nivel: NivelSeveridad; medido: boolean }> = {
  muy_elevado:            { etiqueta: "Muy elevado",            nivel: "alta",         medido: true },
  elevado:                { etiqueta: "Elevado",                nivel: "media",        medido: true },
  estimado_sobre_mercado: { etiqueta: "Cuantía sobre mercado",  nivel: "media",        medido: true },
  alineado:               { etiqueta: "Alineado",               nivel: "baja",         medido: true },
  alineado_regional:      { etiqueta: "Alineado (región)",      nivel: "baja",         medido: true },
  barato:                 { etiqueta: "Bajo el mercado",        nivel: "baja",         medido: true },
  cobertura_parcial:      { etiqueta: "Cobertura parcial",      nivel: "sin_analizar", medido: false },
  no_verificable:         { etiqueta: "No verificable",         nivel: "sin_analizar", medido: false },
  sin_dato:               { etiqueta: "Sin precio de mercado",  nivel: "sin_analizar", medido: false },
  estimado_ia:            { etiqueta: "Estimación del modelo",  nivel: "sin_analizar", medido: false },
  sin_ofertado:           { etiqueta: "Sin precio ofertado",    nivel: "sin_analizar", medido: false },
  estimacion:             { etiqueta: "Estimación",             nivel: "sin_analizar", medido: false },
};

export function veredictoMercado(clave?: string | null): VeredictoMercado {
  const k = String(clave || "").trim();
  const v = VOCABULARIO[k] || VOCABULARIO.sin_dato;
  return { clave: k || "sin_dato", etiqueta: v.etiqueta, ui: SEVERIDAD[v.nivel], medido: v.medido };
}

/** Por qué un ítem no tiene medición, en castellano. Nada de claves internas en pantalla. */
const MOTIVOS_ITEM: Record<string, string> = {
  sin_precios_en_mercado: "el agente no encontró precios publicados de este producto",
  sin_precio_con_fuente_verificable: "se vieron precios, pero ninguno con fuente verificable",
  precios_insuficientes: "se hallaron menos de 3 precios con fuente: no alcanza para una mediana",
  sin_precio_ofertado_ni_referencial: "el expediente no trae precio unitario de este ítem",
  estimado_por_ia_sin_busqueda: "quedó fuera del presupuesto de búsqueda del lote y el modelo lo estimó sin buscar",
  delta_implausible_sin_unidad_confirmada: "la diferencia salió implausible con unidades sin confirmar: se descartó",
  comparacion_no_normalizada: "la comparación no está normalizada por alcance (meses, personal, m²)",
  no_consultada: "no se llegó a consultar en esta corrida",
};

export function motivoItemLegible(motivo?: string | null): string | null {
  const k = String(motivo || "").trim();
  if (!k) return null;
  return MOTIVOS_ITEM[k] || k.replace(/_/g, " ");
}

const MOTIVOS_LOTE: Array<[RegExp, string]> = [
  [/^un_solo_item/, "es un solo ítem: la señal ya está en el ítem, no se emite una de lote"],
  [/^sin_items_respaldados/, "ningún ítem quedó respaldado con precios verificables"],
  [/^cobertura_por_valor_insuficiente/, "la cobertura por valor no llega al mínimo exigido"],
  [/^sin_base_ofertada_comparable/, "no hay precio ofertado por ítem comparable contra el mercado"],
  [/^solo_cuantia_referencial/, "solo existe la cuantía estimada por la entidad, no un precio ofertado"],
  [/^delta_implausible/, "la diferencia resultó implausible y el juez de precio la descartó"],
  [/^items_alineados_con_referencias_regionales/, "los ítems quedan alineados con las referencias regionales de la propia BD"],
];

export function motivoLoteLegible(motivo?: string | null): string | null {
  const k = String(motivo || "").trim();
  if (!k) return null;
  const hit = MOTIVOS_LOTE.find(([re]) => re.test(k));
  const detalle = k.match(/\(([^)]+)\)/)?.[1];
  if (!hit) return k.replace(/_/g, " ");
  return detalle ? `${hit[1]} (${detalle})` : hit[1];
}

// ── Una fila de la comparación ───────────────────────────────────────────

export type FilaPrecio = {
  key: string;
  numero: string;
  descripcion: string;
  cantidad: number | null;
  unidad: string;
  /** Precio unitario que la entidad puso sobre la mesa (ofertado, o el referencial si no hay oferta). */
  ofertadoUnit: number | null;
  baseOfertado: "ofertado" | "referencial" | null;
  /** Referencia de mercado: mediana medida, o estimación del modelo cuando no hubo búsqueda. */
  referenciaUnit: number | null;
  tipoReferencia: "mediana" | "estimacion_ia";
  rangoMinUnit: number | null;
  rangoMaxUnit: number | null;
  /** Los mismos valores llevados a la línea: unitario × cantidad. Es la escala del gráfico. */
  ofertado: number | null;
  referencia: number | null;
  rangoMin: number | null;
  rangoMax: number | null;
  /** Δ % publicado por el backend. Null = el backend no emitió diferencia y acá tampoco se inventa. */
  diffPct: number | null;
  /** (ofertado − mediana) × cantidad. Solo existe si `diffPct` existe. */
  diffMonto: number | null;
  veredicto: VeredictoMercado;
  medido: boolean;
  /** El ofertado supera el techo del rango observado: es lo único que se pinta rust. */
  sobreElRango: boolean;
  motivo: string | null;
  nPrecios: number;
  nFuentes: number;
  /** Tiene con qué dibujarse: cantidad y una referencia de mercado. */
  enGrafico: boolean;
  finding: any;
  ocdsItem: any;
};

export type PadreLote = {
  numero: string;
  descripcion: string;
  cantidad: number | null;
  unidad: string;
  cuantia: number | null;
} | null;

const normalizarNumero = (n: any) => String(n ?? "").trim().replace(/^0+(?=\d)/, "");
const normalizarDesc = (s: any) =>
  String(s || "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 50);

function construirFila(ocdsItem: any, f: any, key: string): FilaPrecio {
  const cantidad = positivo(f?.cantidad ?? ocdsItem?.cantidad);
  const unidad = String(f?.unidad || ocdsItem?.unidad || "UND");

  const ofertadoDirecto = positivo(f?.precio_unitario_ofertado);
  const referencial = positivo(f?.precio_unitario_referencial ?? ocdsItem?.precio_unitario_referencial);
  const ofertadoUnit = ofertadoDirecto ?? referencial;
  const baseOfertado: FilaPrecio["baseOfertado"] =
    ofertadoDirecto !== null ? "ofertado" : referencial !== null ? "referencial" : null;

  // La mediana que se dibuja es la MISMA que muestra la tabla, y es contra la
  // que el backend calculó `diff_pct` en todas sus ramas.
  const mediana = positivo(f?.precio_mediana_mercado ?? f?.precio_mediana_comparacion);
  const estimacionIA = positivo(f?.precio_estimado_ia);
  const referenciaUnit = mediana ?? estimacionIA;
  const tipoReferencia: FilaPrecio["tipoReferencia"] = mediana !== null ? "mediana" : "estimacion_ia";

  const rangoMinUnit = mediana !== null ? positivo(f?.rango_min) : null;
  const rangoMaxUnit = mediana !== null ? positivo(f?.rango_max) : null;

  const esEstimacionIA = f?.estado === "estimado_ia" || (mediana === null && estimacionIA !== null);
  const veredicto = veredictoMercado(esEstimacionIA ? "estimado_ia" : f?.veredicto);
  const medido = veredicto.medido && mediana !== null;

  const linea = (v: number | null) => (v !== null && cantidad !== null ? v * cantidad : null);
  const ofertado = linea(ofertadoUnit);
  const referencia = linea(referenciaUnit);
  const rangoMin = linea(rangoMinUnit);
  const rangoMax = linea(rangoMaxUnit);

  const diffPct = medido ? num(f?.diff_pct) : null;
  // La diferencia en soles es la resta de las dos cifras que el renglón
  // DIBUJA, no un porcentaje reconvertido. Y si su signo no coincide con el
  // Δ % que publicó el backend —puede pasar cuando el veredicto salió del
  // ancla regional y la mediana visible es la de retail— no se afirma ningún
  // monto: el gráfico calla antes que contradecirse.
  const brecha = ofertado !== null && referencia !== null ? ofertado - referencia : null;
  const diffMonto =
    diffPct !== null && brecha !== null && (brecha === 0 || Math.sign(brecha) === Math.sign(diffPct))
      ? brecha
      : null;

  const nPrecios = num(f?.n_precios) ?? (Array.isArray(f?.precios_observados) ? f.precios_observados.length : 0);
  const nFuentes =
    (Array.isArray(f?.precios_observados) ? f.precios_observados.filter((p: any) => p?.url).length : 0) +
    (Array.isArray(f?.referencias_internas) ? f.referencias_internas.length : 0);

  return {
    key,
    numero: String(f?.item_numero ?? ocdsItem?.numero ?? key),
    descripcion: String(f?.item_descripcion || ocdsItem?.descripcion || "Ítem sin descripción"),
    cantidad,
    unidad,
    ofertadoUnit,
    baseOfertado,
    referenciaUnit,
    tipoReferencia,
    rangoMinUnit,
    rangoMaxUnit,
    ofertado,
    referencia,
    rangoMin,
    rangoMax,
    diffPct,
    diffMonto,
    veredicto,
    medido,
    sobreElRango: Boolean(
      medido && diffMonto !== null && diffMonto > 0 && ofertado !== null && rangoMax !== null && ofertado > rangoMax,
    ),
    motivo: motivoItemLegible(f?.motivo_no_verificable || f?.motivo_estimacion),
    nPrecios,
    nFuentes,
    enGrafico: cantidad !== null && referencia !== null && referencia > 0,
    finding: f || null,
    ocdsItem: ocdsItem || null,
  };
}

/**
 * Cruza los ítems del parser (`allItems`, la lista completa del requerimiento)
 * con los findings del agente de mercado. El emparejamiento es por número
 * normalizado y, como respaldo, por descripción: los números divergen entre
 * parser y agente ('1.0' vs '1'), y antes de ese respaldo los ítems que el
 * mercado no alcanzó a tasar DESAPARECÍAN de la pantalla (se veían 2 de 8).
 */
export function construirFilas({
  items,
  allItems,
  market,
}: {
  items: any[];
  allItems: any[];
  market: any;
}): { filas: FilaPrecio[]; padreLote: PadreLote } {
  const findingsRaw: any[] = market?.findings || [];

  // Deduplicar: el LLM a veces emite "1" y "01.1" para el mismo producto.
  const vistos = new Set<string>();
  const findings = findingsRaw.filter((f) => {
    const k1 = normalizarNumero(f?.item_numero);
    const k2 = String(f?.item_descripcion || "").trim().toLowerCase().slice(0, 60);
    if (!k1 && !k2) return true;
    const compuesta = `${k1}|${k2}`;
    if (vistos.has(compuesta)) return false;
    vistos.add(compuesta);
    return true;
  });

  const porNumero = new Map(findings.map((f) => [normalizarNumero(f?.item_numero), f]));
  const porDesc = new Map(findings.map((f) => [normalizarDesc(f?.item_descripcion), f]));

  const pl = market?.padre_lote || null;
  const padreLote: PadreLote = pl
    ? {
        numero: String(pl.numero ?? ""),
        descripcion: String(pl.descripcion || ""),
        cantidad: positivo(pl.cantidad),
        unidad: String(pl.unidad || "Unidad"),
        cuantia: positivo(pl.cuantia_total),
      }
    : null;
  const padreNum = padreLote ? normalizarNumero(padreLote.numero) : null;

  // La `key` del renglón tiene que ser única aunque el parser repita el número
  // de ítem: es el identificador con el que el gráfico ata cada fila a su panel.
  const usadas = new Set<string>();
  const clave = (base: any, i: number) => {
    const raiz = String(base ?? "").trim() || `item-${i + 1}`;
    let k = raiz;
    let n = 2;
    while (usadas.has(k)) k = `${raiz}-${n++}`;
    usadas.add(k);
    return k;
  };

  const filas: FilaPrecio[] = [];
  if (allItems.length > 0) {
    for (const ai of allItems) {
      const k = normalizarNumero(ai?.numero);
      if (padreNum && k === padreNum) continue; // el lote padre no es un sub-ítem
      const f = porNumero.get(k) || porDesc.get(normalizarDesc(ai?.descripcion_corta || ai?.descripcion)) || null;
      filas.push(
        construirFila(
          {
            numero: ai?.numero,
            descripcion: ai?.descripcion_corta || ai?.descripcion,
            cantidad: ai?.cantidad,
            unidad: ai?.unidad,
            precio_unitario_referencial: ai?.precio_unitario_referencial,
            cubso: ai?.cubso,
            cubso_descripcion: ai?.cubso_descripcion,
            requerimiento: ai?.requerimiento_tecnico_detallado || "",
          },
          f,
          clave(ai?.numero, filas.length),
        ),
      );
    }
  } else {
    // Sin lista del parser: se arma desde los findings, y los ítems OCDS que
    // no aparecieron en ninguno se agregan adelante para no perderlos.
    for (const f of findings) {
      const k = normalizarNumero(f?.item_numero);
      if (padreNum && k === padreNum) continue;
      filas.push(construirFila(null, f, clave(k, filas.length)));
    }
    if (!padreLote) {
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        const f = porNumero.get(normalizarNumero(it?.numero)) || findings[i];
        if (filas.some((x) => x.finding && x.finding === f)) continue;
        filas.unshift(construirFila(it, f ?? null, clave(it?.numero, i)));
      }
    }
  }
  return { filas, padreLote };
}

/**
 * Orden del gráfico: primero lo medido, de mayor a menor diferencia en soles
 * — que es la pregunta real ("¿cuánto se pagó de más y en qué ítems?") —, y
 * después lo estimado, que nunca compite con una medición por el primer
 * renglón. Lo que no tiene con qué dibujarse queda fuera, con su motivo.
 */
export function ordenarPorDiferencia(filas: FilaPrecio[]) {
  const magnitud = (f: FilaPrecio) => Math.abs(f.diffMonto ?? 0);
  const enGrafico = filas.filter((f) => f.enGrafico);
  const medidas = enGrafico.filter((f) => f.medido).sort((a, b) => magnitud(b) - magnitud(a));
  const estimadas = enGrafico
    .filter((f) => !f.medido)
    .sort((a, b) => (b.referencia ?? 0) - (a.referencia ?? 0));
  return {
    orden: [...medidas, ...estimadas],
    medidas,
    estimadas,
    fuera: filas.filter((f) => !f.enGrafico),
  };
}

/** Techo de la escala compartida por todas las filas del gráfico. */
export function maximoEscala(filas: FilaPrecio[]): number {
  let max = 0;
  for (const f of filas) {
    for (const v of [f.ofertado, f.referencia, f.rangoMax]) {
      if (v !== null && v > max) max = v;
    }
  }
  return max;
}

// ── Resumen del lote (lo que lee MarketVerdictCard) ──────────────────────

export type ResumenLote = {
  /** El backend publicó un Δ de lote: es la única licencia para hablar de sobreprecio. */
  comparable: boolean;
  pct: number | null;
  abs: number | null;
  totalOfertado: number | null;
  totalMercado: number | null;
  /** El total de mercado salió de sumar los sub-ítems tasados, no de un total del backend. */
  totalMercadoEsSuma: boolean;
  esReferencial: boolean;
  nItems: number | null;
  nConMediana: number | null;
  nEstimadosIA: number;
  cobertura: number | null;
  motivo: string | null;
  estimadoVsMercadoPct: number | null;
  rango: { lo: number; hi: number } | null;
  veredicto: VeredictoMercado;
};

export function resumenLote(market: any): ResumenLote {
  const findings: any[] = market?.findings || [];
  const pct = num(market?.sobreprecio_pct);
  const comparable = pct !== null;

  const totalOfertado = positivo(market?.total_ofertado) ?? positivo(market?.padre_lote?.cuantia_total);

  const totalBackend = positivo(market?.total_estimado_mercado);
  let sumaMercado = 0;
  let lo = 0;
  let hi = 0;
  let conMediana = 0;
  for (const f of findings) {
    const med = positivo(f?.precio_mediana_mercado);
    const cant = positivo(f?.cantidad);
    if (med === null || cant === null) continue;
    sumaMercado += med * cant;
    lo += (positivo(f?.rango_min) ?? med) * cant;
    hi += (positivo(f?.rango_max) ?? med) * cant;
    conMediana++;
  }
  const totalMercado = totalBackend ?? (conMediana > 0 ? sumaMercado : null);

  // El absoluto NO se deriva de un porcentaje: es la resta del par exacto que
  // el backend usó para publicarlo. Si ese par no está, no hay absoluto.
  const lote = market?.lote || {};
  const ofertadoResp = positivo(lote?.total_ofertado_respaldados);
  const mercadoResp = positivo(lote?.total_mercado_respaldados);
  let abs: number | null = null;
  if (comparable) {
    if (ofertadoResp !== null && mercadoResp !== null) abs = ofertadoResp - mercadoResp;
    else if (totalOfertado !== null && totalBackend !== null) abs = totalOfertado - totalBackend;
  }

  return {
    comparable,
    pct,
    abs,
    totalOfertado,
    totalMercado,
    totalMercadoEsSuma: totalBackend === null && conMediana > 0,
    esReferencial: Boolean(market?.total_ofertado_es_referencial) || lote?.base === "referencial",
    nItems: num(market?.n_items),
    nConMediana: num(market?.n_con_mediana),
    nEstimadosIA: num(market?.n_items_estimados_ia) ?? 0,
    cobertura: num(market?.cobertura_mercado),
    motivo: market?.motivo_no_verificable
      ? String(market.motivo_no_verificable)
      : motivoLoteLegible(lote?.motivo),
    estimadoVsMercadoPct: num(market?.estimado_vs_mercado_pct),
    rango: conMediana > 0 && hi > lo ? { lo, hi } : null,
    veredicto: veredictoMercado(market?.veredicto_global),
  };
}
