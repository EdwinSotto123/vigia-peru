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
    "que señalan (penal, civil, administrativa) y el enlace al PDF. Filtra por año, tipo o palabras del título.",
  entrada: {
    ruc: rucEntidad,
    anio: z.number().int().min(2000).max(2030).optional(),
    tipo: z.enum(["penal", "civil", "administrativa"]).optional(),
    texto: z.string().min(3).max(60).optional(),
    pagina,
  },
  async ejecutar(a, cx) {
    const r = rucJuridico(a.ruc, "RUC de la entidad");
    const d = await api<Fila>(cx.env, `/corrupcion/entidad/${r}`, { anio: a.anio, tipo: a.tipo, q: a.texto, page: a.pagina, size: 20 });
    const inf = d.informes ?? {};
    return {
      ruc: r,
      total: inf.total,
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

export const HERRAMIENTAS_ENTIDAD = [gastoEntidad, planillaEntidad, visitasEntidad, obrasEntidad, informesControl, documentosZip];
