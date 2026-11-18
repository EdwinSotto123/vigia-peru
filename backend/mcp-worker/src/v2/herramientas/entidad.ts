// Todo sobre una entidad pública, más allá de su ficha: en qué gasta (MEF), su planilla, quién la visita, sus obras,
// los informes de la Contraloría y los documentos de sus contratos en un ZIP. Todo por la API (publicar()).
import { z } from "zod";
import { api } from "../api";
import { AVISO, enlaces, ErrorUsuario, ocid as aOcid, recortar, rucJuridico, tomar } from "../formato";
import { definir } from "../registro";

type Fila = Record<string, any>;

const rucEntidad = z.string().min(11).max(14).describe("RUC de la entidad (11 dígitos). Si no lo sabes, usa buscar.");
const pagina = z.number().int().min(1).max(50).default(1);

const partidas = (xs: Fila[] | undefined, n: number) =>
  (xs ?? []).slice(0, n).map((x) => ({ ...tomar(x, ["codigo", "nombre", "pim", "devengado"]) }));

export const gastoEntidad = definir({
  nombre: "gasto_entidad",
  titulo: "En qué gasta una entidad",
  descripcion:
    "El presupuesto y el gasto de una entidad en su último año del MEF (SIAF): PIM y devengado por genérica de gasto (con " +
    "sus partidas principales), por función, por fuente de financiamiento, por programa presupuestal, por proyecto de " +
    "inversión y mes a mes. Para la evolución entre años usa ficha_entidad o consultar_datos (fuente presupuesto).",
  entrada: { ruc: rucEntidad },
  async ejecutar({ ruc }, cx) {
    const r = rucJuridico(ruc, "RUC de la entidad");
    const g = await api<Fila>(cx.env, `/entidades/${r}/gasto`);
    return {
      ruc: r,
      anio: g.anio,
      origen: g.origen,
      genericas: (g.genericas ?? []).map((x: Fila) => ({ nombre: x.nombre, pim: x.pim, devengado: x.devengado, partidas: partidas(x.partidas, 6) })),
      funciones: partidas(g.funciones, 12),
      fuentes: (g.fuentes ?? []).map((x: Fila) => tomar(x, ["nombre", "pim", "devengado"])),
      programas: partidas(g.programas, 10),
      proyectos: g.proyectos
        ? { total: g.proyectos.total, pim: g.proyectos.pim, devengado: g.proyectos.devengado, principales: partidas(g.proyectos.lista, 10) }
        : undefined,
      por_mes: g.meses,
      enlace: enlaces(cx.env).entidad(r),
      fuente: "MEF, Consulta Amigable (SIAF).",
    };
  },
});

export const planillaEntidad = definir({
  nombre: "planilla_entidad",
  titulo: "Planilla de una entidad",
  descripcion:
    "Quiénes trabajan en una entidad según su planilla: cuántas personas, cuánto suma la planilla al mes, por régimen " +
    "(728, CAS, 276…), oficinas y cargos con más gente, y señales (parientes declarados, doble planilla, ascensos " +
    "rápidos, sueldos dudosos), con algunas personas de ejemplo (un apellido tapado).",
  cuenta: true,
  entrada: {
    ruc: rucEntidad,
    texto: z.string().min(3).max(60).optional().describe("Cargo, oficina o apellidos para filtrar."),
    limite: z.number().int().min(1).max(30).default(10),
  },
  async ejecutar(a, cx) {
    const r = rucJuridico(a.ruc, "RUC de la entidad");
    const p = await api<Fila>(cx.env, "/planilla", { entidad: r, q: a.texto, size: a.limite });
    const res = p.resumen ?? {};
    return {
      ruc: r,
      personas: res.personas,
      planilla_mes_soles: res.totalMes,
      ultimo_mes: res.ultimoMes,
      con_senales: res.conSenales,
      senales_altas: res.alta,
      por_regimen: res.porRegimen,
      por_senal: res.porSenal,
      oficinas: (p.facetas?.oficinas ?? []).slice(0, 12),
      cargos: (p.facetas?.cargos ?? []).slice(0, 12),
      parientes_declarados: p.facetas?.pariente,
      salieron: p.salieron,
      ejemplos: (p.data ?? []).map((x: Fila) => ({
        nombre: x.nombre, cargo: x.cargo, dependencia: x.dependencia, sueldo_mes: x.total, meses: x.meses, desde: x.primerMes,
        hasta: x.ultimoMes, senales: (x.senales ?? []).map((s: Fila) => (typeof s === "string" ? s : s.etiqueta ?? s.tipo)),
        enlace: x.ficha ? enlaces(cx.env).planilla(x.ficha) : undefined,
      })),
      fuente: "Planillas del Portal de Transparencia Estándar (PTE).",
    };
  },
});

export const visitasEntidad = definir({
  nombre: "visitas_entidad",
  titulo: "Visitas a una entidad",
  descripcion:
    "Quién visita una entidad según su registro de visitas: totales, cuántas fueron a quienes deciden, fuera de hora o " +
    "largas, las organizaciones y empresas que más la visitan, las empresas que ganaron contratos después de visitarla " +
    "y las áreas más visitadas. Las personas salen con un apellido tapado.",
  cuenta: true,
  entrada: { ruc: rucEntidad },
  async ejecutar({ ruc }, cx) {
    const r = rucJuridico(ruc, "RUC de la entidad");
    const v = await api<Fila>(cx.env, `/visitas/entidad/${r}`);
    if (!v.total) return { ruc: r, total: 0, nota: "La entidad no tiene visitas registradas en la plataforma de transparencia." };
    return {
      ruc: r,
      total: v.total,
      desde: v.desde,
      hasta: v.hasta,
      resumen: v.resumen,
      organizaciones: (v.organizaciones ?? []).slice(0, 20).map((o: Fila) =>
        tomar(o, ["org", "empresa", "ruc", "tipo", "visitas", "visitantes", "decisores", "primera", "ultima", "despuesTipo", "despuesMonto"])),
      empresas: v.empresas
        ? {
            visitaron: v.empresas.empresas, ganaron_despues: v.empresas.ganaron, primera_vez: v.empresas.primeraVez,
            ejemplos: (v.empresas.lista ?? []).slice(0, 15),
          }
        : undefined,
      areas: (v.areas ?? []).slice(0, 12),
      fuente: "Registro de visitas de la Plataforma Nacional de Transparencia.",
    };
  },
});

export const obrasEntidad = definir({
  nombre: "obras_entidad",
  titulo: "Obras de una entidad",
  descripcion:
    "Las obras públicas de una entidad en INFOBRAS (Contraloría): estado, modalidad, monto, avance físico y financiero, " +
    "adicionales, ampliaciones de plazo, paralización y su causa, ejecutor y supervisor, con conteos por estado y por señal.",
  entrada: {
    ruc: rucEntidad,
    estado: z.enum(["ejecucion", "paralizada", "finalizada", "sin_ejecucion"]).optional(),
    senal: z.enum(["con", "alta", "paralizada", "paralizacion", "atraso", "adicionales", "adicionales_tope", "plazo", "controversia", "control"]).optional(),
    pagina,
  },
  async ejecutar(a, cx) {
    const r = rucJuridico(a.ruc, "RUC de la entidad");
    const o = await api<Fila>(cx.env, "/obras", { entidad: r, estado: a.estado, bandera: a.senal, page: a.pagina, size: 15 });
    return {
      ruc: r,
      total: o.total,
      hay_mas: o.hayMas,
      al_dia: o.alDia,
      por_estado: o.facetas?.estado,
      por_senal: o.facetas?.bandera,
      por_modalidad: o.facetas?.modalidad,
      obras: (o.data ?? []).map((x: Fila) => ({
        codigo_infobras: x.codigo, cui: x.cui, nombre: recortar(x.nombre, 160), estado: x.estado, modalidad: x.modalidad, tipo: x.tipo,
        ejecutor: x.ejecutor ?? undefined, supervisor: x.supervisor ?? undefined, montos: x.montos, avance: x.avance, plazo: x.plazo,
        paralizacion: x.paralizacion, adicionales: x.adicionales, informes_control: x.informesControl || undefined,
        enlace: x.cui ? enlaces(cx.env).obra(x.cui) : undefined,
      })),
      fuente: "INFOBRAS (Contraloría) e Invierte.pe (MEF).",
    };
  },
});

export const informesControl = definir({
  nombre: "informes_control",
  titulo: "Informes de la Contraloría",
  descripcion:
    "Los informes de control de la Contraloría sobre una entidad, con su número, título, fecha, el tipo de responsabilidad " +
    "que señalan (penal, civil, administrativa) y el enlace al PDF. De cada uno, lo que dice su Ficha Resumen: objetivo, " +
    "montos, observaciones (con su tema) y los funcionarios comprendidos con su responsabilidad PRESUNTA (un apellido " +
    "tapado). Si una observación nombra un proceso que está en Vigía, trae `enVigia` con su OCID: ábrelo con " +
    "ficha_contrato. Trae también `observado`: cuántas observaciones se leyeron y cuánto perjuicio cuantifican, por tema. " +
    "Filtra por año, tipo o palabras del título. SIN ruc: el mapa nacional de lo observado (por tema, por año y las " +
    "entidades con más perjuicio señalado; con `tema`, el ranking de ese tema). Para buscar por el contenido de las " +
    "observaciones en todo el país, usa buscar_informes_control.",
  entrada: {
    ruc: rucEntidad.optional().describe("RUC de la entidad (11 dígitos). Sin él, el mapa nacional de lo observado."),
    tema: z.enum(["seleccion_contratacion", "ejecucion_contractual", "pagos_adelantos", "personal_planillas", "bienes_almacen", "presupuesto_tesoreria", "otros"])
      .optional().describe("(sin ruc) Sólo las entidades con más perjuicio señalado en ese tema."),
    anio: z.number().int().min(2000).max(2030).optional(),
    tipo: z.enum(["penal", "civil", "administrativa"]).optional(),
    texto: z.string().min(3).max(60).optional(),
    pagina,
  },
  async ejecutar(a, cx) {
    if (!a.ruc) {
      const m = await api<Fila>(cx.env, "/informes-control/resumen", { tema: a.tema, n: 30 });
      const t = (m.total ?? {}) as Fila;
      return {
        alcance: "todo el país",
        tema: m.tema ?? undefined,
        informes_de_control: t.informes, informes_leidos: t.leidos, observaciones_leidas: t.observaciones,
        observaciones_que_cuantifican_perjuicio: t.conPerjuicio, perjuicio_cuantificado_soles: t.perjuicioPen,
        perjuicio_cuantificado_dolares: t.perjuicioUsd || undefined, contratos_de_vigia_nombrados: t.contratos,
        por_tema: ((m.porTema ?? []) as Fila[]).map((x) => ({ tema: x.tema, nombre: x.temaTexto, observaciones: x.observaciones, informes: x.informes, perjuicio_soles: x.perjuicioPen })),
        por_anio: ((m.porAnio ?? []) as Fila[]).map((x) => ({ anio: x.anio, informes: x.informes, observaciones: x.observaciones, perjuicio_soles: x.perjuicioPen })),
        entidades_con_mas_perjuicio_senalado: ((m.entidades ?? []) as Fila[]).map((x) => ({
          entidad: x.entidad, ruc: x.ruc, departamento: x.departamento ?? undefined, informes_leidos: x.informes, observaciones: x.observaciones,
          perjuicio_soles: x.perjuicioPen, informes_con_penal_presunta: x.penal, contratos_de_vigia_nombrados: x.contratos,
          lo_que_mas_se_le_observa: x.temaPrincipalTexto, enlace: x.enlace,
        })),
        como_leerlo:
          "El perjuicio es el que cuantifica cada observación según una lectura automática (IA) de su Ficha Resumen: un orden de " +
          "magnitud para saber dónde mirar, no una liquidación; un monto repetido en varias observaciones de un informe se cuenta " +
          "una vez. Para los informes de una entidad, llama de nuevo con su ruc; para los proveedores de los procesos observados, " +
          "patrones con alcance «observado».",
        fuente: "Contraloría General de la República (Fichas Resumen de los informes de control, leídas con GLM 5.3 flash).",
        aviso: "Un informe de control señala presunta responsabilidad; no es una sentencia.",
      };
    }
    const r = rucJuridico(a.ruc, "RUC de la entidad");
    const d = await api<Fila>(cx.env, `/corrupcion/entidad/${r}`, { anio: a.anio, tipo: a.tipo, q: a.texto, page: a.pagina, size: 20 });
    const inf = d.informes ?? {};
    const obs = inf.observado as Fila | null | undefined;
    return {
      ruc: r,
      total: inf.total,
      observado: obs
        ? {
            observaciones_leidas: obs.observaciones, perjuicio_cuantificado_soles: obs.perjuicioPen, contratos_de_vigia_nombrados: obs.contratos,
            por_tema: ((obs.porTema ?? []) as Fila[]).map((x) => ({ tema: x.tema, nombre: x.temaTexto, observaciones: x.observaciones, perjuicio_soles: x.perjuicioPen })),
          }
        : undefined,
      responsabilidad: { penal: inf.penal, civil: inf.civil, administrativa: inf.administrativa },
      funcionarios_comprendidos: inf.funcionarios,
      desde: inf.desde,
      hasta: inf.hasta,
      informes: (inf.pagina?.filas ?? []).map((x: Fila) => ({ ...x })),
      procuraduria_departamento: d.procuraduria
        ? tomar(d.procuraduria as Fila, ["corte", "en_tramite", "sentencias", "casos_nuevos", "en_ejecucion", "reparacion_civil", "url_fuente"])
        : undefined,
      fuente: "Contraloría General de la República (informes de servicios de control) y Procuraduría Anticorrupción.",
      aviso: "Un informe de control señala presunta responsabilidad; no es una sentencia.",
    };
  },
});

export const buscarInformesControl = definir({
  nombre: "buscar_informes_control",
  titulo: "Buscar en los informes de la Contraloría",
  descripcion:
    "Busca, por palabras y por significado, en las observaciones de los informes de control de la Contraloría de todo el " +
    "país (sus Fichas Resumen): «pagos por partidas no ejecutadas», «fraccionamiento en compras de combustible», " +
    "«adicionales de obra sin sustento». Cada resultado es una observación con su tema, el número y la entidad del informe, " +
    "la fecha, la responsabilidad que señala (PRESUNTA) y el enlace a su ficha. Sirve para encontrar precedentes de un " +
    "hecho y qué entidades tuvieron observaciones parecidas. Filtra por entidad (RUC o nombre) y por fecha mínima.",
  entrada: {
    pregunta: z.string().min(3).max(300).describe("Lo que buscas, en palabras normales."),
    entidad: z.string().min(3).max(120).optional().describe("RUC de 11 dígitos o palabras del nombre de la entidad."),
    desde: z.string().regex(/^(19|20)\d{2}(-\d{2}-\d{2})?$/).optional().describe("Año (AAAA) o fecha (AAAA-MM-DD) mínima de emisión."),
    n: z.number().int().min(1).max(30).default(10),
  },
  async ejecutar(a, cx) {
    const d = await api<Fila>(cx.env, "/informes-control/buscar", { q: a.pregunta, entidad: a.entidad, desde: a.desde, n: a.n });
    return {
      pregunta: a.pregunta,
      modo: d.modo,
      resultados: ((d.resultados ?? []) as Fila[]).map((x) => ({
        informe: x.numero ?? x.codigo, codigo: x.codigo, titulo: x.titulo, entidad: x.entidad, entidad_ruc: x.entidadRuc, fecha: x.fecha,
        modalidad: x.modalidad, responsabilidad_presunta: x.responsabilidades, tema: x.temaTexto ?? x.tema, observacion: x.observacion,
        ficha: x.urlFicha ?? undefined, enlace_entidad: x.enlace ?? undefined,
      })),
      nota: d.nota,
      aviso: "Un informe de control señala presunta responsabilidad; no es una sentencia.",
    };
  },
});

export const documentosZip = definir({
  nombre: "documentos_zip",
  titulo: "Documentos de contratos en ZIP",
  descripcion:
    "Junta en un ZIP los documentos que Vigía guardó del SEACE (bases, actas de buena pro, contratos, consultas…) de hasta " +
    "10 procesos, con un indice.csv. Devuelve la lista de archivos, el peso y el enlace de descarga. Para elegir los " +
    "procesos usa antes buscar_contratos, ordenes o senales.",
  entrada: {
    ocids: z.array(z.string().min(1).max(64)).min(1).max(10).describe("OCID o códigos de los procesos, por ejemplo [\"1228227\", \"1226434\"]."),
  },
  async ejecutar({ ocids }, cx) {
    const lista = ocids.map(aOcid);
    const params = new URLSearchParams();
    for (const o of lista) params.append("ocid", o);
    const d = await api<Fila>(cx.env, `/documentos/indice?${params.toString()}`);
    const docs = (d.documentos ?? []) as Fila[];
    if (!docs.length) {
      throw new ErrorUsuario("Vigía no tiene guardado ningún documento de esos procesos. Sus documentos se guardan cuando Vigía los analiza; los originales están en el SEACE.");
    }
    return {
      procesos: d.procesos,
      sin_documentos: d.sin_documentos,
      archivos: docs.map((x) => ({ archivo: x.archivo, titulo: x.titulo, formato: x.formato, mb: x.bytes ? Math.round((x.bytes / 1048576) * 10) / 10 : null })),
      total_mb: Math.round((Number(d.total_bytes ?? 0) / 1048576) * 10) / 10,
      descargar_zip: d.cabe_en_un_zip ? `${cx.env.VIGIA_URL}${d.zip}` : undefined,
      nota: d.cabe_en_un_zip
        ? "El enlace arma el ZIP al abrirlo (puede tardar unos segundos por cada 50 MB). Incluye indice.csv con el enlace al SEACE de cada documento."
        : "Pesa más de 300 MB: pide menos procesos por ZIP.",
      aviso: AVISO,
    };
  },
});

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha como AAAA-MM-DD.");

/**
 * Las órdenes de una entidad en un periodo frente al mismo periodo un año antes (API /ordenes/ventana, 2026-11-18): para
 * seguir un patrón de la historia (un pico, el cierre de una gestión, diciembre) hasta lo que se compró y a quién.
 */
export const ordenesEnPeriodo = definir({
  nombre: "ordenes_en_periodo",
  titulo: "Órdenes de una entidad en un periodo",
  descripcion:
    "Las órdenes de compra y de servicio de una entidad entre dos fechas (hasta un año), comparadas con las mismas fechas " +
    "un año antes: cuántas y por cuánto, cuántas fueron a personas naturales y a cuántas personas, cuántas de ellas NUNCA " +
    "habían recibido una orden de esa entidad desde 2018 (personas nuevas), cuántas empresas y cuáles nuevas, los conceptos " +
    "que más se repiten y las empresas que más recibieron. Úsala para seguir un patrón de `historia` (un pico, el cierre de " +
    "una gestión, diciembre): sus fechas `mes` y `hasta` son el periodo. Una ola de personas nuevas al final de una gestión " +
    "es lo que más se revisa (contrataciones por favores de campaña), pero puede tener razones legítimas. De las personas " +
    "naturales sólo hay cuentas, nunca nombres.",
  entrada: {
    entidad_ruc: rucEntidad,
    desde: fecha.describe("Primer día del periodo (AAAA-MM-DD; desde 2019)."),
    hasta: fecha.describe("Último día del periodo (AAAA-MM-DD; a lo sumo un año después de `desde`)."),
  },
  async ejecutar(a, cx) {
    const r = rucJuridico(a.entidad_ruc, "RUC de la entidad");
    if (a.hasta < a.desde) throw new ErrorUsuario("`hasta` va después de `desde`.");
    if (a.desde < "2019-01-01") throw new ErrorUsuario("Desde 2019: las órdenes empiezan en 2018 y se comparan con un año antes.");
    if ((Date.parse(a.hasta) - Date.parse(a.desde)) / 86_400_000 > 366) throw new ErrorUsuario("El periodo puede ser de un año como mucho.");
    const v = await api<Fila>(cx.env, "/ordenes/ventana", { entidad: r, desde: a.desde, hasta: a.hasta });
    const cifras = (c: Fila) => ({
      ordenes: c.ordenes, monto_soles: c.monto, meses_con_ordenes: c.mesesConOrdenes,
      ordenes_a_personas_naturales: c.ordenesAPersonas, monto_a_personas_soles: c.montoAPersonas,
      personas_naturales: c.personas, personas_nuevas: c.personasNuevas, ordenes_a_personas_nuevas: c.ordenesAPersonasNuevas,
      empresas: c.empresas, empresas_nuevas: c.empresasNuevas, monto_a_empresas_nuevas_soles: c.montoEmpresasNuevas,
    });
    const veces = (x: number, y: number) => (y > 0 ? Math.round((x / y) * 10) / 10 : null);
    const ven = v.ventana as Fila;
    const ant = v.unAnioAntes as Fila;
    return {
      entidad: v.entidad?.nombre ?? r, entidad_ruc: r,
      periodo: { desde: v.desde, hasta: v.hasta },
      comparado_con: v.comparadoCon,
      en_el_periodo: cifras(ven),
      un_anio_antes: cifras(ant),
      cambio: {
        ordenes_veces: veces(ven.ordenes, ant.ordenes),
        ordenes_a_personas_veces: veces(ven.ordenesAPersonas, ant.ordenesAPersonas),
        personas_veces: veces(ven.personas, ant.personas),
        personas_nuevas_veces: veces(ven.personasNuevas, ant.personasNuevas),
      },
      // En 2026 publican sus órdenes en CONOSCE menos entidades que en 2025: una baja puede ser falta de datos.
      aviso_datos: (ven.mesesConOrdenes ?? 0) < (ant.mesesConOrdenes ?? 0)
        ? `La entidad publicó órdenes en ${ven.mesesConOrdenes} meses del periodo y en ${ant.mesesConOrdenes} un año antes: pueden faltar órdenes del periodo (no leas una baja como un hecho).`
        : undefined,
      conceptos_que_mas_se_repiten: ((v.conceptos ?? []) as Fila[]).map((c) => ({
        concepto: c.concepto, ordenes: c.ordenes, monto_soles: c.monto, personas_naturales: c.personas, empresas: c.empresas,
      })),
      empresas_que_mas_recibieron: ((v.empresas ?? []) as Fila[]).map((e) => ({
        empresa: e.empresa, ruc: e.ruc, ordenes: e.ordenes, monto_soles: e.monto,
        nueva_para_la_entidad: e.nueva, enlace: enlaces(cx.env).empresa(e.ruc),
      })),
      como_leerlo:
        "«Nueva» es que no había recibido ninguna orden de esta entidad desde 2018 antes del periodo. El concepto son las " +
        "primeras palabras de la descripción de la orden (sólo los que comparten tres proveedores o más). Las personas " +
        "naturales van sólo como cuentas. Una subida es un motivo para revisar, no una acusación.",
      enlace: `${enlaces(cx.env).entidad(r)}?seccion=historia`,
      // La lista de esas órdenes en Vigía (vista Órdenes con el periodo como filtro; las personas, con un apellido tapado).
      enlace_ordenes_a_personas: `${cx.env.VIGIA_URL}/app/contratos?vista=ordenes&oent=${r}&operiodo=${v.desde}_${v.hasta}&oper=natural`,
      enlace_todas_las_ordenes: `${cx.env.VIGIA_URL}/app/contratos?vista=ordenes&oent=${r}&operiodo=${v.desde}_${v.hasta}`,
      fuente: "CONOSCE (OECE): órdenes de compra y de servicio.",
    };
  },
});

export const HERRAMIENTAS_ENTIDAD = [gastoEntidad, planillaEntidad, visitasEntidad, obrasEntidad, informesControl, buscarInformesControl, documentosZip, ordenesEnPeriodo];

export const gastoPorConcepto = definir({
  nombre: "gasto_por_concepto",
  titulo: "Gasto por concepto",
  descripcion:
    "Cuánto gastó una entidad (o le vendió una empresa, o gastaron las entidades de una región) en un concepto dicho con " +
    "palabras: suma órdenes de compra y servicio, procesos adjudicados y compras menores cuya descripción tiene ALGUNO de " +
    "los términos (búsqueda en español: plural, prefijo y frases). Devuelve total, monto por año y por proveedor, cuánto " +
    "aportó cada término y las compras más grandes. Pasa varios términos alternativos y sinónimos (por ejemplo «sonido, " +
    "parlante, audio, amplificación, luces, escenario, tarima») y usa excluir para quitar lo que no es del concepto.",
  entrada: {
    terminos: z.array(z.string().max(60)).min(1).max(40).describe("Palabras o frases alternativas del concepto (se suman con O; se usan las 20 primeras)."),
    excluir: z.array(z.string().max(60)).max(40).default([]).describe("Palabras que sacan una compra del concepto (por ejemplo «mantenimiento»; se usan las 15 primeras)."),
    entidad_ruc: z.string().optional().describe("RUC de la entidad que compra."),
    proveedor_ruc: z.string().optional().describe("RUC 20 de la empresa que vende."),
    region: z.string().max(40).optional().describe("Departamento (todas sus entidades; hasta 3 años)."),
    desde: z.number().int().min(2015).max(2030).optional().describe("Año desde (por defecto, 4 años antes de hasta)."),
    hasta: z.number().int().min(2015).max(2030).optional().describe("Año hasta (por defecto, el actual)."),
    fuentes: z.array(z.enum(["ordenes", "procesos", "menores"])).default(["ordenes", "procesos", "menores"]),
  },
  async ejecutar(a, cx) {
    const alcances = [a.entidad_ruc, a.proveedor_ruc, a.region].filter(Boolean).length;
    if (alcances !== 1) throw new ErrorUsuario("Indica uno: entidad_ruc, proveedor_ruc o region.");
    const limpiar = (xs: string[], max: number) =>
      Array.from(new Set(xs.map((t) => t.replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 40)).filter((t) => t.length >= 3))).slice(0, max);
    const incl = limpiar(a.terminos, 20);
    const excl = limpiar(a.excluir, 15);
    if (!incl.length) throw new ErrorUsuario("Pasa al menos un término de 3 letras o más.");
    const d = await api<Fila>(cx.env, "/gasto/concepto", {
      terminos: incl.join(","),
      excluir: excl.join(",") || undefined,
      entidad: a.entidad_ruc ? rucJuridico(a.entidad_ruc, "RUC de la entidad") : undefined,
      proveedor: a.proveedor_ruc ? rucJuridico(a.proveedor_ruc, "RUC del proveedor") : undefined,
      region: a.region,
      desde: a.desde,
      hasta: a.hasta,
      fuentes: a.fuentes.join(","),
    });
    const e = enlaces(cx.env);
    const fuentes = Object.fromEntries(
      Object.entries((d.por_fuente ?? {}) as Record<string, Fila>).map(([k, f]) => [k, {
        total: f.total,
        por_anio: f.por_anio,
        por_termino: f.por_termino,
        por_proveedor: ((f.por_proveedor ?? []) as Fila[]).map((p) => (p.ruc
          ? { ...p, enlace: e.empresa(p.ruc) }
          : { ruc: null, nombre: "Personas naturales y otros", registros: p.registros, monto: p.monto })),
        mayores: ((f.mayores ?? []) as Fila[]).map((m) => ({
          fecha: m.fecha, descripcion: m.descripcion, monto: m.monto, referencia: m.ref, entidad: m.entidad, dudoso: m.dudoso || undefined,
          proveedor: m.ruc ? m.proveedor : "Persona natural u otro", proveedor_ruc: m.ruc ?? undefined,
          enlace: k === "procesos" && m.ref ? e.contrato(String(m.ref))
            : k === "menores" && m.ref ? e.menor(String(m.ref))
            : k === "ordenes" && m.entidad_ruc ? e.orden(String(m.entidad_ruc), m.ref, m.anio ?? m.fecha, m.nro)
            : undefined,
          ...(a.region && m.entidad_ruc ? { enlace_entidad: e.entidad(String(m.entidad_ruc)) } : {}),
        })),
      }]),
    );
    return { alcance: d.alcance, desde: d.desde, hasta: d.hasta, terminos: d.terminos, excluidos: d.excluidos, total: d.total, por_fuente: fuentes, nota: d.nota, fuente_oficial: d.fuente_oficial };
  },
});

HERRAMIENTAS_ENTIDAD.push(gastoPorConcepto);

const METRICAS_RANKING = [
  "pct_unico_postor", "pct_directas", "pct_top5_proveedores", "pct_personas_naturales", "pct_diciembre", "pct_borde_tope",
  "pct_ejecucion", "pct_ejecucion_actual", "informes_penal", "pct_obras_paralizadas", "gasto_eventos", "gasto_alimentos",
  "gasto_publicidad", "gasto_regalos", "gasto_viajes", "gasto_asesorias", "gasto_alquiler_vehiculos", "gasto_uniformes",
  "gasto_telefonia", "gasto_mantenimiento_vehiculos", "gasto_alquiler_maquinaria", "monto_adjudicado", "procesos",
  "monto_ordenes", "pim",
] as const;

export const hallazgosEntidad = definir({
  nombre: "hallazgos_entidad",
  titulo: "Lo raro de una entidad frente a sus pares",
  descripcion:
    "Compara una entidad con entidades parecidas (mismo tipo y tamaño de presupuesto) desde 2023 y devuelve lo que se sale " +
    "de lo normal: único postor, contratación directa, concentración de proveedores, órdenes a personas naturales, gasto en " +
    "diciembre, órdenes al borde del tope, ejecución del presupuesto, informes de control, obras paralizadas y gasto en " +
    "eventos, alimentos, publicidad y regalos. Cada hallazgo trae su valor, la mediana y el percentil de los pares, y qué " +
    "herramienta usar para profundizar. Úsala primero para «¿qué es lo más raro de…?».",
  entrada: { ruc: rucEntidad },
  async ejecutar({ ruc }, cx) {
    const r = rucJuridico(ruc, "RUC de la entidad");
    const d = await api<Fila>(cx.env, `/entidades/${r}/hallazgos`);
    const corta = (m: Fila) => ({
      clave: m.clave, titulo: m.titulo, valor: m.valor, unidad: m.unidad, mediana_pares: m.mediana_pares, p90_pares: m.p90_pares,
      percentil: m.percentil, veces_mediana: m.veces_mediana, base: m.base, explicacion: m.explicacion, profundizar: m.profundizar,
    });
    return {
      entidad: d.entidad,
      grupo: d.grupo,
      banda: d.banda,
      pares: d.pares,
      periodo: d.periodo,
      hallazgos: ((d.hallazgos ?? []) as Fila[]).map(corta),
      otras_metricas: ((d.metricas ?? []) as Fila[]).filter((m) => !m.hallazgo).map((m) => ({
        clave: m.clave, titulo: m.titulo, valor: m.valor, unidad: m.unidad, mediana_pares: m.mediana_pares, percentil: m.percentil,
      })),
      nota: d.nota,
      enlace: enlaces(cx.env).entidad(r),
      aviso: "Salirse de lo normal no prueba una irregularidad: es una pista para revisar.",
    };
  },
});

export const rankingEntidades = definir({
  nombre: "ranking_entidades",
  titulo: "Ranking de entidades por una métrica",
  descripcion:
    "Las entidades con el valor más alto (o más bajo) de una métrica dentro de su tipo (municipalidades distritales, " +
    "provinciales, gobiernos regionales, salud, educación, universidades…), opcionalmente en una región o banda de " +
    "presupuesto: por ejemplo «qué municipalidades distritales gastan más en eventos» o «qué gobiernos regionales ejecutan " +
    "menos su presupuesto». Trae valor, percentil y mediana del grupo.",
  entrada: {
    metrica: z.string().max(60).describe(`Clave de la métrica: ${METRICAS_RANKING.join(", ")} o gasto_<concepto> (la lista completa sale en hallazgos_entidad).`),
    grupo: z.string().max(40).describe("municipalidad_distrital, municipalidad_provincial, gobierno_regional, nacional, salud, educacion, universidad, organismo_municipal, empresa_publica u otros."),
    region: z.string().max(40).optional(),
    banda: z.number().int().min(1).max(3).optional().describe("Tercio de presupuesto dentro del grupo: 1 menor, 2 medio, 3 mayor."),
    orden: z.enum(["desc", "asc"]).default("desc"),
    limite: z.number().int().min(1).max(50).default(15),
  },
  async ejecutar(a, cx) {
    const d = await api<Fila>(cx.env, "/hallazgos/ranking", {
      metrica: a.metrica.trim().toLowerCase(), grupo: a.grupo.toLowerCase().replace(/\s+/g, "_"), region: a.region, banda: a.banda, orden: a.orden, limite: a.limite,
    });
    return {
      ...d,
      filas: ((d.filas ?? []) as Fila[]).map((f) => ({ ...f, enlace: f.ruc ? enlaces(cx.env).entidad(f.ruc) : undefined })),
      aviso: "Un valor alto no prueba una irregularidad: es una pista para revisar.",
    };
  },
});

HERRAMIENTAS_ENTIDAD.push(hallazgosEntidad, rankingEntidades);

/** Lo que el modelo suele pedir con otro nombre → los `tipo` y `origen` de GET /documentos/buscar (lib/rag.ts). */
const TIPO_DOCUMENTO: Record<string, { tipo?: string; origen?: string }> = {
  bases: { tipo: "bases" }, acta: { tipo: "buena_pro" }, buena_pro: { tipo: "buena_pro" }, consultas: { tipo: "consultas" },
  pliego: { tipo: "consultas" }, contrato: { tipo: "contrato" }, adenda: { tipo: "contrato_anexo" }, anexo: { tipo: "contrato_anexo" },
  evaluacion: { tipo: "evaluacion" }, dictamen: { origen: "dictamen" }, informe: { origen: "informe_control" },
  informe_control: { origen: "informe_control" }, contraloria: { origen: "informe_control" }, lectura: { origen: "lectura" },
  documento: { origen: "documento" },
};
function tipoDocumento(t?: string): { tipo?: string; origen?: string } {
  if (!t) return {};
  const k = t.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, "_").replace(/s$/, "");
  return TIPO_DOCUMENTO[k] ?? TIPO_DOCUMENTO[`${k}s`] ?? {};
}

export const buscarDocumentos = definir({
  nombre: "buscar_documentos",
  titulo: "Buscar en el texto de los documentos",
  descripcion:
    "Busca en el TEXTO de los documentos de los contratos (bases, actas de buena pro, contratos, consultas), en las " +
    "lecturas que la IA hizo de ellos y en los dictámenes de Vigía: por palabras y por significado. Sirve para preguntas " +
    "sobre su contenido («qué exigían las bases», «por qué descalificaron a un postor», «qué marca pedían», «qué dice el " +
    "dictamen sobre…»). Filtra por proceso, entidad, tipo o años. Devuelve fragmentos con su documento, página y enlace.",
  entrada: {
    pregunta: z.string().min(3).max(300).describe("Lo que buscas, en palabras normales."),
    ocid: z.string().max(64).optional().describe("Solo en los documentos de este proceso."),
    entidad_ruc: z.string().optional(),
    tipo: z.string().max(40).optional()
      .describe("bases, acta (buena pro), consultas, contrato, evaluacion, dictamen, informe (de la Contraloría) o lectura (lo que leyó la IA)."),
    desde: z.number().int().min(2015).max(2030).optional(),
    hasta: z.number().int().min(2015).max(2030).optional(),
    limite: z.number().int().min(1).max(20).default(8),
  },
  async ejecutar(a, cx) {
    const { tipo, origen } = tipoDocumento(a.tipo);
    const d = await api<Fila>(cx.env, "/documentos/buscar", {
      q: a.pregunta, ocid: a.ocid ? aOcid(a.ocid) : undefined, entidad: a.entidad_ruc ? rucJuridico(a.entidad_ruc, "RUC de la entidad") : undefined,
      tipo, origen, desde: a.desde, hasta: a.hasta, limite: a.limite,
    });
    const e = enlaces(cx.env);
    return {
      ...d,
      resultados: ((d.resultados ?? []) as Fila[]).map((r) => ({ ...r, ficha: r.ocid ? e.contrato(String(r.ocid)) : undefined })),
      aviso: "Fragmentos de documentos públicos del SEACE y de análisis de Vigía: cita el documento y la página.",
    };
  },
});

HERRAMIENTAS_ENTIDAD.push(buscarDocumentos);
