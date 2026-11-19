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
import { buscarContratos, fichaContrato, ordenes, preciosDeMercado, senales } from "../src/v2/herramientas/contratos";
import { buscarInformesControl, informesControl, ordenesEnPeriodo } from "../src/v2/herramientas/entidad";
import { fichaEmpresa, fichaEntidad, historia, normaAplicable, patrones, personaPublica, preciosReferencia, redEmpresa } from "../src/v2/herramientas/actores";
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
  // Las banderas recalibradas dicen por qué pesan (migraciones 390-395): el contrato 1241973 tiene «sólo admitieron al
  // ganador» (6 ofertas) y el 2026-1689-3 una denuncia de bases dirigidas tras la que la competencia desapareció.
  { h: fichaContrato as never, args: { ocid: "1241973" },
    espera: (r) => ((lista(r, "cruces") as { tipo?: string; por_que_pesa?: string }[]).some((x) => x.tipo === "solo_admitido_el_ganador" && /6 ofertas/.test(x.por_que_pesa ?? ""))
      ? null : "sin «por_que_pesa» en sólo admitieron al ganador") },
  { h: fichaContrato as never, args: { ocid: "2026-1689-3" },
    espera: (r) => ((lista(r, "cruces") as { tipo?: string; por_que_pesa?: string }[]).some((x) => x.tipo === "consultas_denuncia_direccionamiento" && /desapareció/.test(x.por_que_pesa ?? ""))
      ? null : "sin «por_que_pesa» en la denuncia de bases dirigidas") },
  // El mismo integrante del comité (migración 396): filas con su clave estable y su papel, y NINGÚN nombre de la persona.
  { h: patrones as never, args: { alcance: "observacion", indicador: "comite_mismo_ganador" },
    espera: (r) => {
      const filas = JSON.stringify(r);
      const conClave = /"integrante_del_comite":"[0-9a-f]{10}"/.test(filas);
      const conNombre = /"(persona|nombre_completo|integrante_nombre)"/.test(filas);
      return conClave && !conNombre ? null : conNombre ? "sale el nombre del integrante" : "sin la clave del integrante";
    } },
  // Y por su clave se llega a todos sus contratos marcados (la misma persona del comité, 8 casos el 2026-11-19).
  { h: patrones as never, args: { alcance: "observacion", integrante_del_comite: "3293672db9" },
    espera: (r) => {
      const filas = lista(r, "contratos") as { integrante_del_comite?: string }[];
      const todas = JSON.stringify(r).match(/"integrante_del_comite":"([0-9a-f]{10})"/g) ?? [];
      return todas.length >= 2 && todas.every((x) => x.includes("3293672db9")) ? null
        : `por la clave del integrante llegan ${todas.length} filas (o de otra persona); ${filas.length} en «contratos»`;
    } },
  // El integrante del comité socio de un proveedor de su entidad (migración 407): su papel en la empresa y cuán firme es la
  // identidad, sin nombre ni DNI.
  { h: patrones as never, args: { alcance: "observacion", indicador: "comite_socio_proveedor" },
    espera: (r) => {
      const filas = JSON.stringify(r);
      const ok = /"identidad":"(documento|nombre_completo|nombre)"/.test(filas) && /"papel_en_la_empresa":\[/.test(filas)
        && /"integrante_del_comite":"[0-9a-f]{10}"/.test(filas);
      // Sólo como CLAVE (seguida de «:»): "nombre_completo" es también un valor de `identidad`.
      const fuga = filas.match(/"(persona|nombre_completo|integrante_nombre|dni|numero_documento|persona_doc)":/);
      return ok && !fuga ? null : fuga ? `sale un nombre o un número de documento (${fuga[0]})` : "sin identidad, papel en la empresa o clave";
    } },
  // Y en la ficha de un contrato, junto a cada bandera: 1241973 tiene «el acta deja sólo al ganador» y «recurrente»,
  // medidas contra las dos verdades (las en observación con pocos casos no dicen nada).
  { h: fichaContrato as never, args: { ocid: "1241973" },
    espera: (r) => ((lista(r, "cruces") as { tipo?: string; evidencia_externa?: string }[]).some((x) => /Contraloría|Tribunal/.test(x.evidencia_externa ?? ""))
      ? null : "ningún cruce con evidencia_externa") },
  // Las entidades que el Tribunal corrige más que el resto del país (migración 422): las destacadas, con su probabilidad.
  { h: patrones as never, args: { alcance: "tribunal", solo_graves: true },
    espera: (r) => {
      const e = lista(r, "entidades") as { destaca?: boolean; probabilidad_de_azar?: number; ruc?: string }[];
      return e.length >= 1 && e.every((x) => x.destaca === true && typeof x.probabilidad_de_azar === "number" && /^\d{11}$/.test(String(x.ruc)))
        ? null : `entidades destacadas: ${e.length}`;
    } },
  // La empresa ante el Tribunal (migración 424): 20408114943 tenía la buena pro de 1219540 y el Tribunal la revocó
  // (Resolución 9747-2026-TCP-S1). Sin nombres leídos: sólo la resolución, su papel y la fuente.
  { h: fichaEmpresa as never, args: { ruc: "20408114943" },
    espera: (r) => {
      const t = r.tribunal as { se_la_quito_el_tribunal?: number; resoluciones?: { papel?: string; enlace_resolucion?: string }[] } | undefined;
      return t && (t.se_la_quito_el_tribunal ?? 0) >= 1 && (t.resoluciones ?? []).some((x) => /se la quitaron/.test(x.papel ?? "") && /^https:/.test(x.enlace_resolucion ?? ""))
        ? null : "sin «tribunal» con la buena pro revocada";
    } },
  // Los contratos que el Tribunal corrigió (filtro ?tribunal=, 423): cientos, en orden de fecha.
  { h: buscarContratos as never, args: { tribunal: "corregido", por_pagina: 5 },
    espera: (r) => (typeof r.total === "number" && r.total >= 100 && lista(r, "contratos").length === 5 ? null : `total ${String(r.total)}`) },
  // Y en la lista de indicadores en observación, con la resolución (424).
  { h: patrones as never, args: { alcance: "observacion", indicador: "tribunal_revoco_buena_pro" },
    espera: (r) => (/"resolucion_del_tribunal":"Resoluci/.test(JSON.stringify(r)) ? null : "sin la resolución del Tribunal en la lista") },
  // Cuán confiable es cada señal (migraciones 401, 404, 419, 421): con las dos verdades y sin la circular.
  { h: senales as never, args: { vista: "confiabilidad" },
    espera: (r) => {
      const s = lista(r, "senales") as { tipo?: string; contra_contraloria?: unknown; contra_tribunal?: unknown }[];
      const v = r.verdades as { contraloria?: { auc_del_puntaje?: number }; tribunal?: { auc_del_puntaje?: number } } | undefined;
      if (!v?.contraloria?.auc_del_puntaje || !v?.tribunal?.auc_del_puntaje) return "sin las dos verdades";
      if (s.some((x) => x.tipo === "otro_postor" && x.contra_tribunal)) return "otro_postor medido contra el Tribunal (es circular)";
      return s.some((x) => x.tipo === "recien_fundada_medio_ano" && x.contra_contraloria) ? null : "sin recien_fundada_medio_ano";
    } },
  // El evaluador que filtra la competencia (migración 415): la comparación con la entidad y la probabilidad de azar.
  { h: patrones as never, args: { alcance: "observacion", indicador: "comite_competencia_restringida" },
    espera: (r) => {
      const filas = JSON.stringify(r);
      const ok = /"probabilidad_de_azar":0\.\d+/.test(filas) && /"tasa_de_la_entidad_sin_esa_persona":/.test(filas)
        && /"integrante_del_comite":"[0-9a-f]{10}"/.test(filas);
      const fuga = filas.match(/"(persona|nombre_completo|integrante_nombre|dni|numero_documento|persona_doc)":/);
      return ok && !fuga ? null : fuga ? `sale un nombre o un número de documento (${fuga[0]})` : "sin probabilidad, tasa o clave";
    } },
  { h: fichaContrato as never, args: { ocid: "1196243" },
    espera: (r) => ((lista(r, "cruces") as { tipo?: string; por_que_pesa?: string }[]).some((x) => x.tipo === "comite_socio_proveedor" && /socio o representante/.test(x.por_que_pesa ?? ""))
      ? null : "sin «por_que_pesa» en el integrante del comité socio del proveedor") },
  // Personas con cargo público (migraciones 318 y 319): un apellido y un nombre muy comunes traen varias, todas con el
  // apellido materno tapado y con el enlace a su ficha de rastro.
  { h: personaPublica as never, args: { nombre: "Quispe Juan", donde: "planilla" },
    espera: (r) => (lista(r, "con_cargo_publico").length >= 5
      && lista(r, "con_cargo_publico").every((x) => /•/.test(String((x as { nombre?: string }).nombre ?? "")) && /\/app\/personas\/cargo\/[0-9a-f]{12}$/.test(String((x as { enlace?: string }).enlace ?? "")))
      ? null : "sin personas con cargo público, o sin tapar o sin enlace a su ficha") },
  // La historia de una entidad grande: lo más grave va primero y trae contratos con banderas e informes de control, no sólo
  // picos de visitas; cada hecho con su gravedad, su renglón y su enlace. Con una clase, sólo los de ese renglón.
  { h: historia as never, args: { tipo: "entidad", id: "20153408191" },
    espera: (r) => {
      const g = lista(r, "lo_mas_grave") as { renglon?: string; severidad?: string; enlace_vigia?: string; clase?: string }[];
      const renglones = new Set(g.map((x) => x.renglon));
      return g.length >= 20 && g[0].severidad === "alta" && renglones.has("Contratos con banderas") && renglones.has("Control")
        && g.filter((x) => x.clase === "hecho").every((x) => !x.enlace_vigia || x.enlace_vigia.startsWith("https://vigia.gobserva.cloud/"))
        ? null : `lo_mas_grave trae ${g.length} y renglones ${[...renglones].join(", ")}`;
    } },
  { h: historia as never, args: { tipo: "entidad", id: "20153408191", clase: "control", desde: "2022-12", solo_graves: false },
    espera: (r) => {
      const ev = lista(r, "eventos") as { renglon?: string; fecha?: string }[];
      return ev.length >= 1 && ev.every((x) => x.renglon === "Control" && String(x.fecha) >= "2022-12-01") ? null : `eventos de control desde 2022-12: ${ev.length}, alguno fuera del filtro`;
    } },
  // El cierre de gestión de San Borja (oct.-dic. 2022): la historia lo marca y dice cómo seguirlo; ordenes_en_periodo da las
  // cifras contra un año antes, con personas sólo como cuentas (2026-11-18).
  { h: historia as never, args: { tipo: "entidad", id: "20131373741" },
    espera: (r) => {
      const ps = lista(r, "patrones") as { tipo?: string; siguiente_paso?: { herramienta?: string; desde?: string; hasta?: string } }[];
      const c = ps.find((x) => x.tipo === "cierre_gestion");
      return c && c.siguiente_paso?.herramienta === "ordenes_en_periodo" && c.siguiente_paso.desde === "2022-10-01" && c.siguiente_paso.hasta === "2022-12-31"
        ? null : `sin cierre_gestion con su siguiente_paso: ${JSON.stringify(c ?? null)}`;
    } },
  // La ficha de la entidad trae los patrones de ritmo de su historia con cómo seguirlos (2026-11-18).
  { h: fichaEntidad as never, args: { ruc: "20131373741" },
    espera: (r) => {
      const rt = (r.ritmo_de_compras as { patrones?: { tipo?: string; siguiente_paso?: { herramienta?: string } }[] } | undefined)?.patrones ?? [];
      return rt.some((q) => q.tipo === "cierre_gestion" && q.siguiente_paso?.herramienta === "ordenes_en_periodo") ? null : `ritmo_de_compras: ${JSON.stringify(rt).slice(0, 200)}`;
    } },
  { h: ordenesEnPeriodo as never, args: { entidad_ruc: "20131373741", desde: "2022-10-01", hasta: "2022-12-31" },
    espera: (r) => {
      const p = r.en_el_periodo as { ordenes?: number; personas_nuevas?: number } | undefined;
      const a = r.un_anio_antes as { ordenes?: number } | undefined;
      const emp = lista(r, "empresas_que_mas_recibieron") as { ruc?: string }[];
      return p && a && (p.ordenes ?? 0) > 2 * (a.ordenes ?? 0) && (p.personas_nuevas ?? 0) > 0 && lista(r, "conceptos_que_mas_se_repiten").length > 0
        && emp.length > 0 && emp.every((e) => /^20\d{9}$/.test(String(e.ruc)))
        ? null : `periodo: ${JSON.stringify(p)} contra ${JSON.stringify(a)}, empresas ${emp.length}`;
    } },
  // Cada caso de un patrón trae su ficha propia (/app/patrones/caso/<tipo>/<clave>, 2026-11-18), con una clave opaca.
  { h: patrones as never, args: { alcance: "grupo", solo_graves: true },
    espera: (r) => {
      const gs = lista(r, "grupos") as { ficha_del_caso?: string }[];
      return gs.length >= 3 && gs.every((g) => /^https:\/\/vigia\.gobserva\.cloud\/app\/patrones\/caso\/grupos\/[0-9a-f]{16}$/.test(String(g.ficha_del_caso ?? "")))
        ? null : "algún grupo sin ficha_del_caso válida";
    } },
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
      if (!cs.every((x) => /•/.test(String(x.persona ?? "•")) && x.familiar_cercano === true
        && Number(x.ordenes_emitidas_con_la_persona_en_el_puesto ?? 0) + Number(x.procesos_que_gano_la_empresa_con_la_persona_en_el_puesto ?? 0) >= 1))
        return "un caso grave sin tapar, sin familiar cercano o sin ventas en el puesto";
      if (!cs.every((x) => x.como_cobra_el_familiar === "a su nombre" || /^20\d{9}$/.test(String(x.empresa_ruc)))) return "un caso por empresa sin su RUC 20";
      return cs.some((x) => Object.keys(x).some((k) => /nombre_del_familiar|documento|dni/i.test(k))) ? "el caso trae el nombre o el documento del familiar" : null;
    } },
  // En observación (migración 367): la autoridad electa que dejó de figurar en una empresa y lo que ésta le vendió a su entidad.
  // La ola de personas nuevas al cierre de la gestión 2022 (migración 380): entidades con cifras y su siguiente paso.
  { h: patrones as never, args: { alcance: "cierre_gestion" },
    espera: (r) => {
      const cs = lista(r, "casos") as { personas_nuevas?: number; siguiente_paso?: { desde?: string; hasta?: string } }[];
      return cs.length >= 5 && cs.every((x) => (x.personas_nuevas ?? 0) >= 20 && x.siguiente_paso?.desde === "2022-10-01" && x.siguiente_paso?.hasta === "2022-12-31")
        ? null : `casos: ${cs.length}; ${JSON.stringify(cs[0] ?? null).slice(0, 160)}`;
    } },
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
      // Un número de 8 cifras suelto, con la misma regla que publicar() (lib/privacidad.ts de la API): no cuenta el que es
      // parte de un código público (la factura «E001-12345678», la orden «O/C-…», un comprobante SIAF) ni el que va detrás
      // de una moneda. Antes la prueba marcaba esos y fallaba cada vez que la búsqueda iba sólo por palabras.
      const suelto = /(?<!(?:S\/\.?|US\$|\$|€)\s{0,2})(?<![\p{L}\d./-])\d{8}(?![\p{L}\d/-]|[.,]\d)/u;
      return rs.some((x) => suelto.test(String(x.observacion ?? ""))) ? "una observación trae un número de 8 cifras sin tapar" : null;
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
// SOLO=<texto>: sólo los casos cuyo nombre o argumentos lo contienen. VER=1: imprime la respuesta de los que fallan.
const SOLO = process.env.SOLO ?? "";
for (const c of CASOS) {
  if (SOLO && !`${c.h.nombre} ${JSON.stringify(c.args)}`.includes(SOLO)) continue;
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
    // VER8=1: dónde está ese número, para revisarlo (suele ser el número de un archivo en un enlace de gob.pe).
    if (dni && process.env.VER8) console.log("   8 dígitos en:", (sinFalsos.match(/.{0,60}(?<![\d.,A-Za-z])\d{8}(?![\d.,]).{0,20}/g) ?? []).slice(0, 3));
    const ruc10 = /(?<!\d)10\d{9}(?!\d)/.test(texto);
    if (mal || ruc10) fallos++;
    console.log(`${mal || ruc10 ? "FALLA" : "ok   "} ${c.h.nombre} ${JSON.stringify(c.args)} ${Date.now() - t0} ms, ${texto.length} bytes` +
      (mal ? ` → ${mal}` : "") + (ruc10 ? " → sale un RUC 10" : "") + (dni ? " (hay un número de 8 dígitos: revisar)" : ""));
    if ((mal || ruc10) && process.env.VER) console.log(texto.slice(0, 1500));
  } catch (e) {
    fallos++;
    console.log(`FALLA ${c.h.nombre} ${JSON.stringify(c.args)} → ${(e as Error).message.slice(0, 200)}`);
  }
}
console.log(fallos ? `${fallos} con falla` : "todas bien");
process.exit(fallos ? 1 : 0);
