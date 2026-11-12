/**
 * Una investigación de precio, paso a paso (Cloudflare Workflows: cada paso se reintenta solo y, si el Worker se
 * reinicia, sigue desde el último paso terminado sin repetir lo gastado):
 *
 *   entender   GLM 5.3 flash convierte el pedido en una ficha: nombre, atributos obligatorios, unidad y búsquedas.
 *   tiendas    las búsquedas en 15 tiendas peruanas (vigia-precios), con precio estructurado.
 *   buscadores el buscador propio de tiendas armadas con JavaScript (Inkafarma y Mifarma), abierto con
 *              Crawl4AI en un contenedor de Cloudflare; los productos salen del JSON-LD del listado o, si no hay, GLM
 *              los copia del Markdown (cada precio se confirma en el mismo texto).
 *   web        Tavily: páginas de venta en el Perú fuera de esas tiendas.
 *   leer       cada página: robots.txt, turno por dominio, schema.org (JSON-LD, microdatos, Open Graph); si no hay,
 *              Crawl4AI (o Browser Run si el contenedor no responde) y, al final, GLM sobre el texto. El precio se confirma en el texto visible.
 *   emparejar  reglas (palabras que delatan otro producto) + parecido (bge-m3) + el juicio de GLM: ¿es el mismo
 *              producto o uno equivalente?, ¿cuántas unidades trae?
 *   resumir    validar (moneda, unidades, confirmación, extremos) y la estadística frente a la referencia.
 *
 * Cada paso guarda su avance en D1 (tabla paso) para que el panel lo muestre mientras corre, y la evidencia en R2.
 */
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { confirmarEnTexto, desdeElPrimerPrecio, leerListadoJsonLd, textoVisible } from "./extraer.ts";
import { abrirBuscador, BUSCADORES, buscarLibre, buscarTiendas, buscarWeb, dominioDe, esSalud, leerUrl, type Buscador, type EnvFuentes, type ResultadoWeb } from "./fuentes.ts";
import { COSTO_SEGUNDO_CONTENEDOR } from "./lector.ts";
import { entender, juzgar, leerConModelo, leerListadoConModelo, parecido, type EnvModelo } from "./modelo.ts";
import { resumir, validar } from "./estadistica.ts";
import { gastoVacio, type Entrada, type Ficha, type Gasto, type Oferta } from "./tipos.ts";

export interface Env extends EnvFuentes, EnvModelo {
  EVIDENCIAS: R2Bucket;
  INVESTIGACION: Workflow;
}

const MAX_OFERTAS_TIENDA = 60;
const MAX_PAGINAS_WEB = 10;
/** Páginas de la web que se arman con Crawl4AI (o Browser Run) por investigación. */
const MAX_ARMAR = 8;
const MAX_OFERTAS_BUSCADOR = 15;
const MAX_LISTADOS_IA = 4;
const MAX_LECTURAS_IA = 5;
const MAX_JUZGAR = 40;
const LOTE_JUICIO = 20;

const ahora = () => new Date().toISOString();

async function marcar(env: Env, id: string, paso: string, estado: "corriendo" | "listo" | "error" | "saltado", detalle?: unknown) {
  const d = detalle === undefined ? null : typeof detalle === "string" ? detalle : JSON.stringify(detalle);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO paso (investigacion, nombre, estado, detalle, inicio, fin) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (investigacion, nombre) DO UPDATE SET estado = excluded.estado, detalle = COALESCE(excluded.detalle, paso.detalle),
         fin = excluded.fin`,
    ).bind(id, paso, estado, d, ahora(), estado === "corriendo" ? null : ahora()),
    env.DB.prepare("UPDATE investigacion SET estado = 'corriendo', paso = ? WHERE id = ? AND estado IN ('en_cola', 'corriendo')").bind(paso, id),
  ]);
}

async function sumarGasto(env: Env, id: string, g: Gasto) {
  await env.DB.prepare(
    `UPDATE investigacion SET tokens_entrada = tokens_entrada + ?, tokens_salida = tokens_salida + ?, costo_modelo = costo_modelo + ?,
       busquedas_web = busquedas_web + ?, costo_web = costo_web + ?, segundos_navegador = segundos_navegador + ?,
       segundos_contenedor = segundos_contenedor + ?, costo_contenedor = costo_contenedor + ? WHERE id = ?`,
  ).bind(g.tokensEntrada, g.tokensSalida, g.costoModelo, g.busquedasWeb, g.costoWeb, g.segundosNavegador, g.segundosContenedor,
    g.segundosContenedor * COSTO_SEGUNDO_CONTENEDOR, id).run();
}

const CONFIG = { retries: { limit: 2, delay: "15 seconds" as const, backoff: "exponential" as const }, timeout: "10 minutes" as const };

export class Investigacion extends WorkflowEntrypoint<Env, { id: string }> {
  async run(event: Readonly<WorkflowEvent<{ id: string }>>, step: WorkflowStep) {
    const env = this.env;
    const id = event.payload.id;
    try {
      await this.correr(id, env, step);
    } catch (e) {
      const msg = String((e as Error)?.message ?? e).slice(0, 300);
      await step.do("cerrar con error", async () => {
        await env.DB.prepare("UPDATE investigacion SET estado = 'error', error = ?, terminado = ? WHERE id = ?").bind(msg, ahora(), id).run();
        return true;
      });
      throw e;
    }
  }

  private async correr(id: string, env: Env, step: WorkflowStep) {
    const entrada = await step.do("cargar", async () => {
      const f = await env.DB.prepare("SELECT entrada FROM investigacion WHERE id = ?").bind(id).first<{ entrada: string }>();
      if (!f) throw new Error("investigación inexistente");
      return JSON.parse(f.entrada) as Entrada;
    });

    // ── entender ──
    const ficha = await step.do("entender", CONFIG, async () => {
      await marcar(env, id, "entender", "corriendo");
      const g = gastoVacio();
      const f = await entender(env, g, entrada);
      await sumarGasto(env, id, g);
      await env.DB.prepare("UPDATE investigacion SET ficha = ? WHERE id = ?").bind(JSON.stringify(f), id).run();
      await marcar(env, id, "entender", "listo", { busquedas: f.busquedas, unidad: f.unidad_base });
      return f;
    });

    // ── tiendas ──
    const tiendas = await step.do("tiendas", CONFIG, async () => {
      await marcar(env, id, "tiendas", "corriendo");
      const vistas = new Map<string, Oferta>();
      const estado: Record<string, string> = {};
      for (const termino of ficha.busquedas.slice(0, 3)) {
        const r = await buscarTiendas(env, termino, 4);
        for (const [t, e] of Object.entries(r.tiendas)) if (!estado[t] || e.n > 0) estado[t] = e.n > 0 ? `${e.n} productos` : e.fuente;
        for (const p of r.productos) {
          if (vistas.has(p.url) || vistas.size >= MAX_OFERTAS_TIENDA) continue;
          vistas.set(p.url, {
            n: 0,
            fuente: "tienda",
            tienda: p.tienda,
            titulo: p.producto.slice(0, 240),
            marca: p.marca,
            url: p.url,
            precio: p.precio,
            moneda: "PEN",
            disponibilidad: null,
            extraccion: "api_tienda",
            confirmado: null,
            vendedor: p.vendedor && p.vendedor !== p.tienda ? p.vendedor : null,
            presentacion: p.unidad_medida || p.multiplicador ? `${p.unidad_medida ?? ""}${p.multiplicador && p.multiplicador !== 1 ? ` x${p.multiplicador}` : ""}`.trim() : null,
          });
        }
      }
      const ofertas = [...vistas.values()];
      await env.EVIDENCIAS.put(`lab/${id}/tiendas.json`, JSON.stringify({ leido: ahora(), estado, ofertas }), {
        httpMetadata: { contentType: "application/json" },
      });
      await marcar(env, id, "tiendas", "listo", { ofertas: ofertas.length, tiendas: estado });
      return { ofertas, dominios: Object.keys(estado) };
    });

    // ── buscadores ──
    const buscadores = await step.do("buscadores", { ...CONFIG, timeout: "15 minutes" }, async () => {
      const salud = esSalud(`${ficha.nombre} ${ficha.categoria} ${entrada.consulta}`);
      const lista = BUSCADORES.filter((b) => !b.salud || salud);
      if (!env.LECTOR) {
        await marcar(env, id, "buscadores", "saltado", "el contenedor de Crawl4AI no está conectado");
        return [] as Oferta[];
      }
      if (!lista.length) {
        await marcar(env, id, "buscadores", "saltado", "las farmacias solo se consultan para productos de salud");
        return [] as Oferta[];
      }
      await marcar(env, id, "buscadores", "corriendo");
      const g = gastoVacio();
      const estado: Record<string, string> = {};
      const ofertas: Oferta[] = [];
      let ia = 0;
      const porTienda = async (b: Buscador, i: number) => {
        for (const termino of ficha.busquedas.slice(0, 2)) {
          const p = await abrirBuscador(env, g, b, termino);
          // Sin productos: se prueba el término siguiente. Si el sitio dice que no (robots, 403, desafío) o falla, no se
          // insiste.
          if (p.estado === "sin_resultados") {
            estado[b.id] = p.detalle ?? "sin resultados";
            continue;
          }
          if (p.estado !== "ok" || !p.rendida) {
            estado[b.id] = p.detalle ?? p.estado;
            return;
          }
          const r = p.rendida;
          let metodo: Oferta["extraccion"] = "listado_json_ld";
          let productos: { titulo: string; marca: string | null; precio: number; moneda: string | null; url: string | null; presentacion: string | null }[] =
            leerListadoJsonLd(r.html, p.url).map((x) => ({ ...x, presentacion: null }));
          if (productos.length < 3 && r.markdown.length > 300 && ia < MAX_LISTADOS_IA) {
            ia++;
            const m = await leerListadoConModelo(env, g, p.url, desdeElPrimerPrecio(r.markdown)).catch(() => []);
            if (m.length > productos.length) {
              productos = m;
              metodo = "listado_ia";
            }
          }
          const visible = `${textoVisible(r.html)} ${r.markdown}`;
          const enlaces = new Set(r.enlaces);
          const propias: Oferta[] = [];
          const vistas = new Set<string>();
          for (const x of productos.slice(0, MAX_OFERTAS_BUSCADOR)) {
            // El enlace que da el modelo vale solo si está en la página; si no, la evidencia es el listado mismo.
            let url = p.url;
            try {
              const abs = x.url ? new URL(x.url, p.url).toString() : null;
              if (abs && (metodo === "listado_json_ld" || enlaces.has(abs) || r.markdown.includes(x.url!))) url = abs;
            } catch {
              /* enlace roto: queda el del listado */
            }
            const clave = `${url}|${x.titulo}|${x.precio}`;
            if (vistas.has(clave)) continue;
            vistas.add(clave);
            propias.push({
              n: 0,
              fuente: "buscador",
              tienda: b.id,
              titulo: x.titulo,
              marca: x.marca,
              url,
              precio: x.precio,
              moneda: x.moneda ?? "PEN",
              disponibilidad: null,
              extraccion: metodo,
              confirmado: confirmarEnTexto(x.precio, visible),
              vendedor: null,
              presentacion: x.presentacion,
              evidencia: `lab/${id}/buscador-${i}.json`,
            });
          }
          await env.EVIDENCIAS.put(
            `lab/${id}/buscador-${i}.json`,
            JSON.stringify({
              url: p.url,
              tienda: b.id,
              termino,
              leido: ahora(),
              metodo,
              productos: propias.map(({ titulo, precio, url, confirmado }) => ({ titulo, precio, url, confirmado })),
              largo: r.markdown.length,
              precios: (r.markdown.match(/S\/\s?\d/g) ?? []).length,
              extracto: desdeElPrimerPrecio(r.markdown).slice(0, 6000),
            }),
            { httpMetadata: { contentType: "application/json" } },
          );
          estado[b.id] = propias.length ? `${propias.length} productos` : "sin resultados";
          if (propias.length) {
            ofertas.push(...propias);
            return;
          }
        }
      };
      await Promise.all(lista.map((b, i) => porTienda(b, i).catch((e) => void (estado[b.id] = String((e as Error).message ?? e).slice(0, 80)))));
      await sumarGasto(env, id, g);
      await marcar(env, id, "buscadores", "listo", {
        ofertas: ofertas.length,
        tiendas: estado,
      });
      return ofertas;
    });

    // ── web ──
    const web = await step.do("web", CONFIG, async (): Promise<ResultadoWeb[]> => {
      // Las páginas que pegó quien investiga van primero y se leen siempre.
      const propias: ResultadoWeb[] = (entrada.urls ?? []).map((url) => ({ titulo: "", url, extracto: "" }));
      if (entrada.web === false) {
        await marcar(env, id, "web", propias.length ? "listo" : "saltado", propias.length ? { paginas: propias.length, via: "pegadas" } : "no se pidió");
        return propias;
      }
      await marcar(env, id, "web", "corriendo");
      // La web es un extra: si no responde, la investigación sigue con las tiendas.
      const g = gastoVacio();
      const consulta = `${ficha.busqueda_web} precio`;
      const fallas: string[] = [];
      let r: ResultadoWeb[] = [];
      let via = "tavily";
      if (env.TAVILY_API_KEY) {
        try {
          r = await buscarWeb(env, g, consulta, tiendas.dominios);
        } catch (e) {
          fallas.push(`Tavily: ${String((e as Error).message ?? e).slice(0, 80)}`);
        }
      }
      if (!r.length) {
        via = "duckduckgo";
        try {
          r = await buscarLibre(env, consulta, tiendas.dominios);
        } catch (e) {
          fallas.push(String((e as Error).message ?? e).slice(0, 80));
        }
      }
      await sumarGasto(env, id, g);
      const vistas = new Set(propias.map((p) => p.url));
      const todas = [...propias, ...r.filter((x) => !vistas.has(x.url))].slice(0, MAX_PAGINAS_WEB);
      if (!todas.length) {
        await marcar(env, id, "web", "saltado", fallas.length ? `sin resultados (${fallas.join("; ")})` : "sin resultados");
        return [];
      }
      await marcar(env, id, "web", "listo", {
        paginas: todas.length,
        via: r.length ? (propias.length ? `pegadas y ${via}` : via) : "pegadas",
        ...(fallas.length && !r.length ? { nota: fallas.join("; ") } : {}),
      });
      return todas;
    });

    // ── leer ──
    const leidas = await step.do("leer", { ...CONFIG, timeout: "15 minutes" }, async () => {
      if (!web.length) {
        await marcar(env, id, "leer", "saltado", "sin páginas que leer");
        return [] as Oferta[];
      }
      await marcar(env, id, "leer", "corriendo");
      const g = gastoVacio();
      const ofertas: Oferta[] = [];
      const cuenta: Record<string, number> = {};
      let armadas = 0, ia = 0;
      for (const [i, w] of web.entries()) {
        const p = await leerUrl(env, g, w.url, armadas < MAX_ARMAR);
        if (p.via !== "html") armadas++;
        let lectura = p.lectura;
        let metodo: Oferta["extraccion"] | null = lectura
          ? p.via === "contenedor" ? "contenedor_json_ld" : p.via === "navegador" ? "navegador_json_ld" : (lectura.metodo as Oferta["extraccion"])
          : null;
        if (!lectura && p.estado === "sin_precio" && p.visible.length > 400 && ia < MAX_LECTURAS_IA) {
          ia++;
          const m = await leerConModelo(env, g, w.url, p.visible).catch(() => null);
          if (m) {
            lectura = { titulo: m.titulo, marca: m.marca, precio: m.precio, moneda: m.moneda, disponibilidad: null, metodo: null, fragmento: null };
            metodo = p.via === "contenedor" ? "contenedor_ia" : p.via === "navegador" ? "navegador_ia" : "ia";
          }
        }
        const estado = lectura ? "ok" : p.estado;
        cuenta[estado] = (cuenta[estado] ?? 0) + 1;
        const clave = `lab/${id}/web-${i}.json`;
        const confirmado = lectura?.precio != null && p.visible ? confirmarEnTexto(lectura.precio, p.visible) : null;
        await env.EVIDENCIAS.put(
          clave,
          JSON.stringify({ url: w.url, leido: ahora(), estado, detalle: p.detalle, metodo, fragmento: lectura?.fragmento ?? null, confirmado,
            extracto: lectura?.precio != null ? alrededor(p.visible, lectura.precio) : p.visible.slice(0, 600) }),
          { httpMetadata: { contentType: "application/json" } },
        );
        if (lectura && lectura.precio != null && metodo) {
          ofertas.push({
            n: 0,
            fuente: "web",
            tienda: dominioDe(w.url),
            titulo: (lectura.titulo || w.titulo).slice(0, 240),
            marca: lectura.marca,
            url: w.url,
            precio: lectura.precio,
            moneda: lectura.moneda ?? "PEN",
            disponibilidad: lectura.disponibilidad,
            extraccion: metodo,
            confirmado,
            vendedor: null,
            evidencia: clave,
          });
        }
      }
      await sumarGasto(env, id, g);
      await marcar(env, id, "leer", "listo", { ...cuenta, armadas, ia });
      return ofertas;
    });

    // ── emparejar ──
    const juzgadas = await step.do("emparejar", CONFIG, async () => {
      await marcar(env, id, "emparejar", "corriendo");
      const g = gastoVacio();
      const todas = [...tiendas.ofertas, ...buscadores, ...leidas].map((o, i) => ({ ...o, n: i + 1 }));
      const sim = await parecido(env, ficha, todas.map((o) => o.titulo)).catch(() => todas.map(() => null));
      const excluir = ficha.excluir.map((x) => x.toLowerCase()).filter((x) => x.length > 2);
      for (const [i, o] of todas.entries()) {
        o.similitud = sim[i] ?? null;
        const mala = excluir.find((x) => o.titulo.toLowerCase().includes(x));
        if (mala) Object.assign(o, { coincidencia: "distinta", unidades: null, razon: `dice «${mala}»` });
      }
      const pendientes = todas.filter((o) => !o.coincidencia).sort((a, b) => (b.similitud ?? 0) - (a.similitud ?? 0));
      const aJuzgar = pendientes.slice(0, MAX_JUZGAR);
      const lotes: (typeof aJuzgar)[] = [];
      for (let i = 0; i < aJuzgar.length; i += LOTE_JUICIO) lotes.push(aJuzgar.slice(i, i + LOTE_JUICIO));
      const juicios = (
        await Promise.all(
          lotes.map((l) => juzgar(env, g, ficha, l.map((o) => ({ n: o.n, titulo: o.titulo, marca: o.marca, precio: o.precio, tienda: o.tienda, unidad: o.presentacion ?? null })))),
        )
      ).flat();
      const porN = new Map(juicios.map((j) => [j.n, j]));
      for (const o of todas) {
        if (o.coincidencia) continue;
        const j = porN.get(o.n);
        if (j) Object.assign(o, { coincidencia: j.coincidencia, unidades: j.unidades || null, razon: j.razon });
        else Object.assign(o, { coincidencia: "sin_juicio", unidades: null, razon: aJuzgar.includes(o) ? "el modelo no la juzgó" : "menos parecida, no se juzgó" });
      }
      await sumarGasto(env, id, g);
      const n = (c: string) => todas.filter((o) => o.coincidencia === c).length;
      await marcar(env, id, "emparejar", "listo", { exactas: n("exacta"), equivalentes: n("equivalente"), distintas: n("distinta"), sinJuicio: n("sin_juicio") });
      return todas;
    });

    // ── resumir ──
    await step.do("resumir", CONFIG, async () => {
      await marcar(env, id, "resumir", "corriendo");
      const finales = validar(juzgadas);
      const resumen = resumir(finales, entrada.precioReferencia ?? null, entrada.referencias ?? []);
      const stmts = [env.DB.prepare("DELETE FROM oferta WHERE investigacion = ?").bind(id)];
      for (const o of finales) {
        stmts.push(
          env.DB.prepare(
            `INSERT INTO oferta (investigacion, n, fuente, tienda, titulo, marca, url, precio, moneda, disponibilidad, extraccion, confirmado,
               vendedor, similitud, coincidencia, unidades, razon, precio_unitario, valida, motivo, evidencia)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(id, o.n, o.fuente, o.tienda, o.titulo, o.marca, o.url, o.precio, o.moneda, o.disponibilidad, o.extraccion,
            o.confirmado == null ? null : o.confirmado ? 1 : 0, o.vendedor, o.similitud ?? null, o.coincidencia ?? "sin_juicio",
            o.unidades ?? null, o.razon ?? null, o.precioUnitario ?? null, o.valida ? 1 : 0, o.motivo ?? null, o.evidencia ?? null),
        );
      }
      stmts.push(
        env.DB.prepare("UPDATE investigacion SET estado = 'listo', paso = NULL, resumen = ?, terminado = ? WHERE id = ?").bind(JSON.stringify(resumen), ahora(), id),
      );
      for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
      await marcar(env, id, "resumir", "listo", { validas: resumen.validas, veredicto: resumen.veredicto });
      return resumen.validas;
    });
  }
}

/** El texto alrededor del precio en la página (evidencia corta, no la página entera). */
function alrededor(visible: string, precio: number): string {
  const ent = String(Math.trunc(precio));
  const i = visible.indexOf(ent);
  return i < 0 ? visible.slice(0, 400) : visible.slice(Math.max(0, i - 200), i + 200);
}

export type { Ficha };
