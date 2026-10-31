/**
 * Compara el port de SERVIR (src/fuentes/servir_convocatorias.ts) con lo que sacó Python de las MISMAS respuestas reales
 * (.paridad/servir/, ver paridad_servir.py):
 *   1. Parseo: cada respuesta grabada pasa por las funciones del port en el orden de `leer_todo()`. Además, el formulario
 *      que armaría el port (campos, ViewState, botones) tiene que ser el que mandó Python.
 *   2. Sesión: leerTanda() contra una SERVIR armada con esas respuestas (la página va en la sesión, «Ver más» por fila y
 *      «Sig.»), sin red y en seco.
 *   3. Con --relay <url> (p. ej. http://127.0.0.1:8080, backend/relay-lima/relay.py corriendo en una PC en el Perú con
 *      RELAY_TOKEN; el mismo valor en RELAY_LIMA_TOKEN acá): leerTanda() en vivo por ese relay, en seco, y las plazas que
 *      también leyó Python (SERVIR pudo publicar otras entre una corrida y otra).
 *
 *   node scripts/paridad_servir.ts [--relay http://127.0.0.1:8080]
 */

import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import type { Env, ParamsCorrida } from "../src/config.ts";
import {
  botonesVerMas, botonSiguiente, campos, leerTanda, paginaDe, paginaParcial, paraGuardar, parsearDetalle, ubicacionesDelListado,
  URL_SERVIR, viewState,
} from "../src/fuentes/servir_convocatorias.ts";
import type { Plaza, RespuestaServir, Transporte } from "../src/fuentes/servir_convocatorias.ts";
import { URL_LIMA } from "../src/http.ts";

interface Grabado {
  metodo: string;
  url: string;
  datos: Record<string, string> | null;
  ajax: boolean;
  status: number;
  url_final: string;
  texto: string;
}

const leer = (n: string) => JSON.parse(readFileSync(new URL(`../.paridad/servir/${n}`, import.meta.url), "utf-8"));
const grabado = leer("transcripcion.json") as Grabado[];
const esperado = leer("esperado.json") as Plaza[];
const porAviso = new Map(esperado.map((p) => [p.aviso, p]));
const FORM = "frmLstOfertsLabo";
let fallas = 0;

function comparar(titulo: string, obtenido: Plaza[], soloComunes = false): void {
  const lista = soloComunes ? obtenido.filter((p) => porAviso.has(p.aviso)) : obtenido;
  const distintas: string[] = [];
  for (const p of lista) {
    const py = porAviso.get(p.aviso);
    if (!py) distintas.push(`${p.aviso}: no está en Python`);
    else for (const k of Object.keys(py) as (keyof Plaza)[]) if (!isDeepStrictEqual(p[k], py[k])) distintas.push(`${p.aviso}.${k}: ts=${JSON.stringify(p[k])?.slice(0, 160)} py=${JSON.stringify(py[k])?.slice(0, 160)}`);
  }
  const mismoOrden = soloComunes || isDeepStrictEqual(obtenido.map((p) => p.aviso), esperado.map((p) => p.aviso));
  const faltan = soloComunes ? [] : esperado.filter((p) => !obtenido.some((x) => x.aviso === p.aviso)).map((p) => p.aviso);
  const ok = !distintas.length && mismoOrden && !faltan.length;
  if (!ok) fallas++;
  console.log(`${ok ? "✓" : "✗"} ${titulo}: ${lista.length} plazas comparadas con Python (${esperado.length})` +
    (soloComunes ? `, ${obtenido.length - lista.length} que Python no leyó` : "") + (mismoOrden ? "" : ", en otro orden") +
    (faltan.length ? `, faltan ${faltan.join(", ")}` : ""));
  for (const d of distintas.slice(0, 20)) console.log(`    ${d}`);
}

// 1. Parseo, en el orden de leer_todo().
{
  let h = grabado[0].texto;
  const plazas = new Map<number, Plaza>();
  let formularios = 0;
  let distintos = 0;
  for (const e of grabado.slice(1)) {
    const vs = viewState(h)!;
    const f = campos(h);
    const enviado = { ...(e.datos ?? {}) };
    if (e.ajax) {
      const sig = botonSiguiente(h)!;
      const mio = { "javax.faces.partial.ajax": "true", "javax.faces.source": sig, "javax.faces.partial.execute": "@all",
        "javax.faces.partial.render": `${FORM}:mensaje ${FORM}`, [sig]: sig, [FORM]: FORM, ...f, "javax.faces.ViewState": vs };
      formularios++;
      if (!isDeepStrictEqual(mio, enviado)) distintos++;
      h = paginaParcial(e.texto, vs);
      continue;
    }
    const botones = botonesVerMas(h);
    const k = botones.findIndex((b) => Object.hasOwn(enviado, b));
    const mio = { [FORM]: FORM, ...f, [botones[k]]: "", "javax.faces.ViewState": vs };
    formularios++;
    if (!isDeepStrictEqual(mio, enviado)) distintos++;
    const d = parsearDetalle(e.texto);
    const ubic = ubicacionesDelListado(h);
    if (d) {
      if (!d.ubicacion && k < ubic.length) d.ubicacion = ubic[k];
      plazas.set(d.aviso, d);
    }
  }
  if (distintos) fallas++;
  console.log(`${distintos ? "✗" : "✓"} formularios: ${formularios - distintos}/${formularios} iguales a los que mandó Python (campos, ViewState y botón)`);
  comparar("parseo de las respuestas grabadas", [...plazas.values()]);
  const conContactos = [...plazas.values()].map(paraGuardar).filter((g) => g.quitados);
  console.log(`  datos de contacto quitados al guardar: ${conContactos.length ? conContactos.map((g) => g.plaza.aviso).join(", ") : "ninguno"}`);
}

// Un Env de mentira: R2 en memoria y el relay que diga `transporte` (o uno de verdad con --relay).
function entorno(relay?: string): { env: Env; crudos: Map<string, string> } {
  const crudos = new Map<string, string>();
  const env = {
    CRUDOS: { put: async (k: string, v: string) => void crudos.set(k, v) },
    RELAY_LIMA: relay ? { fetch: (u: string, init: RequestInit) => fetch(u.replace(URL_LIMA, relay), init) } : undefined,
    RELAY_LIMA_TOKEN: process.env.RELAY_LIMA_TOKEN,
    get HYPERDRIVE(): never {
      throw new Error("en seco no se toca la base");
    },
  } as unknown as Env;
  return { env, crudos };
}

const plazasDe = (crudos: Map<string, string>) => [...crudos.values()].flatMap((v) => (JSON.parse(v) as { plazas: Plaza[] }).plazas);
const P: ParamsCorrida = { fuente: "servir_convocatorias", origen: "paridad", seco: true };

// 2. La sesión del port contra una SERVIR armada con lo grabado.
{
  const paginas = new Map<number, string>();
  const detalles = new Map<string, string>();
  const parciales = new Map<number, string>();
  let h = grabado[0].texto;
  paginas.set(paginaDe(h)![0], h);
  for (const e of grabado.slice(1)) {
    const pg = paginaDe(h)![0];
    if (e.ajax) {
      h = paginaParcial(e.texto, viewState(h)!);
      parciales.set(paginaDe(h)![0], e.texto);
      paginas.set(paginaDe(h)![0], h);
    } else {
      const fila = /:idPnlRepeatPuestos:(\d+):/.exec(Object.keys(e.datos ?? {}).join(" "))![1];
      detalles.set(`${pg}/${fila}`, e.texto);
    }
  }
  let pagina = 1;
  const respuesta = (texto: string, url = URL_SERVIR): RespuestaServir => ({ status: 200, url, texto, cookies: {} });
  const servir: Transporte = async (p) => {
    const datos = new URLSearchParams(p.cuerpo ?? "");
    if (p.metodo === "GET") return { ...respuesta(paginas.get(pagina)!), cookies: { JSESSIONID: "repeticion" } };
    if (datos.get("javax.faces.partial.ajax")) {
      if (datos.get("javax.faces.source") !== botonSiguiente(paginas.get(pagina)!)) throw new Error("sólo se grabó «Sig.»");
      pagina++;
      return respuesta(parciales.get(pagina)!);
    }
    const fila = /:idPnlRepeatPuestos:(\d+):/.exec([...datos.keys()].join(" "))![1];
    return respuesta(detalles.get(`${pagina}/${fila}`)!, URL_SERVIR.replace("ofertas_laborales", "../consultas/detalle_ofertas_laborales"));
  };
  const { env, crudos } = entorno();
  const ultima = Math.max(...paginas.keys());
  const t = await leerTanda(env, P, { cookies: {}, pagina: 1, dia: "paridad" }, ultima, { transporte: servir, pausaMs: 0 });
  console.log(`  sesión: páginas ${t.desde}-${t.hasta}, ${t.pedidos} pedidos, ${t.resincronizaciones} resincronizaciones, ${t.sinDatos} sin datos`);
  comparar("sesión del port contra lo grabado", plazasDe(crudos));
}

// 3. En vivo, por un relay de Lima de verdad (relay.py en local).
const i = process.argv.indexOf("--relay");
if (i > 0) {
  const relay = process.argv[i + 1];
  const { env, crudos } = entorno(relay);
  const ultima = Math.max(...grabado.filter((e) => e.ajax).map((e) => paginaDe(paginaParcial(e.texto, "x"))![0]), 1);
  const t0 = Date.now();
  const t = await leerTanda(env, P, { cookies: {}, pagina: 1, dia: "paridad" }, ultima);
  console.log(`  en vivo por ${relay}: páginas ${t.desde}-${t.hasta} de ${t.paginasServir} (${t.puestos} puestos), ${t.pedidos} pedidos en ` +
    `${Math.round((Date.now() - t0) / 1000)} s, ${t.resincronizaciones} resincronizaciones, ${t.sinDatos} sin datos, cookies: ${Object.keys(t.estado.cookies).join(", ")}`);
  comparar("en vivo por el relay", plazasDe(crudos), true);
}

process.exit(fallas ? 1 : 0);
