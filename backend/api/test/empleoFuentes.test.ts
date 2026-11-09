import test from "node:test";
import assert from "node:assert/strict";
import {
  SIN_ENLACE, cambiosCronograma, correoDeOficina, eventoDeDocumento, fuenteDe, huellaEvento, intercalarPorDominio, soloEnlace, tipoDocumento, urlPrincipal,
} from "../src/lib/empleoFuentes.js";
import { agruparCobertura, sqlCandidatas } from "../src/lib/empleoRecolector.js";

test("la familia de cada enlace de SERVIR (docs/automatizacion_cas.md §4)", () => {
  const f = (u: string | null) => [fuenteDe(u).familia, fuenteDe(u).dominio, fuenteDe(u).estado, fuenteDe(u).adaptador];
  assert.deepEqual(f("https://www.gob.pe/institucion/mimp/colecciones/123-cas"), ["A", "www.gob.pe", "activa", "gob_pe"]);
  assert.deepEqual(f("https://aplicativo.pj.gob.pe/psep/wfrmConvocatoriasV.aspx?TCon=C"), ["B", "aplicativo.pj.gob.pe", "activa", "poder_judicial"]);
  assert.deepEqual(f("https://convocatorias.regionpiura.gob.pe/saludmorropon"), ["C", "convocatorias.regionpiura.gob.pe", "activa", "regional"]);
  assert.deepEqual(f("https://reddosdemayo.regionhuanuco.gob.pe/"), ["C", "reddosdemayo.regionhuanuco.gob.pe", "activa", "regional"]);
  assert.deepEqual(f("https://www.ugel07.gob.pe/proceso-de-contratacion/"), ["D", "www.ugel07.gob.pe", "activa", "generico"]);
  assert.deepEqual(f("https://www.facebook.com/GeresaLaLibertad"), ["E", "facebook.com", "solo_facebook", "ninguno"]);
  assert.deepEqual(f("https://drive.google.com/file/d/1Lef/view?usp=sharing"), ["F", "drive.google.com", "activa", "archivo"]);
  assert.deepEqual(f(null), ["G", SIN_ENLACE, "sin_web", "ninguno"]);
  assert.deepEqual(f("Ver en la web"), ["G", SIN_ENLACE, "sin_web", "ninguno"]);
  assert.deepEqual(f("https://www.servir.gob.pe/talento-peru/"), ["G", "www.servir.gob.pe", "sin_web", "ninguno"]);
  assert.deepEqual(f("https://portal.mpfn.gob.pe/convoca/convocatorias"), ["H", "portal.mpfn.gob.pe", "captcha", "ninguno"]);
  // El Poder Judicial y la DRELM bloquean a Cloudflare: salen por el relay de Lima.
  assert.equal(fuenteDe("https://aplicativo.pj.gob.pe/psep/").necesitaLima, true);
  assert.equal(fuenteDe("https://www.drelm.gob.pe/drelm/contratacion-de-personal/").necesitaLima, true);
  assert.equal(fuenteDe("https://www.gob.pe/mef").necesitaLima, false);
});

test("si SERVIR trae la web y el Facebook, vale la web", () => {
  assert.equal(urlPrincipal("https://www.munijauja.gob.pe/trabaja_nosotros.php https://www.facebook.com/munijauja"), "https://www.munijauja.gob.pe/trabaja_nosotros.php");
  assert.equal(urlPrincipal("https://www.facebook.com/UgelPangoa / https://ugelpangoa.gob.pe/"), "https://ugelpangoa.gob.pe/");
  assert.equal(fuenteDe("https://www.facebook.com/UgelPangoa / https://ugelpangoa.gob.pe/").familia, "D");
  assert.equal(urlPrincipal("https://www.facebook.com/x"), "https://www.facebook.com/x");
});

test("el tipo de documento: resultados antes que bases, «aviso de convocatoria» son las bases", () => {
  assert.equal(tipoDocumento("Bases del proceso CAS N° 108-2026"), "bases");
  assert.equal(tipoDocumento("Aviso de convocatoria CAS 012-2026"), "bases");
  assert.equal(tipoDocumento("Resultados de la evaluación curricular CAS 108-2026"), "resultado");
  assert.equal(tipoDocumento("Relación de postulantes aptos para la entrevista"), "resultado");
  assert.equal(tipoDocumento("Cuadro de méritos final"), "resultado");
  assert.equal(tipoDocumento("Comunicado N° 2: prórroga de la inscripción"), "comunicado");
  assert.equal(tipoDocumento("Fe de erratas"), "fe_erratas");
  assert.equal(tipoDocumento("Cronograma actualizado"), "cronograma");
  assert.equal(tipoDocumento("Anexo 02-A: declaración jurada"), "anexo");
  assert.equal(tipoDocumento("Perfil del puesto"), "perfil");
  assert.equal(tipoDocumento("Documento", "https://x.gob.pe/archivos/terminos%20de%20referencia.pdf"), "perfil");
  assert.equal(tipoDocumento("Ver aquí"), "otro");
});

test("de los resultados sólo el enlace (traen nombres y DNI); su evento es «resultado_etapa»", () => {
  assert.equal(soloEnlace("Resultados finales"), true);
  assert.equal(soloEnlace("Bases"), false);
  assert.equal(eventoDeDocumento("resultado"), "resultado_etapa");
  assert.equal(eventoDeDocumento("comunicado"), "comunicado");
  assert.equal(eventoDeDocumento("fe_erratas"), "comunicado");
  assert.equal(eventoDeDocumento("bases"), "documento_nuevo");
});

test("un cronograma que cambió de fecha, por etapa", () => {
  const antes = [{ etapa: "Presentación del expediente virtual", fecha: "19 de noviembre de 2026" }, { etapa: "Entrevista", fecha: "26 de noviembre" }];
  const ahora = [{ etapa: "Presentación del expediente  virtual", fecha: "21 de noviembre de 2026" }, { etapa: "Entrevista", fecha: "26 de noviembre" }];
  assert.deepEqual(cambiosCronograma(antes, ahora), [{ etapa: "Presentación del expediente  virtual", antes: "19 de noviembre de 2026", ahora: "21 de noviembre de 2026" }]);
  assert.deepEqual(cambiosCronograma(null, ahora), []);
  assert.deepEqual(cambiosCronograma(antes, antes), []);
});

test("la huella de un evento: el mismo hecho, la misma huella", () => {
  assert.equal(huellaEvento("cas:1", "comunicado", "u", "x"), huellaEvento("cas:1", "comunicado", "u", "x"));
  assert.notEqual(huellaEvento("cas:1", "comunicado", "u", "x"), huellaEvento("cas:2", "comunicado", "u", "x"));
});

test("de a una por sitio: nunca dos seguidas del mismo dominio si hay otro", () => {
  const xs = ["a1", "a2", "a3", "b1", "c1", "c2"];
  assert.deepEqual(intercalarPorDominio(xs, (x) => x[0]), ["a1", "b1", "c1", "a2", "c2", "a3"]);
  assert.deepEqual(intercalarPorDominio([], (x: string) => x), []);
});

test("la cobertura por fuente: plazas de 90 días, abiertas, con documentos y con lectura", () => {
  const c = agruparCobertura([
    { entidad: "UGEL 01", detalle_url: "https://www.gob.pe/institucion/ugel01/colecciones/1", abierta: true, bases_estado: "encontradas", con_lectura: true },
    { entidad: "MIMP", detalle_url: "https://www.gob.pe/institucion/mimp/colecciones/2", abierta: true, bases_estado: "no_encontradas", con_lectura: false },
    { entidad: "MIMP", detalle_url: "https://www.gob.pe/institucion/mimp/colecciones/2", abierta: false, bases_estado: null, con_lectura: false },
    { entidad: "PODER JUDICIAL", detalle_url: "https://aplicativo.pj.gob.pe/psep/", abierta: true, bases_estado: "error", con_lectura: false },
    { entidad: "CUNA MAS", detalle_url: null, abierta: true, bases_estado: null, con_lectura: false },
  ]);
  assert.deepEqual(c.map((x) => [x.dominio, x.familia, x.plazas_90d, x.abiertas, x.con_documentos, x.con_lectura, x.errores, x.entidades]), [
    ["www.gob.pe", "A", 3, 2, 1, 1, 0, ["MIMP", "UGEL 01"]],
    ["aplicativo.pj.gob.pe", "B", 1, 1, 0, 0, 1, ["PODER JUDICIAL"]],
    [SIN_ENLACE, "G", 1, 1, 0, 0, 0, ["CUNA MAS"]],
  ]);
});

test("las candidatas: abiertas, con la prioridad de quienes pagan y la condición de cada modo", () => {
  for (const modo of ["medir", "recolectar", "vigilar"] as const) {
    const q = sqlCandidatas(modo);
    assert.match(q, /s\.fecha_fin >= \(now\(\) AT TIME ZONE 'America\/Lima'\)::date/);
    assert.match(q, /producto = 'empleo' AND estado = 'activa'/);
    assert.match(q, /WHEN g\.de_pagador THEN 3/);
  }
  assert.match(sqlCandidatas("medir"), /r\.bases_estado IS NULL AND \(COALESCE\(\(r\.bases->>'intentos'\)::int, 0\) = 0[\s\S]+ORDER BY prioridad DESC, random\(\)/);
  // Una plaza que tumbó el Worker espera 2, 4, 8… horas (marcarIntento).
  assert.match(sqlCandidatas("recolectar"), /interval '1 hour' \* power\(2, least\(COALESCE\(\(r\.bases->>'intentos'\)::int, 0\), 7\)\)/);
  assert.match(sqlCandidatas("vigilar"), /g\.ref IS NOT NULL AND r\.bases_estado = 'encontradas'/);
});

test("el correo de oficina se muestra entero; el de una persona, no", () => {
  for (const c of ["seleccion@indecopi.gob.pe", "convocatoriaspracticantes_lima@sunarp.gob.pe", "convocatorias_moyob@sunarp.gob.pe", "rrhh@unsa.edu.pe", "mesadepartes@minsa.gob.pe"]) {
    assert.equal(correoDeOficina(c), true, c);
  }
  for (const c of ["nancy.narvaez@ugel02.gob.pe", "lcastillo@minedu.gob.pe", "seleccion@gmail.com", null, ""]) {
    assert.equal(correoDeOficina(c), false, String(c));
  }
});
