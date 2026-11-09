/**
 * El cliente HTTP de los adaptadores de convocatorias (lib/empleoAdaptadores.ts): GET y POST (formularios JSF/ASPX y
 * APIs JSON) con las cookies de la sesión, un tope de pedidos por búsqueda y, para los sitios que sólo responden al Perú
 * (bloquean a Cloudflare), el relay de Lima (backend/relay-lima: POST /raw con método, cabeceras y cuerpo; las cookies del
 * origen vuelven en x-relay-cookies).
 */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

/**
 * Lo que sólo se lee por el relay de Lima (medido desde Cloudflare el 2026-11-09): el Poder Judicial, MINJUS, el INS y el
 * INABIF no responden a Cloudflare (403 o se cuelgan), y Piura y SUNAFIL tienen el TLS roto (cadena incompleta, cifrado
 * viejo), que el relay tolera para ellos (TLS_TOLERANTE en backend/relay-lima/relay.py). También para bajar sus PDF.
 */
const SOLO_PERU = /(^|\.)(pj\.gob\.pe|drelm\.gob\.pe|convocatoria\.minjus\.gob\.pe|ins\.gob\.pe|inabif\.gob\.pe|aplicativosweb2\.sunafil\.gob\.pe|regionpiura\.gob\.pe)$/i;
export function soloPeru(url: string): boolean {
  try {
    return SOLO_PERU.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

export interface RespuestaHttp {
  status: number;
  /** El cuerpo como texto (HTML, XML o JSON), recortado a 2 MB. Vacío si no es texto. */
  texto: string;
  /** La URL final (después de las redirecciones). */
  final: string;
  tipo: string;
}

export interface PedidoHttp {
  metodo?: "GET" | "POST" | "HEAD";
  cabeceras?: Record<string, string>;
  /** Un formulario (se manda como application/x-www-form-urlencoded) o un cuerpo ya armado (JSON, por ejemplo). */
  form?: Record<string, string>;
  cuerpo?: string;
  timeoutMs?: number;
}

/** El relay de Lima completo (método, cabeceras y cuerpo), del binding RELAY_LIMA de la API. */
export type RelayCompleto = (pedido: { url: string; metodo: string; cabeceras: Record<string, string>; cuerpo?: string }, ms: number) => Promise<Response>;

export function relayCompletoDe(env: { RELAY_LIMA?: { fetch(input: string, init?: RequestInit): Promise<Response> }; RELAY_LIMA_TOKEN?: string }): RelayCompleto | undefined {
  const servicio = env.RELAY_LIMA;
  if (!servicio) return undefined;
  return (pedido, ms) =>
    servicio.fetch("http://127.0.0.1:8080/raw", {
      method: "POST",
      headers: { "content-type": "application/json", "x-vigia-token": (env.RELAY_LIMA_TOKEN ?? "").trim() },
      body: JSON.stringify(pedido),
      signal: AbortSignal.timeout(ms),
    });
}

export class SinRelayHttp extends Error {}

export interface Http {
  pedir(url: string, p?: PedidoHttp): Promise<RespuestaHttp | null>;
  get(url: string, cabeceras?: Record<string, string>): Promise<RespuestaHttp | null>;
  post(url: string, form: Record<string, string>, cabeceras?: Record<string, string>): Promise<RespuestaHttp | null>;
  /** GET o POST que devuelve JSON (null si no responde o no es JSON). */
  json<T>(url: string, p?: PedidoHttp): Promise<T | null>;
  usados(): number;
  cookies(): Record<string, string>;
}

/** Las cookies de un Set-Cookie (sólo nombre y valor). */
function leerCookies(cabeceras: Headers): Record<string, string> {
  const lista = typeof (cabeceras as Headers & { getSetCookie?: () => string[] }).getSetCookie === "function"
    ? (cabeceras as Headers & { getSetCookie: () => string[] }).getSetCookie()
    : (cabeceras.get("set-cookie") ?? "").split(/,(?=\s*[A-Za-z0-9_.-]+=)/);
  const out: Record<string, string> = {};
  for (const c of lista) {
    const m = /^\s*([^=;\s]+)=([^;]*)/.exec(c);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const esTexto = (tipo: string) => /html|xml|json|text\/plain|javascript/i.test(tipo);

/**
 * Un cliente para UNA búsqueda (las cookies son de esa sesión). `tope`: pedidos como mucho (un reintento de un 5xx cuenta).
 * Con `f` y `relay` de mentira se prueba sin red.
 */
export function clienteHttp(tope = 15, f: typeof fetch = fetch, relay?: RelayCompleto): Http {
  let usados = 0;
  const jar: Record<string, string> = {};
  const cookieHeader = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");

  const pedir = async (url: string, p: PedidoHttp = {}): Promise<RespuestaHttp | null> => {
    const metodo = p.metodo ?? (p.form || p.cuerpo != null ? "POST" : "GET");
    const cuerpo = p.form ? new URLSearchParams(p.form).toString() : p.cuerpo;
    const cabeceras: Record<string, string> = {
      "user-agent": UA,
      accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
      "accept-language": "es-PE,es;q=0.9",
      ...(p.form ? { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" } : {}),
      ...(Object.keys(jar).length ? { cookie: cookieHeader() } : {}),
      ...(p.cabeceras ?? {}),
    };
    for (let intento = 0; intento < 2; intento++) {
      if (usados >= tope) return null;
      usados++;
      try {
        let r: Response;
        let final = url;
        if (soloPeru(url)) {
          if (!relay) throw new SinRelayHttp("sin_relay");
          try {
            r = await relay({ url, metodo, cabeceras, ...(cuerpo != null && metodo === "POST" ? { cuerpo } : {}) }, p.timeoutMs ?? 25_000);
          } catch (e) {
            throw new SinRelayHttp(`relay_lima: ${(e as Error).message.slice(0, 80)}`);
          }
          if (!r.headers.get("x-relay-status")) throw new SinRelayHttp(`relay_lima_${r.status}`);
          final = r.headers.get("x-relay-url") || url;
          try {
            Object.assign(jar, JSON.parse(r.headers.get("x-relay-cookies") ?? "{}"));
          } catch {
            /* sin cookies */
          }
        } else {
          r = await f(url, { method: metodo, headers: cabeceras, body: metodo === "POST" ? cuerpo : undefined, redirect: "follow", signal: AbortSignal.timeout(p.timeoutMs ?? 15_000) });
          final = r.url || url;
          Object.assign(jar, leerCookies(r.headers));
        }
        if (r.status >= 500 && intento === 0) continue;
        const tipo = r.headers.get("content-type") ?? "";
        const texto = esTexto(tipo) || !tipo ? (await r.text()).slice(0, 2_000_000) : "";
        if (!texto) await r.body?.cancel().catch(() => undefined);
        return { status: r.status, texto, final, tipo };
      } catch (e) {
        if (e instanceof SinRelayHttp) throw e;
        if (intento === 1) return null;
      }
    }
    return null;
  };

  return {
    pedir,
    get: (url, cabeceras) => pedir(url, { cabeceras }),
    post: (url, form, cabeceras) => pedir(url, { form, cabeceras }),
    async json<T>(url: string, p: PedidoHttp = {}) {
      const r = await pedir(url, { ...p, cabeceras: { accept: "application/json, text/plain, */*", ...(p.cabeceras ?? {}) } });
      if (!r || r.status >= 400 || !r.texto) return null;
      try {
        return JSON.parse(r.texto) as T;
      } catch {
        return null;
      }
    },
    usados: () => usados,
    cookies: () => ({ ...jar }),
  };
}
