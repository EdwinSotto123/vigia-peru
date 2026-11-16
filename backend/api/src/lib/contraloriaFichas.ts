/**
 * Lo que encontró la Contraloría en cada informe de control (migraciones 304 y 305): el objetivo, los montos, el tipo de
 * servicio y las observaciones de su Ficha Resumen, leídas por un lector determinista, con el tema, el perjuicio y las
 * referencias que les puso la lectura de IA (GLM 5.3 flash); y, si existe la vista de la migración 302, los funcionarios
 * comprendidos con su responsabilidad PRESUNTA.
 *
 *   detallesDeInformes(codigos)        el detalle de varios informes a la vez, para las listas de /corrupcion/* y la
 *                                      herramienta informes_control del MCP.
 *   buscarInformesControl(b, ia)       el buscador (GET /informes-control/buscar, el MCP y el redactor de informes en
 *                                      formato de control): buscar_informe_control() híbrida, palabras y significado.
 *
 * Nada de esto sale sin publicar() (lib/privacidad.ts): la ruta que lo devuelve lo pasa entero. Los implicados van en
 * `implicados` (un papel de privacidad.ts: un apellido tapado); los textos de las observaciones, por la regla de la prosa.
 */
import { esErrorPg, pool } from "./db.js";
import { embeber, vectorLiteral, type IaWorkers } from "./rag.js";
import { publicar } from "./privacidad.js";

/** Los temas de una observación (lista cerrada de la lectura de IA) y el del objetivo en el buscador. */
export const TEMAS_CONTROL: Record<string, string> = {
  seleccion_contratacion: "Selección y contratación",
  ejecucion_contractual: "Ejecución contractual u obra",
  pagos_adelantos: "Pagos y adelantos",
  personal_planillas: "Personal y planillas",
  bienes_almacen: "Bienes y almacén",
  presupuesto_tesoreria: "Presupuesto y tesorería",
  otros: "Otros",
  objetivo: "Objetivo del informe",
};

export interface ObservacionControl {
  n: number;
  texto: string;
  /** null mientras la IA no la lea. */
  tema: string | null;
  temaTexto: string | null;
  perjuicio: number | null;
  moneda: "PEN" | "USD" | null;
  normas: string[];
  obras: { nombre: string; cui: string | null }[];
  contratos: string[];
  procesos: string[];
  empresas: { razon_social: string; ruc: string | null }[];
}

export interface ImplicadoControl {
  nombre: string;
  /** penal, civil, administrativa_entidad, administrativa_pas, administrativa: PRESUNTA. */
  responsabilidades: string[];
}

export interface DetalleInforme {
  objetivo: string | null;
  tipoServicio: string | null;
  tipoServicioTexto: string | null;
  unidadEmisora: string | null;
  montos: { auditado: number | null; examinado: number | null; objeto: number | null };
  /** «Observaciones» o, en un servicio de control específico, «Argumentos de hecho». */
  observacionesRotulo: string | null;
  observaciones: ObservacionControl[];
  recomendaciones: number;
  /** null: no se sabe (la vista de implicados no existe o no se pudo leer); [] el informe no trae a nadie. */
  implicados: ImplicadoControl[] | null;
  /** Cuándo leyó la IA las observaciones (null: sólo el lector del formulario). */
  leidoIa: string | null;
}

type Json = Record<string, unknown>;
const lista = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const texto = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** `campos` de informe_control_ficha → el detalle que se publica (sin el texto entero de la ficha, que nunca sale). */
export function detalleDeCampos(campos: Json | null | undefined, implicados: ImplicadoControl[] | null): DetalleInforme {
  const c = campos ?? {};
  const ia = (c.ia && typeof c.ia === "object" ? c.ia : {}) as Json;
  const porN = new Map(lista<Json>(ia.observaciones).map((o) => [Number(o.n), o]));
  return {
    objetivo: texto(c.objetivo),
    tipoServicio: texto(c.tipo_servicio),
    tipoServicioTexto: texto(c.tipo_servicio_texto),
    unidadEmisora: texto(c.unidad_emisora),
    montos: { auditado: num(c.monto_auditado), examinado: num(c.monto_examinado), objeto: num(c.monto_objeto) },
    observacionesRotulo: texto(c.observaciones_rotulo),
    observaciones: lista<Json>(c.observaciones).map((o) => {
      const x = porN.get(Number(o.n)) ?? {};
      const tema = texto(x.tema);
      return {
        n: Number(o.n),
        texto: String(o.texto ?? ""),
        tema,
        temaTexto: tema ? (TEMAS_CONTROL[tema] ?? tema) : null,
        perjuicio: num(x.perjuicio),
        moneda: x.moneda === "USD" ? "USD" : num(x.perjuicio) != null ? "PEN" : null,
        normas: lista<string>(x.normas).filter((s) => typeof s === "string"),
        obras: lista<Json>(x.obras).map((b) => ({ nombre: String(b.nombre ?? ""), cui: texto(b.cui) })).filter((b) => b.nombre),
        contratos: lista<string>(x.contratos).filter((s) => typeof s === "string"),
        procesos: lista<string>(x.procesos).filter((s) => typeof s === "string"),
        // Nunca un RUC 10 (el cargador ya los descarta; aquí por si acaso).
        empresas: lista<Json>(x.empresas)
          .map((e) => ({ razon_social: String(e.razon_social ?? ""), ruc: typeof e.ruc === "string" && /^(15|17|20)\d{9}$/.test(e.ruc) ? e.ruc : null }))
          .filter((e) => e.razon_social),
      };
    }),
    recomendaciones: lista(c.recomendaciones).length,
    implicados,
    leidoIa: texto(ia.leido_at),
  };
}

// ─── Implicados (vista de la migración 302) ─────────────────────────────────────────────────────

let vistaImplicados: { hay: boolean; hasta: number } | null = null;

/** ¿Existe la vista informe_control_implicado? Se vuelve a mirar cada 10 minutos (puede llegar con otra migración). */
async function hayVistaImplicados(): Promise<boolean> {
  if (vistaImplicados && vistaImplicados.hasta > Date.now()) return vistaImplicados.hay;
  const r = await pool.query<{ hay: boolean }>(
    `SELECT to_regclass('public.informe_control_implicado') IS NOT NULL
            AND has_table_privilege(to_regclass('public.informe_control_implicado'), 'SELECT') AS hay`);
  const hay = r.rows[0]?.hay === true;
  vistaImplicados = { hay, hasta: Date.now() + 600_000 };
  return hay;
}

async function implicadosDe(codigos: string[]): Promise<Map<string, ImplicadoControl[]> | null> {
  try {
    if (!(await hayVistaImplicados())) return null;
    const r = await pool.query<{ codigo: string; nombre: string; responsabilidades: string[] }>(
      `SELECT codigo, nombre, responsabilidades FROM informe_control_implicado WHERE codigo = ANY($1::text[]) ORDER BY codigo, orden`,
      [codigos]);
    const m = new Map<string, ImplicadoControl[]>(codigos.map((c) => [c, []]));
    for (const x of r.rows) m.get(x.codigo)?.push({ nombre: x.nombre, responsabilidades: x.responsabilidades ?? [] });
    return m;
  } catch (e) {
    // Sin la vista o sin permiso: el detalle sale sin implicados (null = no se sabe), no se cae la lista.
    if (esErrorPg(e, "42P01", "42501")) {
      vistaImplicados = { hay: false, hasta: Date.now() + 600_000 };
      return null;
    }
    throw e;
  }
}

/**
 * El detalle de varios informes por su código: los que tienen la ficha leída y, si existe la vista, sus implicados. Un
 * informe sin ficha no está en el mapa (la lista lo muestra con lo del buscador de la Contraloría).
 */
export async function detallesDeInformes(codigos: string[]): Promise<Map<string, DetalleInforme>> {
  const unicos = Array.from(new Set(codigos.filter(Boolean)));
  if (!unicos.length) return new Map();
  let filas: { codigo: string; campos: Json }[] = [];
  try {
    filas = (await pool.query<{ codigo: string; campos: Json }>(
      `SELECT codigo, campos FROM informe_control_ficha WHERE codigo = ANY($1::text[])`, [unicos])).rows;
  } catch (e) {
    if (esErrorPg(e, "42P01", "42501")) return new Map();     // la migración 304 todavía no llegó a esta base
    throw e;
  }
  const implicados = await implicadosDe(unicos);
  const m = new Map<string, DetalleInforme>();
  for (const f of filas) m.set(f.codigo, detalleDeCampos(f.campos, implicados ? (implicados.get(f.codigo) ?? []) : null));
  // Un informe sin ficha leída pero con implicados: también se publica lo que hay.
  if (implicados) {
    for (const c of unicos) {
      if (!m.has(c) && (implicados.get(c)?.length ?? 0) > 0) m.set(c, detalleDeCampos(null, implicados.get(c) ?? []));
    }
  }
  return m;
}

// ─── Buscador ───────────────────────────────────────────────────────────────────────────────────

export interface BusquedaControl {
  q: string;
  /** RUC de 11 dígitos o palabras del nombre de la entidad. */
  entidad?: string | null;
  /** Fecha de emisión mínima (AAAA-MM-DD). */
  desde?: string | null;
  /** Cuántos trozos (1 a 30; 10 por defecto). */
  n?: number;
}

export interface ResultadoControl {
  codigo: string;
  numero: string | null;
  titulo: string | null;
  entidad: string | null;
  entidadRuc: string | null;
  fecha: string | null;
  modalidad: string | null;
  responsabilidades: string[];
  /** El texto de la observación (o del objetivo, con tema «objetivo»). */
  observacion: string;
  tema: string | null;
  temaTexto: string | null;
  score: number;
  urlFicha: string | null;
  urlInforme: string | null;
}

/** Los embeddings de las últimas preguntas (el MCP y el redactor repiten la misma con otros filtros). */
const memoria = new Map<string, number[]>();

async function vectorDe(ia: IaWorkers, q: string): Promise<string> {
  const clave = q.toLowerCase();
  let v = memoria.get(clave);
  if (!v) {
    [v] = await embeber(ia, [q], 6_000);
    memoria.set(clave, v!);
    if (memoria.size > 300) memoria.delete(memoria.keys().next().value!);
  }
  return vectorLiteral(v!);
}

/**
 * La búsqueda híbrida en las observaciones (y objetivos) de los informes de control. Sin `ia` o si Workers AI no
 * responde, sólo por palabras: `modo` lo dice. Los textos salen ya sin los nombres de los funcionarios comprendidos; lo
 * demás (DNI sueltos, RUC 10) lo tapa el publicar() de quien los devuelve al público.
 */
export async function buscarInformesControl(b: BusquedaControl, ia?: IaWorkers): Promise<{
  q: string; modo: "hibrido" | "texto"; total: number; resultados: ResultadoControl[]; tiempos_ms: { significado: number; consulta: number };
}> {
  const t0 = Date.now();
  let vector: string | null = null;
  if (ia) {
    try {
      vector = await vectorDe(ia, b.q);
    } catch (e) {
      console.warn(`[control] embedding de la consulta: ${(e as Error).message}`);
    }
  }
  const t1 = Date.now();
  const n = Math.max(1, Math.min(30, Math.round(b.n ?? 10)));
  const cliente = await pool.connect();
  let filas: Json[];
  try {
    await cliente.query("BEGIN READ ONLY");
    await cliente.query("SET LOCAL statement_timeout = 8000");
    filas = (await cliente.query(
      `SELECT r.codigo, r.numero, r.titulo, r.entidad_nombre AS entidad, r.entidad_ruc AS "entidadRuc",
              to_char(r.fecha_emision, 'YYYY-MM-DD') AS fecha, r.modalidad, r.responsabilidades, r.observacion, r.tema, r.score,
              i.url_resumen AS "urlFicha", i.url_pdf AS "urlInforme"
         FROM buscar_informe_control($1, $2::halfvec, $3, $4::date, $5) r
         JOIN informes_control i ON i.codigo = r.codigo`,
      // Diez de más: el mismo texto puede venir dos veces (el título de la observación y su desarrollo, o dos trozos
      // iguales del mismo informe) y se quita abajo.
      [b.q, vector, b.entidad || null, b.desde || null, Math.min(40, n + 10)])).rows;
    await cliente.query("COMMIT");
  } catch (e) {
    await cliente.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    cliente.release();
  }
  // Un mismo hallazgo, una vez: mismo informe y mismo comienzo de texto (sin mayúsculas, tildes ni signos).
  const vistos = new Set<string>();
  const resultados = filas.map((x) => ({
    ...(x as unknown as ResultadoControl),
    responsabilidades: (x.responsabilidades as string[] | null) ?? [],
    temaTexto: x.tema ? (TEMAS_CONTROL[String(x.tema)] ?? String(x.tema)) : null,
    score: Number(x.score),
  })).filter((x) => {
    const clave = `${x.codigo}|${String(x.observacion ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 140)}`;
    if (vistos.has(clave)) return false;
    vistos.add(clave);
    return true;
  }).slice(0, n);
  const limpios = await sinComprendidos(resultados);
  return {
    q: b.q, modo: vector ? "hibrido" : "texto", total: limpios.length, resultados: limpios,
    tiempos_ms: { significado: t1 - t0, consulta: Date.now() - t1 },
  };
}

/**
 * El texto de una observación a veces nombra a un funcionario comprendido en ese informe (medido el 2026-11-16: el nombre
 * completo en 6 informes y los dos apellidos en 92). El detalle de un informe ya lo tapa, porque va junto a `implicados`;
 * una búsqueda no los trae. Aquí se piden los comprendidos de los informes encontrados y se pasa todo por publicar(), que
 * tapa a esas personas también dentro de la prosa: vale para la API, el MCP y los precedentes del informe para control.
 * Sin la vista de la migración 302, los textos salen como están (publicar() de quien los devuelve sigue tapando DNI).
 */
async function sinComprendidos(resultados: ResultadoControl[]): Promise<ResultadoControl[]> {
  const codigos = Array.from(new Set(resultados.map((x) => x.codigo)));
  if (!codigos.length) return resultados;
  try {
    if (!(await hayVistaImplicados())) return resultados;
    const r = await pool.query<{ nombre: string }>(
      `SELECT DISTINCT nombre FROM informe_control_implicado WHERE codigo = ANY($1::text[])`, [codigos]);
    if (!r.rows.length) return resultados;
    return (publicar({ resultados, implicados: r.rows.map((x) => ({ nombre: x.nombre })) }) as { resultados: ResultadoControl[] }).resultados;
  } catch (e) {
    console.warn(`[control] comprendidos de la búsqueda: ${(e as Error).message}`);
    return resultados;
  }
}
