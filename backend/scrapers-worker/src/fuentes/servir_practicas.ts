/**
 * SERVIR Talento Perú, «Prácticas» (`modalidades_formativas.xhtml`) → `servir_practica` (migración 271): las prácticas
 * preprofesionales y profesionales que publican las entidades, con su subvención, duración, horario, cronograma y el
 * correo institucional por el que se postula.
 *
 * Es el mismo motor JSF de `servir_convocatorias.ts` (misma sesión, mismos «Ver más» y paginador), con otro formulario
 * (`frmLstModFormativas`) y otro detalle (`detalle_modalidades_formativas.xhtml`). El detalle de una práctica NO trae
 * número de aviso: la identidad es entidad + número de convocatoria + año + título + unidad orgánica (`clavePractica`).
 *
 * Se lee entera todos los días: son ~10 páginas y ~100 prácticas (unos 110 pedidos, ~2 minutos con la pausa), no las
 * ~3 300 plazas CAS. No hace falta el incremental de las ofertas laborales. El listado trae el tipo de modalidad, la
 * ubicación y las fechas; el detalle, la unidad, las actividades, los requisitos, los beneficios y el cronograma.
 *
 * Privacidad: una práctica no nombra a nadie. De los textos se quitan correos y teléfonos (`sinContactos`); el correo
 * institucional del detalle (`.gob.pe`/`.edu.pe`) se conserva aparte porque es el canal de postulación, no un dato
 * personal.
 */

import type { WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import { registrarCarga } from "../cargas.ts";
import type { Env, ParamsCorrida } from "../config.ts";
import { conDb } from "../db.ts";
import { strip } from "../py.ts";
import { registrar } from "../registro.ts";
import { CARGA, esperarRelayLima, fechaLima } from "./comun.ts";
import {
  boton, botonesVerMas, campos, fecha, limpio, monto, paginaDe, SesionServir, sinContactos, transporteLima, viewState,
} from "./servir_convocatorias.ts";
import type { ConfigJsf, Listado, Transporte } from "./servir_convocatorias.ts";

const FUENTE = "servir_practicas";
export const URL_PRACTICAS = "https://app.servir.gob.pe/DifusionOfertasExterno/faces/consultas/modalidades_formativas.xhtml";
const ORIGEN = "https://app.servir.gob.pe";
export const FORM_PRACTICAS = "frmLstModFormativas";
/** Una página por paso: 10 detalles, ~20 s. Si una página falla, se reintenta sin repetir las anteriores. */
export const PAGINAS_POR_PASO = 1;
const PASO: WorkflowStepConfig = { retries: { limit: 3, delay: "2 minutes", backoff: "exponential" }, timeout: "10 minutes" };
const MAX_INT = 2_147_483_647;

/** Una fila del listado: lo que dice de la práctica sin abrir el detalle. */
export interface FilaPractica {
  titulo: string | null;
  entidad: string | null;
  tipo_modalidad: string | null;
  ubicacion: string | null;
  numero: string | null;
  vacantes: number | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
}

/** Una práctica como se guarda en `servir_practica`. */
export interface Practica {
  clave: string;
  titulo: string;
  entidad: string;
  modalidad: "practica_pre" | "practica_pro" | "otra";
  tipo_modalidad: string | null;
  ubicacion: string | null;
  numero: string | null;
  anio: number | null;
  vacantes: number | null;
  subvencion: number | null;
  duracion_meses: number | null;
  jornada_horas: number | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  unidad_organica: string | null;
  direccion: string | null;
  actividades: string[];
  requerimientos: string[];
  conocimientos: string | null;
  beneficios: Record<string, unknown> | null;
  cronograma: { etapa: string; inicio: string | null; fin: string | null }[];
  correo: string | null;
  web: string | null;
  detalle_url: string | null;
}

const norm = (t: string | null | undefined) =>
  (t ?? "").normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

/** El tipo de práctica: primero «pre», porque «PRE PROFESIONAL» también contiene «PROFESIONAL». */
export function modalidadDe(tipo: string | null | undefined, titulo: string | null | undefined): Practica["modalidad"] {
  const t = norm(`${tipo ?? ""} ${titulo ?? ""}`);
  if (/\bPRE ?PROFESIONAL|\bTECNIC|\bAUXILIAR/.test(t)) return "practica_pre";
  if (/\bPROFESIONAL/.test(t)) return "practica_pro";
  return "otra";
}

/**
 * La llave de una práctica. No hay número de aviso: entidad + número de convocatoria + año + título + unidad orgánica,
 * normalizados. La unidad sólo viene en el detalle; el listado se usa para reconocer la fila, no para la llave.
 */
export function clavePractica(p: Pick<Practica, "entidad" | "numero" | "anio" | "titulo" | "unidad_organica">): string {
  const anio = p.anio ?? (Number(/20\d{2}/.exec(p.numero ?? "")?.[0] ?? "") || "");
  return [norm(p.entidad), norm(p.numero), String(anio), norm(p.titulo), norm(p.unidad_organica)].join("|").slice(0, 400);
}

/** La huella de una fila del listado (para no confundir dos prácticas iguales si algún día se lee incremental). */
export function huellaFilaPractica(f: FilaPractica): string {
  return [norm(f.titulo), norm(f.entidad), norm(f.tipo_modalidad), norm(f.numero), norm(f.ubicacion),
    f.vacantes ?? "", f.fecha_inicio ?? "", f.fecha_fin ?? ""].join("|");
}

function numeroDe(t: string | null | undefined): number | null {
  const m = /\d+/.exec(t ?? "");
  const n = m ? Number(m[0]) : null;
  return n !== null && n <= MAX_INT ? n : null;
}

/** Las tarjetas del listado, en orden. */
export function filasPracticas(h: string): FilaPractica[] {
  return h.split(/class="[^"]*cuadro-vacantes"/).slice(1).map((b) => {
    const dato = (et: string) => limpio(new RegExp(`${et}\\s*:\\s*</div>\\s*<div class="[^"]*detalle-sp">([\\s\\S]*?)</div>`, "s").exec(b)?.[1]);
    return {
      titulo: limpio(/titulo-vacante[^>]*><label>(.*?)<\/label>/s.exec(b)?.[1]),
      entidad: limpio(/nombre-entidad[^>]*>([\s\S]*?)<\/div>/s.exec(b)?.[1]),
      tipo_modalidad: dato("Tipo de Modalidad"),
      ubicacion: dato("Ubicaci.n"),
      numero: dato("N.mero\\s+de\\s+Convocatoria"),
      vacantes: numeroDe(dato("N.mero\\s+de\\s+Vacante")),
      fecha_inicio: fecha(dato("Inicio\\s+de\\s+Publicaci.n")),
      fecha_fin: fecha(dato("Cierre\\s+de\\s+Publicaci.n")),
    };
  });
}

/** Una lista `<ul>` que sigue a un subtítulo (`Actividades`, `Requerimientos`, `Beneficios`…). */
function itemsDe(h: string, titulo: string): string[] {
  const bloque = new RegExp(`<span class="sub-titulo-2">\\s*${titulo}\\s*</span>([\\s\\S]*?)</ul>`, "i").exec(h)?.[1] ?? "";
  return [...bloque.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => limpio(m[1])).filter((x): x is string => !!x);
}

/** Un campo de dos columnas del detalle (`Unidad Orgánica`, `Dirección`). */
function campoDetalle(h: string, etiqueta: string): string | null {
  return limpio(new RegExp(`<div class="col-sm-2 sub-titulo-2">\\s*${etiqueta}\\s*</div>\\s*<div class="col-sm-10 detalle-sp">([\\s\\S]*?)</div>`, "i").exec(h)?.[1]);
}

/** Un campo del resumen o del contacto (`Número de Convocatoria`, `Correo Electrónico`…). */
function campoResumen(h: string, etiqueta: string): string | null {
  return limpio(new RegExp(`<div class="col-sm-5 sub-titulo">\\s*(?:<p>)?\\s*${etiqueta}\\s*:?\\s*(?:</p>)?\\s*</div>\\s*<div class="col-sm-7 detalle-sp">([\\s\\S]*?)</div>`, "i").exec(h)?.[1]);
}

/** El bloque entre dos títulos (`Cronograma` → `Contacto`). */
function entre(h: string, desde: string, hasta: string): string {
  const i = h.indexOf(desde);
  if (i < 0) return "";
  const j = h.indexOf(hasta, i + desde.length);
  return h.slice(i, j < 0 ? undefined : j);
}

/** El cronograma del detalle: etapa, fecha de inicio y fecha de fin (sin la fila de encabezado). */
export function cronogramaPractica(h: string): Practica["cronograma"] {
  const bloque = entre(h, "Cronograma", "Contacto");
  return bloque.split(/<div class="row box-mb">/).slice(1).flatMap((b) => {
    const cols = [...b.matchAll(/<div class="col-sm-4 (sub-titulo|detalle-sp)">\s*([\s\S]*?)<\/div>/g)];
    if (cols.length < 3 || cols[0][1] !== "sub-titulo" || cols[1][1] !== "detalle-sp" || cols[2][1] !== "detalle-sp") return [];
    const etapa = limpio(cols[0][2]) ?? "";
    if (!etapa || /^Etapa$/i.test(etapa)) return [];
    return [{ etapa, inicio: fecha(limpio(cols[1][2])), fin: fecha(limpio(cols[2][2])) }];
  });
}

/** El correo institucional del detalle: sólo `.gob.pe` o `.edu.pe` (el canal de postulación, no un dato personal). */
export function correoInstitucional(t: string | null | undefined): string | null {
  const m = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.(?:gob|edu)\.pe\b/i.exec(t ?? "");
  return m ? m[0].toLowerCase() : null;
}

/** Los beneficios, en un objeto (subvención, duración, jornada y horarios) y el texto completo. */
export function beneficiosPractica(h: string): { beneficios: Record<string, unknown> | null; subvencion: number | null; duracion: number | null; jornada: number | null } {
  const items = itemsDe(h, "Beneficios");
  if (!items.length) return { beneficios: null, subvencion: null, duracion: null, jornada: null };
  const texto = items.join(" ");
  const subvencion = monto(/Subvenci[oó]n[^.]*?S\/[^.]*?(?:\d[\d.,]*)/i.exec(texto)?.[0]);
  const duracion = Number(/(\d+)\s*mes(?:\(es\)|es)?\s+de\s+duraci[oó]n/i.exec(texto)?.[1] ?? "") || null;
  const jornada = Number(/(\d+(?:[.,]\d+)?)\s*horas\s+semanales/i.exec(texto)?.[1]?.replace(",", ".") ?? "") || null;
  const horario = (etiqueta: string) => limpio(new RegExp(`${etiqueta}\\s*([0-9]{1,2}:[0-9]{2}\\s*(?:AM|PM)?)`, "i").exec(texto)?.[1]);
  return {
    beneficios: {
      subvencion, duracion_meses: duracion, jornada_horas: jornada,
      horario_ingreso: horario("Horario de Ingreso de Pr[aá]cticas"), horario_salida: horario("Horario de Salida de Pr[aá]cticas"),
      texto: items,
    },
    subvencion, duracion, jornada,
  };
}

/** El detalle de una práctica. null si no es un detalle legible (sin título, entidad o número). */
export function parsearDetallePractica(h: string): Practica | null {
  const titulo = limpio(/class="sp-aviso0">([\s\S]*?)<\/div>/i.exec(h)?.[1]);
  const entidad = limpio(/class="sp-aviso">([\s\S]*?)<\/div>/i.exec(h)?.[1]);
  const numero = campoResumen(h, "N.mero de Convocatoria");
  if (!titulo || !entidad || !numero) return null;
  const anio = Number(campoResumen(h, "A.o de Convocatoria") ?? /20\d{2}/.exec(numero)?.[0] ?? "") || null;
  const vacantes = numeroDe(campoResumen(h, "N.mero de Vacante"));
  const cronograma = cronogramaPractica(h);
  const difusion = cronograma.find((x) => /difusi/i.test(x.etapa));
  const b = beneficiosPractica(h);
  const contacto = entre(h, "Contacto", "Imprimir aviso");
  const web = /<a\b[^>]*href="(https?:\/\/[^"]+)"/i.exec(contacto)?.[1] ?? null;
  const correo = correoInstitucional(campoResumen(h, "Correo Electr[oó]nico") ?? contacto);
  const p: Practica = {
    clave: "",
    titulo, entidad, modalidad: modalidadDe(null, titulo), tipo_modalidad: null,
    ubicacion: null, numero, anio, vacantes,
    subvencion: b.subvencion, duracion_meses: b.duracion, jornada_horas: b.jornada,
    fecha_inicio: difusion?.inicio ?? null, fecha_fin: difusion?.fin ?? null,
    unidad_organica: campoDetalle(h, "Unidad Org.nica"), direccion: campoDetalle(h, "Direcci.n"),
    actividades: itemsDe(h, "Actividades"), requerimientos: itemsDe(h, "Requerimientos"),
    conocimientos: itemsDe(h, "Conocimientos B.sicos").join(" ") || null,
    beneficios: b.beneficios, cronograma, correo, web: web ? strip(web) : null,
    detalle_url: URL_PRACTICAS,
  };
  p.clave = clavePractica(p);
  return p;
}

/** El listado de prácticas (misma forma que el de CAS, con `html` para volver a leer sus filas). */
export function parsearListadoPracticas(h: string): Listado | null {
  const pg = paginaDe(h);
  const vista = viewState(h);
  if (!pg || !vista || !h.includes(`id="${FORM_PRACTICAS}"`)) return null;
  const filas = filasPracticas(h);
  const botones: Listado["botones"] = {};
  for (const b of ["primero", "atras", "siguiente", "ultimo"] as const) {
    const id = boton(h, b, FORM_PRACTICAS);
    if (id) botones[b] = id;
  }
  return {
    pagina: pg[0], paginas: pg[1], vista, campos: campos(h, FORM_PRACTICAS),
    verMas: botonesVerMas(h, FORM_PRACTICAS), ubicaciones: filas.map((f) => f.ubicacion), titulos: filas.map((f) => f.titulo),
    huellas: filas.map(huellaFilaPractica), botones, puestos: null, html: h,
  };
}

/** La fuente de prácticas para el motor JSF. */
export const FUENTE_PRACTICAS: ConfigJsf<Practica> = {
  form: FORM_PRACTICAS, url: URL_PRACTICAS, origen: ORIGEN,
  marcaUrl: "detalle_modalidades_formativas", marcaHtml: "frmDetaModFormat",
  parsearListado: parsearListadoPracticas,
  parsearDetalle: parsearDetallePractica,
  tituloListado: (l, fila) => l.titulos[fila] ?? null,
  tituloDetalle: (d) => d.titulo,
  completar: (d, l, k) => {
    const f = filasPracticas(l.html)[k];
    if (!f) return;
    d.tipo_modalidad = f.tipo_modalidad;
    d.modalidad = modalidadDe(f.tipo_modalidad, d.titulo);
    d.ubicacion = d.ubicacion ?? f.ubicacion;
    d.fecha_inicio = f.fecha_inicio ?? d.fecha_inicio;
    d.fecha_fin = f.fecha_fin ?? d.fecha_fin;
    d.numero = d.numero ?? f.numero;
    // Las vacantes, de la tarjeta de su fila (el detalle repite el dato y a veces no lo trae).
    d.vacantes = f.vacantes ?? d.vacantes;
  },
};

/** Lo que se guarda, sin contactos en los textos libres y sin NUL (Postgres no los acepta). */
export function paraGuardarPractica(p: Practica): { practica: Practica; quitados: number } {
  const q: Practica = { ...p, actividades: [...p.actividades], requerimientos: [...p.requerimientos], cronograma: p.cronograma.map((x) => ({ ...x })) };
  let quitados = 0;
  for (const campo of ["titulo", "unidad_organica", "direccion", "conocimientos"] as const) {
    if (q[campo] == null) continue;
    const r = sinContactos(q[campo]!);
    quitados += r.quitados;
    (q as unknown as Record<string, string | null>)[campo] = r.texto;
  }
  for (const campo of ["actividades", "requerimientos"] as const) {
    q[campo] = q[campo].map((t) => {
      const r = sinContactos(t);
      quitados += r.quitados;
      return r.texto;
    });
  }
  if (q.beneficios) {
    const r = sinContactos(JSON.stringify(q.beneficios));
    quitados += r.quitados;
    try {
      q.beneficios = JSON.parse(r.texto) as Record<string, unknown>;
    } catch {
      q.beneficios = { ...q.beneficios, texto_limpio: r.texto };
    }
  }
  // El correo de contacto se conserva sólo si es institucional; la web, si es http(s).
  q.correo = correoInstitucional(q.correo);
  q.web = q.web && /^https?:\/\//i.test(q.web) ? q.web : null;
  for (const [k, v] of Object.entries(q)) if (typeof v === "string" && v.includes("\u0000")) (q as unknown as Record<string, string>)[k] = v.replaceAll("\u0000", "");
  return { practica: q, quitados };
}

// ── La carga ────────────────────────────────────────────────────────────────────────────────────────────────────────
const COLS = ["clave", "titulo", "entidad", "modalidad", "tipo_modalidad", "ubicacion", "numero", "anio", "vacantes", "subvencion",
  "duracion_meses", "jornada_horas", "fecha_inicio", "fecha_fin", "unidad_organica", "direccion", "actividades", "requerimientos",
  "conocimientos", "beneficios", "cronograma", "correo", "web", "detalle_url"] as const;
const ACTUALIZABLES = COLS.filter((c) => c !== "clave");

/** Upsert por `clave`: lo que sigue publicado renueva `ultima_vez`; lo que desaparece no se borra. */
export const SQL_UPSERT = `
  WITH x AS (
    SELECT * FROM jsonb_to_recordset($1::jsonb) AS x (
      clave TEXT, titulo TEXT, entidad TEXT, modalidad TEXT, tipo_modalidad TEXT, ubicacion TEXT, numero TEXT, anio INT,
      vacantes INT, subvencion NUMERIC, duracion_meses INT, jornada_horas NUMERIC, fecha_inicio DATE, fecha_fin DATE,
      unidad_organica TEXT, direccion TEXT, actividades JSONB, requerimientos JSONB, conocimientos TEXT, beneficios JSONB,
      cronograma JSONB, correo TEXT, web TEXT, detalle_url TEXT)),
  up AS (
    INSERT INTO servir_practica AS p (${COLS.join(", ")})
    SELECT ${COLS.join(", ")} FROM x
    ON CONFLICT (clave) DO UPDATE SET ${ACTUALIZABLES.map((c) => `${c} = EXCLUDED.${c}`).join(", ")}, ultima_vez = now()
    RETURNING p.clave, (p.xmax = 0) AS nueva)
  SELECT count(*) FILTER (WHERE up.nueva)::int AS nuevas, count(*) FILTER (WHERE NOT up.nueva)::int AS actualizadas FROM up`;

/** Lo que pasa de una página a la siguiente: las cookies de la sesión, la página que toca y el día. */
export interface EstadoPracticas {
  cookies: Record<string, string>;
  pagina: number;
  dia: string;
}

export interface TandaPracticas {
  estado: EstadoPracticas;
  terminado: boolean;
  desde: number;
  hasta: number;
  paginasServir: number;
  claves: string[];
  sinDatos: number;
  quitados: number;
  nuevas: number;
  actualizadas: number;
  pedidos: number;
  resincronizaciones: number;
}

export interface OpcionesPracticas {
  pausaMs?: number;
  limiteMs?: number;
  /** Para las pruebas: otra SERVIR en vez del relay de Lima. */
  transporte?: Transporte;
}

/** Una página: sus 10 prácticas al detalle, a R2 y a la base. */
export async function leerPaginaPracticas(env: Env, p: ParamsCorrida, estado: EstadoPracticas, op: OpcionesPracticas = {}): Promise<TandaPracticas> {
  const ses = new SesionServir<Practica>(op.transporte ?? transporteLima(env), estado.cookies, { ...op, fuente: FUENTE_PRACTICAS });
  const abierta = await ses.abrir();
  if (estado.pagina > abierta.paginas) {
    return { estado: { ...estado, cookies: ses.cookies }, terminado: true, desde: estado.pagina, hasta: estado.pagina - 1,
      paginasServir: abierta.paginas, claves: [], sinDatos: 0, quitados: 0, nuevas: 0, actualizadas: 0, pedidos: ses.pedidos, resincronizaciones: 0 };
  }
  const l = await ses.irA(estado.pagina);
  const desde = l.pagina;
  const practicas = new Map<string, Practica>();
  let sinDatos = 0;
  let quitados = 0;
  for (let k = 0; k < l.verMas.length; k++) {
    const d = await ses.plaza(k);
    if (!d) {
      sinDatos++;
      continue;
    }
    const g = paraGuardarPractica(d);
    quitados += g.quitados;
    practicas.set(g.practica.clave, g.practica);
  }
  const lista = [...practicas.values()];
  const claveR2 = `raw/${FUENTE}/${estado.dia}/pagina-${String(desde).padStart(3, "0")}.json`;
  await env.CRUDOS.put(claveR2, JSON.stringify({ url: URL_PRACTICAS, pagina: desde, paginas: l.paginas,
    descargado_at: new Date().toISOString(), practicas: lista }), { httpMetadata: { contentType: "application/json" } });
  let cuentas = { nuevas: 0, actualizadas: 0 };
  if (!p.seco && lista.length) {
    cuentas = (await conDb(env.HYPERDRIVE, (db) => db.filas<typeof cuentas>(SQL_UPSERT, [JSON.stringify(lista)])))[0] ?? cuentas;
  }
  return {
    estado: { cookies: ses.cookies, pagina: desde + 1, dia: estado.dia },
    terminado: desde >= l.paginas, desde, hasta: desde, paginasServir: l.paginas,
    claves: lista.map((x) => x.clave), sinDatos, quitados, ...cuentas, pedidos: ses.pedidos, resincronizaciones: ses.resincronizaciones,
  };
}

/** Una corrida completa: página por página (cada una en su paso de Workflows). */
export async function correrPracticas(env: Env, p: ParamsCorrida, step: WorkflowStep, id: string, op: OpcionesPracticas = {}): Promise<unknown> {
  await esperarRelayLima(env, step, FUENTE);
  const primera = paginaParamPracticas(p.desde) ?? 1;
  const ultima = paginaParamPracticas(p.hasta);
  let estado: EstadoPracticas = { cookies: {}, pagina: primera, dia: fechaLima() };
  const claves = new Set<string>();
  const r = { paginas: 0, paginas_servir: 0, practicas: 0, nuevas: 0, actualizadas: 0, sin_datos: 0, contactos_quitados: 0, pedidos: 0, resincronizaciones: 0 };
  let error: unknown = null;
  for (let ini = primera; ; ini = estado.pagina) {
    const desdeEstado = estado;
    let t: TandaPracticas;
    try {
      t = await step.do(`página ${ini}`, PASO, () => leerPaginaPracticas(env, p, desdeEstado, op));
    } catch (e) {
      error = e;
      break;
    }
    estado = t.estado;
    for (const c of t.claves) claves.add(c);
    r.paginas += t.hasta >= t.desde ? t.hasta - t.desde + 1 : 0;
    r.paginas_servir = t.paginasServir;
    r.nuevas += t.nuevas;
    r.actualizadas += t.actualizadas;
    r.sin_datos += t.sinDatos;
    r.contactos_quitados += t.quitados;
    r.pedidos += t.pedidos;
    r.resincronizaciones += t.resincronizaciones;
    registrar("INFO", `   página ${t.desde} de ${t.paginasServir}: ${t.claves.length} prácticas` + (p.seco ? "" : `, ${t.nuevas} nuevas`), { fuente: FUENTE, instancia: id });
    if (t.terminado || (ultima !== null && t.hasta >= ultima)) break;
  }
  const resumen: Record<string, unknown> = { ...r, practicas: claves.size, seco: !!p.seco };
  if (!p.seco && claves.size) {
    const dia = estado.dia;
    const huella = [...claves].sort().join(",");
    resumen.base = await step.do("registrar carga", CARGA, () => conDb(env.HYPERDRIVE, async (db) => {
      const [c] = await db.filas<{ total: number; abiertas: number }>(
        `SELECT count(*)::int AS total,
                (count(*) FILTER (WHERE fecha_fin >= (now() AT TIME ZONE 'America/Lima')::date))::int AS abiertas
           FROM servir_practica`);
      if (!error) {
        const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(huella));
        await registrarCarga(db, {
          fuente: FUENTE, clave: dia, tabla: "servir_practica", archivo: `raw/${FUENTE}/${dia}/`,
          sha256: [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join(""), filas: claves.size, fuente_url: URL_PRACTICAS,
          descargado_at: new Date().toISOString(),
        });
      }
      return c;
    }));
    registrar("INFO", `   prácticas: ${claves.size} leídas (${r.nuevas} nuevas); en la base ${JSON.stringify(resumen.base)}`, { fuente: FUENTE, instancia: id });
  }
  if (error) throw error;
  return resumen;
}

/** `desde`/`hasta` como página del listado (un entero desde 1, «3» o «0003»). */
export function paginaParamPracticas(v: unknown): number | null {
  const t = typeof v === "string" || typeof v === "number" ? String(v).trim() : "";
  return /^\d{1,4}$/.test(t) && Number(t) >= 1 ? Number(t) : null;
}
