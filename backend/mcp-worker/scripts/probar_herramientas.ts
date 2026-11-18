/**
 * Prueba las herramientas del MCP v2 de punta a punta SIN pasar por el OAuth: corre el mismo código de cada herramienta
 * (validación de entrada con su esquema + `ejecutar`) contra la API de producción.
 *
 *   cd backend/mcp-worker
 *   npx esbuild scripts/probar_herramientas.ts --bundle --platform=node --format=esm --outfile=.wrangler-dist/probar.mjs \
 *     --external:cloudflare:workers --log-level=error && node .wrangler-dist/probar.mjs
 *
 * La API es privada: pide un navegador y la cabecera de pruebas `x-gobserva-prueba` (GOBSERVA_PRUEBA en el entorno).
 * `rastro_persona` necesita además MCP_INTERNO_TOKEN; sin él esa prueba se salta. No imprime secretos ni nombres enteros.
 */
import { z } from "zod";
import { buscarContratos, ordenes, preciosDeMercado } from "../src/v2/herramientas/contratos";
import { buscarInformesControl, informesControl } from "../src/v2/herramientas/entidad";
import { fichaEntidad, normaAplicable, patrones, personaPublica, preciosReferencia, redEmpresa } from "../src/v2/herramientas/actores";
import { informeControlContrato } from "../src/v2/herramientas/control";

const PRUEBA = process.env.GOBSERVA_PRUEBA ?? "";
if (!PRUEBA) {
  console.error("Falta GOBSERVA_PRUEBA en el entorno.");
  process.exit(2);
}
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36";
const env = {
  VIGIA_URL: "https://vigia.gobserva.cloud",
  MCP_URL: "https://mcp.gobserva.cloud",
  MCP_INTERNO_TOKEN: process.env.MCP_INTERNO_TOKEN,
  API: {
    fetch: (req: Request) => {
      const u = new URL(req.url);
      const h = new Headers(req.headers);
      h.set("user-agent", UA);
      h.set("x-gobserva-prueba", PRUEBA);
      return fetch(`https://vigia.gobserva.cloud${u.pathname}${u.search}`, { method: req.method, headers: h });
    },
  },
} as never;

type Caso = { h: { nombre: string; entrada: z.ZodRawShape; ejecutar: (a: never, cx: never) => Promise<unknown> }; args: Record<string, unknown>; espera: (r: Record<string, unknown>) => string | null };
const lista = (r: Record<string, unknown>, k: string) => (Array.isArray(r[k]) ? (r[k] as unknown[]) : []);
const hay = (k: string, min = 1) => (r: Record<string, unknown>) => (lista(r, k).length >= min ? null : `«${k}» trae ${lista(r, k).length} filas (se esperaban ${min} o más)`);

const CASOS: Caso[] = [
  // Personas con cargo público (migraciones 318 y 319): un apellido y un nombre muy comunes traen varias, todas con el
  // apellido materno tapado y con el enlace a su ficha de rastro.
  { h: personaPublica as never, args: { nombre: "Quispe Juan", donde: "planilla" },
    espera: (r) => (lista(r, "con_cargo_publico").length >= 5
      && lista(r, "con_cargo_publico").every((x) => /•/.test(String((x as { nombre?: string }).nombre ?? "")) && /\/app\/personas\/cargo\/[0-9a-f]{12}$/.test(String((x as { enlace?: string }).enlace ?? "")))
      ? null : "sin personas con cargo público, o sin tapar o sin enlace a su ficha") },
  { h: patrones as never, args: { alcance: "entidad" }, espera: hay("patrones") },
  { h: patrones as never, args: { alcance: "proveedor" }, espera: hay("patrones") },
  { h: patrones as never, args: { alcance: "relleno" }, espera: hay("pares") },
  { h: patrones as never, args: { alcance: "consorcio" }, espera: hay("pares") },
  { h: patrones as never, args: { alcance: "renovacion" }, espera: hay("renovaciones") },
  // El socio sale con un apellido tapado y cada grupo trae dos empresas o más.
  { h: patrones as never, args: { alcance: "dueno" },
    espera: (r) => (lista(r, "grupos").length >= 5 && lista(r, "grupos").every((g) => ((g as { empresas: unknown[] }).empresas ?? []).length >= 2 && /•/.test(String((g as { socio?: string }).socio ?? "•")))
      ? null : "grupos sin dos empresas o con el nombre del socio sin tapar") },
  { h: preciosReferencia as never, args: { que: "papel bond a4 75" }, espera: hay("productos") },
  // Las compras del Estado por las mismas palabras (migraciones 338-339): la avena precocida tiene cientos de procesos por kg.
  { h: preciosReferencia as never, args: { que: "avena precocida hojuela" },
    espera: (r) => ((lista(r, "compras_del_estado") as { fuente?: string; compras?: number }[]).some((x) => x.fuente === "procesos" && Number(x.compras) >= 50)
      ? null : "sin compras del Estado por texto para la avena precocida") },
  // El laboratorio de precios renglón por renglón (los lubricantes de 2026-397-20, investigados el 11-17).
  { h: preciosDeMercado as never, args: { ocid: "2026-397-20" },
    espera: (r) => (lista(r, "renglones").length >= 5 && lista(r, "renglones").some((x) => Number((x as { ofertas_validas?: number }).ofertas_validas) >= 3)
      ? null : "el laboratorio no trae renglones con ofertas para los lubricantes") },
  { h: preciosReferencia as never, args: { que: "vigilancia", tipo: "servicio" }, espera: hay("servicios", 5) },
  // Un proceso de 2025 recibe el artículo 46 del Reglamento como regía antes del 14-01-2026; uno de 2026, el vigente.
  { h: normaAplicable as never, args: { pregunta: "estrategia de contratación: contenido y elaboración", fecha: "2025-09-01" },
    espera: (r) => (lista(r, "normas_que_regian").some((x) => /regía hasta/.test(String((x as { version?: string }).version ?? ""))) ? null : "no trajo el texto anterior del artículo modificado") },
  { h: normaAplicable as never, args: { pregunta: "parientes del alcalde impedidos de contratar", fecha: "2026-03-01" },
    espera: (r) => (lista(r, "normas_que_regian").some((x) => (x as { articulo?: string }).articulo === "30") && lista(r, "criterios_de_esa_ley").length ? null : "sin el artículo 30 o sin criterios") },
  { h: normaAplicable as never, args: { pregunta: "impedimentos para contratar", fecha: "2023-05-10" },
    espera: (r) => (/30225/.test(String(r.rige)) && lista(r, "normas_que_regian").length ? null : "un proceso de 2023 debe regirse por la Ley 30225") },
  // Una de las dos ferreteras del mismo dueño que le venden al mismo gobierno regional: debe traer a su hermana.
  { h: redEmpresa as never, args: { ruc: "20532492051" },
    espera: (r) => (lista(r, "mismo_dueno_en_la_misma_entidad").some((g) => ((g as { empresas_hermanas: unknown[] }).empresas_hermanas ?? []).length >= 1) ? null : "sin empresas hermanas en la misma entidad") },
  { h: patrones as never, args: { alcance: "dueno", solo_graves: true, minimo_contratos: 10 },
    espera: (r) => (lista(r, "grupos").length >= 3 && lista(r, "grupos").every((g) => Number((g as { con_90_dias_o_menos_entre_si: number }).con_90_dias_o_menos_entre_si) > 0 && Number((g as { contratos_con_objeto_parecido: number }).contratos_con_objeto_parecido) >= 10)
      ? null : "el filtro de graves o el mínimo no se aplicó") },
  { h: fichaEntidad as never, args: { ruc: "20131257750" },
    espera: (r) => ((r.duenos_con_varias_empresas as { grupos?: number } | undefined)?.grupos ? null : "la ficha de la entidad no trae sus grupos de dueños") },
  { h: patrones as never, args: { alcance: "inhabilitada", solo_graves: true },
    espera: (r) => (lista(r, "casos").length >= 5 && lista(r, "casos").every((g) => Number((g as { graves: number }).graves) > 0 && /^20\d{9}$/.test(String((g as { ruc_inhabilitada: string }).ruc_inhabilitada)))
      ? null : "la lista de socios de inhabilitadas salió vacía o sin graves") },
  { h: buscarContratos as never, args: { senal: "unico_postor,socio_de_inhabilitada", todas_las_senales: true, por_pagina: 5 },
    espera: (r) => (Number(r.total) > 0 && Number(r.total) < 2000 ? null : `la combinación de señales dio ${String(r.total)} contratos`) },
  // Lo que la Contraloría observó, atado a su contrato (migración 313): el patrón por proveedor y entidad, y el filtro.
  // Las banderas de cada orden y el filtro por bandera (migración 350): en Coronel Portillo, la empresa del hermano de un
  // funcionario que vende diésel por órdenes.
  { h: ordenes as never, args: { entidad_ruc: "20154572792", bandera: "pariente_socio" },
    espera: (r) => {
      const cs = lista(r, "compras") as { banderas?: { tipo: string; parentesco?: string }[] }[];
      if (!cs.length) return "sin compras con la bandera pariente_socio";
      return cs.every((c) => (c.banderas ?? []).some((b) => b.tipo === "pariente_socio" && !!b.parentesco)) ? null : "una compra sin su bandera pariente_socio";
    } },
  { h: ordenes as never, args: { entidad_ruc: "20169004359", bandera: "repetida" },
    espera: (r) => ((lista(r, "compras") as { banderas?: { tipo: string; ordenes?: unknown[] }[] }[]).some((c) => (c.banderas ?? []).some((b) => b.tipo === "repetida" && (b.ordenes ?? []).length >= 2))
      ? null : "sin la compra repetida de la UNI con sus órdenes") },
  // Empresas recién creadas con órdenes directas (migración 355): las graves llegan a 30 días o menos de su alta.
  { h: patrones as never, args: { alcance: "recien_creada", solo_graves: true },
    espera: (r) => {
      const cs = lista(r, "casos") as { ruc?: string; dias_del_alta_a_la_primera_orden?: number; monto_en_su_primer_anio_soles?: number }[];
      if (cs.length < 5) return "menos de 5 empresas recién creadas graves";
      return cs.every((x) => /^20/.test(String(x.ruc)) && Number(x.dias_del_alta_a_la_primera_orden) <= 30 && Number(x.monto_en_su_primer_anio_soles) >= 100000)
        ? null : "un caso grave con más de 30 días, menos de S/ 100 mil o sin RUC 20";
    } },
  // Dos ingresos del Estado (migración 352): planilla de una entidad y órdenes de servicio de otra; la persona, tapada.
  { h: patrones as never, args: { alcance: "doble", solo_graves: true },
    espera: (r) => {
      const cs = lista(r, "casos") as { persona?: string; meses_que_coinciden?: number; docencia?: boolean; enlace_persona?: string }[];
      if (cs.length < 5) return "menos de 5 casos de dos ingresos del Estado";
      return cs.every((x) => /•/.test(String(x.persona ?? "•")) && Number(x.meses_que_coinciden) >= 6 && x.docencia === false) ? null : "un caso sin tapar, con menos de 6 meses o con docencia entre los graves";
    } },
  // En observación (migraciones 364 y 366): trabaja en compras y un familiar cercano recibió órdenes emitidas con la persona
  // en el puesto. La persona, con un apellido tapado; del familiar, sólo el parentesco.
  { h: patrones as never, args: { alcance: "compras_familia", solo_graves: true },
    espera: (r) => {
      const cs = lista(r, "casos") as Record<string, unknown>[];
      if (cs.length < 5) return "menos de 5 casos graves de compras y familia";
      if (!cs.every((x) => /•/.test(String(x.persona ?? "•")) && x.familiar_cercano === true && Number(x.ordenes_emitidas_con_la_persona_en_el_puesto) >= 1))
        return "un caso grave sin tapar, sin familiar cercano o sin órdenes emitidas en el puesto";
      return cs.some((x) => Object.keys(x).some((k) => /nombre_del_familiar|documento|dni/i.test(k))) ? "el caso trae el nombre o el documento del familiar" : null;
    } },
  // En observación (migración 367): la autoridad electa que dejó de figurar en una empresa y lo que ésta le vendió a su entidad.
  { h: patrones as never, args: { alcance: "autoridad_exsocio" },
    espera: (r) => {
      const cs = lista(r, "casos") as Record<string, unknown>[];
      if (cs.length < 3) return "menos de 3 autoridades que dejaron su empresa";
      if (!cs.every((x) => /^20\d{9}$/.test(String(x.empresa_ruc)) && /^20\d{9}$/.test(String(x.entidad_ruc)) && typeof x.ventas_hasta_12_meses_despues_de_su_salida === "number"
        && Number(x.ordenes_en_su_periodo) + Number(x.procesos_adjudicados_en_su_periodo) >= 1))
        return "un caso sin RUC 20, sin ventas en el periodo o sin el conteo del plazo";
      return JSON.stringify(cs).match(/"\d{8}"/) ? "un caso trae un número de 8 cifras (¿documento?)" : null;
    } },
  // Quienes ya no figuran en la empresa (migración 365) salen en la red con el corte en que salieron, y la autoridad que
  // la dejó trae lo que la empresa le vendió a su entidad.
  { h: redEmpresa as never, args: { ruc: "20541275453" },
    espera: (r) => {
      const ps = lista(r, "personas") as { ya_no_figura_desde_el_corte?: string; enElEstado?: { ventasASuEntidad?: unknown[] } }[];
      if (!ps.some((x) => /^\d{4}-\d{2}-\d{2}$/.test(String(x.ya_no_figura_desde_el_corte ?? "")))) return "la red no trae a quienes ya no figuran";
      return ps.some((x) => (x.enElEstado?.ventasASuEntidad ?? []).length > 0) ? null : "la autoridad que dejó la empresa no trae las ventas a su entidad";
    } },
  // La misma compra repetida en semanas (migraciones 348-349): en la UNI, el posible duplicado de Pan American (O/C-1883 y 2364-2024).
  { h: patrones as never, args: { alcance: "repetida", ruc: "20169004359" },
    espera: (r) => ((lista(r, "compras_repetidas") as { proveedor_ruc?: string; monto_de_cada_orden?: number }[]).some((x) => x.proveedor_ruc === "20603050747" && x.monto_de_cada_orden === 28190)
      ? null : "sin la compra repetida de Pan American en la UNI") },
  // Grupos por dueño y familia (migraciones 343-347): el de la UNI (Valencia) sale grave, con la dependencia y sin RUC 10.
  { h: patrones as never, args: { alcance: "grupo", ruc: "20605328696" },
    espera: (r) => {
      const g = (lista(r, "grupos") as { severidad?: string; integrantes?: { ruc?: string; persona_natural?: boolean }[]; parte_de_sus_ventas_por_ordenes_que_viene_de_esta_entidad?: number }[])[0];
      if (!g) return "sin grupo para Lima Norte Investment";
      if (g.severidad !== "alta") return `el grupo de la UNI salió ${g.severidad}`;
      if ((g.integrantes ?? []).some((m) => m.persona_natural && m.ruc)) return "un integrante persona natural trae su RUC";
      return (g.parte_de_sus_ventas_por_ordenes_que_viene_de_esta_entidad ?? 0) > 0.5 ? null : "sin la dependencia de la entidad";
    } },
  { h: patrones as never, args: { alcance: "observado" },
    espera: (r) => (lista(r, "casos").length >= 5 && lista(r, "casos").every((g) => /^20\d{9}$/.test(String((g as { ruc: string }).ruc)) && Number((g as { procesos_observados: number }).procesos_observados) > 0)
      ? null : "la lista de procesos observados por la Contraloría salió vacía o con un RUC que no es de empresa") },
  { h: buscarContratos as never, args: { senal: "observado_por_contraloria", por_pagina: 5 },
    espera: (r) => (Number(r.total) >= 100 ? null : `sólo ${String(r.total)} contratos observados por la Contraloría`) },
  // La búsqueda en las observaciones de los informes de la Contraloría (migraciones 304-305) y la ficha en la lista.
  { h: buscarInformesControl as never, args: { pregunta: "pago de valorizaciones por partidas no ejecutadas", n: 5 },
    espera: (r) => {
      const rs = lista(r, "resultados") as { observacion?: string; informe?: string; entidad?: string }[];
      if (rs.length < 3) return `la búsqueda de informes de control dio ${rs.length} resultados`;
      if (!rs.some((x) => /valoriz|partidas/i.test(String(x.observacion)))) return "ningún resultado habla de valorizaciones ni partidas";
      return /(?<![0-9])[0-9]{8}(?![0-9-])/.test(JSON.stringify(rs.map((x) => x.observacion))) ? "una observación trae un número de 8 cifras sin tapar" : null;
    } },
  { h: informesControl as never, args: { ruc: "20154477374" },
    espera: (r) => ((lista(r, "informes") as { ficha?: { observaciones?: unknown[] } | null }[]).some((x) => (x.ficha?.observaciones?.length ?? 0) > 0)
      ? null : "ningún informe de la entidad trae su ficha con observaciones") },
  // Sin RUC: el mapa nacional de lo observado (migración 314), con sus temas y su ranking de entidades.
  { h: informesControl as never, args: {},
    espera: (r) => (Number(r.observaciones_leidas) > 5000 && lista(r, "por_tema").length >= 5 && lista(r, "entidades_con_mas_perjuicio_senalado").length >= 10
      && lista(r, "entidades_con_mas_perjuicio_senalado").every((e) => /^20\d{9}$/.test(String((e as { ruc: string }).ruc)))
      ? null : "el mapa nacional de lo observado salió incompleto") },
  { h: patrones as never, args: { alcance: "control", solo_graves: true },
    espera: (r) => (lista(r, "casos").length >= 5 && lista(r, "casos").every((g) => Number((g as { graves: number }).graves) > 0 && /•/.test(String((g as { persona?: string }).persona ?? "•")))
      ? null : "la lista de socios con informe de control salió vacía, sin graves o con un nombre sin tapar") },
  { h: redEmpresa as never, args: { ruc: "20100210909" }, espera: (r) => (lista(r, "socias_de_consorcio_que_compiten").length ? null : "sin socias de consorcio para una aseguradora que las tiene") },
  // El informe para control de un contrato con señales (la primera vez lo redacta un modelo abierto, hasta un minuto): cada
  // observación con su sumilla, su condición y el criterio de la ley de su fecha; ninguna persona en el texto.
  { h: informeControlContrato as never, args: { ocid: "1195870" },
    espera: (r) => {
      const obs = lista(r, "observaciones") as { sumilla?: string; condicion?: string; criterio?: { ley?: string } }[];
      if (!obs.length) return "el informe salió sin observaciones";
      if (!obs.every((o) => (o.sumilla ?? "").length > 10 && (o.condicion ?? "").length > 20 && /Ley N\.° (32069|30225)/.test(String(o.criterio?.ley ?? "")))) return "una observación sin sumilla, sin condición o sin la ley de su fecha";
      return /•/.test(JSON.stringify(obs)) ? "una observación nombra a una persona" : null;
    } },
];

let fallos = 0;
for (const c of CASOS) {
  const t0 = Date.now();
  try {
    const args = z.object(c.h.entrada).parse(c.args);
    const r = (await c.h.ejecutar(args as never, { env, usuario: null } as never)) as Record<string, unknown>;
    const mal = c.espera(r);
    const texto = JSON.stringify(r);
    // Privacidad: ni un documento de 8 dígitos suelto ni un RUC 10 en lo que sale. No cuentan los enlaces, los montos
    // (un número JSON: «"objeto":13990000») ni la cola de un código con letras («2023CPOL42000030», un informe de control).
    const sinFalsos = texto.replace(/"(ocid|ejemplos_ocid|enlace[a-z_]*|url[A-Za-z_]*)":\s*("[^"]*"|\[[^\]]*\])/g, "").replace(/:\s*-?\d+(\.\d+)?(?=[,}\]])/g, ":0");
    const dni = /(?<![\d.,A-Za-z])\d{8}(?![\d.,])/.test(sinFalsos);
    const ruc10 = /(?<!\d)10\d{9}(?!\d)/.test(texto);
    if (mal || ruc10) fallos++;
    console.log(`${mal || ruc10 ? "FALLA" : "ok   "} ${c.h.nombre} ${JSON.stringify(c.args)} ${Date.now() - t0} ms, ${texto.length} bytes` +
      (mal ? ` → ${mal}` : "") + (ruc10 ? " → sale un RUC 10" : "") + (dni ? " (hay un número de 8 dígitos: revisar)" : ""));
  } catch (e) {
    fallos++;
    console.log(`FALLA ${c.h.nombre} ${JSON.stringify(c.args)} → ${(e as Error).message.slice(0, 200)}`);
  }
}
console.log(fallos ? `${fallos} con falla` : "todas bien");
process.exit(fallos ? 1 : 0);
