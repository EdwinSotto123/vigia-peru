/**
 * SERVIR (plazas CAS), sin red. Los fixtures (test/fixtures/servir/) son respuestas reales del 2026-10-31 recortadas: la
 * página 1 del listado con 2 plazas, la respuesta AJAX de «Sig.» (página 2) y dos detalles. Lo esperado del parseo es lo
 * que da backend/scripts/cargar_servir_convocatorias.py con ese mismo HTML (y con las variantes de abajo). La sesión se
 * prueba contra una SERVIR simulada hecha con esos fixtures: la página va en la sesión del servidor, como en la real.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { WorkflowStep } from "cloudflare:workers";
import type { Env, ParamsCorrida } from "../src/config.ts";
import {
  botonesVerMas, botonSiguiente, caminoA, campos, correrServir, desescapar, fecha, leerTanda, monto, OMITIDO, paginaDe, paginaParam,
  paginaParcial, paraGuardar, parsearDetalle, parsearListado, SesionServir, sinContactos, TiempoAgotado, ubicacionesDelListado, URL_SERVIR,
  vacantesDe, viewState,
} from "../src/fuentes/servir_convocatorias.ts";
import type { Plaza, RespuestaServir } from "../src/fuentes/servir_convocatorias.ts";
import { cookiesDelRelay, pedirLima, URL_LIMA } from "../src/http.ts";
import type { PedidoLima } from "../src/http.ts";

const fixture = (n: string) => readFileSync(new URL(`./fixtures/servir/${n}`, import.meta.url), "utf-8");
const LISTADO = fixture("listado.html");
const SIGUIENTE = fixture("siguiente.xml");
const DETALLE = fixture("detalle.html");
const SUNAFIL = fixture("detalle_sunafil.html");

const FORM = "frmLstOfertsLabo";
const VER_MAS = [0, 1].map((k) => `${FORM}:idPnlRepeatPuestos:${k}:j_idt78`);
/** Lo que da `campos()` de Python con el listado (y con la página 2: los mismos campos). */
const CAMPOS_PY = {
  [FORM]: FORM, [`${FORM}:modalidadAcceso`]: "03", [`${FORM}:txtPerfil`]: "", [`${FORM}:cboDep_focus`]: "", [`${FORM}:txtPuesto`]: "",
  [`${FORM}:autocompletar_input`]: "", [`${FORM}:autocompletar_hinput`]: "", [`${FORM}:txtNroConv`]: "", [`${FORM}:cboDep_input`]: "",
};
/** `parsear_detalle()` de Python con detalle.html. */
const PLAZA_PY: Plaza = {
  aviso: 823283, titulo: "ASISTENTE JURISDICCIONAL", entidad: "PODER JUDICIAL", ubicacion: null, numero: "D.LEG 1057 - DETERMINADO (SUPLENCIA)-023",
  vacantes: 1, remuneracion: 2572, fecha_inicio: "2026-10-30", fecha_fin: "2026-11-12",
  experiencia: "¿ OBLIGATORIO: EXPERIENCIA ESPECÍFICA DE UN (1) AÑO EN LABORES DE APOYO A LA LABOR JURISDICCIONAL Y/O SIMILAR. ¿ DESEABLE. EXPERIENCIA ESPECÍFICA EN EL SECTOR PÚBLICO EN LABORES DE APOYO A LA LABOR JURISDICCIONAL Y/O SIMILAR.",
  formacion: "¿ OBLIGATORIO: ESTUDIOS UNIVERSITARIOS EN DERECHO (8VO CICLO).",
  especializacion: "¿ DESEABLE. CURSOS DE DERECHO PENAL, DERECHO PROCESAL PENAL Y/O DERECHO CONSTITUCIONAL (MÍNIMO 15 HORAS).",
  conocimiento: "¿ CONOCIMIENTO Y MANEJO DE OFIMÁTICA.", competencias: "¿ ATENCIÓN, CONTROL, PLANIFICACIÓN, EMPATÍA, ORDEN.",
  detalle_url: "https://aplicativo.pj.gob.pe/psep/wfrmConvocatoriasV.aspx?TCon=E",
};

test("listado: ViewState, campos, botones y ubicaciones como Python", () => {
  assert.equal(viewState(LISTADO), "8061150609640876926:-3386177225836678443");
  assert.deepEqual(campos(LISTADO), CAMPOS_PY);
  assert.equal(botonSiguiente(LISTADO), `${FORM}:j_idt62`);
  assert.deepEqual(botonesVerMas(LISTADO), VER_MAS);
  assert.deepEqual(paginaDe(LISTADO), [1, 330]);
  assert.deepEqual(ubicacionesDelListado(LISTADO), ["AREQUIPA - AREQUIPA", "AREQUIPA - AREQUIPA"]);
  // Lo que agrega el port: el resto del paginador, los títulos de cada fila y cuántos puestos dice SERVIR.
  const l = parsearListado(LISTADO)!;
  assert.deepEqual(l.botones, { primero: `${FORM}:j_idt58`, atras: `${FORM}:j_idt60`, siguiente: `${FORM}:j_idt62`, ultimo: `${FORM}:j_idt63` });
  assert.deepEqual(l.titulos, ["ASISTENTE JURISDICCIONAL", "APOYO EN LA ELABORACION DE PROYECTOS DE SENTENCIAS, RESOLLUCIONES Y OTROS DOCUMENTOS"]);
  assert.equal(l.puestos, 3299);
  assert.equal(parsearListado(DETALLE), null);
});

test("«Sig.»: la página 2 armada desde la respuesta AJAX, como en Python", () => {
  const h = paginaParcial(SIGUIENTE, "otro");
  assert.equal(viewState(h), "8061150609640876926:-3386177225836678443");
  assert.equal(botonSiguiente(h), `${FORM}:j_idt62`);
  assert.deepEqual(botonesVerMas(h), VER_MAS);
  assert.deepEqual(paginaDe(h), [2, 330]);
  assert.deepEqual(ubicacionesDelListado(h), ["LIMA - LIMA", "LIMA - LIMA"]);
  assert.deepEqual(campos(h), CAMPOS_PY);
  const l = parsearListado(h)!;
  assert.equal(l.pagina, 2);
  assert.equal(l.puestos, null);
  // Sin el ViewState en la respuesta, se queda el anterior (el `or vs` del script).
  assert.equal(viewState(paginaParcial(SIGUIENTE.replace(/<update id="javax.faces.ViewState">.*?<\/update>/s, ""), "anterior")), "anterior");
});

test("detalle: la plaza como la saca Python", () => {
  assert.deepEqual(parsearDetalle(DETALLE), PLAZA_PY);
  const s = parsearDetalle(SUNAFIL)!;
  assert.equal(s.aviso, 823307);
  assert.equal(s.entidad, "SUPERINTENDENCIA NACIONAL DE FISCALIZACION LABORAL - SUNAFIL");
  assert.equal(s.remuneracion, 6000);
  assert.equal(s.conocimiento, "CONOCIMIENTOS TÉCNICOS: - SISTEMA DE INSPECCIÓN DEL TRABAJO, LEGISLACIÓN LABORAL, DERECHO ADMINISTRATIVO, " +
    "PROCEDIMIENTO SANCIONADOR Y SEGURIDAD Y SALUD EN EL TRABAJO. - CONOCIMIENTO EN HERRAMIENTAS DE INTERNET. CONOCIMIENTO DE OFIMÁTICA: " +
    "- WORD A NIVEL INTERMEDIO. - EXCEL Y POWER POINT A NIVEL BÁSICO.");
  assert.equal(s.detalle_url, "https://aplicativosweb2.sunafil.gob.pe/si.convocatoria/convocatoria");
  // El aviso no es el «N° 1456» del decreto del menú.
  assert.ok(DETALLE.includes("N° 1456"));
});

test("variantes del detalle: lo mismo que Python (salvo la fecha que no existe)", () => {
  const con = (de: string | RegExp, a: string) => parsearDetalle(DETALLE.replace(de, a));
  assert.equal(con("https://aplicativo.pj.gob.pe/psep/wfrmConvocatoriasV.aspx?TCon=E </a>", "VER BASES </a>")!.detalle_url, null);
  assert.equal(con(/(EXPERIENCIA:<\/span><span class="detalle-sp">).*?(<\/span>)/s, "$1$2")!.experiencia, null);
  assert.equal(con('<p class="sub-titulo">INSTITUCIÓN:</p>', '<p class="sub-titulo">Ubicación:</p> LIMA - LIMA <p class="sub-titulo">INSTITUCIÓN:</p>')!.ubicacion, "LIMA - LIMA");
  assert.equal(con("S/. 2,572.00", "S/ 1.500,50 MENSUALES")!.remuneracion, 1.5);   // así lo lee Python
  assert.equal(con('<p class="sub-titulo">INSTITUCIÓN:</p>', '<p class="sub-titulo">ENTIDAD:</p>'), null);
  assert.equal(con("823283", "8232"), null);
  assert.equal(con("CONOCIMIENTO Y MANEJO DE OFIMÁTICA.", "WORD | EXCEL")!.conocimiento, "¿ WORD");   // la «|» corta, como en Python
  assert.equal(con("ASISTENTE JURISDICCIONAL</p>", "ASISTENTE &amp; APOYO &aacute;rea &#211;RGANO &#x2013; &#150; &notin &ampx &hellip;</p>")!.titulo,
    "ASISTENTE & APOYO área ÓRGANO – – ¬in &x …");
  // Python deja «2026-02-31» y la base rechaza la carga entera; el port la deja vacía.
  assert.equal(con("30/10/2026", "31/02/2026")!.fecha_inicio, null);
  assert.equal(fecha("05/11/2026 08:00"), "2026-11-05");
  assert.equal(monto("S/. 99,999,999,999,999.00"), null);
});

test("monto: la coma de los decimales no multiplica el sueldo por cien", () => {
  assert.equal(monto("S/. 8,364,19"), 8364.19);
  assert.equal(monto("S/ 2500,00 MENSUALES"), 2500);
  assert.equal(monto("S/. 2,572.00"), 2572);
  assert.equal(monto("S/. 2,572"), 2572);
  assert.equal(monto("S/. 15,600"), 15600);
  assert.equal(monto("S/ 1.500,50 MENSUALES"), 1.5);   // así lo sigue leyendo Python
  assert.equal(monto("A TRATAR"), null);
  // Céntimos leídos como soles en un formato desconocido: 100 mil o más que entre 100 da un sueldo posible.
  assert.equal(monto("S/. 320019"), 3200.19);
  assert.equal(monto("S/. 836,419.00"), 8364.19);
  assert.equal(monto("S/. 15,600.00"), 15600);
});

test("vacantes: el sueldo puesto en la celda de vacantes no cuenta", () => {
  assert.equal(vacantesDe("1", 2500), 1);
  assert.equal(vacantesDe("12 vacantes", 1800), 12);
  assert.equal(vacantesDe("241", 1800), 241);
  assert.equal(vacantesDe("6620", 6620), null); // «Secretario judicial» del 2026-11-02
  assert.equal(vacantesDe("S/. 6,620.00", 6620), null);
  assert.equal(vacantesDe("30", 30), 30); // chico: puede ser una casualidad
  assert.equal(vacantesDe(null, 2500), null);
});

test("desescapar = html.unescape de Python", () => {
  const PY: Record<string, string> = {
    "&amp;": "&", "&amp": "&", "&ampx": "&x", "&notin": "¬in", "&aacute;": "á", "&Aacute": "Á", "&nbsp;x": " x", "&#0;": "�",
    "&#13;": "\r", "&#128;": "€", "&#150;": "–", "&#x41;": "A", "&#xD800;": "�", "&#1;": "", "&#11;": "", "&#127;": "", "&#65534;": "",
    "&#1114112;": "�", "&hellip;": "…", "&hellip": "&hellip", "&verbar;": "|", "&ns=1&cb=2": "&ns=1&cb=2", "& b": "& b", "&;": "&;",
    "&#38;#38;": "&#38;", "a&lt;b&gt;c": "a<b>c", "&copy2026": "©2026", "&COPY;": "©", "&Tab;": "\t", "&quot;x&quot;": '"x"',
    "&#x1F600;": "😀", "&#9679;": "●", "&bull;": "•",
  };
  for (const [e, s] of Object.entries(PY)) assert.equal(desescapar(e), s, e);
});

test("contactos: correos y teléfonos fuera de lo que se guarda", () => {
  assert.deepEqual(sinContactos("ENVIAR CV A convocatorias@muni.gob.pe O AL TELÉFONO (01) 234-5678 ANEXO 12"),
    { texto: `ENVIAR CV A ${OMITIDO} O AL TELÉFONO ${OMITIDO} ANEXO 12`, quitados: 2 });
  assert.equal(sinContactos("CONSULTAS: CEL. 987 654 321 o whatsapp: 987654321").texto, `CONSULTAS: CEL. ${OMITIDO} o whatsapp: ${OMITIDO}`);
  assert.equal(sinContactos("LLAMAR AL 987-654-321").texto, `LLAMAR AL ${OMITIDO}`);
  // Lo que no es un contacto queda igual: leyes, RUC, años, montos, plazos.
  for (const t of ["LEY N° 30057 Y D.S. 040-2014-PCM", "RUC 20987654321", "EXPERIENCIA DE 2 AÑOS (2018-2026)", "S/ 9,876,543.21",
    "TEL 123", "CONTRATO A PLAZO FIJO 2026-2027", "CÓDIGO 1197111011E1", "TELECOMUNICACIONES 2024 2025"]) {
    assert.deepEqual(sinContactos(t), { texto: t, quitados: 0 }, t);
  }
  const g = paraGuardar({ ...PLAZA_PY, experiencia: "INFORMES AL 912345678", detalle_url: "https://wa.me/51912345678", conocimiento: "A\u0000B" });
  assert.equal(g.quitados, 2);
  assert.equal(g.plaza.experiencia, `INFORMES AL ${OMITIDO}`);
  assert.equal(g.plaza.detalle_url, null);
  assert.equal(g.plaza.conocimiento, "AB");
  assert.deepEqual(paraGuardar(PLAZA_PY), { plaza: PLAZA_PY, quitados: 0 });
});

test("el paginador: el camino más corto a una página", () => {
  assert.equal(caminoA(1, 2, 330), "siguiente");
  assert.equal(caminoA(1, 300, 330), "ultimo");
  assert.equal(caminoA(330, 300, 330), "atras");
  assert.equal(caminoA(5, 4, 330), "atras");
  assert.equal(caminoA(200, 3, 330), "primero");
  assert.equal(caminoA(1, 166, 330), "siguiente");   // 165 clics contra 1 + 164: empate, va directo
  assert.equal(caminoA(1, 167, 330), "ultimo");
  // Sólo con los botones que trae la página.
  assert.equal(caminoA(1, 300, 330, { siguiente: "x" }), "siguiente");
  assert.equal(caminoA(5, 4, 330, { siguiente: "x" }), null);
});

// ── Una SERVIR simulada con los fixtures ────────────────────────────────────────────────────────────────────────────
const BOTONES = { [`${FORM}:j_idt58`]: "primero", [`${FORM}:j_idt60`]: "atras", [`${FORM}:j_idt62`]: "siguiente", [`${FORM}:j_idt63`]: "ultimo" } as const;
const URL_DETALLE = "https://app.servir.gob.pe/DifusionOfertasExterno/faces/consultas/../consultas/detalle_ofertas_laborales.xhtml";
const tituloDe = (n: number, k: number) => `PLAZA DE PRUEBA P${n} F${k}`;
const avisoDe = (n: number, k: number) => 900_000 + n * 10 + k;

/** La página va en la sesión (JSESSIONID); cada GET crea una vista nueva; una vista que no existe no da error. */
class ServirSimulada {
  readonly paginas: number;
  sesiones = new Map<string, { pagina: number; vistas: Set<string> }>();
  pedidos: { metodo: string; tipo: string; pagina: number }[] = [];
  private n = 0;
  /** Para simular fallas: se llama antes de responder cada pedido (número de pedido, desde 1). */
  antes: (i: number, s: ServirSimulada) => void = () => undefined;
  /** Un «Sig.» que avanza dos páginas (el número de «Sig.», desde 1). */
  sigDoble = 0;
  private sigs = 0;

  constructor(paginas: number) {
    this.paginas = paginas;
  }

  private nueva(): [string, { pagina: number; vistas: Set<string> }] {
    const id = `S${++this.n}`;
    const s = { pagina: 1, vistas: new Set<string>() };
    this.sesiones.set(id, s);
    return [id, s];
  }

  private vista(s: { vistas: Set<string> }): string {
    const v = `${++this.n}:-${this.n * 7}`;
    s.vistas.add(v);
    return v;
  }

  private listado(n: number, vista: string): string {
    let k = 0;
    return LISTADO.replace(/(titulo-vacante[^>]*><label>)(.*?)(<\/label>)/gs, (_m, a: string, _t, c: string) => `${a}${tituloDe(n, k++)}${c}`)
      .replace(/P.gina \d+ de \d+/g, `Página ${n} de ${this.paginas}`).replace(/\d+ puesto\(s\)/, `${this.paginas * 2} puesto(s)`)
      .replace(/(name="javax\.faces\.ViewState"[^>]*value=")[^"]+/, `$1${vista}`);
  }

  private parcial(n: number, vista: string): string {
    let k = 0;
    return SIGUIENTE.replace(/(titulo-vacante[^>]*><label>)(.*?)(<\/label>)/gs, (_m, a: string, _t, c: string) => `${a}${tituloDe(n, k++)}${c}`)
      .replace(/P.gina \d+ de \d+/g, `Página ${n} de ${this.paginas}`)
      .replace(/(<update id="javax\.faces\.ViewState"><!\[CDATA\[)[^\]]+/, `$1${vista}`);
  }

  responder(p: PedidoLima): RespuestaServir {
    this.antes(this.pedidos.length + 1, this);
    const galleta = /JSESSIONID=([^;]+)/.exec(p.cabeceras?.Cookie ?? "")?.[1];
    let id = galleta && this.sesiones.has(galleta) ? galleta : null;
    let s = id ? this.sesiones.get(id)! : null;
    const cookies: Record<string, string> = {};
    if (!s) {
      [id, s] = this.nueva();
      Object.assign(cookies, { JSESSIONID: id, incap_ses_1_1: `imperva-${id}` });
    }
    const datos = new URLSearchParams(p.cuerpo ?? "");
    const vale = s.vistas.has(datos.get("javax.faces.ViewState") ?? "");
    if (p.metodo === "GET") {
      this.pedidos.push({ metodo: "GET", tipo: "listado", pagina: s.pagina });
      return { status: 200, url: URL_SERVIR, texto: this.listado(s.pagina, this.vista(s)), cookies };
    }
    if (datos.get("javax.faces.partial.ajax")) {
      const b = BOTONES[datos.get("javax.faces.source") as keyof typeof BOTONES];
      if (!vale) {
        // Vista vencida: SERVIR rehace la vista y devuelve la página donde va la sesión, sin hacer el clic.
        this.pedidos.push({ metodo: "POST", tipo: "ajax-vencido", pagina: s.pagina });
        return { status: 200, url: URL_SERVIR, texto: this.parcial(s.pagina, this.vista(s)), cookies };
      }
      if (b === "siguiente") s.pagina = Math.min(s.pagina + (++this.sigs === this.sigDoble ? 2 : 1), this.paginas);
      if (b === "atras") s.pagina = Math.max(s.pagina - 1, 1);
      if (b === "primero") s.pagina = 1;
      if (b === "ultimo") s.pagina = this.paginas;
      this.pedidos.push({ metodo: "POST", tipo: b, pagina: s.pagina });
      return { status: 200, url: URL_SERVIR, texto: this.parcial(s.pagina, datos.get("javax.faces.ViewState")!), cookies };
    }
    const fila = /:idPnlRepeatPuestos:(\d+):/.exec([...datos.keys()].join(" "));
    if (!vale || !fila) {
      this.pedidos.push({ metodo: "POST", tipo: "vermas-vencido", pagina: s.pagina });
      return { status: 200, url: URL_SERVIR, texto: this.listado(s.pagina, this.vista(s)), cookies };
    }
    const k = Number(fila[1]);
    this.pedidos.push({ metodo: "POST", tipo: "detalle", pagina: s.pagina });
    return { status: 200, url: URL_DETALLE, texto: DETALLE.replaceAll("ASISTENTE JURISDICCIONAL", tituloDe(s.pagina, k)).replace("823283", String(avisoDe(s.pagina, k))), cookies };
  }

  transporte = async (p: PedidoLima) => this.responder(p);
}

const P: ParamsCorrida = { fuente: "servir_convocatorias", origen: "prueba", seco: true };

/** Un Env de prueba: R2 en memoria, el relay de Lima sobre la SERVIR simulada y una base que no se puede tocar. */
function entorno(servir: ServirSimulada) {
  const crudos = new Map<string, string>();
  const relay: { pedidos: Record<string, unknown>[] } = { pedidos: [] };
  const env = {
    CRUDOS: { put: async (k: string, v: string) => void crudos.set(k, v) },
    RELAY_LIMA_TOKEN: " token-de-prueba ",
    RELAY_LIMA: {
      fetch: async (url: string, init: RequestInit) => {
        // El /health de la salida peruana (esperarRelayLima): responde siempre.
        if (url === `${URL_LIMA}/health`) return Response.json({ ok: true, nombre: "prueba" });
        assert.equal(url, `${URL_LIMA}/raw`);
        assert.equal((init.headers as Record<string, string>)["X-Vigia-Token"], "token-de-prueba");
        const pedido = JSON.parse(String(init.body)) as PedidoLima;
        relay.pedidos.push(pedido as unknown as Record<string, unknown>);
        const r = servir.responder(pedido);
        return new Response(r.texto, { status: r.status!, headers: { "x-relay-status": String(r.status), "x-relay-url": r.url,
          ...(Object.keys(r.cookies).length ? { "x-relay-cookies": JSON.stringify(r.cookies) } : {}) } });
      },
    },
    get HYPERDRIVE(): never {
      throw new Error("en seco no se toca la base");
    },
  } as unknown as Env;
  return { env, crudos, relay };
}

const plazasDe = (crudos: Map<string, string>) => [...crudos.values()].flatMap((v) => (JSON.parse(v) as { plazas: Plaza[] }).plazas);
const sinPausa = { pausaMs: 0 };

test("sesión: lee páginas seguidas con «Ver más» y «Sig.», y cada plaza es la de su fila", async () => {
  const servir = new ServirSimulada(25);
  const { env, crudos } = entorno(servir);
  const t = await leerTanda(env, P, { cookies: {}, pagina: 1, dia: "2026-10-31" }, 3, { ...sinPausa, transporte: servir.transporte });
  assert.deepEqual([t.desde, t.hasta, t.terminado, t.estado.pagina, t.paginasServir, t.puestos], [1, 3, false, 4, 25, 50]);
  assert.deepEqual(t.avisos, [900010, 900011, 900020, 900021, 900030, 900031]);
  assert.equal(t.resincronizaciones, 0);
  assert.deepEqual(servir.pedidos.map((x) => x.tipo), ["listado", "detalle", "detalle", "siguiente", "detalle", "detalle", "siguiente", "detalle", "detalle"]);
  assert.equal(t.estado.cookies.JSESSIONID, "S1");
  const plazas = plazasDe(crudos);
  assert.deepEqual(plazas.map((p) => p.titulo), [1, 2, 3].flatMap((n) => [tituloDe(n, 0), tituloDe(n, 1)]));
  // La ubicación sale del listado (el detalle no la trae), por fila: la página 1 viene de un GET y las otras de «Sig.».
  assert.deepEqual(plazas.map((p) => p.ubicacion), ["AREQUIPA - AREQUIPA", "AREQUIPA - AREQUIPA", "LIMA - LIMA", "LIMA - LIMA", "LIMA - LIMA", "LIMA - LIMA"]);
  assert.deepEqual([...crudos.keys()], ["raw/servir_convocatorias/2026-10-31/paginas-001-003.json"]);
});

test("sesión vencida entre pasos: la reabre y llega a la página por el camino más corto (Último y Atras)", async () => {
  const servir = new ServirSimulada(25);
  const { env, crudos } = entorno(servir);
  const t = await leerTanda(env, P, { cookies: { JSESSIONID: "vieja", incap_ses_1_1: "x" }, pagina: 20, dia: "d" }, 20, { ...sinPausa, transporte: servir.transporte });
  assert.deepEqual(servir.pedidos.map((x) => x.tipo), ["listado", "ultimo", "atras", "atras", "atras", "atras", "atras", "detalle", "detalle"]);
  assert.deepEqual(t.avisos, [900200, 900201]);
  assert.deepEqual(plazasDe(crudos).map((p) => p.titulo), [tituloDe(20, 0), tituloDe(20, 1)]);
  assert.equal(t.estado.cookies.JSESSIONID, "S1");
  assert.equal(t.estado.cookies.incap_ses_1_1, "imperva-S1");
});

test("un paso que se repite cuando la sesión ya había avanzado vuelve a su página", async () => {
  const servir = new ServirSimulada(25);
  servir.sesiones.set("S0", { pagina: 5, vistas: new Set() });
  const { env } = entorno(servir);
  const t = await leerTanda(env, P, { cookies: { JSESSIONID: "S0" }, pagina: 4, dia: "d" }, 4, { ...sinPausa, transporte: servir.transporte });
  assert.deepEqual(servir.pedidos.map((x) => `${x.tipo}:${x.pagina}`), ["listado:5", "atras:4", "detalle:4", "detalle:4"]);
  assert.deepEqual(t.avisos, [900040, 900041]);
});

test("ViewState vencido: un «Sig.» que no avanza y un «Ver más» que no llega al detalle se resincronizan", async () => {
  const servir = new ServirSimulada(25);
  // Antes del 4.º pedido («Sig.» de la página 1) y del 6.º («Ver más» de la página 2) la vista deja de valer.
  servir.antes = (i, s) => {
    if (i === 4 || i === 6) for (const x of s.sesiones.values()) x.vistas.clear();
  };
  const { env } = entorno(servir);
  const t = await leerTanda(env, P, { cookies: {}, pagina: 1, dia: "d" }, 2, { ...sinPausa, transporte: servir.transporte });
  assert.deepEqual(servir.pedidos.map((x) => `${x.tipo}:${x.pagina}`),
    ["listado:1", "detalle:1", "detalle:1", "ajax-vencido:1", "siguiente:2", "vermas-vencido:2", "listado:2", "detalle:2", "detalle:2"]);
  assert.deepEqual(t.avisos, [900010, 900011, 900020, 900021]);
  assert.equal(t.resincronizaciones, 2);
});

test("un «Sig.» que avanzó dos páginas se corrige con «Atras»; un pedido que falla se repite", async () => {
  const servir = new ServirSimulada(25);
  servir.sigDoble = 1;
  const { env } = entorno(servir);
  let fallo = false;
  const transporte = async (p: PedidoLima) => {
    if (!fallo && p.cuerpo?.includes("idPnlRepeatPuestos%3A1")) {
      fallo = true;
      throw new Error("se cortó la conexión");
    }
    return servir.responder(p);
  };
  const t = await leerTanda(env, P, { cookies: {}, pagina: 1, dia: "d" }, 2, { ...sinPausa, transporte });
  assert.deepEqual(servir.pedidos.map((x) => `${x.tipo}:${x.pagina}`),
    ["listado:1", "detalle:1", "detalle:1", "siguiente:3", "atras:2", "detalle:2", "detalle:2"]);
  assert.deepEqual(t.avisos, [900010, 900011, 900020, 900021]);
});

test("un detalle que SERVIR no entrega (HTTP 500) se salta, como en Python; tres seguidos cortan el paso", async () => {
  const error = (): RespuestaServir => ({ status: 500, url: URL_SERVIR, texto: "<html>Error</html>", cookies: {} });
  const servir = new ServirSimulada(25);
  const { env } = entorno(servir);
  const uno = async (p: PedidoLima) => (p.cuerpo?.includes("idPnlRepeatPuestos%3A0") && !servir.pedidos.some((x) => x.tipo === "detalle") ? error() : servir.responder(p));
  const t = await leerTanda(env, P, { cookies: {}, pagina: 1, dia: "d" }, 2, { ...sinPausa, transporte: uno });
  assert.deepEqual(t.avisos, [900011, 900020, 900021]);
  assert.equal(t.sinDatos, 1);

  const caida = new ServirSimulada(25);
  const todos = async (p: PedidoLima) => (p.cuerpo?.includes("idPnlRepeatPuestos") ? error() : caida.responder(p));
  await assert.rejects(() => leerTanda(entorno(caida).env, P, { cookies: {}, pagina: 1, dia: "d" }, 3, { ...sinPausa, transporte: todos }),
    /SERVIR no responde los detalles de las plazas: HTTP 500/);
});

test("un intento que pasó su tiempo deja de pedir", async () => {
  const servir = new ServirSimulada(3);
  const ses = new SesionServir(servir.transporte, {}, { pausaMs: 0, limiteMs: -1 });
  await assert.rejects(() => ses.abrir(), TiempoAgotado);
  assert.equal(servir.pedidos.length, 0);
});

test("correrServir en seco: pasos de 10 páginas por el relay de Lima, sin tocar la base", async () => {
  const servir = new ServirSimulada(25);
  const { env, crudos, relay } = entorno(servir);
  const nombres: string[] = [];
  const step = {
    do: async (nombre: string, a: unknown, b?: unknown) => {
      nombres.push(nombre);
      return ((typeof a === "function" ? a : b) as () => Promise<unknown>)();
    },
  } as unknown as WorkflowStep;
  const r = await correrServir(env, P, step, "prueba", sinPausa) as Record<string, unknown>;
  assert.deepEqual(nombres, ["relay de Lima: ¿responde? (1)", "páginas 1-10", "páginas 11-20", "páginas 21-30"]);
  assert.equal(r.plazas, 50);
  assert.equal(r.paginas, 25);
  assert.equal(r.paginas_servir, 25);
  assert.equal(r.puestos_servir, 50);
  assert.equal(r.seco, true);
  assert.equal(r.resincronizaciones, 0);
  assert.equal(plazasDe(crudos).length, 50);
  assert.ok(!JSON.stringify(r).includes("S1"), "el resumen no lleva las cookies de la sesión");
  // Lo que viajó por el relay: el formulario urlencoded, las cabeceras de JSF y la cookie de la sesión desde el 2.º pedido.
  const ajax = relay.pedidos.find((x) => (x.cabeceras as Record<string, string>)["Faces-Request"])!;
  assert.equal(ajax.metodo, "POST");
  assert.equal(ajax.url, URL_SERVIR);
  assert.ok(String(ajax.cuerpo).includes("javax.faces.partial.ajax=true"));
  assert.equal((ajax.cabeceras as Record<string, string>).Cookie, "JSESSIONID=S1; incap_ses_1_1=imperva-S1");
  assert.equal((relay.pedidos[0].cabeceras as Record<string, string>).Cookie, undefined);

  // Con `hasta` (con 4 cifras, lo que deja pasar POST /correr): sólo esas páginas, como `--seco --paginas 3`.
  const otra = new ServirSimulada(25);
  const e2 = entorno(otra);
  const nombres2: string[] = [];
  const r2 = await correrServir(e2.env, { ...P, desde: "0002", hasta: "0003" }, { do: async (n: string, _c: unknown, f: () => Promise<unknown>) => (nombres2.push(n), f()) } as unknown as WorkflowStep, "p", sinPausa) as Record<string, unknown>;
  assert.deepEqual(nombres2, ["relay de Lima: ¿responde? (1)", "páginas 2-3"]);
  assert.equal(r2.plazas, 4);
  assert.deepEqual([paginaParam("3"), paginaParam("0003"), paginaParam(3), paginaParam("2026-10"), paginaParam("0"), paginaParam(undefined)], [3, 3, 3, null, null, null]);
});

test("pedirLima: método, cabeceras y cuerpo al relay; cookies y URL final de vuelta; reintenta un 502", async () => {
  const vistos: { cuerpo: Record<string, unknown>; token: string }[] = [];
  let veces = 0;
  const env = {
    RELAY_LIMA_TOKEN: "t",
    RELAY_LIMA: {
      fetch: async (_u: string, init: RequestInit) => {
        vistos.push({ cuerpo: JSON.parse(String(init.body)), token: (init.headers as Record<string, string>)["X-Vigia-Token"] });
        if (veces++ === 0) return new Response('{"detail":"sin respuesta del origen"}', { status: 502 });
        return new Response("<html>detalle</html>", { status: 200, headers: { "x-relay-status": "200", "x-relay-url": "https://x.gob.pe/fin",
          "x-relay-cookies": '{"JSESSIONID":"abc","otra":"1"}' } });
      },
    },
  } as unknown as Env;
  const r = await pedirLima(env, { url: "https://x.gob.pe/", metodo: "POST", cabeceras: { Cookie: "a=b" }, cuerpo: "x=1" });
  assert.equal(veces, 2);
  assert.deepEqual(vistos[0].cuerpo, { url: "https://x.gob.pe/", metodo: "POST", cabeceras: { Cookie: "a=b" }, cuerpo: "x=1" });
  assert.equal(vistos[0].token, "t");
  assert.equal(r.origen, 200);
  assert.equal(r.url, "https://x.gob.pe/fin");
  assert.deepEqual(r.cookies, { JSESSIONID: "abc", otra: "1" });
  assert.equal(await r.respuesta.text(), "<html>detalle</html>");
  // 401 del relay (sin x-relay-status): el token está mal, no es del origen.
  const mal = { RELAY_LIMA: { fetch: async () => new Response("{}", { status: 401 }) } } as unknown as Env;
  await assert.rejects(() => pedirLima(mal, { url: "https://x.gob.pe/" }), /RELAY_LIMA_TOKEN/);
  // Sin reintentos: devuelve el 502 tal cual (origen null: el error es del relay).
  const caido = { RELAY_LIMA: { fetch: async () => new Response("{}", { status: 502 }) } } as unknown as Env;
  assert.equal((await pedirLima(caido, { url: "https://x.gob.pe/", sinReintentos: true })).origen, null);
  assert.deepEqual(cookiesDelRelay("no es json"), {});
  assert.deepEqual(cookiesDelRelay('{"a":1,"b":"2"}'), { b: "2" });
});
