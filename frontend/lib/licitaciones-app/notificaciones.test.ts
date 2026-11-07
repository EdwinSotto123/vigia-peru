import test from "node:test";
import assert from "node:assert/strict";
import { armarNotificaciones, sinLeer, type EnvioN, type ItemN } from "./notificaciones.ts";

// Sábado 7 nov 2026, 10:00 en Lima.
const AHORA = Date.parse("2026-11-07T15:00:00Z");

const item = (ref: string, estado: string, plazos: ItemN["plazos"], tipo = "oportunidad"): ItemN => ({ tipo, ref, titulo: `Proceso ${ref}`, estado, plazos });

test("vencimientos: sólo lo abierto, por venir y en 3 días; urgente hoy o mañana; ordenados por fecha", () => {
  const ns = armarNotificaciones({
    seguimiento: [
      item("a", "preparando", [
        { clave: "convocatoria", etiqueta: "Convocatoria", fecha: "2026-11-01" },
        { clave: "consultas", etiqueta: "Fin de consultas y observaciones", fecha: "2026-11-10" },
      ]),
      item("b", "guardada", [{ clave: "cierre", etiqueta: "Cierra la cotización", fecha: "2026-11-08T11:00:00-05:00" }], "menor"),
      item("c", "ganada", [{ clave: "buena_pro", etiqueta: "Buena pro", fecha: "2026-11-08" }]),
      item("d", "guardada", [{ clave: "consultas", etiqueta: "Fin de consultas", fecha: "2026-11-20" }]),
      item("e", "guardada", [{ clave: "consultas", etiqueta: "Fin de consultas", fecha: "2026-11-06" }]),
    ],
    envios: [],
    ahora: AHORA,
  });
  assert.deepEqual(ns.map((n) => [n.titulo, n.urgente, n.href]), [
    ["Cierra la cotización: vence mañana", true, "/menor/b"],
    ["Fin de consultas y observaciones: vence en 3 días", false, "/app/oportunidad/a?tab=cronograma"],
  ]);
});

test("alertas: los envíos con oportunidades, de lo más nuevo a lo más viejo, con sus tres primeras", () => {
  const envio = (id: number, creado: string, n: number): EnvioN => ({
    id,
    tipo: "alerta",
    asunto: `Alerta ${id}`,
    creado,
    nItems: n,
    items: Array.from({ length: n }, (_, k) => ({ ref: `${k}`, titulo: `Op ${k}`, enlace: `https://x/${k}` })),
  });
  const ns = armarNotificaciones({ seguimiento: [], envios: [envio(1, "2026-11-05 07:00", 5), envio(2, "2026-11-07 07:00", 1), envio(3, "2026-11-06 07:00", 0)], ahora: AHORA });
  assert.deepEqual(ns.map((n) => n.id), ["alerta:2", "alerta:1"]);
  assert.equal(ns[0].texto, "1 oportunidad nueva que calza con tu alerta");
  assert.equal(ns[1].items?.length, 3);
  assert.equal(ns[0].fecha, "2026-11-07T07:00:00-05:00");
  assert.equal(sinLeer(ns, new Set(["alerta:1"])), 1);
});
