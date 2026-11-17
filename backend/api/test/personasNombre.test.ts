import test from "node:test";
import assert from "node:assert/strict";
import { coincideConLoVisible, cuantasVisibles, palabrasDeNombre, palabrasVisibles } from "../src/lib/personasNombre.js";

process.env.PRIVACIDAD_CLAVE = "clave-de-prueba-de-32-caracteres-o-mas";

// Nombres sintéticos, en el orden del padrón (apellidos y nombres).
const NOMBRE = "QUISPEMAYTA HUAMANCHUMO ROBERTINO ELIAS";

test("lo que se ve de un nombre: el primer apellido y los nombres, nunca el apellido tapado", () => {
  const v = palabrasVisibles(NOMBRE);
  assert.deepEqual(v, ["QUISPEMAYTA", "ROBERTINO", "ELIAS"]);
  // Un apellido compuesto se tapa entero, con sus partículas.
  const c = palabrasVisibles("DE LA CRUZ HUAMANCHUMO ROSA");
  assert.equal(c.includes("HUAMANCHUMO"), false);
  assert.equal(c.includes("ROSA"), true);
  // Lo que no se pudo tapar (una palabra sola, una empresa) no da nada visible: no se busca por ahí.
  assert.deepEqual(palabrasVisibles("QUISPEMAYTA"), []);
});

test("buscar por el nombre visible encuentra; por el apellido tapado, no (no sirve para adivinarlo)", () => {
  const v = palabrasVisibles(NOMBRE);
  assert.equal(coincideConLoVisible(palabrasDeNombre("quispemayta robertino"), v), true);
  assert.equal(coincideConLoVisible(palabrasDeNombre("Quispemayta Robertino Elías"), v), true);
  assert.equal(coincideConLoVisible(palabrasDeNombre("QUISPEMAYTA ROB"), v), true, "una parte de una palabra visible vale");
  // Con el apellido escondido en la búsqueda, nada: ni solo ni junto a lo visible.
  assert.equal(coincideConLoVisible(palabrasDeNombre("QUISPEMAYTA HUAMANCHUMO"), v), false);
  assert.equal(coincideConLoVisible(palabrasDeNombre("QUISPEMAYTA HUAMANCHUMO ROBERTINO ELIAS"), v), false);
  assert.equal(coincideConLoVisible(palabrasDeNombre("HUAMAN ROBERTINO"), v), false, "tampoco una parte del apellido tapado");
  // Otra persona con el mismo primer apellido y otros nombres no coincide.
  assert.equal(coincideConLoVisible(palabrasDeNombre("QUISPEMAYTA FILOMENO"), v), false);
});

test("las palabras de la búsqueda: sin tildes, de 3 letras o más, y nada si trae números", () => {
  assert.deepEqual(palabrasDeNombre("  Peña   de la Cruz, José "), ["PEÑA", "CRUZ", "JOSE"]);
  assert.deepEqual(palabrasDeNombre("QUISPE 12345678"), []);
  assert.deepEqual(palabrasDeNombre(undefined), []);
  // «Ñ» y «N» valen igual al comparar.
  assert.equal(coincideConLoVisible(["PENA", "JOSE"], ["PEÑA", "JOSE"]), true);
  assert.equal(coincideConLoVisible([], ["PEÑA"]), false);
});

test("con el nombre completo también se encuentra: cuentan dos palabras visibles, y el apellido tapado no decide", () => {
  const v = palabrasVisibles(NOMBRE);
  // El nombre completo, con el apellido tapado bien escrito: dos visibles o más.
  assert.equal(cuantasVisibles(palabrasDeNombre("Robertino Quispemayta Huamanchumo"), v), 2);
  // Con OTRO apellido en su lugar da lo mismo: no sirve para confirmar cuál es el tapado.
  assert.equal(cuantasVisibles(palabrasDeNombre("Robertino Quispemayta Ccorahua"), v), 2);
  // El apellido tapado y un nombre: una sola visible, no alcanza.
  assert.equal(cuantasVisibles(palabrasDeNombre("Huamanchumo Robertino"), v), 1);
});

test("un par sólo vale si sus dos palabras se ven enteras: ni el apellido tapado ni un trozo de otra palabra", () => {
  // Lo mismo que hace personasPorNombreVisible con cada fila que le devuelve la base.
  const vale = (nombre: string, a: string, b: string) => {
    const seVe = new Set(palabrasVisibles(nombre).map((w) => w.replace(/Ñ/g, "N")));
    return seVe.has(a) && seVe.has(b);
  };
  assert.equal(vale(NOMBRE, "QUISPEMAYTA", "ROBERTINO"), true);
  assert.equal(vale(NOMBRE, "QUISPEMAYTA", "HUAMANCHUMO"), false);   // el segundo es el apellido tapado
  assert.equal(vale(NOMBRE, "QUISPEMAYTA", "ROBERT"), false);        // un trozo de «ROBERTINO» no es la palabra
  assert.equal(vale("QUISPEMAYTA LEON LEONARDO", "QUISPEMAYTA", "LEON"), false);   // el tapado está dentro de un nombre visible
});
