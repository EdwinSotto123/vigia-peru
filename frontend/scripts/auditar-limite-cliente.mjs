#!/usr/bin/env node
/**
 * Guardia del límite servidor / cliente.
 *
 * Un módulo «use client» sólo puede darle al servidor COMPONENTES para dibujar. Si un Server Component importa de un
 * módulo «use client» una función o una constante y la usa, en el servidor recibe una referencia de cliente: llamarla
 * (o usarla como texto) falla al dibujar la página, y ni `tsc` ni el build lo avisan. Pasó el 2026-11-16: la ficha de
 * todo contrato con una bandera que cita un informe de control mostraba «Algo no cargó bien» porque CrucesProveedor
 * (servidor) llamaba a informeDeDetalle(), exportada desde InformeEnPanel.tsx (cliente).
 *
 * Qué mira: los módulos alcanzables desde un page/layout/… de app/ sin cruzar un «use client» (los de servidor) y, en
 * cada uno, lo que importa de un módulo «use client» (siguiendo los `export … from` de los index) que NO sea un
 * componente (un nombre que no empieza por Mayúscula + minúscula, o todo en MAYÚSCULAS). Los `import type` no cuentan.
 *
 * Uso: node scripts/auditar-limite-cliente.mjs      lista los casos; código de salida 1 si hay alguno
 * Arreglo: mueve la función o la constante a un módulo sin «use client» (lib/…) e impórtala de ahí en los dos lados.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = [".tsx", ".ts"];
const ENTRADAS = new Set(["page", "layout", "not-found", "error", "loading", "template", "default"]);

const textos = new Map();
const texto = (p) => {
  if (!textos.has(p)) textos.set(p, readFileSync(p, "utf8"));
  return textos.get(p);
};
const esArchivo = (p) => existsSync(p) && statSync(p).isFile();

function resolver(desde, ruta) {
  let base;
  if (ruta.startsWith("@/")) base = join(RAIZ, ruta.slice(2));
  else if (ruta.startsWith(".")) base = resolve(dirname(desde), ruta);
  else return null;
  for (const c of [base, ...EXT.map((e) => base + e), ...EXT.map((e) => join(base, `index${e}`))]) if (esArchivo(c)) return c;
  return null;
}

/** ¿El archivo empieza (tras comentarios) con la directiva «use client»? */
const esCliente = (p) => /^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*["']use client["']/.test(texto(p));

const IMPORT = /import\s+(type\s+)?(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*["']([^"']+)["']/g;

function* imports(p) {
  for (const m of texto(p).matchAll(IMPORT)) {
    if (m[1]) continue; // import type
    const destino = resolver(p, m[4]);
    if (!destino) continue;
    const nombres = [];
    if (m[2]) nombres.push(m[2]);
    for (const crudo of (m[3] ?? "").split(",")) {
      const n = crudo.trim();
      if (!n || n.startsWith("type ")) continue;
      nombres.push(n.split(/\s+as\s+/)[0].trim());
    }
    yield { destino, nombres };
  }
}

/** Sigue un `export { X } from "./otro"` (o `export * from`) hasta el archivo que define X. */
function origen(p, nombre, vistos = new Set()) {
  if (vistos.has(p)) return p;
  vistos.add(p);
  for (const m of texto(p).matchAll(/export\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
    const esta = m[1].split(",").some((n) => n.trim().split(/\s+as\s+/).pop().trim().replace(/^type\s+/, "") === nombre);
    if (!esta) continue;
    const d = resolver(p, m[2]);
    if (d) return origen(d, nombre, vistos);
  }
  for (const m of texto(p).matchAll(/export\s+\*\s+from\s*["']([^"']+)["']/g)) {
    const d = resolver(p, m[1]);
    if (d && new RegExp(`export\\s+(?:async\\s+)?(?:function|const|let|class)\\s+${nombre}\\b`).test(texto(d))) return d;
  }
  return p;
}

function archivos(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n.startsWith(".")) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...archivos(p));
    else if (EXT.some((e) => n.endsWith(e))) out.push(p);
  }
  return out;
}

// Los módulos de servidor: lo alcanzable desde las entradas de app/ sin cruzar un «use client».
const servidor = new Set();
const pila = archivos(join(RAIZ, "app")).filter((p) => ENTRADAS.has(p.replace(/\\/g, "/").split("/").pop().replace(/\.tsx?$/, "")) && !esCliente(p));
while (pila.length) {
  const p = pila.pop();
  if (servidor.has(p)) continue;
  servidor.add(p);
  for (const { destino } of imports(p)) if (!servidor.has(destino) && !esCliente(destino)) pila.push(destino);
}

const esComponente = (n) => /^[A-Z][a-z]/.test(n) && !/^[A-Z0-9_]+$/.test(n);
const casos = [];
for (const p of [...servidor].sort()) {
  for (const { destino, nombres } of imports(p)) {
    for (const n of nombres) {
      if (esComponente(n)) continue;
      const real = origen(destino, n);
      if (!esCliente(real)) continue;
      casos.push(`${relative(RAIZ, p).replace(/\\/g, "/")}: «${n}» viene de ${relative(RAIZ, real).replace(/\\/g, "/")}, que es «use client»`);
    }
  }
}

console.log(`Guardia del límite servidor / cliente: ${servidor.size} módulos de servidor, ${casos.length} ${casos.length === 1 ? "caso" : "casos"}`);
for (const c of casos) console.log(`  ✗ ${c}`);
if (casos.length) {
  console.log("\nUn Server Component no puede llamar ni leer lo que exporta un módulo «use client» (sólo dibujar sus componentes).");
  console.log("Mueve esa función o constante a un módulo sin «use client» (lib/…) e impórtala de ahí.");
  process.exit(1);
}
