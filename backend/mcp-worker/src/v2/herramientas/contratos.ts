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
  // Un consorcio sin RUC propio llega con el código que le da el SEACE (menos de 11 cifras): no es una persona natural.
  const consorcio = !!r && /^\d{1,10}$/.test(r);
  return {
    proveedor: nombre ?? null, proveedor_ruc: empresa ? r : null,
    ...(consorcio ? { codigo_consorcio: r } : r && !empresa ? { persona_natural: true } : {}),
  };
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
    "monto, nivel de riesgo del dictamen de Vigía y tipo de señal (por ejemplo «unico_postor»; varias a la vez con todas_las_senales). Con proveedor_ruc lista los " +
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
    senal: z.string().max(200).regex(/^[a-z_]+(,[a-z_]+)*$/).optional().describe("Tipo de señal de los cruces (varios, separados por coma), por ejemplo «unico_postor», «socio_comun», «recien_fundada», «mismo_dueno» (el mismo socio gana ahí con otra empresa), «socio_de_inhabilitada» (su socio tiene otra empresa inhabilitada el día de la buena pro), «socio_con_informe_control» (un socio o representante tiene responsabilidad presunta en un informe de control de la Contraloría anterior a la buena pro), «observado_por_contraloria» (una observación de un informe de control nombra ESE proceso o la obra de ese contrato: lo que la Contraloría ya encontró ahí), «gano_tras_observacion» (la entidad le adjudicó DESPUÉS de un informe de control que observó otro proceso que ese proveedor había ganado ahí), «retencion_sobre_tope», «contrato_sobre_adjudicado», «puerta_giratoria», «renovacion_mas_cara»."),
    todas_las_senales: z.boolean().optional().describe("Con varias señales en `senal`: sólo los contratos que las tienen TODAS (por defecto, alguna). Sirve para combinar, p. ej. «unico_postor,socio_de_inhabilitada»."),
    solo_senales_graves: z.boolean().optional().describe("Sólo contratos con al menos una señal grave de los cruces."),
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
      riesgo: a.riesgo, cruce: a.senal, cruce_todas: a.todas_las_senales && a.senal ? 1 : undefined, cruces: a.solo_senales_graves ? "alta" : undefined, orden: a.orden === "puntaje" ? "score" : a.orden, page: a.pagina, size: a.por_pagina,
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
      // `postores` del OCDS son los que se REGISTRARON como participantes (29 en 1224107), no los que ofertaron (6): con
      // ese nombre se leía como competencia.
      participantes_registrados: c.postores ?? undefined,
      ofertas: c.ofertas ?? undefined,
      items: (c.items ?? []).slice(0, 15).map((i: Fila) => tomar(i, ["descripcion", "cantidad", "unidad", "montoPen", "estado"])),
      // Con la admisión, la calificación y la hora de cada oferta (los reportes del SEACE, aunque nadie haya leído el acta con
      // modelo): «a quién dejaron fuera y por qué» y «quién ofertó a la vez» salen de aquí.
      postores_detalle: (c.postoresDetalle ?? []).slice(0, 20).map((p: Fila) => ({
        ...proveedor(p.razonSocial, p.ruc), estado: p.estado, motivo: p.motivoEstado ?? undefined, oferta_soles: p.montoOferta, puntaje: p.puntaje,
        gano: p.esGanador || undefined, item: p.item,
        admitida: typeof p.admitida === "boolean" ? p.admitida : undefined,
        calificada: typeof p.calificada === "boolean" ? p.calificada : undefined,
        oferta_presentada: p.horaOferta ? `${p.fechaOferta ?? ""} ${p.horaOferta}`.trim() : undefined,
      })),
      ganadores: (c.adjudicaciones ?? []).map((g: Fila) => ({ ...proveedor(g.proveedor, g.proveedorRuc), monto_soles: g.montoPen, fecha: g.fecha, vigente: g.vigente })),
      contrato: (c.contrato?.items ?? []).slice(0, 15).map((i: Fila) => tomar(i, ["descripcion", "estado", "referencial", "adjudicado", "porcentaje"])),
      cronograma: (c.cronograma ?? []).map((x: Fila) => tomar(x, ["clave", "fecha", "hasta"])),
      documentos: (c.documentos ?? []).slice(0, 30).map((d: Fila) => tomar(d, ["titulo", "tipo", "fecha", "formato", "url"])),
      // Primero las que cuentan para el riesgo; las EN OBSERVACIÓN (migración 329) van marcadas y al final: todavía no se
      // mide cuánto aciertan, así que no deben leerse como una señal más.
      cruces: [...((c.cruces ?? []) as Fila[])].sort((a, b) => Number(a.observacion === true) - Number(b.observacion === true)).slice(0, 15)
        .map((x: Fila) => ({
          ...tomar(x, ["tipo", "etiqueta", "severidad", "fecha", "montoSoles"]),
          // De qué ganador es: con un consorcio, cada integrante trae su propia fila.
          ...proveedor(x.proveedor, x.rucProveedor), del_consorcio: x.consorcio?.nombre ?? undefined,
          en_observacion: x.observacion === true || undefined,
        })),
      cruces_en_observacion: ((c.cruces ?? []) as Fila[]).some((x) => x.observacion === true)
        ? "Las marcadas en_observacion son indicadores nuevos que se muestran con su evidencia pero no cuentan para el puntaje: indicio por revisar, no un hallazgo."
        : undefined,
      // Cada dato leído de un documento del expediente, con QUÉ ES y si se comprobó sin modelo. Úsalo para no confundir
      // un monto con otro: la experiencia exigida al postor no es el valor del proceso.
      datos_de_los_documentos: ((c.hechosDocumentos ?? []) as Fila[]).map((h) => ({
        que_es: h.tipo, segun: h.clase === "buena_pro" ? "acta de buena pro" : h.clase, valor: h.valor ?? h.fecha,
        comprobado: h.verificado === "registro" ? "coincide con el registro oficial"
          : h.verificado === "contradice_registro" ? `NO coincide con el registro oficial${h.contra != null ? ` (${h.contra})` : ""}: verificar en el documento antes de usarlo`
          : h.verificado === "plantilla" ? "lo dice el reporte que genera el propio SEACE (leído sin modelo)"
          : h.verificado === "cita" ? "la cita del documento trae ese valor"
          : h.verificado === "dos_lecturas" ? "dos lecturas independientes coinciden" : "sin comprobar: sólo contexto",
        cita: h.cita ?? undefined,
      })),
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

export const preciosDeMercado = definir({
  nombre: "precios_de_mercado",
  titulo: "Precios de mercado de un contrato, renglón por renglón",
  descripcion:
    "Lo que averiguó el laboratorio de precios de Vigía para cada renglón de un contrato (los productos que piden las bases " +
    "y firma el contrato, aunque el SEACE los registre como un solo ítem): lo que pagó el Estado por unidad, la mediana y el " +
    "rango de las ofertas de tiendas peruanas con su enlace, las veces la mediana y el veredicto; y las referencias del " +
    "Estado que se usaron (mismo CUBSO o mismas palabras: procesos, compras menores, catálogo de Perú Compras, otros " +
    "contratos leídos). Sólo hay datos de los contratos que el laboratorio ya investigó.",
  entrada: { ocid: z.string().min(1).max(64).describe("OCID o código del proceso.") },
  async ejecutar({ ocid }, cx) {
    const id = aOcid(ocid);
    const d = await api<Fila>(cx.env, `/contratos/${encodeURIComponent(id)}/precios-mercado`).catch(() => null);
    const renglones = ((d?.renglones ?? []) as Fila[]);
    if (!renglones.length) {
      return { ocid: id, nota: "El laboratorio de precios todavía no investigó este contrato. ficha_contrato trae sus renglones y precios." };
    }
    return {
      ocid: id,
      total: d!.total,
      renglones: renglones.map((r) => ({
        renglon: r.item, producto: r.producto, cantidad: r.cantidad ?? undefined, unidad: r.unidad ?? undefined, estado: r.estado,
        pagado_por_unidad: r.pagado ?? undefined, mediana_tiendas: r.mediana ?? undefined, cuartil_1: r.p25 ?? undefined, cuartil_3: r.p75 ?? undefined,
        ofertas_validas: r.validas, veces_la_mediana: r.razon ?? undefined, veredicto: r.veredicto ?? undefined, nota: r.nota ?? undefined,
        cuenta_en_el_total: r.cuenta,
        referencias_del_estado: ((r.referencias ?? []) as Fila[]).map((x) => ({ fuente: x.fuente, que: x.detalle, unidad: x.unidad ?? undefined, compras: x.n, mediana: x.mediana })),
        ofertas: ((r.ofertas ?? []) as Fila[]).slice(0, 5).map((o) => ({ tienda: o.tienda, producto: o.producto, precio_por_unidad: o.precioUnitario, enlace: o.url })),
      })),
      como_leerlo:
        "«veces_la_mediana» es lo pagado por unidad entre la mediana de las tiendas. El total sólo suma los renglones con tres " +
        "ofertas o más, sin sospecha de caja y con su cantidad; lo pagado de más, sólo donde se pagó 1,15 veces o más. Un precio de " +
        "tienda puede no incluir flete ni entrega en provincia, y un envase más chico cuesta más por unidad que al por mayor.",
      enlace: enlaces(cx.env).dictamen(id),
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

/** «orden directa», «catálogo», «compra menor», «procesos» → la clave de la API; vacío = todas. */
function viaDeCompra(texto: string | undefined): string | undefined {
  if (!texto) return undefined;
  const t = texto.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  if (/catalog|peru compras|acuerdo marco/.test(t)) return "catalogo";
  if (/menor|8 uit|cotizacion/.test(t)) return "menor";
  if (/pago|deviene|adelanto/.test(t)) return "pago";
  if (/direct|orden/.test(t)) return "directa";
  if (/proces|licitac|concurso|adjudicac|seleccion/.test(t)) return "proceso";
  if (/todas|todo/.test(t)) return undefined;
  throw new ErrorUsuario(`como: «${texto}» no es una vía. Usa proceso, catalogo, menor, directa o pago (o nada para todas).`);
}

/**
 * Las banderas de una orden (las mismas de su fila en Vigía) con lo esencial de su evidencia. Sin nombres ni documentos:
 * el pariente declarado sale por su parentesco y el cargo del funcionario (ninguno si es autoridad electa).
 */
function banderasDeOrden(o: Fila): { banderas?: Fila[] } {
  const b: Fila[] = [];
  if (o.conNepotismo) b.push({ tipo: "nepotismo", severidad: "alta", que: "el proveedor (persona natural) es pariente declarado de un funcionario de la entidad (DJI)" });
  const ps = o.parienteSocio as Fila | null;
  if (ps) {
    b.push({
      tipo: "pariente_socio", severidad: ps.severidad, parentesco: ps.parentesco, cargo_del_funcionario: ps.cargo ?? undefined,
      papel_en_la_empresa: ps.rol, en_la_empresa_desde: ps.desde ?? undefined, ordenes_desde_2023: ps.ordenes, monto_desde_2023_soles: ps.monto,
      que: "un socio, representante o directivo de la empresa es pariente que un funcionario de la entidad declaró en su DJI",
    });
  }
  // En observación (migraciones 364-370): la orden se emitió con un familiar del socio en un puesto de compras de la entidad.
  const cf = o.comprasFamiliar as Fila | null;
  if (cf) {
    b.push({
      tipo: "compras_familiar", severidad: cf.severidad, en_observacion: true, puesto_de_compras: cf.cargo, parentesco_del_familiar: cf.parentesco,
      papel_del_familiar_en_la_empresa: cf.rol, en_el_puesto_desde: cf.desde ?? undefined,
      hasta: cf.sinCese ? undefined : cf.hasta ?? undefined, sin_cese_consta_en_el_puesto_hasta: cf.sinCese ? cf.hasta ?? undefined : undefined,
      ordenes_a_la_empresa_con_la_persona_en_el_puesto: cf.ordenes ?? undefined, monto_de_esas_ordenes_soles: cf.monto ?? undefined,
      ordenes_de_antes_de_que_asumiera: cf.antes ?? undefined,
      que: "la empresa tiene como socio, representante o directivo a un familiar declarado de quien tenía un puesto de compras en la entidad, y la orden se emitió con esa persona en el puesto",
    });
  }
  const rc = o.recienCreada as Fila | null;
  if (rc) {
    b.push({
      tipo: "recien_creada", severidad: rc.severidad, alta_en_sunat: rc.alta, primera_orden_directa: rc.primera, dias_del_alta_a_la_primera_orden: rc.dias,
      ordenes_en_su_primer_anio: rc.ordenes, monto_en_su_primer_anio_soles: rc.monto, parte_de_sus_ventas_que_viene_de_esta_entidad: rc.parte ?? undefined,
      que: "la empresa recibió su primera orden directa de la entidad a 90 días o menos de inscribirse en la SUNAT",
    });
  }
  const inh = o.inhabilitacion as Fila | null;
  if (inh) b.push({ tipo: "inhabilitado", severidad: "alta", sancion: inh.tipo, resolucion: inh.resolucion, desde: inh.desde, hasta: inh.hasta ?? undefined });
  const f = o.fraccionamiento as Fila | null;
  if (f) b.push({ tipo: "fraccionamiento", severidad: f.severidad, ordenes_ese_dia: f.ordenes, suman_soles: f.total, tope_soles: f.tope, misma_descripcion: f.mismaDescripcion });
  const r = o.repetida as Fila | null;
  if (r) {
    b.push({
      tipo: "repetida", severidad: r.severidad, ordenes_iguales: r.ordenes, dias: r.dias, suman_soles: r.total, tope_soles: r.tope, devengadas: r.devengadas,
      ordenes: ((r.detalle ?? []) as Fila[]).map((d) => ({ orden: d.orden, fecha: d.fecha, estado: d.estado })),
    });
  }
  if (o.alBorde) b.push({ tipo: "al_borde_del_tope", severidad: "media", tope_soles: (o.alBorde as Fila).tope });
  for (const s of (o.senalesPersona ?? []) as Fila[]) b.push({ tipo: s.tipo, severidad: s.severidad });
  return b.length ? { banderas: b } : {};
}

export const ordenes = definir({
  nombre: "ordenes",
  titulo: "Compras y órdenes",
  descripcion:
    "Todo lo que compró una entidad o le vendió una empresa, en una sola lista: procesos, catálogo electrónico de Perú " +
    "Compras, compras menores, órdenes directas y pagos. Con totales y años. Pide entidad_ruc o proveedor_ruc (uno de los dos). " +
    "Cada orden trae sus `banderas` con la evidencia (pariente declarado que vende o que es socio de la empresa, proveedor " +
    "inhabilitado, órdenes del mismo día que pasan 8 UIT, la misma compra repetida en semanas, al borde del tope…); con " +
    "`bandera` la lista trae sólo las compras que la tienen.",
  entrada: {
    entidad_ruc: z.string().optional(),
    proveedor_ruc: z.string().optional().describe("RUC 20 de la empresa."),
    como: z.string().max(40).optional().describe("Por qué vía: proceso, catalogo, menor (compra menor), directa (orden directa) o pago."),
    con: z.string().optional().describe("RUC de la otra parte (la empresa si filtras por entidad, o al revés)."),
    anio: anio.optional(),
    bandera: z.enum(["pariente_socio", "compras_familiar", "recien_creada", "nepotismo", "repetida", "fraccionamiento", "inhabilitado", "al_borde_del_tope", "financio_campana",
                     "candidato_gobierna", "autoridad_contratada", "sobreprecio", "antecedentes", "sunat"]).optional().describe(
      "Sólo las compras con esa bandera. De la orden: pariente_socio (un socio o representante de la empresa es pariente " +
      "declarado de un funcionario de la entidad), compras_familiar (en observación: emitida a la empresa de un familiar de quien " +
      "tenía un puesto de compras en la entidad, con esa persona en el puesto), recien_creada (la empresa recibió su primera orden directa a 90 días o menos " +
      "de crearse), nepotismo (el proveedor persona es ese pariente), repetida (la misma compra " +
      "en varias órdenes de 7 a 90 días), fraccionamiento (órdenes del mismo día que pasan 8 UIT), inhabilitado, " +
      "al_borde_del_tope, financio_campana, candidato_gobierna, autoridad_contratada. sobreprecio: catálogo; antecedentes: " +
      "procesos con cruces; sunat: compras menores a empresas con problemas en SUNAT."),
    texto: z.string().min(3).max(80).optional().describe(
      "Busca TODAS estas palabras en lo que se compró, en todos los años (con sus plurales: «aniversario» encuentra «aniversarios»). " +
      "Un número solo es un número de orden («6076»). El nombre del proveedor sólo se busca en las órdenes más recientes: para " +
      "todas las de una empresa usa con=<RUC>. Para sumar el gasto en un concepto con sinónimos usa gasto_por_concepto."),
    pagina,
    por_pagina: porPagina,
  },
  async ejecutar(a, cx) {
    if (!!a.entidad_ruc === !!a.proveedor_ruc) throw new ErrorUsuario("Indica entidad_ruc o proveedor_ruc (uno de los dos).");
    const como = viaDeCompra(a.como);
    const r = await api<Fila>(cx.env, "/compras", {
      entidad: a.entidad_ruc ? rucJuridico(a.entidad_ruc) : undefined, proveedor: a.proveedor_ruc ? rucJuridico(a.proveedor_ruc) : undefined,
      como, con: a.con ? rucJuridico(a.con) : undefined, anio: a.anio, q: a.texto, bandera: a.bandera, page: a.pagina, size: a.por_pagina,
    });
    const e = enlaces(cx.env);
    const fila = (x: Fila) => {
      const base = { via: x.clase, fecha: x.fecha, monto_soles: x.monto };
      if (x.proceso) return { ...base, ocid: x.proceso.ocid, objeto: recortar(x.proceso.titulo, 140), entidad: x.proceso.entidad, ...proveedor(x.proceso.proveedor, x.proceso.proveedorRuc), enlace: e.contrato(x.proceso.ocid) };
      if (x.orden) {
        const entidadRuc = a.entidad_ruc ? rucJuridico(a.entidad_ruc) : (x.orden.entidadRuc ?? String(x.id ?? "").split(":")[1]);
        return {
          ...base, orden: x.orden.orden, tipo: x.orden.tipoOrden, objeto: recortar(x.orden.descripcion, 140), entidad: x.orden.entidad,
          ...proveedor(x.orden.contratista, x.orden.rucContratista), estado: x.orden.estado,
          ...(entidadRuc ? { enlace: e.orden(String(entidadRuc), x.orden.orden, x.fecha, x.orden.nroOrden) } : {}),
          ...banderasDeOrden(x.orden),
        };
      }
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
      ...(r.incompleto?.length
        ? { incompleto: r.incompleto, aviso_incompleto: `Faltan las compras de ${r.incompleto.join(" y ")}: la búsqueda se pasó de tiempo. Prueba con palabras más específicas o filtra por año.` }
        : {}),
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
    "cuándo se cargaron por última vez y si están al día; y de las que están rotas, detenidas o son una foto, por qué. " +
    "Úsala para fechar una conclusión o explicar por qué falta algo reciente.",
  entrada: {},
  async ejecutar(_a, cx) {
    const r = await api<Fila>(cx.env, "/estado/datos");
    return {
      fuentes: (r.fuentes ?? []).map((f: Fila) => ({
        clave: f.clave, nombre: f.nombre, que: f.que, cadencia: f.cadencia, datos_hasta: f.hasta, ultima_carga: f.ultimaCarga, estado: f.estado,
        // Lo que el estado solo no dice (rota, parada, sin_novedad, foto), con su porqué y el registro oficial.
        situacion: f.situacion ?? undefined, nota: f.nota ?? undefined, fuente_oficial: f.enlace ?? undefined,
      })),
      estados: {
        al_dia: "cargó dentro de su cadencia",
        atrasada: "no cargó a tiempo",
        error: "la última carga falló",
        fuente_vieja: "carga, pero la fuente dejó de publicar hace más de tres meses",
        manual: "se carga a mano",
      },
      situaciones: {
        rota: "el sitio oficial no responde: no hay de dónde traerla",
        parada: "Vigía detuvo su captura por ahora",
        sin_novedad: "la carga corre, pero la fuente no publica archivos nuevos",
        foto: "se cargó una vez y no se actualiza sola",
      },
      generado: r.generado,
    };
  },
});

export const HERRAMIENTAS_CONTRATOS = [buscar, buscarContratos, fichaContrato, dictamen, preciosDeMercado, comprasMenores, ordenes, senales, estadoFuentes];
