/**
 * Semántica de Python que los pipelines necesitan reproducir al carácter (los mismos datos tienen que
 * dar las mismas filas que en backend/scrapers): verdad de Python (`[]` y `{}` son falsos), `a or b`,
 * `str()`, `in`, `str.split()`/`strip()`, `s[:n]` por punto de código, `float()`, `str.title()` y las
 * normalizaciones Unicode (NFKD/NFD sin marcas, NFKD → ASCII).
 *
 * Sin dependencias ni E/S: lo prueba test/py.test.ts.
 */

export type Dict = Record<string, unknown>;

/** `isinstance(v, dict)` para un valor JSON. */
export function esDict(v: unknown): v is Dict {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** `bool(v)` de Python para un valor JSON (NaN es verdadero; lista y dict vacíos, falsos). */
export function verdad(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === "") return false;
  if (typeof v === "number") return v !== 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}

/** `a or b` de Python. */
export function o<T, U>(a: T, b: U): T | U {
  return verdad(a) ? a : b;
}

/** `d.get(k)` de un dict de Python (undefined → null, como None). */
export function get(d: unknown, k: string): unknown {
  return esDict(d) && Object.hasOwn(d, k) ? d[k] : null;
}

/** `(d.get(k) or {})` cuando el resultado se usa como dict: lo que no es dict se toma vacío. */
export function dictDe(v: unknown): Dict {
  return esDict(v) ? v : {};
}

/**
 * `for x in v` de Python sobre un valor JSON: lista → elementos, texto → caracteres, dict → claves.
 * Lo demás (número, booleano, None) no es iterable: vacío (Python lanzaría TypeError).
 */
export function iterar(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") return Array.from(v);
  if (esDict(v)) return Object.keys(v);
  return [];
}

/** `x in v` de Python: lista → pertenencia, texto → subcadena, dict → clave. */
export function contiene(v: unknown, x: unknown): boolean {
  if (Array.isArray(v)) return v.some((e) => e === x);
  if (typeof v === "string") return typeof x === "string" && v.includes(x);
  if (esDict(v)) return typeof x === "string" && Object.hasOwn(v, x);
  return false;
}

// ─── str() ───────────────────────────────────────────────────────────────────
function reprTexto(s: string): string {
  const comilla = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = comilla;
  for (const c of s) {
    if (c === "\\") out += "\\\\";
    else if (c === comilla) out += `\\${c}`;
    else if (c === "\n") out += "\\n";
    else if (c === "\r") out += "\\r";
    else if (c === "\t") out += "\\t";
    else out += c;
  }
  return out + comilla;
}

/** `repr(float)` de Python: dígitos más cortos, notación científica si el exponente es < -4 o >= 16. */
export function reprFlotante(v: number): string {
  if (Number.isNaN(v)) return "nan";
  if (!Number.isFinite(v)) return v > 0 ? "inf" : "-inf";
  if (v === 0) return Object.is(v, -0) ? "-0.0" : "0.0";
  const [mant, expTxt] = v.toExponential().split("e");
  const exp = Number(expTxt);
  const signo = mant.startsWith("-") ? "-" : "";
  const digitos = mant.replace("-", "").replace(".", "");
  if (exp < -4 || exp >= 16) {
    const m = digitos.length > 1 ? `${digitos[0]}.${digitos.slice(1)}` : digitos;
    return `${signo}${m}e${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
  }
  if (exp < 0) return `${signo}0.${"0".repeat(-exp - 1)}${digitos}`;
  const entero = digitos.slice(0, exp + 1).padEnd(exp + 1, "0");
  const frac = digitos.slice(exp + 1);
  return `${signo}${entero}.${frac || "0"}`;
}

/** `repr()` de Python para un valor JSON (los enteros exactos se toman como int, como json.loads). */
export function repr(v: unknown): string {
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "number") return Number.isSafeInteger(v) ? String(v) : reprFlotante(v);
  if (typeof v === "string") return reprTexto(v);
  if (Array.isArray(v)) return `[${v.map(repr).join(", ")}]`;
  if (esDict(v)) return `{${Object.entries(v).map(([k, x]) => `${reprTexto(k)}: ${repr(x)}`).join(", ")}}`;
  return String(v);
}

/** `str()` de Python para un valor JSON. */
export function str(v: unknown): string {
  return typeof v === "string" ? v : repr(v);
}

// ─── Espacios, cortes y números ──────────────────────────────────────────────
// str.isspace() de Python: incluye \x1c-\x1f y \x85 (JS no) y excluye U+FEFF (JS sí).
const ESPACIOS = "\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const RE_STRIP = new RegExp(`^[${ESPACIOS}]+|[${ESPACIOS}]+$`, "g");
const RE_ESPACIOS = new RegExp(`[${ESPACIOS}]+`);

/** `s.strip()` de Python. */
export function strip(s: string): string {
  return s.replace(RE_STRIP, "");
}

/** `s.split()` de Python (sin separador: corta en cualquier espacio y descarta vacíos). */
export function partir(s: string): string[] {
  return s.split(RE_ESPACIOS).filter((x) => x !== "");
}

/** `" ".join(s.split())`. */
export function colapsar(s: string): string {
  return partir(s).join(" ");
}

/** `s[:n]` de Python (por punto de código, no por unidad UTF-16). */
export function cortar(s: string, n: number): string {
  if (s.length <= n) return s;
  const cps = Array.from(s);
  return cps.length <= n ? s : cps.slice(0, n).join("");
}

const RE_FLOAT = /^[+-]?(?:(?:\d(?:_?\d)*)(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?$/;
const RE_NO_FINITO = /^[+-]?(?:nan|inf|infinity)$/i;

/** `float(v)` de Python; null si lanzaría TypeError/ValueError. */
export function flotante(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v !== "string") return null;
  const s = strip(v);
  if (RE_NO_FINITO.test(s)) {
    if (/nan/i.test(s)) return NaN;
    return s.startsWith("-") ? -Infinity : Infinity;
  }
  return RE_FLOAT.test(s) ? Number(s.replaceAll("_", "")) : null;
}

// ─── Mayúsculas y Unicode ────────────────────────────────────────────────────
const RE_CASED = /\p{Cased}/u;

/** `s.title()` de Python: mayúscula tras un carácter sin caja (espacio, guion, dígito, apóstrofo). */
export function titulo(s: string): string {
  let out = "";
  let previoConCaja = false;
  for (const c of s) {
    out += previoConCaja ? c.toLowerCase() : c.toUpperCase();
    previoConCaja = RE_CASED.test(c);
  }
  return out;
}

/** NFKD sin marcas combinantes (`unicodedata.combining(c) == 0`). */
export function sinMarcasNfkd(s: string): string {
  return s.normalize("NFKD").replace(/\p{Mn}/gu, "");
}

/** NFD sin categoría Mn (`unicodedata.category(c) != "Mn"`). */
export function sinMarcasNfd(s: string): string {
  return s.normalize("NFD").replace(/\p{Mn}/gu, "");
}

/** `unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()`. */
export function asciiNfkd(s: string): string {
  return s.normalize("NFKD").replace(/[^\x00-\x7f]/g, "");
}
