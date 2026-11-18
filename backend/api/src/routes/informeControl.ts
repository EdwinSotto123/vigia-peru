/**
 * El informe de indicios en formato de control de un contrato (lib/informeControl.ts y lib/redactorControl.ts;
 * migración 306, tabla informe_vigia).
 *
 *   GET  /contratos/:ocid/informe-control   el documento guardado si sus entradas no cambiaron; si no, lo redacta.
 *        → 200 { ocid, estado: "listo", version, generadoAt, modelo, costoUsd, tokens, informe, markdown, desactualizado? }
 *        → 202 { estado: "generando", reintentarEn }    otro pedido lo está redactando
 *        → 404 { error: "sin_senales" }                  el contrato no tiene señales: no hay indicios que reunir
 *        → 429 { error: "demasiados_pedidos" | "tope_diario", reintentarEn }
 *   POST /contratos/:ocid/informe-control   lo vuelve a redactar aunque nada haya cambiado (sólo con x-admin-token).
 *
 * Reutiliza la ficha del contrato tal como la publica la API (contratos_detalle.ts: cruces con su evidencia, documentos,
 * adjudicación y contrato, ya pasados por publicar()) y las banderas publicadas del dictamen, con su evidencia entera.
 *
 * Que no se dispare en masa: sólo contratos con alguna señal; a lo más 2 a la vez, 40 por hora, 250 y USD 6 por día en
 * todo Vigía; y por IP de quien lo pide, 4 por hora y 12 por día (lo interno, como el MCP, que cobra créditos, no tiene
 * tope por IP). Con el tope alcanzado se devuelve la versión anterior, si la hay, marcada como desactualizada.
 */
import { Hono, type Context } from "hono";
import { contratosDetalleRouter } from "./contratos_detalle.js";
import { buscarNormas, type Fila as FilaNorma, type NormasDeLaFecha } from "./normas.js";
import { esErrorPg, pool } from "../lib/db.js";
import { publicar, limpiarTexto } from "../lib/privacidad.js";
import { esPublicada } from "../lib/publicacion.js";
import { SIN_CACHE, cachePublico } from "../lib/http.js";
import { claveIp, dentroDeTope, ipCliente, pedidoInterno } from "../lib/antibots.js";
import { optionalAuth, type AuthedUser } from "../lib/auth.js";
import { tokenAdminValido } from "../lib/adminlog.js";
import { registrar } from "../lib/registro.js";
import { embeber, vectorLiteral, type IaWorkers } from "../lib/rag.js";
import {
  VERSION_REDACTOR, agrupar, armarInforme, criterioPertinente, datosDelProceso, datosTema, fechaDelCriterio, markdownDe, huellaDe,
  procesoParaModelo, regimenDe, senalesDelContrato, type DatosProceso, type FilaBandera, type GrupoObservacion, type InformeControl,
  type NormaCriterio, type Precedente, type SenalInforme,
} from "../lib/informeControl.js";
import { MODELO_REDACTOR, nombreModelo, redactarObservaciones, type EnvLlm } from "../lib/redactorControl.js";

export const informeControlRouter = new Hono();

type Fila = Record<string, any>;

/** Topes de redacción (ver la cabecera). */
export const TOPES = { aLaVez: 2, porHora: 40, porDia: 250, usdPorDia: 6, ipPorHora: 4, ipPorDia: 12, cuentaPorDia: 15 } as const;

/**
 * ¿Quién puede hacer que se REDACTE un informe (lo que cuesta)? Lo ya guardado lo ve cualquiera. Redactar, sólo una cuenta
 * con sesión o un pedido interno (el MCP, que exige un plan pagado). Pedido del dueño (2026-11-18): a una visita anónima,
 * «¿eres periodista o investigador? ¿o de Contraloría? regístrate», para no gastar en vano: hasta ese día cualquier visita
 * que abriera la pestaña (también un rastreador que ejecuta JavaScript) disparaba la redacción.
 */
function quienRedacta(c: Context): { uid: string | null } | null {
  const u = c.get("user") as AuthedUser | undefined;
  if (u?.uid) return { uid: u.uid };
  return pedidoInterno(c) ? { uid: null } : null;
}

const REQUIERE_CUENTA = "El informe de este contrato todavía no está redactado. Redactarlo usa un modelo de inteligencia artificial: entra con tu cuenta (o créala gratis) y se redacta en menos de un minuto; después queda guardado para todos.";
/** Un «generando» más viejo que esto se da por muerto (el pedido se cortó). */
const VIVO_MIN = 5;
const CACHE_LISTO = cachePublico(300, { maxAge: 60, swr: 600 });

const hoyLima = () => new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10);

// ─── Las entradas: la ficha, las banderas del dictamen y lo que sale de ellas ───────────────────────────────────────

export interface EntradasInforme {
  ocid: string;
  ficha: Fila;
  proceso: DatosProceso;
  senales: SenalInforme[];
  grupos: GrupoObservacion[];
  resto: SenalInforme[];
  huella: string;
  /** El contexto con que se tapan personas al publicar (la ficha y el dictamen, que no se devuelven). */
  contexto: unknown;
}

/** La ficha del contrato como la publica la API (GET /contratos/:ocid), sin repetir su armado. null si no existe. */
async function cargarFicha(ocid: string): Promise<Fila | null> {
  const r = await contratosDetalleRouter.request(`/${encodeURIComponent(ocid)}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`ficha_${r.status}`);
  return (await r.json()) as Fila;
}

/** Las banderas del dictamen publicado, con la evidencia entera (la ficha la recorta a 320 caracteres) y su contexto. */
async function cargarBanderas(alertaId: string): Promise<{ filas: FilaBandera[]; contexto: unknown }> {
  const r = await pool.query(
    `SELECT b.id, b.regla, b.severidad, b.evidencia, b.norma, b.fuente_url, b.agente_origen, COALESCE(b.puntua, true) AS puntua,
            CASE WHEN b.verificacion->>'ok' IN ('true', 'false') THEN (b.verificacion->>'ok')::boolean END AS verificada,
            -- Sólo para reconocer a las personas al tapar la evidencia (como GET /alertas/:id): no sale.
            CASE WHEN row_number() OVER (ORDER BY b.id) = 1 THEN (SELECT a.analisis_full FROM alertas a WHERE a.id = b.alerta_id) END AS _contexto
       FROM banderas b WHERE b.alerta_id = $1
      ORDER BY CASE b.severidad WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END, b.id`, [alertaId]);
  const contexto = r.rows.find((x) => x._contexto)?._contexto ?? null;
  const filas = r.rows.map(({ _contexto, ...x }) => x) as FilaBandera[];
  return { filas: publicar(filas, { extra: contexto ?? undefined }), contexto };
}

/**
 * ¿Hay buscador de informes de la Contraloría (migración 305) y algo cargado en él? Se mira cada 10 minutos. Entra en la
 * huella: cuando se cargan las fichas, los documentos guardados sin precedentes se vuelven a redactar con ellos.
 */
let buscador: { hay: boolean; at: number } | null = null;
async function hayBuscadorPrecedentes(): Promise<boolean> {
  if (buscador && Date.now() - buscador.at < 600_000) return buscador.hay;
  const existe = await pool.query(
    `SELECT to_regprocedure('public.buscar_informe_control(text,halfvec,text,date,integer)') IS NOT NULL
            AND to_regclass('public.informe_control_fragmento') IS NOT NULL AS hay`).catch(() => null);
  if (!existe) return buscador?.hay ?? false;
  let hay = existe.rows[0]?.hay === true;
  if (hay) hay = (await pool.query(`SELECT EXISTS (SELECT 1 FROM informe_control_fragmento WHERE tipo = 'observacion') AS hay`).catch(() => null))?.rows[0]?.hay === true;
  buscador = { hay, at: Date.now() };
  return hay;
}

/** Todo lo que el documento necesita del contrato, y su huella. null si el contrato no existe. */
export async function prepararEntradas(ocid: string): Promise<EntradasInforme | null> {
  const ficha = await cargarFicha(ocid);
  if (!ficha) return null;
  const alerta = ficha.alerta as Fila | null;
  const { filas, contexto } = alerta?.id && esPublicada(alerta.estado) ? await cargarBanderas(String(alerta.id)) : { filas: [], contexto: null };
  const proceso = datosDelProceso(ficha);
  const senales = senalesDelContrato(ficha, filas);
  const { grupos, resto } = agrupar(senales);
  const huella = await huellaDe({
    redactor: VERSION_REDACTOR,
    proceso: procesoParaModelo(proceso),
    documentos: proceso.documentos.map((d) => [d.url, d.copia ? 1 : 0]),
    senales: senales.map((s) => ({ c: s.clave, t: s.texto, s: s.severidad, f: s.fecha, m: s.monto, d: s.datos, r: s.registros, n: s.norma })),
    precedentes: await hayBuscadorPrecedentes(),
  });
  return { ocid: String(ficha.ocid), ficha, proceso, senales, grupos, resto, huella, contexto: { ficha, contexto } };
}

// ─── Criterio y precedentes ──────────────────────────────────────────────────────────────────────────────────────────

const recortar = (t: string, max: number) => (t.length <= max ? t : `${t.slice(0, max).replace(/\s+\S*$/, "")}…`);

/** `fn` sobre cada elemento, de a `n` a la vez. */
async function enTandas<T>(xs: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  const cola = [...xs];
  await Promise.all(Array.from({ length: Math.min(n, cola.length) }, async () => {
    for (let x = cola.shift(); x !== undefined; x = cola.shift()) await fn(x);
  }));
}

/**
 * El texto del artículo sin el encabezado que repite la norma, el artículo, el epígrafe, la página y el trozo («(parte 5
 * de 7)»): lo que se lee es la regla.
 */
export function extractoNorma(texto: string, documento: string, epigrafe: string | null): string {
  let t = texto.replace(/\s+/g, " ").trim();
  const pagina = t.search(/\[p[aá]gina \d+\]/i);
  if (pagina >= 0 && pagina < 500) t = t.slice(t.indexOf("]", pagina) + 1).trim();
  if (t.startsWith(documento)) t = t.slice(documento.length).replace(/^\s*—\s*/, "").trim();
  const ep = epigrafe?.replace(/^[\s—–-]+/, "").trim();
  if (ep && t.startsWith(ep)) t = t.slice(ep.length).trim();
  // «Artículo 30 — Impedimentos para contratar (parte 5 de 7)»: el encabezado del trozo.
  t = t.replace(/^Art[ií]culo\s+[\w.-]+\s*[—–-]\s*/i, "");
  if (ep && t.startsWith(ep)) t = t.slice(ep.length).trim();
  t = t.replace(/\(parte \d+ de \d+\)\s*/gi, "").trim();
  return recortar(t, 600);
}

/**
 * Las normas candidatas de cada observación: las preguntas de su tema a buscar_norma con SU fecha (la de la convocatoria,
 * o la del hecho si es otro acto: fechaDelCriterio), que decide la ley y la versión de cada artículo de ese día; hasta 4
 * normas y 2 criterios del OECE de esa ley que traten del hecho, sin repetir. Todas las preguntas se embeben juntas, en
 * UN pedido a Workers AI (es compartido); sin vectores, se busca por palabras.
 */
export async function normasDeLasObservaciones(grupos: GrupoObservacion[], fechaConvocatoria: string | null, ia: IaWorkers | undefined): Promise<Map<string, NormaCriterio[]>> {
  const pedidos = grupos.map((g) => {
    const { fecha } = fechaDelCriterio(g, fechaConvocatoria);
    return { g, fecha, preguntas: datosTema(g.tema).normas[regimenDe(fecha)] };
  });
  const preguntas = [...new Set(pedidos.flatMap((x) => x.preguntas))];
  const vectores = new Map<string, string>();
  if (ia && preguntas.length) {
    try {
      const vs = await embeber(ia, preguntas, 20_000);
      preguntas.forEach((q, i) => vectores.set(q, vectorLiteral(vs[i])));
    } catch (err) {
      registrar("WARNING", `[informe-control] embeddings de las normas: ${(err as Error)?.message ?? err}`);
    }
  }
  const respuestas = new Map<string, NormasDeLaFecha | null>();
  const claves = [...new Set(pedidos.flatMap((x) => x.preguntas.map((q) => JSON.stringify([q, x.fecha]))))];
  // De a 3 (las conexiones de un pedido en Workers) y, si una se cae por tiempo, una vez más al final: con la base ocupada,
  // diez búsquedas a la vez se pasaban del plazo.
  const buscar = async (k: string) => {
    const [q, fecha] = JSON.parse(k) as [string, string | null];
    return buscarNormas({ q, fecha: fecha ?? undefined }, undefined, vectores.get(q) ?? null);
  };
  const fallidas: string[] = [];
  await enTandas(claves, 3, async (k) => {
    try {
      respuestas.set(k, await buscar(k));
    } catch {
      fallidas.push(k);
    }
  });
  for (const k of fallidas) {
    respuestas.set(k, await buscar(k).catch((err) => {
      registrar("WARNING", `[informe-control] buscar_norma: ${(err as Error)?.message ?? err}`);
      return null;
    }));
  }
  return new Map(pedidos.map((x) => {
    const evidencia = [x.g.titulo, ...x.g.senales.map((s) => `${s.etiqueta} ${s.texto} ${JSON.stringify(s.datos)}`)].join(" ");
    return [x.g.id, normasCandidatas(x.preguntas.map((q) => respuestas.get(JSON.stringify([q, x.fecha])) ?? null), evidencia)];
  }));
}

/**
 * Hasta 4 normas y 2 criterios de las respuestas de las preguntas de un tema, intercaladas y sin repetir. Fuera: lo que
 * no dice qué es (sin artículo ni epígrafe) y los criterios del OECE que no tratan del hecho (`criterioPertinente`).
 */
function normasCandidatas(respuestas: (NormasDeLaFecha | null)[], evidencia: string): NormaCriterio[] {
  const normas: NormaCriterio[] = [];
  const criterios: NormaCriterio[] = [];
  const vistos = new Set<string>();
  // Intercaladas: la mejor de cada pregunta primero (cada pregunta cubre un aspecto del hecho).
  const filas: (FilaNorma & { version?: string })[] = [];
  const largo = Math.max(0, ...respuestas.map((r) => r?.data.length ?? 0));
  for (let i = 0; i < largo; i++) for (const r of respuestas) if (r?.data[i]) filas.push(r.data[i]);
  for (const f of filas) {
    const clave = `${f.documento}|${f.articulo ?? f.slug}`;
    if (vistos.has(clave)) continue;
    const epigrafe = f.epigrafe ? f.epigrafe.replace(/^[\s—–-]+/, "").trim() || null : null;
    const n: NormaCriterio = {
      id: "",
      documento: f.documento,
      articulo: f.articulo,
      epigrafe,
      extracto: extractoNorma(f.texto, f.documento, f.epigrafe),
      url: f.urlOficial,
      version: f.version ?? null,
      clase: f.aplica === "norma" ? "norma" : "criterio",
    };
    // Los criterios de la otra ley (`criterio_anterior`) valen sólo por analogía: no van al documento.
    if (f.aplica === "norma" && normas.length < 4 && (n.articulo || n.epigrafe)) normas.push(n);
    else if (f.aplica === "criterio" && criterios.length < 2 && criterioPertinente(`${n.epigrafe ?? ""} ${n.extracto}`, evidencia)) criterios.push(n);
    else continue;
    vistos.add(clave);
  }
  return [...normas.map((n, i) => ({ ...n, id: `N${i + 1}` })), ...criterios.map((n, i) => ({ ...n, id: `C${i + 1}` }))];
}

/** Lo que guarda la Contraloría de un informe (la URL del resumen o del informe) para los precedentes. */
const aPrecedente = (r: Fila, id: string): Precedente => ({
  id,
  numero: r.numero ?? null,
  codigo: String(r.codigo),
  entidad: r.entidad_nombre ?? null,
  anio: r.fecha_emision ? Number(String(r.fecha_emision instanceof Date ? r.fecha_emision.toISOString() : r.fecha_emision).slice(0, 4)) : null,
  titulo: r.titulo ? recortar(limpiarTexto(String(r.titulo)), 300) : null,
  observacion: r.observacion ? recortar(limpiarTexto(String(r.observacion)), 500) : null,
  modalidad: r.modalidad ?? null,
  responsabilidades: Array.isArray(r.responsabilidades) ? r.responsabilidades.map(String) : [],
  url: r.url_resumen ?? r.url_pdf ?? null,
});

/**
 * Observaciones parecidas de informes reales de la Contraloría (buscar_informe_control, de otra migración: si todavía no
 * existe, ninguna). Hasta 6 candidatas por observación; el modelo elige las que vienen al caso.
 */
async function precedentesCandidatos(grupos: GrupoObservacion[], ia: IaWorkers | undefined): Promise<Map<string, Precedente[]>> {
  const out = new Map<string, Precedente[]>();
  if (!grupos.length || !(await hayBuscadorPrecedentes())) return out;
  const consultas = grupos.map((g) => `${datosTema(g.tema).control}. ${g.senales[0]?.texto.slice(0, 220) ?? ""}`.trim());
  let vectores: (string | null)[] = consultas.map(() => null);
  if (ia) {
    try {
      vectores = (await embeber(ia, consultas, 15_000)).map(vectorLiteral);
    } catch {
      /* sin vectores: sólo por palabras */
    }
  }
  await Promise.all(grupos.map(async (g, i) => {
    try {
      const r = await pool.query(
        `SELECT b.codigo, b.numero, b.titulo, b.entidad_nombre, b.fecha_emision, b.modalidad, b.responsabilidades, b.observacion,
                b.tema, b.score, ic.url_resumen, ic.url_pdf
           FROM buscar_informe_control($1, $2::halfvec, NULL, NULL, 6) b LEFT JOIN informes_control ic ON ic.codigo = b.codigo`,
        [consultas[i], vectores[i]]);
      // Observaciones (no el objetivo del informe), una por informe.
      const vistos = new Set<string>();
      const filas = r.rows.filter((x) => x.tema !== "objetivo" && (vistos.has(x.codigo) ? false : (vistos.add(x.codigo), true)));
      out.set(g.id, filas.map((x, k) => aPrecedente(x, `P${k + 1}`)));
    } catch (e) {
      if (!esErrorPg(e, "42883", "42P01")) registrar("WARNING", `[informe-control] precedentes: ${(e as Error).message}`);
    }
  }));
  return out;
}

/** Palabras del objeto que no dicen nada del bien o servicio (para buscar informes de contrataciones parecidas). */
const VACIAS = new Set(("contratacion adquisicion servicio servicios para del de la las los el en y a con por su sus al que una un " +
  "distrito provincia departamento region municipalidad provincial distrital gobierno regional local entidad atencion " +
  "suministro bienes contratar diversos diversas varios varias segun requerimiento item items paquete lote proceso").split(" "));
const sinTildes = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * Informes de control sobre contrataciones parecidas: los de la Contraloría cuyo asunto comparte al menos dos palabras
 * del objeto de este contrato (cargador frontal, limpieza…), pesadas por lo raras que son entre los asuntos (una palabra
 * que está en todos, como «planta», casi no suma). Es contexto para el órgano de control, no una comparación de hechos:
 * va en el alcance, con el asunto de cada informe.
 */
async function antecedentesDeControl(objeto: string, ocid: string): Promise<Precedente[]> {
  // Primero, los informes que ya observaron ESTE procedimiento (informe_control_proceso, migración 313).
  let directos: Precedente[] = [];
  try {
    const r = await pool.query(
      `SELECT ic.codigo, ic.numero, ic.titulo, ic.entidad_nombre, ic.fecha_emision, ic.modalidad, ic.responsabilidades, ic.url_resumen, ic.url_pdf
         FROM informes_control ic
        WHERE ic.codigo IN (SELECT p.codigo FROM informe_control_proceso p WHERE p.ocid = $1)
        ORDER BY ic.fecha_emision DESC NULLS LAST, ic.codigo
        LIMIT 3`,
      [ocid]);
    directos = r.rows.map((x, i) => ({ ...aPrecedente(x, `D${i + 1}`), directo: true }));
  } catch (e) {
    if (!esErrorPg(e, "42P01", "42501")) registrar("WARNING", `[informe-control] informes sobre el mismo procedimiento: ${(e as Error).message}`);
  }
  const palabras = [...new Set((sinTildes(objeto).match(/[a-zñ]{5,}/g) ?? []).filter((w) => !VACIAS.has(w)))].slice(0, 8);
  if (palabras.length < 2) return directos;
  try {
    const r = await pool.query(
      `WITH t AS MATERIALIZED (
              SELECT codigo, to_tsvector('spanish', immutable_unaccent(lower(titulo))) AS v FROM informes_control WHERE titulo IS NOT NULL),
            p AS (SELECT w, plainto_tsquery('spanish', w) AS q FROM unnest($1::text[]) w),
            df AS (SELECT p.w, p.q, ln((SELECT count(*) FROM t)::float / (1 + count(t.codigo))) AS idf FROM p LEFT JOIN t ON t.v @@ p.q GROUP BY p.w, p.q),
            m AS (SELECT t.codigo, sum(df.idf) AS peso, count(*) AS n FROM t JOIN df ON t.v @@ df.q GROUP BY t.codigo HAVING count(*) >= 2)
       SELECT ic.codigo, ic.numero, ic.titulo, ic.entidad_nombre, ic.fecha_emision, ic.modalidad, ic.responsabilidades, ic.url_resumen, ic.url_pdf, m.peso, m.n
         FROM m JOIN informes_control ic ON ic.codigo = m.codigo
        ORDER BY m.peso DESC, ic.fecha_emision DESC NULLS LAST
        LIMIT 6`,
      [palabras]);
    const yaEstan = new Set(directos.map((q) => q.codigo));
    return [...directos, ...r.rows.filter((x) => !yaEstan.has(String(x.codigo))).slice(0, 3).map((x, i) => aPrecedente(x, `A${i + 1}`))];
  } catch (e) {
    registrar("WARNING", `[informe-control] antecedentes de control: ${(e as Error).message}`);
    return directos;
  }
}

// ─── La redacción ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Redactado {
  informe: InformeControl;
  markdown: string;
  modelo: string | null;
  entrada: number;
  salida: number;
  costo: number;
  ms: number;
  fallas: string[];
  /** Lo que se le quitó al texto del modelo y por qué (para el registro; no va en el documento). */
  quitadas: { observacion: string; oracion: string; motivo: string }[];
}

/** Redacta el documento con las entradas ya preparadas. No escribe nada en la base. */
export async function redactarInforme(
  env: EnvLlm,
  ia: IaWorkers | undefined,
  e: EntradasInforme,
  version: number,
  opciones: { modelo?: string; concurrencia?: number; plazoTotalMs?: number; registrar?: (x: Record<string, unknown>) => void } = {},
): Promise<Redactado> {
  const t0 = Date.now();
  const [normasPorGrupo, precedentes, antecedentes] = await Promise.all([
    normasDeLasObservaciones(e.grupos, e.proceso.fechaConvocatoria, ia),
    precedentesCandidatos(e.grupos, ia),
    antecedentesDeControl(e.proceso.objeto, e.ocid),
  ]);
  const r = await redactarObservaciones(env, e.proceso, e.grupos, normasPorGrupo, precedentes, {
    modelo: opciones.modelo ?? MODELO_REDACTOR,
    concurrencia: opciones.concurrencia ?? TOPES.aLaVez,
    plazoTotalMs: opciones.plazoTotalMs,
    registrar: opciones.registrar,
  });
  const crudo = armarInforme({
    proceso: e.proceso, grupos: e.grupos, resto: e.resto, redacciones: r.redacciones, normas: normasPorGrupo, precedentes, antecedentes,
    hoy: hoyLima(), version,
  });
  // La última red de privacidad: un apellido tapado a toda persona que se reconozca en la ficha y el dictamen.
  const informe = publicar(crudo, { extra: e.contexto });
  return {
    informe,
    markdown: markdownDe(informe),
    modelo: r.modelos.length ? r.modelos.map(nombreModelo).join(" + ") : null,
    entrada: r.entrada,
    salida: r.salida,
    costo: Math.round(r.costo * 1_000_000) / 1_000_000,
    ms: Date.now() - t0,
    fallas: r.fallas,
    quitadas: [...r.redacciones.entries()].flatMap(([id, x]) => x.quitadas.map((q) => ({ observacion: id, ...q }))),
  };
}

// ─── Lo guardado ─────────────────────────────────────────────────────────────────────────────────────────────────────

interface Guardado {
  version: number;
  huella: string;
  contenido: InformeControl;
  markdown: string;
  modelo: string | null;
  tokens_entrada: number;
  tokens_salida: number;
  costo_usd: string | number;
  generado_at: string;
}

async function guardadoDe(ocid: string): Promise<{ listo: Guardado | null; enCurso: boolean }> {
  const r = await pool.query(
    `SELECT (SELECT row_to_json(x) FROM (
              SELECT version, huella, contenido, markdown, modelo, tokens_entrada, tokens_salida, costo_usd, generado_at
                FROM informe_vigia WHERE ocid = $1 AND estado = 'listo' ORDER BY version DESC LIMIT 1) x) AS listo,
            EXISTS (SELECT 1 FROM informe_vigia WHERE ocid = $1 AND estado = 'generando' AND generado_at > now() - make_interval(mins => $2)) AS en_curso`,
    [ocid, VIVO_MIN]);
  return { listo: (r.rows[0]?.listo as Guardado | null) ?? null, enCurso: r.rows[0]?.en_curso === true };
}

const respuesta = (ocid: string, g: Guardado, extra: Record<string, unknown> = {}) => ({
  ocid,
  estado: "listo",
  version: g.version,
  generadoAt: g.generado_at,
  modelo: g.modelo,
  costoUsd: Number(g.costo_usd),
  tokens: { entrada: g.tokens_entrada, salida: g.tokens_salida },
  ...extra,
  informe: g.contenido,
  markdown: g.markdown,
});

/** La huella de las entradas de cada contrato, vista en este proceso en la última hora: no se rehace la ficha en cada visita. */
const huellasVistas = new Map<string, { huella: string; at: number }>();
const huellaVista = (ocid: string) => {
  const x = huellasVistas.get(ocid);
  return x && Date.now() - x.at < 3_600_000 ? x.huella : null;
};
function anotarHuella(ocid: string, huella: string): void {
  huellasVistas.delete(ocid);
  huellasVistas.set(ocid, { huella, at: Date.now() });
  while (huellasVistas.size > 2000) {
    const primera = huellasVistas.keys().next().value;
    if (primera === undefined) break;
    huellasVistas.delete(primera);
  }
}

/** ¿Se puede redactar uno más? null si sí; si no, el motivo para quien lo pidió. */
async function topeAlcanzado(c: Context, porAdmin: boolean, uid: string | null = null): Promise<{ error: string; detail: string; reintentarEn: number } | null> {
  const r = await pool.query(
    `SELECT count(*) FILTER (WHERE estado = 'generando' AND generado_at > now() - make_interval(mins => $1))::int AS a_la_vez,
            count(*) FILTER (WHERE generado_at > now() - interval '1 hour')::int AS hora,
            count(*)::int AS dia, COALESCE(sum(costo_usd), 0)::float AS usd
       FROM informe_vigia WHERE generado_at > now() - interval '1 day'`, [VIVO_MIN]);
  const t = r.rows[0] ?? { a_la_vez: 0, hora: 0, dia: 0, usd: 0 };
  if (t.a_la_vez >= TOPES.aLaVez) return { error: "demasiados_pedidos", detail: "Se están redactando otros informes en este momento: vuelve a intentarlo en un minuto.", reintentarEn: 60 };
  if (porAdmin) return null;
  if (t.hora >= TOPES.porHora) return { error: "tope_diario", detail: "Se alcanzó el número de informes que Vigía redacta por hora: vuelve a intentarlo más tarde.", reintentarEn: 900 };
  if (t.dia >= TOPES.porDia || t.usd >= TOPES.usdPorDia) return { error: "tope_diario", detail: "Se alcanzó el número de informes que Vigía redacta por día: vuelve a intentarlo mañana.", reintentarEn: 3600 };
  if (uid) {
    const p = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM informe_vigia WHERE pedido_por = $1 AND generado_at > now() - interval '1 day'`, [`web:${uid}`]);
    if ((p.rows[0]?.n ?? 0) >= TOPES.cuentaPorDia) {
      return { error: "tope_cuenta", detail: `Pediste ${TOPES.cuentaPorDia} informes nuevos hoy, el máximo por cuenta: los ya redactados se siguen viendo; mañana puedes pedir más.`, reintentarEn: 3600 };
    }
  }
  if (!pedidoInterno(c)) {
    const ip = claveIp(ipCliente(c));
    const hora = await dentroDeTope(`informe-control|h|${ip}`, TOPES.ipPorHora, 3600, true);
    const dia = hora && (await dentroDeTope(`informe-control|d|${ip}`, TOPES.ipPorDia, 86_400, true));
    if (!hora || !dia) return { error: "demasiados_pedidos", detail: "Pediste varios informes seguidos: vuelve a intentarlo más tarde.", reintentarEn: hora ? 3600 : 900 };
  }
  return null;
}

/** Redacta, guarda y responde (GET con entradas nuevas, o POST del panel). */
async function generarYResponder(c: Context, e: EntradasInforme, anterior: Guardado | null, porAdmin: boolean, uid: string | null = null): Promise<Response> {
  const tope = await topeAlcanzado(c, porAdmin, uid);
  if (tope) {
    c.header("Cache-Control", SIN_CACHE);
    if (anterior) return c.json(respuesta(e.ocid, anterior, { desactualizado: true, aviso: tope.detail }));
    c.header("Retry-After", String(tope.reintentarEn));
    return c.json(tope, 429);
  }
  const pedidoPor = porAdmin ? "admin" : /^vigia-mcp/i.test(c.req.header("user-agent") ?? "") ? "mcp" : uid ? `web:${uid}` : "web";
  // Un «generando» viejo es un pedido que se cortó (quien lo pidió cerró la pestaña): queda como error, con su motivo.
  await pool.query(
    `UPDATE informe_vigia SET estado = 'error', error = 'el pedido se cortó antes de terminar', terminado_at = now()
      WHERE ocid = $1 AND estado = 'generando' AND generado_at <= now() - make_interval(mins => $2)`, [e.ocid, VIVO_MIN]).catch(() => undefined);
  let id: number;
  let version: number;
  try {
    // El candado: (ocid, version) es única; dos pedidos a la vez calculan la misma versión y uno choca.
    const ins = await pool.query(
      `INSERT INTO informe_vigia (ocid, version, redactor, huella, estado, pedido_por)
       SELECT $1, COALESCE(max(version), 0) + 1, $2, $3, 'generando', $4 FROM informe_vigia WHERE ocid = $1
       RETURNING id, version`, [e.ocid, VERSION_REDACTOR, e.huella, pedidoPor]);
    id = Number(ins.rows[0].id);
    version = Number(ins.rows[0].version);
  } catch (err) {
    if (esErrorPg(err, "23505")) {
      c.header("Cache-Control", SIN_CACHE);
      return c.json({ ocid: e.ocid, estado: "generando", reintentarEn: 30 }, 202);
    }
    throw err;
  }
  const env = (c.env ?? {}) as EnvLlm & { AI?: IaWorkers };
  try {
    const r = await redactarInforme(env, env.AI, e, version);
    const conModelo = r.informe.verificacion.observacionesConTextoDelModelo > 0;
    registrar("INFO", "[informe-control] redactado", {
      ocid: e.ocid, version, modelo: r.modelo, ms: r.ms, entrada: r.entrada, salida: r.salida, costo_usd: r.costo,
      observaciones: r.informe.observaciones.length, con_modelo: r.informe.verificacion.observacionesConTextoDelModelo,
      quitadas: r.quitadas.length, motivos: r.quitadas.slice(0, 5).map((q) => `${q.observacion}: ${q.motivo}`), fallas: r.fallas.slice(0, 5),
    });
    c.header("Cache-Control", SIN_CACHE);
    if (!conModelo) {
      // El modelo no respondió para ninguna observación: el texto armado con los datos se muestra, pero no se guarda (la
      // próxima visita lo vuelve a intentar).
      await pool.query(`UPDATE informe_vigia SET estado = 'error', error = $2, costo_usd = $3, tokens_entrada = $4, tokens_salida = $5,
                                ms = $6, terminado_at = now() WHERE id = $1`,
        [id, `sin texto del modelo: ${r.fallas.slice(0, 3).join("; ")}`.slice(0, 500), r.costo, r.entrada, r.salida, r.ms]);
      if (anterior) return c.json(respuesta(e.ocid, anterior, { desactualizado: true, aviso: "La redacción automática no respondió: se muestra la versión anterior." }));
      return c.json({
        ocid: e.ocid, estado: "listo", version, generadoAt: new Date().toISOString(), modelo: null, costoUsd: r.costo,
        tokens: { entrada: r.entrada, salida: r.salida }, provisional: true,
        aviso: "La redacción automática no respondió: el texto de cada observación se armó con los datos. Vuelve a intentarlo más tarde.",
        informe: r.informe, markdown: r.markdown,
      });
    }
    const g = await pool.query(
      `UPDATE informe_vigia SET estado = 'listo', contenido = $2::jsonb, markdown = $3, modelo = $4, tokens_entrada = $5, tokens_salida = $6,
              costo_usd = $7, ms = $8, error = $9, terminado_at = now()
        WHERE id = $1
        RETURNING version, huella, contenido, markdown, modelo, tokens_entrada, tokens_salida, costo_usd, generado_at`,
      [id, JSON.stringify(r.informe), r.markdown, r.modelo, r.entrada, r.salida, r.costo, r.ms, r.fallas.length ? r.fallas.join("; ").slice(0, 500) : null]);
    anotarHuella(e.ocid, e.huella);
    return c.json(respuesta(e.ocid, g.rows[0] as Guardado));
  } catch (err) {
    await pool.query(`UPDATE informe_vigia SET estado = 'error', error = $2, terminado_at = now() WHERE id = $1`,
      [id, String((err as Error)?.message ?? err).slice(0, 500)]).catch(() => undefined);
    registrar("ERROR", `[informe-control] ${e.ocid}: ${(err as Error)?.message ?? err}`);
    c.header("Cache-Control", SIN_CACHE);
    if (anterior) return c.json(respuesta(e.ocid, anterior, { desactualizado: true, aviso: "No se pudo redactar la versión nueva: se muestra la anterior." }));
    return c.json({ error: "no_disponible", detail: "No se pudo redactar el informe en este momento. Vuelve a intentarlo en unos minutos." }, 503);
  }
}

const OCID_VALIDO = /^[\w.-]{1,64}$/;
const SIN_SENALES = {
  error: "sin_senales",
  detail: "Este contrato no tiene señales: no hay indicios que reunir en un informe para control.",
};

informeControlRouter.get("/:ocid/informe-control", optionalAuth, async (c) => {
  const ocid = c.req.param("ocid").replace(/^OECE-/i, "");
  if (!OCID_VALIDO.test(ocid)) return c.json({ error: "invalid_ocid" }, 400);
  const { listo, enCurso } = await guardadoDe(ocid);
  // Lo guardado y revisado hace poco en este proceso: sin rehacer la ficha.
  if (listo && huellaVista(ocid) === listo.huella) {
    c.header("Cache-Control", CACHE_LISTO);
    return c.json(respuesta(ocid, listo));
  }
  const e = await prepararEntradas(ocid);
  if (!e) return c.json({ error: "not_found" }, 404);
  if (!e.senales.length) {
    c.header("Cache-Control", cachePublico(600, { maxAge: 120 }));
    return c.json({ ...SIN_SENALES, ocid: e.ocid }, 404);
  }
  anotarHuella(ocid, e.huella);
  if (e.ocid !== ocid) anotarHuella(e.ocid, e.huella);
  // El guardado puede estar bajo el OCID que dio la ficha (el código SEACE redirige a su OCID).
  const guardado = e.ocid === ocid ? { listo, enCurso } : await guardadoDe(e.ocid);
  if (guardado.listo && guardado.listo.huella === e.huella) {
    c.header("Cache-Control", CACHE_LISTO);
    return c.json(respuesta(e.ocid, guardado.listo));
  }
  if (guardado.enCurso) {
    c.header("Cache-Control", SIN_CACHE);
    if (guardado.listo) return c.json(respuesta(e.ocid, guardado.listo, { desactualizado: true, aviso: "Se está redactando una versión nueva con datos más recientes." }));
    return c.json({ ocid: e.ocid, estado: "generando", reintentarEn: 30 }, 202);
  }
  const quien = quienRedacta(c);
  if (!quien) {
    // Sin cuenta: lo guardado (aunque haya datos más nuevos) o la invitación a entrar; nunca se redacta.
    c.header("Cache-Control", SIN_CACHE);
    if (guardado.listo) {
      return c.json(respuesta(e.ocid, guardado.listo, {
        desactualizado: true, aviso: "Hay datos más nuevos que esta versión: entra con tu cuenta para pedir la de hoy.",
      }));
    }
    return c.json({ ocid: e.ocid, error: "requiere_cuenta", detail: REQUIERE_CUENTA, senales: e.senales.length }, 401);
  }
  return generarYResponder(c, e, guardado.listo, false, quien.uid);
});

// Volver a redactarlo aunque nada haya cambiado (otra versión del redactor, una revisión del equipo): sólo el panel.
informeControlRouter.post("/:ocid/informe-control", async (c) => {
  c.header("Cache-Control", SIN_CACHE);
  if (!tokenAdminValido(c)) return c.json({ error: "forbidden" }, 403);
  const ocid = c.req.param("ocid").replace(/^OECE-/i, "");
  if (!OCID_VALIDO.test(ocid)) return c.json({ error: "invalid_ocid" }, 400);
  const e = await prepararEntradas(ocid);
  if (!e) return c.json({ error: "not_found" }, 404);
  if (!e.senales.length) return c.json({ ...SIN_SENALES, ocid: e.ocid }, 404);
  const { listo, enCurso } = await guardadoDe(e.ocid);
  if (enCurso) return c.json({ ocid: e.ocid, estado: "generando", reintentarEn: 30 }, 202);
  return generarYResponder(c, e, listo, true);
});
