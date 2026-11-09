import test from "node:test";
import assert from "node:assert/strict";
import { SinRelayHttp, clienteHttp, soloPeru } from "../src/lib/empleoHttp.js";

/** Un sitio de mentira: anota cada pedido y responde lo que se le pida. */
function sitio(respuestas: ((req: { url: string; init: RequestInit }) => Response)[]) {
  const pedidos: { url: string; init: RequestInit }[] = [];
  let i = 0;
  const f = (async (url: string, init: RequestInit = {}) => {
    const req = { url, init };
    pedidos.push(req);
    return respuestas[Math.min(i++, respuestas.length - 1)](req);
  }) as unknown as typeof fetch;
  return { f, pedidos };
}

const html = (cuerpo: string, extra: Record<string, string> = {}) => new Response(cuerpo, { headers: { "content-type": "text/html; charset=utf-8", ...extra } });

test("las cookies de la sesión van en el pedido siguiente; el POST manda el formulario", async () => {
  const s = sitio([() => html("<form>", { "set-cookie": "JSESSIONID=abc; Path=/; HttpOnly" }), () => html("<ok>")]);
  const http = clienteHttp(5, s.f);
  await http.get("https://cas.promperu.gob.pe/");
  const r = await http.post("https://cas.promperu.gob.pe/", { "javax.faces.ViewState": "v1", pagina: "2" });
  assert.equal(r?.texto, "<ok>");
  const h = s.pedidos[1].init.headers as Record<string, string>;
  assert.equal(h.cookie, "JSESSIONID=abc");
  assert.match(h["content-type"], /x-www-form-urlencoded/);
  assert.equal(s.pedidos[1].init.body, "javax.faces.ViewState=v1&pagina=2");
  assert.equal(s.pedidos[1].init.method, "POST");
  assert.deepEqual(http.cookies(), { JSESSIONID: "abc" });
});

test("json: lee la respuesta como JSON; si no es JSON, null", async () => {
  const s = sitio([() => new Response('{"data":[1,2]}', { headers: { "content-type": "application/json" } }), () => html("<html>")]);
  const http = clienteHttp(5, s.f);
  assert.deepEqual(await http.json<{ data: number[] }>("https://x.gob.pe/api"), { data: [1, 2] });
  assert.equal(await http.json("https://x.gob.pe/api"), null);
});

test("un 5xx se reintenta una vez y cuenta en el tope; con el tope gastado, null", async () => {
  const s = sitio([() => new Response("", { status: 530 }), () => html("<bien>")]);
  const http = clienteHttp(2, s.f);
  assert.equal((await http.get("https://www.gob.pe/x"))?.texto, "<bien>");
  assert.equal(await http.get("https://www.gob.pe/y"), null);
  assert.equal(http.usados(), 2);
});

test("lo que sólo responde al Perú va por el relay de Lima, con método, cuerpo y las cookies que devuelve", async () => {
  const pedidos: { url: string; metodo: string; cabeceras: Record<string, string>; cuerpo?: string }[] = [];
  const relay = async (p: (typeof pedidos)[number]) => {
    pedidos.push(p);
    return new Response("<drelm>", { headers: { "content-type": "text/html", "x-relay-status": "200", "x-relay-url": p.url, "x-relay-cookies": '{"PHPSESSID":"z9"}' } });
  };
  const http = clienteHttp(5, (() => assert.fail("no va directo")) as unknown as typeof fetch, relay);
  await http.get("https://www.drelm.gob.pe/drelm/contratacion-de-personal/");
  await http.post("https://www.drelm.gob.pe/buscar", { q: "276" });
  assert.deepEqual(pedidos.map((p) => p.metodo), ["GET", "POST"]);
  assert.equal(pedidos[1].cuerpo, "q=276");
  assert.equal(pedidos[1].cabeceras.cookie, "PHPSESSID=z9");
  assert.equal(soloPeru("https://aplicativo.pj.gob.pe/psep/"), true);
  assert.equal(soloPeru("https://www.gob.pe/mef"), false);
  // Los que no responden a Cloudflare o tienen el TLS roto (2026-11-09).
  for (const u of ["https://convocatoria.minjus.gob.pe/x", "https://www.ins.gob.pe/cas/", "https://contenidos.regionpiura.gob.pe/convocatoria/a.pdf", "https://aplicativosweb2.sunafil.gob.pe/"]) assert.equal(soloPeru(u), true, u);
  await assert.rejects(clienteHttp(5, fetch).get("https://www.drelm.gob.pe/"), SinRelayHttp);
});
