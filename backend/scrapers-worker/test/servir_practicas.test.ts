/**
 * SERVIR (prácticas), sin red. Los fixtures (test/fixtures/servir/) son la estructura real del 2026-11-08, recortada: la
 * página 1 del listado con 2 prácticas, la respuesta AJAX de «Sig.» (página 2) y un detalle. La sesión se prueba contra
 * una SERVIR simulada hecha con esos fixtures: la página va en la sesión del servidor, como en la real.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { WorkflowStep } from "cloudflare:workers";
import type { Env, ParamsCorrida } from "../src/config.ts";
import {
  beneficiosPractica, clavePractica, correoInstitucional, correrPracticas, cronogramaPractica, filasPracticas, leerPaginaPracticas,
  modalidadDe, paginaParamPracticas, paraGuardarPractica, parsearDetallePractica, parsearListadoPracticas, URL_PRACTICAS,
} from "../src/fuentes/servir_practicas.ts";
import type { Practica } from "../src/fuentes/servir_practicas.ts";
import type { RespuestaServir } from "../src/fuentes/servir_convocatorias.ts";
import { OMITIDO } from "../src/fuentes/servir_convocatorias.ts";
import { URL_LIMA } from "../src/http.ts";
import type { PedidoLima } from "../src/http.ts";

const fixture = (n: string) => readFileSync(new URL(`./fixtures/servir/${n}`, import.meta.url), "utf-8");
const LISTADO = fixture("practicas_listado.html");
const SIGUIENTE = fixture("practicas_siguiente.xml");
const DETALLE = fixture("practicas_detalle.html");

const FORM = "frmLstModFormativas";
const VER_MAS = [0, 1].map((k) => `${FORM}:idPnlRepeatPuestos:${k}:j_idt66`);

/** El detalle de INDECOPI 092-2026, como lo lee `parsearDetallePractica`. */
const PRACTICA: Practica = {
  clave: "INDECOPI|092 2026|2026|PRACTICANTE PROFESIONAL|OFICINA DE TECNOLOGIAS DE LA INFORMACION",
  titulo: "PRACTICANTE PROFESIONAL", entidad: "INDECOPI", modalidad: "practica_pro", tipo_modalidad: null,
  ubicacion: null, numero: "092 - 2026", anio: 2026, vacantes: 1, subvencion: 1300, duracion_meses: 1, jornada_horas: 48,
  fecha_inicio: "2026-11-06", fecha_fin: "2026-11-20",
  unidad_organica: "OFICINA DE TECNOLOGIAS DE LA INFORMACIÓN",
  direccion: "CALLE LA PROSA 104, SAN BORJA - LIMA, LIMA, SAN BORJA",
  actividades: [
    "Apoyar en la atención y soporte técnico en primer nivel, de los incidentes, requerimientos y consultas solicitados por las Áreas Usuarias por llamadas telefónicas, correo electrónico o Tickets.",
    "Apoyar en los eventos y/o reuniones virtuales que se desarrollen en la Alta Dirección del Indecopi.",
  ],
  requerimientos: ["Egresado", "Carrera Universitaria", "INGENIERÍA DE SISTEMAS"],
  conocimientos: "Conocimientos técnicos: No aplica. Conocimientos de ofimática: Procesador de textos, hojas de cálculo y programa de presentaciones, a nivel básico.",
  beneficios: {
    subvencion: 1300, duracion_meses: 1, jornada_horas: 48, horario_ingreso: "08:30 AM", horario_salida: "05:30 PM",
    texto: [
      "Subvención Económica mensual de S/ 1,300.00",
      "1 mes(es) de duración del convenio.",
      "Jornada laboral formativa de 48 horas semanales.",
      "Horario de Ingreso de Prácticas 08:30 AM",
      "Horario de Salida de Prácticas 05:30 PM",
    ],
  },
  cronograma: [
    { etapa: "Difusión", inicio: "2026-11-06", fin: "2026-11-20" },
    { etapa: "Reclutamiento", inicio: "2026-11-23", fin: "2026-11-23" },
    { etapa: "Evaluación", inicio: "2026-11-24", fin: "2026-12-14" },
    { etapa: "Entrevista", inicio: "2026-12-04", fin: "2026-12-14" },
    { etapa: "Elección", inicio: "2026-12-14", fin: "2026-12-14" },
  ],
  correo: "seleccion@indecopi.gob.pe", web: "https://oportunidadeslaborales.indecopi.gob.pe/", detalle_url: URL_PRACTICAS,
};

test("listado: 10 tarjetas por página, con modalidad, ubicación, número, vacantes y fechas", () => {
  const filas = filasPracticas(LISTADO);
  assert.equal(filas.length, 2);
  assert.deepEqual(filas[0], {
    titulo: "PRACTICANTE PROFESIONAL", entidad: "INDECOPI", tipo_modalidad: "Practicas Profesionales",
    ubicacion: "LIMA - SAN BORJA", numero: "092 - 2026", vacantes: 1, fecha_inicio: "2026-11-06", fecha_fin: "2026-11-20",
  });
  const l = parsearListadoPracticas(LISTADO)!;
  assert.equal(l.pagina, 1);
  assert.equal(l.paginas, 2);
  assert.deepEqual(l.verMas, VER_MAS);
  assert.deepEqual(l.botones, {
    primero: `${FORM}:j_idt54`, atras: `${FORM}:j_idt55`, siguiente: `${FORM}:j_idt57`, ultimo: `${FORM}:j_idt58`,
  });
  assert.deepEqual(l.titulos, ["PRACTICANTE PROFESIONAL", "PRACTICANTE EN ADMINISTRACIÓN"]);
  assert.deepEqual(l.ubicaciones, ["LIMA - SAN BORJA", "LIMA - SAN MIGUEL"]);
  // El listado de prácticas no dice cuántos puestos hay (el de CAS sí).
  assert.equal(l.puestos, null);
  // Los campos son los de SU formulario, no los de las ofertas laborales.
  assert.deepEqual(Object.keys(l.campos), [FORM, `${FORM}:txtCriterio`]);
  // El detalle no es un listado.
  assert.equal(parsearListadoPracticas(DETALLE), null);
});

test("detalle: la práctica con su unidad, actividades, requisitos, beneficios, cronograma y contacto", () => {
  assert.deepEqual(parsearDetallePractica(DETALLE), PRACTICA);
  assert.deepEqual(cronogramaPractica(DETALLE), PRACTICA.cronograma);
  assert.deepEqual(beneficiosPractica(DETALLE), {
    beneficios: PRACTICA.beneficios, subvencion: 1300, duracion: 1, jornada: 48,
  });
  assert.equal(correoInstitucional("seleccion@indecopi.gob.pe"), "seleccion@indecopi.gob.pe");
  assert.equal(correoInstitucional("postula@gmail.com"), null);
  assert.equal(correoInstitucional("rrhh@universidad.edu.pe"), "rrhh@universidad.edu.pe");
  // Sin número de convocatoria no es una práctica legible.
  assert.equal(parsearDetallePractica(DETALLE.replace("Número de Convocatoria:", "Convocatoria:")), null);
});

test("la clave: entidad + número + año + título + unidad, normalizados; el año sale del número si falta", () => {
  const base = { entidad: "INDECOPI", numero: "092 - 2026", anio: 2026, titulo: "PRACTICANTE PROFESIONAL", unidad_organica: "OFICINA DE TECNOLOGÍAS" };
  assert.equal(clavePractica(base), "INDECOPI|092 2026|2026|PRACTICANTE PROFESIONAL|OFICINA DE TECNOLOGIAS");
  assert.equal(clavePractica({ ...base, anio: null }), clavePractica(base));
  assert.equal(clavePractica({ ...base, titulo: "Practicante  Profesional" }), clavePractica(base));
  assert.notEqual(clavePractica({ ...base, numero: "093 - 2026" }), clavePractica(base));
  assert.ok(clavePractica({ ...base, titulo: "x".repeat(500) }).length <= 400);
});

test("la modalidad: «pre» primero (PRE PROFESIONAL contiene PROFESIONAL)", () => {
  assert.equal(modalidadDe("Practicas Pre Profesionales", "PRACTICANTE"), "practica_pre");
  assert.equal(modalidadDe("Practicas Profesionales", "PRACTICANTE"), "practica_pro");
  assert.equal(modalidadDe(null, "PRACTICANTE TÉCNICO"), "practica_pre");
  assert.equal(modalidadDe("Otras modalidades", "AUXILIAR ADMINISTRATIVO"), "practica_pre");
  assert.equal(modalidadDe(null, "PRACTICANTE"), "otra");
});

test("lo que se guarda: sin correos ni teléfonos en los textos, con el correo institucional del canal", () => {
  assert.deepEqual(paraGuardarPractica(PRACTICA), { practica: PRACTICA, quitados: 0 });
  const g = paraGuardarPractica({
    ...PRACTICA,
    actividades: ["ENVIAR CV A rrhh@muni.gob.pe O LLAMAR AL 987 654 321"],
    requerimientos: ["CONSULTAS: CEL. 987654321"],
    correo: "seleccion@indecopi.gob.pe",
  });
  assert.equal(g.quitados, 3);
  assert.equal(g.practica.actividades[0], `ENVIAR CV A ${OMITIDO} O LLAMAR AL ${OMITIDO}`);
  assert.equal(g.practica.requerimientos[0], `CONSULTAS: CEL. ${OMITIDO}`);
  assert.equal(g.practica.correo, "seleccion@indecopi.gob.pe");
  // Un correo particular en el canal de contacto no se conserva.
  assert.equal(paraGuardarPractica({ ...PRACTICA, correo: "postula@gmail.com" }).practica.correo, null);
});

test("desde/hasta: páginas de SERVIR, también con 4 cifras (lo que deja pasar POST /correr)", () => {
  assert.deepEqual([paginaParamPracticas("3"), paginaParamPracticas("0003"), paginaParamPracticas(3), paginaParamPracticas("2026-10"),
    paginaParamPracticas("0"), paginaParamPracticas(undefined)], [3, 3, 3, null, null, null]);
});

// ── Una SERVIR simulada con los fixtures ────────────────────────────────────────────────────────────────────────────
const BOTONES = { [`${FORM}:j_idt54`]: "primero", [`${FORM}:j_idt55`]: "atras", [`${FORM}:j_idt57`]: "siguiente", [`${FORM}:j_idt58`]: "ultimo" } as const;
const URL_DETALLE = "https://app.servir.gob.pe/DifusionOfertasExterno/faces/consultas/../consultas/detalle_modalidades_formativas.xhtml";
const tituloDe = (n: number, k: number) => `PRACTICA P${n} F${k}`;
const numeroDe = (n: number, k: number) => `0${n}${k} - 2026`;
const unidadDe = (n: number, k: number) => `UNIDAD P${n} F${k}`;
const claveDe = (n: number, k: number) => `INDECOPI|0${n}${k} 2026|2026|${tituloDe(n, k)}|${unidadDe(n, k)}`;

/** La página va en la sesión (JSESSIONID); cada GET crea una vista nueva; una vista que no existe no da error. */
class PracticasSimuladas {
  readonly paginas: number;
  sesiones = new Map<string, { pagina: number; vistas: Set<string> }>();
  pedidos: { metodo: string; tipo: string; pagina: number }[] = [];
  private n = 0;

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
      .replace(/P.gina \d+ de \d+/g, `Página ${n} de ${this.paginas}`)
      .replace(/(name="javax\.faces\.ViewState"[^>]*value=")[^"]+/, `$1${vista}`);
  }

  private parcial(n: number, vista: string): string {
    let k = 0;
    return SIGUIENTE.replace(/(titulo-vacante[^>]*><label>)(.*?)(<\/label>)/gs, (_m, a: string, _t, c: string) => `${a}${tituloDe(n, k++)}${c}`)
      .replace(/P.gina \d+ de \d+/g, `Página ${n} de ${this.paginas}`)
      .replace(/(<update id="javax\.faces\.ViewState"><!\[CDATA\[)[^\]]+/, `$1${vista}`);
  }

  private detalle(n: number, k: number): string {
    return DETALLE.replaceAll("PRACTICANTE PROFESIONAL", tituloDe(n, k))
      .replace("092 - 2026", numeroDe(n, k))
      .replace("OFICINA DE TECNOLOGIAS DE LA INFORMACIÓN", unidadDe(n, k));
  }

  responder(p: PedidoLima): RespuestaServir {
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
      return { status: 200, url: URL_PRACTICAS, texto: this.listado(s.pagina, this.vista(s)), cookies };
    }
    if (datos.get("javax.faces.partial.ajax")) {
      const b = BOTONES[datos.get("javax.faces.source") as keyof typeof BOTONES];
      if (!vale) {
        this.pedidos.push({ metodo: "POST", tipo: "ajax-vencido", pagina: s.pagina });
        return { status: 200, url: URL_PRACTICAS, texto: this.parcial(s.pagina, this.vista(s)), cookies };
      }
      if (b === "siguiente") s.pagina = Math.min(s.pagina + 1, this.paginas);
      if (b === "atras") s.pagina = Math.max(s.pagina - 1, 1);
      if (b === "primero") s.pagina = 1;
      if (b === "ultimo") s.pagina = this.paginas;
      this.pedidos.push({ metodo: "POST", tipo: b, pagina: s.pagina });
      return { status: 200, url: URL_PRACTICAS, texto: this.parcial(s.pagina, datos.get("javax.faces.ViewState")!), cookies };
    }
    const fila = /:idPnlRepeatPuestos:(\d+):/.exec([...datos.keys()].join(" "));
    if (!vale || !fila) {
      this.pedidos.push({ metodo: "POST", tipo: "vermas-vencido", pagina: s.pagina });
      return { status: 200, url: URL_PRACTICAS, texto: this.listado(s.pagina, this.vista(s)), cookies };
    }
    const k = Number(fila[1]);
    this.pedidos.push({ metodo: "POST", tipo: "detalle", pagina: s.pagina });
    return { status: 200, url: URL_DETALLE, texto: this.detalle(s.pagina, k), cookies };
  }

  transporte = async (p: PedidoLima) => this.responder(p);
}

const P: ParamsCorrida = { fuente: "servir_practicas", origen: "prueba", seco: true };

/** Un Env de prueba: R2 en memoria, el relay de Lima sobre la SERVIR simulada y una base que no se puede tocar. */
function entorno(servir: PracticasSimuladas) {
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

const practicasDe = (crudos: Map<string, string>) => [...crudos.values()].flatMap((v) => (JSON.parse(v) as { practicas: Practica[] }).practicas);
const sinPausa = { pausaMs: 0 };

test("sesión: abre el listado de prácticas, pide sus detalles y pasa a la página 2 con «Sig.»", async () => {
  const servir = new PracticasSimuladas(2);
  const { env, crudos } = entorno(servir);
  const t1 = await leerPaginaPracticas(env, P, { cookies: {}, pagina: 1, dia: "2026-11-08" }, { ...sinPausa, transporte: servir.transporte });
  assert.deepEqual([t1.desde, t1.hasta, t1.terminado, t1.estado.pagina, t1.paginasServir], [1, 1, false, 2, 2]);
  assert.deepEqual(t1.claves, [claveDe(1, 0), claveDe(1, 1)]);
  assert.deepEqual(servir.pedidos.map((x) => x.tipo), ["listado", "detalle", "detalle"]);
  assert.equal(t1.estado.cookies.JSESSIONID, "S1");

  const t2 = await leerPaginaPracticas(env, P, t1.estado, { ...sinPausa, transporte: servir.transporte });
  assert.deepEqual([t2.desde, t2.hasta, t2.terminado, t2.estado.pagina], [2, 2, true, 3]);
  assert.deepEqual(t2.claves, [claveDe(2, 0)]);
  assert.deepEqual(servir.pedidos.map((x) => `${x.tipo}:${x.pagina}`),
    ["listado:1", "detalle:1", "detalle:1", "listado:1", "siguiente:2", "detalle:2"]);
  assert.deepEqual([...crudos.keys()], ["raw/servir_practicas/2026-11-08/pagina-001.json", "raw/servir_practicas/2026-11-08/pagina-002.json"]);

  const practicas = practicasDe(crudos);
  assert.deepEqual(practicas.map((p) => p.titulo), [tituloDe(1, 0), tituloDe(1, 1), tituloDe(2, 0)]);
  // Lo que sólo trae el listado: la modalidad, la ubicación y las fechas de publicación.
  assert.deepEqual(practicas.map((p) => [p.tipo_modalidad, p.modalidad, p.ubicacion]),
    [["Practicas Profesionales", "practica_pro", "LIMA - SAN BORJA"],
      ["Practicas Pre Profesionales", "practica_pre", "LIMA - SAN MIGUEL"],
      ["Practicas Pre Profesionales", "practica_pre", "LIMA - SAN MIGUEL"]]);
  assert.deepEqual(practicas.map((p) => p.vacantes), [1, 2, 1]);
  // Lo que trae el detalle: la unidad, la subvención y el canal de postulación.
  assert.deepEqual(practicas.map((p) => p.unidad_organica), [unidadDe(1, 0), unidadDe(1, 1), unidadDe(2, 0)]);
  assert.deepEqual(practicas.map((p) => [p.subvencion, p.duracion_meses, p.jornada_horas]), [[1300, 1, 48], [1300, 1, 48], [1300, 1, 48]]);
  assert.deepEqual(practicas.map((p) => p.correo), ["seleccion@indecopi.gob.pe", "seleccion@indecopi.gob.pe", "seleccion@indecopi.gob.pe"]);
});

test("correrPracticas en seco: una página por paso por el relay de Lima, sin tocar la base", async () => {
  const servir = new PracticasSimuladas(2);
  const { env, crudos, relay } = entorno(servir);
  const nombres: string[] = [];
  const step = {
    do: async (nombre: string, a: unknown, b?: unknown) => {
      nombres.push(nombre);
      return ((typeof a === "function" ? a : b) as () => Promise<unknown>)();
    },
  } as unknown as WorkflowStep;
  const r = await correrPracticas(env, P, step, "prueba", sinPausa) as Record<string, unknown>;
  assert.deepEqual(nombres, ["relay de Lima: ¿responde? (1)", "página 1", "página 2"]);
  assert.deepEqual([r.practicas, r.paginas, r.paginas_servir, r.seco, r.resincronizaciones], [3, 2, 2, true, 0]);
  assert.equal(practicasDe(crudos).length, 3);
  assert.ok(!JSON.stringify(r).includes("S1"), "el resumen no lleva las cookies de la sesión");
  // Lo que viajó por el relay: el formulario de prácticas y la cookie de la sesión desde el 2.º pedido.
  const ajax = relay.pedidos.find((x) => (x.cabeceras as Record<string, string>)["Faces-Request"])!;
  assert.equal(ajax.metodo, "POST");
  assert.equal(ajax.url, URL_PRACTICAS);
  assert.ok(String(ajax.cuerpo).includes("javax.faces.partial.ajax=true"));
  assert.ok(String(ajax.cuerpo).includes(FORM));
  assert.equal((relay.pedidos[0].cabeceras as Record<string, string>).Cookie, undefined);
  assert.equal((relay.pedidos[1].cabeceras as Record<string, string>).Cookie, "JSESSIONID=S1; incap_ses_1_1=imperva-S1");
});
