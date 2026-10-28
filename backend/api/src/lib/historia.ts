/**
 * La historia de una entidad, una empresa o un partido en una sola línea de tiempo (fase 3 del plan del 2026-10-27): sus
 * compras mes a mes junto a quién gobernaba, las visitas, la planilla, las plazas, los informes de control, las sanciones,
 * los aportes y las banderas de sus contratos. La arma routes/historia.ts con lo que lee de la base; aquí va lo que no
 * depende de ella: las formas, las elecciones, cuántos hechos sueltos caben por carril y las secuencias (una cosa que lleva
 * a otra: la visita y la buena pro, la fundación y el primer contrato, el cambio de gestión y la ola de órdenes a personas).
 *
 * Un carril es un renglón del gráfico: a lo sumo una serie (barras por mes o por año) y sus hechos sueltos (puntos y
 * tramos). Los hechos llevan su fuente y dónde verificarlos; las series, la lista de Vigía que las desglosa.
 *
 * Privacidad: ningún nombre de persona natural privada (el visitante, el socio, el locador). De la visita, el cargo y el
 * área de quien la recibió; del socio, su papel. Las autoridades electas y los Presidentes van con su nombre.
 */

export type Carril =
  | "gobierno"
  | "compras"
  | "ordenes"
  | "personas"
  | "menores"
  | "planilla"
  | "plazas"
  | "visitas"
  | "control"
  | "obras"
  | "politica"
  | "empresa"
  | "banderas"
  | "presupuesto";

export type Severidad = "alta" | "media" | "baja";

/** Un hecho con fecha: un punto, o un tramo si trae `hasta` (una sanción, una gestión). */
export interface EventoHistoria {
  id: string;
  carril: Carril;
  /** Qué hecho es dentro del carril («informe», «sancion», «buena_pro»…). */
  tipo: string;
  /** AAAA-MM-DD. */
  fecha: string;
  hasta?: string | null;
  titulo: string;
  detalle?: string | null;
  monto?: number | null;
  severidad?: Severidad | null;
  /** Su ficha o su lista en Vigía. */
  href?: string | null;
  /** El registro oficial del que sale. */
  fuente: string;
  /** Dónde verificarlo. */
  enlace?: string | null;
}

/** Un mes («AAAA-MM») o un año («AAAA») de una serie. `extra`: un segundo número (las altas de la planilla). */
export interface PuntoSerie {
  periodo: string;
  n: number;
  monto?: number | null;
  extra?: number | null;
}

export interface SerieHistoria {
  carril: Carril;
  titulo: string;
  /** Qué mide el alto de la barra. */
  medida: "n" | "monto";
  /** Cómo se dice el número: «órdenes», «procesos», «personas»… */
  unidad: string;
  /** Qué es `extra`, si lo trae. */
  extra?: string | null;
  porAnio?: boolean;
  /** Si un mes sin fila es un cero (las órdenes) o un mes sin dato (la planilla, que se publica a veces). */
  huecos: "cero" | "sin_dato";
  puntos: PuntoSerie[];
  fuente: string;
  enlace?: string | null;
  href?: string | null;
}

export interface MarcaHistoria {
  fecha: string;
  tipo: "gobierno" | "eleccion";
  texto: string;
}

/** Una cosa que lleva a otra, con sus pasos en orden (para la línea y para su lista). */
export interface SecuenciaHistoria {
  id: string;
  tipo: string;
  severidad: Severidad;
  titulo: string;
  explica: string;
  pasos: { fecha: string; texto: string }[];
  href?: string | null;
  fuente: string;
}

export interface CarrilHistoria {
  clave: Carril;
  titulo: string;
  explica: string;
}

export interface Historia {
  sujeto: { tipo: "entidad" | "empresa" | "partido"; id: string; nombre: string | null };
  desde: string;
  hasta: string;
  carriles: CarrilHistoria[];
  series: SerieHistoria[];
  eventos: EventoHistoria[];
  marcas: MarcaHistoria[];
  secuencias: SecuenciaHistoria[];
  /** Hechos que no entraron por carril (se muestran los más graves y los más grandes; la lista de su pestaña los tiene todos). */
  omitidos: Partial<Record<Carril, number>>;
  fuentes: { texto: string; href: string }[];
}

// ─── Elecciones ─────────────────────────────────────────────────────────────────────────────────

/**
 * El día de cada elección (en las generales, la primera vuelta). Las mismas que FECHA_ELECCION del frontend; la ERM 2026
 * fue el domingo 4 de octubre de 2026 (Resolución 0632-2025-JNE).
 */
export const ELECCIONES: { clave: string; fecha: string; texto: string; ambito: "general" | "regional" }[] = [
  { clave: "ERM2014", fecha: "2014-10-05", texto: "Elecciones regionales y municipales 2014", ambito: "regional" },
  { clave: "EG2016", fecha: "2016-04-10", texto: "Elecciones generales 2016", ambito: "general" },
  { clave: "ERM2018", fecha: "2018-10-07", texto: "Elecciones regionales y municipales 2018", ambito: "regional" },
  { clave: "ECE2020", fecha: "2020-01-26", texto: "Elecciones congresales 2020", ambito: "general" },
  { clave: "EG2021", fecha: "2021-04-11", texto: "Elecciones generales 2021", ambito: "general" },
  { clave: "ERM2022", fecha: "2022-10-02", texto: "Elecciones regionales y municipales 2022", ambito: "regional" },
  { clave: "EG2026", fecha: "2026-04-12", texto: "Elecciones generales 2026", ambito: "general" },
  { clave: "ERM2026", fecha: "2026-10-04", texto: "Elecciones regionales y municipales 2026", ambito: "regional" },
];

/** La fecha de una elección por su proceso como lo escriben la ONPE y el JNE («ERM 2022», «EG2021», «ECE 2020»). */
export function fechaEleccion(proceso: string | null | undefined): string | null {
  const k = (proceso ?? "").toUpperCase().replace(/\s+/g, "");
  return ELECCIONES.find((e) => e.clave === k)?.fecha ?? null;
}

/** Las marcas de elección entre dos fechas, de un ámbito o de los dos. */
export function marcasEleccion(desde: string, hasta: string, ambito?: "general" | "regional"): MarcaHistoria[] {
  return ELECCIONES.filter((e) => e.fecha >= desde && e.fecha <= hasta && (!ambito || e.ambito === ambito)).map((e) => ({
    fecha: e.fecha,
    tipo: "eleccion" as const,
    texto: e.texto,
  }));
}

// ─── Fechas ─────────────────────────────────────────────────────────────────────────────────────

/** AAAA-MM-DD de lo que llega de la base (Date, texto con hora o sin ella); null si no es una fecha. */
export function dia(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return null;
}

/** El mes «AAAA-MM» que está `k` meses después (o antes) de otro. */
export function sumarMeses(mes: string, k: number): string {
  const [a, m] = mes.split("-").map(Number);
  const t = a * 12 + (m - 1) + k;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

/** Días entre dos fechas AAAA-MM-DD. */
export function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

// ─── Cuántos hechos sueltos por carril ──────────────────────────────────────────────────────────

const PESO_SEV: Record<string, number> = { alta: 3, media: 2, baja: 1 };

/**
 * Deja en cada carril a lo sumo `tope[carril]` hechos: primero los que nombra una secuencia (`fijos`), luego los más
 * graves, los de más monto y los más recientes. Dice cuántos quedaron fuera por carril (la línea los cuenta; la lista de
 * su pestaña los tiene todos).
 */
export function acotar(
  eventos: EventoHistoria[],
  tope: Partial<Record<Carril, number>>,
  fijos: Set<string> = new Set(),
): { eventos: EventoHistoria[]; omitidos: Partial<Record<Carril, number>> } {
  const porCarril = new Map<Carril, EventoHistoria[]>();
  for (const e of eventos) porCarril.set(e.carril, [...(porCarril.get(e.carril) ?? []), e]);
  const quedan: EventoHistoria[] = [];
  const omitidos: Partial<Record<Carril, number>> = {};
  for (const [carril, xs] of porCarril) {
    const max = tope[carril];
    if (max == null || xs.length <= max) {
      quedan.push(...xs);
      continue;
    }
    const orden = [...xs].sort(
      (a, b) =>
        Number(fijos.has(b.id)) - Number(fijos.has(a.id)) ||
        (PESO_SEV[b.severidad ?? ""] ?? 0) - (PESO_SEV[a.severidad ?? ""] ?? 0) ||
        (b.monto ?? 0) - (a.monto ?? 0) ||
        b.fecha.localeCompare(a.fecha),
    );
    const n = Math.max(max, xs.filter((e) => fijos.has(e.id)).length);
    quedan.push(...orden.slice(0, n));
    omitidos[carril] = xs.length - n;
  }
  quedan.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id.localeCompare(b.id));
  return { eventos: quedan, omitidos };
}

// ─── La ola que sigue a un cambio de gestión ────────────────────────────────────────────────────

export interface CambioGestion {
  fecha: string;
  /** Quién asumió («la gestión de Somos Perú», «Dina Boluarte»). */
  quien: string;
}

/**
 * Los seis meses desde que asumió una gestión frente a los mismos seis meses del año anterior (la misma época: un enero
 * no se parece a un diciembre). Es una ola si lo de después es al menos el doble y suma al menos `minimo` más; alta si
 * es el cuádruple. Con `huecos: "sin_dato"` (la planilla), los doce meses tienen que estar publicados; con «cero» (las
 * órdenes), basta que la serie cubra los dos tramos.
 */
export function olasDeGestion(
  serie: Pick<SerieHistoria, "puntos" | "huecos" | "unidad">,
  cambios: CambioGestion[],
  opts: { tipo: string; minimo: number; que: string; href?: string | null; fuente: string },
): SecuenciaHistoria[] {
  const valor = new Map(serie.puntos.map((p) => [p.periodo, p.n]));
  const meses = [...valor.keys()].sort();
  if (!meses.length) return [];
  const primero = meses[0];
  const ultimo = meses[meses.length - 1];
  const out: SecuenciaHistoria[] = [];
  for (const c of cambios) {
    // Si asumió pasado el día 15, su primer mes es el siguiente.
    const m0 = sumarMeses(c.fecha.slice(0, 7), Number(c.fecha.slice(8, 10)) > 15 ? 1 : 0);
    const despues = Array.from({ length: 6 }, (_, i) => sumarMeses(m0, i));
    const antes = despues.map((m) => sumarMeses(m, -12));
    if (antes[0] < primero || despues[5] > ultimo) continue;
    if (serie.huecos === "sin_dato" && [...antes, ...despues].some((m) => !valor.has(m))) continue;
    const suma = (xs: string[]) => xs.reduce((s, m) => s + (valor.get(m) ?? 0), 0);
    const a = suma(antes);
    const d = suma(despues);
    if (d < 2 * a || d - a < opts.minimo) continue;
    const veces = a > 0 ? d / a : null;
    const fin = sumarMeses(despues[5], 0);
    out.push({
      id: `${opts.tipo}:${c.fecha}`,
      tipo: opts.tipo,
      severidad: veces == null || veces >= 4 ? "alta" : "media",
      titulo: `${capital(opts.que)} se ${veces == null ? "dispararon" : veces >= 3 ? `multiplicaron por ${Math.floor(veces)}` : "duplicaron"} con ${c.quien}`,
      explica:
        `En los seis meses desde que asumió (${mesLargo(despues[0])} a ${mesLargo(fin)}): ${miles(d)} ${serie.unidad}; ` +
        `en los mismos meses del año anterior, ${miles(a)}. Un cambio así puede tener razones legítimas (un programa nuevo, ` +
        `una emergencia): es para revisar, no prueba nada.`,
      pasos: [
        { fecha: `${antes[0]}-01`, texto: `${miles(a)} ${serie.unidad} en los seis meses de un año antes` },
        { fecha: c.fecha, texto: `Asumió ${c.quien}` },
        { fecha: `${fin}-28`, texto: `${miles(d)} ${serie.unidad} en sus primeros seis meses` },
      ],
      href: opts.href ?? null,
      fuente: opts.fuente,
    });
  }
  return out;
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
/** «marzo de 2023». */
export function mesLargo(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return `${MESES[m - 1]} de ${a}`;
}
const miles = (n: number) => Math.round(n).toLocaleString("es-PE");
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ─── Secuencias de una empresa, desde sus cruces ────────────────────────────────────────────────

/** Una fila de cruces_proveedor con la buena pro y la entidad de su contrato (si es de un proceso). */
export interface CruceSecuencia {
  tipo: string;
  severidad: string | null;
  fecha: unknown;
  monto: number | string | null;
  ocid: string | null;
  detalle: Record<string, unknown> | null;
  /** De su proceso: la buena pro, la entidad y el código. */
  buena_pro: unknown;
  entidad: string | null;
  codigo: string | null;
}

const TIPOS_SECUENCIA = new Set([
  "visita_previa",
  "recien_fundada_medio_ano",
  "recien_fundada_un_ano",
  "recien_fundada_dos_anos",
  "empresa_espejo",
  "partido_gobernante",
  "vendio_gobernante",
]);

const txt = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const titulo = (s: string) =>
  s
    .toLowerCase()
    .replace(/(^|[\s(«"-])([a-záéíóúñü])/g, (_, p: string, l: string) => p + l.toUpperCase())
    .replace(/\b(De|Del|La|Las|Los|El|Y|E|En|Por|Para|A)\b/g, (w) => w.toLowerCase())
    .replace(/^./, (l) => l.toUpperCase());

/**
 * Las secuencias que ya prueban los cruces de una empresa, como pasos con fecha: visitó la entidad y ganó la buena pro;
 * se fundó y ganó a los pocos meses; una hermana fue sancionada y ganó ella; aportó al partido que gobierna la entidad y
 * ganó; le vendió a su campaña y ganó. Una por contrato y tipo (un cruce se repite por cada persona de la empresa), las
 * graves primero, hasta `max`.
 */
export function secuenciasDeCruces(filas: CruceSecuencia[], rutaContrato: (ocid: string) => string, max = 40): SecuenciaHistoria[] {
  const vistas = new Set<string>();
  const out: SecuenciaHistoria[] = [];
  const orden = [...filas]
    .filter((f) => TIPOS_SECUENCIA.has(f.tipo) && f.ocid)
    .sort((a, b) => (PESO_SEV[b.severidad ?? ""] ?? 0) - (PESO_SEV[a.severidad ?? ""] ?? 0) || String(dia(b.buena_pro) ?? "").localeCompare(String(dia(a.buena_pro) ?? "")));
  for (const f of orden) {
    const clave = `${f.tipo.replace(/^recien_fundada_.*/, "recien_fundada")}:${f.ocid}`;
    if (vistas.has(clave)) continue;
    const d = f.detalle ?? {};
    const bp = dia(f.buena_pro) ?? dia(d.buena_pro) ?? dia(f.fecha);
    if (!bp) continue;
    const ent = f.entidad ? titulo(f.entidad) : "la entidad";
    const sev: Severidad = f.severidad === "alta" || f.severidad === "media" ? f.severidad : "baja";
    const href = f.ocid ? rutaContrato(f.ocid) : null;
    const gano = `Ganó la buena pro${f.codigo ? ` del proceso ${f.codigo}` : ""} en ${ent}`;
    let s: SecuenciaHistoria | null = null;
    if (f.tipo === "visita_previa") {
      const v = dia(f.fecha);
      const cargo = txt(d.cargo_funcionario);
      if (v) {
        s = {
          id: clave, tipo: "visita_buena_pro", severidad: sev, href, fuente: "Registro de Visitas en Línea y OECE",
          titulo: `Visitó ${ent} y ganó ${diasEntre(v, bp)} días después`,
          explica: `Alguien de la empresa visitó la entidad${cargo ? ` (lo recibió: ${cargo})` : ""} antes de que le dieran la buena pro. Una visita no prueba un favor: es para revisar.`,
          pasos: [{ fecha: v, texto: `Visitó ${ent}${cargo ? `; lo recibió: ${cargo}` : ""}` }, { fecha: bp, texto: gano }],
        };
      }
    } else if (f.tipo.startsWith("recien_fundada")) {
      const fund = dia(d.fundada);
      const meses = Number(d.meses);
      if (fund) {
        s = {
          id: clave, tipo: "fundada_gano", severidad: sev, href, fuente: "SUNAT y OECE",
          titulo: `Ganó ${Number.isFinite(meses) && meses > 0 ? `a los ${meses} ${meses === 1 ? "mes" : "meses"}` : "poco después"} de fundada`,
          explica: "Una empresa recién creada que gana un contrato del Estado: a veces es una empresa armada para ese contrato. Es para revisar.",
          pasos: [{ fecha: fund, texto: "Se fundó (SUNAT)" }, { fecha: bp, texto: gano }],
        };
      }
    } else if (f.tipo === "empresa_espejo") {
      const desde = dia(d.desde);
      const sancionada = txt(d.sancionada);
      if (desde && sancionada) {
        s = {
          id: clave, tipo: "espejo", severidad: sev, href, fuente: "Tribunal de Contrataciones (OECE) y RNP",
          titulo: `Ganó mientras ${titulo(sancionada)}, con la misma gente, estaba sancionada`,
          explica: "Una empresa con los mismos socios o representantes que otra sancionada por el Tribunal gana cuando la otra no puede contratar.",
          pasos: [{ fecha: desde, texto: `Sancionaron a ${titulo(sancionada)}${txt(d.resolucion) ? ` (${txt(d.resolucion)})` : ""}` }, { fecha: bp, texto: gano }],
        };
      }
    } else if (f.tipo === "partido_gobernante") {
      const ap = dia(f.fecha);
      const partido = txt(d.partido) ?? txt(d.organizacion_gobernante);
      if (ap && partido) {
        s = {
          id: clave, tipo: "aporte_gano", severidad: sev, href, fuente: "ONPE, JNE y OECE",
          titulo: `Aportó a ${titulo(partido)} y ganó donde gobierna`,
          explica: `Alguien de la empresa aportó a ${titulo(partido)}, que gobierna ${ent}, y la empresa ganó allí. Aportar es legal: es para revisar.`,
          pasos: [{ fecha: ap, texto: `Aporte a ${titulo(partido)}` }, { fecha: bp, texto: gano }],
        };
      }
    } else if (f.tipo === "vendio_gobernante") {
      const proceso = txt(d.proceso);
      const fe = fechaEleccion(proceso);
      const org = txt(d.organizacion);
      if (fe && org) {
        s = {
          id: clave, tipo: "campana_gano", severidad: sev, href, fuente: "ONPE (gastos de campaña) y OECE",
          titulo: `Le vendió a la campaña de ${titulo(org)} y ganó donde gobierna`,
          explica: `La empresa figura como proveedora de la campaña de ${titulo(org)} en ${proceso}; ese partido gobierna ${ent}, donde ganó.`,
          pasos: [{ fecha: fe, texto: `${proceso}: le vendió a la campaña de ${titulo(org)}` }, { fecha: bp, texto: gano }],
        };
      }
    }
    if (!s || s.pasos[0].fecha > s.pasos[s.pasos.length - 1].fecha) continue;
    vistas.add(clave);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}
