/**
 * GLM 5.3 flash (Workers AI) por vigia-llm, con salida estructurada: cada pedido obliga a una herramienta y se lee
 * su argumento JSON. vigia-llm pasa el pedido a un modelo hermano si GLM está en su tope por minuto (3021), así que el
 * laboratorio no pelea a ciegas con el análisis masivo, que usa el mismo modelo.
 *
 * Precio medido (backend/agent/tools/costo_llm.py): US$ 0,15 por millón de tokens de entrada y 0,50 de salida.
 */
import type { Coincidencia, Entrada, Ficha, Gasto } from "./tipos.ts";

export interface EnvModelo {
  LLM: Fetcher;
  LLM_TOKEN: string;
  AI: Ai;
  MODELO?: string;
  EMBEDDINGS?: string;
}

const MODELO_DEFECTO = "@cf/zai-org/glm-5.3-flash";
const PRECIO = { entrada: 0.15 / 1e6, salida: 0.5 / 1e6 };

interface Herramienta {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export class ErrorModelo extends Error {}

export async function pedir<T>(env: EnvModelo, gasto: Gasto, sistema: string, usuario: string, h: Herramienta, maxTokens = 4000): Promise<T> {
  const r = await env.LLM.fetch(
    new Request("https://vigia-llm.interno/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.LLM_TOKEN}`, "x-vigia-respaldo": "nunca" },
      body: JSON.stringify({
        model: env.MODELO || MODELO_DEFECTO,
        messages: [{ role: "system", content: sistema }, { role: "user", content: usuario }],
        tools: [{ type: "function", function: h }],
        tool_choice: { type: "function", function: { name: h.name } },
        reasoning_effort: "low",
        max_tokens: maxTokens,
      }),
    }),
  );
  if (!r.ok) throw new ErrorModelo(`modelo_${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as {
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    choices?: { message?: { content?: string; tool_calls?: { function?: { arguments?: string | object } }[] } }[];
  };
  const ent = j.usage?.prompt_tokens ?? 0, sal = j.usage?.completion_tokens ?? 0;
  gasto.tokensEntrada += ent;
  gasto.tokensSalida += sal;
  gasto.costoModelo += ent * PRECIO.entrada + sal * PRECIO.salida;
  const msg = j.choices?.[0]?.message;
  const args = msg?.tool_calls?.[0]?.function?.arguments;
  if (args && typeof args === "object") return args as T;
  const texto = typeof args === "string" ? args : (msg?.content ?? "");
  // A veces GLM responde el JSON en el texto en vez de llamar a la herramienta.
  const m = /\{[\s\S]*\}/.exec(texto);
  if (!m) throw new ErrorModelo("sin_salida");
  try {
    return JSON.parse(m[0]) as T;
  } catch {
    throw new ErrorModelo("salida_no_json");
  }
}

// ─── entender ────────────────────────────────────────────────────────────────
const SISTEMA_ENTENDER = `Eres el analista de precios de Vigía, un observatorio de compras públicas del Perú. Te dan un producto que
compró una entidad del Estado. Lo conviertes en una ficha para buscar su precio en tiendas peruanas:
- nombre: el producto en pocas palabras, como lo vende una tienda.
- atributos: lo que define el producto (marca solo si la piden, modelo, medida, capacidad, material, presentación).
  obligatorio = true si cambiarlo lo vuelve otro producto.
- unidad_base: la unidad en que se compara el precio («unidad», «paquete de 500 hojas», «galón», «kg»).
- busquedas: 2 a 4 búsquedas cortas (2 a 5 palabras) como las escribiría alguien en Plaza Vea o Sodimac; de la más
  precisa a la más general. Sin marcas si no son obligatorias. En español del Perú.
- busqueda_web: una búsqueda para Google que encuentre páginas de venta en el Perú.
- excluir: palabras que delatan otro producto (repuesto, funda, usado, alquiler...).
Usa solo lo que dicen la consulta y la especificación; no inventes atributos.`;

const H_FICHA: Herramienta = {
  name: "ficha",
  description: "La ficha del producto para buscar su precio.",
  parameters: {
    type: "object",
    properties: {
      nombre: { type: "string" },
      categoria: { type: "string" },
      atributos: {
        type: "array",
        items: { type: "object", properties: { nombre: { type: "string" }, valor: { type: "string" }, obligatorio: { type: "boolean" } }, required: ["nombre", "valor", "obligatorio"] },
      },
      unidad_base: { type: "string" },
      busquedas: { type: "array", items: { type: "string" } },
      busqueda_web: { type: "string" },
      excluir: { type: "array", items: { type: "string" } },
    },
    required: ["nombre", "categoria", "atributos", "unidad_base", "busquedas", "busqueda_web", "excluir"],
  },
};

export async function entender(env: EnvModelo, gasto: Gasto, e: Entrada): Promise<Ficha> {
  const partes = [`Consulta: ${e.consulta}`];
  if (e.especificacion) partes.push(`Especificación (recortada): ${e.especificacion.slice(0, 4000)}`);
  if (e.unidad) partes.push(`Unidad del pedido: ${e.unidad}`);
  if (e.cantidad) partes.push(`Cantidad: ${e.cantidad}`);
  const f = await pedir<Ficha>(env, gasto, SISTEMA_ENTENDER, partes.join("\n"), H_FICHA, 3000);
  const corta = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  const busquedas = [...new Set((Array.isArray(f.busquedas) ? f.busquedas : []).map(corta).filter(Boolean))].slice(0, 4);
  if (!busquedas.length) busquedas.push(corta(e.consulta).split(" ").slice(0, 5).join(" "));
  return {
    nombre: corta(f.nombre) || corta(e.consulta),
    categoria: corta(f.categoria),
    atributos: (Array.isArray(f.atributos) ? f.atributos : []).slice(0, 12).map((a) => ({ nombre: corta(a.nombre), valor: corta(a.valor), obligatorio: !!a.obligatorio })),
    unidad_base: corta(f.unidad_base) || e.unidad || "unidad",
    busquedas,
    busqueda_web: corta(f.busqueda_web) || busquedas[0],
    excluir: (Array.isArray(f.excluir) ? f.excluir : []).map(corta).filter(Boolean).slice(0, 15),
  };
}

// ─── emparejar ───────────────────────────────────────────────────────────────
const SISTEMA_JUICIO = `Eres el analista de precios de Vigía. Comparas ofertas de tiendas con el producto que compró el Estado.
Para cada oferta decide:
- coincidencia: «exacta» (mismo producto y atributos obligatorios), «equivalente» (otra marca o modelo, pero cumple
  los atributos obligatorios y sirve para lo mismo) o «distinta» (otro producto, otra medida o capacidad, un repuesto,
  un accesorio, un servicio).
- unidades: cuántas unidades_base trae la oferta (un pack de 12 = 12; una caja de 10 paquetes = 10 si la unidad base
  es el paquete). 1 si es una sola. 0 si no se puede saber.
- razon: una frase corta con el porqué.
Juzga solo por el título y los datos dados. No adivines.`;

const H_JUICIO: Herramienta = {
  name: "juicio",
  description: "El juicio de cada oferta.",
  parameters: {
    type: "object",
    properties: {
      ofertas: {
        type: "array",
        items: {
          type: "object",
          properties: { n: { type: "integer" }, coincidencia: { type: "string", enum: ["exacta", "equivalente", "distinta"] }, unidades: { type: "number" }, razon: { type: "string" } },
          required: ["n", "coincidencia", "unidades", "razon"],
        },
      },
    },
    required: ["ofertas"],
  },
};

export interface Juicio {
  n: number;
  coincidencia: Coincidencia;
  unidades: number;
  razon: string;
}

export async function juzgar(
  env: EnvModelo,
  gasto: Gasto,
  ficha: Ficha,
  ofertas: { n: number; titulo: string; marca: string | null; precio: number | null; tienda: string; unidad?: string | null }[],
): Promise<Juicio[]> {
  const producto = [
    `Producto: ${ficha.nombre}`,
    `Unidad base: ${ficha.unidad_base}`,
    ...ficha.atributos.map((a) => `- ${a.nombre}: ${a.valor}${a.obligatorio ? " (obligatorio)" : ""}`),
  ].join("\n");
  const lista = ofertas
    .map((o) => `${o.n}. ${o.titulo}${o.marca ? ` | marca ${o.marca}` : ""}${o.unidad ? ` | ${o.unidad}` : ""} | ${o.tienda}${o.precio != null ? ` | S/ ${o.precio}` : ""}`)
    .join("\n");
  const r = await pedir<{ ofertas?: Juicio[] }>(env, gasto, SISTEMA_JUICIO, `${producto}\n\nOfertas:\n${lista}`, H_JUICIO, 5000);
  const validas = new Set(ofertas.map((o) => o.n));
  return (r.ofertas ?? [])
    .filter((j) => validas.has(Number(j.n)))
    .map((j) => ({
      n: Number(j.n),
      coincidencia: (["exacta", "equivalente", "distinta"].includes(j.coincidencia) ? j.coincidencia : "sin_juicio") as Coincidencia,
      unidades: Number.isFinite(Number(j.unidades)) ? Math.max(0, Number(j.unidades)) : 0,
      razon: String(j.razon ?? "").slice(0, 240),
    }));
}

// ─── leer una página sin datos estructurados ─────────────────────────────────
const H_PAGINA: Herramienta = {
  name: "pagina",
  description: "El producto y precio de la página.",
  parameters: {
    type: "object",
    properties: {
      es_producto: { type: "boolean" },
      titulo: { type: "string" },
      marca: { type: "string" },
      precio: { type: "number" },
      moneda: { type: "string" },
    },
    required: ["es_producto", "titulo", "precio", "moneda"],
  },
};

export async function leerConModelo(env: EnvModelo, gasto: Gasto, url: string, texto: string) {
  const r = await pedir<{ es_producto?: boolean; titulo?: string; marca?: string; precio?: number; moneda?: string }>(
    env,
    gasto,
    "Lees una página de una tienda. Si es la página de UN producto en venta, da su título, marca, precio actual (no el tachado) y moneda (PEN o USD). Si es una lista, un blog o no tiene precio, es_producto = false. No inventes.",
    `URL: ${url}\n\nTexto de la página (recortado):\n${texto.slice(0, 12000)}`,
    H_PAGINA,
    1500,
  );
  if (!r.es_producto || !(Number(r.precio) > 0)) return null;
  return { titulo: String(r.titulo ?? "").slice(0, 200), marca: r.marca ? String(r.marca).slice(0, 80) : null, precio: Number(r.precio), moneda: String(r.moneda ?? "PEN").toUpperCase().slice(0, 3) };
}

// ─── leer el listado de un buscador de tienda ────────────────────────────────
const H_LISTADO: Herramienta = {
  name: "listado",
  description: "Los productos en venta que muestra el listado, en el orden de la página.",
  parameters: {
    type: "object",
    properties: {
      productos: {
        type: "array",
        items: {
          type: "object",
          properties: {
            titulo: { type: "string" },
            marca: { type: "string" },
            precio: { type: "number" },
            moneda: { type: "string" },
            url: { type: "string" },
            presentacion: { type: "string" },
          },
          required: ["titulo", "precio"],
        },
      },
    },
    required: ["productos"],
  },
};

export interface ProductoListado {
  titulo: string;
  marca: string | null;
  precio: number;
  moneda: string;
  url: string | null;
  presentacion: string | null;
}

/**
 * El listado de resultados del buscador de una tienda, en Markdown (Crawl4AI), sin datos estructurados. El modelo
 * solo copia lo que ve: cada precio se confirma después en el mismo texto y cada enlace tiene que estar en la página.
 */
export async function leerListadoConModelo(env: EnvModelo, gasto: Gasto, url: string, markdown: string, tope = 24): Promise<ProductoListado[]> {
  const r = await pedir<{ productos?: { titulo?: string; marca?: string; precio?: number; moneda?: string; url?: string; presentacion?: string }[] }>(
    env,
    gasto,
    `Lees la página de resultados del buscador de una tienda peruana. Copia los productos que aparecen en venta, hasta ${tope},
en el orden de la página: título tal cual, marca si se ve, el precio actual (no el tachado ni el precio por unidad de
medida), moneda (PEN si dice S/), el enlace a su ficha (tal cual aparece en el texto) y la presentación si el título no
la dice («x 100 tabletas», «caja x 12»). No inventes productos, precios ni enlaces; si no hay resultados, lista vacía.`,
    `URL: ${url}\n\nPágina en Markdown (recortada):\n${markdown.slice(0, 24000)}`,
    H_LISTADO,
    5000,
  );
  return (r.productos ?? [])
    .filter((p) => p.titulo && Number(p.precio) > 0)
    .slice(0, tope)
    .map((p) => ({
      titulo: String(p.titulo).slice(0, 240),
      marca: p.marca ? String(p.marca).slice(0, 80) : null,
      precio: Number(p.precio),
      moneda: String(p.moneda || "PEN").toUpperCase().replace("S/", "PEN").slice(0, 3),
      url: p.url ? String(p.url).slice(0, 500) : null,
      presentacion: p.presentacion ? String(p.presentacion).slice(0, 80) : null,
    }));
}

// ─── parecido (embeddings) ───────────────────────────────────────────────────
const coseno = (a: number[], b: number[]) => {
  let p = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    p += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? p / Math.sqrt(na * nb) : 0;
};

/** Qué tan parecido es cada título a la ficha (bge-m3), para juzgar primero los más cercanos. */
export async function parecido(env: EnvModelo, ficha: Ficha, titulos: string[]): Promise<number[]> {
  if (!titulos.length) return [];
  const base = `${ficha.nombre}. ${ficha.atributos.map((a) => `${a.nombre} ${a.valor}`).join(", ")}`;
  const salida: number[] = [];
  for (let i = 0; i < titulos.length; i += 90) {
    const lote = titulos.slice(i, i + 90);
    const r = (await env.AI.run((env.EMBEDDINGS || "@cf/baai/bge-m3") as keyof AiModels, { text: [base, ...lote] } as never)) as { data?: number[][] };
    const [b, ...resto] = r.data ?? [];
    for (const v of resto) salida.push(b ? Math.round(coseno(b, v) * 1000) / 1000 : 0);
  }
  return salida;
}
