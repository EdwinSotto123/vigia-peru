import test from "node:test";
import assert from "node:assert/strict";
import { crearFuenteDemo, type FilaCruda, type Muestra } from "./fuente-demo.ts";
import { FILTROS_POR_DEFECTO, leerFiltros } from "./filtros.ts";

const AHORA = Date.parse("2026-11-07T15:00:00Z");

const fila = (n: number, f: Partial<FilaCruda>): FilaCruda => ({
  ocid: String(n),
  codigo: `C-${n}`,
  objeto: `Objeto ${n}`,
  tipo: "bienes",
  procedimiento: "Subasta Inversa Electrónica",
  valor: n * 1000,
  fecha: "2026-11-05",
  entidadRuc: `2010000000${n % 10}`,
  entidad: `Entidad ${String.fromCharCode(64 + n)}`,
  region: "15",
  consultasHasta: "2026-11-20T23:59:00-05:00",
  items: 1,
  ...f,
});

const muestra: Muestra = {
  tomada: "2026-11-07T10:00:00-05:00",
  oportunidades: [
    fila(1, { objeto: "Adquisición de tóner para impresoras", tipo: "bienes", region: "15", valor: 9000, consultasHasta: "2026-11-08T23:59:00-05:00" }),
    fila(2, { objeto: "Servicio de limpieza", tipo: "servicios", region: "04", valor: null, consultasHasta: "2026-11-05T23:59:00-05:00" }),
    fila(3, { objeto: "Obra de pistas", tipo: "obras", region: "04", valor: 500_000, procedimiento: "Licitación Pública", fecha: "2026-10-01" }),
    fila(4, { objeto: "Papel bond y tóner", tipo: "bienes", region: "08", valor: 3000, consultasHasta: null }),
    fila(5, { objeto: "Consultoría de expediente", tipo: "consultoria", region: "15", valor: 120_000, entidad: "Abancay" }),
  ],
  fichas: {
    "5": { inteligencia: { procesos: 20, monto: 1e6, conPostores: 20, unSoloPostor: 17, adjSobreRef: 0.9, postoresPromedio: 1.3, proveedores: [] }, descripcion: "Expediente técnico" },
  },
};

const fuente = crearFuenteDemo(muestra, () => AHORA);
const buscar = (qs: string) => fuente.buscar(leerFiltros(new URLSearchParams(qs)));
const ids = (r: { data: { id: string }[] }) => r.data.map((o) => o.id);

test("sin filtros: lo publicado en 30 días, de lo más reciente", async () => {
  const r = await fuente.buscar(FILTROS_POR_DEFECTO);
  assert.equal(r.total, 4); // la 3 se publicó hace más de 30 días
  assert.equal(r.paginas, 1);
});

test("texto: sin tildes, todas las palabras, también en la descripción de la ficha", async () => {
  assert.deepEqual(ids(await buscar("q=TONER")), ["1", "4"]);
  assert.deepEqual(ids(await buscar("q=toner papel")), ["4"]);
  assert.deepEqual(ids(await buscar("q=expediente tecnico")), ["5"]);
});

test("tipo y región como listas; las facetas no se cuentan a sí mismas", async () => {
  const r = await buscar("tipo=bienes,consultoria&region=15");
  assert.deepEqual(ids(r).sort(), ["1", "5"]);
  // Con región 15 puesta, la faceta de tipo cuenta todos los tipos de la región 15.
  assert.deepEqual(r.facetas.tipo, [{ clave: "bienes", n: 1 }, { clave: "consultoria", n: 1 }]);
  // Con los tipos puestos, la de región cuenta todas las regiones de esos tipos.
  assert.deepEqual(r.facetas.region, [{ clave: "15", n: 2 }, { clave: "08", n: 1 }]);
});

test("valor: el rango deja fuera lo que no publicó valor", async () => {
  assert.deepEqual(ids(await buscar("min=5000&max=200000")).sort(), ["1", "5"]);
});

test("consultas: abiertas, por vencer y vencidas", async () => {
  assert.deepEqual(ids(await buscar("cons=3d")), ["1"]);
  assert.deepEqual(ids(await buscar("cons=vencidas")), ["2"]);
  assert.deepEqual(ids(await buscar("cons=abiertas")).sort(), ["1", "5"]);
});

test("señales: sólo lo que tiene una de riesgo (no las informativas)", async () => {
  assert.deepEqual(ids(await buscar("senal=1")), ["5"]);
});

test("orden: valor con los sin valor al final, vence con lo abierto primero, entidad", async () => {
  assert.deepEqual(ids(await buscar("orden=valor_desc")), ["5", "1", "4", "2"]);
  assert.deepEqual(ids(await buscar("orden=valor_asc")), ["4", "1", "5", "2"]);
  assert.deepEqual(ids(await buscar("orden=vence")), ["1", "5", "2", "4"]);
  assert.deepEqual(ids(await buscar("orden=entidad")), ["5", "1", "2", "4"]);
});

test("paginación: tamaño, páginas y una página más allá del final vuelve a la última", async () => {
  const r = await fuente.buscar({ ...FILTROS_POR_DEFECTO, tam: 10, pag: 9 });
  assert.equal(r.pagina, 1);
  assert.equal(r.paginas, 1);
  assert.equal(r.data.length, 4);
});

test("resumen: valor total, con valor, entidades, con señales y por vencer en la semana", async () => {
  const r = await fuente.buscar(FILTROS_POR_DEFECTO);
  assert.deepEqual(r.resumen, { valorTotal: 132_000, conValor: 3, entidades: 4, conSenales: 1, vencenSemana: 1 });
});

test("detalle: con su cronograma (sin fechas inventadas) y null si no existe", async () => {
  const d = await fuente.oportunidad("5");
  assert.equal(d?.descripcion, "Expediente técnico");
  assert.equal(d?.cronograma.find((h) => h.clave === "ofertas")?.fecha, null);
  assert.equal(await fuente.oportunidad("no-existe"), null);
});
