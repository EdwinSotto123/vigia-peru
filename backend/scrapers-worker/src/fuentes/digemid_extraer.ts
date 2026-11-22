/**
 * Lo que dice cada alerta de DIGEMID, ordenado (migración 443; 2026-11-22, el usuario: «un pipeline de procesamiento
 * para mostrar lote, código, medicamento, presentación, marca»).
 *
 * El PDF de una alerta trae una tabla (producto, presentación, lote, registro sanitario, vencimiento, fabricante, país,
 * titular y resultado) que pdf.js entrega como texto corrido. Un modelo abierto (vigia-llm, Workers AI) la vuelve filas,
 * y después cada valor se VALIDA contra el texto del PDF: si no aparece literal (sin contar mayúsculas, tildes ni signos),
 * no se guarda. Así el modelo ordena, pero no puede inventar un lote ni un registro. Sin red ni base: lo puro aquí; la
 * escritura en salud_alerta_producto, en `guardarProductos`.
 */

import type { Db } from "../db.ts";
import { registroNorm } from "./digemid.ts";
import { limpio, normalizar } from "./susalud.ts";

export const MODELO_EXTRAER = "@cf/deepseek-ai/deepseek-v4.1-flash-1017";
/** Lo que se manda del PDF (las tablas de las alertas caben de sobra; las internacionales largas se recortan). */
const MAX_TEXTO = 14_000;
const MAX_PRODUCTOS = 60;

export interface ProductoAlerta {
  producto: string;
  presentacion: string | null;
  lotes: string[];
  registro: string | null;
  vencimiento: string | null;
  fabricante: string | null;
  pais: string | null;
  titular: string | null;
  detalle: string | null;
}

export interface AlertaParaExtraer {
  id: number;
  titulo: string;
  motivo: string | null;
  productos: string | null;
  texto: string;
}

/** El pedido al modelo: el texto de la alerta y el formato de salida (JSON, sin prosa). */
export function mensajesExtraer(a: AlertaParaExtraer): { role: "system" | "user"; content: string }[] {
  return [
    {
      role: "system",
      content: [
        "Extraes datos de alertas sanitarias de DIGEMID (Perú). Respondes SOLO con un objeto JSON, sin texto antes ni después.",
        'Formato: {"productos":[{"producto":"","presentacion":null,"lotes":[],"registro_sanitario":null,"vencimiento":null,"fabricante":null,"pais":null,"titular":null,"detalle":null}]}',
        "Reglas:",
        "- Un elemento por producto observado en la alerta (los de la tabla o la lista del texto). Si la alerta no nombra productos concretos, devuelve una lista vacía.",
        "- Copia cada valor tal como aparece en el texto. Nunca inventes, completes ni corrijas un valor: si no está, usa null (o [] en lotes).",
        "- producto: el nombre del producto con su concentración y forma si están en la misma celda (p. ej. «PARACETAMOL 500 mg Tableta»).",
        "- presentacion: la presentación o el envase («Caja x 100 tabletas», «Frasco x 120 mL»).",
        "- lotes: todos los números de lote de ese producto, cada uno como texto aparte.",
        "- registro_sanitario: el código de registro sanitario o notificación sanitaria (p. ej. EE01234, N-12345, DM27013E).",
        "- vencimiento: la fecha de vencimiento como aparece.",
        "- titular: el titular del registro sanitario (empresa). fabricante y pais: los del fabricante.",
        "- detalle: el resultado o la observación de ese producto (p. ej. «No conforme para el ensayo de valoración»), en una frase corta.",
        "- No incluyas datos de personas (nombres, DNI, teléfonos, correos).",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Título: ${a.titulo}`,
        a.motivo ? `Motivo: ${a.motivo}` : "",
        a.productos ? `Productos según la web: ${a.productos}` : "",
        "Texto del PDF:",
        a.texto.slice(0, MAX_TEXTO),
      ].filter(Boolean).join("\n"),
    },
  ];
}

/** El primer objeto JSON de una respuesta (el modelo a veces lo envuelve en ```json o le agrega una línea). */
export function jsonDe(respuesta: string): unknown {
  const sin = respuesta.replace(/```(?:json)?/gi, "");
  const i = sin.indexOf("{");
  const j = sin.lastIndexOf("}");
  if (i < 0 || j <= i) return null;
  try {
    return JSON.parse(sin.slice(i, j + 1));
  } catch {
    return null;
  }
}

/** Sin espacios: para comparar un lote o un registro escrito «L 2345», «L-2345» o «L2345». */
const junto = (t: string) => normalizar(t).replace(/ /g, "");

/** La fuente contra la que se valida: el texto del PDF y lo que dice la web de la alerta. */
export function fuenteDe(a: AlertaParaExtraer): { palabras: string; junta: string } {
  const base = `${a.titulo} ${a.motivo ?? ""} ${a.productos ?? ""} ${a.texto}`;
  const palabras = ` ${normalizar(base)} `;
  return { palabras, junta: palabras.replace(/ /g, "") };
}

/** ¿El valor aparece en la fuente? Entero (por palabras) o, si es un código, junto. */
function aparece(v: string, f: { palabras: string; junta: string }, codigo = false): boolean {
  const n = normalizar(v);
  if (!n) return false;
  if (f.palabras.includes(` ${n} `)) return true;
  if (codigo) {
    const j = n.replace(/ /g, "");
    return j.length >= 4 && f.junta.includes(j);
  }
  return false;
}

/** Un texto del modelo, limpio y validado (o null). `largo`: el tope de caracteres. */
function campo(v: unknown, f: { palabras: string; junta: string }, largo = 200): string | null {
  const t = limpio(typeof v === "string" ? v : null);
  if (!t || t.length > largo) return null;
  return aparece(t, f) ? t : null;
}

/**
 * Lo que devolvió el modelo → productos que se pueden mostrar. Cada valor debe aparecer en la fuente; el producto, al
 * menos con todas sus palabras de 3 letras o más (el modelo puede juntar dos celdas). Lo demás se descarta.
 */
export function validar(crudo: unknown, a: AlertaParaExtraer): ProductoAlerta[] {
  const lista = (crudo as { productos?: unknown } | null)?.productos;
  if (!Array.isArray(lista)) return [];
  const f = fuenteDe(a);
  const out: ProductoAlerta[] = [];
  for (const x of lista.slice(0, MAX_PRODUCTOS)) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const nombre = limpio(typeof o.producto === "string" ? o.producto : null);
    if (!nombre || nombre.length > 200) continue;
    const palabras = normalizar(nombre).split(" ").filter((w) => w.length >= 3);
    const nombreOk = aparece(nombre, f) || (palabras.length > 0 && palabras.every((w) => f.palabras.includes(` ${w} `)));
    if (!nombreOk) continue;
    const lotes = (Array.isArray(o.lotes) ? o.lotes : typeof o.lotes === "string" ? [o.lotes] : [])
      .map((l) => limpio(typeof l === "string" ? l : null))
      .filter((l): l is string => !!l && l.length <= 40 && /\d/.test(l) && aparece(l, f, true));
    const regCrudo = typeof o.registro_sanitario === "string" ? o.registro_sanitario : null;
    const registro = regCrudo && registroNorm(regCrudo) && aparece(regCrudo, f, true) ? registroNorm(regCrudo) : null;
    const venc = limpio(typeof o.vencimiento === "string" ? o.vencimiento : null);
    out.push({
      producto: nombre,
      presentacion: campo(o.presentacion, f),
      lotes: [...new Set(lotes)],
      registro,
      vencimiento: venc && venc.length <= 30 && /\d/.test(venc) && aparece(venc, f, true) ? venc : null,
      fabricante: campo(o.fabricante, f),
      pais: campo(o.pais, f, 60),
      titular: campo(o.titular, f),
      // El detalle es una frase: basta con que sus palabras largas estén en la fuente (el modelo la acorta).
      detalle: (() => {
        const d = limpio(typeof o.detalle === "string" ? o.detalle : null);
        if (!d || d.length > 300) return null;
        const ws = normalizar(d).split(" ").filter((w) => w.length >= 4);
        return ws.length && ws.filter((w) => f.palabras.includes(` ${w} `)).length / ws.length >= 0.8 ? d : null;
      })(),
    });
  }
  return out;
}

/** Quien llama al modelo: el Worker (servicio LLM) o la PC (la URL pública con su token). */
export type PedirModelo = (cuerpo: unknown) => Promise<Response>;

/** Extrae los productos de una alerta (con el modelo y la validación). Lanza si el modelo no responde. */
export async function extraerAlerta(pedir: PedirModelo, a: AlertaParaExtraer): Promise<{ productos: ProductoAlerta[]; modelo: string }> {
  const r = await pedir({ model: MODELO_EXTRAER, messages: mensajesExtraer(a), temperature: 0, max_tokens: 4000 });
  if (!r.ok) throw new Error(`vigia-llm: HTTP ${r.status}`);
  const j = (await r.json()) as { choices?: { message?: { content?: string | null } }[] };
  const texto = j.choices?.[0]?.message?.content ?? "";
  const crudo = jsonDe(texto);
  if (crudo === null) throw new Error("el modelo no devolvió JSON");
  return { productos: validar(crudo, a), modelo: r.headers.get("x-vigia-modelo") ?? MODELO_EXTRAER };
}

/** Reemplaza los productos de una alerta (una fila por lote) y marca la extracción; une cada registro con el catálogo. */
export async function guardarProductos(db: Db, alertaId: number, productos: ProductoAlerta[], modelo: string, huella: string): Promise<number> {
  await db.ejecutar("DELETE FROM salud_alerta_producto WHERE alerta_id = $1", [alertaId]);
  let orden = 0;
  for (const p of productos) {
    const lotes = p.lotes.length ? p.lotes : [null];
    for (const lote of lotes) {
      await db.ejecutar(
        `INSERT INTO salud_alerta_producto (alerta_id, orden, producto, producto_norm, presentacion, lote, lote_norm, registro, vencimiento,
                                            fabricante, pais, titular, detalle, medicamento_codigo)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                 (SELECT m.codigo FROM salud_medicamento m WHERE $8::text IS NOT NULL AND m.registro = $8 ORDER BY m.establecimientos DESC NULLS LAST LIMIT 1))`,
        [alertaId, orden++, p.producto, normalizar(p.producto), p.presentacion, lote, lote ? normalizar(lote).replace(/ /g, "") : null, p.registro,
          p.vencimiento, p.fabricante, p.pais, p.titular, p.detalle],
      );
    }
  }
  await db.ejecutar(
    "UPDATE salud_alerta SET extraido_at = now(), extraido_modelo = $2, extraido_huella = $3, extraido_error = NULL WHERE id = $1",
    [alertaId, modelo, huella],
  );
  return orden;
}

/** Las alertas con texto que falta extraer (nuevas o con el texto cambiado), las más nuevas primero. */
export async function alertasPorExtraer(db: Db, n: number): Promise<(AlertaParaExtraer & { huella: string })[]> {
  return db.filas<AlertaParaExtraer & { huella: string }>(
    // Con el texto tal cual (migración 443) y, mientras no llega, con el normalizado (pierde guiones, barras y fechas):
    // cuando llega el texto tal cual cambia la huella y la alerta se vuelve a extraer.
    `SELECT id, titulo, motivo, productos, coalesce(texto, texto_norm) AS texto, md5(coalesce(texto, texto_norm)) AS huella
       FROM salud_alerta
      WHERE coalesce(texto, texto_norm) IS NOT NULL
        AND (extraido_huella IS DISTINCT FROM md5(coalesce(texto, texto_norm)))
        AND (extraido_error IS NULL OR extraido_at < now() - interval '1 day')
      ORDER BY fecha DESC, id DESC
      LIMIT $1`,
    [n],
  );
}

export async function anotarErrorExtraccion(db: Db, alertaId: number, error: string): Promise<void> {
  await db.ejecutar("UPDATE salud_alerta SET extraido_at = now(), extraido_error = $2 WHERE id = $1", [alertaId, error.slice(0, 300)]);
}
