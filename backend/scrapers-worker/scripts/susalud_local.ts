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
