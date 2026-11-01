/**
 * INFOBRAS (Contraloría) → obra_infobras (migración 160): las obras públicas, una por Código INFOBRAS, del XLSX
 * «DataSet-Obras-Publicas DD-MM-YYYY» de https://infobras.contraloria.gob.pe/InfobrasWeb/DataSets (el 2026-10-31: 57 MB,
 * 726 MB de XML, 97 columnas, 191 180 obras). Es la parte de INFOBRAS de backend/scripts/cargar_obras.py
 * (COLUMNAS_INFOBRAS, LECTORES, leer_infobras y cargar), que la cargaba a mano desde una PC en Lima, y que queda de
 * respaldo. La Contraloría sólo responde a IPs del Perú: la página y el archivo van por el relay de Lima
 * (backend/relay-lima, `relay: "lima"`).
 *
 * Pasos:
 *   1. `descargar`: la página de DataSets da el enlace del archivo vigente (su nombre lleva la fecha) y el archivo va a R2
 *      con Almacen.bajar, los dos por el relay (pasa el Content-Length del origen, así R2 lo recibe en streaming).
 *      INFOBRAS no manda Last-Modified: se baja siempre y el sha256 dice si cambió. Siempre a la misma clave
 *      (raw/infobras/obras/obras.xlsx): en R2 hay a lo más una copia.
 *   2. `cargar obra_infobras`: si el sha256 ya se cargó y no se pide `forzar`, nada (tampoco el paso 4). Si no, en UNA
 *      transacción: la hoja se lee en streaming desde R2 (filasXlsx de src/xlsx_flujo.ts: el XML trae el prefijo `x:`), se
 *      saltan las filas de título (de ahí sale la «Fecha de consulta»), se exige la cabecera de siempre y de cada fila
 *      salen SÓLO las 80 columnas que se guardan, tal como vienen, a una tabla temporal de texto (COPY en tramos de
 *      ≤ 40 s). Un INSERT … SELECT las normaliza a _obra_infobras con las funciones norm_* de las migraciones 223 y 225
 *      (los LECTORES de Python, en SQL): sin código o sin nombre no entra, y de un código repetido queda la primera fila.
 *      Después, el upsert por código, que sólo reescribe la fila que cambió (otra huella) o que vuelve después de
 *      retirada; lo que ya no vino queda `retirada`, salvo que lo copiado sea menos del 90 % de lo vivo (sería un archivo
 *      incompleto). Anota la fecha del archivo en obra_refresco ('infobras_fecha': hasta ese día refrescar_obras() cuenta
 *      la paralización) y registra la carga en datasets_cargas. En seco hace todo igual y termina con ROLLBACK.
 *   3. `borrar crudo`: el XLSX trae nombres de personas, así que se borra de R2 en cuanto terminan los pasos 1 y 2, haya
 *      cargado, ya estuviera cargado o haya fallado alguno de los dos.
 *   4. `refrescar_obras`: refrescar_obras(true) (~6,5 min en producción), sólo si algo cambió: obras nuevas, cambiadas o
 *      retiradas, o la fecha del archivo (las banderas de paralización se cuentan hasta ella). Lo que hacía --propagar
 *      (casos_cruce y empresas) lo hace la cadena de cruces de cada mañana.
 *
 * Como invierte_pe, termina en refrescar_obras(): las dos no deberían correr el mismo día (la carga espera un bloqueo
 * sólo 20 s). La primera corrida reescribe todas las filas una vez: la huella se arma en SQL y no coincide con la de
 * Python (ver la migración 225).
 *
 * Privacidad: de INFOBRAS nunca se guardan los nombres del residente y del supervisor de obra («Nombres Apellidos»), sus
 * fechas de labores, los comentarios, la dirección ni el documento de aprobación. Esas columnas se descartan al leer la
 * hoja: no llegan a la base (ni a una tabla temporal) ni al registro. El crudo, que sí las trae tal como lo publica la
 * Contraloría, se borra de R2 (paso 3). Ningún DNI: el archivo no trae columnas de DNI. El ejecutor o el supervisor que es
 * una persona natural viene con su RUC 10 y se guarda como con Python: la API le pone la ref y le tapa un apellido
 * (migración 160).
 *
 * CPU y memoria (medido en Node el 2026-10-31 con el archivo de ese día): leer las 191 mil filas y armar el CSV de las
 * columnas que se guardan (149 MB) toma ~17 s de CPU, y ~20 s el paso de carga entero; la memoria no crece con el archivo
 * (se infla de a 64 KB). Contra un Postgres 16 local, el paso tarda ~50 s: COPY ~17 s, la cuenta de ilegibles ~8 s,
 * normalizar ~15 s y el upsert de 2 a 7 s (lo que cambió).
 */

import type { WorkflowStep } from "cloudflare:workers";
import { Almacen, uri } from "../almacen.ts";
import type { Entrada } from "../almacen.ts";
import { registrarCarga, yaCargado } from "../cargas.ts";
import type { Env, ParamsCorrida } from "../config.ts";
import { conDb } from "../db.ts";
import type { Db } from "../db.ts";
import { ErrorHttp, obtener } from "../http.ts";
import { registrar } from "../registro.ts";
import { campoCsv, filasXlsx } from "../xlsx_flujo.ts";
import type { LeerRango } from "../xlsx_flujo.ts";
import { CARGA, DESCARGA, LECTURA, esperarRelayLima, fechaLima } from "./comun.ts";
import { copiarEnTramos } from "./pnda_dji.ts";

const FUENTE = "infobras";
/** Clave en datasets_cargas (la de cargar_obras.py) y carpeta del crudo en R2. */
const CLAVE = "obras";
const TABLA = "obra_infobras";
export const INFOBRAS = "https://infobras.contraloria.gob.pe";
export const URL_DATASETS = `${INFOBRAS}/InfobrasWeb/DataSets`;
/** El nombre del crudo en R2: siempre el mismo, así la corrida siguiente lo pisa si algo impidió borrarlo. */
const ARCHIVO = "obras.xlsx";
/** Un archivo más chico no es el de INFOBRAS (cargar_obras.py pedía lo mismo); hoy pesa ~57 MB. */
const MINIMO_BYTES = 10_000_000;
/** Si lo copiado es menos que esta parte de las obras vivas, el archivo vino incompleto: no se marcan retiradas. */
const MINIMO_COMPLETO = 0.9;
/** El paso de carga, como CARGA_GRANDE de pnda_dji: hasta 30 min y un reintento (la transacción entera o nada). */
const CARGA_GRANDE = { retries: { limit: 1, delay: "2 minutes" }, timeout: "30 minutes" } as const;
/** La tabla temporal con las columnas que se guardan, tal como vienen. */
const CRUDA = "_infobras_crudo";
/** En la tabla temporal, el número de fila de la hoja (su orden): ninguna columna de obra_infobras se llama así. */
const FILA = "_fila";

export type Tipo = "texto" | "entero" | "entero0" | "monto" | "monto0" | "fecha" | "cui" | "snip" | "ruc" | "si" | "si_nulo";

/**
 * La expresión SQL que hace lo del lector de Python con una columna de texto (las funciones de las migraciones 223 y 225).
 * entero0 y monto0 son `entero(v) or 0` y `monto(v) or 0.0` de Python.
 */
const LECTOR: Record<Tipo, (columna: string) => string> = {
  texto: (c) => `norm_texto(${c})`,
  entero: (c) => `norm_entero(${c})`,
  entero0: (c) => `COALESCE(norm_entero(${c}), 0)`,
  monto: (c) => `norm_monto(${c})`,
  monto0: (c) => `COALESCE(norm_monto(${c}), 0)`,
  fecha: (c) => `norm_fecha(${c})`,
  cui: (c) => `norm_cui(${c})`,
  snip: (c) => `norm_snip(${c})`,
  ruc: (c) => `norm_ruc(${c})`,
  si: (c) => `norm_si(${c})`,
  si_nulo: (c) => `norm_si_nulo(${c})`,
};

/**
 * Las 97 columnas del XLSX, en su orden: (cabecera tal como viene, columna de obra_infobras, tipo). Sin columna: no se
 * guarda, y ni se copia a la base. Es COLUMNAS_INFOBRAS de cargar_obras.py.
 */
export const COLUMNAS: readonly (readonly [cabecera: string, destino: string | null, tipo: Tipo | null])[] = [
  ["codigo Entidad", "entidad_codigo", "texto"],
  ["Entidad Pública", "entidad_nombre", "texto"],
  ["Código INFOBRAS", "codigo", "entero"],
  ["Nombre de obra", "nombre", "texto"],
  ["Modalidad de ejecución de la obra", "modalidad", "texto"],
  ["¿Corresponde a un saldo de Obra?", "es_saldo", "si"],
  ["Código INFOBRAS de obra inicial", "obra_inicial", "entero"],
  ["Naturaleza de la obra", "naturaleza", "texto"],
  ["Tipo de obra - Clasificador Nivel 1", "tipo1", "texto"],
  ["Tipo de obra - Clasificador Nivel 2", "tipo2", "texto"],
  ["Tipo de obra - Clasificador Nivel 3", "tipo3", "texto"],
  ["Estado de ejecución", "estado", "texto"],
  ["Marca Reconstrucción con Cambios (Si/No)", null, null],
  ["Marca Reactivación Economicas (Si/No)", null, null],
  ["Otra Marca", null, null],
  ["N° de Veedurías Ciudadanas", "veedurias", "entero0"],
  ["N° Informes de control", "informes_control", "entero0"],
  ["N° Comentarios ciudadanos", "comentarios_ciudadanos", "entero0"],
  ["¿Es una obra de carácter reservado?", null, null],
  ["Nivel de gobierno", "nivel_gobierno", "texto"],
  ["Sector de la Entidad", "sector", "texto"],
  ["Codigo unico de inversión", "cui", "cui"],
  ["Código SNIP", "snip", "snip"],
  ["Nombre de la inversión", "inversion_nombre", "texto"],
  ["Estado del proyecto", null, null],
  ["Tipo Formato", null, null],
  ["Monto Viable/Aprobado", "monto_viable", "monto"],
  ["Costo Actualizado de la inversión", null, null],          // siempre 0 en el archivo: el de Invierte.pe sí sirve
  ["N° obras pertenecientes a la inversión", "obras_en_inversion", "entero"],
  ["Departamento", "departamento", "texto"],
  ["Provincia", "provincia", "texto"],
  ["Distrito", "distrito", "texto"],
  ["Dirección o información de referencia", null, null],    // texto libre
  ["Tipo de ubicación (exacta/referencial)", null, null],
  ["Fecha de aprobación del expediente ", "fecha_aprob_et", "fecha"],
  ["Costo de obra según Expediente técnico", null, null],   // en su moneda; va el de soles
  ["Moneda", "moneda_et", "texto"],
  ["Tasa de cambio", null, null],
  ["Costo de obra en soles según ET en soles", "costo_et", "monto"],
  ["Documento de aprobación de expediente", null, null],    // texto libre
  ["RUC (Ejecución)", "ejecutor_ruc", "ruc"],
  ["Nombre o razón social de la empresa o consorcio", "ejecutor_nombre", "texto"],
  ["Monto del contrato  en soles", "contrato_monto", "monto"],
  ["RUC (Supervisión)", "supervisor_ruc", "ruc"],
  ["Nombre o razón social de la empresa o consorcio:", "supervisor_nombre", "texto"],
  ["Monto del contrato  en soles", "supervision_monto", "monto"],
  ["Nombres Apellidos (Supervisión)", null, null],          // PERSONA: nunca se guarda
  ["Fecha inicio supervision", "supervision_inicio", "fecha"],
  ["Fecha fin supervision", "supervision_fin", "fecha"],
  ["Nombres Apellidos (Residente)", null, null],            // PERSONA: nunca se guarda
  ["Fecha inicio de labores", null, null],                  // las del residente
  ["Fecha fin  de labores", null, null],
  ["Fecha de inicio de obra", "fecha_inicio", "fecha"],
  ["Fecha finalización programada de obra", "fecha_fin_prog", "fecha"],
  ["Plazo de ejecución (en dias)", "plazo_dias", "entero"],
  ["Tipo de entrega", "entrega_terreno", "texto"],
  ["Porcentaje de terreno entregado", "terreno_pct", "monto"],
  ["Fecha de entrega del terreno", "fecha_terreno", "fecha"],
  ["Año de avance", "avance_anio", "entero"],
  ["Mes de avance", "avance_mes", "entero"],
  ["Fecha de registro de avance", "avance_fecha", "fecha"],
  ["Avance Físico Programado Acumulado (%)", "fisico_prog", "monto"],
  ["Avance Físico Real Acumulado (%)", "fisico_real", "monto"],
  ["Monto de valorización Programado Acumulado", "valorizado_prog", "monto"],
  ["Monto de valorización Ejecutado Acumulado", "valorizado_real", "monto"],
  ["Porcentaje de ejecución financiera", "financiero_pct", "monto"],
  ["Monto de ejecución financiera de la obra", "financiero_monto", "monto"],
  ["Existe Paralización", "paralizada", "si"],
  ["Causal de paralización", "causal_paralizacion", "texto"],
  ["Fecha de paralización", "fecha_paralizacion", "fecha"],
  ["Número de dias paralizado", "dias_paralizada", "entero"],
  ["Comentarios", null, null],                              // texto libre
  ["N° de modificaciones", "modificaciones", "entero0"],
  ["N° días de modificaciones de plazo", "dias_ampliacion", "entero0"],
  ["Nuevo Plazo de ejecución (en dias)", "nuevo_plazo", "entero"],
  ["Fecha finalización reprogramada de obra", "fecha_fin_reprog", "fecha"],
  ["N° de controversias", "controversias", "entero0"],
  ["N° de adicionales de obra", "adicionales_n", "entero0"],
  ["Monto de adicionales de obra en soles", "adicionales_monto", "monto0"],
  ["N° de adicionales de supervisión", "adic_sup_n", "entero0"],
  ["Monto de adicionales de supervisión en soles", "adic_sup_monto", "monto0"],
  ["N° de deductivos de obra", "deductivos_n", "entero0"],
  ["Monto de deductivos de obra en soles", "deductivos_monto", "monto0"],
  ["N° de deductivos de supervisión ", "deduc_sup_n", "entero0"],
  ["Monto de deductivos de supervisión en soles", "deduc_sup_monto", "monto0"],
  ["Fecha de finalización real", "fecha_fin_real", "fecha"],
  ["Motivo en caso no se llegue al 100%", "motivo_no_100", "texto"],
  ["¿Tiene recepción total?", "recepcion", "si_nulo"],
  ["Fecha de recepción", "fecha_recepcion", "fecha"],
  ["¿Tiene liquidación de obra?", "liquidacion", "si_nulo"],
  ["Fecha de aprobación de liquidación de obra", "fecha_liquidacion", "fecha"],
  ["Costo de la obra en soles", "costo_liquidacion", "monto"],
  ["¿Corresponde la transferencia  a otra entidad?", "transferida", "si_nulo"],
  ["Fecha de transferencia", "fecha_transferencia", "fecha"],
  ["Tipo de entidad que recepciona la obra", "receptora", "texto"],
  ["Año de primer devengado", "devengado_desde", "entero"],
  ["Monto Total devengado del proyecto", "devengado_total", "monto"],
];

/** Las columnas que se guardan: su posición en la hoja, su columna de obra_infobras y su tipo, en el orden de la hoja. */
export const GUARDADAS = COLUMNAS.flatMap(([, destino, tipo], i) => (destino && tipo ? [{ i, destino, tipo }] : []));
/** Las columnas de la tabla temporal y del CSV que va a COPY (todas de texto). */
export const DESTINOS = GUARDADAS.map((c) => c.destino);
/** Lo que pasa de _obra_infobras a obra_infobras (CAMPOS_OBRA de Python). */
const CAMPOS = [...DESTINOS, "huella", "dataset_fecha"];
/** Las columnas en que Python contaba los valores que no pudo leer («ilegible: <campo>»). */
const CON_ILEGIBLES = GUARDADAS.filter((c) => c.tipo === "monto" || c.tipo === "fecha" || c.tipo === "entero");

const REGEX_ENLACE = /(\/InfobrasWeb\/Archivo\/DownloadFile\?filename=DataSet-Obras-Publicas[^"']+)/;
const REGEX_CONSULTA = /Fecha de consulta:\s*(\d{1,2}\/\d{1,2}\/\d{4})/;

/** El enlace del dataset de obras en la página de DataSets (el nombre lleva la fecha de publicación), o null. */
export function enlaceObras(html: string): string | null {
  const m = REGEX_ENLACE.exec(html);
  return m ? INFOBRAS + m[1].replaceAll("&amp;", "&") : null;
}

/** «DataSet-Obras-Publicas 31-10-2026.xlsx»: el nombre con que lo publica INFOBRAS (va a datasets_cargas.archivo). */
export function nombrePublicado(url: string): string {
  const u = new URL(url);
  return `${u.searchParams.get("filename") ?? "DataSet-Obras-Publicas"}${u.searchParams.get("extension") ?? ".xlsx"}`;
}

/** fecha() de Python: «31/10/2026» (y lo que siga tras un espacio) → «2026-10-31»; un día que no existe o fuera de 1980–2100, null. */
export function fechaDmy(v: string | null | undefined): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s.*)?$/.exec((v ?? "").trim());
  if (!m) return null;
  const [d, mes, a] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const f = new Date(Date.UTC(a, mes - 1, d));
  if (a < 1980 || a > 2100 || f.getUTCMonth() !== mes - 1 || f.getUTCDate() !== d) return null;
  return f.toISOString().slice(0, 10);
}

/**
 * La cabecera tiene que ser la de siempre (las 97 primeras celdas, tal cual): si INFOBRAS cambia columnas, no se carga. Si
 * la fila trae la mayoría de los nombres de siempre, el error dice cuáles cambiaron (como Python); si no, puede ser una fila
 * de datos tomada por cabecera, con nombres de personas, y el error no muestra lo que trae (va al registro y a la bitácora).
 */
export function revisarCabecera(celdas: (string | null)[]): void {
  const distintas = COLUMNAS.map(([esperada], i) => [i, esperada, celdas[i] ?? ""] as const).filter(([, a, b]) => a !== b);
  if (!distintas.length) return;
  const conocidas = new Set(COLUMNAS.map(([c]) => c));
  const coinciden = celdas.filter((c) => c != null && conocidas.has(c)).length;
  if (coinciden >= COLUMNAS.length / 2) {
    throw new Error(`INFOBRAS cambió sus columnas: ${JSON.stringify(distintas.slice(0, 5))} (de ${celdas.length})`);
  }
  throw new Error(`INFOBRAS cambió sus columnas: la fila que hace de cabecera trae ${coinciden} de los ${COLUMNAS.length} nombres ` +
    `de siempre (de ${celdas.length} celdas)`);
}

/** Lo que se contó al leer la hoja (se completa al terminar). */
export interface CuentaObras {
  /** Filas que siguen a la cabecera, también las vacías (`filas` de Python). */
  filas: number;
  /** «Fecha de consulta» de las filas de título, AAAA-MM-DD (null si no vino). */
  consulta: string | null;
  /** Filas con algo escrito después de la columna 97: no se lee, como en Python. */
  anchas: number;
}

export const cuentaObras = (): CuentaObras => ({ filas: 0, consulta: null, anchas: 0 });

/**
 * Las filas de la hoja como el CSV que va a COPY: la cabecera (DESTINOS) y una línea por fila de datos con sus columnas
 * que se guardan, tal como vienen. Las filas antes de la cabecera (la primera con 5 celdas o más) no salen: de ellas sale
 * la «Fecha de consulta». Las columnas que no se guardan (los nombres de personas, entre ellas) no salen nunca.
 */
export function obrasComoCsv(filas: AsyncIterable<(string | null)[]>, cuenta: CuentaObras = cuentaObras(), trozo = 1 << 20):
    ReadableStream<Uint8Array> {
  const it = filas[Symbol.asyncIterator]();
  const enc = new TextEncoder();
  let cabecera = false;
  return new ReadableStream<Uint8Array>({
    async pull(ctl) {
      let salida = "";
      let terminado = false;
      while (salida.length < trozo) {
        const r = await it.next();
        if (r.done) {
          terminado = true;
          break;
        }
        const celdas = r.value;
        if (!cabecera) {
          const m = REGEX_CONSULTA.exec(celdas.map((c) => c ?? "").join(" "));
          if (m) cuenta.consulta = fechaDmy(m[1]);
          if (celdas.filter((c) => c).length >= 5) {
            revisarCabecera(celdas);
            cabecera = true;
            salida += `${DESTINOS.join(",")}\n`;
          }
          continue;
        }
        cuenta.filas++;
        if (celdas.length > COLUMNAS.length && celdas.some((c, k) => k >= COLUMNAS.length && c)) cuenta.anchas++;
        let linea = "";
        for (let k = 0; k < GUARDADAS.length; k++) linea += (k ? "," : "") + campoCsv(celdas[GUARDADAS[k].i] ?? null);
        salida += `${linea}\n`;
      }
      if (terminado && !cabecera) throw new Error("INFOBRAS: la hoja no trae la cabecera");
      if (salida) ctl.enqueue(enc.encode(salida));
      if (terminado) ctl.close();
    },
    async cancel(motivo) {
      await it.return?.(motivo);
    },
  });
}

/** La tabla temporal: el número de fila y una columna de texto por columna que se guarda. */
export const SQL_CRUDA =
  `CREATE TEMP TABLE ${CRUDA} (${FILA} bigint GENERATED ALWAYS AS IDENTITY, ${DESTINOS.map((d) => `${d} text`).join(", ")}) ON COMMIT DROP`;

/** Las filas de la hoja, las que no traen código o nombre (las descarta el INSERT) y, por columna, las que no se leen. */
export const SQL_CUENTA = `SELECT count(*)::int AS filas,
       count(*) FILTER (WHERE ${LECTOR.entero(`s.codigo`)} IS NULL OR ${LECTOR.texto(`s.nombre`)} IS NULL)::int AS sin_codigo_o_nombre,
${CON_ILEGIBLES.map((c) => `       count(*) FILTER (WHERE ${LECTOR[c.tipo](`s.${c.destino}`)} IS NULL AND norm_texto(s.${c.destino}) IS NOT NULL)::int AS ${c.destino}`).join(",\n")}
  FROM ${CRUDA} s`;

/** La tabla con una fila por obra, como obra_infobras: la llave hace que un código no entre dos veces. */
export const SQL_DESTINO = `CREATE TEMP TABLE _obra_infobras (LIKE ${TABLA} INCLUDING DEFAULTS, PRIMARY KEY (codigo)) ON COMMIT DROP`;

/**
 * El INSERT … SELECT que normaliza la temporal en _obra_infobras ($1: la fecha de consulta del archivo, que va a
 * dataset_fecha). Sin código o sin nombre no entra; de cada código queda la primera fila de la hoja (como `codigos` en
 * leer_infobras). La huella es el md5 de los valores normalizados: un valor que se guarda distinto la cambia. El OFFSET 0
 * hace que cada celda se normalice una sola vez (sin él, Postgres repite cada expresión dentro del md5).
 */
export const SQL_NORMALIZAR = `INSERT INTO _obra_infobras (${CAMPOS.join(", ")})
SELECT DISTINCT ON (x.codigo) ${DESTINOS.map((d) => `x.${d}`).join(", ")}, md5(ROW(${DESTINOS.map((d) => `x.${d}`).join(", ")})::text), $1::date
  FROM (SELECT s.${FILA} AS fila,
${GUARDADAS.map((c) => `               ${LECTOR[c.tipo](`s.${c.destino}`)} AS ${c.destino}`).join(",\n")}
          FROM ${CRUDA} s
        OFFSET 0) x
 WHERE x.codigo IS NOT NULL AND x.nombre IS NOT NULL
 ORDER BY x.codigo, x.fila`;

/**
 * El upsert de cargar_obras.py (SQL_UPSERT): sólo reescribe la fila que cambió (otra huella) o que vuelve después de
 * retirada, y dataset_fecha queda como la del archivo que trajo esa versión. Cuenta las nuevas (xmax = 0: se insertó) y
 * las que cambiaron, sin traer una fila por obra.
 */
export const SQL_UPSERT = `WITH up AS (
  INSERT INTO ${TABLA} AS t (${CAMPOS.join(", ")}, retirada, cargado_at, cambiado_at)
  SELECT DISTINCT ON (codigo) ${CAMPOS.join(", ")}, false, now(), now() FROM _obra_infobras ORDER BY codigo
  ON CONFLICT (codigo) DO UPDATE SET ${CAMPOS.filter((c) => c !== "codigo").map((c) => `${c} = EXCLUDED.${c}`).join(", ")},
    retirada = false, cambiado_at = now()
  WHERE t.huella IS DISTINCT FROM EXCLUDED.huella OR t.retirada
  RETURNING (xmax = 0) AS nueva)
SELECT count(*) FILTER (WHERE nueva)::int AS nuevas, count(*) FILTER (WHERE NOT nueva)::int AS cambiadas FROM up`;

/** Lo que ya no vino en el archivo (completo) queda retirada, como en Python. */
export const SQL_RETIRAR = `UPDATE ${TABLA} t SET retirada = true, cambiado_at = now()
 WHERE NOT t.retirada AND NOT EXISTS (SELECT 1 FROM _obra_infobras x WHERE x.codigo = t.codigo)`;

/** El día del archivo anterior (obra_refresco, clave 'infobras_fecha'), AAAA-MM-DD. */
export const SQL_FECHA_ANTERIOR =
  "SELECT to_char((valor AT TIME ZONE 'America/Lima')::date, 'YYYY-MM-DD') AS fecha FROM obra_refresco WHERE clave = 'infobras_fecha'";

/** El día de este archivo ($1), como lo anotaba cargar_obras.py: hasta él cuenta refrescar_obras() los días de paralización. */
export const SQL_FECHA = `INSERT INTO obra_refresco (clave, valor, nota)
VALUES ('infobras_fecha', ($1::date)::timestamp AT TIME ZONE 'America/Lima', 'fecha de consulta del último archivo de INFOBRAS')
ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor`;

/** El archivo ya en R2 y el nombre con que lo publica INFOBRAS. */
export interface Bajado {
  entrada: Entrada;
  archivo: string;
}

export interface ResumenCarga {
  /** El archivo, como lo publica INFOBRAS («DataSet-Obras-Publicas 31-10-2026.xlsx»). */
  archivo: string;
  /** La «Fecha de consulta» del archivo (null si no vino) y la que queda en obra_refresco (sin ella, hoy en Lima). */
  consulta: string | null;
  fecha: string;
  /** La de la carga anterior. */
  fecha_anterior: string | null;
  /** Filas de la hoja, las sin código o sin nombre (no entran) y las de un código que ya vino (queda la primera). */
  filas: number;
  sin_codigo_o_nombre: number;
  codigos_repetidos: number;
  /** Obras distintas que trajo el archivo y se compararon con obra_infobras. */
  copiadas: number;
  nuevas: number;
  cambiadas: number;
  iguales: number;
  retiradas: number;
  /** Por columna, los valores que no se pudieron leer (como «ilegible: <campo>» de Python; sólo los que no son cero). */
  ilegibles?: Record<string, number>;
  /** Filas con algo escrito después de la columna 97 (no se lee). */
  anchas?: number;
  /** Por qué no se marcaron retiradas, si no se marcaron. */
  sin_retirar?: string;
  /** Sentencias COPY. */
  sentencias: number;
  segundos: number;
  seco?: boolean;
}

export type ResultadoCarga = ResumenCarga | { ya_cargado: true; sha256: string };

/** Si la carga tocó obra_infobras o la fecha del archivo (y hay que correr refrescar_obras). */
export const hayCambios = (r: Pick<ResumenCarga, "nuevas" | "cambiadas" | "retiradas" | "fecha" | "fecha_anterior">) =>
  r.nuevas + r.cambiadas + r.retiradas > 0 || r.fecha !== r.fecha_anterior;

/** El paso de carga (ver el comentario del principio). Corre dentro de una conexión; la transacción es suya. */
export async function cargarObras(env: Env, db: Db, b: Bajado, p: Pick<ParamsCorrida, "seco" | "forzar">, id: string): Promise<ResultadoCarga> {
  const e = b.entrada;
  const log = { fuente: FUENTE, instancia: id };
  if (!p.seco && !p.forzar && (await yaCargado(db, FUENTE, CLAVE, e.sha256))) {
    registrar("INFO", `   ${b.archivo}: ya se cargó con el mismo sha256: no se carga ni se refresca nada`, log);
    return { ya_cargado: true, sha256: e.sha256 };
  }
  const t0 = Date.now();
  const clave = `raw/${e.file}`;
  const enR2 = await env.CRUDOS.head(clave);
  if (!enR2) throw new Error(`falta el crudo r2://${clave}`);
  if (enR2.size !== e.bytes) throw new Error(`${b.archivo}: en R2 hay ${enR2.size} bytes y la descarga anotó ${e.bytes} (¿otra corrida lo reemplazó?)`);
  // La hoja se lee por rangos de R2, como los XLSX de CONOSCE.
  const leer: LeerRango = async (offset, length) => {
    const parte = await env.CRUDOS.get(clave, { range: { offset, length } });
    if (!parte) throw new Error(`falta el crudo r2://${clave}`);
    return parte.body;
  };
  await db.ejecutar("BEGIN");
  try {
    // Como cargar_obras.py: no esperar más de 20 s un bloqueo (un refrescar_obras() de invierte_pe o de la PC, por
    // ejemplo) y sin tope por sentencia. Y memoria para ordenar por código las ~191 mil filas sin ir a disco.
    await db.ejecutar("SET LOCAL lock_timeout = '20s'");
    await db.ejecutar("SET LOCAL statement_timeout = 0");
    await db.ejecutar("SET LOCAL work_mem = '256MB'");
    await db.ejecutar(SQL_CRUDA);
    const cuenta = cuentaObras();
    const t1 = Date.now();
    const { filas, sentencias } = await copiarEnTramos(db, CRUDA, DESTINOS, obrasComoCsv(filasXlsx(leer, e.bytes), cuenta));
    // COPY tiene que haber leído las mismas filas que se contaron al leer la hoja.
    if (filas !== cuenta.filas) throw new Error(`${b.archivo}: COPY cargó ${filas} filas y la hoja tiene ${cuenta.filas}`);
    const [c] = await db.filas<Record<string, number>>(SQL_CUENTA);
    const ilegibles = Object.fromEntries(CON_ILEGIBLES.map((x) => [x.destino, c[x.destino]] as const).filter(([, n]) => n > 0));
    registrar("INFO", `   ${b.archivo} → ${CRUDA}: ${filas} filas en ${sentencias} COPY (consulta del ${cuenta.consulta ?? "?"}; ` +
      `${Math.round((Date.now() - t1) / 1000)}s)`, log);
    if (!cuenta.consulta) registrar("WARNING", "   el archivo no trae la «Fecha de consulta»: queda la de hoy", log);
    await db.ejecutar(SQL_DESTINO);
    const copiadas = await db.ejecutar(SQL_NORMALIZAR, [cuenta.consulta]);
    const [upsert] = await db.filas<{ nuevas: number; cambiadas: number }>(SQL_UPSERT);
    const [{ vivas }] = await db.filas<{ vivas: number }>(`SELECT count(*)::int AS vivas FROM ${TABLA} WHERE NOT retirada`);
    let retiradas = 0;
    let sinRetirar: string | undefined;
    if (copiadas < MINIMO_COMPLETO * vivas) {
      sinRetirar = `el archivo trae ${copiadas} de ${vivas} obras vivas: no se marcan retiradas (¿archivo incompleto?)`;
      registrar("WARNING", `   ${TABLA}: ${sinRetirar}`, log);
    } else {
      retiradas = await db.ejecutar(SQL_RETIRAR);
    }
    const [anterior] = await db.filas<{ fecha: string | null }>(SQL_FECHA_ANTERIOR);
    const fecha = cuenta.consulta ?? fechaLima();
    await db.ejecutar(SQL_FECHA, [fecha]);
    const resumen: ResumenCarga = {
      archivo: b.archivo, consulta: cuenta.consulta, fecha, fecha_anterior: anterior?.fecha ?? null, filas,
      sin_codigo_o_nombre: c.sin_codigo_o_nombre, codigos_repetidos: filas - c.sin_codigo_o_nombre - copiadas, copiadas,
      nuevas: upsert.nuevas, cambiadas: upsert.cambiadas, iguales: copiadas - upsert.nuevas - upsert.cambiadas, retiradas,
      sentencias, segundos: Math.round((Date.now() - t0) / 1000),
    };
    if (Object.keys(ilegibles).length) resumen.ilegibles = ilegibles;
    if (cuenta.anchas) resumen.anchas = cuenta.anchas;
    if (sinRetirar) resumen.sin_retirar = sinRetirar;
    registrar("INFO", `   ${TABLA}${p.seco ? " (en seco)" : ""}: ${copiadas} obras, ${resumen.nuevas} nuevas, ${resumen.cambiadas} cambiadas, ` +
      `${resumen.iguales} iguales, ${retiradas} retiradas; ${resumen.sin_codigo_o_nombre} sin código o nombre, ` +
      `${resumen.codigos_repetidos} códigos repetidos (${resumen.segundos}s)`, log);
    if (p.seco) {
      await db.ejecutar("ROLLBACK");
      return { ...resumen, seco: true };
    }
    // descargado_at: cuándo se bajó (INFOBRAS no manda Last-Modified); la fecha de los datos es la de consulta.
    await registrarCarga(db, {
      fuente: FUENTE, clave: CLAVE, tabla: TABLA, archivo: b.archivo, gcs_uri: uri(e), sha256: e.sha256, bytes: e.bytes,
      filas: copiadas, fuente_url: e.url, descargado_at: e.modified ?? e.downloaded_at,
    });
    await db.ejecutar("COMMIT");
    return resumen;
  } catch (err) {
    await db.ejecutar("ROLLBACK").catch(() => undefined);
    throw err;
  }
}

/** La página de DataSets, por el relay de Lima (directo y por Zúrich no responde). */
export async function leerDatasets(env: Env): Promise<string> {
  const r = await obtener(env, URL_DATASETS, { relay: "lima", timeoutMs: 120_000 });
  if (!r.ok) {
    await r.body?.cancel();
    throw new ErrorHttp(r.status, URL_DATASETS, r.headers.get("x-relay-status")
      ? "por el relay de Lima"
      : "el relay de Lima no llegó a INFOBRAS (backend/relay-lima; respaldo: backend/scripts/cargar_obras.py)");
  }
  return r.text();
}

/** El paso de descarga: el enlace vigente y el archivo, por el relay de Lima, a raw/infobras/obras/obras.xlsx. */
export async function bajarObras(env: Env): Promise<Bajado> {
  const url = enlaceObras(await leerDatasets(env));
  if (!url) throw new Error("la página de DataSets de INFOBRAS no trae el enlace de obras");
  // Sin Last-Modified, y con el crudo borrado después de cada carga: siempre se baja (el sha256 dice si cambió).
  const entrada = await new Almacen(env, FUENTE).bajar(url, { archivo: ARCHIVO, subdir: CLAVE, forzar: true, relay: "lima" });
  if (entrada.bytes < MINIMO_BYTES) {
    await env.CRUDOS.delete(`raw/${entrada.file}`);
    throw new Error(`${nombrePublicado(url)}: ${entrada.bytes} bytes, no parece el archivo de INFOBRAS`);
  }
  return { entrada, archivo: nombrePublicado(url) };
}

/**
 * El XLSX crudo trae los nombres del residente y del supervisor de obra: se borra de R2 en cuanto se usó. Siempre está en
 * la misma clave, así que se borra aunque la descarga haya fallado a medias (borrar lo que no está no hace nada).
 */
const borrarCrudo = (env: Env, step: WorkflowStep) =>
  step.do("borrar crudo", LECTURA, async () => {
    await env.CRUDOS.delete(`raw/${FUENTE}/${CLAVE}/${ARCHIVO}`);
    return true;
  });

export async function correrInfobras(env: Env, p: ParamsCorrida, step: WorkflowStep, id: string): Promise<unknown> {
  const log = { fuente: FUENTE, instancia: id };
  const salida = await esperarRelayLima(env, step, FUENTE);
  let carga: ResultadoCarga;
  try {
    const b = await step.do("descargar", DESCARGA, () => bajarObras(env));
    carga = await step.do("cargar obra_infobras", CARGA_GRANDE, () => conDb(env.HYPERDRIVE, (db) => cargarObras(env, db, b, p, id)));
  } finally {
    // Cargado, ya cargado, en seco o fallido: el crudo no se queda en R2.
    await borrarCrudo(env, step);
  }
  const resumen: { salida: string; carga: ResultadoCarga; refrescar_obras?: Record<string, number> | null } = { salida, carga };
  if ("ya_cargado" in carga || carga.seco) return resumen;
  if (!hayCambios(carga)) {
    registrar("INFO", "   obra_infobras sin cambios y con la misma fecha: no se corre refrescar_obras()", log);
    return resumen;
  }
  // La entidad y el ubigeo de cada obra, sus banderas, obra ↔ contrato y los cruces del contrato (migración 160).
  resumen.refrescar_obras = await step.do("refrescar_obras", CARGA, () => conDb(env.HYPERDRIVE, async (db) =>
    (await db.filas<{ r: Record<string, number> | null }>("SELECT refrescar_obras(true) AS r"))[0]?.r ?? null));
  registrar("INFO", `   refrescar_obras → ${JSON.stringify(resumen.refrescar_obras)}`, log);
  return resumen;
}
