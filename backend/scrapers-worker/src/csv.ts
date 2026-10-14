/**
 * CSV en dos formas:
 *
 * - `leerCsv` / `filasDict`: el módulo `csv` de Python (dialecto excel, `strict=False`, archivo abierto
 *   con `newline=""`) y `csv.DictReader`, al carácter. Para archivos chicos (sancionados, < 1 MB).
 * - `CortadorCsv`: corta un CSV por BYTES en tramos que terminan en fin de registro (un salto de línea
 *   fuera de comillas, con la misma regla de comillas que el COPY … CSV de Postgres). Para mandar un
 *   archivo de 400 MB a COPY en varias sentencias sin partir un registro.
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
