#!/usr/bin/env node
/**
 * La guardia de estilo (docs/PLAN_VISUAL.md, fase A): cuenta en el código las reglas de diseño que pidió el usuario y
 * falla si alguna EMPEORA respecto de la línea base (`scripts/auditar-estilo.base.json`). Así lo arreglado no vuelve.
 *
 *   separador      un «·» o «•» en texto visible (no en comentarios, ni el tapado «•••» ni las refs «ref·»)
 *   hexEnClase     un color fijo en una clase (`bg-[#…]`, `text-[#…]`): los colores son tokens
 *   tamanoLibre    un tamaño de letra fuera de la escala (`text-[13px]`): la escala son los tokens de tailwind.config.ts
 *                  (micro, rotulo, meta, dato, cuerpo, destacado, bloque, seccion, cifra, titulo, portada)
 *   paginaSinMigas una página de app/(dashboard) sin `Migas` (la ruta de navegación)
 *   recorteMudo    una lista `.slice(0, N).map(` en un componente sin «ver más», «+N» ni paginación cerca (o sin la
 *                  marca `recorte: <por qué>` en la línea de arriba, si es a propósito)
 *   tamanoTailwind un tamaño de Tailwind por defecto (`text-sm`, `text-lg`…) en vez de un token de la escala: quedan
 *                  ~560 de antes (portada, admin); la base sólo puede bajar
 *   escalaEnCn     la escala de tailwind.config.ts distinta de ESCALA_LETRA en lib/utils.ts (la que conoce `cn()`)
 *   tituloChico    un h2 bajo `text-bloque` o un h3 bajo `text-cuerpo` (un título del tamaño del texto: la página se lee
 *                  toda al mismo nivel). El pie (Footer.tsx) queda fuera: sus h2 son rótulos de columna.
 *   rayaVacia      «—» como valor vacío (`?? "—"`, `>—<`): se escribe «Sin dato» si falta, «Ninguno» si es cero
 *                  (DESIGN_SYSTEM.md §10.2; el panel de administración queda fuera)
 *   voseo          «Tocá», «Probá», «volvé», «podés»…: la voz es español peruano con tuteo (DESIGN_SYSTEM.md §12). Lista
 *                  explícita de formas, no "palabra con tilde al final" (está, será y podrá son correctas)
 *
 * Uso: node scripts/auditar-estilo.mjs            informe y código de salida (1 si algo empeoró)
 *      node scripts/auditar-estilo.mjs --base     reescribe la línea base con lo de hoy (después de arreglar)
 *      node scripts/auditar-estilo.mjs --detalle  lista cada caso con archivo:línea
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = join(RAIZ, "scripts", "auditar-estilo.base.json");
const CARPETAS = ["app", "components", "lib"];

function archivos(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    const s = statSync(p);
    if (s.isDirectory()) { if (n !== "node_modules" && !n.startsWith(".")) out.push(...archivos(p)); }
    else if (/\.(tsx?|jsx?)$/.test(n) && !/\.test\./.test(n)) out.push(p);
  }
  return out;
}

const casos = { separador: [], hexEnClase: [], tamanoLibre: [], paginaSinMigas: [], recorteMudo: [], tamanoTailwind: [], tituloChico: [], rayaVacia: [], voseo: [] };

// Cada terminación con su conjugación (-ar en -á, -er en -é, -ir en -í): «revisé» (yo revisé) no es voseo, «revisá» sí.
const VOSEO = new RegExp(
  String.raw`(?<!\p{L})(?:(?:toc|pas|prob|mir|busc|cerr|us|filtr|ingres|revis|agreg|cont|empez|esper|intent|llam|mand|sac|tom|` +
    String.raw`quit|cambi|descarg|record|dej|seleccion|apret|presion|desliz|arrastr|acerc|explor|and)á|` +
    String.raw`(?:volv|hac|pon|conoc|aprend|le|ten)é|(?:compart|eleg|escrib|abr|segu|ven|dec|sub)í|` +
    String.raw`fijate|podés|tenés|querés|sabés|sumate|unite)(?!\p{L})`,
  "iu",
);

for (const carpeta of CARPETAS) {
  for (const f of archivos(join(RAIZ, carpeta))) {
    const rel = relative(RAIZ, f).replace(/\\/g, "/");
    const texto = readFileSync(f, "utf8");
    const lineas = texto.split("\n");
    let enComentario = false;
    lineas.forEach((l, i) => {
      const donde = `${rel}:${i + 1}`;
      const t = l.trim();
      if (t.startsWith("/*")) enComentario = true;
      const esComentario = enComentario || t.startsWith("//") || t.startsWith("*");
      if (t.includes("*/")) enComentario = false;
      if (esComentario) return;
      // Sin la parte de comentario al final de la línea.
      const codigo = l.replace(/\s\/\/.*$/, "");
      // separador: en texto o en un literal, sin las formas de privacidad ni las expresiones que lo limpian.
      // (el carácter suelto entre comillas es el que arma o reconoce el tapado: `"•".repeat`, `includes("•")`, `"10·"`).
      const limpio = codigo.replace(/(10·)?ref·/g, "").replace(/•{2,}/g, "").replace(/["'`](10)?[·•]["'`]/g, "")
        .replace(/\/[^/\n]*[·•][^/\n]*\/[gimuy]*/g, "");
      if (/[·•]/.test(limpio) && !/TAPA_|privacidad|Redact|lib\/mock-/.test(rel)) casos.separador.push(donde);
      // (el logotipo sobre fondo claro lleva sus colores fijos en los dos modos: components/marca/).
      if (/(?:bg|text|border|fill|stroke|from|to|via|ring|shadow)-\[#[0-9a-fA-F]{3,8}\]/.test(codigo) && !rel.startsWith("components/marca/")) casos.hexEnClase.push(donde);
      if (/["'`]—["'`]|>\s*—\s*</.test(codigo) && !/(^|\/)admin/.test(rel) && !/!==\s*"—"/.test(codigo)) casos.rayaVacia.push(donde);
      if (VOSEO.test(codigo) && !/(^|\/)admin/.test(rel)) casos.voseo.push(`${donde} «${codigo.match(VOSEO)[0]}»`);
      const tam = codigo.match(/\btext-\[\d+(?:\.\d+)?px\]/g);
      if (tam) for (const x of tam) casos.tamanoLibre.push(`${donde} ${x}`);
      if (!/sr-only/.test(codigo) && !/admin|Footer\.tsx/.test(rel) &&
          (/<h2[^>]*(?<![\w-])text-(cuerpo|dato|meta|rotulo|micro|destacado)(?![\w-])/.test(codigo) ||
           /<h3[^>]*(?<![\w-])text-(dato|meta|rotulo|micro)(?![\w-])/.test(codigo))) casos.tituloChico.push(donde);
      const tw = codigo.match(/(?<![\w-])(?:[a-z]+:)*text-(?:xs|sm|base|lg|xl|[2-9]xl)(?![\w-])/g);
      if (tw) for (const x of tw) casos.tamanoTailwind.push(`${donde} ${x}`);
      if (/\.slice\(0,\s*\w+\)\s*\.map\(/.test(codigo) && /components\/.*\.tsx$/.test(rel)) {
        // Un recorte a propósito lleva la marca «recorte: <por qué>» en la línea de arriba.
        const marcado = /recorte:/.test(lineas[i - 1] ?? "");
        const cerca = marcado ? "más" : lineas.slice(Math.max(0, i - 6), i + 10).join("\n");
        if (!/más|\+\$\{|resto|Paginacion|paginas|verTodo|ver todo|ver los|length\s*>\s*\d/.test(cerca)) casos.recorteMudo.push(donde);
      }
    });
    // Sin ruta a propósito: el mapa (pantalla completa), el Inicio (la raíz) y el envoltorio del formulario de denuncia
    // (su componente, ReporteNuevo.tsx, la tiene).
    // También la del contrato: la ruta va en ContratoDetalle. Y las que sólo redirigen (sin <Pagina>) no dibujan nada.
    const SIN_RUTA = ["app/(dashboard)/app/mapa/page.tsx", "app/(dashboard)/app/page.tsx", "app/(dashboard)/reporte/nuevo/page.tsx",
                      "app/(dashboard)/app/contratos/[ocid]/page.tsx", "app/(dashboard)/noticia/page.tsx"];
    const soloRedirige = /redirect\(/.test(texto) && !/<Pagina/.test(texto);
    if (/app\/\(dashboard\)\/.*page\.tsx$/.test(rel) && !/Migas/.test(texto) && !SIN_RUTA.includes(rel) && !soloRedirige) {
      casos.paginaSinMigas.push(rel);
    }
  }
}

// La escala de tailwind.config.ts y la que conoce `cn()` (lib/utils.ts, ESCALA_LETRA) tienen que ser la misma: si no,
// tailwind-merge toma el tamaño nuevo por un color y lo borra al lado de un `text-ink`.
{
  const config = readFileSync(join(RAIZ, "tailwind.config.ts"), "utf8");
  const bloque = config.slice(config.indexOf("fontSize:"), config.indexOf("}", config.indexOf("fontSize:")));
  const enConfig = [...bloque.matchAll(/^\s*(\w+):\s*"/gm)].map((m) => m[1]).sort();
  const utils = readFileSync(join(RAIZ, "lib", "utils.ts"), "utf8");
  const lista = utils.match(/ESCALA_LETRA = \[([^\]]*)\]/);
  const enCn = lista ? [...lista[1].matchAll(/"(\w+)"/g)].map((m) => m[1]).sort() : [];
  casos.escalaEnCn = enConfig.join() === enCn.join() ? [] : [`tailwind.config.ts [${enConfig}] y lib/utils.ts ESCALA_LETRA [${enCn}]`];
}

const conteo = Object.fromEntries(Object.entries(casos).map(([k, v]) => [k, v.length]));
const base = existsSync(BASE) ? JSON.parse(readFileSync(BASE, "utf8")) : null;

if (process.argv.includes("--base")) {
  writeFileSync(BASE, JSON.stringify(conteo, null, 2) + "\n");
  console.log("línea base escrita:", conteo);
  process.exit(0);
}

let empeoro = false;
console.log("Guardia de estilo (docs/PLAN_VISUAL.md)");
for (const [k, n] of Object.entries(conteo)) {
  const b = base?.[k];
  const marca = b == null ? "" : n > b ? `  ✗ empeoró (base ${b})` : n < b ? `  ✓ mejoró (base ${b})` : "  = igual";
  if (b != null && n > b) empeoro = true;
  console.log(`  ${k.padEnd(15)} ${String(n).padStart(5)}${marca}`);
}
if (process.argv.includes("--detalle")) {
  for (const [k, v] of Object.entries(casos)) {
    if (!v.length) continue;
    console.log(`\n${k}:`);
    for (const x of v.slice(0, 400)) console.log(`  ${x}`);
  }
}
if (empeoro) {
  console.error("\nAlguna regla empeoró: arréglala o, si es a propósito, explica por qué y actualiza la base (--base).");
  process.exit(1);
}
