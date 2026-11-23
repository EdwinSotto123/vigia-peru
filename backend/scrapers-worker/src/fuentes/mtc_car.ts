/**
 * Gobserva Car: las listas de autorizados del MTC, cada semana (lunes 08:00, src/calendario.ts). Antes se bajaban a mano
 * con frontend/scripts/car/{citv,mtc}.py y quedaban fijas en frontend/data/car; ahora esta fuente las baja, las arma
 * igual que esos scripts (mismas salidas: scripts/mtc_car_local.ts compara) y las publica en R2 `vigia-peru-reportes`,
 * en datos/car/{citv,licencia,gas}.json (medios.gobserva.cloud), de donde las lee car.gobserva.cloud
 * (frontend/lib/car-datos.ts) sin volver a desplegar la web. Los JSON de frontend/data/car quedan de respaldo.
 *
 *   CITV (revisión técnica), centros médicos, centros de evaluación, escuelas de conductores, talleres de conversión a GNV
 *   y a GLP, entidades certificadoras de GNV y de GLP, centros de revisión periódica de cilindros.
 *
 * El MTC deja bajar cada lista en Excel sin captcha (`arExportToExcel`, el botón «Exportar» de su página). Una lista por
 * segundo. Fuera del Perú responde 403 (directo desde Cloudflare y por Zúrich, 2026-11-22): va por el relay de Lima, y
 * directo o por Zúrich sólo si Lima no está.
 *
 * Privacidad, como en el resto de Gobserva: no se guarda el RUC; el nombre de una persona natural (RUC 10) no se guarda;
 * los celulares se tapan; los correos no se guardan.
 *
 * Si una lista llega con menos del 70 % de los locales que tenía (un Excel cortado, una página de error), no se publica
 * nada y la corrida queda en error: la web sigue con lo anterior. `forzar` publica igual; `seco` arma y cuenta sin publicar.
 */

import type { WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import type { Env, ParamsCorrida } from "../config.ts";
import { dormir, obtener } from "../http.ts";
import { desescaparHtml } from "../pnda.ts";
import { leerXlsx, type ValorXlsx } from "../xlsx.ts";
import { fechaLima, LECTURA } from "./comun.ts";

export const BASE = "https://rec.mtc.gob.pe";
const UA_GOBSERVA = "Gobserva-datos-abiertos/1.0 (+https://gobserva.cloud)";
/** Dónde quedan, en R2 `vigia-peru-reportes` (público en medios.gobserva.cloud). */
export const CLAVE_R2 = (nombre: string) => `datos/car/${nombre}.json`;
/** Una lista con menos de esta parte de los locales que tenía no se publica. */
const MINIMO = 0.7;

/** clave: [ruta del Excel, parámetros, página pública del MTC] (los de frontend/scripts/car). */
export const LISTAS: Record<string, [string, string, string]> = {
  citv: ["/CentroInspeccionTecnicoVehicular/arExportToExcel", "||", "/AutorizaEntiComplementarias/ArCITVConfiguracion"],
  medicos: ["/CentroMedico/arExportToExcel", "||", "/LicenciaConducir/ArCentroMedicoConfiguracion"],
  evaluacion: ["/CentroEvaluacion/arExportToExcel", "||", "/LicenciaConducir/ArCentroEvaluacionConfiguracion"],
  escuelas: ["/EscuelaConductor/arExportToExcel", "||", "/LicenciaConducir/ArEscuelaConductorConfiguracion"],
  "talleres-gnv": ["/TallerConversionGNVGLP/arExportToExcel", "1|||", "/AutorizaEntiComplementarias/ArTallerConversionGNVGLP"],
  "talleres-glp": ["/TallerConversionGNVGLP/arExportToExcel", "2|||", "/AutorizaEntiComplementarias/ArTallerConversionGNVGLP"],
  "certificadoras-gnv": ["/EntidadCertificadoraGNVGLP/arExportToExcel", "1|||", "/AutorizaEntiComplementarias/ArEntidadCertificadoraGNVGLP"],
  "certificadoras-glp": ["/EntidadCertificadoraGNVGLP/arExportToExcel", "2|||", "/AutorizaEntiComplementarias/ArEntidadCertificadoraGNVGLP"],
  cilindros: ["/CentroRevisionPeriodicaCilindro/arExportToExcel", "||", "/CentroRevisionPeriodicaCilindro/ArAutorizados"],
};

export const urlExcel = (clave: string) => `${BASE}${LISTAS[clave][0]}?pArrParametros=${encodeURIComponent(LISTAS[clave][1])}`;

// ─── Lectura (lo mismo que citv.py y mtc.py) ─────────────────────────────────────────────────────────

/** Una celda como texto, como `filas_xlsx` de citv.py: las entidades HTML decodificadas dos veces (el MTC las deja dobles). */
function texto(v: ValorXlsx): string {
  let t: string;
  if (v === null) t = "";
  else if (typeof v === "string") t = v;
  else if (typeof v === "number") t = String(v);
  else if (typeof v === "boolean") t = v ? "True" : "False";
  else if ("fechaHora" in v) t = v.fechaHora;
  else if ("hora" in v) t = v.hora;
  else t = v.duracion;
  return desescaparHtml(desescaparHtml(t)).trim();
}

export function filas(archivo: Uint8Array): string[][] {
  return leerXlsx(archivo).map((f) => f.map(texto));
}

// Un celular: 9 y ocho cifras, o siete (al MTC le faltan cifras en algunos, «97525528»: también se tapan).
const CELULAR = /(?<!\d)9\d{2}[ -]?\d{3}[ -]?\d{2,3}(?!\d)/g;

export function telefono(t: string): string | null {
  return t.replace(/\s+/g, " ").trim().replace(CELULAR, "9••••••••") || null;
}

/** «dd/mm/aaaa» (o una celda de fecha, «aaaa-mm-dd …») → «aaaa-mm-dd». */
export function fecha(t: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(t);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(t);
  return iso ? iso[1] : null;
}

function numero(t: string): number | null {
  t = t.trim();
  return /^\d+(\.0+)?$/.test(t) ? Math.trunc(Number(t)) : null;
}

export const sinTildes = (t: string) => t.normalize("NFD").replace(/\p{Mn}/gu, "").toUpperCase().trim();
const lugar = (t: string) => sinTildes(t).replace(/\s+/g, " ") || null;
const espacios = (t: string) => t.replace(/\s+/g, " ");
const alfanum = (t: string | null | undefined) => sinTildes(t ?? "").replace(/[^A-Z0-9]/g, "");

/** La fecha en que el MTC generó el archivo: en sus primeras filas. */
function generadoEn(fs: string[][]): string | null {
  for (const f of fs.slice(0, 3)) {
    const m = /(\d{4}-\d{2}-\d{2})/.exec(f.join(" "));
    if (m) return m[1];
  }
  return null;
}

export interface Centro {
  razonSocial: string;
  direccion: string | null;
  horario: string | null;
  departamento: string | null;
  provincia: string | null;
  distrito: string | null;
  telefono: string | null;
  resolucion: string | null;
  fechaResolucion: string | null;
  inicioOperacion: string | null;
  lineas: number | null;
  tipoLineas: string | null;
  diasSinTransmitir: number | null;
  sancion: string | null;
}

/** Los CITV (citv.py). */
export function leerCitv(archivo: Uint8Array): { generado: string | null; centros: Centro[] } {
  const fs = filas(archivo);
  const i = fs.findIndex((f) => f.length > 5 && f[0].toUpperCase().startsWith("N") && f[1].toUpperCase().includes("RAZ"));
  if (i < 0) throw new Error("CITV: no encontré la fila de cabeceras (¿cambió el Excel del MTC?)");
  const cab = fs[i].map((c) => c.toUpperCase());
  const col = (nombre: string) => {
    const k = cab.findIndex((c) => c.includes(nombre));
    if (k < 0) throw new Error(`CITV: falta la columna ${nombre}`);
    return k;
  };
  const c = {
    razon: col("RAZ"), direccion: col("DIRECCI"), horario: col("HORARIO"), dep: col("DEPARTAMENTO"), prov: col("PROVINCIA"),
    dist: col("DISTRITO"), tel: col("TELEFONO"), rd: col("RD"), fechaRd: col("FECHA RD"), inicio: col("INICIO"),
    lineas: col("CANTIDAD"), tipo: col("TIPO"), sinTrans: col("SIN TRANS"), sancion: col("SANCI"),
  };
  const centros: Centro[] = [];
  for (const crudo of fs.slice(i + 1)) {
    const f = [...crudo, ...Array<string>(Math.max(0, cab.length - crudo.length)).fill("")];
    if (!f[c.razon]) continue;
    centros.push({
      razonSocial: f[c.razon],
      direccion: f[c.direccion] || null,
      horario: f[c.horario].replace(/\s{2,}/g, " | ").replace(/^[ |]+|[ |]+$/g, "") || null,
      departamento: f[c.dep] || null,
      provincia: f[c.prov] || null,
      distrito: f[c.dist] || null,
      telefono: telefono(f[c.tel]),
      resolucion: f[c.rd] || null,
      fechaResolucion: fecha(f[c.fechaRd]),
      inicioOperacion: fecha(f[c.inicio]),
      lineas: numero(f[c.lineas]),
      tipoLineas: f[c.tipo] || null,
      diasSinTransmitir: numero(f[c.sinTrans]),
      sancion: f[c.sancion] || null,
    });
  }
  return { generado: generadoEn(fs), centros };
}

export interface Local {
  nombre: string | null;
  direccion: string | null;
  departamento: string | null;
  provincia: string | null;
  distrito: string | null;
  telefono: string | null;
  resolucion: string | null;
  fechaResolucion: string | null;
  tipos?: string[];
}

/** Una lista de locales (mtc.py: `leer` + `item` + sin filas repetidas). */
export function leerLista(archivo: Uint8Array): { generado: string | null; locales: Local[] } {
  const fs = filas(archivo);
  const i = fs.findIndex((f) => f.some((c) => sinTildes(c).includes("RAZ")));
  if (i < 0) throw new Error("no encontré la fila de cabeceras (¿cambió el Excel del MTC?)");
  const cab = fs[i].map(sinTildes);
  const locales: Local[] = [];
  const vistos = new Set<string>();
  for (const f of fs.slice(i + 1)) {
    if (!f.some(Boolean)) continue;
    // `col` de mtc.py: la primera cabecera que contiene alguno de los nombres, en orden.
    const col = (nombre: string) => {
      const k = cab.findIndex((c) => c.includes(nombre));
      return k < 0 ? "" : (f[k] ?? "").trim();
    };
    const nombre = espacios(col("RAZON SOCIAL"));
    if (!nombre) continue;
    const ruc = col("RUC").replace(/\D/g, "");
    const provincia = lugar(col("PROVINCIA"));
    const x: Local = {
      // Una persona natural con negocio (RUC 10): su nombre no se guarda.
      nombre: ruc.startsWith("10") ? null : nombre,
      direccion: espacios(col("DIRECCION")) || null,
      // El MTC pone «LIMA-CALLAO» a los locales del Callao en una de sus listas: van con su región, el Callao.
      departamento: provincia === "CALLAO" ? "CALLAO" : lugar(col("DEPARTAMENTO")),
      provincia,
      distrito: lugar(col("DISTRITO")),
      telefono: telefono(col("TELEFONO")),
      resolucion: espacios(col("RESOLUCION")) || null,
      fechaResolucion: fecha(col("FECHA")),
    };
    // Una misma fila repetida (el MTC lista dos veces algunos locales) sale una vez.
    const k = JSON.stringify([x.nombre, alfanum(x.direccion), x.distrito]);
    if (vistos.has(k)) continue;
    vistos.add(k);
    locales.push(x);
  }
  return { generado: generadoEn(fs), locales };
}

// ─── Armado (lo mismo que main() de mtc.py) ─────────────────────────────────────────────────────────

/** Sin claves vacías (None, "", []), como `limpio` de mtc.py. */
function limpio<T extends object>(d: T): Partial<T> {
  return Object.fromEntries(Object.entries(d).filter(([, v]) => v !== null && v !== "" && !(Array.isArray(v) && !v.length))) as Partial<T>;
}

/** El orden de `sorted(..., key=(departamento, provincia, distrito, nombre))` de Python (por puntos de código). */
function porLugar<T extends Local>(xs: T[]): T[] {
  const llave = (x: T) => [x.departamento ?? "", x.provincia ?? "", x.distrito ?? "", x.nombre ?? ""];
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return [...xs].sort((a, b) => {
    const la = llave(a), lb = llave(b);
    for (let k = 0; k < 4; k++) {
      const r = cmp(la[k], lb[k]);
      if (r) return r;
    }
    return 0;
  });
}

/** Un local que hace GNV y GLP sale una vez, con los dos tipos (mismo nombre y misma dirección). */
export function juntar(gnv: Local[], glp: Local[]): Local[] {
  const por = new Map<string, Local & { tipos: string[] }>();
  for (const [tipo, lista] of [["GNV", gnv], ["GLP", glp]] as const) {
    for (const x of lista) {
      const k = JSON.stringify([sinTildes(x.nombre ?? ""), alfanum(x.direccion)]);
      const y = por.get(k);
      if (y) {
        if (!y.tipos.includes(tipo)) y.tipos.push(tipo);
      } else por.set(k, { ...x, tipos: [tipo] });
    }
  }
  return porLugar([...por.values()]);
}

export interface Leida {
  generado: string | null;
  centros?: Centro[];
  locales?: Local[];
}

export interface Fuente {
  nombre: string;
  url: string;
  generadoAl: string | null;
}

/** Los tres JSON que lee la web, con la forma de frontend/data/car. */
export function armar(l: Record<string, Leida>) {
  const fuente = (clave: string, nombre: string): Fuente => ({ nombre, url: BASE + LISTAS[clave][2], generadoAl: l[clave].generado });
  const locales = (clave: string) => l[clave].locales ?? [];
  const sinResolucion = (xs: Local[]) =>
    xs.map(({ resolucion: _r, fechaResolucion: _f, telefono: _t, ...x }) => limpio(x));
  const citv = {
    fuente: "Centros de Inspección Técnica Vehicular autorizados (MTC)",
    url: BASE + LISTAS.citv[2],
    generadoAl: l.citv.generado,
    centros: l.citv.centros ?? [],
  };
  const licencia = {
    fuentes: {
      medicos: fuente("medicos", "Centros médicos autorizados para la licencia de conducir (MTC)"),
      evaluacion: fuente("evaluacion", "Centros de evaluación de postulantes a licencias (MTC)"),
      escuelas: fuente("escuelas", "Escuelas de conductores autorizadas (MTC)"),
    },
    medicos: sinResolucion(porLugar(locales("medicos"))),
    evaluacion: sinResolucion(porLugar(locales("evaluacion"))),
    escuelas: sinResolucion(porLugar(locales("escuelas"))),
  };
  const gas = {
    fuentes: {
      talleres: fuente("talleres-gnv", "Talleres de conversión a GNV y a GLP autorizados (MTC)"),
      certificadoras: fuente("certificadoras-gnv", "Entidades certificadoras de GNV y de GLP autorizadas (MTC)"),
      cilindros: fuente("cilindros", "Centros de revisión periódica de cilindros autorizados (MTC)"),
    },
    talleres: juntar(locales("talleres-gnv"), locales("talleres-glp")).map(limpio),
    certificadoras: juntar(locales("certificadoras-gnv"), locales("certificadoras-glp")).map(limpio),
    cilindros: porLugar(locales("cilindros")).map(limpio),
  };
  return { citv, licencia, gas };
}

export type Armado = ReturnType<typeof armar>;

/** Cuántos locales trae cada lista de cada JSON: { "citv.centros": 337, "licencia.medicos": 699, … }. */
export function conteos(a: Record<string, Record<string, unknown>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [nombre, d] of Object.entries(a)) {
    for (const [k, v] of Object.entries(d)) if (Array.isArray(v)) out[`${nombre}.${k}`] = v.length;
  }
  return out;
}

/** Las listas que se achicaron demasiado (o quedaron vacías) frente a lo publicado antes. */
export function caidas(nuevos: Record<string, number>, antes: Record<string, number>): string[] {
  return Object.entries(nuevos)
    .filter(([k, n]) => n === 0 || (antes[k] ?? 0) * MINIMO > n)
    .map(([k, n]) => `${k}: ${n} (antes ${antes[k] ?? "?"})`);
}

// ─── Corrida ────────────────────────────────────────────────────────────────────────────────────────

const esZip = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b;

/** El Excel de una lista: por el relay de Lima, directo o por el de Zúrich (el primero que dé un .xlsx). */
async function bajar(env: Env, clave: string): Promise<{ datos: Uint8Array; via: string; fallas: string[] }> {
  const url = urlExcel(clave);
  const fallas: string[] = [];
  const intentos: [string, () => Promise<Response>][] = [
    ["lima", () => obtener(env, url, { relay: "lima", timeoutMs: 120_000, sinReintentos: true })],
    ["directo", () => fetch(url, { headers: { "User-Agent": UA_GOBSERVA, Accept: "*/*" }, signal: AbortSignal.timeout(90_000) })],
    ["zurich", () => obtener(env, url, { relay: true, timeoutMs: 120_000, sinReintentos: true })],
  ];
  for (const [via, pedir] of intentos) {
    try {
      const r = await pedir();
      const datos = new Uint8Array(await r.arrayBuffer());
      if (r.ok && esZip(datos)) return { datos, via, fallas };
      fallas.push(`${via}: HTTP ${r.status}, ${datos.length} bytes${esZip(datos) ? "" : " (no es un .xlsx)"}`);
    } catch (e) {
      fallas.push(`${via}: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
    }
  }
  throw new Error(`${clave}: no pude bajar el Excel del MTC (${fallas.join("; ")})`);
}

const BAJADA: WorkflowStepConfig = { retries: { limit: 2, delay: "2 minutes", backoff: "exponential" }, timeout: "8 minutes" };

export async function correrMtcCar(env: Env, p: ParamsCorrida, step: WorkflowStep): Promise<unknown> {
  const hoy = fechaLima();
  const leidas: Record<string, Leida> = {};
  const vias: Record<string, string> = {};
  for (const clave of Object.keys(LISTAS)) {
    const r = await step.do(`bajar ${clave}`, BAJADA, async () => {
      const { datos, via, fallas } = await bajar(env, clave);
      await env.CRUDOS.put(`raw/mtc_car/${hoy}/${clave}.xlsx`, datos, {
        httpMetadata: { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      });
      const leida: Leida = clave === "citv" ? (({ generado, centros }) => ({ generado, centros }))(leerCitv(datos))
        : (({ generado, locales }) => ({ generado, locales }))(leerLista(datos));
      await dormir(1000);   // sin apuro: una lista por segundo
      // Por dónde llegó y, si no fue por Lima, por qué no.
      return { leida, via: fallas.length ? `${via} (${fallas.join("; ")})` : via };
    });
    leidas[clave] = r.leida as Leida;
    vias[clave] = r.via;
  }

  const a = armar(leidas);
  const nuevos = conteos(a as unknown as Record<string, Record<string, unknown>>);

  return step.do("publicar", LECTURA, async () => {
    const antes: Record<string, number> = {};
    if (env.MEDIOS) {
      for (const nombre of Object.keys(a)) {
        const o = await env.MEDIOS.get(CLAVE_R2(nombre));
        if (o) Object.assign(antes, conteos({ [nombre]: await o.json<Record<string, unknown>>() }));
      }
    }
    const malas = caidas(nuevos, antes);
    const resumen = { conteos: nuevos, antes, vias, generado: Object.fromEntries(Object.entries(leidas).map(([k, v]) => [k, v.generado])) };
    if (p.seco) return { ...resumen, publicado: false, motivo: "en seco", caidas: malas };
    if (malas.length && !p.forzar) {
      throw new Error(`no publico: listas que se achicaron de golpe (${malas.join("; ")}). Revisar el Excel en raw/mtc_car/${hoy}/ o correr con forzar`);
    }
    if (!env.MEDIOS) return { ...resumen, publicado: false, motivo: "sin el bucket MEDIOS (entorno dev)" };
    const actualizadoAl = new Date().toISOString();
    for (const [nombre, d] of Object.entries(a)) {
      await env.MEDIOS.put(CLAVE_R2(nombre), JSON.stringify({ ...d, actualizadoAl }), {
        httpMetadata: { contentType: "application/json; charset=utf-8", cacheControl: "public, max-age=3600" },
        customMetadata: { fuente: "mtc_car", actualizadoAl },
      });
    }
    return { ...resumen, publicado: true, actualizadoAl, caidas: malas };
  });
}
