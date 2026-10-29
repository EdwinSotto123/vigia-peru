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
  /** Un tercer número, si la serie lo dice (`extra2` de la serie): las visitas a quien decide. */
  extra2?: number | null;
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
  /** Qué es `extra2`, si lo trae. */
  extra2?: string | null;
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

/** Un hecho de un hilo: lo que pasó entre una misma empresa y la entidad, con su fecha. */
export interface HechoHilo {
  fecha: string;
  hasta?: string | null;
  tipo: "visitas" | "despues" | "contrato" | "obra" | "paralizada" | "sancion";
  titulo: string;
  detalle?: string | null;
  monto?: number | null;
  severidad?: Severidad | null;
  href?: string | null;
}

/**
 * Un hilo: una empresa y lo que pasó entre ella y la entidad a lo largo del tiempo (las visitas de su gente, lo que le
 * dieron después, sus contratos con banderas, sus obras y sus sanciones). Sólo empresas (RUC 20) con dos clases de hechos
 * o más: es lo que los correlaciona.
 */
export interface HiloHistoria {
  ruc: string;
  nombre: string;
  /** Por qué importa, en una frase. */
  resumen: string;
  severidad: Severidad;
  hechos: HechoHilo[];
  href: string;
}

/** Un patrón de sus series: un pico fuera de lo normal, el gasto al cierre del año o lo de antes de una elección. */
export interface PatronHistoria {
  id: string;
  tipo: "pico" | "fin_de_anio" | "antes_eleccion";
  severidad: Severidad;
  titulo: string;
  explica: string;
  carril: Carril;
  /** El mes (AAAA-MM) que señala en la línea; con `hasta`, un tramo. */
  mes: string;
  hasta?: string | null;
}

export interface Historia {
  sujeto: { tipo: "entidad" | "empresa" | "partido" | "contrato"; id: string; nombre: string | null };
  desde: string;
  hasta: string;
  carriles: CarrilHistoria[];
  series: SerieHistoria[];
  eventos: EventoHistoria[];
  marcas: MarcaHistoria[];
  secuencias: SecuenciaHistoria[];
  /** Las empresas cuyos hechos con la entidad se encadenan en el tiempo (la vista «Hilos»). */
  hilos?: HiloHistoria[];
  /** Los patrones de sus series (picos, cierre del año, antes de una elección). */
  patrones?: PatronHistoria[];
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
 * no se parece a un diciembre). Es una ola si lo de después es al menos el doble y suma al menos `minimo` más, con una
 * base (al menos 5 antes: desde cero no se distingue de que antes no se reportaba). Con `otros` (las demás órdenes de
 * la entidad en los mismos meses), además tiene que crecer 1,5 veces más que ellas (todo crece de un año a otro) y la
 * entidad tener al menos 30 órdenes en total antes. Alta si es el cuádruple (y, con `otros`, el doble que ellas). Con
 * `huecos: "sin_dato"` (la planilla), los doce meses tienen que estar publicados; con «cero» (las órdenes), basta que
 * la serie cubra los dos tramos. La misma regla que refrescar_ola_gestion() (migración 188).
 */
export function olasDeGestion(
  serie: Pick<SerieHistoria, "puntos" | "huecos" | "unidad">,
  cambios: CambioGestion[],
  opts: { tipo: string; minimo: number; que: string; href?: string | null; fuente: string; otros?: PuntoSerie[] },
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
    const suma = (xs: string[], m: Map<string, number> = valor) => xs.reduce((s, k) => s + (m.get(k) ?? 0), 0);
    const a = suma(antes);
    const d = suma(despues);
    if (a < 5 || d < 2 * a || d - a < opts.minimo) continue;
    let crecenOtros = 1;
    let otrosTexto = "";
    if (opts.otros) {
      const om = new Map(opts.otros.map((p) => [p.periodo, p.n]));
      const oa = suma(antes, om);
      const od = suma(despues, om);
      if (a + oa < 30) continue;
      crecenOtros = od / Math.max(oa, 1);
      if (d / a < 1.5 * crecenOtros) continue;
      otrosTexto = ` Sus demás órdenes, en los mismos meses: de ${miles(oa)} a ${miles(od)}.`;
    }
    const veces = d / a;
    const fin = sumarMeses(despues[5], 0);
    out.push({
      id: `${opts.tipo}:${c.fecha}`,
      tipo: opts.tipo,
      severidad: veces >= 4 && veces >= 2 * crecenOtros ? "alta" : "media",
      titulo: `${capital(opts.que)} se ${veces >= 3 ? `multiplicaron por ${Math.floor(veces)}` : "duplicaron"} con ${c.quien}`,
      explica:
        `En los seis meses desde que asumió (${mesLargo(despues[0])} a ${mesLargo(fin)}): ${miles(d)} ${serie.unidad}; ` +
        `en los mismos meses del año anterior, ${miles(a)}.${otrosTexto} Un cambio así puede tener razones legítimas (un ` +
        `programa nuevo, una emergencia): es para revisar, no prueba nada.`,
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

// ─── Patrones de las series: picos, el cierre del año y lo de antes de una elección ─────────────

/** Lo mínimo que tiene que sumar un mes para que su pico cuente (de menos, cualquier cosa es «el triple»). */
const MINIMO_PICO: Partial<Record<Carril, number>> = { compras: 5, ordenes: 30, personas: 10, planilla: 10, plazas: 5, visitas: 30 };

/** La mediana de los `ventana` valores anteriores a `i` (con al menos seis): lo normal de ese renglón antes de ese mes. */
export function medianaPrevia(valores: number[], i: number, ventana = 12): number | null {
  const xs = valores.slice(Math.max(0, i - ventana), i);
  if (xs.length < 6) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Los meses de una serie mensual, en orden, con su valor: lo que entra en un pico (en la planilla, las personas que
 * entraron; en lo demás, cuántos). Con `huecos: "cero"` un mes sin fila es un cero; con «sin_dato», no está.
 */
export function mesesDeSerie(s: SerieHistoria): { mes: string; v: number }[] {
  if (s.porAnio || !s.puntos.length) return [];
  const valor = (p: PuntoSerie) => (s.carril === "planilla" ? p.extra ?? 0 : p.n);
  const ordenados = [...s.puntos].sort((a, b) => a.periodo.localeCompare(b.periodo));
  if (s.huecos === "sin_dato") return ordenados.map((p) => ({ mes: p.periodo, v: valor(p) }));
  const por = new Map(ordenados.map((p) => [p.periodo, valor(p)]));
  const out: { mes: string; v: number }[] = [];
  for (let m = ordenados[0].periodo; m <= ordenados[ordenados.length - 1].periodo; m = sumarMeses(m, 1)) out.push({ mes: m, v: por.get(m) ?? 0 });
  return out;
}

/** «más del doble», «el triple», «cuatro veces», «12 veces». */
export function veces(r: number): string {
  if (r < 2.5) return "más del doble";
  if (r < 3.5) return "el triple";
  if (r < 10) return `${["", "", "", "", "cuatro", "cinco", "seis", "siete", "ocho", "nueve"][Math.floor(r)]} veces`;
  return `${Math.floor(r)} veces`;
}

/** Meses enteros entre dos meses AAAA-MM (b − a). */
function mesesEntre(a: string, b: string): number {
  const [ya, ma] = a.split("-").map(Number);
  const [yb, mb] = b.split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

/**
 * Los patrones de las series de una línea: los picos (un mes con al menos 2,5 veces lo normal de su renglón, su mediana de
 * los doce meses anteriores, y el mínimo del renglón), con lo que pasaba alrededor (otro renglón que también subió, una
 * gestión que acababa de asumir, una elección cerca); el gasto concentrado en diciembre; y lo que subió en los seis meses
 * antes de una elección contra los mismos meses del año anterior. Los más fuertes primero, hasta `max`.
 */
export function patronesDeSeries(series: SerieHistoria[], marcas: MarcaHistoria[], max = 8): PatronHistoria[] {
  const mensuales = series.filter((s) => !s.porAnio && MINIMO_PICO[s.carril] != null);
  const valores = new Map(mensuales.map((s) => [s.carril, mesesDeSerie(s)]));
  const ratioEn = (carril: Carril, mes: string): { r: number; v: number } | null => {
    const xs = valores.get(carril) ?? [];
    const i = xs.findIndex((x) => x.mes === mes);
    if (i < 0) return null;
    const med = medianaPrevia(xs.map((x) => x.v), i);
    if (med == null) return null;
    return { r: xs[i].v / Math.max(med, 1), v: xs[i].v };
  };
  const nombre = (s: SerieHistoria) => (s.carril === "planilla" ? "las entradas a la planilla" : s.titulo.toLowerCase());
  const gobiernos = marcas.filter((m) => m.tipo === "gobierno").sort((a, b) => a.fecha.localeCompare(b.fecha));
  const elecciones = marcas.filter((m) => m.tipo === "eleccion");
  const out: (PatronHistoria & { peso: number })[] = [];

  // 1. Picos: un mes (o meses seguidos) con al menos 2,5 veces lo normal de su renglón.
  for (const s of mensuales) {
    const xs = valores.get(s.carril) ?? [];
    const vals = xs.map((x) => x.v);
    const minimo = MINIMO_PICO[s.carril] ?? 10;
    let i = 0;
    while (i < xs.length) {
      const med = medianaPrevia(vals, i);
      const r = med == null ? 0 : xs[i].v / Math.max(med, 1);
      // Con una base: «desde casi cero» es casi siempre que la fuente empezó a publicar (las visitas de una entidad que
      // entró a la plataforma nacional), no un cambio de la entidad.
      if (med == null || med < Math.max(2, minimo / 3) || xs[i].v < minimo || xs[i].v - med < minimo || r < 2.5) {
        i++;
        continue;
      }
      // Los meses seguidos que siguen arriba van en el mismo patrón (el pico es el de más valor).
      let j = i;
      while (j + 1 < xs.length && xs[j + 1].v >= 2.5 * Math.max(med, 1) && xs[j + 1].v >= minimo) j++;
      const tope = xs.slice(i, j + 1).reduce((a, b) => (b.v > a.v ? b : a));
      const rTope = tope.v / Math.max(med, 1);
      const tambien = mensuales
        .filter((o) => o.carril !== s.carril)
        .map((o) => ({ o, x: ratioEn(o.carril, tope.mes) }))
        .filter((y): y is { o: SerieHistoria; x: { r: number; v: number } } => !!y.x && y.x.r >= 1.8 && y.x.v >= (MINIMO_PICO[y.o.carril] ?? 10) / 2);
      const gob = [...gobiernos].reverse().find((g) => g.fecha.slice(0, 7) <= tope.mes);
      const mesesGob = gob ? mesesEntre(gob.fecha.slice(0, 7), tope.mes) : null;
      const eleccion = elecciones.find((e) => e.fecha.slice(0, 7) >= tope.mes && mesesEntre(tope.mes, e.fecha.slice(0, 7)) <= 6);
      const contexto = [
        tambien.length ? `Ese mes también subieron ${tambien.map((y) => `${nombre(y.o)} (${veces(y.x.r)} lo normal)`).join(" y ")}.` : null,
        gob && mesesGob != null && mesesGob <= 12
          ? `Fue ${mesesGob === 0 ? "el mismo mes en que" : `${mesesGob} ${mesesGob === 1 ? "mes" : "meses"} después de que`} ${gob.texto.charAt(0).toLowerCase()}${gob.texto.slice(1)}.`
          : null,
        eleccion ? `Faltaban ${mesesEntre(tope.mes, eleccion.fecha.slice(0, 7))} meses para las ${eleccion.texto.replace(/^Elecciones/, "elecciones")}.` : null,
      ].filter(Boolean).join(" ");
      // Diciembre: muchas entidades apuran sus compras al cierre del año; cuenta un grado menos.
      const diciembre = tope.mes.endsWith("-12");
      const fuerte = !diciembre && rTope >= 4 && (tambien.length > 0 || (mesesGob != null && mesesGob <= 6) || !!eleccion);
      out.push({
        id: `pico:${s.carril}:${tope.mes}`, tipo: "pico", carril: s.carril, mes: xs[i].mes, hasta: j > i ? xs[j].mes : null,
        severidad: fuerte ? "alta" : rTope >= 4 && !diciembre ? "media" : "baja",
        titulo: `${capital(nombre(s))}: ${veces(rTope)} lo normal en ${mesLargo(tope.mes)}`,
        explica: [
          `${miles(tope.v)} ${s.carril === "planilla" ? "personas entraron" : s.unidad} en ${mesLargo(tope.mes)}, cuando lo normal en los doce meses anteriores era ${miles(med)}${j > i ? ` (siguió así hasta ${mesLargo(xs[j].mes)})` : ""}.`,
          contexto,
          diciembre ? "Es diciembre, cuando muchas entidades apuran sus compras para no devolver el presupuesto." : null,
          "Un pico puede tener razones legítimas (una emergencia, un programa nuevo, el cierre del año): es para revisar.",
        ].filter(Boolean).join(" "),
        peso: (fuerte ? 30 : 0) + Math.min(rTope, 20) + tambien.length * 3,
      });
      i = j + 1;
    }
  }

  // 2. El cierre del año: cuánto de sus órdenes de cada año caen en diciembre (lo parejo sería un doceavo).
  const ord = series.find((s) => s.carril === "ordenes" && !s.porAnio);
  if (ord) {
    const porAnio = new Map<string, { total: number; dic: number; meses: number }>();
    for (const p of ord.puntos) {
      const a = p.periodo.slice(0, 4);
      const v = p.monto ?? p.n;
      const x = porAnio.get(a) ?? { total: 0, dic: 0, meses: 0 };
      x.total += v;
      x.meses += 1;
      if (p.periodo.endsWith("-12")) x.dic += v;
      porAnio.set(a, x);
    }
    const completos = [...porAnio.entries()].filter(([, x]) => x.meses >= 11 && x.total > 0).sort((a, b) => a[0].localeCompare(b[0]));
    if (completos.length >= 2) {
      const prom = completos.reduce((t, [, x]) => t + x.dic / x.total, 0) / completos.length;
      if (prom >= 0.2) {
        const ultimo = completos[completos.length - 1][0];
        out.push({
          id: "fin_de_anio:ordenes", tipo: "fin_de_anio", carril: "ordenes", mes: `${ultimo}-12`,
          severidad: prom >= 0.3 ? "media" : "baja",
          titulo: `Concentra sus órdenes en diciembre: el ${Math.round(prom * 100)} % de lo de cada año`,
          explica:
            `En ${completos.length} años completos, diciembre se llevó en promedio el ${Math.round(prom * 100)} % de lo que sumaron sus órdenes en el año ` +
            "(si fuera parejo, cerca del 8 %). Gastar al cierre para no devolver el presupuesto es común; las compras apuradas son las que más se revisan.",
          peso: 10 + prom * 20,
        });
      }
    }
  }

  // 3. Antes de una elección: los seis meses previos contra los mismos meses del año anterior.
  for (const s of mensuales.filter((x) => x.carril === "personas" || x.carril === "ordenes")) {
    const xs = valores.get(s.carril) ?? [];
    const por = new Map(xs.map((x) => [x.mes, x.v]));
    for (const e of elecciones) {
      const fin = sumarMeses(e.fecha.slice(0, 7), -1);
      const antes = Array.from({ length: 6 }, (_, k) => sumarMeses(fin, -k));
      const base = antes.map((m) => sumarMeses(m, -12));
      if ([...antes, ...base].some((m) => !por.has(m))) continue;
      const a = antes.reduce((t, m) => t + (por.get(m) ?? 0), 0);
      const b = base.reduce((t, m) => t + (por.get(m) ?? 0), 0);
      const minimo = (MINIMO_PICO[s.carril] ?? 10) * 3;
      if (b < 5 || a < 2 * b || a - b < minimo) continue;
      const r = a / b;
      out.push({
        id: `antes_eleccion:${s.carril}:${e.fecha}`, tipo: "antes_eleccion", carril: s.carril, mes: antes[5], hasta: fin,
        severidad: r >= 3 ? "alta" : "media",
        titulo: `${capital(nombre(s))}: ${veces(r)} en los seis meses antes de las ${e.texto.replace(/^Elecciones/, "elecciones")}`,
        explica:
          `De ${mesLargo(antes[5])} a ${mesLargo(fin)}: ${miles(a)} ${s.unidad}; en los mismos meses del año anterior, ${miles(b)}. ` +
          "Contratar más justo antes de una elección puede usarse para la campaña: es para revisar, no prueba nada.",
        peso: 15 + Math.min(r, 20),
      });
    }
  }

  // A lo sumo dos picos por renglón (si no, los diciembres de un solo renglón tapan todo lo demás).
  const porCarril = new Map<string, number>();
  return out
    .sort((a, b) => (PESO_SEV[b.severidad] ?? 0) - (PESO_SEV[a.severidad] ?? 0) || b.peso - a.peso)
    .filter((p) => {
      if (p.tipo !== "pico") return true;
      const k = (porCarril.get(p.carril) ?? 0) + 1;
      porCarril.set(p.carril, k);
      return k <= 2;
    })
    .slice(0, max)
    .map(({ peso: _peso, ...p }) => p);
}

// ─── Hilos: lo que pasó entre una empresa y la entidad, encadenado en el tiempo ─────────────────

/** Una empresa cuya gente visitó la entidad (entidad_visita_empresa, migraciones 203 y 204). */
export interface VisitaHilo {
  ruc: string;
  nombre: string | null;
  primera: string;
  ultima: string;
  visitas: number;
  visitantes: number;
  decisores: number;
  antes: number;
  despues: string | null;
  dias: number | null;
  despues_tipo: string | null;
  despues_numero: string | null;
  despues_detalle: string | null;
  despues_monto: number | null;
  despues_ocid: string | null;
  monto: number | null;
}
export interface BanderaHilo { ocid: string; ruc: string; proveedor: string | null; fecha: string; monto: number | null; severidad: string; n_alta: number; objeto: string | null }
export interface ObraHilo { codigo: number | string; nombre: string | null; inicio: string; monto: number | null; paralizada: boolean | null; fecha_par: string | null; ejecutor_ruc: string | null; ejecutor: string | null }
export interface SancionHilo { ruc: string; tipo: string | null; desde: string | null; hasta: string | null }

/** La severidad de lo que vino después de una visita: grave si nunca le había vendido, visitó a quien decide y fue pronto. */
export function sevDespues(v: Pick<VisitaHilo, "antes" | "decisores" | "dias">): Severidad {
  const dias = v.dias ?? 9999;
  if (v.antes === 0 && v.decisores > 0 && dias <= 90) return "alta";
  if ((v.antes === 0 && dias <= 180) || (v.decisores > 0 && dias <= 30)) return "media";
  return "baja";
}

/** «una orden (N.° 4505540510)» / «un contrato (CP SER-SM-1-2026-ESSALUD/GCL-1)». */
export function cualDespues(tipo: string | null, numero: string | null): string {
  const base = tipo === "orden" ? "una orden" : tipo === "consorcio" ? "un contrato en consorcio" : "un contrato";
  return numero ? `${base} (${tipo === "orden" ? "N.° " : ""}${numero})` : base;
}

/**
 * Los hilos de una entidad: por empresa (RUC 20), sus visitas, lo primero que le dieron después, sus contratos con
 * banderas, sus obras (y si se paralizaron) y sus sanciones del Tribunal; sólo las que juntan dos clases de hechos o más
 * (es lo que los correlaciona), de la más grave a la menos, hasta `max`.
 */
export function armarHilos(
  datos: { visitas: VisitaHilo[]; banderas: BanderaHilo[]; obras: ObraHilo[]; sanciones: SancionHilo[] },
  rutas: { contrato: (ocid: string) => string; empresa: (ruc: string, vista?: string) => string },
  max = 40,
): HiloHistoria[] {
  const hilos = new Map<string, { nombre: string | null; hechos: HechoHilo[]; clases: Set<string> }>();
  const de = (ruc: string, nombre: string | null) => {
    const h = hilos.get(ruc) ?? { nombre, hechos: [], clases: new Set<string>() };
    if (!h.nombre && nombre) h.nombre = nombre;
    hilos.set(ruc, h);
    return h;
  };
  for (const v of datos.visitas) {
    if (!/^20\d{9}$/.test(v.ruc)) continue;
    const h = de(v.ruc, v.nombre);
    h.clases.add("visitas");
    h.hechos.push({
      fecha: v.primera, hasta: v.ultima > v.primera ? v.ultima : null, tipo: "visitas",
      titulo: `${miles(v.visitas)} ${v.visitas === 1 ? "visita" : "visitas"} de su gente (${miles(v.visitantes)} ${v.visitantes === 1 ? "persona" : "personas"})`,
      detalle: v.decisores > 0 ? `${miles(v.decisores)} a quien decide las compras` : null,
      href: rutas.empresa(v.ruc, "visitas"),
    });
    if (v.despues) {
      h.clases.add("despues");
      h.hechos.push({
        fecha: v.despues, tipo: "despues", severidad: sevDespues(v), monto: v.despues_monto,
        titulo: `Le dieron ${cualDespues(v.despues_tipo, v.despues_numero)}${v.dias != null ? ` a los ${miles(v.dias)} días de una visita` : ""}`,
        detalle: [v.antes === 0 ? "Nunca le había vendido antes de esas visitas" : "Ya le vendía antes", v.despues_detalle ? `«${v.despues_detalle}»` : null].filter(Boolean).join(". "),
        href: v.despues_ocid ? rutas.contrato(v.despues_ocid) : rutas.empresa(v.ruc, v.despues_tipo === "orden" ? "ordenes" : "contratos"),
      });
    }
  }
  for (const b of datos.banderas) {
    if (!/^20\d{9}$/.test(b.ruc)) continue;
    const h = de(b.ruc, b.proveedor);
    h.clases.add("contrato");
    h.hechos.push({
      fecha: b.fecha, tipo: "contrato", severidad: b.severidad === "alta" ? "alta" : "media", monto: b.monto,
      titulo: `Ganó un contrato con banderas${b.n_alta > 0 ? ` (${b.n_alta} ${b.n_alta === 1 ? "antecedente grave" : "antecedentes graves"})` : ""}`,
      detalle: b.objeto, href: rutas.contrato(b.ocid),
    });
  }
  for (const o of datos.obras) {
    if (!o.ejecutor_ruc || !/^20\d{9}$/.test(o.ejecutor_ruc)) continue;
    const h = de(o.ejecutor_ruc, o.ejecutor);
    h.clases.add("obra");
    h.hechos.push({ fecha: o.inicio, tipo: "obra", monto: o.monto, titulo: o.nombre ? `Empezó la obra «${o.nombre}»` : "Empezó una obra", href: rutas.empresa(o.ejecutor_ruc, "obras") });
    if (o.paralizada && o.fecha_par) {
      h.hechos.push({ fecha: o.fecha_par, tipo: "paralizada", severidad: "alta", monto: o.monto, titulo: o.nombre ? `Se paralizó la obra «${o.nombre}»` : "Se paralizó una obra", href: rutas.empresa(o.ejecutor_ruc, "obras") });
    }
  }
  for (const s of datos.sanciones) {
    const h = hilos.get(s.ruc);
    if (!h || !s.desde) continue;
    h.clases.add("sancion");
    h.hechos.push({ fecha: s.desde, hasta: s.hasta, tipo: "sancion", severidad: "alta", titulo: `Sancionada por el Tribunal de Contrataciones${s.tipo ? ` (${s.tipo})` : ""}`, href: rutas.empresa(s.ruc, "antecedentes") });
  }

  const out: (HiloHistoria & { peso: number })[] = [];
  for (const [ruc, h] of hilos) {
    if (h.clases.size < 2) continue;
    h.hechos.sort((a, b) => a.fecha.localeCompare(b.fecha));
    const despues = h.hechos.find((x) => x.tipo === "despues");
    const contratos = h.hechos.filter((x) => x.tipo === "contrato");
    const paralizadas = h.hechos.filter((x) => x.tipo === "paralizada");
    const sanciones = h.hechos.filter((x) => x.tipo === "sancion");
    // Ganó un contrato con banderas mientras estaba sancionada: el hecho más grave que puede tener un hilo.
    const ganoSancionada = contratos.some((c) => sanciones.some((s) => c.fecha >= s.fecha && (!s.hasta || c.fecha <= s.hasta)));
    const partes = [
      despues ? `su gente visitó la entidad y ${despues.titulo.charAt(0).toLowerCase()}${despues.titulo.slice(1)}` : h.clases.has("visitas") ? "su gente visitó la entidad" : null,
      contratos.length ? `ganó ${miles(contratos.length)} ${contratos.length === 1 ? "contrato" : "contratos"} con banderas` : null,
      paralizadas.length ? (paralizadas.length === 1 ? "una obra suya se paralizó" : `${paralizadas.length} obras suyas se paralizaron`) : null,
      ganoSancionada ? "ganó mientras estaba sancionada" : sanciones.length ? "la sancionó el Tribunal" : null,
    ].filter(Boolean) as string[];
    const sevs = h.hechos.map((x) => x.severidad).filter(Boolean) as Severidad[];
    const peor: Severidad = ganoSancionada || (h.clases.has("visitas") && contratos.length > 0) || sevs.includes("alta") ? "alta" : sevs.includes("media") ? "media" : "baja";
    const monto = h.hechos.reduce((t, x) => t + (x.tipo === "despues" || x.tipo === "contrato" ? x.monto ?? 0 : 0), 0);
    out.push({
      // El nombre como viene (la web lo escribe con tituloNatural, que respeta S.A.C., E.I.R.L. y las siglas).
      ruc, nombre: h.nombre ?? `Empresa ${ruc}`,
      resumen: `${capital(partes.join("; "))}.`,
      severidad: peor, hechos: h.hechos,
      href: rutas.empresa(ruc, h.clases.has("visitas") ? "visitas" : undefined),
      peso: (PESO_SEV[peor] ?? 0) * 100 + h.clases.size * 10 + Math.log10(1 + monto),
    });
  }
  return out.sort((a, b) => b.peso - a.peso).slice(0, max).map(({ peso: _peso, ...x }) => x);
}
