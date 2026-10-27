/**
 * Obras públicas (INFOBRAS, Contraloría) e inversiones (Invierte.pe, MEF): migración 160.
 *
 *   · obra_infobras   una fila por obra (Código INFOBRAS), con la entidad que la registra, su ejecutor y su supervisor,
 *                     su avance, su paralización, sus adicionales y sus banderas (`banderas`, calculadas por
 *                     obra_banderas() en la base).
 *   · inversion_mef   una fila por inversión (CUI), activa o cerrada, con su monto viable y su costo actualizado.
 *   · obra_contrato   qué contrato ejecuta o supervisa cada obra; contrato_cui, el CUI de cada contrato.
 *
 * Las banderas viven en la base (una sola fuente: la lista, la ficha y los cruces del contrato leen lo mismo). Aquí, sus
 * umbrales escritos una vez (UMBRAL_OBRA, los mismos de la migración: test/obras.test.ts lo comprueba), la regla en TS
 * (`banderasObra`, `banderasInversion`) para leer una fila que todavía no pasó por el refresco, las consultas de las
 * listas y la forma pública de cada fila.
 *
 * Privacidad (lib/privacidad.ts): el ejecutor o el supervisor van como `{ ruc, nombre }`, el par que `publicar()`
 * reconoce: un RUC 10 (persona natural) sale como `10·ref·…` y con un apellido tapado. Un RUC mal escrito no sale (podría
 * llevar un DNI) y, si el nombre no parece de una empresa, tampoco el nombre. La búsqueda (`texto`) no lleva nombres de
 * personas naturales. Quien llama pasa la respuesta por `publicar()`.
 */

import { pool } from "./db.js";
import { pareceEmpresa } from "./privacidad.js";

// ─── Umbrales y banderas ─────────────────────────────────────────────────────

/** Los umbrales de obra_banderas() e inversion_banderas() (migración 160). */
export const UMBRAL_OBRA = {
  /** Hoy paralizada hace este número de días o más: grave. */
  paralizadaLargaDias: 180,
  /** Avance físico real por debajo del programado, en puntos porcentuales. */
  atrasoPuntos: 20,
  atrasoGravePuntos: 40,
  /** Ejecución financiera por encima del avance físico, en puntos (sólo con el físico bajo este %). */
  adelantoPuntos: 30,
  adelantoGravePuntos: 50,
  adelantoFisicoMaximo: 95,
  /** Adicionales netos de deductivos sobre el contrato (%): en una obra por contrata, la ley permite hasta 15 % sin la Contraloría. */
  adicionalesAltosPct: 10,
  adicionalesTopePct: 15,
  /** Ampliaciones de plazo frente al plazo original (%). */
  plazoAmpliadoPct: 50,
  plazoDuplicadoPct: 100,
  /** Costo actualizado frente al monto viable (veces), y la diferencia mínima en soles. */
  sobrecostoVeces: 1.5,
  sobrecostoExtremoVeces: 2,
  sobrecostoMinimoSoles: 100_000,
} as const;

export type Severidad = "alta" | "media" | "baja";

/** Una bandera de una obra o de una inversión: su tipo, su gravedad y la evidencia (números y fechas de la fuente). */
export interface BanderaObra {
  tipo: string;
  severidad: Severidad;
  [dato: string]: unknown;
}

/** Los tipos de bandera de una obra (INFOBRAS) y de una inversión (Invierte.pe), del más grave al más leve. */
export const TIPOS_OBRA = [
  "obra_paralizada_larga", "obra_paralizada", "obra_paralizacion",
  "obra_atraso_grave", "obra_atraso",
  "obra_pagado_sin_avance", "obra_pago_adelantado",
  "obra_adicionales_sobre_tope", "obra_adicionales_altos", "obra_adicionales",
  "obra_plazo_duplicado", "obra_plazo_ampliado",
  "obra_controversia", "obra_informe_control",
] as const;
export const TIPOS_INVERSION = ["inversion_sobrecosto_extremo", "inversion_sobrecosto", "inversion_laudo"] as const;

/** El nombre de cada bandera en la ficha del contrato y en la lista de antecedentes (ETIQUETA_CRUCE, lib/cruces.ts). */
export const ETIQUETA_OBRA: Record<string, string> = {
  obra_paralizada_larga: "La obra está paralizada hace 6 meses o más",
  obra_paralizada: "La obra está paralizada",
  obra_paralizacion: "La obra estuvo paralizada",
  obra_atraso_grave: "La obra va 40 puntos o más por debajo de lo programado",
  obra_atraso: "La obra va de 20 a 40 puntos por debajo de lo programado",
  obra_pagado_sin_avance: "Se pagó 50 puntos o más por encima de lo construido",
  obra_pago_adelantado: "Se pagó de 30 a 50 puntos por encima de lo construido",
  obra_adicionales_sobre_tope: "Adicionales de obra por más del 15 % del contrato",
  obra_adicionales_altos: "Adicionales de obra por más del 10 % del contrato",
  obra_adicionales: "La obra tuvo adicionales",
  obra_plazo_duplicado: "Las ampliaciones de plazo duplicaron el plazo de la obra",
  obra_plazo_ampliado: "Las ampliaciones de plazo suman la mitad del plazo o más",
  obra_controversia: "La obra tuvo controversias (arbitraje o conciliación)",
  obra_informe_control: "La Contraloría emitió informes de control sobre la obra",
  inversion_sobrecosto_extremo: "La inversión cuesta 2 veces o más lo que se aprobó",
  inversion_sobrecosto: "La inversión cuesta 1.5 veces o más lo que se aprobó",
  inversion_laudo: "La inversión registra un laudo arbitral",
};

const RANGO: Record<Severidad, number> = { alta: 0, media: 1, baja: 2 };
const num = (v: unknown): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const dia = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
const diasEntre = (desde: string, hasta: string) => Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86_400_000);
const redondear = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
const ordenar = (b: BanderaObra[]) => b.sort((x, y) => RANGO[x.severidad] - RANGO[y.severidad] || x.tipo.localeCompare(y.tipo));

/** Lo que una obra necesita para sus banderas (las columnas de obra_infobras). */
export interface HechosObra {
  estado?: string | null;
  modalidad?: string | null;
  paralizada?: boolean | null;
  dias_paralizada?: number | null;
  fecha_paralizacion?: string | null;
  causal_paralizacion?: string | null;
  fisico_prog?: number | string | null;
  fisico_real?: number | string | null;
  financiero_pct?: number | string | null;
  financiero_monto?: number | string | null;
  avance_fecha?: string | null;
  contrato_monto?: number | string | null;
  costo_et?: number | string | null;
  adicionales_n?: number | null;
  adicionales_monto?: number | string | null;
  deductivos_n?: number | null;
  deductivos_monto?: number | string | null;
  plazo_dias?: number | null;
  dias_ampliacion?: number | null;
  modificaciones?: number | null;
  fecha_fin_prog?: string | null;
  fecha_fin_reprog?: string | null;
  controversias?: number | null;
  informes_control?: number | null;
  dudoso?: string[] | null;
}

/**
 * Las banderas de una obra con la regla de obra_banderas() (migración 160), al día `al` del archivo de INFOBRAS. Un
 * dato imposible (`dudoso`) no dispara su bandera.
 */
export function banderasObra(o: HechosObra, al: string): BanderaObra[] {
  const U = UMBRAL_OBRA;
  const dudoso = new Set(o.dudoso ?? []);
  const out: BanderaObra[] = [];
  const paralizadaHoy = o.estado === "Paralizada";
  if ((o.paralizada || paralizadaHoy) && !dudoso.has("fecha_imposible")) {
    const desde = dia(o.fecha_paralizacion);
    const dias = paralizadaHoy ? Math.max(o.dias_paralizada ?? 0, desde ? diasEntre(desde, al) : 0) : o.dias_paralizada ?? null;
    const tipo = paralizadaHoy ? ((dias ?? 0) >= U.paralizadaLargaDias ? "obra_paralizada_larga" : "obra_paralizada") : "obra_paralizacion";
    out.push({ tipo, severidad: tipo === "obra_paralizada_larga" ? "alta" : tipo === "obra_paralizada" ? "media" : "baja",
      dias, dias_infobras: o.dias_paralizada ?? null, desde, causal: o.causal_paralizacion ?? null, estado: o.estado ?? null, al });
  }
  const prog = num(o.fisico_prog), real = num(o.fisico_real), fin = num(o.financiero_pct);
  const enObra = o.estado === "En Ejecución" || paralizadaHoy;
  if (enObra && prog != null && real != null && prog >= 0 && prog <= 100.5 && real >= 0 && real <= 100.5) {
    const atraso = prog - real;
    if (atraso >= U.atrasoPuntos) {
      const grave = atraso >= U.atrasoGravePuntos;
      out.push({ tipo: grave ? "obra_atraso_grave" : "obra_atraso", severidad: grave ? "alta" : "media",
        programado: prog, real, puntos: redondear(atraso), al: dia(o.avance_fecha), estado: o.estado ?? null });
    }
  }
  if (real != null && fin != null && real >= 0 && real < U.adelantoFisicoMaximo && fin >= 0 && fin <= 200) {
    const adelanto = fin - real;
    if (adelanto >= U.adelantoPuntos) {
      const grave = adelanto >= U.adelantoGravePuntos;
      out.push({ tipo: grave ? "obra_pagado_sin_avance" : "obra_pago_adelantado", severidad: grave ? "alta" : "media",
        financiero: fin, fisico: real, puntos: redondear(adelanto), pagado: num(o.financiero_monto), al: dia(o.avance_fecha),
        estado: o.estado ?? null });
    }
  }
  const adic = num(o.adicionales_monto) ?? 0, deduc = num(o.deductivos_monto) ?? 0;
  const contrato = num(o.contrato_monto), et = num(o.costo_et);
  const base = contrato != null && contrato > 0 ? contrato : et != null && et > 0 ? et : null;
  if (adic > 0 && !dudoso.has("adicionales_imposibles")) {
    const neto = base ? (100 * (adic - deduc)) / base : null;
    // El tope del 15 % es de la Ley de Contrataciones: sólo una obra por contrata lo pasa (en otra modalidad, «altos»).
    const tipo = neto != null && neto > U.adicionalesTopePct && o.modalidad === "Contrata" ? "obra_adicionales_sobre_tope"
      : neto != null && neto > U.adicionalesAltosPct ? "obra_adicionales_altos" : "obra_adicionales";
    out.push({ tipo, severidad: tipo === "obra_adicionales_sobre_tope" ? "alta" : tipo === "obra_adicionales_altos" ? "media" : "baja",
      n: o.adicionales_n ?? 0, monto: adic, deductivos: deduc, deductivos_n: o.deductivos_n ?? 0, base,
      base_de: contrato != null && contrato > 0 ? "contrato" : base ? "expediente" : null,
      porcentaje: base ? redondear((100 * adic) / base) : null, neto: neto != null ? redondear(neto) : null });
  }
  const plazo = o.plazo_dias ?? 0, ampl = o.dias_ampliacion ?? 0;
  if (plazo > 0 && ampl >= (U.plazoAmpliadoPct / 100) * plazo && !dudoso.has("plazo_imposible")) {
    const doble = ampl >= (U.plazoDuplicadoPct / 100) * plazo;
    out.push({ tipo: doble ? "obra_plazo_duplicado" : "obra_plazo_ampliado", severidad: doble ? "media" : "baja",
      plazo, ampliacion: ampl, modificaciones: o.modificaciones ?? 0, porcentaje: Math.round((100 * ampl) / plazo),
      fin_programado: dia(o.fecha_fin_prog), fin_reprogramado: dia(o.fecha_fin_reprog) });
  }
  if ((o.controversias ?? 0) > 0) out.push({ tipo: "obra_controversia", severidad: "media", n: o.controversias });
  if ((o.informes_control ?? 0) > 0) out.push({ tipo: "obra_informe_control", severidad: "baja", n: o.informes_control });
  return ordenar(out);
}

/** Lo que una inversión necesita para sus banderas (las columnas de inversion_mef). */
export interface HechosInversion {
  monto_viable?: number | string | null;
  costo_actualizado?: number | string | null;
  monto_laudo?: number | string | null;
  fecha_viabilidad?: string | null;
  dudoso?: string[] | null;
}

/** Las banderas de una inversión con la regla de inversion_banderas() (migración 160). */
export function banderasInversion(i: HechosInversion): BanderaObra[] {
  const U = UMBRAL_OBRA;
  const out: BanderaObra[] = [];
  const viable = num(i.monto_viable), costo = num(i.costo_actualizado), laudo = num(i.monto_laudo);
  if (viable != null && viable > 0 && costo != null && costo >= U.sobrecostoVeces * viable && costo - viable >= U.sobrecostoMinimoSoles
      && !(i.dudoso ?? []).includes("costo_imposible")) {
    const extremo = costo >= U.sobrecostoExtremoVeces * viable;
    out.push({ tipo: extremo ? "inversion_sobrecosto_extremo" : "inversion_sobrecosto", severidad: extremo ? "alta" : "media",
      viable, actualizado: costo, veces: Math.round((costo / viable) * 100) / 100, diferencia: costo - viable, viabilidad: dia(i.fecha_viabilidad) });
  }
  if (laudo != null && laudo > 0) out.push({ tipo: "inversion_laudo", severidad: "media", monto: laudo, actualizado: costo });
  return ordenar(out);
}

// ─── Quién ejecuta o supervisa ───────────────────────────────────────────────

/** El ejecutor o el supervisor de una obra, como lo puede mostrar la API. */
export interface QuienObra {
  /** RUC 20 (empresa) o RUC 10 (persona natural: publicar() lo vuelve `10·ref·…`). Un RUC mal escrito no sale. */
  ruc: string | null;
  /** La razón social; de una persona natural, con un apellido tapado por publicar(); sin RUC válido y sin forma de empresa, no sale. */
  nombre: string | null;
  tipo: "empresa" | "persona" | "consorcio";
}

/**
 * INFOBRAS publica el RUC como lo escribió la entidad: un RUC, el código «C000…» de un consorcio, dos pegados o un texto.
 * Sólo sale un RUC bien escrito; un consorcio, por su nombre; y lo que no se puede reconocer como empresa se trata como
 * persona natural sin nombre (un RUC 10 con un dígito de menos lleva igual un DNI).
 */
export function quienObra(ruc: string | null | undefined, nombre: string | null | undefined): QuienObra | null {
  const r = (ruc ?? "").trim().toUpperCase();
  const n = (nombre ?? "").replace(/\s+/g, " ").trim() || null;
  if (!r && !n) return null;
  if (/^20\d{9}$/.test(r)) return { ruc: r, nombre: n, tipo: "empresa" };
  if (/^10\d{9}$/.test(r)) return { ruc: r, nombre: n, tipo: "persona" };
  if (n && /^CONSORCIO\b/i.test(n)) return { ruc: null, nombre: n, tipo: "consorcio" };
  if (/^C\d{10}$/.test(r) && n) return { ruc: null, nombre: n, tipo: pareceEmpresa(n) ? "empresa" : "consorcio" };
  if (n && pareceEmpresa(n) && !/^10/.test(r)) return { ruc: null, nombre: n, tipo: "empresa" };
  return { ruc: null, nombre: null, tipo: "persona" };
}

// ─── Enlaces a la fuente ─────────────────────────────────────────────────────

/** La ficha pública de la obra en INFOBRAS (la que abre su propio buscador). La Contraloría responde desde el Perú. */
export const urlInfobras = (codigo: number | string) => `https://infobras.contraloria.gob.pe/InfobrasWeb/Mapa/Sumario?ObraId=${encodeURIComponent(String(codigo))}`;
/** El seguimiento de la inversión en el SSI del MEF (Sistema de Seguimiento de Inversiones), por CUI. */
export const urlInversion = (cui: string) => `https://ofi5.mef.gob.pe/ssi/Ssi/Index?codigo=${encodeURIComponent(cui)}&tipo=2`;

// ─── Filas públicas ──────────────────────────────────────────────────────────

/** Las columnas que la API lee de obra_infobras (alias `o`). */
export const COLS_OBRA = `o.codigo, o.nombre, o.estado, o.modalidad, o.naturaleza, o.tipo1, o.tipo2, o.cui, o.snip, o.es_saldo,
  o.entidad_ruc, o.entidad_nombre, o.departamento, o.provincia, o.distrito, o.ubigeo,
  EXISTS (SELECT 1 FROM entidades en WHERE en.ruc = o.entidad_ruc) AS entidad_ficha,
  o.ejecutor_ruc, o.ejecutor_nombre, o.supervisor_ruc, o.supervisor_nombre,
  o.contrato_monto::float AS contrato_monto, o.supervision_monto::float AS supervision_monto, o.costo_et::float AS costo_et,
  o.monto_viable::float AS monto_viable, o.costo_liquidacion::float AS costo_liquidacion, o.devengado_total::float AS devengado_total,
  to_char(o.fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio, to_char(o.fecha_fin_prog, 'YYYY-MM-DD') AS fecha_fin_prog,
  to_char(o.fecha_fin_reprog, 'YYYY-MM-DD') AS fecha_fin_reprog, to_char(o.fecha_fin_real, 'YYYY-MM-DD') AS fecha_fin_real,
  to_char(o.avance_fecha, 'YYYY-MM-DD') AS avance_fecha, to_char(o.fecha_recepcion, 'YYYY-MM-DD') AS fecha_recepcion,
  to_char(o.fecha_liquidacion, 'YYYY-MM-DD') AS fecha_liquidacion, to_char(o.fecha_aprob_et, 'YYYY-MM-DD') AS fecha_aprob_et,
  o.plazo_dias, o.dias_ampliacion, o.modificaciones, o.nuevo_plazo,
  o.fisico_prog::float AS fisico_prog, o.fisico_real::float AS fisico_real, o.financiero_pct::float AS financiero_pct,
  o.financiero_monto::float AS financiero_monto, o.valorizado_prog::float AS valorizado_prog, o.valorizado_real::float AS valorizado_real,
  o.paralizada, o.causal_paralizacion, to_char(o.fecha_paralizacion, 'YYYY-MM-DD') AS fecha_paralizacion, o.dias_paralizada,
  o.adicionales_n, o.adicionales_monto::float AS adicionales_monto, o.deductivos_n, o.deductivos_monto::float AS deductivos_monto,
  o.adic_sup_n, o.adic_sup_monto::float AS adic_sup_monto,
  o.controversias, o.informes_control, o.veedurias, o.comentarios_ciudadanos, o.motivo_no_100, o.recepcion, o.liquidacion,
  o.banderas, o.severidad, o.dudoso, to_char(o.dataset_fecha, 'YYYY-MM-DD') AS dataset_fecha`;

/** Los contratos de Vigía que ejecutan o supervisan la obra (obra_contrato), para la fila. */
export const CONTRATOS_DE_OBRA = `(SELECT jsonb_agg(jsonb_build_object('ocid', oc.ocid, 'codigo', c.codigo, 'rol', oc.rol, 'via', oc.via,
                                     'fecha', to_char(c.fecha_convocatoria, 'YYYY-MM-DD')) ORDER BY oc.rol, c.fecha_convocatoria DESC)
     FROM obra_contrato oc JOIN convocatorias c ON c.ocid = oc.ocid WHERE oc.codigo = o.codigo)`;

export interface ObraPublica {
  codigo: number;
  nombre: string;
  estado: string | null;
  modalidad: string | null;
  naturaleza: string | null;
  tipo: string | null;
  cui: string | null;
  esSaldo: boolean;
  /** `ficha`: la entidad tiene su ficha en Vigía (no toda entidad del registro de la OECE la tiene). */
  entidad: { ruc: string | null; nombre: string | null; ficha: boolean };
  lugar: { departamento: string | null; provincia: string | null; distrito: string | null; ubigeo: string | null };
  ejecutor: QuienObra | null;
  supervisor: QuienObra | null;
  montos: {
    contrato: number | null; supervision: number | null; expediente: number | null; viable: number | null;
    liquidacion: number | null; devengado: number | null;
  };
  fechas: {
    inicio: string | null; finProgramada: string | null; finReprogramada: string | null; finReal: string | null;
    avance: string | null; recepcion: string | null; liquidacion: string | null; expediente: string | null;
  };
  plazo: { dias: number | null; ampliacion: number; modificaciones: number; nuevo: number | null };
  avance: {
    fisicoProgramado: number | null; fisicoReal: number | null; financiero: number | null; pagado: number | null;
    valorizadoProgramado: number | null; valorizadoReal: number | null;
  };
  paralizacion: { si: boolean; causal: string | null; desde: string | null; dias: number | null };
  adicionales: { n: number; monto: number; deductivosN: number; deductivos: number; supervisionN: number; supervision: number };
  controversias: number;
  informesControl: number;
  veedurias: number;
  comentariosCiudadanos: number;
  motivoNo100: string | null;
  recepcion: boolean | null;
  liquidacion: boolean | null;
  banderas: BanderaObra[];
  severidad: Severidad | null;
  dudoso: string[];
  contratos: { ocid: string; codigo: string | null; rol: "ejecucion" | "supervision"; via: string; fecha: string | null }[];
  /** La fecha del archivo de INFOBRAS que trajo esta versión de la obra. */
  alDia: string | null;
  url: string;
}

const sev = (v: unknown): Severidad | null => (v === "alta" || v === "media" || v === "baja" ? v : null);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** Una fila de obra_infobras (COLS_OBRA, con `contratos` si se pidió) → lo que ve el público. `al`: el día del archivo. */
export function aObra(r: Record<string, any>, al: string | null = null): ObraPublica {
  const guardadas = arr<BanderaObra>(r.banderas);
  // Una obra que todavía no pasó por el refresco (sin banderas guardadas) se lee con la misma regla.
  const banderas = guardadas.length || !al ? guardadas : banderasObra(r as HechosObra, al);
  return {
    codigo: Number(r.codigo),
    nombre: String(r.nombre ?? ""),
    estado: r.estado ?? null,
    modalidad: r.modalidad ?? null,
    naturaleza: r.naturaleza ?? null,
    tipo: r.tipo1 ?? null,
    cui: r.cui ?? null,
    esSaldo: r.es_saldo === true,
    entidad: { ruc: r.entidad_ruc ?? null, nombre: r.entidad_nombre ?? null, ficha: r.entidad_ficha === true },
    lugar: { departamento: r.departamento ?? null, provincia: r.provincia ?? null, distrito: r.distrito ?? null, ubigeo: r.ubigeo ?? null },
    ejecutor: quienObra(r.ejecutor_ruc, r.ejecutor_nombre),
    supervisor: quienObra(r.supervisor_ruc, r.supervisor_nombre),
    montos: {
      contrato: num(r.contrato_monto) || null, supervision: num(r.supervision_monto) || null, expediente: num(r.costo_et) || null,
      viable: num(r.monto_viable) || null, liquidacion: num(r.costo_liquidacion) || null, devengado: num(r.devengado_total) || null,
    },
    fechas: {
      inicio: r.fecha_inicio ?? null, finProgramada: r.fecha_fin_prog ?? null, finReprogramada: r.fecha_fin_reprog ?? null,
      finReal: r.fecha_fin_real ?? null, avance: r.avance_fecha ?? null, recepcion: r.fecha_recepcion ?? null,
      liquidacion: r.fecha_liquidacion ?? null, expediente: r.fecha_aprob_et ?? null,
    },
    plazo: { dias: r.plazo_dias ?? null, ampliacion: r.dias_ampliacion ?? 0, modificaciones: r.modificaciones ?? 0, nuevo: r.nuevo_plazo ?? null },
    avance: {
      fisicoProgramado: num(r.fisico_prog), fisicoReal: num(r.fisico_real), financiero: num(r.financiero_pct), pagado: num(r.financiero_monto),
      valorizadoProgramado: num(r.valorizado_prog), valorizadoReal: num(r.valorizado_real),
    },
    paralizacion: { si: r.paralizada === true || r.estado === "Paralizada", causal: r.causal_paralizacion ?? null, desde: r.fecha_paralizacion ?? null, dias: r.dias_paralizada ?? null },
    adicionales: {
      n: r.adicionales_n ?? 0, monto: num(r.adicionales_monto) ?? 0, deductivosN: r.deductivos_n ?? 0, deductivos: num(r.deductivos_monto) ?? 0,
      supervisionN: r.adic_sup_n ?? 0, supervision: num(r.adic_sup_monto) ?? 0,
    },
    controversias: r.controversias ?? 0,
    informesControl: r.informes_control ?? 0,
    veedurias: r.veedurias ?? 0,
    comentariosCiudadanos: r.comentarios_ciudadanos ?? 0,
    motivoNo100: r.motivo_no_100 ?? null,
    recepcion: r.recepcion ?? null,
    liquidacion: r.liquidacion ?? null,
    banderas,
    severidad: sev(r.severidad) ?? (banderas[0]?.severidad ?? null),
    dudoso: arr<string>(r.dudoso),
    contratos: arr(r.contratos),
    alDia: r.dataset_fecha ?? null,
    url: urlInfobras(r.codigo),
  };
}

/** Las columnas que la API lee de inversion_mef (alias `i`). */
export const COLS_INVERSION = `i.cui, i.origen, i.snip, i.nombre, i.nivel, i.sector, i.entidad_ruc, i.entidad_nombre, i.uei, i.uep, i.estado,
  EXISTS (SELECT 1 FROM entidades en WHERE en.ruc = i.entidad_ruc) AS entidad_ficha,
  i.situacion, i.monto_viable::float AS monto_viable, i.costo_actualizado::float AS costo_actualizado,
  i.control_concurrente::float AS control_concurrente, i.monto_laudo::float AS monto_laudo, i.monto_fianza::float AS monto_fianza,
  to_char(i.fecha_registro, 'YYYY-MM-DD') AS fecha_registro, to_char(i.fecha_viabilidad, 'YYYY-MM-DD') AS fecha_viabilidad,
  i.funcion, i.programa, i.subprograma, i.marco, i.tipo_inversion, i.modalidad, i.tipologia, i.expediente_tecnico,
  i.primer_devengado, i.ultimo_devengado, i.devengado_acumulado::float AS devengado_acumulado, i.devengado_anio::float AS devengado_anio,
  i.pim_anio::float AS pim_anio, i.saldo_ejecutar::float AS saldo_ejecutar, i.avance_fisico::float AS avance_fisico,
  i.monto_et::float AS monto_et, i.departamento, i.provincia, i.distrito, i.ubigeo,
  to_char(i.inicio_ejecucion, 'YYYY-MM-DD') AS inicio_ejecucion, to_char(i.fin_ejecucion, 'YYYY-MM-DD') AS fin_ejecucion,
  to_char(i.inicio_fisica, 'YYYY-MM-DD') AS inicio_fisica, to_char(i.fin_fisica, 'YYYY-MM-DD') AS fin_fisica,
  to_char(i.fecha_cierre, 'YYYY-MM-DD') AS fecha_cierre, i.liquidacion::float AS liquidacion, i.beneficiarios,
  i.banderas, i.severidad, i.dudoso, to_char(i.dataset_fecha, 'YYYY-MM-DD') AS dataset_fecha`;

/** Los contratos de Vigía con el CUI de la inversión (contrato_cui) y cuántas obras de INFOBRAS tiene, para la fila. */
export const CONTRATOS_DE_INVERSION = `(SELECT jsonb_agg(jsonb_build_object('ocid', k.ocid, 'codigo', c.codigo, 'origen', k.origen,
                                         'tipo', c.tipo_contratacion, 'fecha', to_char(c.fecha_convocatoria, 'YYYY-MM-DD'))
                                         ORDER BY c.fecha_convocatoria DESC NULLS LAST)
     FROM contrato_cui k JOIN convocatorias c ON c.ocid = k.ocid WHERE k.cui = i.cui)`;
export const OBRAS_DE_INVERSION = `(SELECT count(*)::int FROM obra_infobras ob WHERE ob.cui = i.cui AND NOT ob.retirada)`;

export interface InversionPublica {
  cui: string;
  nombre: string | null;
  estado: "activa" | "cerrada";
  situacion: string | null;
  nivel: string | null;
  funcion: string | null;
  programa: string | null;
  tipologia: string | null;
  tipo: string | null;
  modalidad: string | null;
  marco: string | null;
  entidad: { ruc: string | null; nombre: string | null; ficha: boolean };
  unidadEjecutora: string | null;
  lugar: { departamento: string | null; provincia: string | null; distrito: string | null; ubigeo: string | null };
  montos: {
    viable: number | null; actualizado: number | null; expediente: number | null; devengado: number | null; pimAnio: number | null;
    devengadoAnio: number | null; saldo: number | null; liquidacion: number | null; controlConcurrente: number | null;
    laudo: number | null; fianza: number | null;
  };
  /** Costo actualizado ÷ monto viable. */
  veces: number | null;
  avanceFisico: number | null;
  expedienteTecnico: boolean | null;
  fechas: { registro: string | null; viabilidad: string | null; inicio: string | null; fin: string | null; cierre: string | null };
  beneficiarios: number | null;
  banderas: BanderaObra[];
  severidad: Severidad | null;
  dudoso: string[];
  contratos: { ocid: string; codigo: string | null; origen: string; tipo: string | null; fecha: string | null }[];
  obras: number;
  alDia: string | null;
  url: string;
}

export function aInversion(r: Record<string, any>): InversionPublica {
  const guardadas = arr<BanderaObra>(r.banderas);
  const banderas = guardadas.length ? guardadas : banderasInversion(r as HechosInversion);
  const viable = num(r.monto_viable), costo = num(r.costo_actualizado);
  return {
    cui: String(r.cui),
    nombre: r.nombre ?? null,
    estado: r.origen === "cerrada" ? "cerrada" : "activa",
    situacion: r.situacion ?? null,
    nivel: r.nivel ?? null,
    funcion: r.funcion ?? null,
    programa: r.programa ?? null,
    tipologia: r.tipologia ?? null,
    tipo: r.tipo_inversion ?? null,
    modalidad: r.modalidad ?? null,
    marco: r.marco ?? null,
    entidad: { ruc: r.entidad_ruc ?? null, nombre: r.entidad_nombre ?? null, ficha: r.entidad_ficha === true },
    unidadEjecutora: r.uei ?? r.uep ?? null,
    lugar: { departamento: r.departamento ?? null, provincia: r.provincia ?? null, distrito: r.distrito ?? null, ubigeo: r.ubigeo ?? null },
    montos: {
      viable, actualizado: costo, expediente: num(r.monto_et) || null, devengado: num(r.devengado_acumulado), pimAnio: num(r.pim_anio),
      devengadoAnio: num(r.devengado_anio), saldo: num(r.saldo_ejecutar), liquidacion: num(r.liquidacion) || null,
      controlConcurrente: num(r.control_concurrente) || null, laudo: num(r.monto_laudo) || null, fianza: num(r.monto_fianza) || null,
    },
    veces: viable && costo ? Math.round((costo / viable) * 100) / 100 : null,
    avanceFisico: num(r.avance_fisico),
    expedienteTecnico: r.expediente_tecnico ?? null,
    fechas: { registro: r.fecha_registro ?? null, viabilidad: r.fecha_viabilidad ?? null, inicio: r.inicio_fisica ?? r.inicio_ejecucion ?? null,
              fin: r.fin_fisica ?? r.fin_ejecucion ?? null, cierre: r.fecha_cierre ?? null },
    beneficiarios: r.beneficiarios ?? null,
    banderas,
    severidad: sev(r.severidad) ?? (banderas[0]?.severidad ?? null),
    dudoso: arr<string>(r.dudoso),
    contratos: arr(r.contratos),
    obras: Number(r.obras ?? 0),
    alDia: r.dataset_fecha ?? null,
    url: urlInversion(String(r.cui)),
  };
}

// ─── Filtros de las listas ───────────────────────────────────────────────────

/** Los filtros por bandera de la lista de obras: cada uno, los tipos que cuenta. */
export const BANDERA_OBRA: Record<string, readonly string[]> = {
  paralizada: ["obra_paralizada_larga", "obra_paralizada"],
  paralizacion: ["obra_paralizada_larga", "obra_paralizada", "obra_paralizacion"],
  atraso: ["obra_atraso_grave", "obra_atraso"],
  pago: ["obra_pagado_sin_avance", "obra_pago_adelantado"],
  adicionales: ["obra_adicionales_sobre_tope", "obra_adicionales_altos", "obra_adicionales"],
  adicionales_tope: ["obra_adicionales_sobre_tope"],
  plazo: ["obra_plazo_duplicado", "obra_plazo_ampliado"],
  controversia: ["obra_controversia"],
  control: ["obra_informe_control"],
};
export const BANDERA_INVERSION: Record<string, readonly string[]> = {
  sobrecosto: ["inversion_sobrecosto_extremo", "inversion_sobrecosto"],
  sobrecosto_extremo: ["inversion_sobrecosto_extremo"],
  laudo: ["inversion_laudo"],
};

export const ESTADO_OBRA = { finalizada: "Finalizado", ejecucion: "En Ejecución", paralizada: "Paralizada", sin_ejecucion: "Sin Ejecución" } as const;
export const MODALIDAD_OBRA = {
  contrata: `o.modalidad = 'Contrata'`,
  directa: `o.modalidad = 'Administración directa'`,
  nucleo: `o.modalidad = 'Por núcleo ejecutor'`,
  impuestos: `o.modalidad = 'Obras por impuestos'`,
  otra: `o.modalidad NOT IN ('Contrata', 'Administración directa', 'Por núcleo ejecutor', 'Obras por impuestos')`,
} as const;
/** El costo de la obra: el del contrato y, sin contrato (administración directa), el del expediente técnico. */
const COSTO_OBRA = `COALESCE(NULLIF(o.contrato_monto, 0), NULLIF(o.costo_et, 0))`;
export const MONTO_OBRA = {
  hasta_1m: `${COSTO_OBRA} <= 1000000`,
  "1m_10m": `${COSTO_OBRA} > 1000000 AND ${COSTO_OBRA} <= 10000000`,
  mas_10m: `${COSTO_OBRA} > 10000000`,
  sin_monto: `${COSTO_OBRA} IS NULL`,
} as const;
export const MONTO_INVERSION = {
  hasta_1m: `i.costo_actualizado <= 1000000`,
  "1m_10m": `i.costo_actualizado > 1000000 AND i.costo_actualizado <= 10000000`,
  mas_10m: `i.costo_actualizado > 10000000`,
} as const;

/** `'{a,b}'::text[]` para `banderas` (jsonb): la fila tiene alguna bandera de esos tipos. */
const conTipos = (alias: string, tipos: readonly string[]) =>
  `EXISTS (SELECT 1 FROM jsonb_array_elements(${alias}.banderas) b WHERE b->>'tipo' IN (${tipos.map((t) => `'${t.replace(/[^a-z_]/g, "")}'`).join(", ")}))`;

export interface FiltrosObras {
  entidad?: string;
  empresa?: string;
  rol?: "ejecucion" | "supervision";
  q?: string;
  estado?: keyof typeof ESTADO_OBRA;
  bandera?: string;
  modalidad?: keyof typeof MODALIDAD_OBRA;
  monto?: keyof typeof MONTO_OBRA;
  anio?: number;
  contrato?: "con";
}

/** Palabras de la búsqueda: sin tildes, en minúsculas (como `texto`), de 3 letras o más, hasta 5. */
export function palabras(q: string | undefined): string[] {
  if (!q) return [];
  return q.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length >= 3).slice(0, 5);
}

type FacetaObra = "estado" | "bandera" | "modalidad" | "monto" | "anio" | "rol" | "contrato";

/**
 * Las condiciones de la lista de obras. `ancla` fija la entidad o la empresa (por su índice); el RUC (11 dígitos, ya
 * validado) va como literal, como en /ordenes: con un parámetro, Hyperdrive prepara la sentencia y el plan genérico podía
 * dejar el índice de lado. Una empresa: las obras que ejecuta o supervisa con su RUC, y las de un consorcio que integra
 * (el contrato del mismo CUI que ganó el consorcio, obra_contrato).
 */
export function condicionesObras(f: FiltrosObras, vals: unknown[]): { ancla: string; filtros: { faceta: FacetaObra | null; sql: string }[] } {
  const p = (v: unknown) => { vals.push(v); return `$${vals.length}`; };
  const ruc = (v: string) => { if (!/^\d{11}$/.test(v)) throw new Error("RUC inválido"); return `'${v}'`; };
  let ancla = "NOT o.retirada";
  if (f.entidad) ancla += ` AND o.entidad_ruc = ${ruc(f.entidad)}`;
  if (f.empresa) {
    // Una unión de tres búsquedas por índice (un OR con la subconsulta recorría las 191 mil obras).
    const r = ruc(f.empresa);
    ancla += ` AND o.codigo IN (SELECT x.codigo FROM obra_infobras x WHERE x.ejecutor_ruc = ${r}
                               UNION SELECT x.codigo FROM obra_infobras x WHERE x.supervisor_ruc = ${r}
                               UNION SELECT oc.codigo FROM obra_contrato oc JOIN conosce_consorcios cc ON cc.ruc_consorcio = oc.ruc
                                      WHERE oc.via = 'cui_consorcio' AND cc.ruc_miembro = ${r})`;
  }
  const filtros: { faceta: FacetaObra | null; sql: string }[] = [];
  if (f.empresa && f.rol) {
    const r = ruc(f.empresa);
    filtros.push({ faceta: "rol", sql: f.rol === "supervision" ? `o.supervisor_ruc = ${r}` : `o.supervisor_ruc IS DISTINCT FROM ${r}` });
  }
  if (f.estado && ESTADO_OBRA[f.estado]) filtros.push({ faceta: "estado", sql: `o.estado = '${ESTADO_OBRA[f.estado]}'` });
  if (f.bandera) {
    const sql = f.bandera === "con" ? `o.banderas <> '[]'::jsonb` : f.bandera === "alta" ? `o.severidad = 'alta'`
      : BANDERA_OBRA[f.bandera] ? conTipos("o", BANDERA_OBRA[f.bandera]) : null;
    if (sql) filtros.push({ faceta: "bandera", sql });
  }
  if (f.modalidad && MODALIDAD_OBRA[f.modalidad]) filtros.push({ faceta: "modalidad", sql: MODALIDAD_OBRA[f.modalidad] });
  if (f.monto && MONTO_OBRA[f.monto]) filtros.push({ faceta: "monto", sql: MONTO_OBRA[f.monto] });
  if (f.anio) filtros.push({ faceta: "anio", sql: `extract(year FROM o.fecha_inicio) = ${Number(f.anio)}` });
  if (f.contrato === "con") filtros.push({ faceta: "contrato", sql: `EXISTS (SELECT 1 FROM obra_contrato oc WHERE oc.codigo = o.codigo)` });
  for (const w of palabras(f.q)) filtros.push({ faceta: null, sql: `o.texto LIKE ${p(`%${w}%`)}` });
  return { ancla, filtros };
}

/** Las opciones con conteo de cada faceta (el año se agrupa aparte). */
function opcionesObra(f: FiltrosObras): Record<Exclude<FacetaObra, "anio">, Record<string, string>> {
  return {
    estado: Object.fromEntries(Object.entries(ESTADO_OBRA).map(([k, v]) => [k, `o.estado = '${v}'`])),
    bandera: {
      con: `o.banderas <> '[]'::jsonb`, alta: `o.severidad = 'alta'`,
      ...Object.fromEntries(Object.entries(BANDERA_OBRA).map(([k, t]) => [k, conTipos("o", t)])),
    },
    modalidad: { ...MODALIDAD_OBRA },
    monto: { ...MONTO_OBRA },
    contrato: { con: `EXISTS (SELECT 1 FROM obra_contrato oc WHERE oc.codigo = o.codigo)` },
    rol: f.empresa ? { ejecucion: `o.supervisor_ruc IS DISTINCT FROM '${f.empresa}'`, supervision: `o.supervisor_ruc = '${f.empresa}'` } : {},
  };
}

/**
 * Los conteos de los filtros de la lista de obras: cada opción con los DEMÁS filtros puestos (como Menores), en una
 * pasada sobre las obras del ancla (una entidad tiene a lo más unas miles). El año de inicio, agrupado.
 */
export function sqlFacetasObras(f: FiltrosObras): { sql: string; vals: unknown[] } {
  const vals: unknown[] = [];
  const { ancla, filtros } = condicionesObras(f, vals);
  const ops = opcionesObra(f);
  const lista = (Object.entries(ops) as [FacetaObra, Record<string, string>][]).flatMap(([fa, o]) => Object.entries(o).map(([k, sql]) => ({ faceta: fa, clave: k, sql })));
  const sin = (fa: FacetaObra) => filtros.map((x, i) => (x.faceta !== fa ? `y.f${i}` : null)).filter(Boolean) as string[];
  const y = [...filtros.map((x, i) => `(${x.sql}) AS f${i}`), ...lista.map((o, j) => `(${o.sql}) AS o${j}`), `extract(year FROM o.fecha_inicio)::int AS anio`];
  const cols = lista.map((o, j) => `count(*) FILTER (WHERE ${[...sin(o.faceta), `y.o${j}`].join(" AND ")})::int AS "${o.faceta}:${o.clave}"`);
  const conAnio = sin("anio");
  const anio = `(SELECT COALESCE(jsonb_object_agg(a.anio, a.n), '{}'::jsonb) FROM (SELECT y.anio, count(*)::int AS n FROM y
                 WHERE ${[...conAnio, "y.anio IS NOT NULL"].join(" AND ")} GROUP BY 1) a) AS "anio"`;
  const total = `count(*) FILTER (WHERE ${filtros.length ? filtros.map((_, i) => `y.f${i}`).join(" AND ") : "true"})::int AS "total"`;
  return {
    sql: `WITH y AS MATERIALIZED (SELECT ${y.join(", ")} FROM obra_infobras o WHERE ${ancla})
          SELECT ${[total, ...cols, anio].join(",\n ")} FROM y`,
    vals,
  };
}

export const ORDEN_OBRA = {
  reciente: `o.fecha_inicio DESC NULLS LAST, o.codigo DESC`,
  antiguo: `o.fecha_inicio ASC NULLS LAST, o.codigo`,
  monto: `${COSTO_OBRA} DESC NULLS LAST, o.codigo DESC`,
} as const;

export function sqlListaObras(f: FiltrosObras, orden: keyof typeof ORDEN_OBRA, page: number, size: number): { sql: string; vals: unknown[] } {
  const vals: unknown[] = [];
  const { ancla, filtros } = condicionesObras(f, vals);
  const where = [ancla, ...filtros.map((x) => x.sql)].join(" AND ");
  return {
    sql: `SELECT ${COLS_OBRA}, ${CONTRATOS_DE_OBRA} AS contratos FROM obra_infobras o WHERE ${where}
          ORDER BY ${ORDEN_OBRA[orden] ?? ORDEN_OBRA.reciente} LIMIT ${Math.max(1, Math.min(50, size))} OFFSET ${Math.max(0, (page - 1) * size)}`,
    vals,
  };
}

export interface FiltrosInversiones {
  entidad?: string;
  q?: string;
  estado?: "activa" | "cerrada";
  bandera?: string;
  funcion?: string;
  monto?: keyof typeof MONTO_INVERSION;
  contrato?: "con";
}
type FacetaInversion = "estado" | "bandera" | "monto" | "contrato" | "funcion";

export function condicionesInversiones(f: FiltrosInversiones, vals: unknown[]): { ancla: string; filtros: { faceta: FacetaInversion | null; sql: string }[] } {
  const p = (v: unknown) => { vals.push(v); return `$${vals.length}`; };
  if (f.entidad && !/^\d{11}$/.test(f.entidad)) throw new Error("RUC inválido");
  const ancla = `NOT i.retirada${f.entidad ? ` AND i.entidad_ruc = '${f.entidad}'` : ""}`;
  const filtros: { faceta: FacetaInversion | null; sql: string }[] = [];
  if (f.estado) filtros.push({ faceta: "estado", sql: `i.origen = '${f.estado === "cerrada" ? "cerrada" : "activa"}'` });
  if (f.bandera) {
    const sql = f.bandera === "con" ? `i.banderas <> '[]'::jsonb` : BANDERA_INVERSION[f.bandera] ? conTipos("i", BANDERA_INVERSION[f.bandera]) : null;
    if (sql) filtros.push({ faceta: "bandera", sql });
  }
  if (f.funcion) filtros.push({ faceta: "funcion", sql: `i.funcion = ${p(f.funcion)}` });
  if (f.monto && MONTO_INVERSION[f.monto]) filtros.push({ faceta: "monto", sql: MONTO_INVERSION[f.monto] });
  if (f.contrato === "con") filtros.push({ faceta: "contrato", sql: `EXISTS (SELECT 1 FROM contrato_cui k WHERE k.cui = i.cui)` });
  for (const w of palabras(f.q)) filtros.push({ faceta: null, sql: `i.texto LIKE ${p(`%${w}%`)}` });
  return { ancla, filtros };
}

export function sqlFacetasInversiones(f: FiltrosInversiones): { sql: string; vals: unknown[] } {
  const vals: unknown[] = [];
  const { ancla, filtros } = condicionesInversiones(f, vals);
  const ops: Record<Exclude<FacetaInversion, "funcion">, Record<string, string>> = {
    estado: { activa: `i.origen = 'activa'`, cerrada: `i.origen = 'cerrada'` },
    bandera: { con: `i.banderas <> '[]'::jsonb`, ...Object.fromEntries(Object.entries(BANDERA_INVERSION).map(([k, t]) => [k, conTipos("i", t)])) },
    monto: { ...MONTO_INVERSION },
    contrato: { con: `EXISTS (SELECT 1 FROM contrato_cui k WHERE k.cui = i.cui)` },
  };
  const lista = (Object.entries(ops) as [FacetaInversion, Record<string, string>][]).flatMap(([fa, o]) => Object.entries(o).map(([k, sql]) => ({ faceta: fa, clave: k, sql })));
  const sin = (fa: FacetaInversion) => filtros.map((x, i) => (x.faceta !== fa ? `y.f${i}` : null)).filter(Boolean) as string[];
  const y = [...filtros.map((x, i) => `(${x.sql}) AS f${i}`), ...lista.map((o, j) => `(${o.sql}) AS o${j}`), `i.funcion AS funcion`];
  const cols = lista.map((o, j) => `count(*) FILTER (WHERE ${[...sin(o.faceta), `y.o${j}`].join(" AND ")})::int AS "${o.faceta}:${o.clave}"`);
  const conFuncion = sin("funcion");
  const funcion = `(SELECT COALESCE(jsonb_object_agg(a.funcion, a.n), '{}'::jsonb) FROM (SELECT y.funcion, count(*)::int AS n FROM y
                    WHERE ${[...conFuncion, "y.funcion IS NOT NULL"].join(" AND ")} GROUP BY 1) a) AS "funcion"`;
  const total = `count(*) FILTER (WHERE ${filtros.length ? filtros.map((_, i) => `y.f${i}`).join(" AND ") : "true"})::int AS "total"`;
  return {
    sql: `WITH y AS MATERIALIZED (SELECT ${y.join(", ")} FROM inversion_mef i WHERE ${ancla})
          SELECT ${[total, ...cols, funcion].join(",\n ")} FROM y`,
    vals,
  };
}

export const ORDEN_INVERSION = {
  reciente: `i.fecha_viabilidad DESC NULLS LAST, i.cui DESC`,
  antiguo: `i.fecha_viabilidad ASC NULLS LAST, i.cui`,
  monto: `i.costo_actualizado DESC NULLS LAST, i.cui DESC`,
} as const;

export function sqlListaInversiones(f: FiltrosInversiones, orden: keyof typeof ORDEN_INVERSION, page: number, size: number): { sql: string; vals: unknown[] } {
  const vals: unknown[] = [];
  const { ancla, filtros } = condicionesInversiones(f, vals);
  const where = [ancla, ...filtros.map((x) => x.sql)].join(" AND ");
  return {
    sql: `SELECT ${COLS_INVERSION}, ${CONTRATOS_DE_INVERSION} AS contratos, ${OBRAS_DE_INVERSION} AS obras FROM inversion_mef i WHERE ${where}
          ORDER BY ${ORDEN_INVERSION[orden] ?? ORDEN_INVERSION.reciente} LIMIT ${Math.max(1, Math.min(50, size))} OFFSET ${Math.max(0, (page - 1) * size)}`,
    vals,
  };
}

/** {"estado:finalizada": 3, …, anio: {"2019": 4}} → { estado: { finalizada: 3 }, anio: { 2019: 4 } }. */
export function facetasDe(fila: Record<string, unknown> | undefined, agrupadas: string[]): { total: number | null; facetas: Record<string, Record<string, number>> | null } {
  if (!fila) return { total: null, facetas: null };
  const facetas: Record<string, Record<string, number>> = {};
  for (const [k, v] of Object.entries(fila)) {
    if (k === "total") continue;
    if (agrupadas.includes(k)) { facetas[k] = (v ?? {}) as Record<string, number>; continue; }
    const [faceta, opcion] = k.split(":");
    (facetas[faceta] ??= {})[opcion] = Number(v ?? 0);
  }
  return { total: Number(fila.total ?? 0), facetas };
}

// ─── La ficha del contrato ───────────────────────────────────────────────────

/** El día del último archivo de INFOBRAS (obra_refresco): las banderas cuentan los días de paralización hasta ahí. */
export async function diaInfobras(): Promise<string | null> {
  const r = await pool.query(`SELECT to_char((valor AT TIME ZONE 'America/Lima')::date, 'YYYY-MM-DD') AS dia FROM obra_refresco WHERE clave = 'infobras_fecha'`)
    .catch(() => null);
  return r?.rows[0]?.dia ?? null;
}

/**
 * La obra de INFOBRAS que ejecuta o supervisa el contrato (obra_contrato) y la inversión de su CUI (contrato_cui), para la
 * pestaña «Adjudicación y contrato» de su ficha. Sin la migración 160, vacío.
 */
export async function obraDelContrato(ocid: string): Promise<{ obras: (ObraPublica & { rol: string; via: string })[]; inversiones: (InversionPublica & { origenCui: string })[] }> {
  const [o, i] = await Promise.all([
    pool.query(`SELECT ${COLS_OBRA}, oc.rol, oc.via FROM obra_contrato oc JOIN obra_infobras o ON o.codigo = oc.codigo
                 WHERE oc.ocid = $1 ORDER BY oc.rol, o.codigo LIMIT 20`, [ocid]).catch(() => null),
    pool.query(`SELECT ${COLS_INVERSION}, k.origen AS origen_cui, ${OBRAS_DE_INVERSION} AS obras
                  FROM contrato_cui k JOIN inversion_mef i ON i.cui = k.cui WHERE k.ocid = $1 ORDER BY i.costo_actualizado DESC NULLS LAST LIMIT 10`, [ocid]).catch(() => null),
  ]);
  return {
    obras: (o?.rows ?? []).map((r) => ({ ...aObra(r), rol: r.rol, via: r.via })),
    inversiones: (i?.rows ?? []).map((r) => ({ ...aInversion(r), origenCui: r.origen_cui })),
  };
}

/**
 * Cuántas obras e inversiones tiene una entidad y cuántas con cada bandera: el número de su pestaña «Obras» y las líneas
 * de su Inicio. Una pasada por tabla, por el índice de la entidad.
 */
export function sqlResumenEntidad(ruc: string): string {
  if (!/^\d{11}$/.test(ruc)) throw new Error("RUC inválido");
  const r = `'${ruc}'`;
  const porBandera = (alias: string, filtros: Record<string, readonly string[]>) =>
    `jsonb_build_object(${Object.entries(filtros).map(([k, t]) => `'${k}', count(*) FILTER (WHERE ${conTipos(alias, t)})`).join(", ")})`;
  return `SELECT
     (SELECT jsonb_build_object('total', count(*), 'con', count(*) FILTER (WHERE o.banderas <> '[]'::jsonb),
                                'alta', count(*) FILTER (WHERE o.severidad = 'alta'),
                                'enObra', count(*) FILTER (WHERE o.estado IN ('En Ejecución', 'Paralizada')),
                                'conContrato', count(*) FILTER (WHERE EXISTS (SELECT 1 FROM obra_contrato oc WHERE oc.codigo = o.codigo)),
                                'porBandera', ${porBandera("o", BANDERA_OBRA)})
        FROM obra_infobras o WHERE NOT o.retirada AND o.entidad_ruc = ${r}) AS obras,
     (SELECT jsonb_build_object('total', count(*), 'con', count(*) FILTER (WHERE i.banderas <> '[]'::jsonb),
                                'activas', count(*) FILTER (WHERE i.origen = 'activa'),
                                'porBandera', ${porBandera("i", BANDERA_INVERSION)})
        FROM inversion_mef i WHERE NOT i.retirada AND i.entidad_ruc = ${r}) AS inversiones`;
}
