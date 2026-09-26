// Las 3 tools de backend/mcp/server.py: mismos nombres, descripciones, esquemas, SQL y salida.
// Datos PÚBLICOS y sólo lectura: señal de riesgo, nunca acusación; sin datos personales de ciudadanos.
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Client } from "pg";
import { conConexion, type Env } from "./db";
import { aJsonPython, ErrorValidacion, textoError, validarArgumentos, type Campo } from "./python";

const DISCLAIMER =
  "Señal de riesgo, no acusación. La denuncia formal corresponde a " +
  "Contraloría/Fiscalía. Verificar en la fuente oficial SEACE/OECE.";

// Regla de PUBLICACIÓN, la misma de la API de lectura (backend/api/src/lib/publicacion.ts ·
// alertaPublica): estado 'activa' o 'confirmada' (alerta_publicada(), migración 22) y no es semilla
// de demo (ALT-…). Una alerta en 'revision' o 'descartada' no existe para este servidor.
const ALERTA_PUBLICA = "(alerta_publicada(a.estado) AND a.codigo NOT LIKE 'ALT-%')";

// Docstrings tal como los publica FastMCP con Python 3.12 (imagen python:3.12-slim): conservan la
// sangría del código fuente.
const doc = (...lineas: string[]) => lineas.join("\n");

type Definicion = { tool: Tool; campos: Campo[] };

const DEFINICIONES: Record<string, Definicion> = {
  buscar_alertas: {
    campos: [
      { nombre: "region", tipo: "str", defecto: "" },
      { nombre: "severidad_min", tipo: "int", defecto: 0 },
      { nombre: "limite", tipo: "int", defecto: 20 },
    ],
    tool: {
      name: "buscar_alertas",
      description: doc(
        "Lista alertas de riesgo de corrupción en contrataciones públicas del Perú",
        "    (solo las publicadas: las que están en revisión humana no se exponen).",
        "",
        "    Args:",
        "        region: filtra por región/departamento (vacío = todas).",
        "        severidad_min: score mínimo 0-100 (0 = todas).",
        "        limite: máximo de resultados (1-50).",
        "    ",
      ),
      inputSchema: {
        properties: {
          region: { default: "", title: "Region", type: "string" },
          severidad_min: { default: 0, title: "Severidad Min", type: "integer" },
          limite: { default: 20, title: "Limite", type: "integer" },
        },
        title: "buscar_alertasArguments",
        type: "object",
      },
      outputSchema: {
        properties: {
          result: { items: { additionalProperties: true, type: "object" }, title: "Result", type: "array" },
        },
        required: ["result"],
        title: "buscar_alertasOutput",
        type: "object",
      },
    },
  },
  riesgo_convocatoria: {
    campos: [{ nombre: "ocid", tipo: "str" }],
    tool: {
      name: "riesgo_convocatoria",
      description: doc(
        "Score de riesgo + banderas (con evidencia y norma citada) de una convocatoria.",
        "    Solo alertas publicadas: una alerta en revisión humana se reporta como no encontrada.",
        "",
        "    Args:",
        "        ocid: OCID o código (ej. '1221190' o 'OECE-1221190').",
        "    ",
      ),
      inputSchema: {
        properties: { ocid: { title: "Ocid", type: "string" } },
        required: ["ocid"],
        title: "riesgo_convocatoriaArguments",
        type: "object",
      },
    },
  },
  empresa_sancionada: {
    campos: [{ nombre: "ruc", tipo: "str" }],
    tool: {
      name: "empresa_sancionada",
      description: doc(
        "Indica si una empresa (por RUC) tiene sanciones VIGENTES en el OSCE.",
        "",
        "    Args:",
        "        ruc: RUC de la empresa (11 dígitos).",
        "    ",
      ),
      inputSchema: {
        properties: { ruc: { title: "Ruc", type: "string" } },
        required: ["ruc"],
        title: "empresa_sancionadaArguments",
        type: "object",
      },
    },
  },
};

export const HERRAMIENTAS: Tool[] = Object.values(DEFINICIONES).map((d) => d.tool);

// Filas como arreglos (rowMode "array"): el SQL queda igual al de Python y se lee por posición.
type Fila = unknown[];
async function consultar(c: Client, text: string, values: unknown[]): Promise<Fila[]> {
  return (await c.query<Fila>({ text, values, rowMode: "array" })).rows;
}

const aNumero = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function shortOcid(ocid: string): string {
  return ocid.startsWith("ocds-") ? ocid.slice(ocid.lastIndexOf("-") + 1) : ocid;
}

async function buscarAlertas(env: Env, ctx: ExecutionContext, region: string, severidadMin: bigint, limiteIn: bigint) {
  // max(1, min(int(limite or 20), 50)): 0 cuenta como "sin valor" y vuelve a 20.
  const pedido = limiteIn === 0n ? 20n : limiteIn;
  const limite = pedido < 1n ? 1 : pedido > 50n ? 50 : Number(pedido);
  return conConexion(env, ctx, async (c) => {
    const filas = await consultar(
      c,
      `SELECT a.codigo, a.ocid, a.region, a.score, a.monto_adjudicado, c.objeto,
              (SELECT count(*) FROM banderas b WHERE b.alerta_id = a.id)
         FROM alertas a
         LEFT JOIN convocatorias c ON c.ocid = a.ocid
        WHERE ${ALERTA_PUBLICA}
          AND ($1 = '' OR a.region ILIKE $2)
          AND COALESCE(a.score, 0) >= $3
        ORDER BY a.score DESC NULLS LAST
        LIMIT $4`,
      [region, `%${region}%`, severidadMin.toString(), limite],
    );
    return filas.map((r) => ({
      codigo: r[0], ocid: r[1], region: r[2], score: r[3],
      monto_adjudicado: aNumero(r[4]), objeto: r[5], n_banderas: Number(r[6]),
    }));
  });
}

async function riesgoConvocatoria(env: Env, ctx: ExecutionContext, ocid: string) {
  const short = shortOcid(ocid);
  return conConexion(env, ctx, async (c) => {
    const [fila] = await consultar(
      c,
      `SELECT a.id, a.codigo, a.ocid, a.score, a.region, a.monto_adjudicado, c.objeto
         FROM alertas a LEFT JOIN convocatorias c ON c.ocid = a.ocid
        WHERE (a.ocid = $1 OR a.codigo = $2 OR a.codigo = $3)
          AND ${ALERTA_PUBLICA}
        LIMIT 1`,
      [short, ocid, `OECE-${short}`],
    );
    if (!fila) return { encontrada: false, ocid };
    const filasBanderas = await consultar(
      c,
      `SELECT regla, severidad, evidencia, norma FROM banderas
        WHERE alerta_id = $1
        ORDER BY CASE severidad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END`,
      [fila[0]],
    );
    const banderas = filasBanderas.map((b) => ({ regla: b[0], severidad: b[1], evidencia: b[2], norma: b[3] }));
    return {
      encontrada: true, codigo: fila[1], ocid: fila[2], score: fila[3], region: fila[4],
      monto_adjudicado: aNumero(fila[5]), objeto: fila[6],
      n_banderas: banderas.length, banderas, disclaimer: DISCLAIMER,
    };
  });
}

async function empresaSancionada(env: Env, ctx: ExecutionContext, rucIn: string) {
  // "".join(ch for ch in ruc if ch.isdigit())
  const ruc = Array.from(rucIn).filter((ch) => /\p{Nd}/u.test(ch)).join("");
  return conConexion(env, ctx, async (c) => {
    const filas = await consultar(
      c,
      `SELECT razon_social, tipo, periodo, fecha_hasta, resolucion, LEFT(infraccion, 300)
         FROM osce_sancionados_vigentes WHERE ruc = $1`,
      [ruc],
    );
    const sanciones = filas.map((r) => ({
      razon_social: r[0], tipo: r[1], periodo: r[2], vence: r[3] ?? "DEFINITIVO", resolucion: r[4], infraccion: r[5],
    }));
    return {
      ruc, tiene_sancion_vigente: sanciones.length > 0, n_sanciones: sanciones.length, sanciones,
      disclaimer: DISCLAIMER,
    };
  });
}

const texto = (t: string) => ({ type: "text" as const, text: t });
const resultadoError = (t: string): CallToolResult => ({ content: [texto(t)], isError: true });

// Misma forma que FastMCP: una lista va como un TextContent por elemento más structuredContent
// {"result": [...]}; un dict sin outputSchema va como un único TextContent. Los errores del tool
// (validación o base de datos) vuelven como resultado isError, no como error JSON-RPC.
export async function ejecutarHerramienta(
  nombre: string, args: Record<string, unknown>, env: Env, ctx: ExecutionContext,
): Promise<CallToolResult> {
  if (!Object.hasOwn(DEFINICIONES, nombre)) return resultadoError(`Unknown tool: ${nombre}`);
  const def = DEFINICIONES[nombre];
  try {
    const v = validarArgumentos(`${nombre}Arguments`, def.campos, args);
    if (nombre === "buscar_alertas") {
      const filas = await buscarAlertas(env, ctx, v.region as string, v.severidad_min as bigint, v.limite as bigint);
      return { content: filas.map((f) => texto(aJsonPython(f))), structuredContent: { result: filas }, isError: false };
    }
    const salida = nombre === "riesgo_convocatoria"
      ? await riesgoConvocatoria(env, ctx, v.ocid as string)
      : await empresaSancionada(env, ctx, v.ruc as string);
    return { content: [texto(aJsonPython(salida))], isError: false };
  } catch (e) {
    const detalle = e instanceof ErrorValidacion ? e.message : textoError(e);
    return resultadoError(`Error executing tool ${nombre}: ${detalle}`);
  }
}
