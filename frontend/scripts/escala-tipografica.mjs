#!/usr/bin/env node
/**
 * Codemod de la escala tipográfica (docs/PLAN_VISUAL.md, fase B). Pasa los tamaños arbitrarios `text-[Npx]` a los tokens
 * de tailwind.config.ts (sólo tamaño, sin interlínea: el cambio no mueve líneas que heredan su interlínea), con su
 * prefijo responsivo (`sm:text-[32px]` → `sm:text-titulo`). Antes, da a los títulos de sección su tamaño:
 *   · `font-display text-[15px|16px] font-bold|semibold` (los títulos de bloque, hoy del tamaño del texto) → text-bloque
 *   · los h2/h3 con la etiqueta mono en mayúsculas (`etiqueta-mono`, 11 px) → título de sección o de bloque
 *
 * Uso: node scripts/escala-tipografica.mjs [--escribir]   (sin --escribir, sólo cuenta lo que cambiaría)
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const ESCRIBIR = process.argv.includes("--escribir");

/** px → token (ver fontSize en tailwind.config.ts). */
function token(px) {
  if (px <= 11) return "micro";
  if (px <= 12) return "rotulo";
  if (px <= 13) return "meta";
  if (px <= 14.5) return "dato";
  if (px < 16) return "cuerpo";
  if (px < 17) return "destacado";
  if (px <= 19) return "bloque";
  if (px <= 24) return "seccion";
  if (px <= 28) return "cifra";
  if (px <= 34) return "titulo";
  return "portada";
}

function archivos(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== "node_modules" && !n.startsWith(".")) out.push(...archivos(p)); }
    else if (/\.(tsx?|jsx?)$/.test(n)) out.push(p);
  }
  return out;
}

const cuenta = { titulos: 0, kickers: 0, tamanos: 0, archivos: 0 };
for (const carpeta of ["app", "components", "lib"]) {
  for (const f of archivos(join(RAIZ, carpeta))) {
    const antes = readFileSync(f, "utf8");
    let s = antes;
    // 1. Los títulos de bloque, hoy de 15–16 px en negrita, al tamaño de bloque.
    s = s.replace(/font-display text-\[(?:15|16)px\] font-(bold|semibold)/g, (_, peso) => { cuenta.titulos++; return `font-display text-bloque font-${peso}`; });
    // 2. Un h2 con la etiqueta mono es un título de sección; un h3, uno de bloque.
    s = s.replace(/<h2([^>]*?)className="etiqueta-mono([^"]*)"/g, (_, a, b) => { cuenta.kickers++; return `<h2${a}className="font-display text-seccion font-bold text-ink${b}"`; });
    s = s.replace(/<h3([^>]*?)className="etiqueta-mono([^"]*)"/g, (_, a, b) => { cuenta.kickers++; return `<h3${a}className="font-display text-bloque font-bold text-ink${b}"`; });
    // 3. Los demás tamaños arbitrarios, a la escala.
    s = s.replace(/((?:[a-z0-9-]+:)*)text-\[(\d+(?:\.\d+)?)px\]/g, (_, pre, px) => { cuenta.tamanos++; return `${pre}text-${token(Number(px))}`; });
    if (s !== antes) {
      cuenta.archivos++;
      if (ESCRIBIR) writeFileSync(f, s);
    }
  }
}
console.log(`${ESCRIBIR ? "Cambiados" : "Cambiarían"}: ${cuenta.titulos} títulos de bloque, ${cuenta.kickers} etiquetas usadas como título, ${cuenta.tamanos} tamaños, en ${cuenta.archivos} archivos (${relative(process.cwd(), RAIZ) || "."}).`);
