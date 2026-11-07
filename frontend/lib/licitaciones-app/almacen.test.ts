import test from "node:test";
import assert from "node:assert/strict";
import { ErrorAlmacen, LIMITE_PERFILES, crearAlmacen } from "./almacen.ts";

const memoria = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

test("perfiles: valida el nombre, no repite y tiene tope", () => {
  const a = crearAlmacen(memoria());
  assert.throws(() => a.guardarPerfil(" x ", "q=x"), ErrorAlmacen);
  a.guardarPerfil("Tóner Lima", "q=toner&region=15");
  assert.throws(() => a.guardarPerfil("tóner lima", "q=y"), /Ya tienes/);
  for (let i = 1; i < LIMITE_PERFILES; i++) a.guardarPerfil(`Búsqueda ${i}`, "");
  assert.throws(() => a.guardarPerfil("Una más", ""), /hasta/);
  const id = a.leer().perfiles[0].id;
  a.borrarPerfil(id);
  assert.equal(a.leer().perfiles.length, LIMITE_PERFILES - 1);
});

test("seguir, cambiar de etapa y dejar de seguir: cada paso queda en el historial", () => {
  const a = crearAlmacen(memoria());
  a.seguir("op1", { codigo: "C-1", titulo: "Tóner" });
  a.cambiarEtapa("op1", "preparando");
  assert.equal(a.leer().seguidos.op1.etapa, "preparando");
  a.dejarDeSeguir("op1");
  assert.equal(a.leer().seguidos.op1, undefined);
  assert.deepEqual(
    a.leer().historial.op1.map((e) => e.texto),
    ["Dejaste de seguir este proceso.", "Pasó a «Preparando oferta».", "Empezaste a seguir este proceso."],
  );
});

test("comentarios: no vacíos ni demasiado largos; se borran", () => {
  const a = crearAlmacen(memoria());
  assert.throws(() => a.comentar("op", "   "), ErrorAlmacen);
  assert.throws(() => a.comentar("op", "x".repeat(1001)), ErrorAlmacen);
  const c = a.comentar("op", "  Pedir aclaración del ítem 3  ");
  assert.equal(c.texto, "Pedir aclaración del ítem 3");
  a.borrarComentario("op", c.id);
  assert.deepEqual(a.leer().comentarios.op, []);
});

test("persiste y se recupera; un almacenamiento roto no rompe nada", () => {
  const g = memoria();
  crearAlmacen(g).marcarRequisito("op", "rnp", true);
  assert.deepEqual(crearAlmacen(g).leer().checklist.op, ["rnp"]);
  const roto = { getItem: () => "{no es json", setItem: () => { throw new Error("lleno"); } };
  const a = crearAlmacen(roto);
  assert.deepEqual(a.leer().perfiles, []);
  a.guardarPerfil("En memoria", "q=x");
  assert.equal(a.leer().perfiles.length, 1);
});
