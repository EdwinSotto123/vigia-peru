// Formatos del servidor Python (FastMCP 1.x + pydantic 2 + pg8000) reproducidos al carácter:
// el JSON de los TextContent, los errores de validación de argumentos y los errores de Postgres.
// Así un cliente que ya consumía vigia-mcp en Cloud Run recibe exactamente el mismo texto.

// Versión de pydantic que aparece en las URLs de error ("errors.pydantic.dev/<versión>/v/<tipo>").
const VERSION_PYDANTIC = "2.13";

// ─── repr() de Python ────────────────────────────────────────────────────────

// Caracteres que str.isprintable() rechaza (Cc, Cf, Cs, Co, Cn, Zl, Zp y Zs salvo el espacio ASCII).
const NO_IMPRIMIBLE = /^[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]$/u;

function hex(cp: number, ancho: number): string {
  return cp.toString(16).padStart(ancho, "0");
}

function reprTexto(s: string): string {
  const comilla = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = comilla;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (ch === comilla || ch === "\\") out += "\\" + ch;
    else if (ch === "\t") out += "\\t";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (cp < 0x20 || cp === 0x7f) out += "\\x" + hex(cp, 2);
    else if (cp < 0x7f || !NO_IMPRIMIBLE.test(ch)) out += ch;
    else if (cp < 0x100) out += "\\x" + hex(cp, 2);
    else if (cp < 0x10000) out += "\\u" + hex(cp, 4);
    else out += "\\U" + hex(cp, 8);
  }
  return out + comilla;
}

// repr(float): notación fija si el exponente decimal cae en (-4, 16], científica fuera de ahí.
function reprFloat(x: number): string {
  if (Number.isNaN(x)) return "nan";
  if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf";
  if (x === 0) return Object.is(x, -0) ? "-0.0" : "0.0";
  const [mantisa, exponente] = x.toExponential().split("e");
  const exp = Number(exponente);
  const signo = mantisa.startsWith("-") ? "-" : "";
  const digitos = mantisa.replace("-", "").replace(".", "");
  const punto = exp + 1;
  if (punto > -4 && punto <= 16) {
    if (punto <= 0) return `${signo}0.${"0".repeat(-punto)}${digitos}`;
    if (punto >= digitos.length) return `${signo}${digitos}${"0".repeat(punto - digitos.length)}.0`;
    return `${signo}${digitos.slice(0, punto)}.${digitos.slice(punto)}`;
  }
  const resto = digitos.length > 1 ? `.${digitos.slice(1)}` : "";
  return `${signo}${digitos[0]}${resto}e${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
}

function reprPython(v: unknown): string {
  if (v === null || v === undefined) return "None";
  if (typeof v === "boolean") return v ? "True" : "False";
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number") return Number.isSafeInteger(v) ? String(v) : reprFloat(v);
  if (typeof v === "string") return reprTexto(v);
  if (Array.isArray(v)) return `[${v.map(reprPython).join(", ")}]`;
  if (typeof v === "object") {
    const pares = Object.entries(v as Record<string, unknown>).map(([k, x]) => `${reprTexto(k)}: ${reprPython(x)}`);
    return `{${pares.join(", ")}}`;
  }
  return String(v);
}

function tipoPython(v: unknown): string {
  if (v === null || v === undefined) return "NoneType";
  if (typeof v === "boolean") return "bool";
  if (typeof v === "number") return Number.isSafeInteger(v) ? "int" : "float";
  if (typeof v === "string") return "str";
  if (Array.isArray(v)) return "list";
  return "dict";
}

// pydantic recorta input_value a 25 caracteres + "..." + 24 cuando el repr pasa de 50.
function reprRecortado(v: unknown): string {
  const cps = Array.from(reprPython(v));
  return cps.length > 50 ? `${cps.slice(0, 25).join("")}...${cps.slice(-24).join("")}` : cps.join("");
}

// ─── JSON de los TextContent: pydantic_core.to_json(resultado, indent=2) ────────

// Columnas que Python convierte con float(): su JSON lleva ".0" cuando el valor es entero.
const CLAVES_FLOAT = new Set(["monto_adjudicado"]);

function jsonFloat(x: number): string {
  return Number.isInteger(x) && Math.abs(x) < 1e16 ? `${x}.0` : String(x);
}

export function aJsonPython(v: unknown, sangria = "", esFloat = false): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return esFloat ? jsonFloat(v) : String(v);
  if (typeof v !== "object") return JSON.stringify(v);
  const dentro = `${sangria}  `;
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    return `[\n${v.map((x) => dentro + aJsonPython(x, dentro)).join(",\n")}\n${sangria}]`;
  }
  const pares = Object.entries(v as Record<string, unknown>);
  if (pares.length === 0) return "{}";
  const cuerpo = pares.map(([k, x]) => `${dentro}${JSON.stringify(k)}: ${aJsonPython(x, dentro, CLAVES_FLOAT.has(k))}`);
  return `{\n${cuerpo.join(",\n")}\n${sangria}}`;
}

// ─── Validación de argumentos (modelo pydantic que FastMCP arma con la firma) ─

export type Campo =
  | { nombre: string; tipo: "str"; defecto?: string }
  | { nombre: string; tipo: "int"; defecto?: number };

export class ErrorValidacion extends Error {}

type Fallo = { campo: string; tipo: string; mensaje: string; valor: unknown };

const ENTERO_EN_TEXTO = /^[+-]?[0-9]+(?:_[0-9]+)*(?:\.0+)?$/;

// Entero en modo laxo de pydantic: bool → 0/1, float sin decimales, texto "12", " 1_000 ", "5.0".
function validarEntero(campo: string, v: unknown): bigint | Fallo {
  const fallo = (tipo: string, mensaje: string): Fallo => ({ campo, tipo, mensaje, valor: v });
  if (typeof v === "boolean") return v ? 1n : 0n;
  if (typeof v === "number") {
    return Number.isInteger(v)
      ? BigInt(v)
      : fallo("int_from_float", "Input should be a valid integer, got a number with a fractional part");
  }
  if (typeof v === "string") {
    const limpio = v.trim();
    return ENTERO_EN_TEXTO.test(limpio)
      ? BigInt(limpio.replace(/\.0+$/, "").replaceAll("_", ""))
      : fallo("int_parsing", "Input should be a valid integer, unable to parse string as an integer");
  }
  return fallo("int_type", "Input should be a valid integer");
}

// FastMCP.pre_parse_json: un campo no-str que llega como texto JSON de lista/objeto/null se decodifica.
function preParsear(campos: Campo[], args: Record<string, unknown>): Record<string, unknown> {
  const salida = { ...args };
  for (const c of campos) {
    const v = args[c.nombre];
    if (c.tipo === "str" || typeof v !== "string") continue;
    try {
      const parseado: unknown = JSON.parse(v);
      if (!["string", "number", "boolean"].includes(typeof parseado)) salida[c.nombre] = parseado;
    } catch {
      // No es JSON: queda como texto.
    }
  }
  return salida;
}

export type Valores = Record<string, string | bigint>;

export function validarArgumentos(modelo: string, campos: Campo[], args: Record<string, unknown>): Valores {
  const datos = preParsear(campos, args);
  const valores: Valores = {};
  const fallos: Fallo[] = [];
  for (const c of campos) {
    if (!Object.hasOwn(datos, c.nombre)) {
      if (c.defecto === undefined) {
        fallos.push({ campo: c.nombre, tipo: "missing", mensaje: "Field required", valor: datos });
      } else {
        valores[c.nombre] = c.tipo === "int" ? BigInt(c.defecto) : c.defecto;
      }
      continue;
    }
    const v = datos[c.nombre];
    if (c.tipo === "str") {
      if (typeof v === "string") valores[c.nombre] = v;
      else fallos.push({ campo: c.nombre, tipo: "string_type", mensaje: "Input should be a valid string", valor: v });
      continue;
    }
    const entero = validarEntero(c.nombre, v);
    if (typeof entero === "bigint") valores[c.nombre] = entero;
    else fallos.push(entero);
  }
  if (fallos.length) {
    const cabecera = `${fallos.length} validation error${fallos.length > 1 ? "s" : ""} for ${modelo}`;
    const cuerpo = fallos.map(
      (f) =>
        `${f.campo}\n  ${f.mensaje} [type=${f.tipo}, input_value=${reprRecortado(f.valor)}, input_type=${tipoPython(f.valor)}]\n` +
        `    For further information visit https://errors.pydantic.dev/${VERSION_PYDANTIC}/v/${f.tipo}`,
    );
    throw new ErrorValidacion([cabecera, ...cuerpo].join("\n"));
  }
  return valores;
}

// ─── Errores de Postgres como los imprime pg8000: dict de campos del protocolo ─

const CAMPOS_ERROR_PG: [string, string][] = [
  ["S", "severity"], ["V", "severity"], ["C", "code"], ["M", "message"], ["D", "detail"], ["H", "hint"],
  ["P", "position"], ["p", "internalPosition"], ["q", "internalQuery"], ["W", "where"], ["s", "schema"],
  ["t", "table"], ["c", "column"], ["d", "dataType"], ["n", "constraint"], ["F", "file"], ["L", "line"],
  ["R", "routine"],
];

export function textoError(e: unknown): string {
  if (e instanceof Error && typeof (e as { severity?: unknown }).severity === "string") {
    const campos: Record<string, unknown> = {};
    for (const [letra, prop] of CAMPOS_ERROR_PG) {
      const valor = (e as unknown as Record<string, unknown>)[prop];
      if (typeof valor === "string") campos[letra] = valor;
    }
    return reprPython(campos);
  }
  return e instanceof Error ? e.message : String(e);
}
