/**
 * CSV en tres formas:
 *
 * - `leerCsv` / `filasDict`: el módulo `csv` de Python (dialecto excel, `strict=False`, archivo abierto
 *   con `newline=""`) y `csv.DictReader`, al carácter. Para archivos chicos (sancionados, < 1 MB).
 * - `CortadorCsv`: corta un CSV por BYTES en tramos que terminan en fin de registro (un salto de línea
 *   fuera de comillas, con la misma regla de comillas que el COPY … CSV de Postgres). Para mandar un
 *   archivo de 400 MB a COPY en varias sentencias sin partir un registro.
 * - `NormalizadorCsv`: reescribe en streaming un CSV "casi" estándar como el que espera COPY (comillas dobladas,
 *   todos los registros del ancho de la cabecera). Para los reportes de CONOSCE: desde el 2026-10-22 escapan la
 *   comilla con barra (`\"`) en vez de doblarla, y COPY partía esos registros en otros campos.
 */

const EOL = -1;
type Estado = "inicio_registro" | "inicio_campo" | "en_campo" | "en_comillas" | "comilla_en_comillas" | "comer_crlf";

/**
 * `list(csv.reader(io.StringIO(texto, newline=""), delimiter=d))`: registros como listas de campos; una
 * línea vacía da `[]` (DictReader las salta). Mismo autómata que _csv.c (sin escapechar).
 */
export function leerCsv(texto: string, delimitador = ","): string[][] {
  const registros: string[][] = [];
  let campos: string[] = [];
  let campo = "";
  let largo = 0;          // field_len de _csv.c: distingue "campo vacío" de "sin campo"
  let estado: Estado = "inicio_registro";
  const guardar = () => {
    campos.push(campo);
    campo = "";
    largo = 0;
  };
  const agregar = (c: string) => {
    campo += c;
    largo++;
  };
  const procesar = (c: string | typeof EOL) => {
    switch (estado) {
      case "inicio_registro":
        if (c === EOL) return;
        if (c === "\n" || c === "\r") {
          estado = "comer_crlf";
          return;
        }
        estado = "inicio_campo";
      // fallthrough
      case "inicio_campo":
        if (c === "\n" || c === "\r" || c === EOL) {
          guardar();
          estado = c === EOL ? "inicio_registro" : "comer_crlf";
        } else if (c === '"') estado = "en_comillas";
        else if (c === delimitador) guardar();
        else {
          agregar(c);
          estado = "en_campo";
        }
        return;
      case "en_campo":
        if (c === "\n" || c === "\r" || c === EOL) {
          guardar();
          estado = c === EOL ? "inicio_registro" : "comer_crlf";
        } else if (c === delimitador) {
          guardar();
          estado = "inicio_campo";
        } else agregar(c);
        return;
      case "en_comillas":
        if (c === EOL) return;
        if (c === '"') estado = "comilla_en_comillas";
        else agregar(c);
        return;
      case "comilla_en_comillas":
        if (c === '"') {
          agregar(c);
          estado = "en_comillas";
        } else if (c === delimitador) {
          guardar();
          estado = "inicio_campo";
        } else if (c === "\n" || c === "\r" || c === EOL) {
          guardar();
          estado = c === EOL ? "inicio_registro" : "comer_crlf";
        } else {
          agregar(c);              // strict=False: `"abc"def` → abcdef
          estado = "en_campo";
        }
        return;
      case "comer_crlf":
        if (c === "\n" || c === "\r") return;
        if (c === EOL) {
          estado = "inicio_registro";
          return;
        }
        throw new Error("new-line character seen in unquoted field");
    }
  };
  const cerrarLinea = () => {
    procesar(EOL);
    if (estado === "inicio_registro") {
      registros.push(campos);
      campos = [];
    }
  };
  // Las líneas las corta el archivo (newline=""): \r\n, \r o \n, y cada una termina con EOL.
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    procesar(c);
    if (c === "\n" || (c === "\r" && texto[i + 1] !== "\n")) cerrarLinea();
  }
  const ultimo = texto[texto.length - 1];
  if (texto.length && ultimo !== "\n" && ultimo !== "\r") cerrarLinea();
  // (las clausuras cambian `estado`: TypeScript no lo ve y lo daría por "inicio_registro")
  if (largo !== 0 || (estado as Estado) === "en_comillas") {
    guardar();                    // fin de datos con un campo abierto (strict=False lo guarda)
    registros.push(campos);
  }
  return registros;
}

/** `csv.DictReader`: la primera fila da los nombres; salta las filas vacías; lo que falta queda en null. */
export function filasDict(registros: string[][]): Record<string, string | null>[] {
  if (!registros.length) return [];
  const [cab, ...resto] = registros;
  const out: Record<string, string | null>[] = [];
  for (const fila of resto) {
    if (!fila.length) continue;
    const d: Record<string, string | null> = {};
    cab.forEach((k, i) => {
      d[k] = i < fila.length ? fila[i] : null;
    });
    out.push(d);
  }
  return out;
}

// 0x80-0x9F de cp1252 (los 5 que cp1252 no define → U+FFFD, como errors="replace" de Python).
const CP1252_ALTOS = "€�‚ƒ„…†‡ˆ‰Š‹Œ�Ž��‘’“”•–—˜™š›œ�žŸ";

/**
 * cp1252 con errors="replace", por tabla: el TextDecoder("windows-1252") de Node decodifica 0x80-0x9F
 * como Latin-1 (el guion largo 0x96 sale como U+0096).
 */
export function decodificarCp1252(datos: ArrayBuffer | Uint8Array): string {
  const b = datos instanceof Uint8Array ? datos : new Uint8Array(datos);
  const partes: string[] = [];
  for (let i = 0; i < b.length; i += 8192) {
    const trozo = b.subarray(i, i + 8192);
    let s = "";
    for (let j = 0; j < trozo.length; j++) {
      const x = trozo[j];
      s += x >= 0x80 && x <= 0x9f ? CP1252_ALTOS[x - 0x80] : String.fromCharCode(x);
    }
    partes.push(s);
  }
  return partes.join("");
}

/**
 * Corta un CSV por bytes en tramos que terminan justo después de un `\n` que no está entre comillas
 * (las comillas alternan el estado, como en Postgres con quote = escape = `"`). Los bytes `"` y `\n`
 * nunca aparecen dentro de un carácter UTF-8 multibyte: cortar ahí no parte caracteres.
 */
export class CortadorCsv {
  private enComillas = false;
  private resto: Uint8Array[] = [];

  /** Bytes completos (hasta el último fin de registro) o null si todavía no hay ninguno. */
  agregar(trozo: Uint8Array): Uint8Array | null {
    let ultimo = -1;
    if (!this.enComillas && trozo.indexOf(0x22) === -1) {
      ultimo = trozo.lastIndexOf(0x0a);
    } else {
      let comillas = this.enComillas;
      for (let i = 0; i < trozo.length; i++) {
        const b = trozo[i];
        if (b === 0x22) comillas = !comillas;
        else if (b === 0x0a && !comillas) ultimo = i;
      }
      this.enComillas = comillas;
    }
    if (ultimo === -1) {
      this.resto.push(trozo);
      return null;
    }
    const listo = unir([...this.resto, trozo.subarray(0, ultimo + 1)]);
    this.resto = ultimo + 1 < trozo.length ? [trozo.slice(ultimo + 1)] : [];
    return listo;
  }

  /** Lo que quedó después del último salto de línea (el último registro sin `\n`, si lo hay). */
  fin(): Uint8Array | null {
    const r = unir(this.resto);
    this.resto = [];
    return r.length ? r : null;
  }
}

function unir(partes: Uint8Array[]): Uint8Array {
  if (partes.length === 1) return partes[0];
  const out = new Uint8Array(partes.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of partes) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const COMA = 0x2c;
const COMILLA = 0x22;
const BARRA = 0x5c;
const LF = 0x0a;
const CR = 0x0d;
// Estados del lector.
const INICIO = 0;            // al empezar un campo
const SUELTO = 1;            // campo sin comillas
const COMILLAS = 2;          // dentro de comillas
const COMILLA_DENTRO = 3;    // una " dentro de comillas: ¿cierra, es "" o es una comilla suelta?
const BARRA_DENTRO = 4;      // una \ dentro de comillas (con `barra`): \" es una comilla
/** Un registro más largo es un CSV con comillas sin cerrar: se corta antes de juntar el resto del archivo en memoria. */
const MAX_REGISTRO = 4 << 20;

/** Un registro leído: sus campos (bytes, ya sin escapes) y si cada uno venía entre comillas. */
interface Registro {
  campos: Uint8Array[];
  citados: boolean[];
}

const enBlanco = (r: Registro) => r.campos.length === 1 && !r.campos[0].length && !r.citados[0];

/**
 * Lee un CSV por bytes, tolerante: comillas dobladas (`""`) y, con `barra`, también escapadas con barra (`\"`; una
 * barra seguida de otra cosa es texto); una comilla dentro de un campo entrecomillado que no lo cierra (no la sigue una
 * coma ni un fin de línea) es texto, como LazyQuotes de Go, y en un campo sin comillas también. Fin de registro: \n,
 * \r\n o \r fuera de comillas. `alRegistro` recibe cada registro con sus bytes crudos, para releerlo con otra regla.
 */
class LectorCsv {
  private readonly barra: boolean;
  private readonly alRegistro: (r: Registro, crudo: Uint8Array[]) => void;
  private estado = INICIO;
  private campo = new Uint8Array(4096);
  private largo = 0;
  private citado = false;
  private campos: Uint8Array[] = [];
  private citados: boolean[] = [];
  /** Lo crudo del registro en curso que vino en trozos anteriores, y cuánto es. */
  private crudo: Uint8Array[] = [];
  private bytesCrudo = 0;
  private trasCr = false;

  constructor(barra: boolean, alRegistro: (r: Registro, crudo: Uint8Array[]) => void) {
    this.barra = barra;
    this.alRegistro = alRegistro;
  }

  agregar(t: Uint8Array): void {
    let ini = 0;   // dónde empieza en `t` el registro en curso
    for (let i = 0; i < t.length; i++) {
      const b = t[i];
      if (this.trasCr) {
        this.trasCr = false;
        if (b === LF) {
          ini = i + 1;
          continue;
        }
      }
      switch (this.estado) {
        case INICIO:
          if (b === COMILLA) {
            this.estado = COMILLAS;
            this.citado = true;
          } else if (b === COMA) this.cerrarCampo();
          else if (b === LF || b === CR) {
            this.cerrarRegistro(t, ini, i, b);
            ini = i + 1;
          } else {
            this.byte(b);
            this.estado = SUELTO;
          }
          break;
        case SUELTO:
          if (b === COMA) {
            this.cerrarCampo();
            this.estado = INICIO;
          } else if (b === LF || b === CR) {
            this.cerrarRegistro(t, ini, i, b);
            ini = i + 1;
          } else this.byte(b);
          break;
        case COMILLAS:
          if (b === COMILLA) this.estado = COMILLA_DENTRO;
          else if (b === BARRA && this.barra) this.estado = BARRA_DENTRO;
          else this.byte(b);
          break;
        case BARRA_DENTRO:
          this.estado = COMILLAS;
          if (b === COMILLA) this.byte(COMILLA);
          else {
            this.byte(BARRA);   // la barra era texto: b se vuelve a leer
            i--;
          }
          break;
        case COMILLA_DENTRO:
          if (b === COMILLA) {
            this.byte(COMILLA);
            this.estado = COMILLAS;
          } else if (b === COMA) {
            this.cerrarCampo();
            this.estado = INICIO;
          } else if (b === LF || b === CR) {
            this.cerrarRegistro(t, ini, i, b);
            ini = i + 1;
          } else {
            this.byte(COMILLA);   // comilla suelta: es texto; b se vuelve a leer
            this.estado = COMILLAS;
            i--;
          }
          break;
      }
    }
    if (ini < t.length) {
      this.crudo.push(t.subarray(ini));
      this.bytesCrudo += t.length - ini;
      if (this.bytesCrudo > MAX_REGISTRO) throw new Error(`CSV con un registro de más de ${MAX_REGISTRO >> 20} MB: ¿comillas sin cerrar?`);
    }
  }

  /** El último registro, si el archivo no termina en fin de línea (o termina dentro de comillas). */
  fin(): void {
    this.trasCr = false;
    if (this.estado === BARRA_DENTRO) this.byte(BARRA);
    if (this.estado !== INICIO || this.largo || this.citado || this.campos.length) this.cerrarRegistro(new Uint8Array(0), 0, -1, LF);
  }

  private byte(b: number): void {
    if (this.largo === this.campo.length) {
      const c = new Uint8Array(this.campo.length * 2);
      c.set(this.campo);
      this.campo = c;
    }
    this.campo[this.largo++] = b;
  }

  private cerrarCampo(): void {
    this.campos.push(this.campo.slice(0, this.largo));
    this.citados.push(this.citado);
    this.largo = 0;
    this.citado = false;
  }

  /** Cierra el registro que termina en `t[i]` (el fin de línea `fin`). */
  private cerrarRegistro(t: Uint8Array, ini: number, i: number, fin: number): void {
    this.cerrarCampo();
    const crudo = this.crudo;
    crudo.push(t.subarray(ini, i + 1));
    const r = { campos: this.campos, citados: this.citados };
    this.campos = [];
    this.citados = [];
    this.crudo = [];
    this.bytesCrudo = 0;
    this.estado = INICIO;
    this.trasCr = fin === CR;
    this.alRegistro(r, crudo);
  }
}

/** Lo que se contó al normalizar un CSV. */
export interface CuentaCsv {
  /** Registros de datos que salieron (sin la cabecera). */
  registros: number;
  /** Con otro número de campos que la cabecera leyendo `\"` como comilla, que releídos sin esa regla cuadran. */
  realineados: number;
  /** Con menos campos que la cabecera: se completan con vacíos. */
  rellenados: number;
  /** Con campos de más, todos vacíos: se sacan. */
  recortados: number;
  /** Con campos de más que no están vacíos: no se cargan. */
  descartados: number;
  /** Líneas en blanco: se saltan. */
  vacios: number;
  /** Los primeros registros con problemas (el comienzo). */
  ejemplos: string[];
}

export const cuentaCsv = (): CuentaCsv => ({ registros: 0, realineados: 0, rellenados: 0, recortados: 0, descartados: 0, vacios: 0, ejemplos: [] });

const especial = (c: Uint8Array) => {
  for (let j = 0; j < c.length; j++) {
    const b = c[j];
    if (b === COMA || b === COMILLA || b === LF || b === CR) return true;
  }
  return false;
};

/**
 * Reescribe en streaming un CSV tolerante (`LectorCsv`, con `\"`) como CSV estándar: comillas dobladas, fin de línea
 * \n, sin BOM ni líneas en blanco, y todos los registros del ancho de la cabecera (el primero). Un campo que venía
 * entre comillas sale entre comillas (COPY distingue el vacío entre comillas, '', del NULL). Un registro de otro ancho
 * se relee sin `\"` (por si la barra era texto); si igual no cuadra se completa con vacíos (si le faltan campos), se
 * recorta (si le sobran vacíos) o se descarta, y se cuenta en `cuenta`.
 */
export class NormalizadorCsv {
  readonly cuenta: CuentaCsv;
  private readonly lector: LectorCsv;
  private ancho = -1;
  private sal = new Uint8Array(1 << 16);
  private n = 0;
  /** Los primeros bytes, hasta saber si empieza con BOM. */
  private inicio: Uint8Array | null = new Uint8Array(0);

  constructor(cuenta: CuentaCsv = cuentaCsv()) {
    this.cuenta = cuenta;
    this.lector = new LectorCsv(true, (r, crudo) => this.registro(r, crudo));
  }

  /** Los registros completos de lo que llegó, ya normalizados (null si todavía no hay ninguno). */
  agregar(t: Uint8Array): Uint8Array | null {
    if (this.inicio) {
      const junto = unir([this.inicio, t]);
      if (junto.length < 3) {
        this.inicio = junto;
        return null;
      }
      this.inicio = null;
      t = junto[0] === 0xef && junto[1] === 0xbb && junto[2] === 0xbf ? junto.subarray(3) : junto;
    }
    this.lector.agregar(t);
    return this.vaciar();
  }

  /** Lo que quedaba (el último registro, si el archivo no termina en fin de línea). */
  fin(): Uint8Array | null {
    if (this.inicio) {
      const t = this.inicio;
      this.inicio = null;
      this.lector.agregar(t);
    }
    this.lector.fin();
    return this.vaciar();
  }

  private registro(r: Registro, crudo: Uint8Array[]): void {
    const c = this.cuenta;
    if (enBlanco(r)) {
      c.vacios++;
      return;
    }
    if (this.ancho === -1) {
      this.ancho = r.campos.length;   // la cabecera
      this.escribir(r);
      return;
    }
    if (r.campos.length === this.ancho) {
      this.escribir(r);
      c.registros++;
      return;
    }
    const otros: Registro[] = [];
    const releido = new LectorCsv(false, (x) => {
      if (!enBlanco(x)) otros.push(x);
    });
    for (const p of crudo) releido.agregar(p);
    releido.fin();
    if (otros.length && otros.every((x) => x.campos.length === this.ancho)) {
      for (const x of otros) this.escribir(x);
      c.realineados += otros.length;
      c.registros += otros.length;
      return;
    }
    if (c.ejemplos.length < 3) c.ejemplos.push(new TextDecoder().decode(unir(crudo).subarray(0, 300)).slice(0, 160));
    if (r.campos.length < this.ancho) {
      while (r.campos.length < this.ancho) {
        r.campos.push(new Uint8Array(0));
        r.citados.push(false);
      }
      c.rellenados++;
    } else if (r.campos.slice(this.ancho).every((x) => !x.length)) {
      r.campos.length = this.ancho;
      r.citados.length = this.ancho;
      c.recortados++;
    } else {
      c.descartados++;
      return;
    }
    this.escribir(r);
    c.registros++;
  }

  private escribir(r: Registro): void {
    for (let k = 0; k < r.campos.length; k++) {
      const campo = r.campos[k];
      this.reservar(campo.length * 2 + 3);
      if (k) this.sal[this.n++] = COMA;
      if (r.citados[k] || especial(campo)) {
        this.sal[this.n++] = COMILLA;
        for (let j = 0; j < campo.length; j++) {
          if (campo[j] === COMILLA) this.sal[this.n++] = COMILLA;
          this.sal[this.n++] = campo[j];
        }
        this.sal[this.n++] = COMILLA;
      } else {
        this.sal.set(campo, this.n);
        this.n += campo.length;
      }
    }
    this.reservar(1);
    this.sal[this.n++] = LF;
  }

  private reservar(bytes: number): void {
    if (this.n + bytes <= this.sal.length) return;
    const s = new Uint8Array(Math.max(this.sal.length * 2, this.n + bytes));
    s.set(this.sal.subarray(0, this.n));
    this.sal = s;
  }

  private vaciar(): Uint8Array | null {
    if (!this.n) return null;
    const out = this.sal.slice(0, this.n);
    this.n = 0;
    return out;
  }
}

/** `origen` normalizado con `NormalizadorCsv`, contando en `cuenta`. */
export function normalizarCsv(origen: ReadableStream<Uint8Array>, cuenta: CuentaCsv = cuentaCsv()): ReadableStream<Uint8Array> {
  const n = new NormalizadorCsv(cuenta);
  return origen.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(t, c) {
      const s = n.agregar(t);
      if (s) c.enqueue(s);
    },
    flush(c) {
      const s = n.fin();
      if (s) c.enqueue(s);
    },
  }));
}
