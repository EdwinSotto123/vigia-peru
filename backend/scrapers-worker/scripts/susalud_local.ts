/**
 * Carga de SUSALUD desde una PC (relleno inicial o reproceso), con el MISMO código del Worker (src/fuentes/susalud*.ts).
 * La conexión llega en PG_URL (backend/scripts/susalud_cargar.py abre el túnel y la arma).
 *
 *   node scripts/susalud_local.ts renipress <csv>
 *   node scripts/susalud_local.ts sanciones <xlsx> <url-de-origen>
 *   node scripts/susalud_local.ts denuncias <csv> <año>
 *   node scripts/susalud_local.ts recursos <csv>
 *   node scripts/susalud_local.ts cirugias <csv>
 *   node scripts/susalud_local.ts detalle <cuántas> [hilos]   (directo a RENIPRESS: sólo desde el Perú)
 *   node scripts/susalud_local.ts refrescar
 *   node scripts/susalud_local.ts precios <FT_AAAAMM.zip>      (DIGEMID, el Indicador de precios)
 *   node scripts/susalud_local.ts alertas <cuántas>            (DIGEMID, las alertas con el texto de su PDF)
 *   node scripts/susalud_local.ts extraer <cuántas> [hilos]    (DIGEMID: los productos y lotes de cada alerta, con vigia-llm;
 *                                                               WORKERS_AI_TOKEN en el entorno)
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { registrarCarga } from "../src/cargas.ts";
import { basename } from "node:path";
import { Db } from "../src/db.ts";
import {
  cargarCirugias, cargarDenuncias, cargarRecursos, cargarRenipress, cargarSanciones, leerCirugias, leerDenuncias, leerRecursos,
  leerRenipress, leerSanciones,
} from "../src/fuentes/susalud.ts";
import { leerTanda, pendientes } from "../src/fuentes/susalud_detalle.ts";
import { alertasPorLeer, cargarZipPrecios, leerAlertas, listarAlertas, pedidorDirecto, sha256, URL_PRECIOS } from "../src/fuentes/digemid.ts";
import { alertasPorExtraer, anotarErrorExtraccion, extraerAlerta, guardarProductos } from "../src/fuentes/digemid_extraer.ts";

const [tipo, arg1, arg2] = process.argv.slice(2);
const url = process.env.PG_URL;
if (!url) throw new Error("falta PG_URL");
const nueva = () => new Db(url);
const db = nueva();
const t0 = Date.now();
try {
  const datos = () => new Uint8Array(readFileSync(arg1));
  let r: unknown;
  if (tipo === "renipress") {
    const { filas, cuenta } = leerRenipress(datos());
    r = { ...(await cargarRenipress(db, filas, basename(arg1))), ...cuenta };
  } else if (tipo === "sanciones") {
    const { filas, infracciones, cuenta } = leerSanciones(datos());
    r = { ...(await cargarSanciones(db, filas, infracciones, basename(arg1), arg2 ?? "")), ...cuenta };
  } else if (tipo === "denuncias") {
    const { filas, cuenta } = leerDenuncias(datos(), Number(arg2));
    r = { ...(await cargarDenuncias(db, filas, Number(arg2), basename(arg1))), leidas: cuenta.leidas };
  } else if (tipo === "recursos") {
    r = { filas: await cargarRecursos(db, leerRecursos(datos()), basename(arg1)) };
  } else if (tipo === "cirugias") {
    r = { filas: await cargarCirugias(db, leerCirugias(datos()), basename(arg1)) };
  } else if (tipo === "detalle") {
    const total = Number(arg1 ?? 200);
    // SUSALUD responde 429 con más de un hilo (2026-11-20): uno solo, a su ritmo.
    const hilos = Math.max(1, Math.min(Number(arg2 ?? 1), 2));
    const suma: Record<string, number> = {};
    // Cada hilo con su conexión y su sesión; toman de a 40 (pendientes() con OFFSET por hilo para no pisarse).
    let hechas = 0;
    const tomadas = new Set<string>();
    await Promise.all(Array.from({ length: hilos }, async () => {
      const d = nueva();
      try {
        while (hechas < total) {
          const lote = (await pendientes(d, 40 * hilos + 40)).filter((c) => !tomadas.has(c)).slice(0, 40);
          if (!lote.length) break;
          lote.forEach((c) => tomadas.add(c));
          const c = await leerTanda(null, d, lote);
          for (const [k, v] of Object.entries(c)) suma[k] = (suma[k] ?? 0) + v;
          hechas += lote.length;
          console.log(`  ${hechas}/${total} ${JSON.stringify(suma)} ${((Date.now() - t0) / 1000).toFixed(0)} s`);
        }
      } finally {
        await d.cerrar();
      }
    }));
    r = suma;
  } else if (tipo === "precios") {
    const bytes = datos();
    const am = /FT_(\d{6})\.zip$/i.exec(arg1)?.[1];
    if (!am) throw new Error("el archivo se llama FT_AAAAMM.zip");
    r = await cargarZipPrecios(db, bytes, await sha256(bytes), am, URL_PRECIOS(am), { forzar: arg2 === "forzar" });
  } else if (tipo === "alertas") {
    // `alertas <cuántas> sinpdf`: sólo las entradas (el PDF queda pendiente); `alertas <cuántas>`: con el PDF, de a una,
    // y si DIGEMID sigue con 429, espera 15 minutos y sigue (hasta 12 veces).
    const conPdf = arg2 !== "sinpdf";
    // Sin PDF se guardan todas las entradas (rehace el texto de cada una); con PDF, sólo las que faltan.
    const entradas = await listarAlertas(pedidorDirecto, Number(arg1 ?? 100));
    const lista = conPdf ? await alertasPorLeer(db, entradas) : entradas;
    const suma: Record<string, number> = {};
    let cortes = 0;
    for (let k = 0; k < lista.length; ) {
      const tanda = lista.slice(k, k + 20);
      const c = await leerAlertas(pedidorDirecto, db, tanda, conPdf);
      for (const [x, v] of Object.entries(c)) suma[x] = (suma[x] ?? 0) + v;
      const hechas = (c.leidas ?? 0) + (c.pdf_fallido ?? 0);
      k += c.cortada ? hechas : tanda.length;
      console.log(`  ${k}/${lista.length} ${JSON.stringify(suma)} ${((Date.now() - t0) / 1000).toFixed(0)} s`);
      if (c.cortada) {
        if (++cortes > 12) { console.log("  DIGEMID sigue con 429: se corta aquí"); break; }
        console.log("  DIGEMID pide bajar el ritmo: 15 minutos de espera");
        await new Promise((ok) => setTimeout(ok, 15 * 60_000));
      }
    }
    r = { por_leer: lista.length, ...suma };
  } else if (tipo === "extraer") {
    const token = process.env.WORKERS_AI_TOKEN;
    if (!token) throw new Error("falta WORKERS_AI_TOKEN (el LLM_TOKEN de vigia-llm)");
    const pedir = (cuerpo: unknown) => fetch("https://vigia-llm.vigiaperu.workers.dev/v1/chat/completions", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(120_000),
    });
    const total = Number(arg1 ?? 100);
    const hilos = Math.max(1, Math.min(Number(arg2 ?? 4), 6));
    const lista = await alertasPorExtraer(db, total);
    const suma: Record<string, number> = { alertas: 0, con_productos: 0, filas: 0, errores: 0 };
    let k = 0;
    await Promise.all(Array.from({ length: hilos }, async () => {
      const d = nueva();
      try {
        while (k < lista.length) {
          const a = lista[k++];
          try {
            const { productos, modelo } = await extraerAlerta(pedir, a);
            suma.filas += await guardarProductos(d, a.id, productos, modelo, a.huella);
            suma.alertas++;
            if (productos.length) suma.con_productos++;
          } catch (e) {
            suma.errores++;
            await anotarErrorExtraccion(d, a.id, (e as Error).message);
          }
          if ((suma.alertas + suma.errores) % 25 === 0) console.log(`  ${suma.alertas + suma.errores}/${lista.length} ${JSON.stringify(suma)} ${((Date.now() - t0) / 1000).toFixed(0)} s`);
        }
      } finally {
        await d.cerrar();
      }
    }));
    r = { por_extraer: lista.length, ...suma };
  } else if (tipo === "refrescar") {
    r = (await db.filas<{ r: unknown }>("SELECT salud_refrescar() AS r"))[0]?.r;
  } else {
    throw new Error(`tipo desconocido: ${tipo}`);
  }
  // Lo cargado queda en datasets_cargas como si lo hubiera cargado el Worker (la web muestra fecha y sha256 de cada archivo).
  const TABLA: Record<string, string> = { renipress: "salud_ipress", sanciones: "salud_sancion", denuncias: "salud_denuncia_anual", recursos: "salud_recursos", cirugias: "salud_cirugia_mes" };
  if (TABLA[tipo] && arg1) {
    const bytes = readFileSync(arg1);
    const am = /(\d{4})_(\d{1,2})\.csv$/i.exec(arg1);
    const clave = tipo === "denuncias" ? `denuncias_${arg2}` : tipo === "recursos" || tipo === "cirugias" ? `${tipo}_${am?.[1]}_${Number(am?.[2])}` : tipo;
    await registrarCarga(db, {
      fuente: "susalud", clave, tabla: TABLA[tipo], archivo: basename(arg1), sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length, filas: Number((r as Record<string, unknown>)?.ipress ?? (r as Record<string, unknown>)?.sanciones ?? (r as Record<string, unknown>)?.filas ?? (r as Record<string, unknown>)?.instituciones ?? 0) || null,
      fuente_url: process.env.FUENTE_URL ?? null, descargado_at: new Date().toISOString(),
    });
  }
  console.log(JSON.stringify({ tipo, archivo: arg1 ? basename(arg1) : null, segundos: Math.round((Date.now() - t0) / 1000), r }));
} finally {
  await db.cerrar();
}
