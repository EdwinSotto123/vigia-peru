#!/usr/bin/env node
/*
 * Auditoría de DENSIDAD de la app interna y del panel admin. Orquesta el CLI `agent-browser`: abre cada ruta en
 * escritorio (1440x900) y móvil (390x844), mide con medir.js (cajas ralas, huecos, min-height forzada, vacío
 * del primer viewport, tablas), guarda una captura y escribe un informe Markdown ordenado por "puntaje de
 * desperdicio".
 *
 *   node frontend/scripts/auditoria-ui/auditar.mjs                      # todo (app y admin), etiqueta "ultima"
 *   node frontend/scripts/auditoria-ui/auditar.mjs --rutas app,admin --salida docs/auditoria-ui
 *   node frontend/scripts/auditoria-ui/auditar.mjs --solo app-mapa,admin-pagos --etiqueta prueba
 *   node frontend/scripts/auditoria-ui/auditar.mjs --etiqueta linea-base --comparar ninguna
 *
 * Opciones: ver README.md de esta carpeta. Requiere el frontend corriendo (por defecto http://localhost:3300).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VIEWPORTS, ids as idsRespaldo, rutas as armarRutas } from "./rutas.mjs";
import { firmarCookieAdmin, tokenApiAdmin } from "./sesion-admin.mjs";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.resolve(aqui, "..", "..");
const raiz = path.resolve(frontend, "..");

// ── Opciones ──────────────────────────────────────────────────────────────────────────────────
function leerArgs(argv) {
  const o = {
    base: "http://localhost:3300",
    api: "https://vigia-api.vigiaperu.workers.dev",
    rutas: "app,admin",
    solo: null,
    salida: path.join(raiz, "docs", "auditoria-ui"),
    etiqueta: "ultima",
    comparar: "linea-base",
    captura: true,
    espera: 1800,
    anchos: null,
    sesion: "auditoria-ui",
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const sig = () => argv[++i];
    if (a === "--base") o.base = sig();
    else if (a === "--api") o.api = sig();
    else if (a === "--rutas") o.rutas = sig();
    else if (a === "--solo") o.solo = sig();
    else if (a === "--salida") o.salida = path.resolve(sig());
    else if (a === "--etiqueta") o.etiqueta = sig();
    else if (a === "--comparar") o.comparar = sig();
    else if (a === "--sin-captura") o.captura = false;
    else if (a === "--espera") o.espera = Number(sig());
    else if (a === "--anchos") o.anchos = sig().split(",");
    else if (a === "--sesion") o.sesion = sig();
    else if (a === "--help" || a === "-h") {
      console.log(fs.readFileSync(path.join(aqui, "README.md"), "utf8"));
      process.exit(0);
    }
  }
  return o;
}
const opt = leerArgs(process.argv);

// ── agent-browser sin tuberías (el daemon heredaría la tubería y el comando no terminaría) ─────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "auditoria-ui-"));
let contador = 0;
function ab(args, { input = null, timeout = 120000 } = {}) {
  const archivo = path.join(tmp, `ab-${contador++}.txt`);
  const fd = fs.openSync(archivo, "w");
  const comillas = (s) => (/[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);
  const r = spawnSync("agent-browser", ["--session", opt.sesion, ...args].map(comillas), {
    stdio: [input != null ? "pipe" : "ignore", fd, fd],
    input: input ?? undefined,
    shell: true,
    timeout,
    windowsHide: true,
  });
  fs.closeSync(fd);
  const out = fs.readFileSync(archivo, "utf8");
  fs.unlinkSync(archivo);
  return { code: r.status, out };
}
function evalJson(script) {
  const { out } = ab(["eval", "--stdin"], { input: script });
  let t = out.trim();
  let ultimo = null;
  for (let i = 0; i < 3; i++) {
    try {
      const v = JSON.parse(t);
      ultimo = v;
      if (typeof v === "string") t = v;
      else return v;
    } catch {
      break;
    }
  }
  return ultimo; // un texto plano que ya no es JSON (por ejemplo una ruta)
}

// ── Ids reales ────────────────────────────────────────────────────────────────────────────────
async function get(url, headers = {}) {
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}
async function resolverIds() {
  const i = { ...idsRespaldo };
  const c1 = await get(`${opt.api}/contratos?riesgo=alto&limit=1`);
  if (c1?.data?.[0]?.ocid) i.ocidLeido = String(c1.data[0].ocid);
  const c2 = await get(`${opt.api}/contratos?estado=sin_analizar&limit=1`);
  if (c2?.data?.[0]?.ocid) i.ocidSinLeer = String(c2.data[0].ocid);
  const p = await get(`${opt.api}/partidos/ranking?anio=2022`);
  if (p?.data?.[0]?.clave) i.partido = p.data[0].clave;
  const tok = tokenApiAdmin();
  if (tok) {
    const r = await get(`${opt.api}/admin/revision`, { "x-admin-token": tok });
    const f = (r?.data ?? r?.items ?? (Array.isArray(r) ? r : []))[0];
    if (f?.id) i.revisionId = String(f.id);
  }
  return i;
}

// ── Índice de componentes (para dar el archivo probable de cada ofensor) ──────────────────────
let indice = null;
function indexar() {
  if (indice) return indice;
  indice = [];
  const recorrer = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!["node_modules", ".next"].includes(e.name) && !e.name.startsWith(".next")) recorrer(p);
      } else if (/\.(tsx|ts)$/.test(e.name)) {
        indice.push({ p: path.relative(raiz, p).replace(/\\/g, "/"), lineas: fs.readFileSync(p, "utf8").split("\n") });
      }
    }
  };
  for (const d of ["app", "components", "lib"]) {
    const p = path.join(frontend, d);
    if (fs.existsSync(p)) recorrer(p);
  }
  return indice;
}
function buscarComponente({ titulo, texto, clases, frag }) {
  const cand = [...(frag ?? []), titulo, texto && texto.slice(0, 42)].filter((s) => s && s.trim().length >= 6);
  // el archivo que contiene más fragmentos del texto de la caja
  const puntos = new Map();
  for (const t of cand) {
    const clave = t.replace(/\s+/g, " ").trim();
    for (const f of indexar()) {
      const n = f.lineas.findIndex((l) => l.includes(clave));
      if (n >= 0) {
        const prev = puntos.get(f.p) ?? { n: 0, linea: n + 1 };
        puntos.set(f.p, { n: prev.n + 1, linea: prev.linea });
      }
    }
  }
  const mejores = [...puntos.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 2);
  if (mejores.length) return mejores.map(([p, v]) => `${p}:${v.linea}`);
  // sin texto fijo (datos): solo clases que identifiquen al bloque (con valores arbitrarios o min-h)
  const toks = (clases || "").split(/\s+/).filter(Boolean);
  const distintivas = toks.filter((c) => /\[|^min-h|^aspect|^h-\d{2,}/.test(c));
  if (distintivas.length) {
    const frase = distintivas[0];
    for (const f of indexar()) {
      const n = f.lineas.findIndex((l) => l.includes(frase));
      if (n >= 0) return [`${f.p}:${n + 1} (por clase ${frase})`];
    }
  }
  return [];
}

// ── Puntaje y aprobado ────────────────────────────────────────────────────────────────────────
const suma = (a, f) => a.reduce((s, x) => s + f(x), 0);
export const UMBRALES = {
  areaRala: 40000, // ninguna caja rala con más área que esto
  vacioInicial: 0.25, // vacío máximo del primer viewport
  huecosNoExentos: 0,
  minHDesperdicio: 40000,
  tablasProblema: 0,
};
function evaluar(m) {
  const huecos = m.huecos.filter((h) => !h.exento);
  const ralas = m.ralas.filter((r) => r.area >= UMBRALES.areaRala);
  const minH = m.minH.filter((x) => x.desperdicio >= UMBRALES.minHDesperdicio);
  const puntaje = Math.round(
    suma(m.ralas, (r) => r.desperdicio) / 1000 +
      suma(huecos, (h) => h.desperdicio) / 1000 +
      suma(m.minH, (x) => x.desperdicio) / 1000 +
      m.vacioInicial * 100 +
      m.tablas.length * 10,
  );
  const fallos = [];
  if (ralas.length > 0) fallos.push(`${ralas.length} cajas ralas > 40.000 px²`);
  if (m.vacioInicial >= UMBRALES.vacioInicial) fallos.push(`vacío inicial ${(m.vacioInicial * 100).toFixed(0)} %`);
  if (huecos.length > UMBRALES.huecosNoExentos) fallos.push(`${huecos.length} huecos > 72 px`);
  if (minH.length > 0) fallos.push(`${minH.length} min-h con poco contenido`);
  if (m.tablas.length > UMBRALES.tablasProblema) fallos.push(`${m.tablas.length} tablas ralas`);
  return { puntaje, pasa: fallos.length === 0, fallos, huecosNoExentos: huecos.length, ralasGrandes: ralas.length };
}

// ── Ejecución ────────────────────────────────────────────────────────────────────────────────
async function main() {
  const ok = await fetch(`${opt.base}/app`, { signal: AbortSignal.timeout(60000) }).then((r) => r.ok).catch(() => false);
  if (!ok) {
    console.error(`No responde ${opt.base}. Levanta el frontend (ver README.md de esta carpeta).`);
    process.exit(2);
  }

  const idsReales = await resolverIds();
  let lista = armarRutas(idsReales);
  const grupos = opt.rutas.split(",").map((s) => s.trim());
  lista = lista.filter((r) => grupos.includes(r.grupo) || grupos.includes(r.id));
  if (opt.solo) {
    const s = opt.solo.split(",").map((x) => x.trim());
    lista = lista.filter((r) => s.includes(r.id));
  }
  const vps = VIEWPORTS.filter((v) => !opt.anchos || opt.anchos.includes(v.nombre));
  if (!lista.length) {
    console.error("Ninguna ruta coincide con --rutas / --solo.");
    process.exit(2);
  }

  const dirDatos = path.join(opt.salida, "datos", opt.etiqueta);
  const dirImg = path.join(opt.salida, "img", opt.etiqueta);
  fs.rmSync(dirDatos, { recursive: true, force: true });
  fs.mkdirSync(dirDatos, { recursive: true });
  if (opt.captura) {
    fs.rmSync(dirImg, { recursive: true, force: true });
    fs.mkdirSync(dirImg, { recursive: true });
  }

  // Navegador (el primer comando levanta el daemon)
  ab(["open", "about:blank"]);

  // Sesión admin
  let sesionAdmin = "no_necesaria";
  const cookies = {};
  if (lista.some((r) => r.grupo === "admin")) {
    const c = await firmarCookieAdmin();
    if (!c) {
      sesionAdmin = "sin_llave";
    } else {
      cookies.admin = c.cookie;
      ab(["open", `${opt.base}/admin/login`]);
      ab(["eval", "--stdin"], { input: `document.cookie = "__session=${c.cookie}; path=/; max-age=7200"; "ok"` });
      ab(["open", `${opt.base}/admin`]);
      const url = evalJson(`JSON.stringify(location.pathname)`);
      sesionAdmin = url && !String(url).includes("login") ? "ok" : "rechazada";
    }
    console.log(`Sesión admin: ${sesionAdmin}`);
  }

  // Precalentar (en dev, la primera visita compila la ruta)
  process.stdout.write("Precalentando rutas");
  for (const r of lista) {
    const cab = r.grupo === "admin" && cookies.admin ? { cookie: `__session=${cookies.admin}` } : {};
    await fetch(opt.base + r.ruta, { headers: cab, redirect: "manual", signal: AbortSignal.timeout(120000) }).catch(() => null);
    process.stdout.write(".");
  }
  console.log();

  const resumen = [];
  for (const r of lista) {
    for (const v of vps) {
      const t0 = Date.now();
      ab(["set", "viewport", String(v.w), String(v.h)]);
      ab(["open", opt.base + r.ruta]);
      ab(["wait", String(opt.espera)]);
      // recorre la página para que carguen los bloques perezosos y vuelve arriba
      evalJson(`window.scrollTo(0, document.documentElement.scrollHeight); JSON.stringify(1)`);
      ab(["wait", "500"]);
      evalJson(`window.scrollTo(0, 0); JSON.stringify(1)`);
      ab(["wait", "400"]);
      const medidas = evalJson(fs.readFileSync(path.join(aqui, "medir.js"), "utf8"));
      if (!medidas) {
        console.log(`  ${r.id} ${v.nombre}: sin medición`);
        resumen.push({ id: r.id, ruta: r.ruta, grupo: r.grupo, viewport: v.nombre, error: true });
        continue;
      }
      const final = medidas.url;
      const evalu = evaluar(medidas);
      const img = `${r.id}-${v.nombre}.jpg`;
      if (opt.captura) {
        const destino = path.join(dirImg, img);
        ab(["screenshot", "--full", "--screenshot-format", "jpeg", "--screenshot-quality", "55", destino]);
        if (fs.existsSync(destino) && fs.statSync(destino).size > 2 * 1024 * 1024) {
          ab(["screenshot", "--full", "--screenshot-format", "jpeg", "--screenshot-quality", "30", destino]);
        }
      }
      // archivo probable de los 5 peores de cada lista
      for (const x of medidas.ralas.slice(0, 5)) x.componente = buscarComponente({ titulo: x.titulo, texto: x.texto, clases: x.clases, frag: x.frag });
      for (const x of medidas.minH.slice(0, 5)) x.componente = buscarComponente({ texto: x.texto, clases: x.clases, frag: x.frag });
      for (const x of medidas.huecos.filter((h) => !h.exento).slice(0, 5))
        x.componente = buscarComponente({ texto: x.despues || x.antes, frag: x.frag });
      const entrada = {
        id: r.id,
        ruta: r.ruta,
        grupo: r.grupo,
        nota: r.nota ?? null,
        viewport: v.nombre,
        urlFinal: final,
        redirigido: final.split("?")[0] !== r.ruta.split("?")[0],
        imagen: opt.captura ? `img/${opt.etiqueta}/${img}` : null,
        ...evalu,
        medidas,
      };
      fs.writeFileSync(path.join(dirDatos, `${r.id}__${v.nombre}.json`), JSON.stringify(entrada, null, 1));
      resumen.push({
        id: r.id,
        ruta: r.ruta,
        grupo: r.grupo,
        viewport: v.nombre,
        puntaje: evalu.puntaje,
        pasa: evalu.pasa,
        fallos: evalu.fallos,
        alturaPagina: medidas.alturaPagina,
        vacioInicial: medidas.vacioInicial,
        ralas: medidas.ralas.length,
        huecosNoExentos: evalu.huecosNoExentos,
        redirigido: entrada.redirigido,
        urlFinal: final,
      });
      console.log(
        `  ${r.id.padEnd(26)} ${v.nombre.padStart(4)}  puntaje ${String(evalu.puntaje).padStart(4)}  ${evalu.pasa ? "OK " : "FALLA"}  ${((Date.now() - t0) / 1000).toFixed(1)} s`,
      );
    }
  }
  ab(["close"]);
  fs.writeFileSync(path.join(dirDatos, "resumen.json"), JSON.stringify({ generado: new Date().toISOString(), sesionAdmin, resumen }, null, 1));
  escribirInforme({ lista, vps, resumen, sesionAdmin, dirDatos });
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ── Informe ──────────────────────────────────────────────────────────────────────────────────
function escribirInforme({ resumen, vps, sesionAdmin, dirDatos }) {
  const nombre = opt.etiqueta === "linea-base" ? "LINEA_BASE.md" : `${opt.etiqueta.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}.md`;
  let previo = null;
  if (opt.comparar && opt.comparar !== "ninguna" && opt.comparar !== opt.etiqueta) {
    const p = path.join(opt.salida, "datos", opt.comparar, "resumen.json");
    if (fs.existsSync(p)) previo = JSON.parse(fs.readFileSync(p, "utf8")).resumen;
  }
  const ant = (id, vp) => previo?.find((x) => x.id === id && x.viewport === vp);
  const porRuta = new Map();
  for (const x of resumen) {
    if (!porRuta.has(x.id)) porRuta.set(x.id, { id: x.id, ruta: x.ruta, grupo: x.grupo, por: {} });
    porRuta.get(x.id).por[x.viewport] = x;
  }
  const rutas = [...porRuta.values()].map((r) => ({
    ...r,
    peor: Math.max(...Object.values(r.por).map((x) => x.puntaje ?? 0)),
    pasa: Object.values(r.por).every((x) => x.pasa),
  }));
  rutas.sort((a, b) => b.peor - a.peor);

  const L = [];
  L.push(`# Auditoría de densidad de la UI: ${opt.etiqueta}`);
  L.push("");
  L.push(`Generado el ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC contra \`${opt.base}\`. Sesión admin: **${sesionAdmin}**.`);
  L.push("");
  L.push("Repetir esta auditoría:");
  L.push("");
  L.push("```bash");
  L.push(`node frontend/scripts/auditoria-ui/auditar.mjs --rutas app,admin --salida docs/auditoria-ui --etiqueta ${opt.etiqueta}`);
  L.push("```");
  L.push("");
  L.push("## Cómo se lee");
  L.push("");
  L.push("- **Puntaje de desperdicio** = suma del área desperdiciada de cajas ralas, huecos fuera de separadores y min-height forzada (en miles de px²), más el vacío del primer viewport en puntos porcentuales, más 10 por tabla rala. Más bajo es mejor.");
  L.push("- **Aprueba** una ruta si, en los dos anchos: 0 cajas ralas de más de 40.000 px², vacío del primer viewport menor a 25 %, 0 huecos de más de 72 px (salvo separadores de sección), 0 bloques con min-height forzada y poco contenido, y 0 tablas ralas.");
  L.push("- **Caja rala:** borde, fondo o sombra, al menos 160x72 px, con área de 40.000 px² o más y menos de 120 caracteres sin medios que la llenen, o con más de 55 % de vacío interno.");
  L.push("");
  const aprob = rutas.filter((r) => r.pasa).length;
  L.push(`**Resultado:** ${aprob} de ${rutas.length} rutas aprueban.`);
  L.push("");
  L.push("## Resumen por ruta (peor primero)");
  L.push("");
  const cab = ["Ruta", ...vps.flatMap((v) => [`Puntaje ${v.nombre}`, `Aprueba ${v.nombre}`]), "Alto 1440 (px)", "Vacío inicial 1440", "Cajas ralas 1440", previo ? "Cambio de puntaje" : null].filter(Boolean);
  L.push(`| ${cab.join(" | ")} |`);
  L.push(`| ${cab.map(() => "---").join(" | ")} |`);
  for (const r of rutas) {
    const d = r.por["1440"] ?? Object.values(r.por)[0];
    const celdas = [
      `[\`${r.ruta}\`](#${r.id})${Object.values(r.por).some((x) => x.redirigido) ? " (pide cuenta)" : ""}`,
      ...vps.flatMap((v) => {
        const x = r.por[v.nombre];
        return x?.puntaje != null ? [String(x.puntaje), x.pasa ? "sí" : "no"] : ["sin dato", "sin dato"];
      }),
      String(d?.alturaPagina ?? ""),
      d?.vacioInicial != null ? `${Math.round(d.vacioInicial * 100)} %` : "",
      String(d?.ralas ?? ""),
    ];
    if (previo) {
      const delta = vps.map((v) => {
        const a = ant(r.id, v.nombre);
        const x = r.por[v.nombre];
        return a?.puntaje != null && x?.puntaje != null ? x.puntaje - a.puntaje : null;
      });
      const peorAntes = Math.max(...vps.map((v) => ant(r.id, v.nombre)?.puntaje ?? 0));
      celdas.push(peorAntes ? `${r.peor - peorAntes >= 0 ? "+" : ""}${r.peor - peorAntes}` : "nueva");
      void delta;
    }
    L.push(`| ${celdas.join(" | ")} |`);
  }
  L.push("");

  // causas más repetidas
  const ofensores = [];
  const archivos = new Map();
  const clasesFrec = new Map();
  const razones = new Map();
  for (const r of rutas) {
    for (const v of vps) {
      const f = path.join(dirDatos, `${r.id}__${v.nombre}.json`);
      if (!fs.existsSync(f)) continue;
      const e = JSON.parse(fs.readFileSync(f, "utf8"));
      for (const x of e.medidas.ralas) {
        ofensores.push({ ...x, ruta: r.ruta, vp: v.nombre, tipo: "rala" });
        razones.set(x.razon, (razones.get(x.razon) ?? 0) + 1);
        for (const c of (x.clases || "").split(/\s+/).filter((c) => /^(min-h|h-|p-|py-|pb-|pt-|gap-|space-y|aspect)/.test(c)))
          clasesFrec.set(c, (clasesFrec.get(c) ?? 0) + 1);
        for (const c of x.componente ?? []) {
          const a = c.split(":")[0];
          archivos.set(a, (archivos.get(a) ?? 0) + 1);
        }
      }
      for (const x of e.medidas.minH) {
        razones.set("min-height forzada", (razones.get("min-height forzada") ?? 0) + 1);
        clasesFrec.set(`min-h ${x.minHeight}px`, (clasesFrec.get(`min-h ${x.minHeight}px`) ?? 0) + 1);
      }
      for (const x of e.medidas.huecos.filter((h) => !h.exento)) razones.set("hueco vertical > 72 px", (razones.get("hueco vertical > 72 px") ?? 0) + 1);
      for (const x of e.medidas.tablas) razones.set(`tabla: ${x.motivo}`, (razones.get(`tabla: ${x.motivo}`) ?? 0) + 1);
    }
  }
  const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  L.push("## Causas más repetidas");
  L.push("");
  L.push("| Causa | Veces |");
  L.push("| --- | --- |");
  for (const [k, n] of top(razones, 8)) L.push(`| ${k} | ${n} |`);
  L.push("");
  if (clasesFrec.size) {
    L.push("Clases de Tailwind que más aparecen en las cajas ralas:");
    L.push("");
    L.push(top(clasesFrec, 10).map(([k, n]) => `\`${k}\` (${n})`).join(", "));
    L.push("");
  }
  if (archivos.size) {
    L.push("Componentes con más cajas ralas:");
    L.push("");
    L.push("| Archivo | Cajas ralas |");
    L.push("| --- | --- |");
    for (const [k, n] of top(archivos, 12)) L.push(`| \`${k}\` | ${n} |`);
    L.push("");
  }

  // detalle por ruta
  L.push("## Detalle por ruta");
  L.push("");
  for (const r of rutas) {
    L.push(`### ${r.ruta}`);
    L.push(`<a id="${r.id}"></a>`);
    L.push("");
    for (const v of vps) {
      const f = path.join(dirDatos, `${r.id}__${v.nombre}.json`);
      if (!fs.existsSync(f)) continue;
      const e = JSON.parse(fs.readFileSync(f, "utf8"));
      const m = e.medidas;
      L.push(
        `**${v.nombre} px:** puntaje ${e.puntaje}, ${e.pasa ? "aprueba" : "no aprueba"}. Alto ${m.alturaPagina} px, vacío inicial ${Math.round(m.vacioInicial * 100)} %, ${m.caracteres} caracteres (${m.textoPor10mil} por 10.000 px²).${e.redirigido ? ` Redirige a \`${e.urlFinal}\`.` : ""}${e.nota ? ` Nota: ${e.nota}.` : ""}`,
      );
      if (e.fallos.length) L.push(`Fallos: ${e.fallos.join("; ")}.`);
      if (e.imagen) L.push(`\n![${r.ruta} a ${v.nombre} px](${e.imagen})`);
      const filas = [];
      for (const x of m.ralas.slice(0, 5))
        filas.push([`rala (${x.razon})`, `\`${x.sel}\``, `${x.w}x${x.h}, ${x.chars} car., vacío ${Math.round(x.vacio * 100)} %`, (x.titulo || x.texto || "").replace(/\|/g, "/").slice(0, 50), (x.componente ?? []).join(", ")]);
      for (const x of m.huecos.filter((h) => !h.exento).slice(0, 5))
        filas.push(["hueco", `\`${x.padre}\``, `${x.hueco} px entre bloques`, `${(x.antes || "").slice(0, 25)} / ${(x.despues || "").slice(0, 25)}`.replace(/\|/g, "/"), (x.componente ?? []).join(", ")]);
      for (const x of m.minH.slice(0, 5))
        filas.push(["min-h forzada", `\`${x.sel}\``, `min ${x.minHeight} px, vacío ${Math.round(x.vacio * 100)} %`, (x.texto || "").replace(/\|/g, "/").slice(0, 50), (x.componente ?? []).join(", ")]);
      for (const x of m.tablas.slice(0, 3)) filas.push([`tabla (${x.motivo})`, `\`${x.sel}\``, `${x.filas} filas, ${x.altoFila} px por fila`, (x.texto || "").replace(/\|/g, "/").slice(0, 40), ""]);
      if (filas.length) {
        L.push("");
        L.push("| Tipo | Selector | Medidas | Texto | Componente probable |");
        L.push("| --- | --- | --- | --- | --- |");
        for (const f2 of filas) L.push(`| ${f2.join(" | ")} |`);
      }
      L.push("");
    }
  }
  fs.mkdirSync(opt.salida, { recursive: true });
  const destino = path.join(opt.salida, nombre);
  fs.writeFileSync(destino, L.join("\n"));
  console.log(`\nInforme: ${path.relative(raiz, destino)}  (${aprob}/${rutas.length} rutas aprueban)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
