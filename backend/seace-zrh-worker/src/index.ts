/**
 * Los reportes «ongei» del SEACE, pedidos desde Zúrich (2026-11-03):
 *   POST /ongei {reporte: "pen" | "ocos", ruc, anio, mes} → {ok, status, total, columnas, filas, pedidos, ms}
 *   GET  /health
 *
 *   · pen:  las penalidades que la entidad aplicó en ese mes (contrato u OC/OS, contratista, tipo, monto, fecha).
 *   · ocos: sus órdenes de compra y de servicio del mes con el N.º de expediente SIAF, que CONOSCE no trae.
 *
 * Son páginas JSF (PrimeFaces) del buscador público que el SEACE da a los portales de transparencia, una entidad y un mes
 * por vez, de 15 filas por página. Aquí cada consulta son dos pedidos en la misma sesión: la página (cookie, ViewState y
 * cuántas filas hay) y, si hay más de las que trae, la tabla entera por el mismo AJAX con que el navegador pagina
 * (`_rows` = el total). La sesión no sale del Worker.
 *
 * Por qué aparte del relay (backend/relay-worker): éste sólo hace GET sueltos, sin cookies. Por qué en Zúrich: el SEACE
 * filtra por la IP de salida y la de un Worker es la del punto de Cloudflare donde corre; Zúrich pasa (probado con el
 * relay el 2026-11-03: 200 en los dos reportes). Así la IP de la casa del usuario, que lleva el relay de Lima, nunca
 * aparece. Quien llama decide cuántas consultas a la vez: el Worker no reintenta ni encola.
 */

interface Env {
  /** El mismo token que el relay (SSM /vigia/relay/token). */
  VIGIA_DL_TOKEN?: string;
}

const BASE = "https://prod2.seace.gob.pe";
const RUTA = "/seacebus-uiwd-pub/buscadorPublico/ongei/";
const PAGINA = { pen: "buscadorPublicoPen.xhtml", ocos: "buscadorPublicoOCOS.xhtml" } as const;
const TABLA = "formBuscador:dtProcesos";
/** Filas por pedido AJAX: una entidad grande tiene miles de órdenes en un mes. */
const TOPE_FILAS = 2000;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

const json = (d: unknown, status = 200) => Response.json(d, { status });

function iguales(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

function autorizado(req: Request, env: Env): boolean {
  const esperado = (env.VIGIA_DL_TOKEN || "").trim();
  if (!esperado) return false;
  const auth = req.headers.get("Authorization") || "";
  const dado = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  return iguales(dado, esperado);
}

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ", Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Ntilde: "Ñ", uuml: "ü", Uuml: "Ü", deg: "°", ordm: "º", ordf: "ª" };
const texto = (h: string) =>
  h.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTIDADES[n] ?? m)
    .replace(/\s+/g, " ").trim();

/** Las filas con datos de la tabla (las de PrimeFaces llevan `data-ri`; la de «sin registros», no). */
function filas(html: string): string[][] {
  const out: string[][] = [];
  for (const m of html.matchAll(/<tr[^>]*\bdata-ri="\d+"[^>]*>([\s\S]*?)<\/tr>/g)) {
    out.push([...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => texto(c[1])));
  }
  return out;
}

const atributo = (tag: string, nombre: string) => tag.match(new RegExp(`\\b${nombre}="([^"]*)"`))?.[1] ?? null;

/** Las cookies de la respuesta, como las devolvería el navegador en el siguiente pedido. */
function cookies(r: Response): string {
  const h = r.headers as Headers & { getSetCookie?: () => string[] };
  const lista = h.getSetCookie ? h.getSetCookie() : (r.headers.get("set-cookie") ? [r.headers.get("set-cookie") as string] : []);
  return lista.map((c) => c.split(";")[0].trim()).filter(Boolean).join("; ");
}

async function ongei(req: Request): Promise<Response> {
  let p: { reporte?: string; ruc?: string; anio?: number; mes?: number };
  try {
    p = await req.json();
  } catch {
    return json({ ok: false, error: "json_invalido" }, 400);
  }
  const reporte = p.reporte === "pen" || p.reporte === "ocos" ? p.reporte : null;
  const ruc = /^\d{11}$/.test(String(p.ruc ?? "")) ? String(p.ruc) : null;
  const anio = Number(p.anio);
  const mes = Number(p.mes);
  if (!reporte || !ruc || !(anio >= 2010 && anio <= 2100) || !(mes >= 1 && mes <= 12)) return json({ ok: false, error: "parametros" }, 400);
  const t0 = Date.now();
  const url = `${BASE}${RUTA}${PAGINA[reporte]}?ruc_entidad=${ruc}&anio=${anio}&mes=${String(mes).padStart(2, "0")}&theme=ongei`;
  const cabeceras = { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*", "Accept-Language": "es-PE,es;q=0.9" };
  const r1 = await fetch(url, { headers: cabeceras, redirect: "manual" });
  const html = await r1.text();
  if (r1.status !== 200) return json({ ok: false, status: r1.status, error: "pagina", pedidos: 1, ms: Date.now() - t0 });
  if (/Pagina no encontrada|Page Error/i.test(html.slice(0, 3000))) return json({ ok: false, status: 200, error: "pagina_error", pedidos: 1, ms: Date.now() - t0 });
  const columnas = [...html.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => texto(m[1]));
  const primeras = filas(html);
  const total = Number(html.match(/rowCount:(\d+)/)?.[1] ?? primeras.length);
  if (total <= primeras.length) {
    return json({ ok: true, status: 200, total, columnas, filas: primeras, pedidos: 1, ms: Date.now() - t0 });
  }
  // La tabla entera, por el AJAX del paginador, en la misma sesión.
  const form = html.match(/<form[^>]*id="formBuscador"[^>]*>/)?.[0] ?? "";
  const accion = atributo(form, "action");
  const viewState = html.match(/<input[^>]*name="javax\.faces\.ViewState"[^>]*>/)?.[0];
  const vs = viewState ? atributo(viewState, "value") : null;
  if (!accion || !vs) return json({ ok: false, status: 200, error: "sin_viewstate", total, pedidos: 1, ms: Date.now() - t0 });
  const hdd = html.match(/<input[^>]*name="formBuscador:hddIniciaBusqueda"[^>]*>/)?.[0];
  const galleta = cookies(r1);
  const todas: string[][] = [];
  let pedidos = 1;
  for (let desde = 0; desde < total; desde += TOPE_FILAS) {
    const cuerpo = new URLSearchParams({
      "javax.faces.partial.ajax": "true",
      "javax.faces.source": TABLA,
      "javax.faces.partial.execute": TABLA,
      "javax.faces.partial.render": TABLA,
      "javax.faces.behavior.event": "page",
      "javax.faces.partial.event": "page",
      [`${TABLA}_pagination`]: "true",
      [`${TABLA}_first`]: String(desde),
      [`${TABLA}_rows`]: String(Math.min(TOPE_FILAS, total)),
      [`${TABLA}_encodeFeature`]: "true",
      formBuscador: "formBuscador",
      "formBuscador:hddIniciaBusqueda": (hdd && atributo(hdd, "value")) || "",
      "javax.faces.ViewState": vs.replace(/&#58;/g, ":").replace(/&amp;/g, "&"),
    });
    const r2 = await fetch(BASE + accion.replace(/&amp;/g, "&"), {
      method: "POST",
      headers: {
        ...cabeceras,
        Accept: "application/xml, text/xml, */*; q=0.01",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Faces-Request": "partial/ajax",
        "X-Requested-With": "XMLHttpRequest",
        Origin: BASE,
        Referer: url,
        ...(galleta ? { Cookie: galleta } : {}),
      },
      body: cuerpo.toString(),
      redirect: "manual",
    });
    pedidos++;
    const parcial = await r2.text();
    if (r2.status !== 200) return json({ ok: false, status: r2.status, error: "ajax", total, pedidos, ms: Date.now() - t0 });
    const lote = filas(parcial);
    if (!lote.length) return json({ ok: false, status: 200, error: "ajax_vacio", total, pedidos, muestra: parcial.slice(0, 300), ms: Date.now() - t0 });
    todas.push(...lote);
  }
  return json({ ok: todas.length === total, status: 200, total, columnas, filas: todas, pedidos, ms: Date.now() - t0, ...(todas.length !== total ? { error: "faltan_filas" } : {}) });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (req.method === "GET" && pathname === "/health") return json({ ok: true, protegido: !!env.VIGIA_DL_TOKEN });
    if (!autorizado(req, env)) return json({ ok: false, error: "no_autorizado" }, 401);
    if (req.method === "POST" && pathname === "/ongei") {
      try {
        return await ongei(req);
      } catch (e) {
        return json({ ok: false, error: "excepcion", detalle: String((e as Error).message).slice(0, 200) }, 502);
      }
    }
    return json({ ok: false, error: "no_encontrado" }, 404);
  },
};
