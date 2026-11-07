import test from "node:test";
import assert from "node:assert/strict";
import { leerMonto, normalizarUrl, revisarRespuesta } from "../src/lib/revisionChat.js";

// La revisión automática de las respuestas del chat del admin (2026-11-07): enlaces y montos contra lo consultado.

const ORDENES = JSON.stringify({
  compras: [
    { via: "directa", fecha: "2023-07-07", monto_soles: 9960, orden: "O/S-1963-2023-SUBGERENCIA DE ABASTECIMIENTO",
      proveedor_ruc: "20521547406", enlace: "https://vigia.gobserva.cloud/entidad/20131378620?seccion=contratos&cq=1963&canio=2023" },
    { via: "proceso", fecha: "2025-03-01", monto_soles: 280461.2, ocid: "1224181", enlace: "https://vigia.gobserva.cloud/app/contratos/1224181" },
  ],
  por_anio: [{ anio: 2023, monto: 5370000, ordenes: 41 }],
  fuente: "OECE, CONOSCE (https://conosce.oece.gob.pe/buscador/)",
});

test("leerMonto: los formatos que escribe el chat", () => {
  assert.deepEqual(leerMonto("489,309.75"), { valor: 489309.75, tol: 0.005 + 0.005 });
  assert.equal(leerMonto("38 140")!.valor, 38140);
  assert.equal(leerMonto("38 140")!.tol, 1);
  assert.equal(leerMonto("1.2", "millones")!.valor, 1_200_000);
  assert.ok(Math.abs(leerMonto("1.2", "millones")!.tol - 50_000) < 1);
  assert.equal(leerMonto("280", "mil")!.valor, 280_000);
  assert.equal(leerMonto("16.634.817,25")!.valor, 16634817.25);
  assert.equal(leerMonto("5,37")!.valor, 5.37);
});

test("normalizarUrl: misma dirección aunque cambie el orden de la consulta o la barra final", () => {
  assert.equal(
    normalizarUrl("https://vigia.gobserva.cloud/entidad/20131378620?canio=2023&cq=1963&seccion=contratos."),
    normalizarUrl("https://VIGIA.gobserva.cloud/entidad/20131378620/?seccion=contratos&cq=1963&canio=2023"),
  );
});

test("enlaces: de una consulta, armados con un ID consultado, inventados y RUC 10", () => {
  const r = revisarRespuesta(
    [
      "- [O/S-1963-2023](https://vigia.gobserva.cloud/entidad/20131378620?cq=1963&seccion=contratos&canio=2023)",
      "- [Proceso](https://vigia.gobserva.cloud/app/contratos/1224181) y la [empresa](https://vigia.gobserva.cloud/empresa/20521547406)",
      "- [Otra orden](https://vigia.gobserva.cloud/entidad/20131378620?seccion=contratos&cq=7777&canio=2024)",
      "- [Persona](https://vigia.gobserva.cloud/empresa/10456789012)",
      "- [Fuente](https://conosce.oece.gob.pe/buscador/) y [un PDF inventado](https://www.contraloria.gob.pe/informe-falso.pdf)",
      "- [Glosario](https://vigia.gobserva.cloud/glosario)",
    ].join("\n"),
    [ORDENES],
  );
  assert.equal(r.enlaces.total, 8);
  assert.equal(r.enlaces.ok, 5); // la orden, el proceso, la empresa y la fuente salen de los datos; el glosario es una página general
  assert.deepEqual(r.enlaces.dudosos.map((d) => d.texto), ["Otra orden", "Persona", "un PDF inventado"]);
  assert.match(r.enlaces.dudosos[0].motivo, /orden 7777/);
  assert.match(r.enlaces.dudosos[1].motivo, /RUC 10/);
});

test("montos: en los datos, redondeados, en millones, total de tabla y de una respuesta anterior", () => {
  const respuesta = [
    "En 2023 hubo S/ 5.37 millones en 41 órdenes; la mayor, S/ 280,461 (redondeada).",
    "",
    "### Órdenes de 2023",
    "| Orden | Monto (S/) | Año |",
    "|---|---:|---|",
    "| O/S-1963 | 9,960.00 | 2023 |",
    "| Proceso 1224181 | 280,461.20 | 2025 |",
    "| **Total** | **290,421.20** | |",
    "",
    "Entre las dos suman S/ 290,421.20. Antes te dije S/ 12,345.00 y ahora agrego S/ 99,999.99, que no está en ningún lado.",
  ].join("\n");
  const r = revisarRespuesta(respuesta, [ORDENES], ["Pregunta", "La respuesta anterior hablaba de S/ 12,345.00."]);
  assert.equal(r.montos.total, 8);
  assert.equal(r.montos.ok, 4); // 5.37 M, 280,461, 9,960.00, 280,461.20
  assert.equal(r.montos.sumas, 2); // el total de la tabla y la misma cifra en el texto
  assert.equal(r.montos.anteriores, 1);
  assert.deepEqual(r.montos.dudosos.map((d) => d.texto), ["S/ 99,999.99"]);
  assert.match(r.montos.dudosos[0].contexto!, /no está en ningún lado/);
});

test("montos: un total de tabla que no da la suma queda por revisar", () => {
  const r = revisarRespuesta(
    ["| Orden | Monto (S/) |", "|---|---|", "| A | 9,960.00 |", "| B | 280,461.20 |", "| Total | 300,000.00 |"].join("\n"),
    [ORDENES],
  );
  assert.deepEqual(r.montos.dudosos.map((d) => d.texto), ["300,000.00"]);
  assert.match(r.montos.dudosos[0].contexto!, /Fila «Total»/);
});
