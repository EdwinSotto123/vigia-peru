import test from "node:test";
import assert from "node:assert/strict";
import {
  ADAPTADORES, adaptadorDe, camposOcultos, celdas, dominioDe, fechaEs, hallazgo, nombreDeArchivo, numeroYAnio, parecidoEntidad, prioridadDocumento,
  regimenDe, textoPlano,
} from "../src/lib/empleoAdaptadores.js";
import { bajarPdf, esDocumento, quizasPdf, urlDescarga } from "../src/lib/basesPlaza.js";
import { clienteHttp } from "../src/lib/empleoHttp.js";

test("lo común: texto, celdas, campos ocultos, archivos, fechas y números", () => {
  assert.equal(textoPlano("<b>CAS&nbsp;N&deg; 03</b> <i>2026</i>"), "CAS N° 03 2026");
  assert.deepEqual(celdas("<tr><td>a</td><TD>b <b>c</b></TD><th>d</th></tr>"), ["a", "b <b>c</b>", "d"]);
  assert.deepEqual(camposOcultos('<input type="hidden" name="__VIEWSTATE" value="abc&amp;d"><input type="text" name="q" value="x">'), { __VIEWSTATE: "abc&d" });
  assert.equal(nombreDeArchivo("https://x.gob.pe/Archivos/BASES%20PROCESO%20CAS%20N%2003-2026.pdf"), "BASES PROCESO CAS N 03-2026");
  assert.equal(fechaEs("03 de noviembre 2026"), "2026-11-03");
  assert.equal(fechaEs("6 de Noviembre de 2026"), "2026-11-06");
  assert.equal(fechaEs("05/11/2026"), "2026-11-05");
  assert.deepEqual(numeroYAnio("Segunda Convocatoria N° 072 - PROMPERÚ - 2026"), { n: 72, anio: 2026 });
  assert.deepEqual(numeroYAnio("CONVOCATORIA SUPLENCIA TEMPORAL 019-2026"), { n: 19, anio: 2026 });
  assert.deepEqual([regimenDe("D.LEG 1057 - DETERMINADO (SUPLENCIA)-132"), regimenDe("276-92"), regimenDe("728-01"), regimenDe("LEY 30057-5")], ["cas", "276", "728", "otro"]);
});

test("la entidad de SERVIR contra la del sitio, con abreviaturas", () => {
  assert.ok(parecidoEntidad("UNIDAD EJECUTORA SALUD CAJAMARCA", "RED INTEGRADA DE SALUD CAJAMARCA") >= 0.99);
  assert.ok(parecidoEntidad("DIREC REG TRANSP COMUNIC VIV Y CONST CAJ", "DIRECCIÓN DE TRANSPORTES Y COMUNICACIONES") >= 0.5);
  assert.ok(parecidoEntidad("HOSPITAL GENERAL JAEN", "HOSPITAL GENERAL DE JAEN") >= 0.99);
  assert.ok(parecidoEntidad("UNIDAD EJECUTORA SALUD CAJAMARCA", "DIRECCIÓN REGIONAL DE SALUD") < 0.99);
});

test("los documentos: los que más sirven para leer primero, sin repetir y sin la fecha pegada al nombre", () => {
  const h = hallazgo("https://x", [
    { url: "https://x/norma.pdf", texto: "NORMA TÉCNICA 02/11/2026" },
    { url: "https://x/anexo.pdf", texto: "Anexo 03-A" },
    { url: "https://x/plazas.pdf", texto: "Relación de plazas" },
    { url: "https://x/bases.pdf", texto: "Bases" },
    { url: "https://x/bases.pdf", texto: "Bases (otra vez)" },
    { url: "/relativa.pdf", texto: "sin dominio" },
  ]);
  assert.deepEqual(h?.documentos.map((d) => d.texto), ["Bases", "Relación de plazas", "NORMA TÉCNICA", "Anexo 03-A"]);
  assert.ok(prioridadDocumento({ url: "x", texto: "Cronograma" }) < prioridadDocumento({ url: "x", texto: "Resolución viceministerial" }));
  assert.equal(hallazgo("https://x", []), null);
});

test("descargas sin .pdf y archivos de Drive cuentan como documentos", () => {
  for (const u of [
    "https://convocatoria.minjus.gob.pe/convocatoria/Preview?file=abc123",
    "https://postulacioncas.minedu.gob.pe/PostulacionCas/Postulacion/Descargar_Bases?idReq=29880",
    "https://convocatorias.pronied.gob.pe:9595/casPostulacion/Postulacion/Descargar_base?idReq=9439",
    "https://convocatoria.juntos.gob.pe/Convocatoria/DescargarArchivoBases/?id=2254",
    "https://convocatorias.minsa.gob.pe/convocatorias/Home/Home/GetBaseConvocatoria?convocatoriaidentificador=059-2026%20DETERMINADO",
    "https://api.gorea360.regionamazonas.gob.pe/api/Archivo/16348/descargar",
    "https://drive.google.com/file/d/1eej0b2HU4doZMqW1sbuOyeZ3Pp4-yiYe/view?usp=sharing",
  ]) {
    assert.ok(esDocumento(u), u);
    assert.ok(quizasPdf(u), u);
  }
  assert.equal(urlDescarga("https://drive.google.com/file/d/1eej0b2HU4doZMqW1sbuOyeZ3Pp4-yiYe/view?usp=sharing"), "https://drive.google.com/uc?export=download&id=1eej0b2HU4doZMqW1sbuOyeZ3Pp4-yiYe");
  assert.equal(esDocumento("https://www.ugel07.gob.pe/convocatoria-cas/"), false);
});

test("el adaptador va por el dominio del enlace de SERVIR (la web, no el Facebook)", () => {
  assert.equal(dominioDe("https://www.facebook.com/x https://www.ugel07.gob.pe/convocatoria-cas/"), "www.ugel07.gob.pe");
  assert.equal(adaptadorDe("https://www.ins.gob.pe/cas/consulta_cas/"), ADAPTADORES["www.ins.gob.pe"]);
  assert.equal(adaptadorDe("https://www.gob.pe/mef"), ADAPTADORES["www.gob.pe"]);
  assert.equal(adaptadorDe("https://www.municipalidad-sin-adaptador.gob.pe/"), null);
  // Los dos dominios de Cajamarca son la misma aplicación.
  assert.equal(ADAPTADORES["convocatoriasgrc.regioncajamarca.gob.pe"], ADAPTADORES["convocatorias.regioncajamarca.gob.pe"]);
  assert.ok(Object.keys(ADAPTADORES).length >= 20);
});

/** Un sitio de mentira por URL. */
function sitio(paginas: Record<string, string>) {
  const pedidos: string[] = [];
  const f = (async (url: string) => {
    pedidos.push(url);
    const cuerpo = Object.entries(paginas).find(([k]) => url.startsWith(k))?.[1];
    return cuerpo == null ? new Response("", { status: 404 }) : new Response(cuerpo, { headers: { "content-type": url.includes("json") || cuerpo.startsWith("[") || cuerpo.startsWith("{") ? "application/json" : "text/html" } });
  }) as unknown as typeof fetch;
  return { f, pedidos };
}

const PLAZA = { aviso: 1, titulo: "ANALISTA", entidad: "INSTITUTO NACIONAL DE SALUD", numero: "D.LEG 1057 - DETERMINADO (NECESIDAD TRANSITORIA)-03", detalle_url: "https://www.ins.gob.pe/cas/consulta_cas/", fecha_inicio: "2026-11-02" };

test("INS: la fila del proceso (por número y año) y sólo la celda de las bases, no la de resultados", async () => {
  const html = `<table><tr class="x"><td>1.-</td><td>02/11/2026</td><td> CAS-003-2026 <br></td><td>RO</td><td>Analista…</td><td>OGRH</td>
    <td><a href="../Archivos/BASES PROCESO CAS N 03-2026-INS.pdf"><img></a></td><td><a href="../Archivos/RESULTADOS CAS 03.pdf">r</a></td></tr></table>`;
  const s = sitio({ "https://www.ins.gob.pe/cas/consulta_cas/index.asp": html });
  // El INS no responde a Cloudflare: va por el relay de Lima (aquí, el mismo sitio de mentira).
  const relay = async (p: { url: string }) => {
    const r = await s.f(p.url);
    return new Response(await r.text(), { status: r.status, headers: { "content-type": r.headers.get("content-type") ?? "text/html", "x-relay-status": String(r.status), "x-relay-url": p.url } });
  };
  const h = await ADAPTADORES["www.ins.gob.pe"](PLAZA, clienteHttp(5, (() => assert.fail("no va directo")) as unknown as typeof fetch, relay));
  assert.match(s.pedidos[0], /anio=2026&convocatoria=003/);
  assert.deepEqual(h?.documentos.map((d) => d.url), ["https://www.ins.gob.pe/cas/Archivos/BASES%20PROCESO%20CAS%20N%2003-2026-INS.pdf"]);
});

test("Red de Salud Tacna: la pestaña del régimen, el número y año del título y la fila «Bases» de la ficha", async () => {
  const lista = `<div class="tab-pane fade" id="pills-cas"><table><tr><td><h6 class="mb-0"><a href="https://www.redsaludtacna.gob.pe/convocatorias/9">CAS 019-2026</a></h6></td></tr></table></div>
    <div class="tab-pane fade" id="pills-sup"><table><tr><td><h6 class="mb-0"><a href="https://www.redsaludtacna.gob.pe/convocatorias/375">CONVOCATORIA SUPLENCIA TEMPORAL 019-2026</a></h6>
    <span>ODONTOLOGO/A</span></td></tr></table></div>`;
  const ficha = `<table><tr><td class="text-center">Bases</td><td><a href="http://www.redsaludtacna.gob.pe/storage/convocatoria/375/abc.pdf">b</a></td></tr>
    <tr><td>Aptos</td><td><a href="http://www.redsaludtacna.gob.pe/storage/convocatoria/375/aptos.pdf">a</a></td></tr></table>`;
  const s = sitio({ "https://www.redsaludtacna.gob.pe/convocatorias/375": ficha, "https://www.redsaludtacna.gob.pe/convocatorias": lista });
  const h = await ADAPTADORES["www.redsaludtacna.gob.pe"]({ ...PLAZA, titulo: "ODONTOLOGO", numero: "276-019", detalle_url: "https://www.redsaludtacna.gob.pe/" }, clienteHttp(5, s.f));
  assert.equal(h?.pagina, "https://www.redsaludtacna.gob.pe/convocatorias/375");
  assert.deepEqual(h?.documentos.map((d) => [d.texto, d.url]), [["Bases", "https://www.redsaludtacna.gob.pe/storage/convocatoria/375/abc.pdf"]]);
});

test("la ola 2: salud, educación, nacionales y especiales quedan registrados; MIDIS y Provías van por la entidad", async () => {
  const { dominiosConAdaptador, adaptadorDe, adaptadorDePlaza } = await import("../src/lib/empleoAdaptadores.js");
  const d = dominiosConAdaptador();
  for (const x of ["portal.inen.sld.pe", "www.hdosdemayo.gob.pe", "portalweb.unas.edu.pe", "38.187.4.52", "www.inpe.gob.pe", "pad2.minem.gob.pe",
    "caspublico.oece.gob.pe", "drive.google.com", "share.google", "aguacanete.com", "www.gob.pe"]) {
    assert.ok(d.includes(x), x);
  }
  const gobpe = adaptadorDe("https://www.gob.pe/institucion/midis/campañas/1");
  const midis = adaptadorDePlaza({ entidad: "MINISTERIO DE DESARROLLO E INCLUSION SOCIAL", detalle_url: "https://www.gob.pe/institucion/midis/campañas/1" });
  assert.ok(midis && midis !== gobpe);
  const provias = adaptadorDePlaza({ entidad: "PROYECTO ESPECIAL DE INFRAESTRUCTURA DE TRANSPORTE NACIONAL - PROVIAS NACIONAL", detalle_url: "https://www.gob.pe/provias" });
  assert.ok(provias && provias !== gobpe);
  // MTPE, SERNANP y PRONIED: SERVIR no siempre trae su enlace (el MTPE lo deja en null), así que van por la entidad.
  for (const entidad of ["MINIST. DE TRABAJO Y PROMOCION DEL EMPLEO", "SERVICIO NACIONAL DE ÁREAS NATURALES PROTEGIDAS POR EL ESTADO",
    "PROGRAMA NACIONAL DE INFRAESTRUCTURA EDUCATIVA"]) {
    const a = adaptadorDePlaza({ entidad, detalle_url: null });
    assert.ok(a && a !== gobpe, entidad);
  }
  assert.equal(adaptadorDePlaza({ entidad: "MUNICIPALIDAD DE LA PERLA", detalle_url: null }), null);
  // JUNTOS (un programa del MIDIS) sigue con su propio adaptador.
  assert.equal(adaptadorDePlaza({ entidad: "PROGRAMA NACIONAL DE APOYO DIRECTO A LOS MAS POBRES - JUNTOS", detalle_url: "https://convocatoria.juntos.gob.pe/x" }), adaptadorDe("https://convocatoria.juntos.gob.pe/x"));
});

test("MTPE: la lista por número, el visor público y los comunicados que no son resultados", async () => {
  const lista = {
    dato: [
      { numConvoc: 181, numAnio: 2026, desCargo: "UN/A ESPECIALISTA LEGAL", desUniOrg: "DIRECCIÓN DE POLÍTICAS", fecPubli: "06/11/2026 23:14:43", urlBases: "http://apptest.trabajo.gob.pe:8080/convocatorias/#/principal/fileconvocatorias/convoc/28181794024772030.pdf", desCatEst: "VIGENTE", listaComunicado: [] },
      {
        numConvoc: 182, numAnio: 2026, desCargo: "UN/A ESPECIALISTA LEGAL", desUniOrg: "DIRECCIÓN REGIONAL DE TRABAJO Y PROMOCIÓN DEL EMPLEO DE LIMA METROPOLITANA",
        fecPubli: "09/11/2026 14:45:17", urlBases: "http://apptest.trabajo.gob.pe:8080/convocatorias/#/principal/fileconvocatorias/convoc/27601794253397467.pdf", desCatEst: "VIGENTE",
        listaComunicado: [
          { desCatProceso: "BASES", desCatTipo: "REPROGRAMACIÓN", urlArchivo: "http://apptest.trabajo.gob.pe:8080/convocatorias/#/principal/fileconvocatorias/comunica/73021794248157230.pdf" },
          { desCatProceso: "RESULTADO", desCatTipo: "RESULTADO FINAL", urlArchivo: "http://apptest.trabajo.gob.pe:8080/convocatorias/#/principal/fileconvocatorias/comunica/resultado.pdf" },
        ],
      },
    ],
  };
  const pedidos: { url: string; cuerpo: string }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    pedidos.push({ url, cuerpo: String(init?.body ?? "") });
    return new Response(JSON.stringify(lista), { headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const a = adaptadorDe("https://convocatoriasmtpe.trabajo.gob.pe/convocatorias/")!;
  const h = await a({
    ...PLAZA, titulo: "UN/A ESPECIALISTA LEGAL", entidad: "MINISTERIO DE TRABAJO Y PROMOCIÓN DEL EMPLEO",
    numero: "D.LEG 1057 - DETERMINADO (SUPLENCIA)-182", detalle_url: "https://convocatoriasmtpe.trabajo.gob.pe/convocatorias/",
    fecha_inicio: "2026-11-09", ubicacion: "LIMA - LIMA",
  }, clienteHttp(5, f));
  assert.equal(pedidos.length, 1);
  assert.match(pedidos[0].url, /\/convocatoriasback\/api\/convocatoria\/lista$/);
  assert.equal((JSON.parse(pedidos[0].cuerpo) as { dato: { numAnio: number } }).dato.numAnio, 2026);
  assert.deepEqual(h?.documentos.map((d) => [d.texto, d.url]), [
    ["Bases de la convocatoria", "https://convocatoriasmtpe.trabajo.gob.pe/convocatorias/#/principal/fileconvocatorias/convoc/27601794253397467.pdf"],
    ["Comunicado: Reprogramación", "https://convocatoriasmtpe.trabajo.gob.pe/convocatorias/#/principal/fileconvocatorias/comunica/73021794248157230.pdf"],
  ]);
});

test("SERNANP: la sede del departamento, el grupo del puesto y sin evaluaciones ni resultados", async () => {
  const lista = `<div class="b8-listado-convocatoria"><a href="#" onclick="javascript:fn_getlist(1,2026,195190,0);return false;" class="b8-item-convocatoria"><span class="icon-checkmark"></span>CAS N° 06-2026-SERNANP</a><a href="#" onclick="javascript:fn_getlist(1,2026,195187,0);return false;"><span></span>DECLARACIONES JURADAS - GANADORES DE CONCURSO</a></div>`;
  const sedes = `<div class="b8-listado-convocatoria"><a href="#" onclick="javascript:fn_getdetail(1,2026,195190,301);return false;"><span></span>Madre de Dios</a><a href="#" onclick="javascript:fn_getdetail(1,2026,195190,502);return false;"><span></span>Piura</a></div>`;
  const detalle = `<div class="contenedor-documentos"><div class="row"><table><tbody><tr><td><p class="nombre">BASES_6. ANALISTA.ANP.RNTAM.2</p></td><td><a href="https://www.sernanp.gob.pe/download/base-analista" title="BASES_6. ANALISTA.ANP.RNTAM.2">Descargar</a></td></tr></tbody></table></div></div>
    <div class="contenedor-documentos"><div class="row"><table><tbody><tr><td><p class="nombre">CRONOGRAMA_6. ANALISTA.ANP.RNTAM.2</p></td><td><a href="https://www.sernanp.gob.pe/download/crono-analista">Descargar</a></td></tr></tbody></table></div></div>
    <div class="contenedor-documentos"><div class="row"><table><tbody><tr><td><p class="nombre">BASES_6. ASISTENTE.OP.RNTAM.18</p></td><td><a href="https://www.sernanp.gob.pe/download/base-asistente">Descargar</a></td></tr></tbody></table></div></div>
    <div class="contenedor-documentos"><div class="row"><table><tbody><tr><td><p class="nombre">EV. CURRICULAR_6. ANALISTA.ANP.RNTAM.2</p></td><td><a href="https://www.sernanp.gob.pe/download/ev-analista">Descargar</a></td></tr></tbody></table></div></div>
    <div class="contenedor-documentos"><div class="row"><table><tbody><tr><td><p class="nombre">RESULTADO FINAL_6. ANALISTA.ANP.RNTAM.2</p></td><td><a href="https://www.sernanp.gob.pe/download/res-analista">Descargar</a></td></tr></tbody></table></div></div>`;
  const pedidos: string[] = [];
  const f = (async (url: string) => {
    pedidos.push(url);
    const u = new URL(url);
    const tp = u.searchParams.get("tp"), an = u.searchParams.get("an"), ls = u.searchParams.get("ls"), dt = u.searchParams.get("dt");
    let html: string | null = null;
    if (tp === "1" && an === "0" && ls === "0" && dt === "0") html = lista;
    else if (tp === "1" && an === "2026" && ls === "195190" && dt === "0") html = sedes;
    else if (tp === "1" && an === "2026" && ls === "195190" && dt === "301") html = detalle;
    if (!html) return new Response("", { status: 404 });
    // El sitio devuelve un JSON que, a su vez, trae el HTML como string JSON.
    return new Response(JSON.stringify(JSON.stringify({ rpta: 0, result: html })), { headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const a = adaptadorDe("https://www.sernanp.gob.pe/convocatorias/")!;
  const h = await a({
    ...PLAZA, titulo: "ANALISTA EN RECURSOS NATURALES", entidad: "SERVICIO NACIONAL DE ÁREAS NATURALES PROTEGIDAS POR EL ESTADO",
    numero: "CAS N° 06-2026-SERNANP", detalle_url: "https://www.sernanp.gob.pe/convocatorias/",
    fecha_inicio: "2026-09-25", ubicacion: "MADRE DE DIOS - TAMBOPATA",
  }, clienteHttp(6, f));
  assert.ok(pedidos.some((u) => /tp=1&an=2026&ls=195190&dt=301/.test(u)));
  assert.deepEqual(h?.documentos.map((d) => d.url), [
    "https://www.sernanp.gob.pe/download/base-analista",
    "https://www.sernanp.gob.pe/download/crono-analista",
  ]);
});

test("PRONIED: el correlativo de la tabla y la base por Descargar_base", async () => {
  const html = `<table><thead><tr><th>CORRELATIVO</th><th>NOMBRE</th><th>FECHA</th></tr></thead><tbody>
    <tr><td>0036-2026</td><td>TECNICO ADMINISTRATIVO POR SUPLENCIA</td><td>06/11/2026</td><td>23/11/2026</td><td>23/11/2026</td><td><a href="/casPostulacion/Postulacion/Descargar_base?idReq=9439">BASES</a></td><td></td><td>POSTULAR</td></tr>
    <tr><td>0035-2026</td><td>COORDINADOR (A) II EN PROCEDIMIENTOS</td><td>06/11/2026</td><td>23/11/2026</td><td>23/11/2026</td><td><a href="/casPostulacion/Postulacion/Descargar_base?idReq=9438">BASES</a></td><td></td><td>POSTULAR</td></tr>
  </tbody></table>`;
  const s = sitio({ "https://convocatorias.pronied.gob.pe:9595/casPostulacion/": html });
  const a = adaptadorDe("https://convocatorias.pronied.gob.pe:9595/casPostulacion")!;
  const h = await a({
    ...PLAZA, titulo: "TECNICO ADMINISTRATIVO POR SUPLENCIA", entidad: "PROGRAMA NACIONAL DE INFRAESTRUCTURA EDUCATIVA",
    numero: "D.LEG 1057 - DETERMINADO (SUPLENCIA)-36", detalle_url: "https://convocatorias.pronied.gob.pe:9595/casPostulacion",
    fecha_inicio: "2026-11-06", ubicacion: "LIMA - LIMA",
  }, clienteHttp(5, s.f, async (pedido) => {
    // El puerto 9595 no sale de un Worker: PRONIED va por el relay de Lima (aquí, el mismo sitio de mentira).
    const r = await s.f(pedido.url, { method: pedido.metodo, headers: pedido.cabeceras, body: pedido.cuerpo });
    return new Response(await r.text(), { status: r.status, headers: { "x-relay-status": String(r.status), "content-type": r.headers.get("content-type") ?? "text/html" } });
  }));
  assert.equal(h?.pagina, "https://convocatorias.pronied.gob.pe:9595/casPostulacion/");
  assert.deepEqual(h?.documentos.map((d) => d.url), ["https://convocatorias.pronied.gob.pe:9595/casPostulacion/Postulacion/Descargar_base?idReq=9439"]);
});

test("MTPE: bajarPdf reconoce el visor y pide el PDF en base64 a la API", async () => {
  const pdf = new Uint8Array(600);
  pdf.set([0x25, 0x50, 0x44, 0x46]);
  const f = (async (url: string, init?: RequestInit) => {
    assert.equal(url, "https://convocatoriasmtpe.trabajo.gob.pe/convocatoriasback/api/fileconvocatorias/buscar");
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(String(init?.body)), { dato: { tipodoc: "convoc", numdoc: "27601794253397467.pdf" } });
    return new Response(JSON.stringify({ dato: Buffer.from(pdf).toString("base64") }), { headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const b = await bajarPdf("https://convocatoriasmtpe.trabajo.gob.pe/convocatorias/#/principal/fileconvocatorias/convoc/27601794253397467.pdf", f);
  assert.deepEqual([...b!.slice(0, 4)], [0x25, 0x50, 0x44, 0x46]);
});

test("SERNANP: el PDF llega detrás de un script y bajarPdf lo recorta", async () => {
  const pdf = new Uint8Array(600);
  pdf.set([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x35]);
  const prefijo = new TextEncoder().encode("<script>alert(2026); </script>https://www.sernanp.gob.pe/documents/files/195190/301/BASES.pdf");
  const cuerpo = new Uint8Array(prefijo.byteLength + pdf.byteLength);
  cuerpo.set(prefijo);
  cuerpo.set(pdf, prefijo.byteLength);
  const f = (async () => new Response(cuerpo, { headers: { "content-type": "application/force-download" } })) as unknown as typeof fetch;
  const b = await bajarPdf("https://www.sernanp.gob.pe/download/9fdde8ac-b8e4-11f1-ac71-005056bd93da", f);
  assert.deepEqual([...b!.slice(0, 5)], [0x25, 0x50, 0x44, 0x46, 0x2d]);
});

test("por la entidad, con su nombre exacto: el MTPE sí, la Gerencia Regional de Trabajo de Arequipa no; Cuna Más registrado", async () => {
  const { adaptadorDe, adaptadorDePlaza, dominiosConAdaptador } = await import("../src/lib/empleoAdaptadores.js");
  const { conEnlace } = await import("../src/lib/empleoEnlaces.js");
  const mtpe = adaptadorDe("https://convocatoriasmtpe.trabajo.gob.pe/convocatorias/");
  assert.ok(mtpe);
  assert.equal(adaptadorDePlaza({ entidad: "MINIST. DE TRABAJO Y PROMOCION DEL EMPLEO", detalle_url: null }), mtpe);
  const arequipa = { entidad: "GERENCIA REGIONAL DE TRABAJO Y PROMOCION DEL EMPLEO DEL GOBIERNO REGIONAL DE AREQUIPA", detalle_url: "https://www.trabajoarequipa.gob.pe" };
  assert.notEqual(adaptadorDePlaza(arequipa), mtpe);
  assert.ok(dominiosConAdaptador().includes("extranet.cunamas.gob.pe"));
  // Sin enlace en SERVIR: el recolector las busca con el sitio conocido (si no, quedaban «sin web»).
  for (const entidad of ["MINIST. DE TRABAJO Y PROMOCION DEL EMPLEO", "SERVICIO NACIONAL DE AREAS NATURALES PROTEGIDAS POR EL ESTADO - SERNANP",
    "UNIDAD EJECUTORA 108 PROGRAMA NACIONAL DE INFRAESTRUCTURA EDUCATIVA", "PROGRAMA NACIONAL CUNA MAS"]) {
    assert.match(conEnlace({ entidad, detalle_url: null }).detalle_url ?? "", /^https?:\/\//, entidad);
  }
});
