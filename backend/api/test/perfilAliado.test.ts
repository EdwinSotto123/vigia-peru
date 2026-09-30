/**
 * Perfil público del aliado (src/lib/perfilAliado.ts): las reglas con las que quien aporta lo edita
 * desde su cuenta (PUT /cuentas/me) y con las que se vuelve a sanear al leer. Y las piezas sin base de
 * datos de los aportes por entidad (src/lib/aportes.ts), con una base simulada.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  CamposPerfil, enlaceDeRed, esProblema, normalizarPerfil, perfilPublicado, problemaDeZod, setsDelPerfil,
  tocaPerfil, urlHttps, type CambiosPerfil,
} from "../src/lib/perfilAliado.js";
import { colaDeEntidad, entidadDeAporteSql, marcarConflictoDeInteres, tarifaVigente, type Consultable } from "../src/lib/aportes.js";

const cambios = (b: Parameters<typeof normalizarPerfil>[0]): CambiosPerfil => {
  const r = normalizarPerfil(b);
  if (esProblema(r)) throw new Error(`se esperaba un cambio válido: ${r.campo}: ${r.detalle}`);
  return r;
};

test("urlHttps: sólo https con dominio, normalizado", () => {
  assert.equal(urlHttps(" https://empresa.pe "), "https://empresa.pe/");
  assert.equal(urlHttps("http://empresa.pe"), null);
  assert.equal(urlHttps("javascript:alert(1)"), null);
  assert.equal(urlHttps("https://localhost/x"), null);
  assert.equal(urlHttps("https://usuario:clave@empresa.pe"), null);
  assert.equal(urlHttps(`https://empresa.pe/${"a".repeat(500)}`), null);
  assert.equal(urlHttps(42), null);
});

test("enlaceDeRed: el dominio de la red (o un subdominio) y una página, no la portada", () => {
  assert.equal(enlaceDeRed("facebook", "https://www.facebook.com/vigia"), "https://www.facebook.com/vigia");
  assert.equal(enlaceDeRed("linkedin", "https://pe.linkedin.com/company/vigia"), "https://pe.linkedin.com/company/vigia");
  assert.equal(enlaceDeRed("x", "https://twitter.com/vigia"), "https://twitter.com/vigia");
  assert.equal(enlaceDeRed("facebook", "https://facebook.com/"), null);
  assert.equal(enlaceDeRed("facebook", "https://facebook.com.estafa.pe/vigia"), null);
  assert.equal(enlaceDeRed("instagram", "https://www.facebook.com/vigia"), null);
});

test("normalizarPerfil: ausente no se toca, vacío o null borra", () => {
  assert.deepEqual(cambios({}), { campos: {}, poner: {}, quitar: [] });
  assert.equal(tocaPerfil(cambios({})), false);
  const c = cambios({ descripcion: "", sitioWeb: null, emailPublico: "  ", redes: { tiktok: "", youtube: null } });
  assert.deepEqual(c.campos, { descripcion: null, sitioWeb: null, emailPublico: null });
  assert.deepEqual(c.quitar, ["tiktok", "youtube"]);
  assert.equal(tocaPerfil(c), true);
});

test("normalizarPerfil: descripción en una línea y como mucho 280 caracteres (como char_length)", () => {
  assert.equal(cambios({ descripcion: "  Hola\n\tmundo  " }).campos.descripcion, "Hola mundo");
  assert.equal(cambios({ descripcion: "ñ".repeat(280) }).campos.descripcion, "ñ".repeat(280));
  // 280 emojis son 560 unidades UTF-16 pero 280 caracteres: pasa.
  assert.equal([...(cambios({ descripcion: "🌽".repeat(280) }).campos.descripcion ?? "")].length, 280);
  const r = normalizarPerfil({ descripcion: "a".repeat(281) });
  assert.ok(esProblema(r));
  assert.equal(r.campo, "descripcion");
  assert.match(r.detalle, /281 caracteres/);
});

test("normalizarPerfil: web y portada https; correo en minúsculas y válido", () => {
  const c = cambios({ sitioWeb: "https://Empresa.pe/Nosotros", portadaUrl: "https://cdn.empresa.pe/p.jpg", emailPublico: " Contacto@Empresa.PE " });
  assert.deepEqual(c.campos, { sitioWeb: "https://empresa.pe/Nosotros", portadaUrl: "https://cdn.empresa.pe/p.jpg", emailPublico: "contacto@empresa.pe" });
  for (const [cuerpo, campo] of [
    [{ sitioWeb: "http://empresa.pe" }, "sitioWeb"],
    [{ portadaUrl: "empresa.pe/p.jpg" }, "portadaUrl"],
    [{ emailPublico: "no-es-correo" }, "emailPublico"],
  ] as const) {
    const r = normalizarPerfil(cuerpo);
    assert.ok(esProblema(r), JSON.stringify(cuerpo));
    assert.equal(r.campo, campo);
  }
});

test("normalizarPerfil: cada red en su dominio; el campo del error es redes.<red>", () => {
  const c = cambios({ redes: { facebook: "https://facebook.com/vigia", x: "" } });
  assert.deepEqual(c.poner, { facebook: "https://facebook.com/vigia" });
  assert.deepEqual(c.quitar, ["x"]);
  const r = normalizarPerfil({ redes: { instagram: "https://tiktok.com/@vigia" } });
  assert.ok(esProblema(r));
  assert.equal(r.campo, "redes.instagram");
  assert.match(r.detalle, /Instagram/);
});

test("problemaDeZod: campo del cuerpo y frase; null si no es del perfil", () => {
  const Esquema = z.object({ ...CamposPerfil, ruc: z.string().regex(/^\d{11}$/).optional(), visible: z.boolean().optional() });
  const problema = (cuerpo: unknown) => {
    const r = Esquema.safeParse(cuerpo);
    assert.equal(r.success, false);
    return problemaDeZod((r as { error: z.ZodError }).error);
  };
  assert.equal(problema({ redes: { pinterest: "https://pinterest.com/x" } })?.campo, "redes.pinterest");
  assert.equal(problema({ redes: { facebook: "x".repeat(501) } })?.campo, "redes.facebook");
  assert.equal(problema({ descripcion: "a".repeat(1001) })?.campo, "descripcion");
  assert.equal(problema({ sitioWeb: 7 })?.campo, "sitioWeb");
  assert.equal(problema({ ruc: "123" })?.campo, "ruc");
  assert.equal(problema({ visible: "sí" }), null);
});

test("setsDelPerfil: columnas de lista cerrada y valores como parámetros", () => {
  const vals: unknown[] = [99];
  const sets = setsDelPerfil(cambios({ descripcion: "Hola", emailPublico: "", redes: { facebook: "https://facebook.com/v", x: "" } }), vals);
  assert.deepEqual(sets, [
    "descripcion = $2",
    "email_publico = $3",
    "redes = (COALESCE(redes, '{}'::jsonb) || $4::jsonb) - $5::text[]",
  ]);
  assert.deepEqual(vals, [99, "Hola", null, JSON.stringify({ facebook: "https://facebook.com/v" }), ["x"]]);
  assert.deepEqual(setsDelPerfil(cambios({}), []), []);
});

test("perfilPublicado: al leer, lo que no cumple no sale", () => {
  assert.deepEqual(perfilPublicado({
    descripcion: "  Somos una ONG  ", sitioWeb: "http://inseguro.pe", emailPublico: "hola@ong.pe",
    redes: { facebook: "https://facebook.com/ong", instagram: "javascript:x", otra: "https://otra.com/x" },
    portadaUrl: "https://ong.pe/portada.jpg",
  }), {
    descripcion: "Somos una ONG", sitioWeb: null, emailPublico: "hola@ong.pe",
    redes: { facebook: "https://facebook.com/ong" }, portadaUrl: "https://ong.pe/portada.jpg",
  });
  assert.deepEqual(perfilPublicado({}), { descripcion: null, sitioWeb: null, emailPublico: null, redes: {}, portadaUrl: null });
});

// ─── lib/aportes.ts con una base simulada ────────────────────────────────────
function baseSimulada(responder: (sql: string, vals: unknown[]) => Record<string, unknown>[]) {
  const consultas: { sql: string; vals: unknown[] }[] = [];
  const q: Consultable = {
    async query(sql: string, vals: unknown[] = []) {
      consultas.push({ sql, vals });
      const rows = responder(sql, vals);
      return { rows, rowCount: rows.length, command: "SELECT", oid: 0, fields: [] };
    },
  };
  return { q, consultas };
}

test("entidadDeAporteSql: {ruc, nombre} con la 39; null sin ella", () => {
  assert.match(entidadDeAporteSql("co", true), /json_build_object\('ruc', en\.ruc, 'nombre', en\.nombre\).*en\.ruc = co\.entidad_ruc/s);
  assert.equal(entidadDeAporteSql("co", false), "NULL::json");
});

test("marcarConflictoDeInteres: oculta con el motivo sólo si hay conflicto", async () => {
  const sin = baseSimulada((sql) => (sql.includes("EXISTS") ? [{ sancionado: false, con_alertas: false }] : []));
  assert.equal(await marcarConflictoDeInteres(sin.q, 7, "20100000001"), null);
  assert.equal(sin.consultas.length, 1);

  const sancion = baseSimulada((sql) => (sql.includes("EXISTS") ? [{ sancionado: true, con_alertas: true }] : []));
  assert.equal(await marcarConflictoDeInteres(sancion.q, 7, "20100000001"), "sancion_vigente_osce");
  assert.match(sancion.consultas[1].sql, /UPDATE financiadores SET visible = false, motivo_no_visible = \$2 WHERE id = \$1/);
  assert.deepEqual(sancion.consultas[1].vals, [7, "sancion_vigente_osce"]);

  const alertas = baseSimulada((sql) => (sql.includes("EXISTS") ? [{ sancionado: false, con_alertas: true }] : []));
  assert.equal(await marcarConflictoDeInteres(alertas.q, 7, "20100000001"), "proveedor_con_alertas_activas");
});

test("tarifaVigente: la que rige hoy, como números; null si no hay", async () => {
  const con = baseSimulada(() => [{ id: "2", precio_pen: "3.00" }]);
  assert.deepEqual(await tarifaVigente(con.q), { id: 2, precioPen: 3 });
  assert.match(con.consultas[0].sql, /vigente_desde <= current_date/);
  assert.equal(await tarifaVigente(baseSimulada(() => []).q), null);
});

test("colaDeEntidad: cola, listos y zona derivada; null si el RUC no es de una entidad", async () => {
  const b = baseSimulada(() => [{
    ruc: "20291973851", nombre: "ONPE", enCola: 1, listos: 0, zonaUbigeo: "150101", zonaNombre: "Lima", zonaNivel: "distrito",
  }]);
  assert.deepEqual(await colaDeEntidad(b.q, "20291973851", ["bienes"]), {
    ruc: "20291973851", nombre: "ONPE", enCola: 1, listos: 0, zona: { ubigeo: "150101", nombre: "Lima", nivel: "distrito" },
  });
  assert.deepEqual(b.consultas[0].vals, ["20291973851", ["bienes"]]);
  assert.match(b.consultas[0].sql, /zona_de_entidad\(e\.ruc\)/);

  const sinCola = baseSimulada(() => [{ ruc: "20291973851", nombre: "ONPE", enCola: 0, listos: 0, zonaUbigeo: null }]);
  assert.equal((await colaDeEntidad(sinCola.q, "20291973851"))?.zona, null);
  assert.deepEqual(sinCola.consultas[0].vals, ["20291973851", null]);

  assert.equal(await colaDeEntidad(baseSimulada(() => []).q, "20000000000"), null);
});
