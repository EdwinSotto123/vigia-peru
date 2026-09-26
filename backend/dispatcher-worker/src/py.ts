/**
 * Semántica de Python que el dispatcher necesita reproducir al carácter: `str()`/`repr()` de los
 * valores JSON, verdad de Python (`[]` y `{}` son falsos), `strip()`, recortes por punto de código
 * (`s[:n]`), la hora con `isoformat(timespec="seconds")` y el corte de líneas de
 * `requests.Response.iter_lines(decode_unicode=True)` (que usa `str.splitlines()`).
 *
 * Sin dependencias ni E/S: lo prueban test/py.test.ts y scripts/paridad_eventos.ts.
 */

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

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

// str.isspace() de Python: incluye \x1c-\x1f y \x85 (JS no) y excluye U+FEFF (JS sí).
const ESPACIOS = "\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const RE_STRIP = new RegExp(`^[${ESPACIOS}]+|[${ESPACIOS}]+$`, "g");

/** `s.strip()` de Python. */
export function strip(s: string): string {
  return s.replace(RE_STRIP, "");
}

/** `s[:n]` de Python (por punto de código, no por unidad UTF-16). */
export function cortar(s: string, n: number): string {
  if (s.length <= n) return s;
  const cps = Array.from(s);
  return cps.length <= n ? s : cps.slice(0, n).join("");
}

/** Comparación de textos por punto de código (el orden de `sorted()` de Python). */
export function compararTexto(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i].codePointAt(0)! - y[i].codePointAt(0)!;
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

// ─── str() / repr() ──────────────────────────────────────────────────────────
const NO_IMPRIMIBLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u;

function hex(n: number, ancho: number): string {
  return n.toString(16).padStart(ancho, "0");
}

/** `repr(s)` de Python para un str. */
export function reprTexto(s: string): string {
  const comilla = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = comilla;
  for (const c of s) {
    const cp = c.codePointAt(0)!;
    if (c === "\\") out += "\\\\";
    else if (c === comilla) out += `\\${c}`;
    else if (c === "\t") out += "\\t";
    else if (c === "\n") out += "\\n";
    else if (c === "\r") out += "\\r";
    else if (cp < 0x20 || cp === 0x7f) out += `\\x${hex(cp, 2)}`;
    else if (cp < 0x7f) out += c;
    else if (c !== " " && NO_IMPRIMIBLE.test(c)) {
      out += cp < 0x100 ? `\\x${hex(cp, 2)}` : cp < 0x10000 ? `\\u${hex(cp, 4)}` : `\\U${hex(cp, 8)}`;
    } else out += c;
  }
  return out + comilla;
}

/** `repr(float)` de Python: dígitos más cortos, notación científica si el exponente es < -4 o >= 16. */
function reprFlotante(v: number): string {
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

/**
 * Un número JSON: Python lo lee como int si no tiene punto ni exponente. Después de JSON.parse eso
 * ya no se distingue; se toma como int todo entero exacto por debajo de 2^53 (lo habitual).
 */
function reprNumero(v: number): string {
  return Number.isSafeInteger(v) ? String(v) : reprFlotante(v);
}

/** `repr()` de Python para un valor JSON. */
export function repr(v: unknown): string {
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "number") return reprNumero(v);
  if (typeof v === "string") return reprTexto(v);
  if (Array.isArray(v)) return `[${v.map(repr).join(", ")}]`;
  if (typeof v === "object") {
    return `{${Object.entries(v as Record<string, unknown>).map(([k, x]) => `${reprTexto(k)}: ${repr(x)}`).join(", ")}}`;
  }
  return String(v);
}

/** `str()` de Python para un valor JSON. */
export function str(v: unknown): string {
  return typeof v === "string" ? v : repr(v);
}

// ─── Hora ────────────────────────────────────────────────────────────────────
/** `datetime.now(timezone.utc).isoformat(timespec="seconds")` → `2026-09-26T15:04:05+00:00`. */
export function isoSegundos(ms: number = Date.now()): string {
  return `${new Date(ms).toISOString().slice(0, 19)}+00:00`;
}

// ─── JSON como json.loads ────────────────────────────────────────────────────
/**
 * Reemplaza NaN, Infinity y -Infinity fuera de cadenas (json.loads los acepta; JSON.parse no). Quedan
 * como los textos "nan", "inf" y "-inf": lo que da `str()` de esos floats en Python.
 */
function sinNoFinitos(texto: string): string {
  let out = "";
  let enCadena = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (enCadena) {
      out += c;
      if (c === "\\") out += texto[++i] ?? "";
      else if (c === '"') enCadena = false;
      continue;
    }
    if (c === '"') {
      enCadena = true;
      out += c;
    } else if (texto.startsWith("NaN", i)) {
      out += '"nan"';
      i += 2;
    } else if (texto.startsWith("Infinity", i)) {
      out += '"inf"';
      i += 7;
    } else if (texto.startsWith("-Infinity", i)) {
      out += '"-inf"';
      i += 8;
    } else out += c;
  }
  return out;
}

/** `json.loads(linea)`: tira SyntaxError si no es JSON (ni con NaN/Infinity). */
export function cargarJson(linea: string): unknown {
  try {
    return JSON.parse(linea);
  } catch (e) {
    if (!/NaN|Infinity/.test(linea)) throw e;
    return JSON.parse(sinNoFinitos(linea));
  }
}

// ─── iter_lines ──────────────────────────────────────────────────────────────
// Separadores de str.splitlines(): LF, CR, CRLF, VT, FF, x1c, x1d, x1e, x85, U+2028 y U+2029.
const RE_LINEAS = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/;
const RE_FIN_LINEA = /[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]$/;
const RE_SEPARADOR = /[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/;

/** `s.splitlines()` de Python. */
export function splitlines(s: string): string[] {
  if (s === "") return [];
  const partes = s.split(RE_LINEAS);
  if (RE_FIN_LINEA.test(s)) partes.pop();
  return partes;
}

/**
 * Corte de líneas de `requests.Response.iter_lines(decode_unicode=True)` con el mismo arrastre de
 * la línea incompleta entre trozos. Se le pasan los textos ya decodificados (los trozos vacíos no
 * llegan: `iter_content` no los entrega) y `fin()` devuelve la última línea pendiente.
 *
 * requests vuelve a partir `pendiente + trozo` en cada trozo (cuadrático en líneas de 1 MB, como el
 * `final`). Mientras el trozo no traiga ningún separador el resultado de Python es siempre "sin
 * líneas, pendiente += trozo" (lo pendiente nunca contiene separadores), así que acá solo se
 * acumula y se parte una vez, cuando llega un separador: mismas líneas, costo lineal.
 */
export class Lineas {
  private pendiente: string[] | null = null;

  agregar(trozo: string): string[] {
    if (trozo === "") return [];
    if (!RE_SEPARADOR.test(trozo)) {
      if (this.pendiente) this.pendiente.push(trozo);
      else this.pendiente = [trozo];
      return [];
    }
    const chunk = this.pendiente !== null ? this.pendiente.join("") + trozo : trozo;
    const lineas = splitlines(chunk);
    const ultima = lineas[lineas.length - 1];
    if (lineas.length && ultima && chunk && ultima[ultima.length - 1] === chunk[chunk.length - 1]) {
      this.pendiente = [lineas.pop()!];
    } else {
      this.pendiente = null;
    }
    return lineas;
  }

  fin(): string[] {
    const p = this.pendiente;
    this.pendiente = null;
    return p !== null ? [p.join("")] : [];
  }
}
