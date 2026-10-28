/**
 * El plano del mapa mental de una organización (components/entidad/OrganigramaMapa.tsx): la entidad al centro y sus
 * ramas a los dos lados, cada una creciendo hacia afuera en columnas, con la letra a su tamaño real (12 a 13 px; los
 * grafos radiales de antes la achicaban a 4-9 px y no se leía). Función pura: recibe lo abierto y devuelve cajas y
 * líneas en píxeles. Cada caja mide lo que su nombre: una línea o dos (nunca encima de su línea de datos).
 */
import type { NodoOrganigrama } from "@/lib/organigrama";

export interface CajaOrg {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  lado: -1 | 1;
  profundidad: number;
  lineas: string[];
  /** Hijos que no se ven (rama cerrada o más de los que caben); 0 si no tiene. */
  ocultos: number;
  /** La caja «y N oficinas más» (abre la rama entera). */
  mas?: { de: string };
}
export interface LineaOrg { a: string; d: string; inferida: boolean }
export interface PlanoOrg {
  cajas: CajaOrg[];
  lineas: LineaOrg[];
  raiz: { x: number; y: number; w: number; h: number; lineas: string[] };
  vista: { x: number; y: number; w: number; h: number };
}

/** Columnas de 252 px, filas de 66; una caja de una línea mide 44 de alto y una de dos, 58. */
export const MEDIDA = { col: 252, fila: 66, w: 214, h1: 44, h2: 58, hMas: 34, raizW: 232, raizH: 76, margen: 28, porLinea: 28 } as const;

/** Parte un nombre en hasta `max` líneas de `porLinea` caracteres (aprox. a 12.5 px en 214 px); si sobra, «…». */
export function partirEnLineas(t: string, porLinea: number = MEDIDA.porLinea, max = 2): string[] {
  const ws = t.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= porLinea) cur += " " + w;
    else {
      out.push(cur);
      cur = w;
      if (out.length === max) {
        out[max - 1] = recortar(`${out[max - 1]} ${ws.slice(i).join(" ")}`, porLinea);
        return out;
      }
    }
  }
  if (cur) out.push(cur.length > porLinea ? recortar(cur, porLinea) : cur);
  return out.slice(0, max);
}
const recortar = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

export function planoOrganigrama(
  hijos: Map<string | null, NodoOrganigrama[]>,
  abiertos: Set<string>,
  todos: Set<string>,
  nombre: (n: NodoOrganigrama) => string,
  raiz: string[],
  maxHijos = 24,
): PlanoOrg {
  const M = MEDIDA;
  const porId = new Map<string, NodoOrganigrama>();
  for (const l of hijos.values()) for (const n of l) porId.set(n.id, n);
  const visibles = (id: string) => (abiertos.has(id) ? hijos.get(id) ?? [] : []);
  // El peso de una rama: cuántas filas ocupa abierta como está.
  const pesos = new Map<string, number>();
  const peso = (n: NodoOrganigrama): number => {
    const ya = pesos.get(n.id);
    if (ya !== undefined) return ya;
    const k = visibles(n.id);
    const ver = todos.has(n.id) ? k : k.slice(0, maxHijos);
    const p = ver.length ? Math.max(1, ver.reduce((t, h) => t + peso(h), 0) + (k.length > ver.length ? 1 : 0)) : 1;
    pesos.set(n.id, p);
    return p;
  };
  // Los de primer nivel, a los dos lados: el más pesado a la derecha y cada siguiente al lado más liviano (en su orden).
  const top = hijos.get(null) ?? [];
  const der: NodoOrganigrama[] = [];
  const izq: NodoOrganigrama[] = [];
  let pd = 0;
  let pi = 0;
  for (const n of [...top].sort((a, b) => peso(b) - peso(a))) {
    if (pd <= pi) { der.push(n); pd += peso(n); } else { izq.push(n); pi += peso(n); }
  }
  const orden = (l: NodoOrganigrama[]) => top.filter((n) => l.includes(n));

  const cajas: CajaOrg[] = [];
  const lineas: LineaOrg[] = [];
  const centro = (c: CajaOrg) => c.y + c.h / 2;
  const lado = (lista: NodoOrganigrama[], s: -1 | 1) => {
    let fila = 0;
    const propias: CajaOrg[] = [];
    const propiasLineas: LineaOrg[] = [];
    const xDe = (prof: number) => (s === 1 ? M.raizW / 2 + M.margen + (prof - 1) * M.col : -(M.raizW / 2 + M.margen + (prof - 1) * M.col) - M.w);
    /** Una caja centrada en el medio de su fila. */
    const enFila = (h: number) => {
      const y = fila * M.fila + (M.fila - h) / 2;
      fila++;
      return y;
    };
    const poner = (n: NodoOrganigrama, prof: number): CajaOrg => {
      const k = visibles(n.id);
      const ver = todos.has(n.id) ? k : k.slice(0, maxHijos);
      const ls = partirEnLineas(nombre(n));
      const caja: CajaOrg = {
        id: n.id, x: xDe(prof), y: 0, w: M.w, h: ls.length > 1 ? M.h2 : M.h1, lado: s, profundidad: prof, lineas: ls,
        ocultos: (hijos.get(n.id)?.length ?? 0) - ver.length,
      };
      if (!ver.length) {
        caja.y = enFila(caja.h);
      } else {
        const hs = ver.map((h) => poner(h, prof + 1));
        if (k.length > ver.length) {
          // «y N oficinas más»: una caja que abre la rama entera.
          const mas: CajaOrg = { id: `${n.id}::mas`, x: xDe(prof + 1), y: enFila(M.hMas), w: M.w, h: M.hMas, lado: s, profundidad: prof + 1, lineas: [`y ${k.length - ver.length} oficinas más`], ocultos: 0, mas: { de: n.id } };
          propias.push(mas);
          hs.push(mas);
        }
        caja.y = (centro(hs[0]) + centro(hs[hs.length - 1])) / 2 - caja.h / 2;
        for (const h of hs) propiasLineas.push({ a: h.id, d: curva(caja, h, s), inferida: !h.mas && esInferida(porId.get(h.id)) });
      }
      propias.push(caja);
      return caja;
    };
    const raices = lista.map((n) => poner(n, 1));
    // El lado entero, centrado en la entidad.
    const dy = -(fila * M.fila) / 2;
    for (const c of propias) c.y += dy;
    for (const l of propiasLineas) l.d = desplazar(l.d, dy);
    cajas.push(...propias);
    lineas.push(...propiasLineas);
    return raices;
  };
  const D = lado(orden(der), 1);
  const I = lado(orden(izq), -1);
  const r = { x: -M.raizW / 2, y: -M.raizH / 2, w: M.raizW, h: M.raizH, lineas: raiz };
  for (const c of [...D, ...I]) lineas.push({ a: c.id, d: curvaRaiz(r, c), inferida: esInferida(porId.get(c.id)) });
  // El margen deja lugar al botón de abrir y cerrar, que va por fuera de la caja.
  const pad = 48;
  const xs = [r.x, r.x + r.w, ...cajas.flatMap((c) => [c.x, c.x + c.w])];
  const ys = [r.y, r.y + r.h, ...cajas.flatMap((c) => [c.y, c.y + c.h])];
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - 16;
  return { cajas, lineas, raiz: r, vista: { x: minX, y: minY, w: Math.max(...xs) + pad - minX, h: Math.max(...ys) + 16 - minY } };
}

/** ¿La oficina cuelga de su padre por inferencia o sin dato (línea punteada)? */
const esInferida = (n: NodoOrganigrama | undefined) => n?.arista?.tipo === "funcion" || n?.arista?.tipo === "nivel";

/** La curva de un padre a su hijo: sale del costado del padre y entra por el costado del hijo. */
function curva(p: CajaOrg, h: CajaOrg, s: -1 | 1): string {
  const x1 = s === 1 ? p.x + p.w : p.x;
  const y1 = p.y + p.h / 2;
  const x2 = s === 1 ? h.x : h.x + h.w;
  const y2 = h.y + h.h / 2;
  const xm = (x1 + x2) / 2;
  return `M${x1},${y1} C${xm},${y1} ${xm},${y2} ${x2},${y2}`;
}
function curvaRaiz(r: { x: number; y: number; w: number; h: number }, h: CajaOrg): string {
  const x1 = h.lado === 1 ? r.x + r.w : r.x;
  const y1 = r.y + r.h / 2;
  const x2 = h.lado === 1 ? h.x : h.x + h.w;
  const y2 = h.y + h.h / 2;
  const xm = (x1 + x2) / 2;
  return `M${x1},${y1} C${xm},${y1} ${xm},${y2} ${x2},${y2}`;
}
/** Una curva corrida en vertical (sólo sus coordenadas y). */
function desplazar(d: string, dy: number): string {
  return d.replace(/(-?[\d.]+),(-?[\d.]+)/g, (_, x, y) => `${x},${Number(y) + dy}`);
}
