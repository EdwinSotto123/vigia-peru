// Encontrar y leer contratos: buscar, buscar_contratos, ficha_contrato, dictamen, compras_menores, ordenes, senales y
// estado_fuentes. Todo de la API pública de Vigía (ya pasada por publicar()); acá solo se recorta y se ordena.
import { z } from "zod";
import { api } from "../api";
import { AVISO, enlaces, ErrorUsuario, NOMBRES_REGION, num, ocid as aOcid, recortar, region, rucJuridico, tomar } from "../formato";
import { definir, type Contexto } from "../registro";

type Fila = Record<string, any>;

/** Un proveedor persona natural llega tapado («CARPIO ••• ABEL», «10·ref·…»): su RUC nunca sale. */
export function proveedor(nombre: unknown, ruc: unknown) {
  const r = typeof ruc === "string" ? ruc : null;
  const empresa = !!r && /^\d{11}$/.test(r) && !r.startsWith("10");
  return { proveedor: nombre ?? null, proveedor_ruc: empresa ? r : null, ...(r && !empresa ? { persona_natural: true } : {}) };
}

const pagina = z.number().int().min(1).max(50).default(1).describe("Página de resultados (empieza en 1).");
const porPagina = z.number().int().min(1).max(50).default(20).describe("Filas por página (1 a 50).");
const anio = z.number().int().min(2015).max(2030);
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha en formato AAAA-MM-DD");
const textoRegion = z.string().max(40).describe(`Departamento: ${NOMBRES_REGION.join(", ")}.`);

function nombreDepartamento(ubigeo: unknown): string | null {
  if (typeof ubigeo !== "string" || ubigeo.length < 2) return null;
  try {
    return region(ubigeo.slice(0, 2))?.nombre ?? null;
  } catch {
    return null;
  }
}

export const buscar = definir({
  nombre: "buscar",
  titulo: "Buscar en Vigía",
  descripcion:
    "Encuentra por nombre, palabra o código un contrato del Estado peruano, una entidad pública, una empresa (RUC 20), " +
    "una obra o proyecto de inversión, o un partido político. Devuelve hasta 5 por grupo con su código (OCID, RUC, CUI o " +
    "clave), que es lo que piden las demás herramientas. Úsala primero cuando solo tienes un nombre.",
  entrada: {
    texto: z.string().min(2).max(120).describe("Nombre, palabra o código: «Municipalidad de Wanchaq», «hospital Cusco», «20491221446», «1228227»."),
    tipo: z.enum(["todo", "contratos", "entidades", "empresas", "obras", "partidos"]).default("todo").describe("Qué buscar; «todo» busca en todos los grupos."),
  },
  async ejecutar({ texto, tipo }, { env }) {
    const e = enlaces(env);
    const quiere = (g: string) => tipo === "todo" || tipo === g;
    const [general, obras, partidos] = await Promise.allSettled([
      quiere("contratos") || quiere("entidades") || quiere("empresas") ? api<Fila>(env, "/buscar", { q: texto }) : Promise.resolve(null),
      quiere("obras") ? api<Fila>(env, "/proyectos/lista", { q: texto, pestana: "todos", size: 5 }) : Promise.resolve(null),
      quiere("partidos") ? api<Fila>(env, "/partidos/ranking", { q: texto.slice(0, 60), limit: 5 }) : Promise.resolve(null),
    ]);
    const g = general.status === "fulfilled" ? general.value : null;
    const o = obras.status === "fulfilled" ? obras.value : null;
    const p = partidos.status === "fulfilled" ? partidos.value : null;
    return {
      texto,
      ...(quiere("contratos") && g
        ? {
            contratos: (g.contratos ?? []).map((c: Fila) => ({
              ocid: c.ocid, titulo: c.titulo, entidad: c.entidad, monto_soles: c.montoPen || null, lugar: c.zona, enlace: e.contrato(c.ocid),
            })),
            dictamenes: (g.alertas ?? []).map((a: Fila) => ({ codigo: a.codigo, ocid: a.ocid, puntaje: a.score, objeto: a.objeto, region: a.region })),
          }
        : {}),
      ...(quiere("entidades") && g
        ? { entidades: (g.entidades ?? []).map((x: Fila) => ({ ruc: x.ruc, nombre: x.nombre, region: x.region, contratos: x.contratos, enlace: e.entidad(x.ruc) })) }
        : {}),
      ...(quiere("empresas") && g
        ? {
            empresas: (g.empresas ?? []).map((x: Fila) => ({
              ruc: x.ruc, nombre: x.nombre, departamento: x.departamento, contratos: x.contratos, ordenes: x.ordenes, enlace: e.empresa(x.ruc),
            })),
          }
        : {}),
      ...(o
        ? {
            obras: (o.data ?? []).map((x: Fila) => ({
              cui: x.cui, nombre: x.nombre, fase: x.fase, entidad: x.entidad, region: nombreDepartamento(x.region), costo_soles: x.costo,
              paralizada_desde: x.paralizadaDesde ?? undefined, enlace: e.obra(x.cui),
            })),
            obras_total: o.total,
          }
        : {}),
      ...(p
        ? {
            partidos: (p.data ?? []).map((x: Fila) => ({
              clave: x.clave, nombre: x.nombre, gobiernos_con_contratos: x.gobiernosConContratos, contratos: x.contratos, enlace: e.partido(x.clave),
            })),
          }
        : {}),
      nota: "Hasta 5 por grupo. Con el código, usa ficha_contrato, ficha_empresa, ficha_entidad, ficha_proyecto o partido.",
    };
  },
});

const filaContrato = (c: Fila, cx: Contexto) => ({
  ocid: c.ocid,
  titulo: recortar(c.titulo, 160),
  entidad: c.entidad,
  entidad_ruc: c.entidadRuc,
  tipo: c.tipo,
  modalidad: c.modalidad,
  etapa: c.etapa,
  monto_soles: c.montoPen || null,
  fecha: c.fecha,
  lugar: c.zona,
  puntaje: c.score ?? undefined,
  senales: c.banderas || undefined,
  ...proveedor(c.proveedor, c.proveedorRuc),
  enlace: enlaces(cx.env).contrato(c.ocid),
});

export const buscarContratos = definir({
  nombre: "buscar_contratos",
  titulo: "Buscar contratos",
  descripcion:
    "Lista procesos de contratación del Estado peruano (SEACE) con filtros: texto, entidad, proveedor, región, tipo, fechas, " +
    "monto, nivel de riesgo del dictamen de Vigía y tipo de señal (por ejemplo «unico_postor»). Con proveedor_ruc lista los " +
    "procesos que ganó esa empresa (CONOSCE). Devuelve el OCID de cada uno para ficha_contrato y dictamen.",
  entrada: {
    texto: z.string().max(120).optional().describe("Palabras del objeto o el código del proceso."),
    entidad_ruc: z.string().optional().describe("RUC de la entidad que compra."),
    proveedor_ruc: z.string().optional().describe("RUC 20 de la empresa ganadora."),
    region: textoRegion.optional(),
    tipo: z.enum(["bienes", "servicios", "consultoria", "obras", "directa"]).optional(),
    anio: anio.optional().describe("Año de la convocatoria (atajo de desde/hasta)."),
    desde: fecha.optional(),
    hasta: fecha.optional(),
    monto_min: z.number().min(0).optional().describe("Monto mínimo en soles."),
    monto_max: z.number().min(0).optional(),
    riesgo: z.enum(["alto", "medio", "bajo", "sin_analizar"]).optional().describe("Nivel del dictamen de Vigía (solo dictámenes publicados)."),
    senal: z.string().max(40).optional().describe("Tipo de señal de los cruces, por ejemplo «unico_postor», «socio_comun», «recien_fundada»."),
    orden: z.enum(["fecha", "monto", "puntaje"]).default("fecha"),
    pagina,
    por_pagina: porPagina,
  },
  async ejecutar(a, cx) {
    const { env } = cx;
    const desde = a.desde ?? (a.anio ? `${a.anio}-01-01` : undefined);
    const hasta = a.hasta ?? (a.anio ? `${a.anio}-12-31` : undefined);
    const entidad = a.entidad_ruc ? rucJuridico(a.entidad_ruc, "RUC de la entidad") : undefined;
    if (a.proveedor_ruc) {
      const ruc = rucJuridico(a.proveedor_ruc, "RUC del proveedor");
      const r = await api<Fila>(env, `/empresas/${ruc}/contratos`, { q: a.texto, anio: a.anio, entidad, page: a.pagina, size: a.por_pagina });
      return {
        proveedor_ruc: ruc,
        total: r.total,
        pagina: a.pagina,
        contratos: (r.data ?? []).map((c: Fila) => ({
          ocid: c.ocid, codigo: c.codigo, nomenclatura: c.nomenclatura, descripcion: recortar(c.descripcion, 160), entidad: c.entidad,
          entidad_ruc: c.entidadRuc, departamento: c.departamento, objeto: c.objeto, tipo_proceso: c.tipoProceso, fecha: c.fecha,
          monto_soles: c.monto, consorcio: c.consorcio ?? undefined, enlace: c.ocid ? enlaces(env).contrato(c.ocid) : undefined,
        })),
        fuente: "OECE (CONOSCE): procesos adjudicados a la empresa, sola o en consorcio.",
      };
    }
    const reg = region(a.region);
    const r = await api<Fila>(env, "/contratos", {
      q: a.texto, entidad, ubigeo: reg?.ubigeo, tipo: a.tipo, desde, hasta, monto_min: a.monto_min, monto_max: a.monto_max,
      riesgo: a.riesgo, cruce: a.senal, orden: a.orden === "puntaje" ? "score" : a.orden, page: a.pagina, size: a.por_pagina,
    });
    return {
      total: r.total,
      total_exacto: r.totalExacto,
      pagina: a.pagina,
      hay_mas: !!r.siguiente,
      contratos: (r.data ?? []).map((c: Fila) => filaContrato(c, cx)),
      fuente: "OECE (SEACE, Contrataciones Abiertas).",
    };
  },
});

function resumenDictamen(a: Fila | null, ocid: string, cx: Contexto) {
  if (!a) return null;
  return {
    puntaje: a.score,
    estado: a.estado,
    analizado: a.analizadoEn,
    senales: (a.banderas ?? []).length,
    principales: (a.banderas ?? []).slice(0, 3).map((b: Fila) => ({ regla: b.regla, severidad: b.severidad, evidencia: recortar(b.evidencia, 220) })),
    enlace: enlaces(cx.env).dictamen(ocid),
  };
}

export const fichaContrato = definir({
  nombre: "ficha_contrato",
  titulo: "Ficha de un contrato",
  descripcion:
    "Un proceso de contratación entero por su OCID o código: objeto, entidad, montos, cronograma, ítems, postores con su " +
    "oferta y puntaje, ganador, documentos del SEACE (bases, actas, contrato) con su enlace de descarga, cruces de datos " +
    "y el resumen del dictamen de Vigía si lo tiene.",
  entrada: { ocid: z.string().min(1).max(64).describe("OCID o código: «1228227», «OECE-1228227» o el OCID completo.") },
  async ejecutar({ ocid }, cx) {
    const id = aOcid(ocid);
    const c = await api<Fila>(cx.env, `/contratos/${encodeURIComponent(id)}`);
    const e = enlaces(cx.env);
    const fuenteOcds = (c.cruces ?? []).find((x: Fila) => typeof x.fuenteUrl === "string")?.fuenteUrl;
    return {
      ocid: c.ocid,
      nomenclatura: c.nomenclatura,
      objeto: recortar(c.descripcion ?? c.titulo, 400),
      entidad: c.entidad,
      entidad_ruc: c.entidadRuc,
      tipo: c.tipo,
      procedimiento: c.tipoProceso ?? c.modalidad,
      etapa: c.etapa,
      lugar: c.zona,
      fuente_financiamiento: c.fuenteFinanciamiento ?? undefined,
      monto_soles: c.montoPen || null,
      fecha_convocatoria: c.fecha,
      fecha_buena_pro: c.fechaBuenaPro ?? undefined,
      postores: c.postores ?? undefined,
      ofertas: c.ofertas ?? undefined,
      items: (c.items ?? []).slice(0, 15).map((i: Fila) => tomar(i, ["descripcion", "cantidad", "unidad", "montoPen", "estado"])),
      postores_detalle: (c.postoresDetalle ?? []).slice(0, 20).map((p: Fila) => ({
        ...proveedor(p.razonSocial, p.ruc), estado: p.estado, motivo: p.motivoEstado ?? undefined, oferta_soles: p.montoOferta, puntaje: p.puntaje,
        gano: p.esGanador || undefined, item: p.item,
      })),
      ganadores: (c.adjudicaciones ?? []).map((g: Fila) => ({ ...proveedor(g.proveedor, g.proveedorRuc), monto_soles: g.montoPen, fecha: g.fecha, vigente: g.vigente })),
      contrato: (c.contrato?.items ?? []).slice(0, 15).map((i: Fila) => tomar(i, ["descripcion", "estado", "referencial", "adjudicado", "porcentaje"])),
      cronograma: (c.cronograma ?? []).map((x: Fila) => tomar(x, ["clave", "fecha", "hasta"])),
      documentos: (c.documentos ?? []).slice(0, 30).map((d: Fila) => tomar(d, ["titulo", "tipo", "fecha", "formato", "url"])),
      cruces: (c.cruces ?? []).slice(0, 12).map((x: Fila) => tomar(x, ["tipo", "etiqueta", "severidad", "fecha", "montoSoles"])),
      obras: (c.obras ?? []).slice(0, 5),
      inversiones: (c.inversiones ?? []).slice(0, 5),
      dictamen: resumenDictamen(c.alerta, c.ocid, cx) ?? { estado: c.procesamiento?.estado ?? c.estadoProcesamiento ?? "sin analizar" },
      enlaces: { vigia: e.contrato(c.ocid), seace: fuenteOcds ?? `https://contratacionesabiertas.oece.gob.pe/busqueda?search=${encodeURIComponent(c.codigo ?? c.ocid)}` },
      fuente: "OECE (SEACE, OCDS y CONOSCE).",
      ...(c.alerta ? { aviso: AVISO } : {}),
    };
  },
});

export const dictamen = definir({
  nombre: "dictamen",
  titulo: "Dictamen de un contrato",
  descripcion:
    "El análisis de Vigía de un contrato: puntaje de 0 a 100, cada señal con su evidencia, la norma o el criterio que la " +
    "sustenta y su fuente, el análisis de precios de mercado y el texto del dictamen. Solo hay dictamen para los contratos " +
    "que Vigía ya analizó y publicó.",
  entrada: { ocid: z.string().min(1).max(64).describe("OCID o código del proceso.") },
  async ejecutar({ ocid }, cx) {
    const id = aOcid(ocid);
    const c = await api<Fila>(cx.env, `/contratos/${encodeURIComponent(id)}`);
    const a = c.alerta as Fila | null;
    if (!a || a.score == null) {
      return {
        ocid: c.ocid,
        estado: a?.enRevision ? "en revisión humana" : (c.procesamiento?.estado ?? c.estadoProcesamiento ?? "sin analizar"),
        nota: "Vigía todavía no publicó un dictamen de este contrato. La ficha (ficha_contrato) tiene sus datos y cruces.",
      };
    }
    const completo = await api<Fila>(cx.env, `/alertas/${encodeURIComponent(a.codigo)}/full`, { sinTraza: 1 }).catch(() => null);
    const m = a.mercado as Fila | null;
    return {
      ocid: c.ocid,
      codigo: a.codigo,
      objeto: recortar(c.descripcion ?? c.titulo, 300),
      entidad: c.entidad,
      puntaje: a.score,
      nota_puntaje: "Suma el peso de cada señal, con tope de 100: no es una probabilidad.",
      analizado: a.analizadoEn,
      modelo: a.modeloAgentes ?? undefined,
      ganador: a.ganador?.persona ? { persona_natural: true } : a.ganador ?? undefined,
      unico_postor: a.unicoPostor ?? undefined,
      monto_adjudicado_soles: num(a.montoAdjudicado),
      senales: (a.banderas ?? []).map((b: Fila) => ({
        regla: b.regla, severidad: b.severidad, evidencia: b.evidencia, norma: b.norma, fuente: b.fuenteUrl ?? undefined, verificada: b.verificada ?? undefined,
      })),
      mercado: m && m.estado !== "sin_dato"
        ? { veredicto: m.veredicto, sobreprecio_pct: m.sobreprecioPct, items: (m.items ?? []).slice(0, 10).map((i: Fila) => tomar(i, ["item", "unidad", "ofertado", "mediana", "veredicto"])) }
        : undefined,
      texto_dictamen: recortar(completo?.dictamen_markdown, 12000) ?? undefined,
      enlace: enlaces(cx.env).dictamen(c.ocid),
      aviso: AVISO,
    };
  },
});

export const comprasMenores = definir({
  nombre: "compras_menores",
  titulo: "Compras menores (hasta 8 UIT)",
  descripcion:
    "Compras del Estado de hasta 8 UIT que se cotizan en el SEACE: lista con filtros, o una entera por su id con ítems, " +
    "precios de referencia, señales (partida el mismo día, cotización cerrada en pocas horas, cerca del tope…) y su orden.",
  entrada: {
    id: z.number().int().positive().optional().describe("Id de una compra menor: devuelve su ficha completa."),
    texto: z.string().min(2).max(80).optional(),
    entidad_ruc: z.string().optional(),
    proveedor_ruc: z.string().optional().describe("RUC 20 de la empresa."),
    region: textoRegion.optional(),
    anio: z.number().int().min(2024).max(2030).optional(),
    senal: z.enum(["con", "alta", "partido_dia", "partido_anio", "tope", "ventana", "orden_antes", "cerrada", "precio", "documento", "fin_semana"]).optional()
      .describe("Solo las que tienen esa señal; «con» = cualquiera, «alta» = alguna alta."),
    pagina,
    por_pagina: porPagina,
  },
  async ejecutar(a, cx) {
    const e = enlaces(cx.env);
    if (a.id) {
      const r = await api<Fila>(cx.env, `/menores/${a.id}`);
      const m = r.menor ?? {};
      return {
        ...tomar(m, ["id", "codigo", "numero", "objeto", "descripcion", "entidad", "entidadRuc", "monto", "moneda", "estado", "fecha", "tipoInvitacion",
          "justifInvitacion", "cotizaInicio", "cotizaCierre", "cotizaHoras", "areaUsuaria", "requerimientoNombre", "tope", "sobreTope", "provEstado",
          "provCondicion", "provDesde", "provTipo", "provDiasAlGanar"]),
        ...proveedor(m.proveedor, m.proveedorRuc),
        items: (r.items ?? []).slice(0, 20).map((i: Fila) =>
          tomar(i, ["descripcion", "cubsoNombre", "unidad", "cantidad", "precioUnitario", "precioTotal", "estadoCotiza", "refMediana", "refP25", "refP75", "refN"])),
        senales: r.senales ?? m.senales,
        ordenes: (r.ordenes ?? []).slice(0, 5),
        enlace: e.menor(m.id),
        fuente: "OECE (SEACE, compras menores a 8 UIT).",
      };
    }
    const reg = region(a.region);
    const r = await api<Fila>(cx.env, "/menores", {
      q: a.texto, entidad: a.entidad_ruc ? rucJuridico(a.entidad_ruc) : undefined, proveedor: a.proveedor_ruc ? rucJuridico(a.proveedor_ruc) : undefined,
      region: reg?.nombre.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase(), anio: a.anio, senal: a.senal, page: a.pagina, size: a.por_pagina,
    });
    return {
      pagina: a.pagina,
      hay_mas: r.hayMas,
      compras: (r.data ?? []).map((m: Fila) => ({
        id: m.id, codigo: m.codigo, objeto: m.objeto, descripcion: recortar(m.descripcion, 160), entidad: m.entidad, entidad_ruc: m.entidadRuc,
        ...proveedor(m.proveedor, m.proveedorRuc), monto: m.monto, fecha: m.fecha,
        senales: (m.senales ?? []).map((s: Fila) => (typeof s === "string" ? s : s.tipo ?? s.clave ?? s.etiqueta)), enlace: e.menor(m.id),
      })),
      fuente: "OECE (SEACE, compras menores a 8 UIT).",
    };
  },
});

export const ordenes = definir({
  nombre: "ordenes",
  titulo: "Compras y órdenes",
  descripcion:
    "Todo lo que compró una entidad o le vendió una empresa, en una sola lista: procesos, catálogo electrónico de Perú " +
    "Compras, compras menores, órdenes directas y pagos. Con totales y años. Pide entidad_ruc o proveedor_ruc (uno de los dos).",
  entrada: {
    entidad_ruc: z.string().optional(),
    proveedor_ruc: z.string().optional().describe("RUC 20 de la empresa."),
    como: z.enum(["proceso", "catalogo", "menor", "directa", "pago"]).optional().describe("Por qué vía: proceso, catálogo, compra menor, orden directa o pago."),
    con: z.string().optional().describe("RUC de la otra parte (la empresa si filtras por entidad, o al revés)."),
    anio: anio.optional(),
    texto: z.string().min(3).max(80).optional(),
    pagina,
    por_pagina: porPagina,
  },
  async ejecutar(a, cx) {
    if (!!a.entidad_ruc === !!a.proveedor_ruc) throw new ErrorUsuario("Indica entidad_ruc o proveedor_ruc (uno de los dos).");
    const r = await api<Fila>(cx.env, "/compras", {
      entidad: a.entidad_ruc ? rucJuridico(a.entidad_ruc) : undefined, proveedor: a.proveedor_ruc ? rucJuridico(a.proveedor_ruc) : undefined,
      como: a.como, con: a.con ? rucJuridico(a.con) : undefined, anio: a.anio, q: a.texto, page: a.pagina, size: a.por_pagina,
    });
    const e = enlaces(cx.env);
    const fila = (x: Fila) => {
      const base = { via: x.clase, fecha: x.fecha, monto_soles: x.monto };
      if (x.proceso) return { ...base, ocid: x.proceso.ocid, objeto: recortar(x.proceso.titulo, 140), entidad: x.proceso.entidad, ...proveedor(x.proceso.proveedor, x.proceso.proveedorRuc), enlace: e.contrato(x.proceso.ocid) };
      if (x.orden) return { ...base, orden: x.orden.orden, tipo: x.orden.tipoOrden, objeto: recortar(x.orden.descripcion, 140), entidad: x.orden.entidad, ...proveedor(x.orden.contratista, x.orden.rucContratista), estado: x.orden.estado };
      if (x.catalogo) return { ...base, orden: x.catalogo.orden, acuerdo: x.catalogo.acuerdo, entidad: x.catalogo.entidad, ...proveedor(x.catalogo.proveedor, x.catalogo.proveedorRuc), estado: x.catalogo.estado, pdf: x.catalogo.pdfOrden };
      if (x.menor) return { ...base, id: x.menor.id, objeto: recortar(x.menor.descripcion, 140), entidad: x.menor.entidad, ...proveedor(x.menor.proveedor, x.menor.proveedorRuc), enlace: e.menor(x.menor.id) };
      return base;
    };
    return {
      resumen: r.resumen,
      por_via: r.facetas?.como,
      por_anio: r.facetas?.anio,
      pagina: a.pagina,
      hay_mas: r.hayMas,
      compras: (r.data ?? []).map(fila),
      fuente: "OECE (SEACE y CONOSCE), Perú Compras (catálogo) y órdenes del SEACE.",
    };
  },
});

export const senales = definir({
  nombre: "senales",
  titulo: "Señales de riesgo",
  descripcion:
    "Las señales de riesgo que encontró Vigía. vista «banderas»: cada señal de los dictámenes con su evidencia y norma, " +
    "filtrable por severidad, regla, entidad o texto (trae el conteo por regla). vista «dictamenes»: los contratos " +
    "analizados con su puntaje, filtrables por región y puntaje mínimo.",
  entrada: {
    vista: z.enum(["banderas", "dictamenes"]).default("banderas"),
    severidad: z.enum(["alta", "media", "baja"]).optional(),
    regla: z.string().max(60).optional().describe("Clave de la regla, por ejemplo «unico_postor_alto» (la lista sale en el conteo por regla)."),
    entidad_ruc: z.string().optional(),
    texto: z.string().max(80).optional().describe("Palabras del objeto o de la entidad."),
    region: textoRegion.optional().describe("Solo en la vista «dictamenes»."),
    puntaje_min: z.number().int().min(0).max(100).optional().describe("Solo en la vista «dictamenes»."),
    limite: z.number().int().min(1).max(50).default(20),
  },
  async ejecutar(a, cx) {
    const e = enlaces(cx.env);
    if (a.vista === "dictamenes") {
      const r = await api<Fila>(cx.env, "/alertas", { region: region(a.region)?.nombre, scoreMin: a.puntaje_min, conSenales: "true", limit: a.limite });
      return {
        total: r.total,
        dictamenes: (r.data ?? []).map((x: Fila) => ({
          codigo: x.codigo, ocid: x.codigoconvocatoria, objeto: recortar(x.objeto, 160), puntaje: x.score, entidad: x.entidad, entidad_ruc: x.rucEntidad,
          ...proveedor(x.proveedor, x.rucProveedor), monto_soles: x.montoSoles, fecha_buena_pro: x.fechaBuenaPro, region: x.region,
          senales: (x.banderas ?? []).map((b: Fila) => (typeof b === "string" ? b : b.regla)), enlace: e.dictamen(x.codigoconvocatoria),
        })),
        aviso: AVISO,
      };
    }
    const r = await api<Fila>(cx.env, "/senales", {
      severidad: a.severidad, regla: a.regla, entidad: a.entidad_ruc ? rucJuridico(a.entidad_ruc) : undefined, q: a.texto, limit: a.limite,
    });
    return {
      total: r.total,
      por_regla: (r.facetas?.regla ?? []).slice(0, 40),
      senales: (r.data ?? []).map((x: Fila) => ({
        regla: x.regla, etiqueta: x.etiqueta, severidad: x.severidad, evidencia: recortar(x.evidencia, 260), norma: x.norma, fuente: x.fuenteUrl ?? undefined,
        ocid: x.convocatoria, objeto: recortar(x.objeto, 120), entidad: x.entidad, ...proveedor(x.proveedor, x.rucProveedor), monto_soles: x.montoSoles,
        puntaje: x.score, region: x.region, fecha_buena_pro: x.fechaBuenaPro, enlace: e.dictamen(x.convocatoria),
      })),
      aviso: AVISO,
    };
  },
});

export const estadoFuentes = definir({
  nombre: "estado_fuentes",
  titulo: "Estado de las fuentes",
  descripcion:
    "Hasta qué fecha llegan los datos de cada fuente de Vigía (SEACE, CONOSCE, MEF, SUNAT, Contraloría, visitas, planillas…), " +
    "cuándo se cargaron por última vez y si están al día. Úsala para fechar una conclusión o explicar por qué falta algo reciente.",
  entrada: {},
  async ejecutar(_a, cx) {
    const r = await api<Fila>(cx.env, "/estado/datos");
    return {
      fuentes: (r.fuentes ?? []).map((f: Fila) => ({
        clave: f.clave, nombre: f.nombre, que: f.que, cadencia: f.cadencia, datos_hasta: f.hasta, ultima_carga: f.ultimaCarga, estado: f.estado,
      })),
      estados: {
        al_dia: "cargó dentro de su cadencia",
        atrasada: "no cargó a tiempo",
        error: "la última carga falló",
        fuente_vieja: "carga, pero la fuente dejó de publicar hace más de tres meses",
        manual: "se carga a mano",
      },
      generado: r.generado,
    };
  },
});

export const HERRAMIENTAS_CONTRATOS = [buscar, buscarContratos, fichaContrato, dictamen, comprasMenores, ordenes, senales, estadoFuentes];
