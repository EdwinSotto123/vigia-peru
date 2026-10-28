/**
 * Planilla (GET /planilla, migración 92): el personal que cada entidad publica en su Portal de Transparencia, con sus
 * señales. Plazas CAS (GET /plazas, migración 93): las convocatorias que publicó en SERVIR Talento Perú, con las suyas.
 * La API ya tapa el apellido materno y a quienes nombran las señales. Las señales son indicios, no pruebas.
 */
import { API_BASE } from "./api-client";
import { tituloNatural } from "./landing";
import type { FichaPersona, Severidad } from "./personas";

export const TIPOS_PLANILLA = ["tambien_ordenes", "pariente_locador", "pariente_planilla", "familiar_en_planilla", "doble_planilla", "socio_proveedor", "financio_campana", "candidato_gobierna", "aporte_gobierna", "brecha_cargo", "ascenso_expres", "apellidos_autoridad", "apellidos_directivo", "antes_locador", "pago_extraordinario", "es_autoridad"] as const;
export type TipoPlanilla = (typeof TIPOS_PLANILLA)[number];
// Sin «sueldo alto»: no se calcula desde la migración 95, y un filtro que nunca encuentra nada no se ofrece.
export const TIPOS_PLAZA = ["pide_experiencia_propia", "pide_poco", "plazo_corto", "ya_hay_locadores", "gestion_saliente"] as const;
export type TipoPlaza = (typeof TIPOS_PLAZA)[number];

export interface SenalConDetalle<T extends string> {
  tipo: T;
  severidad: Severidad;
  detalle: Record<string, unknown>;
}

export interface PersonaPlanilla {
  entidadRuc: string;
  entidad: string | null;
  /** Con el apellido materno tapado. */
  nombre: string;
  regimen: number | null;
  cargo: string | null;
  dependencia: string | null;
  /** Lo que cobró el último mes, con todo. */
  total: number | null;
  /** Su sueldo: remuneraciones + honorarios (migración 98). */
  base: number | null;
  /** Fuera del sueldo: otros beneficios, gratificación, incentivo. */
  extra: number | null;
  meses: number;
  primerMes: string | null;
  ultimoMes: string | null;
  senales: SenalConDetalle<TipoPlanilla>[];
  nSenales: number;
  /** Su ficha de persona contratada, si también recibe órdenes de servicio. */
  codigo: string | null;
  /** Su ficha de planilla (migración 107): /app/personas/planilla/<ficha>. */
  ficha?: string | null;
  /** Lo que cobró cada mes cargado (línea de tiempo de sueldos): sueldo, fuera del sueldo, total y si es un posible error. */
  historia?: { mes: string; base: number | null; extra: number; total: number | null; dudoso: boolean; filas: number }[];
  /** Un posible error de carga del Estado en su último mes (migración 102): no entra en sumas, medianas ni señales. */
  dudoso: { motivo: string; base: number | null; extra: number | null; total: number | null; anio: number; mes: number } | null;
  /** Declaró en su DJI a un pariente que es locador de su misma entidad (su ficha lo cita). */
  parienteLocador?: boolean;
}

export interface ResumenPlanilla {
  personas: number;
  totalMes: number;
  conSenales: number;
  alta: number;
  media: number;
  ultimoMes: string | null;
  porSenal: { tipo: TipoPlanilla; n: number }[];
  porRegimen: { regimen: number | null; n: number }[];
  /** Cuántos con un posible error de carga (no se suman en `totalMes`). */
  dudosos?: number;
}

export interface PaginaPlanilla {
  total: number;
  page: number;
  size: number;
  data: PersonaPlanilla[];
  resumen: ResumenPlanilla;
  /** Las opciones de los filtros que dependen del alcance (null si no se pudieron leer). */
  facetas?: FacetasPlanilla | null;
}

/**
 * Lo que dan los filtros en este alcance: cuántos declararon a un pariente locador y, en una entidad, sus oficinas y
 * cargos (los 500 con más personas, en mayúsculas) y cuántos caen en cada tramo de sueldo.
 */
export interface FacetasPlanilla {
  pariente: number;
  oficinas: { valor: string; n: number }[] | null;
  cargos: { valor: string; n: number }[] | null;
  tramos: { sueldo: Record<string, number>; antiguedad?: Record<string, number> } | null;
  /** En una entidad: cuántos tienen un cargo de jefatura. */
  jefatura?: number | null;
}

/** Cuántos meses lleva en la planilla desde que se carga (enero de 2025): lo que se ve en los datos, no su antigüedad. */
export const ANTIGUEDAD_PLANILLA = [
  { valor: "1", etiqueta: "Un mes" },
  { valor: "2a6", etiqueta: "De 2 a 6 meses" },
  { valor: "7a12", etiqueta: "De 7 a 12 meses" },
  { valor: "13mas", etiqueta: "13 meses o más" },
] as const;

/** El sueldo del último mes (sin gratificaciones ni liquidaciones), por tramos; uno con posible error no cae en ninguno. */
export const SUELDOS_PLANILLA = [
  { valor: "menos3", etiqueta: "Menos de S/ 3 mil" },
  { valor: "3a5", etiqueta: "De S/ 3 mil a 5 mil" },
  { valor: "5a10", etiqueta: "De S/ 5 mil a 10 mil" },
  { valor: "10a20", etiqueta: "De S/ 10 mil a 20 mil" },
  { valor: "mas20", etiqueta: "S/ 20 mil o más" },
] as const;

export interface Plaza {
  aviso: number;
  titulo: string;
  entidad: string;
  entidadRuc: string | null;
  ubicacion: string | null;
  numero: string | null;
  vacantes: number | null;
  remuneracion: number | null;
  fechaInicio: string | null;
  fechaFin: string | null;
  experiencia: string | null;
  formacion: string | null;
  especializacion: string | null;
  conocimiento: string | null;
  servicio: string | null;
  expGeneral: number | null;
  detalleUrl: string | null;
  senales: SenalConDetalle<TipoPlaza>[];
  nSenales: number;
}

export interface ResumenPlazas {
  plazas: number;
  vacantes: number;
  conSenales: number;
  /** Por la señal más grave. Opcionales: una respuesta guardada de antes no los trae. */
  alta?: number;
  media?: number;
  baja?: number;
  /** Con la postulación abierta hoy. */
  abiertas?: number;
  /** Cuántas caen en cada tramo de los filtros (sueldo, experiencia, vacantes). */
  tramos?: Record<"sueldo" | "experiencia" | "vacantes", Record<string, number>>;
  medianaSueldo: number | null;
  desde: string | null;
  porSenal: { tipo: TipoPlaza; n: number }[];
}

/** Los tramos de las plazas (los mismos de la API, `TRAMOS_PLAZA`). La experiencia sin un dato que se lea no cae en ninguno. */
export const TRAMOS_PLAZA: Record<"sueldo" | "experiencia" | "vacantes", readonly { valor: string; etiqueta: string }[]> = {
  sueldo: [
    { valor: "menos2500", etiqueta: "Menos de S/ 2,500" },
    { valor: "2500a4000", etiqueta: "De S/ 2,500 a 4,000" },
    { valor: "4000a6000", etiqueta: "De S/ 4,000 a 6,000" },
    { valor: "6000a10000", etiqueta: "De S/ 6,000 a 10,000" },
    { valor: "mas10000", etiqueta: "S/ 10,000 o más" },
  ],
  experiencia: [
    { valor: "menos1", etiqueta: "Menos de 1 año" },
    { valor: "1a3", etiqueta: "De 1 a 3 años" },
    { valor: "mas3", etiqueta: "3 años o más" },
  ],
  vacantes: [
    { valor: "una", etiqueta: "Una sola" },
    { valor: "varias", etiqueta: "Dos o más" },
  ],
};

export interface PaginaPlazas {
  total: number;
  page: number;
  size: number;
  data: Plaza[];
  resumen: ResumenPlazas;
}

export const REGIMEN: Record<number, string> = {
  1: "CAS", 2: "Régimen 276", 3: "Régimen 728 y otros", 4: "PAC", 5: "FAG", 6: "PNUD", 7: "Alto funcionario", 9: "Ley Servir",
};

/** La familia de cada señal de la planilla, para agrupar su desplegable (como GRUPO_SENAL en las personas). */
export const GRUPOS_PLANILLA = ["Política", "Familia y conflictos", "Cómo se le paga"] as const;
export const GRUPO_PLANILLA: Record<TipoPlanilla, (typeof GRUPOS_PLANILLA)[number]> = {
  financio_campana: "Política", candidato_gobierna: "Política", aporte_gobierna: "Política", es_autoridad: "Política",
  pariente_locador: "Familia y conflictos", pariente_planilla: "Familia y conflictos", familiar_en_planilla: "Familia y conflictos",
  socio_proveedor: "Familia y conflictos", apellidos_autoridad: "Familia y conflictos",
  apellidos_directivo: "Familia y conflictos",
  tambien_ordenes: "Cómo se le paga", doble_planilla: "Cómo se le paga", brecha_cargo: "Cómo se le paga", pago_extraordinario: "Cómo se le paga",
  antes_locador: "Cómo se le paga", ascenso_expres: "Cómo se le paga",
};

export const SENAL_PLANILLA: Record<TipoPlanilla, { corto: string; titulo: string; explica: string }> = {
  tambien_ordenes: {
    corto: "Cobra también por órdenes",
    titulo: "Está en la planilla y además recibe órdenes de servicio",
    explica: "El mismo mes en que figura en la planilla, la misma entidad le dio órdenes de servicio. Cobrar dos veces del Estado está prohibido, salvo por docencia.",
  },
  pariente_locador: {
    corto: "Pariente locador",
    titulo: "Declaró en su DJI a un pariente que es locador de su entidad",
    explica:
      "Declaró en su Declaración Jurada de Intereses a un pariente que es locador (proveedor) de esta misma entidad. Del pariente sólo se dice el parentesco y lo que cobró, nunca quién es. Es un indicio de posible nepotismo para revisión, no una acusación.",
  },
  pariente_planilla: {
    corto: "Pariente de un funcionario",
    titulo: "Un funcionario de su entidad lo declaró como pariente",
    explica:
      "Un funcionario de esta misma entidad lo declaró como pariente en su Declaración Jurada de Intereses, y figura en la planilla. La Ley 26771 prohíbe a quien tiene poder de nombrar o contratar hacerlo con sus parientes en su entidad. Coincide por el nombre completo (la planilla no publica el DNI) y sólo con apellidos que no son de los más comunes. Del funcionario se muestra su cargo y, cuando no destapa el apellido tapado de esta persona, su primer apellido. Es un indicio para revisar, no una acusación.",
  },
  familiar_en_planilla: {
    corto: "Familiar en su planilla",
    titulo: "Declaró a un pariente que trabaja en su misma entidad",
    explica:
      "En su Declaración Jurada de Intereses declaró a un pariente que figura en la planilla de esta misma entidad. Del pariente sólo se dice el parentesco y su cargo, nunca quién es. La Ley 26771 prohíbe nombrar o contratar a parientes en la propia entidad a quien tiene ese poder: es un indicio para revisar, no una acusación.",
  },
  ascenso_expres: {
    corto: "Ascenso exprés",
    titulo: "Pasó a una jefatura y su sueldo subió mucho en pocos meses",
    explica:
      "En 12 meses o menos pasó de un cargo que no es de jefatura a uno de jefatura (jefe, director, gerente, coordinador, administrador) y su sueldo base subió 1,5 veces o más (y al menos S/ 2,000), y se mantuvo el mes siguiente. Ascender no es una falta: un salto así, rápido, es un dato para revisar junto a sus otras señales. No se cuenta su primer mes (suele venir pagado por días) ni los meses con un posible error de carga.",
  },
  doble_planilla: {
    corto: "En dos planillas a la vez",
    titulo: "Cobra sueldo en dos entidades el mismo mes",
    explica:
      "Figura con sueldo en la planilla de otra entidad del mismo departamento en los mismos meses. Cobrar dos remuneraciones del Estado está prohibido, salvo por docencia o por dietas de directorio (Ley 28175, art. 3). No se cuentan los cargos de docencia, el residentado médico, los jurados electorales, los gerentes públicos de SERVIR ni dos oficinas de una misma entidad. Coincide por el nombre completo (la planilla no publica el DNI), de cuatro palabras o más, que sólo aparece en esas dos entidades y con apellidos poco comunes. Aun así, puede ser un homónimo o un cambio de trabajo: por eso se piden dos meses o más.",
  },
  socio_proveedor: {
    corto: "Socio de un proveedor",
    titulo: "Es socio o representante de una empresa que le vende a su entidad",
    explica:
      "Según el RNP es socio, representante o directivo de una empresa que le vendió a la misma entidad donde trabaja (órdenes o contratos). Es un conflicto de interés a revisar: quien trabaja en la entidad no debe intervenir en las compras a su empresa. Coincide por el nombre completo (la planilla no publica el DNI), que en el RNP es de una sola persona y cuyos apellidos no son de los más comunes.",
  },
  financio_campana: {
    corto: "Financió la campaña del que gobierna",
    titulo: "Aportó a la campaña del que gobierna y está en su planilla",
    explica:
      "Aportó dinero (ONPE) a la campaña de la organización política en la elección que la llevó a gobernar la entidad (en un ministerio, al partido del Presidente) y figura en la planilla de ese gobierno. Coincide por el nombre completo (la planilla no trae DNI) y sólo si ese nombre es de una sola persona entre los aportantes. Aportar es legal: es un dato para revisar.",
  },
  aporte_gobierna: {
    corto: "Aportó al que gobierna",
    titulo: "Aportó al partido que gobierna la entidad",
    explica:
      "Aportó dinero (ONPE) al partido o movimiento que gobierna la entidad (en un ministerio, al partido del Presidente). Coincide por el nombre completo, sólo si es de una sola persona entre los aportantes. Aportar es legal: es un dato para revisar.",
  },
  candidato_gobierna: {
    corto: "Candidato del que gobierna",
    titulo: "Fue candidato del partido que gobierna la entidad",
    explica: "Postuló (JNE) por el partido que gobierna la entidad. Coincide por nombre completo y departamento: la planilla no trae DNI.",
  },
  brecha_cargo: {
    corto: "Gana el doble que su cargo",
    titulo: "Gana el doble o más que otros con su mismo cargo",
    explica:
      "Su sueldo (sin gratificaciones, liquidaciones ni otros beneficios del mes) es el doble o más que la mediana de quienes tienen su mismo cargo en la misma entidad, y muy pocos con ese cargo ganan tanto (10 o menos): no es otro nivel de la escala.",
  },
  es_autoridad: {
    corto: "Autoridad electa de la entidad",
    titulo: "Es autoridad electa de esta entidad",
    explica:
      "Es el alcalde, un regidor, el gobernador o un consejero del gobierno de la entidad (JNE), en su mandato: por eso figura en su planilla. Es un dato, no una falta.",
  },
  pago_extraordinario: {
    corto: "Pago extraordinario",
    titulo: "Recibió un pago grande fuera de su sueldo",
    explica:
      "Ese mes cobró S/ 20,000 o más en otros beneficios, gratificación o incentivo, el triple de su sueldo o más: suele ser una liquidación, un retiro incentivado o un bono. No es irregular por sí mismo.",
  },
  apellidos_autoridad: {
    corto: "Comparte apellidos con una autoridad",
    titulo: "Tiene los dos apellidos de una autoridad de la entidad",
    explica: "Sus dos apellidos son los del alcalde, un regidor, el gobernador o un consejero del gobierno de la entidad. No prueba parentesco.",
  },
  apellidos_directivo: {
    corto: "Comparte apellidos con un directivo",
    titulo: "Tiene los dos apellidos de un directivo de la misma planilla",
    explica: "Sus dos apellidos, poco comunes, son los de un gerente, director o jefe de la misma entidad. No prueba parentesco.",
  },
  antes_locador: {
    corto: "Antes fue locador",
    titulo: "Antes de entrar a la planilla fue locador de la entidad",
    explica: "Recibió órdenes de servicio de la misma entidad antes de aparecer en su planilla.",
  },
};

/** De dónde sale cada señal de la planilla (el pie de su evidencia) y, en corto, la línea de la señal. */
export function fuentePlanilla(tipo: TipoPlanilla | "nepotismo"): { texto: string; corto: string; url: string | null } {
  if (tipo === "candidato_gobierna") return { texto: "JNE, candidaturas", corto: "JNE", url: "https://plataformaelectoral.jne.gob.pe/" };
  if (tipo === "pariente_locador")
    return { texto: "Contraloría, declaraciones juradas de intereses, y OECE, CONOSCE (órdenes)", corto: "Contraloría, DJI", url: "https://appdji.contraloria.gob.pe/DJIC/" };
  if (tipo === "doble_planilla")
    return { texto: "Portal de Transparencia Estándar, planillas de las dos entidades", corto: "Portal de Transparencia", url: "https://www.transparencia.gob.pe/" };
  if (tipo === "socio_proveedor")
    return { texto: "OECE, RNP (socios y representantes) y CONOSCE (órdenes y adjudicaciones)", corto: "RNP y CONOSCE", url: "https://www.gob.pe/oece" };
  if (tipo === "financio_campana" || tipo === "aporte_gobierna")
    return { texto: "ONPE, Claridad (aportes a organizaciones políticas)", corto: "ONPE", url: "https://claridad.onpe.gob.pe/" };
  if (tipo === "apellidos_autoridad" || tipo === "es_autoridad") return { texto: "JNE, autoridades electas", corto: "JNE", url: "https://plataformaelectoral.jne.gob.pe/" };
  if (tipo === "tambien_ordenes" || tipo === "antes_locador")
    return { texto: "OECE, CONOSCE (órdenes) y Portal de Transparencia (planilla)", corto: "CONOSCE y Portal de Transparencia", url: null };
  if (tipo === "nepotismo")
    return { texto: "Contraloría, declaraciones juradas de intereses, y OECE, CONOSCE (órdenes)", corto: "Contraloría, DJI", url: "https://appdji.contraloria.gob.pe/DJIC/" };
  return { texto: "Portal de Transparencia Estándar, personal", corto: "Portal de Transparencia", url: "https://www.transparencia.gob.pe/" };
}

// ─── Meses ─────────────────────────────────────────────────────────────────────────────────────

/** "2026-09" o "2026-09-01" → "set. 2026" (el mes como lo escribe una tabla, §10.3). Null si no es un mes. */
export function mes(m: string | null | undefined): string | null {
  const x = /^(\d{4})-(\d{2})/.exec(m ?? "");
  if (!x) return null;
  const [a, n] = [Number(x[1]), Number(x[2])];
  if (n < 1 || n > 12) return null;
  return new Intl.DateTimeFormat("es-PE", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(a, n - 1, 1)));
}

/** El mes sin el año ("set."), para un rango del mismo año (solo, Intl lo escribe con mayúscula: "Mar."). */
const mesSolo = (m: string) => {
  const x = /^(\d{4})-(\d{2})/.exec(m);
  return x
    ? new Intl.DateTimeFormat("es-PE", { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(Number(x[1]), Number(x[2]) - 1, 1))).toLocaleLowerCase("es")
    : m;
};

/** "mar. a set. 2026", "nov. 2025 a set. 2026" o "set. 2026"; null sin meses. */
export function periodoMeses(desde: string | null | undefined, hasta: string | null | undefined): string | null {
  const a = mes(desde);
  const b = mes(hasta);
  if (!a || !b) return a ?? b;
  if (desde!.slice(0, 7) === hasta!.slice(0, 7)) return b;
  return desde!.slice(0, 4) === hasta!.slice(0, 4) ? `${mesSolo(desde!)} a ${b}` : `${a} a ${b}`;
}

/** Una lista de meses ("2026-03", "2026-04") en palabras: "mar. 2026 y abr. 2026". */
export function listaMeses(meses: readonly unknown[] | null | undefined): string | null {
  const xs = [...new Set((meses ?? []).map((m) => (typeof m === "string" ? m.slice(0, 7) : "")).filter((m) => /^\d{4}-\d{2}$/.test(m)))].sort();
  const t = xs.map((m) => mes(m)!).filter(Boolean);
  if (!t.length) return null;
  return t.length === 1 ? t[0] : `${t.slice(0, -1).join(", ")} y ${t[t.length - 1]}`;
}

/**
 * El nombre de un partido como lo escribe el JNE o la ONPE (en mayúsculas), legible: "PARTIDO POPULAR CRISTIANO - PPC"
 * → "Partido Popular Cristiano - PPC" (la sigla tras el guion se respeta; `tituloNatural` la dejaba "Ppc").
 */
export function nombrePartido(v: unknown): string | null {
  const t = texto(v);
  if (!t) return null;
  const [nombre, ...siglas] = t.split(/\s+-\s+/);
  return [tituloNatural(nombre), ...siglas.map((x) => (x.length <= 8 && x === x.toLocaleUpperCase("es") ? x : tituloNatural(x)))].join(" - ");
}

/** Un cargo dentro de una oración: "REGIDOR PROVINCIAL" → "regidor provincial" (o "Regidor provincial" al comienzo). */
export function cargoEnOracion(v: unknown, inicio = false): string | null {
  const t = texto(v);
  if (!t) return null;
  const baja = tituloNatural(t).toLocaleLowerCase("es");
  return inicio ? baja.charAt(0).toLocaleUpperCase("es") + baja.slice(1) : baja;
}

// ─── Nepotismo, del lado del funcionario ───────────────────────────────────────────────────────

/** Una orden de servicio citada como evidencia (la misma forma en que la API cita las de `nepotismo` e `inhabilitado`). */
export interface OrdenCitada {
  fecha: string | null;
  numero: string | null;
  orden: string | null;
  descripcion: string | null;
  entidad: string | null;
  monto: number | null;
  servicio: string | null;
  estado: string | null;
  tipoContratacion: string | null;
}

export interface ParienteProveedor {
  grado: string;
  /** Con un apellido tapado, como llega de la API. */
  nombre: string;
  /** Su ficha de persona contratada. */
  codigo: string | null;
  /** Las órdenes que le dio la entidad, una por una (de su ficha); null si no se pudo leer. */
  ordenes: OrdenCitada[] | null;
  /** Cuántas y cuánto: lo que se lista cuando hay órdenes; si no, el cruce de la DJI. */
  n: number;
  monto: number;
  anios: number[];
}

const texto = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
const numeroDe = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);

/** Las órdenes de `ordenes_detalle` (la evidencia que la API ya adjunta a la señal) con sus tipos. */
export function ordenesCitadas(v: unknown): OrdenCitada[] {
  if (!Array.isArray(v)) return [];
  return (v.filter((x) => x && typeof x === "object") as Record<string, unknown>[]).map((o) => ({
    fecha: texto(o.fecha),
    numero: texto(o.numero) ?? texto(o.orden),
    orden: texto(o.orden),
    descripcion: texto(o.descripcion),
    entidad: texto(o.entidad),
    monto: numeroDe(o.monto),
    servicio: texto(o.servicio),
    estado: texto(o.estado),
    tipoContratacion: texto(o.tipoContratacion),
  }));
}

/**
 * Los parientes que esta persona declaró en su DJI y que le venden a su entidad, cada uno con las órdenes concretas que
 * la entidad le dio: salen de la ficha del pariente (su señal `nepotismo` en esta entidad trae `ordenes_detalle`, una
 * por una, sin las anuladas), así la cuenta es la de las órdenes que se listan. El cruce de la vista `dji_nepotismo`
 * sólo se usa si esa ficha no se pudo leer.
 */
export function parientesProveedores(f: FichaPlanilla, fichas: (FichaPersona | null)[]): ParienteProveedor[] {
  return f.nepotismo.map((x, i) => {
    const ficha = fichas[i];
    const ent = ficha?.entidades.find((e) => e.entidadRuc === f.persona.entidadRuc);
    const senal = ent?.senalesDetalle.find((s) => s.tipo === "nepotismo");
    const ordenes = senal ? ordenesCitadas(senal.detalle?.ordenes_detalle) : null;
    const conOrdenes = ordenes && ordenes.length > 0;
    const anios = conOrdenes
      ? [...new Set(ordenes!.map((o) => Number(o.fecha?.slice(0, 4))).filter((a) => a > 2000))].sort((a, b) => a - b)
      : ent?.anios ?? [];
    return {
      grado: x.grado,
      nombre: x.proveedorNombre,
      codigo: x.proveedorCodigo,
      ordenes: conOrdenes ? ordenes : null,
      n: conOrdenes ? ordenes!.length : ent?.ordenes ?? x.ordenes,
      monto: conOrdenes ? ordenes!.reduce((t, o) => t + (o.monto ?? 0), 0) : ent?.monto ?? x.monto,
      anios,
    };
  });
}

export const SENAL_PLAZA: Record<TipoPlaza, { corto: string; titulo: string; explica: string }> = {
  pide_experiencia_propia: {
    corto: "Pide experiencia en la entidad",
    titulo: "Pide experiencia en la misma entidad que convoca",
    explica: "Sólo la tiene quien ya trabaja ahí: es una forma de hacer la plaza a la medida de alguien.",
  },
  pide_poco: {
    corto: "Paga mucho, pide poco",
    titulo: "Paga S/ 6,000 o más y pide muy poco",
    explica: "Pide menos de un año de experiencia o ningún grado académico para un sueldo alto.",
  },
  plazo_corto: {
    corto: "Plazo corto",
    titulo: "Estuvo publicada 3 días o menos",
    explica: "Con tan poco tiempo, casi nadie de afuera se entera ni alcanza a postular.",
  },
  ya_hay_locadores: {
    corto: "Ya hay locadores",
    titulo: "La entidad ya pagaba ese servicio por órdenes",
    explica: "En los 12 meses antes, la entidad pagó por órdenes de servicio el mismo tipo de trabajo a una, dos o tres personas: la plaza puede ser para quien ya lo hacía.",
  },
  gestion_saliente: {
    corto: "De la gestión saliente",
    titulo: "La convocó la gestión que se va, después de las elecciones",
    explica:
      "La publicó un gobierno regional o municipal (o uno de sus organismos) después de las elecciones regionales y municipales y antes de entregar el cargo. Quien entre ahora seguirá con la gestión nueva. No es una falta: es un dato para revisar, más si la plaza pide experiencia en la propia entidad o ya hay locadores que hacen ese trabajo.",
  },
};

/** La ficha de una plaza CAS (GET /plazas/:aviso): la convocatoria y su contexto. */
export interface FichaPlaza {
  plaza: Plaza;
  /** Otras plazas de la entidad con el mismo título (una convocatoria de varias vacantes suele venir así). */
  mismoTitulo: { aviso: number; numero: string | null; vacantes: number | null; remuneracion: number | null; fechaInicio: string | null; ubicacion: string | null; nSenales: number }[];
  /** Lo que pagan otras entidades por el mismo título (tres plazas o más). */
  enOtras: { plazas: number; entidades: number; mediana: number | null; p25: number | null; p75: number | null } | null;
  gestion: { desde: string; quien: string | null; nivel: string; partido: string | null } | null;
}

export const rutaPlaza = (aviso: number | string) => `/app/personas/plazas/${aviso}`;

export const getFichaPlaza = (aviso: string) =>
  /^[0-9]{1,9}$/.test(aviso) ? leer<FichaPlaza>(`/plazas/${aviso}`) : Promise.resolve(null);

async function leer<T>(ruta: string, revalidate = 600): Promise<T | null> {
  try {
    const r = await fetch(`${API_BASE}${ruta}`, { next: { revalidate } } as RequestInit);
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

const qs = (f: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v != null && v !== "") p.set(k, String(v));
  return p.toString();
};

export const getPlanilla = (f: {
  entidad?: string; dep?: string; senal?: string; regimen?: number; severidad?: string; orden?: string; q?: string; dudoso?: string;
  sueldo?: string; oficina?: string; cargo?: string; pariente?: string; jefatura?: string; antiguedad?: string; page?: number; size?: number;
}) => leer<PaginaPlanilla>(`/planilla?${qs(f)}`);

/** La planilla de una entidad mes a mes (migración 182) y los cambios de gobierno de esos meses. */
export interface PlanillaMensual {
  meses: { mes: string; personas: number; base: number | null; altas: number | null; bajas: number | null }[];
  cambios: { mes: string; nivel: string; quien: string | null }[];
}

export const getPlanillaMensual = (entidad: string) =>
  /^\d{11}$/.test(entidad) ? leer<PlanillaMensual>(`/planilla/mensual?entidad=${entidad}`) : Promise.resolve(null);

/** La ficha de una persona de la planilla: sus datos, lo que cobró cada mes y la misma persona en otras planillas. */
export interface FichaPlanilla {
  persona: PersonaPlanilla & { dep: string | null; depNombre: string | null };
  historia: { mes: string; base: number | null; extra: number; total: number | null; dudoso: boolean; filas: number; cargo: string | null }[];
  otras: { entidadRuc: string; entidad: string | null; cargo: string | null; regimen: number | null; base: number | null; ultimoMes: string | null; nSenales: number; ficha: string | null }[];
  /** Parientes que ESTA persona declaró en su DJI y que son locadores de su misma entidad (lado funcionario del nepotismo). */
  nepotismo: { grado: string; parentesco: string; proveedorRuc: string; proveedorNombre: string; proveedorCodigo: string | null; ordenes: number; monto: number }[];
}

export const rutaPlanilla = (ficha: string, seccion?: string) => `/app/personas/planilla/${ficha}${seccion ? `?seccion=${seccion}` : ""}`;

export const getFichaPlanilla = (ficha: string) =>
  /^[0-9a-f]{12}$/.test(ficha) ? leer<FichaPlanilla>(`/planilla/ficha/${ficha}`) : Promise.resolve(null);

export const getPlazas = (f: {
  entidad?: string; dep?: string; senal?: string; severidad?: string; orden?: string; q?: string;
  abierta?: string; sueldo?: string; experiencia?: string; vacantes?: string; page?: number; size?: number;
}) => leer<PaginaPlazas>(`/plazas?${qs(f)}`);
