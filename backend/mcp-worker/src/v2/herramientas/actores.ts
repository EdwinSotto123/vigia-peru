// Quiénes: empresas, entidades, partidos y personas con cargo público. ficha_empresa, red_empresa, ficha_entidad,
// proveedores_de_entidad, partido, historia y persona_publica.
import { z } from "zod";
import { api, ErrorApi } from "../api";
import { AVISO, enlaces, ErrorUsuario, recortar, rucJuridico, tomar } from "../formato";
import { definir } from "../registro";
import { proveedor } from "./contratos";

type Fila = Record<string, any>;

const rucEntrada = (que: string) => z.string().min(11).max(14).describe(`RUC de ${que} (11 dígitos). Si no lo sabes, usa buscar.`);

export const fichaEmpresa = definir({
  nombre: "ficha_empresa",
  titulo: "Ficha de una empresa",
  descripcion:
    "Una empresa proveedora del Estado por su RUC 20: estado en SUNAT, actividad, fecha de alta, cuánto ganó en procesos y " +
    "órdenes, con cuántas entidades, inhabilitaciones, cuántos socios y representantes tiene, sus antecedentes (sanciones, " +
    "penalidades, señales) con su fuente, y sus cifras por año. Las personas naturales (RUC 10) no se muestran.",
  entrada: { ruc: rucEntrada("la empresa") },
  async ejecutar({ ruc }, cx) {
    const r = rucJuridico(ruc);
    const [f, ant] = await Promise.all([
      api<Fila>(cx.env, `/empresas/${r}`),
      api<Fila>(cx.env, `/empresas/${r}/antecedentes`).catch(() => null),
    ]);
    const e = f.empresa ?? {};
    const orden = { alta: 0, media: 1, baja: 2 } as Record<string, number>;
    const antecedentes = ((ant?.data ?? []) as Fila[]).sort((x, y) => (orden[x.severidad] ?? 3) - (orden[y.severidad] ?? 3));
    return {
      ruc: e.ruc,
      nombre: e.nombre,
      estado_sunat: e.estadoSunat,
      fecha_alta: e.fechaAlta,
      actividad: e.actividad,
      domicilio: e.domicilio,
      departamento: e.departamento,
      inhabilitada: e.inhabilitada ?? undefined,
      inhabilitada_hasta: e.inhabilitadaHasta ?? undefined,
      cifras: tomar(e, ["adjProcesos", "adjMonto", "consProcesos", "consMonto", "ordN", "ordMonto", "entidades", "postulaciones", "ganadas", "primera", "ultima", "visitas"]),
      personas: tomar(e, ["socios", "representantes", "directivos", "vinculadas"]),
      senales_por_tipo: (f.antecedentes ?? []).map((x: Fila) => tomar(x, ["etiqueta", "severidad", "n", "tipo"])),
      antecedentes_total: ant?.total,
      antecedentes: antecedentes.slice(0, 15).map((x: Fila) => ({
        etiqueta: x.etiqueta, severidad: x.severidad, fecha: x.fecha, monto_soles: x.montoSoles ?? undefined, entidad: x.entidad ?? undefined,
        ocid: x.ocid ?? undefined, fuente: x.fuenteUrl ?? x.fuente,
      })),
      por_anio: f.anual,
      solo_compras_menores: f.soloMenores ? true : undefined,
      leyenda: "adjProcesos/adjMonto: procesos ganados sola y su monto; consProcesos/consMonto: en consorcio; ordN/ordMonto: órdenes de compra o servicio.",
      enlace: enlaces(cx.env).empresa(r),
      aviso: AVISO,
    };
  },
});

export const redEmpresa = definir({
  nombre: "red_empresa",
  titulo: "Red de una empresa",
  descripcion:
    "Con quién está vinculada una empresa (RUC 20): sus socios, representantes y directivos (con un apellido tapado), las " +
    "otras empresas con las que comparte personas y si también le venden al Estado, empresas socias, y sus clientes del " +
    "Estado con cuánto le compró cada uno. Sirve para ver concentración y vínculos entre postores.",
  cuenta: true,
  entrada: { ruc: rucEntrada("la empresa") },
  async ejecutar({ ruc }, cx) {
    const r = rucJuridico(ruc);
    const e = enlaces(cx.env);
    const [s, cl, ac, pt] = await Promise.all([
      api<Fila>(cx.env, `/empresas/${r}/socios`), api<Fila>(cx.env, `/empresas/${r}/clientes`),
      // Postores de relleno y patrones de la empresa (migración 276): si fallan, la red sale igual.
      api<Fila>(cx.env, "/patrones/acompanantes", { ruc: r, solo: "todos", size: 15 }).catch(() => null),
      api<Fila>(cx.env, "/patrones", { alcance: "proveedor", ruc: r, size: 15 }).catch(() => null),
    ]);
    return {
      ruc: r,
      postores_de_relleno: ((ac?.data ?? []) as Fila[]).map((x) => ({
        papel: x.rucGanador === r ? "esta empresa gana y la otra la acompaña" : "esta empresa acompaña y la otra gana",
        otra_empresa: x.rucGanador === r ? x.acompanante : x.ganador, otra_ruc: x.rucGanador === r ? x.rucAcompanante : x.rucGanador,
        procesos_juntos: x.juntos, entidades: x.entidades, postulaciones_del_acompanante: x.postulacionesDelAcompanante,
        ganadas_del_acompanante: x.ganadasDelAcompanante, comparten_socio: x.vinculo === "socio_comun" ? true : undefined, fuerte: x.fuerte,
      })),
      patrones: ((pt?.data ?? []) as Fila[]).map((x) => ({ senal: x.regla, contratos: x.casos, entidades: x.entidades, ejemplos_ocid: x.ejemplos })),
      personas: (s.socios ?? []).map((p: Fila) => tomar(p, ["nombre", "roles", "desde", "otrasEmpresas", "enElEstado"])),
      empresas_vinculadas: (s.vinculadas ?? []).map((v: Fila) => ({
        ruc: v.ruc, nombre: v.nombre, le_vende_al_estado: v.vende, antecedentes: v.antecedentes, graves: v.graves, inhabilitada: v.inhabilitada ?? undefined,
        monto_soles: v.monto, contratos: v.contratos, por: v.socios, enlace: e.empresa(v.ruc),
      })),
      empresas_socias: s.empresasSocias,
      socia_de: s.sociaDe,
      declarada_en_dji: s.declaradaDji,
      clientes_total: cl.total,
      clientes: (cl.data ?? []).slice(0, 25).map((c: Fila) => ({
        entidad_ruc: c.entidadRuc, entidad: c.entidad, departamento: c.departamento, contratos: c.contratos, adjudicado_soles: c.adjudicado,
        consorcio: c.consorcio || undefined, ordenes: c.ordenes, ordenado_soles: c.ordenado, visitas: c.visitas || undefined, primera: c.primera, ultima: c.ultima,
      })),
      corte_rnp: s.corte,
      enlace: e.empresa(r),
      fuente: "RNP (OECE) para socios y representantes; CONOSCE y órdenes del SEACE para clientes; visitas de la plataforma de transparencia.",
    };
  },
});

const SENALES_ENTIDAD: Record<string, string> = {
  captura: "contratos ganados por empresas ligadas a la gestión",
  planillaAlta: "personas de su planilla con una señal alta",
  socioProveedor: "personas de su planilla socias o representantes de una empresa que le vende",
  doblePlanilla: "personas de su planilla que cobran también en otra entidad del departamento",
  alBorde: "locadores que reciben casi siempre órdenes justo debajo del tope",
  alBordeEmpresas: "empresas que reciben casi siempre órdenes justo debajo del tope",
  sobreprecioCatalogo: "compras por catálogo que pagaron el doble o más que otras entidades por el mismo producto",
  nepotismoGobierno: "locadores declarados como parientes por un funcionario de otra entidad del mismo gobierno",
  parientePlanilla: "personas de su planilla declaradas como parientes por un funcionario de la entidad",
  visitaPariente: "visitas de familiares que sus funcionarios declararon en su DJI",
  empresaEspejo: "contratos ganados por una empresa mientras su empresa hermana estaba inhabilitada",
  socioLocador: "locadores socios o representantes de una empresa que también le vende",
  plazasSaliente: "plazas CAS convocadas después de las elecciones y antes de entregar el cargo",
  ascensoExpres: "personas que pasaron a una jefatura con un sueldo mucho mayor en pocos meses",
  plazasSenales: "plazas CAS con señales de plaza a la medida",
  financioLocadores: "locadores que aportaron a la campaña del partido que gobierna",
  financioPlanilla: "personas de su planilla que aportaron a la campaña del partido que gobierna",
};

export const fichaEntidad = definir({
  nombre: "ficha_entidad",
  titulo: "Ficha de una entidad",
  descripcion:
    "Una entidad pública por su RUC: lugar, contratos, presupuesto del MEF por año (PIA, PIM, devengado y % de ejecución), " +
    "quién la gobierna y de qué partido, señales sobre su planilla, locadores y proveedores, posible nepotismo, informes " +
    "de la Contraloría con su PDF y casos de la Procuraduría en su departamento.",
  entrada: { ruc: rucEntrada("la entidad") },
  async ejecutar({ ruc }, cx) {
    const r = rucJuridico(ruc, "RUC de la entidad");
    const [f, poder, control] = await Promise.all([
      api<Fila>(cx.env, `/entidades/${r}`),
      api<Fila>(cx.env, `/poder/entidad/${r}`).catch(() => null),
      api<Fila>(cx.env, `/corrupcion/entidad/${r}`, { size: 5 }).catch(() => null),
    ]);
    const ent = f.entidad ?? {};
    const anios = ((f.mef?.by_year ?? []) as Fila[]).slice(-6).map((y) => ({
      anio: y.year, pia: y.pia, pim: y.pim, devengado: y.devengado, ejecucion_pct: y.pim ? Math.round((1000 * y.devengado) / y.pim) / 10 : null,
    }));
    const senales = Object.entries((f.senales ?? {}) as Record<string, unknown>)
      .filter(([k, v]) => typeof v === "number" && v > 0 && SENALES_ENTIDAD[k])
      .map(([k, v]) => ({ clave: k, n: v, que: SENALES_ENTIDAD[k] }));
    const inf = control?.informes;
    return {
      ruc: ent.ruc ?? r,
      nombre: ent.nombre,
      region: ent.region,
      provincia: ent.provincia,
      distrito: ent.distrito,
      contratos: ent.contratos,
      presupuesto: anios.length ? { fuente: "MEF (Consulta Amigable, SIAF)", por_anio: anios } : undefined,
      gobierno: poder
        ? { partido: poder.partido, cargo: poder.cargo_gob, autoridad: poder.autoridad, desde: poder.periodoInicio, hasta: poder.periodoFin,
            contratos_a_empresas_ligadas: poder.n_captura, monto_ligadas_soles: poder.monto_captura }
        : undefined,
      senales,
      nepotismo: f.nepotismo ? { casos: f.nepotismo.total, monto_soles: f.nepotismo.monto } : undefined,
      contraloria: inf
        ? { informes: inf.total, responsabilidad_penal: inf.penal, civil: inf.civil, administrativa: inf.administrativa, desde: inf.desde, hasta: inf.hasta,
            recientes: (inf.pagina?.filas ?? []).map((x: Fila) => tomar(x, ["numero", "titulo", "fecha", "urlPdf"])) }
        : undefined,
      procuraduria_departamento: control?.procuraduria
        ? tomar(control.procuraduria as Fila, ["corte", "en_tramite", "sentencias", "casos_nuevos", "en_ejecucion", "url_fuente"])
        : undefined,
      dictamenes: (Array.isArray(f.alertas) ? f.alertas : []).slice(0, 10).map((x: Fila) => ({
        codigo: x.codigo, ocid: x.codigo_convocatoria, puntaje: x.score, objeto: recortar(x.objeto, 120), fecha: x.fecha_buena_pro?.slice(0, 10),
      })),
      enlace: enlaces(cx.env).entidad(r),
      aviso: AVISO,
    };
  },
});

export const proveedoresDeEntidad = definir({
  nombre: "proveedores_de_entidad",
  titulo: "Proveedores de una entidad",
  descripcion:
    "Ranking de las empresas que más le vendieron a una entidad en un rango de años: monto en procesos y en órdenes, " +
    "procesos ganados como único postor y por contratación directa, su parte del total y la concentración de los cinco " +
    "primeros. Las personas naturales salen sumadas en un solo grupo.",
  entrada: {
    ruc: rucEntrada("la entidad"),
    anio_desde: z.number().int().min(2015).max(2030).optional(),
    anio_hasta: z.number().int().min(2015).max(2030).optional(),
    limite: z.number().int().min(1).max(50).default(20),
  },
  async ejecutar(a, cx) {
    const r = rucJuridico(a.ruc, "RUC de la entidad");
    const d = await api<Fila>(cx.env, `/entidades/${r}/proveedores`, { anio_desde: a.anio_desde, anio_hasta: a.anio_hasta, limite: a.limite });
    const e = enlaces(cx.env);
    return {
      ...d,
      proveedores: (d.proveedores ?? []).map((p: Fila) => ({ ...p, enlace: p.ruc ? e.empresa(p.ruc) : undefined })),
      enlace: e.entidad(r),
      fuente: "OECE (CONOSCE: procesos adjudicados) y órdenes de compra y servicio del SEACE.",
    };
  },
});

export const partido = definir({
  nombre: "partido",
  titulo: "Partido político",
  descripcion:
    "Un partido o movimiento: cuántos gobiernos regionales, provinciales y distritales ganó en una elección, cuántos " +
    "contratos y cuánto adjudicaron esas entidades, en qué regiones, sus entidades con más contratos y quién las gobierna. " +
    "Con texto busca el partido; con clave trae su ficha.",
  entrada: {
    texto: z.string().min(3).max(60).optional().describe("Nombre del partido, por ejemplo «Somos Perú»."),
    clave: z.string().max(100).optional().describe("Clave del partido (la devuelve buscar o esta misma herramienta)."),
    eleccion: z.enum(["2014", "2018", "2022"]).default("2022").describe("Elección regional y municipal."),
  },
  async ejecutar(a, cx) {
    const e = enlaces(cx.env);
    let clave = a.clave;
    if (!clave) {
      if (!a.texto) throw new ErrorUsuario("Indica texto (el nombre del partido) o clave.");
      const r = await api<Fila>(cx.env, "/partidos/ranking", { q: a.texto, anio: a.eleccion, limit: 5 });
      const lista = (r.data ?? []) as Fila[];
      if (lista.length !== 1) {
        return {
          coincidencias: lista.map((p) => ({ clave: p.clave, nombre: p.nombre, gobiernos_con_contratos: p.gobiernosConContratos, contratos: p.contratos })),
          nota: lista.length ? "Hay varios: vuelve a llamar con la clave del que buscas." : "No encontré ese partido en esa elección.",
        };
      }
      clave = lista[0].clave as string;
    }
    const p = await api<Fila>(cx.env, `/partidos/${encodeURIComponent(clave)}`, { anio: a.eleccion });
    return {
      clave: p.partido?.clave,
      nombre: p.partido?.nombre,
      tipo: p.partido?.tipo,
      eleccion: p.anio,
      periodo: { desde: p.desde, hasta: p.hasta },
      gobiernos: p.partido?.gobiernos,
      totales: p.totales,
      procesos: p.historia ? tomar(p.historia as Fila, ["procesos", "montoAdjudicadoPen", "entidades", "proveedores", "desde", "hasta", "porObjeto"]) : undefined,
      regiones: (p.regiones ?? []).slice(0, 12).map((x: Fila) => tomar(x, ["nombre", "contratos", "montoPen", "conSenales"])),
      entidades: (p.entidades ?? []).slice(0, 15).map((x: Fila) => ({ ...tomar(x, ["ruc", "nombre", "nivel", "lugar", "autoridad", "contratos", "montoPen", "conSenales"]), enlace: e.entidad(x.ruc) })),
      enlace: e.partido(clave),
      fuente: "JNE (resultados electorales) y OECE (SEACE y CONOSCE).",
    };
  },
});

export const historia = definir({
  nombre: "historia",
  titulo: "Línea de tiempo",
  descripcion:
    "La historia de una entidad, empresa, partido o contrato: hechos fechados (fundación, socios que entran, contratos, " +
    "órdenes, cambios de gestión, visitas, informes), patrones que Vigía detectó (por ejemplo órdenes concentradas en " +
    "diciembre u olas tras un cambio de gestión) y las series por mes.",
  cuenta: true,
  entrada: {
    tipo: z.enum(["entidad", "empresa", "partido", "contrato"]),
    id: z.string().min(1).max(100).describe("RUC (entidad o empresa), clave del partido u OCID."),
    max_eventos: z.number().int().min(5).max(120).default(40),
  },
  async ejecutar(a, cx) {
    const id = a.tipo === "entidad" || a.tipo === "empresa" ? rucJuridico(a.id) : a.id.trim();
    const h = await api<Fila>(cx.env, `/historia/${a.tipo}/${encodeURIComponent(id)}`);
    const eventos = ((h.eventos ?? []) as Fila[]).sort((x, y) => String(y.fecha).localeCompare(String(x.fecha)));
    return {
      sujeto: h.sujeto,
      desde: h.desde,
      hasta: h.hasta,
      patrones: (h.patrones ?? []).map((p: Fila) => tomar(p, ["tipo", "titulo", "explica", "mes", "severidad"])),
      eventos_total: eventos.length,
      eventos: eventos.slice(0, a.max_eventos).map((x: Fila) => tomar(x, ["fecha", "tipo", "titulo", "detalle", "fuente", "enlace"])),
      series: (h.series ?? []).map((s: Fila) => ({
        titulo: s.titulo, unidad: s.unidad, fuente: s.fuente,
        puntos: ((s.puntos ?? []) as Fila[]).slice(-36),
      })),
      marcas: (h.marcas ?? []).map((m: Fila) => tomar(m, ["fecha", "texto"])),
      fuentes: h.fuentes,
    };
  },
});

export const personaPublica = definir({
  nombre: "persona_publica",
  titulo: "Persona con cargo público",
  descripcion:
    "Busca por nombre a una autoridad o a quien trabaja en el Estado. Para una autoridad (alcalde, gobernador, regidor, " +
    "congresista) da su trayectoria electoral del JNE desde 2014 (cada candidatura con año, cargo, partido, lugar y si salió " +
    "electa) y el cargo que tiene hoy con su entidad y RUC. En la planilla del Estado da cargo, entidad, régimen, sueldo y " +
    "señales, con un apellido tapado. No se busca por DNI. Para saber si una persona cualquiera tiene visitas, empresas, " +
    "órdenes o declaraciones, usa rastro_persona.",
  cuenta: true,
  entrada: {
    nombre: z.string().min(6).max(80).describe("Apellidos y nombres, al menos dos palabras."),
    donde: z.enum(["planilla", "autoridades", "ambos"]).default("ambos"),
  },
  async ejecutar(a, cx) {
    const palabras = a.nombre.trim().split(/\s+/).filter((w) => w.length >= 2);
    if (palabras.length < 2) throw new ErrorUsuario("Escribe al menos un apellido y un nombre.");
    if (/\d{6,}/.test(a.nombre)) throw new ErrorUsuario("No se busca por DNI ni por números: escribe el nombre.");
    const e = enlaces(cx.env);
    const [pl, au, tr] = await Promise.all([
      a.donde !== "autoridades" ? api<Fila>(cx.env, "/planilla", { q: a.nombre, size: 10 }) : Promise.resolve(null),
      a.donde !== "planilla" ? api<Fila>(cx.env, "/poder/entidades", { q: a.nombre }).catch((err) => (err instanceof ErrorApi ? null : Promise.reject(err))) : Promise.resolve(null),
      a.donde !== "planilla" ? api<Fila>(cx.env, "/poder/trayectoria", { q: a.nombre }).catch((err) => (err instanceof ErrorApi ? null : Promise.reject(err))) : Promise.resolve(null),
    ]);
    const normal = (t: string) => t.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
    const buscadas = palabras.map(normal);
    return {
      planilla: pl
        ? {
            total: pl.total,
            personas: (pl.data ?? []).map((p: Fila) => ({
              nombre: p.nombre, entidad: p.entidad, entidad_ruc: p.entidadRuc, cargo: p.cargo, dependencia: p.dependencia, regimen: p.regimen,
              sueldo_mes_soles: p.total, meses: p.meses, primer_mes: p.primerMes, ultimo_mes: p.ultimoMes,
              senales: (p.senales ?? []).map((s: Fila) => (typeof s === "string" ? s : s.etiqueta ?? s.tipo)), enlace: p.ficha ? e.planilla(p.ficha) : undefined,
            })),
          }
        : undefined,
      trayectoria: tr
        ? {
            personas: ((tr.personas ?? []) as Fila[]).map((x) => ({
              nombre: x.nombre,
              veces_electo: x.veces_electo,
              en_el_cargo: ((x.en_el_cargo ?? []) as Fila[]).map((g) => ({ ...g, enlace: g.entidad_ruc ? e.entidad(g.entidad_ruc) : undefined })),
              candidaturas: x.candidaturas,
            })),
            nota: tr.nota,
          }
        : undefined,
      autoridades: au
        ? ((au.data ?? []) as Fila[])
            .filter((x) => buscadas.every((w) => normal(String(x.autoridad ?? "")).includes(w)))
            .map((x) => ({ autoridad: x.autoridad, cargo: x.cargo_gob, entidad: x.entidad, entidad_ruc: x.entidad_ruc, partido: x.partido, desde: x.periodoInicio, hasta: x.periodoFin }))
        : undefined,
      fuente: "JNE (candidaturas 2014 a 2022), registro de autoridades vigentes y planillas del Portal de Transparencia Estándar.",
    };
  },
});

export const rastroPersona = definir({
  nombre: "rastro_persona",
  titulo: "Rastro de una persona",
  descripcion:
    "Busca a una persona por su NOMBRE COMPLETO (apellidos y nombres, en cualquier orden) en todos los registros de Vigía " +
    "a la vez: las visitas que hizo a entidades del Estado (a cuál, cuántas veces, entre qué fechas, a qué oficina y en " +
    "nombre de qué organización), las empresas en que es socia o representante (RNP), sus declaraciones juradas de " +
    "intereses como funcionaria, sus aportes de campaña, si es persona expuesta políticamente, la planilla del Estado, sus " +
    "órdenes de servicio como persona natural, su trayectoria electoral y su cargo vigente. ÚSALA SIEMPRE que pregunten " +
    "por una persona («¿tiene contratos o visitas?», «¿quién es?»): es la única que busca visitas por el nombre del " +
    "visitante. Los nombres salen con un apellido tapado (es sólo para mostrar; la búsqueda usa el nombre entero) y nunca " +
    "sale un documento. No se busca por DNI. Si hay varios nombres parecidos, dilo: pueden ser personas distintas.",
  cuenta: true,
  entrada: { nombre: z.string().min(6).max(80).describe("Apellidos y nombres de la persona, al menos dos palabras.") },
  async ejecutar(a, cx) {
    if (/\d/.test(a.nombre)) throw new ErrorUsuario("No se busca por DNI ni por números: escribe el nombre.");
    const palabras = a.nombre.trim().split(/\s+/).filter((w) => w.length >= 3);
    if (palabras.length < 2) throw new ErrorUsuario("Escribe al menos un apellido y un nombre.");
    const e = enlaces(cx.env);
    const suave = <T>(p: Promise<T>) => p.catch((err) => (err instanceof ErrorApi ? null : Promise.reject(err)));
    const [r, pl, per, tr] = await Promise.all([
      suave(api<Fila>(cx.env, "/personas/rastro", { q: a.nombre }, { interno: true })),
      suave(api<Fila>(cx.env, "/planilla", { q: a.nombre, size: 10 })),
      suave(api<Fila>(cx.env, "/personas", { q: a.nombre, size: 10 })),
      suave(api<Fila>(cx.env, "/poder/trayectoria", { q: a.nombre })),
    ]);
    const visitas = ((r?.visitas ?? []) as Fila[]).map((v) => ({
      nombre: v.nombre, entidad: v.entidad, entidad_ruc: v.entidad_ruc ?? undefined, visitas: v.visitas, primera: v.primera, ultima: v.ultima,
      en_nombre_de: v.en_nombre_de ?? undefined, a_quien_visito: v.a_quien ?? undefined, motivos: v.motivos ?? undefined,
      enlace: v.entidad_ruc ? e.entidad(v.entidad_ruc) : undefined,
    }));
    const hay = (x: unknown) => (Array.isArray(x) ? x.length : 0);
    return {
      resumen: {
        visitas: visitas.reduce((s, v) => s + (v.visitas ?? 0), 0),
        entidades_visitadas: new Set(visitas.map((v) => v.entidad)).size,
        empresas: hay(r?.empresas), declaraciones_juradas: hay(r?.declaraciones_juradas), aportes_de_campana: hay(r?.aportes_de_campana),
        en_planilla: pl?.total ?? 0, entidades_que_le_dieron_ordenes: hay(r?.ordenes_como_persona_natural) || (per?.total ?? 0),
        candidaturas: hay(tr?.personas),
      },
      visitas,
      empresas: ((r?.empresas ?? []) as Fila[]).map((x) => ({ ...x, enlace: x.ruc ? e.empresa(x.ruc) : undefined })),
      // Lo primero que mira un investigador: visitó la entidad y una empresa suya le ganó procesos.
      visito_y_su_empresa_gano: ((r?.visito_y_su_empresa_gano ?? []) as Fila[]).map((x) => ({
        ...x, enlace_empresa: x.empresa_ruc ? e.empresa(x.empresa_ruc) : undefined, enlace_entidad: x.entidad_ruc ? e.entidad(x.entidad_ruc) : undefined,
      })),
      declaraciones_juradas: r?.declaraciones_juradas ?? [],
      aportes_de_campana: r?.aportes_de_campana ?? [],
      personas_expuestas: r?.personas_expuestas ?? [],
      planilla: ((pl?.data ?? []) as Fila[]).map((p) => ({
        nombre: p.nombre, entidad: p.entidad, entidad_ruc: p.entidadRuc, cargo: p.cargo, regimen: p.regimen, sueldo_mes_soles: p.total,
        primer_mes: p.primerMes, ultimo_mes: p.ultimoMes, enlace: p.ficha ? e.planilla(p.ficha) : undefined,
      })),
      ordenes_como_persona_natural: [
        ...((r?.ordenes_como_persona_natural ?? []) as Fila[]).map((p) => ({
          nombre: p.nombre, entidad: p.entidad, entidad_ruc: p.entidad_ruc, servicio: p.servicio ?? undefined, ordenes: p.ordenes, monto_soles: p.monto,
          primera: p.primera, ultima: p.ultima, enlace: p.codigo ? e.persona(p.codigo) : undefined,
        })),
        ...((per?.data ?? []) as Fila[]).map((p) => tomar(p, ["nombre", "entidad", "entidadRuc", "servicio", "ordenes", "monto", "primera", "ultima", "codigo"])),
      ],
      trayectoria_electoral: tr?.personas ?? [],
      no_respondieron: [...((r?.sin_respuesta ?? []) as string[]), ...(r ? [] : ["visitas, empresas y declaraciones"]), ...(pl ? [] : ["planilla"]), ...(per ? [] : ["órdenes"])],
      nota:
        "El registro de visitas es el de la plataforma de transparencia: sólo trae las entidades que la usan. Un mismo nombre " +
        "puede ser de dos personas: cada fila lleva el nombre como figura en su registro. Aparecer aquí no es una irregularidad.",
      aviso: AVISO,
    };
  },
});

export const patrones = definir({
  nombre: "patrones",
  titulo: "Patrones que se repiten",
  descripcion:
    "Dónde una misma señal se REPITE, que es lo que un investigador busca primero. Con alcance «entidad»: entidades donde una " +
    "señal de los agentes (única oferta válida, único postor, oferta igual al referencial, requisitos dirigidos, visitas " +
    "previas…) aparece en una parte de sus contratos leídos que es el doble o más de la del país. Con alcance «proveedor»: " +
    "empresas con la misma señal de proceso en 3 o más contratos de 2 o más entidades. Con alcance «relleno»: postores de " +
    "relleno, empresas que casi nunca ganan y dedican sus postulaciones a acompañar a un mismo ganador (posible oferta de " +
    "cobertura; más grave si comparten socio). Con un RUC, los patrones de esa entidad o empresa. Cada patrón trae contratos " +
    "de ejemplo para abrir con ficha_contrato o dictamen. Un patrón es un motivo para mirar, no una acusación.",
  cuenta: true,
  entrada: {
    alcance: z.enum(["entidad", "proveedor", "relleno"]).default("entidad"),
    ruc: z.string().min(11).max(14).optional().describe("RUC 20 de la entidad o de la empresa (opcional)."),
    regla: z.string().max(60).optional().describe("Sólo una señal, por su código (p. ej. unica_oferta_valida)."),
    pagina: z.number().int().min(1).max(50).default(1),
  },
  async ejecutar(a, cx) {
    const e = enlaces(cx.env);
    const ruc = a.ruc ? rucJuridico(a.ruc) : undefined;
    if (a.alcance === "relleno") {
      const r = await api<Fila>(cx.env, "/patrones/acompanantes", { ruc, page: a.pagina, size: 20, solo: ruc ? "todos" : "fuertes" });
      return {
        total: r.total,
        pares: ((r.data ?? []) as Fila[]).map((x) => ({
          ganador: x.ganador, ruc_ganador: x.rucGanador, acompanante: x.acompanante, ruc_acompanante: x.rucAcompanante,
          procesos_juntos: x.juntos, entidades: x.entidades, postulaciones_del_acompanante: x.postulacionesDelAcompanante,
          ganadas_del_acompanante: x.ganadasDelAcompanante, parte_de_sus_postulaciones: x.parte, desde: x.desde, hasta: x.hasta,
          comparten_socio: x.vinculo === "socio_comun" ? true : undefined, fuerte: x.fuerte,
          enlace_ganador: e.empresa(x.rucGanador), enlace_acompanante: e.empresa(x.rucAcompanante),
        })),
        como_leerlo:
          "«Fuerte»: el acompañante dedica 60 % o más de sus postulaciones a ese ganador y gana 1 de cada 10 o menos. Sólo cuenta " +
          "procesos de 2 a 4 postores. Para confirmar, compara los montos ofertados y las fechas en los contratos que comparten.",
        aviso: AVISO,
      };
    }
    const r = await api<Fila>(cx.env, "/patrones", { alcance: a.alcance, ruc, regla: a.regla, page: a.pagina, size: 20 });
    return {
      total: r.total,
      por_senal: r.porRegla,
      patrones: ((r.data ?? []) as Fila[]).map((x) => ({
        nombre: x.nombre, ruc: x.ruc, senal: x.regla, contratos_con_la_senal: x.casos, contratos_leidos: x.leidos,
        entidades: x.entidades ?? undefined, parte: x.tasa, parte_en_el_pais: x.tasaPais, veces_la_del_pais: x.veces,
        monto_soles: x.monto ?? undefined, ejemplos_ocid: x.ejemplos,
        enlace: a.alcance === "entidad" ? e.entidad(x.ruc) : e.empresa(x.ruc),
      })),
      como_leerlo:
        "«parte» es la fracción de los contratos LEÍDOS (no de todos los publicados) que tienen la señal. Vigía lee primero lo " +
        "más riesgoso, así que la comparación vale entre entidades, no como tasa real del país.",
      aviso: AVISO,
    };
  },
});

export const HERRAMIENTAS_ACTORES = [fichaEmpresa, redEmpresa, fichaEntidad, proveedoresDeEntidad, partido, historia, personaPublica, rastroPersona, patrones];
