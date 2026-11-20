// Gobserva Salud (salud.gobserva.cloud, 2026-11-20): verificar establecimientos de salud (IPRESS) y médicos con fuentes
// oficiales de SUSALUD. Herramientas ABIERTAS: sin cuenta ni plan (es información de interés público para cualquier
// ciudadano), con el tope por conexión del MCP. Leen la API (/salud/*) por el service binding y recortan lo que un
// modelo no necesita (las 300 UPS de un hospital, los textos largos del registro).
import { z } from "zod";
import { api } from "../api";
import { ErrorUsuario } from "../formato";
import { definir, type Herramienta } from "../registro";

const WEB = "https://salud.gobserva.cloud";
type J = Record<string, unknown>;
const recortar = (t: unknown, n = 400) => (typeof t === "string" && t.length > n ? `${t.slice(0, n)}…` : t ?? null);
const nombres = (v: unknown, n = 80) => (Array.isArray(v) ? (v as J[]).map((x) => x.nombre).filter(Boolean).slice(0, n) : []);

/** Una fila de la lista o de la búsqueda, con su ficha. */
function fila(x: J): J {
  return {
    codigo: x.codigo, nombre: x.nombre, categoria: x.categoria, sector: x.sector, institucion: x.institucion, tipo: x.tipo,
    estado: x.estado, departamento: x.departamento, provincia: x.provincia, distrito: x.distrito, direccion: x.direccion,
    sanciones_firmes: x.sanciones, ultima_sancion: x.ultimaSancion, denuncias_ultimo_anio: x.denuncias, anio_denuncias: x.denunciasDe,
    // null = todavía no se leyó el detalle de RENIPRESS (no es «no tiene» ni un error): la ficha lo dice.
    centro_quirurgico: x.quirurgico === null || x.quirurgico === undefined ? "ver ficha_establecimiento_salud" : x.quirurgico,
    ruc: x.ruc, razon_social: x.razonSocial, ficha: `${WEB}/establecimiento/${x.codigo}`,
  };
}

export const HERRAMIENTAS_SALUD: Herramienta[] = [
  definir({
    nombre: "buscar_establecimiento_salud",
    titulo: "Buscar establecimientos de salud",
    abierta: true,
    descripcion: [
      "Busca establecimientos de salud (IPRESS: hospitales, clínicas, centros y puestos de salud, consultorios, laboratorios) en el",
      "RENIPRESS de SUSALUD, por nombre, código de IPRESS (hasta 8 cifras) o RUC, con filtros de región, provincia, distrito,",
      "categoría (I-1 a III-2), sector, tipo y si tienen sanciones firmes o centro quirúrgico. Devuelve cada uno con su código",
      "y el enlace a su ficha; para verificarlo a fondo usa ficha_establecimiento_salud.",
    ].join(" "),
    entrada: {
      q: z.string().max(120).optional().describe("Nombre, código de IPRESS o RUC. Ej.: «clínica san felipe», «00009123», «20107695584»."),
      departamento: z.string().max(40).optional().describe("Departamento, en mayúsculas o no. Ej.: «Arequipa»."),
      provincia: z.string().max(60).optional(),
      distrito: z.string().max(60).optional(),
      categoria: z.string().max(40).optional().describe("Una o varias con coma: I-1, I-2, I-3, I-4, II-1, II-2, II-E, III-1, III-2, III-E, SIN."),
      sector: z.enum(["publico", "privado", "otro"]).optional(),
      tipo: z.enum(["con_internamiento", "sin_internamiento", "apoyo", "oferta_flexible", "terapeuticas"]).optional(),
      estado: z.enum(["activos", "todos", "inactivos"]).default("activos"),
      sanciones: z.enum(["con", "sin"]).optional().describe("«con»: sólo las que tienen sanciones firmes de SUSALUD."),
      quirurgico: z.enum(["si"]).optional().describe("«si»: sólo las que tienen la unidad de centro quirúrgico registrada (cuando ya leímos su detalle)."),
      orden: z.enum(["relevancia", "nombre", "sanciones", "categoria", "denuncias"]).default("relevancia"),
      pagina: z.number().int().min(1).max(100).default(1),
    },
    async ejecutar(a, cx) {
      const r = await api<J>(cx.env, "/salud/establecimientos", { ...a, tamano: 20 });
      const filas = ((r.filas as J[]) ?? []).map(fila);
      return {
        total: r.total, con_sanciones: r.conSanciones, pagina: r.pagina,
        siguiente_paso: filas.length === 1
          ? `Abre su ficha: ficha_establecimiento_salud con codigo ${filas[0].codigo} (trae servicios, sanciones y los chequeos con fuente y fecha).`
          : filas.length > 1
            ? "Si sabes cuál es (por distrito o dirección), abre su ficha con ficha_establecimiento_salud; si no, pregunta cuál. No respondas sólo con esta lista."
            : "No hay resultados: prueba con menos palabras o sin el tipo («clínica», «hospital»).",
        establecimientos: filas,
        fuente: "RENIPRESS y Registro de Sanciones de SUSALUD (salud.gobserva.cloud/fuentes).",
      };
    },
  }),
  definir({
    nombre: "ficha_establecimiento_salud",
    titulo: "Ficha y verificación de un establecimiento de salud",
    abierta: true,
    descripcion: [
      "La ficha de una IPRESS por su código: estado y categoría en RENIPRESS (con su resolución), servicios autorizados (UPSS),",
      "especialidades, cartera de servicios, documentos declarados (licencia municipal, compatibilidad de uso), responsable de la",
      "atención (sólo colegio y colegiatura), sanciones FIRMES del Registro de Sanciones de SUSALUD (con resolución, infracción y",
      "si están en juicio), denuncias anuales ante SUSALUD (no son sanciones), recursos, cirugías declaradas, historial de cambios,",
      "lo que Vigía sabe de su RUC, y `verificacion`: los chequeos ya redactados con su fuente y fecha. Cita esos chequeos.",
    ].join(" "),
    entrada: { codigo: z.string().regex(/^\d{1,8}$/).describe("Código único de IPRESS (hasta 8 cifras).") },
    async ejecutar({ codigo }, cx) {
      const f = await api<J>(cx.env, `/salud/establecimiento/${codigo}`);
      const d = (f.detalle ?? null) as J | null;
      const sanciones = ((f.registroSanciones as J[]) ?? []);
      return {
        codigo: f.codigo, nombre: f.nombre, estado: f.estado, categoria: f.categoria, categoria_explicada: f.categoriaInfo,
        sector: f.sector, institucion: f.institucion, tipo: f.tipo, clasificacion: f.clasificacion,
        direccion: f.direccion, distrito: f.distrito, provincia: f.provincia, departamento: f.departamento, telefono: f.telefono, horario: f.horario,
        ficha: `${WEB}/establecimiento/${f.codigo}`,
        verificacion: f.verificacion,
        detalle: d ? {
          leido_al: d.leidoAl, ruc: d.ruc, razon_social: d.razonSocial, categoria_documento: d.categoriaDocumento, categoria_fecha: d.categoriaFecha,
          camas: d.camas, ambientes: d.ambientes,
          upss: nombres(d.upss), upss_suspendidas: nombres(d.upssSuspendidas), especialidades: nombres(d.especialidades, 150),
          cartera_de_servicios: nombres(d.cartera, 150), documentos_declarados: d.documentos,
          responsable: d.responsableColegiatura ? { colegio: d.colegio, colegiatura: d.responsableColegiatura, rne: d.responsableRne } : null,
          ups_total: Array.isArray(d.ups) ? (d.ups as J[]).length : 0,
        } : "Aún no leímos el detalle de esta IPRESS en RENIPRESS: queda pedido (se lee en la próxima corrida). Mientras, usa la consulta oficial de RENIPRESS.",
        sanciones_firmes: sanciones.slice(0, 15).map((s) => ({
          fecha: s.fechaEmision, tipo: s.tipoSancion, multa_uit: s.multaUit, resolucion: s.resolucion, procedimiento: s.pas,
          infraccion_codigo: s.infraccionCodigo, gravedad: s.gravedad, infraccion: recortar(s.infraccionDetalle ?? s.infraccion, 350),
          en_juicio: s.judicializada, estado_judicial: recortar(s.judicializacion, 300), registrada_a_nombre_de: s.nombre,
          enlace: s.enlace === "codigo_otro_nombre" ? "SUSALUD la registró con el código de esta IPRESS pero a otro nombre: dilo así." : s.enlace,
        })),
        sanciones_total: sanciones.length,
        denuncias_por_anio: f.denunciasPorAnio,
        recursos: f.recursos, cirugias_por_mes: f.cirugiasPorMes,
        cambios_recientes: ((f.cambios as J[]) ?? []).slice(0, 10),
        misma_empresa: ((f.mismaEmpresa as J[]) ?? []).slice(0, 10),
        vigia: f.vigia, fuentes: f.fuentes, aviso: f.aviso,
      };
    },
  }),
  definir({
    nombre: "verificar_medico",
    titulo: "Verificar a un médico por su colegiatura",
    abierta: true,
    descripcion: [
      "Lo que dicen las fuentes abiertas de un número de colegiatura del Colegio Médico del Perú (CMP): en qué IPRESS figura como",
      "responsable de la atención según RENIPRESS, y los pasos para confirmar su habilitación, especialidad (RNE) y recertificación",
      "en el CMP y su título en SUNEDU. La habilitación SÓLO la confirma el CMP (su consulta pide cuenta y captcha: no la leemos).",
      "No busca personas por nombre ni devuelve nombres.",
    ].join(" "),
    entrada: { colegiatura: z.string().regex(/^\d{1,7}$/).describe("Número de colegiatura (CMP), sólo cifras.") },
    async ejecutar({ colegiatura }, cx) {
      const r = await api<J>(cx.env, `/salud/medico/${colegiatura}`);
      return {
        colegiatura: r.colegiatura, resumen: r.resumen, habilitacion: r.habilitacion, rne_registrados_en_renipress: r.rne,
        responsable_de: ((r.responsableDe as J[]) ?? []).map(fila), cobertura: r.cobertura, como_verificar: r.verificar, fuentes: r.fuentes, aviso: r.aviso,
        ficha: `${WEB}/medico/${r.colegiatura}`,
      };
    },
  }),
  definir({
    nombre: "sanciones_salud",
    titulo: "Sanciones firmes de SUSALUD",
    abierta: true,
    descripcion: [
      "El Registro de Sanciones de SUSALUD: sanciones FIRMES a IPRESS, IAFAS y UGIPRESS (amonestación, multa en UIT, cierre), con",
      "filtros por nombre, departamento, tipo, gravedad, año, código de IPRESS y si están en un proceso judicial. Una denuncia NO es",
      "una sanción: para denuncias usa la ficha del establecimiento.",
    ].join(" "),
    entrada: {
      q: z.string().max(120).optional().describe("Nombre de la clínica, hospital o aseguradora."),
      departamento: z.string().max(40).optional(),
      tipo: z.enum(["amonestacion", "multa", "cierre_definitivo", "otra"]).optional(),
      gravedad: z.enum(["leve", "grave", "muy_grave"]).optional(),
      administrada: z.enum(["IPRESS", "IAFAS", "UGIPRESS"]).optional(),
      anio: z.number().int().min(2010).max(2100).optional(),
      ipress: z.string().regex(/^\d{1,8}$/).optional().describe("Código de IPRESS."),
      judicial: z.enum(["si"]).optional(),
      orden: z.enum(["recientes", "multa"]).default("recientes"),
      pagina: z.number().int().min(1).max(100).default(1),
    },
    async ejecutar(a, cx) {
      const r = await api<J>(cx.env, "/salud/sanciones", { ...a, tamano: 25 });
      return {
        total: r.n, multas: r.multas, amonestaciones: r.amonestaciones, cierres: r.cierres, en_juicio: r.judicializadas, multas_uit: r.uit,
        sanciones: ((r.filas as J[]) ?? []).map((s) => ({
          fecha: s.fechaEmision, a_nombre_de: s.nombre, tipo_administrada: s.administradaTipo, naturaleza: s.naturaleza, tipo: s.tipoSancion,
          multa_uit: s.multaUit, gravedad: s.gravedad, infraccion: recortar(s.infraccion, 250), resolucion: s.resolucion, procedimiento: s.pas,
          en_juicio: s.judicializada, departamento: s.departamento,
          ipress: s.ipressCodigo ? { codigo: s.ipressCodigo, nombre: s.ipressNombre, ficha: `${WEB}/establecimiento/${s.ipressCodigo}` } : null,
        })),
        fuente: r.fuente,
      };
    },
  }),
  definir({
    nombre: "normas_salud",
    titulo: "Normas de salud del Perú",
    abierta: true,
    descripcion: [
      "Busca en las normas de salud del Perú (Ley General de Salud, reglamento de establecimientos, categorías de establecimientos,",
      "infracciones y sanciones de SUSALUD, derechos de los usuarios, reclamos y denuncias, Colegio Médico, trabajo médico) los",
      "artículos que responden una pregunta. Devuelve el texto con la norma, el artículo y el enlace oficial: cítalos así.",
    ].join(" "),
    entrada: { pregunta: z.string().min(4).max(400).describe("La pregunta en palabras de la gente. Ej.: «qué categoría necesita una clínica para operar»") },
    async ejecutar({ pregunta }, cx) {
      const r = await api<J>(cx.env, "/salud/normas", { q: pregunta, n: 8 });
      const normas = (r.normas as J[]) ?? [];
      if (!normas.length) throw new ErrorUsuario("No encontré artículos de normas de salud para esa pregunta. Prueba con otras palabras.");
      return { normas: normas.map((n) => ({ norma: n.documento, numero: n.numero, articulo: n.articulo, epigrafe: n.epigrafe, texto: n.texto, url: n.url, fecha: n.fechaEmision })) };
    },
  }),
  definir({
    nombre: "fuentes_salud",
    titulo: "Fuentes de Gobserva Salud",
    abierta: true,
    descripcion: "De dónde sale cada dato de Gobserva Salud, qué clase de hecho es (sanción firme, denuncia, registro administrativo) y hasta qué fecha está cargado.",
    entrada: {},
    async ejecutar(_a, cx) {
      return api<J>(cx.env, "/salud/fuentes");
    },
  }),
];
