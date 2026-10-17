/** Piezas sin red de vigia-precios: tiendas (VTEX, pausa por fallos) y combustibles (CSV de Osinergmin). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { decodificar, estadistica, parsearDmin, percentil, productoCanonico, productoDeConsulta } from "../src/combustible.ts";
import { TIENDAS, bloqueada, estadoTrasExito, estadoTrasFallo, normalizarTermino, normalizarVtex, urlBusqueda } from "../src/tiendas.ts";

const T = TIENDAS[0];

test("término normalizado: sin tildes ni signos", () => {
  assert.equal(normalizarTermino("  Lejía  CLOROX (2 kg)! "), "lejia clorox 2 kg");
  assert.equal(normalizarTermino("Cemento Sol 42,5 kg. S.A.C."), "cemento sol 42.5 kg s a c");
  assert.equal(urlBusqueda(T, "cemento sol", 4), "https://www.promart.pe/api/catalog_system/pub/products/search?ft=cemento%20sol&_from=0&_to=3");
});

test("VTEX: precio vigente con stock; lo que no tiene forma se omite", () => {
  const datos = [
    { productName: "Cemento Sol 42.5 kg", brand: "Sol", linkText: "cemento-sol", link: "https://www.promart.pe/cemento-sol/p",
      items: [{ itemId: "1", measurementUnit: "un", unitMultiplier: 1, sellers: [{ commertialOffer: { Price: 30.9, ListPrice: 32, AvailableQuantity: 50 } }] }] },
    { productName: "Sin stock", items: [{ sellers: [{ commertialOffer: { Price: 10, AvailableQuantity: 0 } }] }] },
    { productName: "Precio cero", items: [{ sellers: [{ commertialOffer: { Price: 0 } }] }] },
    { productName: "Roto" },
  ];
  const p = normalizarVtex(datos, T);
  assert.equal(p.length, 1);
  assert.deepEqual({ ...p[0] }, {
    tienda: "promart.pe", producto: "Cemento Sol 42.5 kg", marca: "Sol", sku: "1", precio: 30.9, precio_lista: 32,
    unidad_medida: "un", multiplicador: 1, url: "https://www.promart.pe/cemento-sol/p",
  });
  assert.deepEqual(normalizarVtex({ error: "x" }, T), []);
});

test("pausa por fallos: al 3.º seguido, 429/403 de inmediato, se duplica y tope 24 h", () => {
  const t0 = 1_000_000;
  let e = estadoTrasFallo(null, t0);
  assert.equal(bloqueada(e, t0), false);
  e = estadoTrasFallo(e, t0);
  assert.equal(bloqueada(e, t0), false);
  e = estadoTrasFallo(e, t0);
  assert.equal(e.bloqueada_hasta - t0, 30 * 60_000);
  e = estadoTrasFallo(e, t0);
  assert.equal(e.bloqueada_hasta - t0, 60 * 60_000);
  assert.equal(bloqueada(estadoTrasFallo(null, t0, 429), t0), true);
  assert.equal(estadoTrasFallo({ errores: 40, bloqueada_hasta: 0 }, t0).bloqueada_hasta - t0, 24 * 3_600_000);
  assert.deepEqual(estadoTrasExito(), { errores: 0, bloqueada_hasta: 0 });
});

test("productos de combustible: nombres del registro y de una consulta", () => {
  assert.equal(productoCanonico("Diesel B5 S-50"), "diesel_b5_s50");
  assert.equal(productoCanonico("DIESEL B5"), "diesel_b5");
  assert.equal(productoCanonico("GASOHOL REGULAR"), "gasohol_regular");
  assert.equal(productoCanonico("PETRÓLEO INDUSTRIAL Nº 6"), "petroleo_industrial");
  assert.equal(productoCanonico("ASFALTO"), null);
  assert.equal(productoDeConsulta("DIESEL B5 S-50 UV"), "diesel_b5_s50");
  assert.equal(productoDeConsulta("petróleo diésel"), "diesel_b5_s50");
});

// CSV con la cabecera real del reporte (UTF-8) y datos sintéticos; un departamento con tilde.
const CSV = [
  "ID1;ACTIVIDAD;REGISTRO_DE_HIDROCARBUROS;RUC;RAZÓN_SOCIAL;DEPARTAMENTO;PROVINCIA;DISTRITO;DIRECCIÓN;DEPARTAMENTO_REPARTO;PROVINCIA_REPARTO;FECHA_DE_REGISTRO;PRODUCTO;PRECIO_MIN_SOLES;PRECIO_MAX_SOLES;UNIDAD",
  "1;DISTRIBUIDORES MINORISTAS  ;1-1 ;20100000001   ;DISTRIBUIDORA UNO S.A.C.   ;LIMA   ;LIMA;ATE;AV X;LIMA;LIMA;2026/10/13 12:02:05.000;Diesel B5 S-50;19.50;20.50;Galones",
  "2;DISTRIBUIDORES MINORISTAS;1-2;20100000002;DISTRIBUIDORA DOS S.A.C.;JUNÍN;HUANCAYO;HUANCAYO;AV Y;JUNÍN;HUANCAYO;2026/09/01 08:00:00.000;Diesel B5 S-50;21,00;23,00;Galones",
  "3;DISTRIBUIDORES MINORISTAS;1-3;20100000003;TRES;LIMA;LIMA;LIMA;AV Z;LIMA;LIMA;2026/10/01 08:00:00.000;ASFALTO RC-250;5;6;Galones",
  "4;DISTRIBUIDORES MINORISTAS;1-4;X;CUATRO;LIMA;LIMA;LIMA;AV Z;LIMA;LIMA;fecha rota;Diesel B5 S-50;19;20;Galones",
  "",
].join("\r\n");

test("CSV de Osinergmin: columnas por nombre, UTF-8, coma decimal y filas inválidas fuera", () => {
  const filas = parsearDmin(decodificar(new TextEncoder().encode(CSV)));
  assert.equal(filas.length, 2);
  assert.deepEqual(filas[0], {
    fecha: "2026-10-13", departamento: "LIMA", producto: "diesel_b5_s50", producto_original: "Diesel B5 S-50",
    ruc: "20100000001", razon_social: "DISTRIBUIDORA UNO S.A.C.", precio_min: 19.5, precio_max: 20.5, unidad: "Galones",
  });
  assert.equal(filas[1].precio_min, 21);
  assert.equal(filas[1].departamento, "JUNIN");      // sin tilde: así se consulta
});

test("estadística: punto medio de cada declaración y percentiles", () => {
  assert.equal(percentil([4, 1, 3, 2], 0.5), 2.5);
  const e = estadistica([
    { fecha: "2026-10-01", precio_min: 19, precio_max: 21 },
    { fecha: "2026-10-05", precio_min: 22, precio_max: null },
    { fecha: "2026-09-20", precio_min: null, precio_max: 18 },
  ]);
  assert.deepEqual(e, { n: 3, p25: 19, mediana: 20, p75: 21, min: 18, max: 22, desde: "2026-09-20", hasta: "2026-10-05" });
});
