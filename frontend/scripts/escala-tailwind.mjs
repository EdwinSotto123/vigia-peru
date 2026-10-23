#!/usr/bin/env node
/**
 * Codemod de una vez (docs/PLAN_VISUAL.md, fase B): los tamaños de Tailwind por defecto sin prefijo (`text-sm`) pasan
 * a la escala de tokens con la MISMA interlínea que traían (`text-dato leading-5`), así nada se mueve. Si la línea ya
 * fija su interlínea (`leading-*`), sólo cambia el tamaño. `text-xl` (20 px) y mayores, y los que llevan prefijo
 * (`sm:text-5xl`, títulos de la portada), quedan: no tienen un token igual.
 *
 * Uso: node scripts/escala-tailwind.mjs [--escribir]
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAPA = { xs: ["text-rotulo", "leading-4"], sm: ["text-dato", "leading-5"], base: ["text-destacado", "leading-6"], lg: ["text-bloque", "leading-7"] };
const escribir = process.argv.includes("--escribir");

function archivos(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== "node_modules" && !n.startsWith(".")) out.push(...archivos(p)); }
    else if (/\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}

let total = 0;
for (const carpeta of ["app", "components"]) {
  for (const f of archivos(join(RAIZ, carpeta))) {
    const texto = readFileSync(f, "utf8");
    let n = 0;
    const nuevo = texto.split("\n").map((l) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(l)) return l;
      const conLeading = /(?<![\w-])leading-/.test(l);
      return l.replace(/(?<![\w:-])text-(xs|sm|base|lg)(?![\w-])/g, (_, t) => {
        n++;
        const [tam, lead] = MAPA[t];
        return conLeading ? tam : `${tam} ${lead}`;
      });
    }).join("\n");
    if (n) {
      total += n;
      console.log(`${String(n).padStart(4)}  ${relative(RAIZ, f).split("\\").join("/")}`);
      if (escribir) writeFileSync(f, nuevo);
    }
  }
}
console.log(`${total} cambios${escribir ? "" : " (sin escribir: --escribir)"}`);
