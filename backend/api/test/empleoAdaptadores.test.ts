import test from "node:test";
import assert from "node:assert/strict";
import {
  ADAPTADORES, adaptadorDe, camposOcultos, celdas, dominioDe, fechaEs, hallazgo, nombreDeArchivo, numeroYAnio, parecidoEntidad, prioridadDocumento,
  regimenDe, textoPlano,
} from "../src/lib/empleoAdaptadores.js";
import { esDocumento, quizasPdf, urlDescarga } from "../src/lib/basesPlaza.js";
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
  assert.equal(adaptadorDe("https://www.gob.pe/mef"), null);
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
  const h = await ADAPTADORES["www.ins.gob.pe"](PLAZA, clienteHttp(5, s.f));
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
