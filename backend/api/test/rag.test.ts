import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

process.env.PRIVACIDAD_CLAVE = "clave-de-prueba-de-32-caracteres-o-mas";

import {
  ErrorBusqueda, LIMITE_DEFECTO, TROCEO, esSelloFirma, esTitulo, fusionarRrf, huellaLinea, normalizarLinea, partirLargo, quitarCasiIguales,
  recorte, terminos, textoDeInforme, textoDeLectura, tituloFragmento, trocear, validarBusqueda,
} from "../src/lib/ragTexto.js";
import { embeberPartiendo, entradaModelo, gruposDe, lotesPorLargo, sqlCandidatos, vectorLiteral } from "../src/lib/rag.js";
import { publicar } from "../src/lib/privacidad.js";

// RAG de documentos (migración 258, lib/rag.ts y lib/ragTexto.ts): troceo, fusión, validación y lo que se tapa.

const MIGRACION = readFileSync(new URL("../../db/migrations/258_rag_documentos.sql", import.meta.url), "utf8");

const parrafo = (n: number, palabra = "texto") => Array.from({ length: n }, (_, i) => `${palabra} ${i} del documento con contenido propio.`).join(" ");

test("troceo: página de cada trozo, tamaños dentro del tope y nada se pierde", () => {
  const paginas = Array.from({ length: 12 }, (_, i) => `⟦p.${i + 1}⟧\n${parrafo(40, `pagina${i + 1}`)}`).join("\n");
  const trozos = trocear(paginas);
  assert.ok(trozos.length >= 5, `se esperaban varios trozos, salieron ${trozos.length}`);
  for (const t of trozos) {
    assert.ok(t.texto.length <= TROCEO.maximo, `trozo de ${t.texto.length} caracteres`);
    assert.ok(!t.texto.includes("⟦"), "las marcas de página no quedan en el texto");
    assert.ok(t.pagina !== null && t.pagina >= 1 && t.pagina <= 12);
  }
  assert.deepEqual(trozos.map((t) => t.orden), trozos.map((_, i) => i));
  // Un párrafo corto y después una línea larguísima (texto sin saltos): ningún trozo pasa el tope.
  const raro = trocear(`${parrafo(60)}

${"palabra ".repeat(120)}
${"x".repeat(5000)} fin
${parrafo(30)}`);
  for (const t of raro) assert.ok(t.texto.length <= TROCEO.maximo + 1, `trozo de ${t.texto.length} caracteres`);
  // La página es la de la primera línea nueva del trozo: crece (o se repite) a lo largo del documento.
  for (let i = 1; i < trozos.length; i++) assert.ok(trozos[i]!.pagina! >= trozos[i - 1]!.pagina!);
  // Cada página aparece en algún trozo.
  for (let p = 1; p <= 12; p++) assert.ok(trozos.some((t) => t.texto.includes(`pagina${p} 0 `)), `falta la página ${p}`);
  // El solape: el comienzo de un trozo repite el final del anterior cuando el corte parte un párrafo.
  const conSolape = trozos.slice(1).filter((t, i) => trozos[i]!.texto.endsWith(t.texto.split("\n")[0]!));
  assert.ok(conSolape.length >= 1, "algún trozo arranca con el final del anterior");
});

test("troceo: un título abre trozo, un archivo nuevo corta sin solape y un final chico se suma al anterior", () => {
  const largo = parrafo(30, "antes");
  const texto = [
    "⟦archivo: Bases Integradas/bases.pdf⟧", "⟦p.1⟧", largo, largo,
    "3.2. REQUISITOS DE CALIFICACIÓN", "B. EXPERIENCIA DEL POSTOR EN LA ESPECIALIDAD", "El postor debe acreditar S/ 500,000.00 en eventos.",
    "⟦archivo: Documentos de Otorgamiento de Buena Pro/acta.pdf⟧", "⟦p.1⟧", parrafo(20, "acta"),
  ].join("\n");
  const trozos = trocear(texto);
  const requisitos = trozos.find((t) => t.texto.includes("REQUISITOS DE CALIFICACIÓN"))!;
  assert.ok(requisitos.texto.startsWith("3.2. REQUISITOS DE CALIFICACIÓN"), "el título encabeza su trozo");
  const acta = trozos.filter((t) => t.archivo?.includes("acta.pdf"));
  assert.ok(acta.length >= 1);
  assert.ok(!acta[0]!.texto.includes("antes "), "un archivo nuevo no arrastra texto del anterior");
  assert.ok(trozos.filter((t) => t.archivo?.includes("bases.pdf")).every((t) => !t.texto.includes("acta 0")));
  assert.ok(esTitulo("CLÁUSULA DÉCIMA: PENALIDADES"));
  assert.ok(esTitulo("## Qué encontró Vigía"));
  assert.ok(!esTitulo("El postor debe acreditar un monto facturado acumulado equivalente a S/ 500,000.00"));
  // Un final chico (menos de TROCEO.minimo) se suma al trozo anterior.
  const corto = trocear(`${parrafo(70)}\nfin corto`);
  assert.ok(corto[corto.length - 1]!.texto.endsWith("fin corto"));
  assert.ok(!corto.some((t) => t.texto === "fin corto"));
});

test("troceo: salta las líneas del modelo estándar (misma huella que la migración) y nunca parte un número", () => {
  const comun = "Cuando se resuelva el contrato por causas imputables a algunas de las partes se debe resarcir los daños";
  const propio = "La Municipalidad Distrital de Ate requiere el servicio de organización de eventos culturales";
  const trozos = trocear(`${comun}\n${propio}`, { comunes: new Set([huellaLinea(comun)!]) });
  assert.equal(trozos.length, 1);
  assert.ok(!trozos[0]!.texto.includes("resarcir"));
  assert.ok(trozos[0]!.texto.includes("eventos culturales"));
  // La huella: md5 de la línea en minúsculas, sin tildes y con sólo letras y cifras (la cuenta de rag_refrescar_lineas).
  assert.equal(normalizarLinea("  CLÁUSULA Décima — PENALIDADES (Ñandú) 2026  "), "clausula decima penalidades nandu 2026");
  assert.equal(huellaLinea("Corta"), null, "las líneas cortas (títulos) no tienen huella: se quedan siempre");
  assert.equal(huellaLinea(comun), createHash("md5").update(normalizarLinea(comun)).digest("hex"));
  assert.match(MIGRACION, /translate\(lower\(l\), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun'\), '\[\^a-z0-9\]\+', ' ', 'g'\)\)/);
  assert.match(MIGRACION, /length\(x\.n\) >= 40/);
  // Una tira larga sin espacios no se corta entre dos cifras (un DNI partido no se reconocería al taparlo).
  const tira = `${"x".repeat(95)}4396088012345`;
  const pedazos = partirLargo(tira, 100);
  assert.equal(pedazos.join(""), tira);
  assert.ok(pedazos[0]!.length <= 100 && !/\d$/.test(pedazos[0]!), "el corte cae antes de los dígitos");
});

test("troceo: sin el sello de la firma digital (y el nombre de la línea siguiente)", () => {
  const texto = ["CLÁUSULA DÉCIMA: PENALIDADES", "La penalidad por mora se calcula con la fórmula del reglamento.",
    "Firmado digitalmente por:", "PEREZ QUISPE Juan Carlos", "FAU 20131378972 soft", "Motivo: Soy el autor del documento",
    "Fecha: 2025/09/12 18:01:44", "El contratista entrega en 30 días calendario."].join("\n");
  const [t] = trocear(texto);
  assert.ok(t!.texto.includes("penalidad por mora") && t!.texto.includes("30 días calendario"));
  for (const fuera of ["Firmado", "PEREZ", "FAU", "Soy el autor", "2025/09/12"]) assert.ok(!t!.texto.includes(fuera), `quedó «${fuera}»`);
  assert.ok(esSelloFirma("Firmado digitalmente por: GONZALES Rosario FIR 41234567 hard"));
  assert.ok(!esSelloFirma("El comité verificó que la oferta estaba firmada digitalmente por el representante legal, como exigen las bases, y por eso la admitió."));
});

test("tsv: la expresión de la migración es la misma que arma la consulta (español, minúsculas, sin tildes)", () => {
  assert.match(MIGRACION, /to_tsvector\('spanish'::regconfig,\s*translate\(lower\(coalesce\(titulo, ''\) \|\| ' ' \|\| texto\), 'áéíóúüñ', 'aeiouun'\)\)/);
  const { sql } = sqlCandidatos(validarBusqueda((k) => ({ q: "experiencia en eventos" } as Record<string, string>)[k]), "[0.1]", 40);
  assert.match(sql, /websearch_to_tsquery\('spanish', translate\(lower\(\$1\), 'áéíóúüñ', 'aeiouun'\)\)/);
  assert.match(sql, /to_tsvector\('spanish', translate\(lower\(\$1\), 'áéíóúüñ', 'aeiouun'\)\)/);
  assert.match(MIGRACION, /USING hnsw \(embedding halfvec_cosine_ops\)/);
  assert.match(MIGRACION, /embedding\s+halfvec\(1024\)/);
});

test("validarBusqueda: parámetros cerrados, entidades sin personas y mensajes claros", () => {
  const de = (p: Record<string, string | string[]>) => validarBusqueda(
    (k) => { const v = p[k]; return Array.isArray(v) ? v[0] : v; },
    (k) => { const v = p[k]; return Array.isArray(v) ? v : v ? [v] : []; }, 2026);
  const ok = de({ q: "  ¿Qué exigían   las bases? ", ocid: ["OECE-1228227", "ocds-dgv273-seacev3-1226246,1226246"], entidad: "20131378972",
    tipo: "bases,BUENA_PRO", origen: "documento", desde: "2024", hasta: "2026-06-30", limite: "5" });
  assert.equal(ok.q, "¿Qué exigían las bases?");
  assert.deepEqual(ok.ocids, ["1228227", "1226246"]);
  assert.deepEqual(ok.tipos, ["bases", "buena_pro"]);
  assert.equal(ok.desde, 2024);
  assert.equal(ok.hasta, 2026);
  assert.equal(ok.limite, 5);
  assert.equal(de({ q: "marca" }).limite, LIMITE_DEFECTO);
  const falla = (p: Record<string, string | string[]>, re: RegExp) => assert.throws(() => de(p), (e: unknown) => e instanceof ErrorBusqueda && re.test(e.message));
  falla({}, /Falta q/);
  falla({ q: "ab" }, /Falta q/);
  falla({ q: "?!¿¡..." }, /palabras/);
  falla({ q: "x".repeat(301) }, /300/);
  falla({ q: "bases", entidad: "10439608801" }, /entidad/);
  falla({ q: "bases", entidad: "2013137897" }, /entidad/);
  falla({ q: "bases", tipo: "bases,planilla" }, /«planilla» no existe/);
  falla({ q: "bases", origen: "dni" }, /«dni» no existe/);
  falla({ q: "bases", desde: "1990" }, /desde/);
  falla({ q: "bases", desde: "2026", hasta: "2024" }, /mayor/);
  falla({ q: "bases", limite: "50" }, /limite/);
  falla({ q: "bases", ocid: "1228227;DROP" }, /ocid/);
  falla({ q: "bases", ocid: Array.from({ length: 21 }, (_, i) => String(1000 + i)) }, /hasta 20/);
});

test("sqlCandidatos: los mismos filtros en las dos búsquedas y ningún valor dentro del SQL", () => {
  const b = validarBusqueda((k) => ({ q: "experiencia en eventos'; DROP TABLE x;--", entidad: "20131378972", tipo: "bases", desde: "2024" } as Record<string, string>)[k]);
  const { sql, vals } = sqlCandidatos(b, "[0.5,0.25]", 40);
  assert.ok(!sql.includes("DROP") && !sql.includes("20131378972") && !sql.includes("0.25"), "los valores van como parámetros");
  assert.equal(vals[0], b.q);
  assert.equal((sql.match(/f\.entidad_ruc = \$3/g) ?? []).length, 2, "el filtro de entidad en las dos ramas");
  assert.equal((sql.match(/f\.tipo = ANY\(\$4::text\[\]\)/g) ?? []).length, 2);
  assert.equal((sql.match(/f\.anio >= \$5/g) ?? []).length, 2);
  assert.match(sql, /ORDER BY f\.embedding <=> \$2::halfvec LIMIT \$6/, "la rama de significado ordena por distancia (usa el HNSW)");
  assert.match(sql, /alerta_publicada\(a\.estado\)/, "un dictamen sólo sale si su alerta sigue publicada");
  assert.match(sql, /WHERE f\.tsv @@ \(SELECT CASE WHEN count\(\*\) >= 3/, "con 3 palabras o más, al menos dos tienen que estar");
  assert.ok(sql.includes("quote_literal(a.l) || ' & ' || quote_literal(b.l)"));
  const soloTexto = sqlCandidatos(b, null, 40);
  assert.ok(!soloTexto.sql.includes("sentido AS"), "sin embedding de la pregunta, sólo texto");
  assert.ok(!soloTexto.vals.includes("[0.5,0.25]"));
});

test("fusionarRrf: suma 1/(60+puesto) de cada lista; lo que está arriba en las dos gana", () => {
  const f = fusionarRrf([
    { id: "solo-texto-1", posTexto: 1, posSentido: null },
    { id: "ambas", posTexto: 3, posSentido: 2 },
    { id: "solo-sentido-1", posTexto: null, posSentido: 1 },
    { id: "lejos", posTexto: 30, posSentido: 40 },
  ]);
  assert.deepEqual(f.map((x) => x.id), ["ambas", "lejos", "solo-sentido-1", "solo-texto-1"]);
  assert.equal(f[0]!.puntaje, 1 / 63 + 1 / 62);
  // Empate de puntaje: gana el de mejor puesto.
  const e = fusionarRrf([{ id: "b", posTexto: null, posSentido: 2 }, { id: "a", posTexto: 2, posSentido: null }]);
  assert.equal(e[0]!.puntaje, e[1]!.puntaje);
  assert.equal(e[0]!.id, "a");
});

test("quitarCasiIguales: las bases administrativas y las integradas no ocupan dos lugares", () => {
  const base = parrafo(30, "requisito");
  const lista = quitarCasiIguales([
    { id: 1, texto: base },
    { id: 2, texto: `${base} Integradas: se precisa el numeral 3.` },
    { id: 3, texto: parrafo(30, "penalidad") },
  ]);
  assert.deepEqual(lista.map((x) => x.id), [1, 3]);
  // Hasta `porFuente` trozos de una misma fuente, y hasta `max` en total.
  const variados = quitarCasiIguales(Array.from({ length: 6 }, (_, i) => ({ id: i, fuente: i < 4 ? "dictamen|a" : `documento|${i}`, texto: parrafo(10, `t${i}x`) })), 0.7, 5, 3);
  assert.deepEqual(variados.map((x) => x.id), [0, 1, 2, 4, 5]);
});

test("recorte: la ventana con las palabras buscadas, en líneas enteras y sin partir números", () => {
  const lineas = [...Array.from({ length: 40 }, (_, i) => `línea de relleno ${i} sin nada que ver con la consulta`),
    "B. EXPERIENCIA DEL POSTOR: servicios de organización de eventos por S/ 300,000.00",
    ...Array.from({ length: 40 }, (_, i) => `otra línea ${i} sin relación alguna con lo pedido`)];
  const r = recorte(lineas.join("\n"), terminos("¿Qué experiencia en eventos pidieron?"), 400);
  assert.ok(r.length <= 402);
  assert.ok(r.includes("organización de eventos"));
  assert.ok(r.startsWith("…"));
  assert.deepEqual(terminos("¿Qué exigían las bases del proceso?"), ["exigi", "bases"]);
  const corto = "texto corto";
  assert.equal(recorte(corto, ["texto"], 400), corto);
  const tira = `${"a".repeat(390)}12345678${"b".repeat(50)}`;
  assert.ok(!/\d$/.test(recorte(tira, [], 395).replace(/…$/, "")), "no corta dentro del número");
});

test("textoDeLectura: el acta, las bases, el pliego y el contrato como texto que se puede buscar", () => {
  const acta = textoDeLectura("buena_pro", {
    procedimiento: "AS-SM-12-2025-MDA-1", objeto: "Servicio de eventos", valor_referencial: 120000, n_miembros_comite: 3, confianza: "alta",
    postores: [
      { nombre: "EVENTOS DEL SUR S.A.C.", ruc: "20123456789", ganador: true, puntaje: 95, monto_ofertado: 118000 },
      { nombre: "OTRA EMPRESA S.R.L.", ruc: "20987654321", ganador: false, admitida: false, motivo_tipo: "formalidad", motivo_fuera: "No presentó la declaración jurada del anexo 3." },
    ],
    observaciones: [{ tipo: "requisito_restrictivo", explicacion: "Se descalificó por un anexo.", cita: "no cumple con el anexo 3" }],
  }, ["descalificados_por_formalidad"]);
  assert.match(acta, /acta de otorgamiento de la buena pro, confianza alta/);
  assert.match(acta, /EVENTOS DEL SUR S\.A\.C\. \(RUC 20123456789\): ganó la buena pro\. Puntaje: 95\. Oferta: S\/ 118,000\./);
  assert.match(acta, /su oferta no fue admitida\. Motivo \(formalidad\): No presentó la declaración jurada/);
  assert.match(acta, /Cita: «no cumple con el anexo 3»/);
  assert.match(acta, /Banderas de Vigía: descalificados por formalidad\./);
  const bases = textoDeLectura("bases", {
    objeto: "Eventos", experiencia_postor: { monto_minimo: 300000, anios: 8, especialidad: "organización de eventos", cita: "monto facturado" },
    personal_clave: [{ cargo: "Productor", experiencia_anios: 3 }], equipamiento: ["Sonido de 5 000 W"],
    factores_evaluacion: [{ factor: "Precio", puntaje: 100 }], marcas: [{ marca: "Yamaha", con_equivalente: false, cita: "parlantes Yamaha" }],
  });
  assert.match(bases, /Experiencia del postor en la especialidad: monto facturado mínimo S\/ 300,000 en los últimos 8 años en organización de eventos\./);
  assert.match(bases, /Personal clave exigido: Productor \(3 años de experiencia\)\./);
  assert.match(bases, /- Yamaha: sin «o equivalente»\. Cita: «parlantes Yamaha»\./);
  const pliego = textoDeLectura("consultas", { n_consultas: 4, n_participantes: 2, observaciones: [{ tema: "requisitos", respuesta: "no_acogida", resumen: "Pidieron bajar la experiencia." }], denuncias: [] });
  assert.match(pliego, /4 consultas u observaciones de 2 participantes\./);
  assert.match(pliego, /- requisitos \(no acogida\): Pidieron bajar la experiencia\./);
  const contrato = textoDeLectura("contrato", { numero_contrato: "015-2025", monto_contratado: 118000, moneda: "PEN", plazo_dias: 30, contratista: { nombre: "EVENTOS DEL SUR S.A.C.", ruc: "20123456789" }, garantia_fiel_cumplimiento: { tipo: "carta_fianza", porcentaje: 10 } });
  assert.match(contrato, /Contrato N° 015-2025\. .*Monto contratado: S\/ 118,000\. Plazo: 30 días\./);
  assert.match(contrato, /Garantía de fiel cumplimiento: carta fianza 10 %\./);
  assert.ok(!textoDeLectura("bases", null).includes("undefined"));
  const informe = textoDeInforme({ numero: "024-2026-2-0829", modalidad: "AUDITORIA CUMPLIMIENTO", titulo: "Contratación de eventos", entidad_nombre: "MUNICIPALIDAD DISTRITAL DE ATE", responsabilidades: ["administrativa_entidad", "penal"], funcionarios: 3, fecha_emision: "2026-10-22" });
  assert.match(informe, /Informe de control N° 024-2026-2-0829 .*\(auditoria cumplimiento\) emitido el 2026-10-22\./);
  assert.match(informe, /Responsabilidades señaladas: administrativa entidad, penal \(3 funcionarios comprendidos\)\./);
  assert.equal(tituloFragmento({ tipo: "bases", documento: "Bases Integradas", archivo: "Bases Integradas/BASES.pdf", ocid: "1228227", objeto: "SERVICIO DE EVENTOS" }),
    "Bases — Bases Integradas — Bases Integradas/BASES.pdf — proceso 1228227: SERVICIO DE EVENTOS");
});

test("embeddings: lotes por largo dentro del tope de Workers AI y vectores en texto para halfvec", () => {
  const items = Array.from({ length: 100 }, (_, i) => ({ entrada: "x".repeat(100 + i * 35) }));
  const lotes = lotesPorLargo(items);
  assert.equal(lotes.flat().length, 100);
  for (const l of lotes) {
    assert.ok(l.length <= 32);
    const tokens = l.length * (Math.ceil(Math.max(...l.map((x) => x.entrada.length)) / 2) + 16);
    assert.ok(tokens <= 36_000, `lote de ${tokens} tokens con relleno`);
    for (let i = 1; i < l.length; i++) assert.ok(l[i]!.entrada.length >= l[i - 1]!.entrada.length, "ordenados por largo");
  }
  assert.equal(vectorLiteral([0.0123456, -1, Number.NaN, 1e-9]), "[0.01235,-1,0,1e-9]");
  // Las fuentes se guardan por grupos de un mismo origen: de a 100 las chicas, de a 4 los documentos.
  const pend = [...Array.from({ length: 150 }, () => ({ origen: "lectura" })), ...Array.from({ length: 9 }, () => ({ origen: "documento" })), { origen: "dictamen" }];
  assert.deepEqual(gruposDe(pend).map((g) => `${g[0]!.origen}:${g.length}`), ["lectura:100", "lectura:50", "documento:4", "documento:4", "documento:1", "dictamen:1"]);
  assert.equal(entradaModelo("Bases — proceso 1", "texto"), "Bases — proceso 1\n\ntexto");
  assert.equal(entradaModelo(null, "texto"), "texto");
});

test("embeberPartiendo: un lote que pasa el contexto del modelo se parte en dos hasta que entra", async () => {
  const pedidos: number[] = [];
  const ia = {
    run: async (_m: string, e: Record<string, unknown>) => {
      const textos = e.text as string[];
      pedidos.push(textos.length);
      if (textos.length > 3) throw new Error("8007: Max context reached 60570 tokens but model supports only 60000");
      return { shape: [textos.length, 1024], data: textos.map((t) => Array.from({ length: 1024 }, () => t.length)) };
    },
  };
  let contados = 0;
  const v = await embeberPartiendo(ia, ["a", "bb", "ccc", "dddd", "eeeee", "ffffff", "g"], () => { contados++; });
  assert.deepEqual(v.map((x) => x[0]), [1, 2, 3, 4, 5, 6, 1], "mismo orden que la entrada");
  assert.deepEqual(pedidos, [7, 4, 2, 2, 3]);
  assert.equal(contados, 5);
  await assert.rejects(embeberPartiendo({ run: async () => { throw new Error("401 sin permiso"); } }, ["a", "b"]), /401/);
  await assert.rejects(embeberPartiendo({ run: async () => ({ data: [[1, 2]] }) }, ["a"]), /otra forma/);
});

test("lo que sale: publicar tapa DNI, RUC 10, correos, celulares y los nombres que Vigía conoce del proceso", () => {
  const respuesta = {
    q: "comité",
    resultados: [{
      fragmento_id: "1", ocid: "1228227", entidad_ruc: "20131378972",
      url: "https://prod2.seace.gob.pe/documento?id=1",
      texto: "Postor: QUISPE MAMANI ROSA con RUC 10439608801, DNI 43960880, correo rosa.quispe@gmail.com, celular 987 654 321. " +
        "El comité presidido por PEREZ ROJAS JUAN (DNI 41234567) otorgó la buena pro a EVENTOS DEL SUR S.A.C. (RUC 20123456789) " +
        "por S/ 12345678.00. Firmado digitalmente por: CHAVEZ RIOS Maria Elena FIR 41234568 hard.",
    }],
  };
  const extra = { postoresDetalle: [{ razonSocial: "QUISPE MAMANI ROSA", ruc: "10439608801" }, { razonSocial: "EVENTOS DEL SUR S.A.C.", ruc: "20123456789" }] };
  const out = publicar(respuesta, { extra });
  const t = out.resultados[0]!.texto;
  for (const prohibido of ["10439608801", "43960880", "41234567", "41234568", "rosa.quispe@", "987 654 321", "MAMANI", "ROJAS JUAN", "CHAVEZ RIOS Maria"]) {
    assert.ok(!t.includes(prohibido), `quedó «${prohibido}» en: ${t}`);
  }
  assert.ok(t.includes("20123456789") && t.includes("EVENTOS DEL SUR S.A.C."), "las empresas y su RUC 20 se ven");
  assert.ok(t.includes("S/ 12345678.00"), "un monto no es un DNI");
  assert.equal(out.resultados[0]!.entidad_ruc, "20131378972");
  assert.equal(out.resultados[0]!.ocid, "1228227");
});
