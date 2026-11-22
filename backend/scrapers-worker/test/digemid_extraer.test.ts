import assert from "node:assert/strict";
import { test } from "node:test";
import { jsonDe, validar, type AlertaParaExtraer } from "../src/fuentes/digemid_extraer.ts";

const ALERTA: AlertaParaExtraer = {
  id: 1,
  titulo: "ALERTA DIGEMID N° 142-2026",
  motivo: "RETIRO DEL MERCADO DE UN LOTE DE DISPOSITIVO MÉDICO",
  productos: "Guantes QX Alkhofar",
  texto:
    "DISPOSITIVO MÉDICO Nº DE LOTE REGISTRO SANITARIO FABRICANTE PAÍS TITULAR DEL REGISTRO SANITARIO RESULTADOS ANALÍTICOS " +
    "GUANTES QUIRÚRGICOS ESTÉRILES DE UN SOLO USO, Modelo: 8, caja x 50 pares 20250502QX DM-27013E Tianchang City Anrui Medical " +
    "Equipments Co., Ltd. CHINA DROGUERÍA ALKHOFAR SOCIEDAD ANONIMA CERRADA No conforme para el ensayo de Ausencia de Agujeros " +
    "Vence 05/2027 lote L-2345",
};

test("digemid extraer: el JSON aunque venga envuelto", () => {
  assert.deepEqual(jsonDe('```json\n{"productos": []}\n```'), { productos: [] });
  assert.deepEqual(jsonDe('Aquí está: {"a": 1} listo'), { a: 1 });
  assert.equal(jsonDe("sin json"), null);
});

test("digemid extraer: lo que aparece en el PDF queda; lo inventado se descarta", () => {
  const [p, inventado] = [
    {
      producto: "GUANTES QUIRÚRGICOS ESTÉRILES DE UN SOLO USO, Modelo: 8",
      presentacion: "caja x 50 pares",
      lotes: ["20250502QX", "L2345", "99999999"],
      registro_sanitario: "DM27013E",
      vencimiento: "05/2027",
      fabricante: "Tianchang City Anrui Medical Equipments Co., Ltd.",
      pais: "CHINA",
      titular: "DROGUERÍA ALKHOFAR SOCIEDAD ANONIMA CERRADA",
      detalle: "No conforme para el ensayo de Ausencia de Agujeros",
    },
    { producto: "PANADOL 500 MG", lotes: ["ABC123"], registro_sanitario: "EE01234" },
  ];
  const out = validar({ productos: [p, inventado] }, ALERTA);
  assert.equal(out.length, 1, "el producto que no está en el PDF no pasa");
  const g = out[0];
  assert.deepEqual(g.lotes, ["20250502QX", "L2345"], "el lote inventado no pasa; «L2345» sí (en el PDF, «L-2345»)");
  assert.equal(g.registro, "DM27013E");
  assert.equal(g.vencimiento, "05/2027");
  assert.equal(g.titular, "DROGUERÍA ALKHOFAR SOCIEDAD ANONIMA CERRADA");
  assert.equal(g.presentacion, "caja x 50 pares");
});

test("digemid extraer: un registro o un titular que no están en el texto quedan en null", () => {
  const out = validar({ productos: [{ producto: "Guantes QX Alkhofar", registro_sanitario: "EE09999", titular: "LABORATORIOS INVENTADOS SAC" }] }, ALERTA);
  assert.equal(out.length, 1);
  assert.equal(out[0].registro, null);
  assert.equal(out[0].titular, null);
});

test("digemid extraer: sin lista de productos, nada", () => {
  assert.deepEqual(validar(null, ALERTA), []);
  assert.deepEqual(validar({ productos: "no" }, ALERTA), []);
});
