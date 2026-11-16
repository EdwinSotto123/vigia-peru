/**
 * /transparencia (página /metricas): las piezas puras que arman la respuesta pública. Lo que importa: que una nota con
 * algo que no se publica se descarte entera, que las métricas se lean de `metricas` por nombre (no se pasa el JSON
 * crudo) y que el analista legal quede dentro de su red.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { armarAgentes, armarRagSerie, nombreRed, notaPublica, parteDe } from "../src/routes/transparencia.js";

const corrida = (x: Record<string, unknown>) => ({
  conjunto: "bienes", nombre: "Bienes", queMide: "banderas", casos: 30, variante: "abierto", imagen: "7a29deb4-sdk", fecha: "2026-11-15 20:44",
  contratos: 30, errores: 0, precision: 94.6, exhaustividad: 98.1, f1: 0.964, usdMedio: 0.2079, segundosMedio: 251.7, metricas: {}, nota: null, ...x,
}) as Parameters<typeof armarAgentes>[0][number];

test("notaPublica: deja pasar una nota de cambios y descarta lo que no se publica", () => {
  assert.equal(notaPublica("RAG normativo v2 activado (LEGAL_RAG_BACKEND=vigia)"), "RAG normativo v2 activado (LEGAL_RAG_BACKEND=vigia)");
  assert.equal(notaPublica("  corpus con 1 005 opiniones\n y búsqueda en dos pasadas "), "corpus con 1 005 opiniones y búsqueda en dos pasadas");
  assert.equal(notaPublica("corrida 20261115-204424 con la imagen 7a29deb4-sdk"), "corrida 20261115-204424 con la imagen 7a29deb4-sdk");
  for (const mala of [
    "se cambió la Lambda de evaluación", "arn:aws:iam::123456789012:role/x", "función vigia-agente-bienes-eval", "con el token nuevo",
    "revisado el caso del DNI 45678912", "proveedor 20123456789 repetido", "",
  ]) assert.equal(notaPublica(mala), null, mala);
  assert.equal(notaPublica(null), null);
  assert.equal(notaPublica("x".repeat(400))?.length, 240);
});

test("parteDe: lee «123 de 584 (21.1 %)» y nada más", () => {
  assert.deepEqual(parteDe("123 de 584 (21.1 %)"), { n: 123, de: 584 });
  assert.deepEqual(parteDe("0 de 727 (0.0 %)"), { n: 0, de: 727 });
  assert.equal(parteDe("0 de 0"), null);
  assert.equal(parteDe(0.21), null);
  assert.equal(parteDe("sin dato"), null);
});

test("armarAgentes: cada red con su última corrida y su serie; el legal, dentro de su red y con sus citas", () => {
  const r = armarAgentes([
    corrida({ fecha: "2026-11-14 19:28", imagen: "d15d0633-sdk", f1: 0.955, nota: "con la Lambda vieja" }),
    corrida({}),
    corrida({ conjunto: "legal", nombre: "Analista legal", queMide: "citas_legales", variante: "bienes", f1: 1, precision: 100, exhaustividad: 100,
              metricas: { red: "bienes", citas: { ok: 102, total: 106, no_existe: 0, otro_regimen: 4 }, interno: "no se publica" } }),
    corrida({ conjunto: "rag_normas", nombre: "RAG normativo", queMide: "recuperacion", fecha: "2026-11-16 09:00", imagen: "vigia_normas" }),
  ]);
  assert.equal(r.redes.length, 1);
  assert.equal(r.redes[0].clave, "bienes");
  assert.equal(r.redes[0].corridas, 2);
  assert.equal(r.redes[0].ultima.version, "7a29deb4-sdk");
  assert.equal(r.redes[0].serie[0].nota, null);            // nombraba una función de la nube
  assert.deepEqual(r.legal[0].ultima.citas, { total: 106, ok: 102, otroRegimen: 4, noExiste: 0 });
  assert.ok(!JSON.stringify(r).includes("no se publica"));
  // La fecha del bloque es la de las pruebas de oro, no la de una evaluación del RAG.
  assert.equal(r.fecha, "2026-11-15 20:44");
  assert.equal(r.desde, "2026-11-14 19:28");
});

test("armarRagSerie: sólo las evaluaciones del buscador, con sus tasas por nombre", () => {
  const s = armarRagSerie([
    corrida({}),
    corrida({ conjunto: "rag_normas", imagen: "vigia_normas", contratos: 91, fecha: "2026-11-15 12:31",
              metricas: { MRR: 0.771, "acierto@8": 0.945, "acierto@10": 0.989, preguntas: 91, norma_primero: 1, regimen_equivocado: "0 de 727 (0.0 %)" } }),
    corrida({ conjunto: "rag_normas", imagen: "chroma", contratos: 73, metricas: { MRR: 0.68, "acierto@8": 0.877, norma_primero: 0.795, regimen_equivocado: "123 de 584 (21.1 %)" } }),
  ]);
  assert.equal(s.length, 2);
  assert.deepEqual(s[0], { fecha: "2026-11-15 12:31", sistema: "vigia_normas", preguntas: 91, acierto8: 0.945, acierto10: 0.989, mrr: 0.771, normaPrimero: 1,
                           regimenEquivocado: { n: 0, de: 727 }, nota: null });
  assert.equal(s[1].acierto10, null);                       // no se midió: no se inventa
  assert.equal(s[1].preguntas, 73);
});

test("nombreRed: las redes conocidas, y un nombre neutro para lo demás", () => {
  assert.equal(nombreRed("consultoria"), "Consultoría");
  assert.equal(nombreRed(null), "Sin red registrada");
  assert.equal(nombreRed("algo_nuevo"), "Otra red");
});
