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
    "Estado con cuánto le compró cada uno. También dice si un socio suyo gana en las mismas entidades, con otra empresa, " +
    "procesos de objeto parecido (el mismo negocio repartido entre razones sociales). Sirve para ver concentración y vínculos entre postores.",
  cuenta: true,
  entrada: { ruc: rucEntrada("la empresa") },
  async ejecutar({ ruc }, cx) {
    const r = rucJuridico(ruc);
    const e = enlaces(cx.env);
    const [s, cl, ac, pt, cr, du] = await Promise.all([
      api<Fila>(cx.env, `/empresas/${r}/socios`), api<Fila>(cx.env, `/empresas/${r}/clientes`),
      // Postores de relleno y patrones de la empresa (migración 276): si fallan, la red sale igual.
      api<Fila>(cx.env, "/patrones/acompanantes", { ruc: r, solo: "todos", size: 15 }).catch(() => null),
      api<Fila>(cx.env, "/patrones", { alcance: "proveedor", ruc: r, size: 15 }).catch(() => null),
      api<Fila>(cx.env, "/patrones/consorcios", { ruc: r, size: 15 }).catch(() => null),
      // Empresas del mismo socio que ganan objetos parecidos en las mismas entidades (migraciones 292 y 293).
      api<Fila>(cx.env, "/patrones/duenos", { ruc: r, size: 15 }).catch(() => null),
    ]);
    return {
      ruc: r,
      mismo_dueno_en_la_misma_entidad: ((du?.data ?? []) as Fila[]).map((x) => ({
        entidad: x.entidad, entidad_ruc: x.entidadRuc, socio: x.socios?.[0]?.nombre ?? undefined,
        empresas_hermanas: ((x.empresas ?? []) as Fila[]).filter((y) => y.ruc !== r).map((y) => ({ empresa: y.nombre, ruc: y.ruc, enlace: e.empresa(y.ruc) })),
        contratos_con_objeto_parecido: x.contratos, con_90_dias_o_menos_entre_si: x.seguidos, monto_soles: x.monto, desde: x.desde, hasta: x.hasta,
        ejemplos: ((x.ejemplos ?? []) as string[]).map((o) => e.contrato(o)),
      })),
      postores_de_relleno: ((ac?.data ?? []) as Fila[]).map((x) => ({
        papel: x.rucGanador === r ? "esta empresa gana y la otra la acompaña" : "esta empresa acompaña y la otra gana",
        otra_empresa: x.rucGanador === r ? x.acompanante : x.ganador, otra_ruc: x.rucGanador === r ? x.rucAcompanante : x.rucGanador,
        procesos_juntos: x.juntos, entidades: x.entidades, postulaciones_del_acompanante: x.postulacionesDelAcompanante,
        ganadas_del_acompanante: x.ganadasDelAcompanante, comparten_socio: x.vinculo === "socio_comun" ? true : undefined, fuerte: x.fuerte,
      })),
      patrones: ((pt?.data ?? []) as Fila[]).map((x) => ({ senal: x.regla, contratos: x.casos, entidades: x.entidades, ejemplos_ocid: x.ejemplos })),
      // Empresas que fueron sus socias en un consorcio y luego compiten con ella (migración 278).
      socias_de_consorcio_que_compiten: ((cr?.data ?? []) as Fila[]).map((x) => {
        const soyA = x.rucA === r;
        return {
          otra_empresa: soyA ? x.nombreB : x.nombreA, otra_ruc: soyA ? x.rucB : x.rucA, consorcios_juntas: x.consorcios,
          procesos_como_rivales: x.rivales, solas_las_dos: x.solas, gano_esta: soyA ? x.ganoA : x.ganoB, gano_la_otra: soyA ? x.ganoB : x.ganoA,
          entidades: x.entidades, mercado_nacional: x.mercadoNacional === true ? true : undefined,
        };
      }),
      // Con quienes dejaron de figurar desde diciembre de 2022 (migraciones 360 y 365): el corte del RNP en que salieron.
      personas: (s.socios ?? []).map((p: Fila) => ({
        ...tomar(p, ["nombre", "roles", "desde", "otrasEmpresas", "enElEstado"]),
        ya_no_figura_desde_el_corte: p.salio ?? undefined,
        papeles_que_dejo: p.rolesAntes?.length ? p.rolesAntes : undefined, dejo_esos_papeles_en_el_corte: p.dejoRol ?? undefined,
      })),
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

/** La lista de la pestaña «Patrones» de una entidad y el alcance con que la herramienta `patrones` da su detalle. */
const ALCANCE_DE_PATRON: Record<string, string> = {
  entidades: "entidad", duenos: "dueno", grupos: "grupo", repetidas: "repetida", recien: "recien_creada", renovaciones: "renovacion",
  compras: "compras_familia", autoridad: "autoridad_exsocio", doble: "doble", inhabilitadas: "inhabilitada", control: "control",
  observados: "observado", observacion: "observacion",
};

export const fichaEntidad = definir({
  nombre: "ficha_entidad",
  titulo: "Ficha de una entidad",
  descripcion:
    "Una entidad pública por su RUC: lugar, contratos, presupuesto del MEF por año (PIA, PIM, devengado y % de ejecución), " +
    "quién la gobierna y de qué partido, señales sobre su planilla, locadores y proveedores, posible nepotismo, informes " +
    "de la Contraloría con su PDF y casos de la Procuraduría en su departamento. También los socios que le ganan con dos o " +
    "más empresas procesos de objeto parecido, y el índice de TODOS los patrones con casos en ella (concertación y " +
    "competencia aparente, compras partidas o repetidas, familia y política, sanciones) con cuántos tiene cada uno.",
  entrada: { ruc: rucEntrada("la entidad") },
  async ejecutar({ ruc }, cx) {
    const r = rucJuridico(ruc, "RUC de la entidad");
    const [f, poder, control, du, pat] = await Promise.all([
      api<Fila>(cx.env, `/entidades/${r}`),
      api<Fila>(cx.env, `/poder/entidad/${r}`).catch(() => null),
      api<Fila>(cx.env, `/corrupcion/entidad/${r}`, { size: 5 }).catch(() => null),
      // Socios que le ganan a esta entidad con dos o más empresas (migraciones 292 y 293).
      api<Fila>(cx.env, "/patrones/duenos", { ruc: r, size: 8 }).catch(() => null),
      // El índice de su pestaña «Patrones»: cuántos casos tiene cada patrón en ella y los antecedentes de sus ganadores.
      api<Fila>(cx.env, `/patrones/entidad/${r}`).catch(() => null),
    ]);
    const ent = f.entidad ?? {};
    const e = enlaces(cx.env);
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
      duenos_con_varias_empresas: du && (du.total ?? 0) > 0
        ? {
            grupos: du.total,
            principales: ((du.data ?? []) as Fila[]).map((x) => ({
              socio: x.socios?.[0]?.nombre ?? undefined, empresas: ((x.empresas ?? []) as Fila[]).map((y) => ({ empresa: y.nombre, ruc: y.ruc, enlace: e.empresa(y.ruc) })),
              contratos_con_objeto_parecido: x.contratos, con_90_dias_o_menos_entre_si: x.seguidos, monto_soles: x.monto,
              ejemplos: ((x.ejemplos ?? []) as string[]).map((o) => e.contrato(o)),
            })),
            como_leerlo: "Un socio que le gana a esta entidad, con dos o más empresas, procesos de objeto parecido. Para la lista entera: patrones con alcance «dueno» y este RUC.",
          }
        : undefined,
      // Todo lo que se repite en la entidad (su pestaña «Patrones»): cada lista con casos y cada antecedente de quienes le
      // ganaron, con su enlace a la ficha de ese patrón.
      patrones_en_la_entidad: pat
        ? {
            patrones_con_casos: ((pat.listas ?? []) as Fila[]).filter((x) => Number(x.casos ?? 0) > 0).map((x) => ({
              patron: x.clave, casos: x.casos, alcance_en_la_herramienta_patrones: ALCANCE_DE_PATRON[String(x.clave)] ?? undefined,
              enlace: `${e.entidad(r)}?seccion=patrones&patron=${x.clave}`,
            })),
            antecedentes_de_quienes_ganaron_sus_contratos: ((pat.cruces ?? []) as Fila[]).slice(0, 30).map((x) => ({
              antecedente: x.etiqueta, tipo: x.tipo, contratos: x.contratos, de_senal_alta: x.graves, monto_soles: x.monto, proveedores: x.empresas,
              enlace: `${e.entidad(r)}?seccion=patrones&pv=antecedentes&antecedente=${x.tipo}`,
            })),
            como_leerlo: "Dos cosas distintas. «patrones_con_casos»: lo que se repite ENTRE VARIOS contratos u órdenes de la entidad; cada uno se detalla con la herramienta patrones (el alcance que se indica) y este RUC. «antecedentes…»: lo que pesa sobre CADA contrato, es decir cuántos contratos de la entidad ganó alguien con ese antecedente (postor único, socio común entre postores, rival que fue su socia, fraccionamiento…); para verlos, buscar_contratos con la entidad y esa señal. Un patrón es un motivo para mirar, no una acusación.",
          }
        : undefined,
      gobierno: poder
        ? { partido: poder.partido, cargo: poder.cargo_gob, autoridad: poder.autoridad, desde: poder.periodoInicio, hasta: poder.periodoFin,
            contratos_a_empresas_ligadas: poder.n_captura, monto_ligadas_soles: poder.monto_captura }
        : undefined,
      senales,
      nepotismo: f.nepotismo ? { casos: f.nepotismo.total, monto_soles: f.nepotismo.monto } : undefined,
      contraloria: inf
        ? { informes: inf.total, responsabilidad_penal: inf.penal, civil: inf.civil, administrativa: inf.administrativa, desde: inf.desde, hasta: inf.hasta,
            // Lo que le observó, por tema, con el perjuicio que cuantifican las observaciones leídas (migración 314) y
            // cuántos contratos de Vigía nombran (313): para el detalle, informes_control con este RUC.
            observado: inf.observado
              ? {
                  observaciones_leidas: inf.observado.observaciones, perjuicio_cuantificado_soles: inf.observado.perjuicioPen,
                  contratos_de_vigia_nombrados: inf.observado.contratos,
                  por_tema: ((inf.observado.porTema ?? []) as Fila[]).map((x) => ({ tema: x.temaTexto, observaciones: x.observaciones, perjuicio_soles: x.perjuicioPen })),
                }
              : undefined,
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

/** Los renglones de una historia (los de la línea de tiempo de la ficha), para filtrar sus hechos. */
const RENGLONES_HISTORIA = ["banderas", "control", "obras", "visitas", "politica", "empresa", "compras", "ordenes", "personas", "menores", "planilla", "plazas", "gobierno"] as const;
/** A igual gravedad, en qué orden van las clases (el mismo de «Lo más grave» en la ficha: frontend/lib/historiaGrave.ts). */
const ORDEN_GRAVE = ["control", "banderas", "obras", "secuencias", "visitas", "politica", "empresa", "compras", "ordenes", "personas", "menores", "planilla", "plazas", "ritmo"];

export const historia = definir({
  nombre: "historia",
  titulo: "Línea de tiempo",
  descripcion:
    "La historia de una entidad, empresa, partido o contrato. Primero «lo_mas_grave»: todo lo que tiene gravedad, lo más grave " +
    "primero y una clase por vuelta (contratos con banderas y por qué, informes de control con su responsabilidad, obras " +
    "paralizadas, visitas de la gente de una empresa que terminaron en una compra, sanciones). Después las secuencias (una cosa " +
    "llevó a otra: visitó y ganó, la ola de contrataciones tras un cambio de gestión), los meses fuera de lo normal, los hechos " +
    "fechados y las series por mes. Se puede pedir sólo un renglón (clase), sólo un periodo (desde, hasta: por ejemplo una " +
    "gestión) o sólo lo de señal alta.",
  cuenta: true,
  entrada: {
    tipo: z.enum(["entidad", "empresa", "partido", "contrato"]),
    id: z.string().min(1).max(100).describe("RUC (entidad o empresa), clave del partido u OCID."),
    clase: z.enum(RENGLONES_HISTORIA).optional().describe("Sólo los hechos de un renglón: banderas (contratos con banderas), control (informes de la Contraloría; en una empresa, sanciones y penalidades), obras, visitas, politica, empresa (socios y fundación), compras, ordenes…"),
    desde: z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/).optional().describe("Sólo lo ocurrido desde esta fecha (AAAA, AAAA-MM o AAAA-MM-DD): por ejemplo el inicio de una gestión."),
    hasta: z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/).optional().describe("Sólo lo ocurrido hasta esta fecha (AAAA, AAAA-MM o AAAA-MM-DD)."),
    solo_graves: z.boolean().default(false).describe("Sólo lo de señal alta."),
    max_eventos: z.number().int().min(5).max(120).default(40),
  },
  async ejecutar(a, cx) {
    const id = a.tipo === "entidad" || a.tipo === "empresa" ? rucJuridico(a.id) : a.id.trim();
    const h = await api<Fila>(cx.env, `/historia/${a.tipo}/${encodeURIComponent(id)}`);
    const sitio = cx.env.VIGIA_URL;
    const enVigia = (href: unknown) => (typeof href === "string" && href.startsWith("/") ? `${sitio}${href}` : undefined);
    const desde = a.desde ? a.desde.padEnd(10, a.desde.length === 4 ? "-01-01" : "-01").slice(0, 10) : null;
    const hasta = a.hasta ? (a.hasta.length === 4 ? `${a.hasta}-12-31` : a.hasta.length === 7 ? `${a.hasta}-31` : a.hasta) : null;
    const enRango = (f: unknown) => (!desde || String(f) >= desde) && (!hasta || String(f).slice(0, 10) <= hasta);
    const renglon = new Map(((h.carriles ?? []) as Fila[]).map((c) => [String(c.clave), String(c.titulo)]));
    const PESO: Record<string, number> = { alta: 0, media: 1, baja: 2 };

    const todos = ((h.eventos ?? []) as Fila[]).filter((x) => enRango(x.hasta ?? x.fecha) && (!a.clase || x.carril === a.clase));
    const decir = (x: Fila) => ({
      ...tomar(x, ["fecha", "hasta", "titulo", "detalle"]),
      renglon: renglon.get(String(x.carril)) ?? x.carril,
      severidad: x.carril === "gobierno" ? undefined : x.severidad ?? undefined,
      monto_soles: x.monto ?? undefined,
      quien: x.quien ? `${(x.quien as Fila).rol}: ${(x.quien as Fila).nombre}` : undefined,
      por_que: ((x.banderas ?? []) as Fila[]).length ? ((x.banderas ?? []) as Fila[]).map((b) => `${b.texto} (${b.severidad})`) : undefined,
      datos: ((x.datos ?? []) as Fila[]).length ? Object.fromEntries(((x.datos ?? []) as Fila[]).map((d) => [String(d.etiqueta), d.valor])) : undefined,
      enlace_vigia: enVigia(x.href),
      fuente: x.fuente,
      fuente_oficial: x.enlace ?? undefined,
    });
    // Lo más grave: los hechos con gravedad, las secuencias y los meses fuera de lo normal, en el orden de la ficha (lo de
    // señal alta primero y, dentro, una clase por vuelta: así no son cuarenta contratos seguidos).
    type Grave = { clase: string; severidad: string; peso: number; fecha: string; cuerpo: Fila };
    const graves: Grave[] = [];
    for (const x of todos) {
      if (x.carril === "gobierno" || !x.severidad) continue;
      const altas = ((x.banderas ?? []) as Fila[]).filter((b) => b.severidad === "alta").length;
      graves.push({ clase: String(x.carril), severidad: String(x.severidad), peso: altas * 1e13 + Number(x.monto ?? 0), fecha: String(x.fecha), cuerpo: { clase: "hecho", ...decir(x) } });
    }
    const secuencias = ((h.secuencias ?? []) as Fila[]).filter((q) => {
      const pasos = (q.pasos ?? []) as Fila[];
      return pasos.length > 0 && enRango(pasos[pasos.length - 1].fecha) && (!a.clase || a.clase === "visitas" === (q.tipo === "visito_gano"));
    });
    const patronesSerie = ((h.patrones ?? []) as Fila[]).filter((q) => enRango(`${q.mes}-01`) && (!a.clase || q.carril === a.clase));
    const deSecuencia = (q: Fila) => ({
      ...tomar(q, ["titulo", "explica", "severidad", "fuente"]),
      pasos: ((q.pasos ?? []) as Fila[]).map((s) => ({ fecha: s.fecha, que: s.texto, enlace_vigia: enVigia(s.href) })),
      enlace_vigia: enVigia(q.href),
    });
    for (const q of secuencias) graves.push({ clase: "secuencias", severidad: String(q.severidad), peso: 0, fecha: String(((q.pasos ?? []) as Fila[])[0]?.fecha ?? ""), cuerpo: { clase: "una cosa llevó a otra", ...deSecuencia(q) } });
    for (const q of patronesSerie) graves.push({ clase: "ritmo", severidad: String(q.severidad), peso: 0, fecha: `${q.mes}-01`, cuerpo: { clase: "fuera de lo normal", ...tomar(q, ["titulo", "explica", "mes", "hasta", "severidad"]), renglon: renglon.get(String(q.carril)) ?? q.carril } });
    const ordenados: Grave[] = [];
    for (const sev of ["alta", "media", "baja"]) {
      if (a.solo_graves && sev !== "alta") break;
      const colas = ORDEN_GRAVE.map((c) => graves.filter((g) => g.severidad === sev && g.clase === c).sort((x, y) => y.peso - x.peso || y.fecha.localeCompare(x.fecha))).filter((q) => q.length > 0);
      for (let i = 0; colas.some((q) => i < q.length); i++) for (const q of colas) if (i < q.length) ordenados.push(q[i]);
    }
    const eventos = todos.filter((x) => !a.solo_graves || x.severidad === "alta").sort((x, y) => String(y.fecha).localeCompare(String(x.fecha)));
    const omitidos = Object.entries((h.omitidos ?? {}) as Record<string, number>).filter(([, n]) => n > 0);
    const ficha = a.tipo === "entidad" ? `${sitio}/entidad/${id}?seccion=historia` : a.tipo === "empresa" ? `${sitio}/empresa/${id}?seccion=historia` : undefined;
    return {
      sujeto: h.sujeto,
      desde: h.desde,
      hasta: h.hasta,
      filtros: a.clase || desde || hasta || a.solo_graves ? { clase: a.clase, desde: desde ?? undefined, hasta: hasta ?? undefined, solo_graves: a.solo_graves || undefined } : undefined,
      gestiones: ((h.eventos ?? []) as Fila[]).filter((x) => x.carril === "gobierno").map((x) => tomar(x, ["titulo", "fecha", "hasta", "detalle"])),
      lo_mas_grave_total: ordenados.length,
      lo_mas_grave: ordenados.slice(0, a.max_eventos).map((g) => g.cuerpo),
      secuencias: secuencias.map(deSecuencia),
      patrones: patronesSerie.map((q) => tomar(q, ["tipo", "titulo", "explica", "mes", "severidad"])),
      eventos_total: eventos.length,
      eventos: eventos.slice(0, a.max_eventos).map(decir),
      no_entraron: omitidos.length
        ? { cuantos: Object.fromEntries(omitidos.map(([c, n]) => [renglon.get(c) ?? c, n])), nota: "La historia trae los hechos más graves y más grandes de cada renglón. Los demás están en la lista de su pestaña: para los contratos con banderas, buscar_contratos con la entidad." }
        : undefined,
      series: (h.series ?? []).map((s: Fila) => ({
        titulo: s.titulo, unidad: s.unidad, fuente: s.fuente,
        puntos: ((s.puntos ?? []) as Fila[]).filter((q) => enRango(String(q.periodo).length === 4 ? `${q.periodo}-12-31` : `${q.periodo}-15`)).slice(-36),
      })),
      marcas: ((h.marcas ?? []) as Fila[]).filter((m) => enRango(m.fecha)).map((m: Fila) => tomar(m, ["fecha", "texto"])),
      enlace: ficha,
      fuentes: h.fuentes,
      como_leerlo:
        "«lo_mas_grave» va primero: es lo que conviene mirar. Cada hecho trae por qué está marcado, quién, cuánto, su enlace en Vigía y la fuente oficial. " +
        "Un pico de visitas o de entradas a la planilla no es señal alta por sí solo. Una señal es un motivo para revisar, no una acusación.",
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
    "señales, con un apellido tapado. `con_cargo_publico` trae a quien presentó declaraciones juradas de intereses o está o " +
    "ESTUVO en una planilla (quien ya no figura en el último mes de su entidad no sale en `planilla`, pero sí aquí), con su " +
    "cargo más reciente y el enlace a su ficha de rastro en Vigía. No se busca por DNI. Para saber si una persona cualquiera " +
    "tiene visitas, empresas, órdenes o declaraciones, usa rastro_persona.",
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
    const [pl, au, tr, cc] = await Promise.all([
      a.donde !== "autoridades" ? api<Fila>(cx.env, "/planilla", { q: a.nombre, size: 10 }) : Promise.resolve(null),
      a.donde !== "planilla" ? api<Fila>(cx.env, "/poder/entidades", { q: a.nombre }).catch((err) => (err instanceof ErrorApi ? null : Promise.reject(err))) : Promise.resolve(null),
      a.donde !== "planilla" ? api<Fila>(cx.env, "/poder/trayectoria", { q: a.nombre }).catch((err) => (err instanceof ErrorApi ? null : Promise.reject(err))) : Promise.resolve(null),
      // El índice de personas con cargo público (declaraciones juradas o planilla, de hoy o de antes).
      api<Fila>(cx.env, "/personas/buscar", { q: a.nombre }).catch((err) => (err instanceof ErrorApi ? null : Promise.reject(err))),
    ]);
    const normal = (t: string) => t.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
    const buscadas = palabras.map(normal);
    return {
      con_cargo_publico: ((cc?.conCargo ?? []) as Fila[]).map((x) => ({
        nombre: x.nombre, cargo: x.cargo ?? undefined, entidad: x.entidad ?? undefined, entidad_ruc: x.entidadRuc ?? undefined,
        el_cargo_sale_de: x.cargoDe === "planilla" ? "la planilla de su entidad" : x.cargoDe === "dji" ? "su declaración jurada de intereses" : undefined,
        en_planilla: x.planillaEntidades > 0 ? (x.planillaHoy ? "figura en la planilla de hoy" : `figuró hasta ${x.planillaHasta ?? "una fecha sin dato"}`) : "no figura en planillas",
        declaraciones_juradas: x.declaraciones, enlace: x.codigo ? e.funcionario(x.codigo) : undefined,
      })),
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
      fuente: "JNE (candidaturas 2014 a 2026; las regionales y municipales de 2026 aún sin resultado publicado), registro de autoridades vigentes, planillas del Portal de Transparencia Estándar y declaraciones juradas de intereses (Contraloría).",
    };
  },
});

/**
 * Las órdenes del familiar frente al puesto (migración 366): por fecha de emisión, las de mientras lo tenía, las de antes y
 * las de después. El fin del puesto es el cese declarado o, sin cese, su última declaración jurada que lo nombra.
 */
function ordenesFrenteAlPuesto(x: Fila) {
  return {
    // Migración 368: el familiar cobra a su nombre o con una empresa en la que figura (RNP).
    como_cobra_el_familiar: x.via === "empresa" ? "con una empresa en la que figura" : "a su nombre",
    empresa_del_familiar: x.empresa ?? undefined, empresa_ruc: x.empresaRuc ?? undefined,
    papel_del_familiar_en_la_empresa: x.rolEnEmpresa ?? undefined, el_familiar_figura_en_la_empresa_desde: x.parienteDesde ?? undefined,
    procesos_que_gano_la_empresa_con_la_persona_en_el_puesto: x.procesosEnPuesto ?? undefined,
    monto_de_esos_procesos_soles: x.montoProcesosEnPuesto ?? undefined,
    sin_cese_consta_en_el_puesto_hasta: x.cargoHasta ? undefined : x.vistoHasta ?? undefined,
    ordenes_emitidas_con_la_persona_en_el_puesto: x.ordenesEnPuesto ?? undefined,
    monto_de_esas_ordenes_soles: x.montoEnPuesto ?? undefined,
    primera_orden_en_el_puesto: x.primeraEnPuesto ?? undefined, ultima_orden_en_el_puesto: x.ultimaEnPuesto ?? undefined,
    ordenes_de_antes_de_que_asumiera: x.ordenesAntes ?? undefined, ordenes_de_despues_del_puesto: x.ordenesLuego ?? undefined,
    el_familiar_no_tenia_ordenes_de_la_entidad_antes_de_que_asumiera: x.empezoDespues,
  };
}

export const rastroPersona = definir({
  nombre: "rastro_persona",
  titulo: "Rastro de una persona",
  descripcion:
    "Busca a una persona por su NOMBRE COMPLETO (apellidos y nombres, en cualquier orden) en todos los registros de Vigía " +
    "a la vez: las visitas que hizo a entidades del Estado (a cuál, cuántas veces, entre qué fechas, a qué oficina y en " +
    "nombre de qué organización), las empresas en que es socia o representante (RNP), sus declaraciones juradas de " +
    "intereses como funcionaria, sus aportes de campaña, si es persona expuesta políticamente, la planilla del Estado, sus " +
    "órdenes de servicio como persona natural, su trayectoria electoral y su cargo vigente. Trae dos cruces ya hechos: " +
    "visitó una entidad y una empresa suya le ganó, y salió de la planilla de una entidad y una empresa suya le ganó " +
    "después (puerta giratoria). Y dos más: dos o más empresas suyas ganan en la misma entidad procesos de objeto parecido, y una empresa suya está inhabilitada mientras otra suya gana buenas pro. También los informes de control de la Contraloría en que figura con responsabilidad presunta (no es una condena) y si la entidad del informe le dio órdenes después. ÚSALA SIEMPRE que pregunten " +
    "por una persona («¿tiene contratos o visitas?», «¿quién es?»): es la única que busca visitas por el nombre del " +
    "visitante. Los nombres salen con un apellido tapado (es sólo para mostrar; la búsqueda usa el nombre entero) y nunca " +
    "sale un documento. No se busca por DNI. Si hay varios nombres parecidos, dilo: pueden ser personas distintas. Si la " +
    "persona tiene cargo público (presentó declaraciones juradas de intereses), `con_cargo_publico` trae su último cargo y " +
    "el enlace a su ficha de rastro en Vigía: dáselo a quien pregunta. Con cargo público trae también `visitas_que_recibio`: " +
    "qué empresas la visitaron en las entidades en que trabajó (por el nombre de quien recibió la visita) y cuántos procesos " +
    "le ganó después cada una a esa entidad; nunca quién visitó. Y `familia_declarada`: lo que obtuvo del Estado cada familiar " +
    "que declaró en su declaración jurada (órdenes a su nombre, empresas en que es socio), numerado y sin nombre, con lo que " +
    "salió de la entidad de la persona; y `dos_ingresos_del_estado`: si está en la planilla de una entidad y otra le emitió " +
    "órdenes de servicio esos mismos meses. `trabajos_declarados` es el PUESTO con sus palabras (la sección de empleos de sus " +
    "declaraciones: «Rector», «Gerente municipal»), dentro y fuera del Estado: úsalo en vez de la categoría del formulario " +
    "(«Colaborador», «Otro cargo, función o labor»), que no dice el puesto. `cargos_en_planilla` da cada cargo que tuvo en cada " +
    "planilla con sus meses y su sueldo de un mes habitual (el último mes de alguien que sale suele ser su liquidación).",
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
    // Las visitas que recibió (migración 335), de la ficha de rastro de cada persona con cargo público que calza (hasta 2).
    const fichas = await Promise.all(((r?.con_cargo_publico ?? []) as Fila[]).filter((x) => x.codigo).slice(0, 2)
      .map((x) => suave(api<Fila>(cx.env, `/personas/cargo/${encodeURIComponent(x.codigo)}`)).then((f) => ({ codigo: x.codigo as string, f }))));
    const visitasQueRecibio = fichas.filter(({ f }) => f?.recibidas?.filas?.length).map(({ codigo, f }) => ({
      ficha: e.funcionario(codigo),
      empresas: f!.recibidas.empresas, visitas: f!.recibidas.visitas, empresas_que_ganaron_despues: f!.recibidas.ganaronDespues,
      filas: ((f!.recibidas.filas ?? []) as Fila[]).slice(0, 20).map((x) => ({
        empresa: x.empresa, ruc: x.ruc, enlace_empresa: e.empresa(x.ruc), entidad: x.entidad, enlace_entidad: x.entidadRuc ? e.entidad(x.entidadRuc) : undefined,
        visitas: x.visitas, primera: x.primera, ultima: x.ultima, procesos_ganados_despues: x.ganoDespues,
        monto_adjudicado_despues_soles: x.montoDespues ?? undefined, primera_buena_pro_despues: x.primeraBuenaPro ?? undefined,
      })),
    }));
    // Su red de familia (migración 351): lo que obtuvo del Estado cada familiar que declaró en su DJI, sin nombre ni
    // documento del familiar; `en_su_entidad` es lo que salió de una entidad en la que la persona declaró.
    const familia = fichas.filter(({ f }) => f?.familia).map(({ codigo, f }) => ({
      ficha: `${e.funcionario(codigo)}?seccion=familia`,
      familiares_declarados: f!.familia.declarados, con_ordenes_del_estado: f!.familia.conOrdenes, en_empresas_que_venden_al_estado: f!.familia.conEmpresas,
      obtuvieron_algo_de_su_entidad: f!.familia.enSuEntidad, de_ellos_cercanos: f!.familia.cercanosEnSuEntidad ?? undefined,
      familiares: ((f!.familia.parientes ?? []) as Fila[]).slice(0, 15).map((x) => ({
        familiar: `Familiar ${x.n}`, parentesco: x.parentesco,
        obtuvo: ((x.items ?? []) as Fila[]).map((i) => i.tipo === "orden"
          ? { que: "órdenes a su nombre", entidad: i.entidad, entidad_ruc: i.entidadRuc ?? undefined, ordenes: i.ordenes ?? undefined, monto_soles: i.monto ?? undefined,
              desde: i.desde ?? undefined, hasta: i.hasta ?? undefined, en_su_entidad: i.suEntidad, cifras_reservadas: i.reservado ? true : undefined }
          : { que: "empresa en que es socio, representante o directivo", empresa: i.empresa, ruc: i.empresaRuc ?? undefined, enlace_empresa: i.empresaRuc ? e.empresa(i.empresaRuc) : undefined,
              le_vendio_al_estado_soles: i.monto ?? undefined, procesos_ganados: i.procesos ?? undefined, en_su_entidad: i.suEntidad,
              ordenes_de_su_entidad: i.suEntidadOrdenes ?? undefined, monto_de_su_entidad_soles: i.suEntidadMonto ?? undefined, cifras_reservadas: i.reservado ? true : undefined }),
      })),
    }));
    // Dos ingresos del Estado (migración 352): en la planilla de una entidad y con órdenes de servicio de otra, los mismos meses.
    const dosIngresos = fichas.flatMap(({ codigo, f }) => ((f?.cruces?.doblePercepcion ?? []) as Fila[]).map((x) => ({
      entidad_de_su_planilla: x.entidad, cargo: x.cargo ?? undefined, sueldo_mensual_soles: x.sueldo ?? undefined, entidad_que_le_emitio_ordenes: x.otra,
      ordenes_de_servicio: x.ordenes, monto_soles: x.monto_soles, meses_que_coinciden: x.meses, desde: x.desde, hasta: x.hasta, docencia: x.docente,
      severidad: x.severidad, ficha: `${e.funcionario(codigo)}?seccion=revision`,
    })));
    const comprasFamilia = fichas.flatMap(({ codigo, f }) => ((f?.cruces?.comprasFamiliar ?? []) as Fila[]).map((x) => ({
      puesto_declarado: x.cargo, tipo_de_puesto: x.tipoCargo === "compras" ? "compras, logística o contrataciones" : "decide o paga el gasto",
      en_el_puesto_desde: x.cargoDesde ?? undefined, hasta: x.cargoHasta ?? "sin cese declarado", entidad: x.entidad, entidad_ruc: x.entidadRuc,
      parentesco_del_familiar: x.parentesco, familiar_cercano: x.cercano, ordenes_al_familiar: x.ordenes, monto_soles: x.monto,
      ordenes_desde_el_anio: x.desde ?? undefined, ordenes_hasta_el_anio: x.hasta ?? undefined,
      ...ordenesFrenteAlPuesto(x), severidad: x.severidad, en_observacion: true,
      ficha: `${e.funcionario(codigo)}?seccion=revision`,
    })));
    // El puesto con sus palabras (migración 357): la sección de empleos de sus declaraciones juradas (sólo empleadores con
    // RUC 20) y cada cargo que tuvo en cada planilla, con lo que cobró en un mes habitual.
    const trabajos = fichas.flatMap(({ codigo, f }) => ((f?.empleos ?? []) as Fila[]).slice(0, 25).map((x) => ({
      puesto: x.cargo, empleador: x.entidad, ruc: x.ruc, es_entidad_publica: x.publica, desde: x.inicio ?? undefined, hasta: x.cese ?? undefined,
      sin_fecha_de_cese: x.sinCese || undefined, declaraciones_en_que_figura: x.declaraciones,
      enlace: x.publica ? e.entidad(x.ruc) : e.empresa(x.ruc), ficha: `${e.funcionario(codigo)}?seccion=cargos`,
    })));
    const cargosPlanilla = fichas.flatMap(({ codigo, f }) => ((f?.planilla ?? []) as Fila[]).flatMap((pl2) =>
      ((pl2.cargos?.length ? pl2.cargos : [pl2]) as Fila[]).map((k, j) => ({
        entidad: pl2.entidad, entidad_ruc: pl2.entidadRuc, cargo: k.cargo ?? undefined, oficina: k.dependencia ?? undefined,
        desde_mes: k.primerMes ?? undefined, hasta_mes: k.ultimoMes ?? undefined, meses_publicados: k.meses ?? undefined,
        sueldo_de_un_mes_habitual_soles: k.base ?? undefined,
        con_otros_pagos_soles: k.total != null && k.total > (k.base ?? 0) * 1.15 ? k.total : undefined,
        situacion: j > 0 ? "cargo anterior en la misma entidad" : pl2.situacion === "hoy" ? "en la planilla de hoy" : "ya no figura",
        ficha: `${e.funcionario(codigo)}?seccion=cargos`,
      }))));
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
        candidaturas: hay(tr?.personas), con_cargo_publico: hay(r?.con_cargo_publico),
      },
      // Quien presentó declaraciones juradas de intereses: su último cargo y su ficha de rastro en la web.
      con_cargo_publico: ((r?.con_cargo_publico ?? []) as Fila[]).map((x) => ({
        nombre: x.nombre, ultimo_cargo: x.cargo ?? undefined, entidad: x.entidad ?? undefined, declaraciones_juradas: x.declaraciones,
        enlace: x.codigo ? e.funcionario(x.codigo) : undefined,
      })),
      visitas,
      // Por el nombre de quien recibió la visita, sólo en entidades en que la persona tuvo cargo o planilla: un homónimo
      // exacto en la misma entidad saldría también.
      visitas_que_recibio: visitasQueRecibio.length ? visitasQueRecibio : undefined,
      // Lo que obtuvo del Estado su familia declarada. Los proveedores no presentan declaración jurada: esto sólo existe para
      // quien tiene cargo público. Un familiar con órdenes o empresas no es una falta; en la entidad de la persona es un indicio.
      familia_declarada: familia.length ? familia : undefined,
      // La ley no permite dos ingresos del Estado salvo la docencia y las dietas (art. 40 de la Constitución; art. 3 de la Ley 28175).
      dos_ingresos_del_estado: dosIngresos.length ? dosIngresos : undefined,
      // En observación (migración 364): su puesto declarado es de compras o decide el gasto, y un familiar que declaró
      // recibió órdenes de esa misma entidad. El familiar, sólo por su parentesco.
      trabaja_en_compras_y_un_familiar_cobra_de_su_entidad: comprasFamilia.length ? comprasFamilia : undefined,
      // Lo que la persona escribió en sus declaraciones: es el puesto real cuando el cargo declarado dice «Colaborador».
      trabajos_declarados: trabajos.length ? trabajos : undefined,
      cargos_en_planilla: cargosPlanilla.length ? cargosPlanilla : undefined,
      empresas: ((r?.empresas ?? []) as Fila[]).map((x) => ({ ...x, enlace: x.ruc ? e.empresa(x.ruc) : undefined })),
      // Lo primero que mira un investigador: visitó la entidad y una empresa suya le ganó procesos.
      visito_y_su_empresa_gano: ((r?.visito_y_su_empresa_gano ?? []) as Fila[]).map((x) => ({
        ...x, enlace_empresa: x.empresa_ruc ? e.empresa(x.empresa_ruc) : undefined, enlace_entidad: x.entidad_ruc ? e.entidad(x.entidad_ruc) : undefined,
      })),
      // Puerta giratoria: dejó la planilla de una entidad y una empresa suya le ganó después a esa misma entidad.
      salio_de_la_entidad_y_su_empresa_gano: ((r?.salio_de_la_entidad_y_su_empresa_gano ?? []) as Fila[]).map((x) => ({
        ...x, enlace_empresa: x.empresa_ruc ? e.empresa(x.empresa_ruc) : undefined, enlace_entidad: x.entidad_ruc ? e.entidad(x.entidad_ruc) : undefined,
      })),
      // Red de la persona: dos o más empresas suyas ganan en la misma entidad procesos de objeto parecido (migración 292).
      gana_en_la_misma_entidad_con_varias_empresas: ((r?.gana_en_la_misma_entidad_con_varias_empresas ?? []) as Fila[]).map((x) => ({
        entidad: x.entidad, entidad_ruc: x.entidad_ruc, empresas: ((x.empresas ?? []) as Fila[]).map((y) => ({ empresa: y.nombre, ruc: y.ruc, enlace: e.empresa(y.ruc) })),
        contratos_con_objeto_parecido: x.contratos_con_objeto_parecido, con_90_dias_o_menos_entre_si: x.con_90_dias_o_menos_entre_si,
        monto_soles: x.monto_soles, desde: x.desde, hasta: x.hasta, ejemplos: ((x.ejemplos_ocid ?? []) as string[]).map((o) => e.contrato(o)),
        enlace_entidad: x.entidad_ruc ? e.entidad(x.entidad_ruc) : undefined,
      })),
      // Una empresa suya está inhabilitada y otra empresa suya ganó dentro de la sanción (migración 297).
      empresa_suya_inhabilitada_y_otra_gano: ((r?.empresa_suya_inhabilitada_y_otra_gano ?? []) as Fila[]).map((x) => ({
        ...x, enlace_inhabilitada: x.empresa_inhabilitada_ruc ? e.empresa(x.empresa_inhabilitada_ruc) : undefined,
        enlace_empresa: x.empresa_que_gano_ruc ? e.empresa(x.empresa_que_gano_ruc) : undefined,
      })),
      // Informes de control de la Contraloría en que figura con responsabilidad PRESUNTA (por nombre completo).
      informes_de_control: ((r?.informes_de_control ?? []) as Fila[]).map((x) => ({
        nombre: x.nombre, informe: x.numero ?? x.codigo, titulo: x.titulo, entidad: x.entidad, entidad_ruc: x.entidad_ruc, fecha: x.fecha,
        responsabilidad_presunta: x.responsabilidades, ficha: x.ficha ?? undefined,
        enlace_entidad: x.entidad_ruc ? e.entidad(x.entidad_ruc) : undefined,
      })),
      // Figura en un informe de una entidad y esa misma entidad le dio órdenes después.
      en_informe_de_control_y_despues_cobro: ((r?.en_informe_de_control_y_despues_cobro ?? []) as Fila[]).map((x) => ({
        ...x, enlace_entidad: x.entidad_ruc ? e.entidad(x.entidad_ruc) : undefined,
      })),
      salidas_de_planilla: r?.salidas_de_planilla ?? [],
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
    "cobertura; más grave si comparten socio). Con alcance «consorcio»: empresas que postularon juntas en un consorcio y " +
    "después compiten por separado en procesos de pocos postores que gana una de las dos (posible reparto). Con alcance " +
    "«renovacion»: servicios que una entidad volvió a contratar pagando 30 % o más POR MES que en el contrato anterior " +
    "(con cuánto costaba, cuánto cuesta y si el proveedor es el mismo). Con alcance «control»: empresas que ganan con un socio o representante comprendido en un informe de control de la Contraloría anterior (responsabilidad presunta). Con alcance «observado»: proveedores con procesos que la Contraloría observó en un informe de control, por entidad, y cuánto les adjudicó esa misma entidad después del informe. Con alcance «inhabilitada»: empresas que ganan mientras otra empresa del mismo socio está inhabilitada (con ruc: la ganadora, la inhabilitada o la entidad). Con alcance «dueno»: un mismo socio que gana en una " +
    "entidad con dos o más empresas procesos de objeto parecido (reparto de compras entre razones sociales). Con un RUC, los patrones de esa entidad o empresa. Cada patrón trae contratos " +
    "de ejemplo para abrir con ficha_contrato o dictamen. Con alcance «observacion»: los indicadores NUEVOS que Vigía todavía " +
    "está midiendo, contrato por contrato (una reunión de la empresa con quien decide las compras mientras se evaluaban las " +
    "ofertas; visitas declaradas «personales» y repetidas a quien decide; dos rivales con un socio común que registran sus " +
    "ofertas casi a la vez; un funcionario de la entidad que declaró en su DJI haber trabajado en la empresa que ganó " +
    "mientras él ocupaba el cargo; un contrato firmado cuando los otros postores todavía podían apelar la buena pro): " +
    "se muestran con su evidencia y NO cuentan para el puntaje del contrato. " +
    "Con alcance «grupo»: proveedores de una MISMA entidad unidos por dueño o familia probable (empresas con un socio común, " +
    "la persona que vende con su RUC y es socia de una de ellas, socios con los mismos dos apellidos poco comunes), con lo que " +
    "hicieron juntos en las órdenes: al borde del tope de 8 UIT, órdenes el mismo día con números correlativos y el mismo " +
    "objeto repartido entre miembros (fraccionamiento visto como grupo); con ruc, los de esa entidad o los de esa empresa. " +
    "Con alcance «repetida»: la misma compra (proveedor, monto y objeto) en varias órdenes directas de 7 a 90 días entre sí: " +
    "fraccionamiento en el tiempo si juntas pasan el tope y cada una queda al borde, o posible pago doble si todas se devengaron. " +
    "Con alcance «doble»: personas de la planilla de una entidad que, esos mismos meses, recibieron órdenes de servicio de otra " +
    "(dos ingresos del Estado: sólo lo permite la docencia y las dietas); con ruc, las de esa entidad. " +
    "Con alcance «recien_creada»: empresas que se inscribieron en la SUNAT y a 90 días o menos ya recibían órdenes directas " +
    "(sin proceso) de una entidad; con ruc, las de esa entidad o esa empresa. " +
    "Con alcance «compras_familia» (en observación): funcionarios cuyo puesto declarado es de compras, logística o " +
    "contrataciones y un familiar declarado en su declaración jurada que recibió órdenes de esa misma entidad, a su nombre o " +
    "con una empresa en la que figura como socio, representante o directivo (con su RUC y los procesos que ganó), con " +
    "cuántas de esas órdenes se emitieron mientras tenía el puesto, cuántas antes y cuántas después; con ruc, los de esa " +
    "entidad; solo_graves deja los de familiar cercano con órdenes emitidas en el puesto. El familiar sale sólo por su parentesco. " +
    "Con alcance «autoridad_exsocio» (en observación): autoridades electas (alcalde, regidor, gobernador, consejero) que dejaron de " +
    "figurar en una empresa del RNP y lo que esa empresa le vendió a su entidad dentro de su periodo, con cuántas ventas caen " +
    "hasta 12 meses después de su salida (el plazo del impedimento por participación); con ruc, los de esa entidad o empresa. " +
    "Un patrón es un motivo para mirar, no una acusación.",
  cuenta: true,
  entrada: {
    alcance: z.enum(["entidad", "proveedor", "relleno", "consorcio", "renovacion", "dueno", "inhabilitada", "control", "observado", "observacion", "grupo", "repetida", "doble", "recien_creada", "compras_familia", "autoridad_exsocio"]).default("entidad"),
    indicador: z.enum(["reunion_en_evaluacion", "visita_personal_decisor", "ofertas_a_la_vez", "trabajo_en_el_ganador",
      "firma_en_plazo_de_apelacion"]).optional()
      .describe("(observacion) Sólo uno de los indicadores en observación."),
    ruc: z.string().min(11).max(14).optional().describe("RUC 20 de la entidad o de la empresa (opcional)."),
    regla: z.string().max(60).optional().describe("Sólo una señal, por su código (p. ej. unica_oferta_valida)."),
    solo_graves: z.boolean().optional().describe("(dueno) Sólo grupos con contratos parecidos a 90 días o menos entre sí. (inhabilitada) Sólo con sanción definitiva o empresa hecha cerca de la sanción. (observado) Sólo con responsabilidad penal presunta en una observación de selección, ejecución o pagos."),
    siguio_ganando: z.boolean().optional().describe("(observado) Sólo donde la misma entidad le volvió a adjudicar después de emitido el informe."),
    minimo_contratos: z.number().int().min(2).max(500).optional().describe("(dueno) Sólo grupos con al menos tantos contratos parecidos."),
    pagina: z.number().int().min(1).max(50).default(1),
  },
  async ejecutar(a, cx) {
    const e = enlaces(cx.env);
    const ruc = a.ruc ? rucJuridico(a.ruc) : undefined;
    if (a.alcance === "recien_creada") {
      const r = await api<Fila>(cx.env, "/patrones/recien", { buscar: ruc, severidad: a.solo_graves ? "alta" : undefined, page: a.pagina, size: 20 });
      return {
        total: r.total,
        casos: ((r.data ?? []) as Fila[]).map((x) => ({
          empresa: x.nombre, ruc: x.ruc, entidad: x.entidad, entidad_ruc: x.entidadRuc, severidad: x.severidad,
          alta_en_sunat: x.fechaAlta, primera_orden_directa: x.primeraOrden, dias_del_alta_a_la_primera_orden: x.dias,
          ordenes_en_su_primer_anio: x.ordenesPrimerAnio, monto_en_su_primer_anio_soles: x.montoPrimerAnio,
          parte_de_sus_ventas_por_ordenes_que_viene_de_esta_entidad: x.parteEntidad ?? undefined,
          enlace_empresa: x.ruc ? e.empresa(String(x.ruc)) : undefined, enlace_entidad: e.entidad(String(x.entidadRuc)),
          ficha_del_caso: x.clave ? `${cx.env.VIGIA_URL}/app/patrones/caso/recien/${x.clave}` : undefined,
        })),
        como_leerlo: r.como_leerlo,
        aviso: AVISO,
      };
    }
    if (a.alcance === "autoridad_exsocio") {
      const r = await api<Fila>(cx.env, "/patrones/autoridad-exsocio", { buscar: ruc, severidad: a.solo_graves ? "alta" : undefined, page: a.pagina, size: 20 });
      return {
        total: r.total,
        en_observacion: true,
        resumen: r.resumen ?? undefined,
        casos: ((r.data ?? []) as Fila[]).map((x) => ({
          autoridad: x.autoridad, cargo: x.cargo, lugar: x.lugar ?? undefined, periodo_desde: x.periodoInicio, periodo_hasta: x.periodoFin ?? undefined,
          entidad: x.entidad, entidad_ruc: x.entidadRuc, empresa: x.empresa, empresa_ruc: x.empresaRuc,
          papeles_que_tuvo_en_la_empresa: x.roles, fue_socio: x.fueSocio, figuraba_desde: x.desde ?? undefined,
          dejo_de_figurar_en_el_corte_del_rnp: x.bajaCorte,
          ordenes_en_su_periodo: x.ordenes, monto_ordenes_soles: x.montoOrdenes, procesos_adjudicados_en_su_periodo: x.procesos, monto_procesos_soles: x.montoProcesos,
          ventas_cuando_aun_figuraba: x.ventasMientras, ventas_hasta_12_meses_despues_de_su_salida: x.ventasEnPlazo, monto_de_esas_ventas_soles: x.montoEnPlazo,
          ventas_de_mas_de_12_meses_despues: x.ventasDespues, primera_venta: x.primera ?? undefined, ultima_venta: x.ultima ?? undefined, severidad: x.severidad,
          enlace_empresa: x.empresaRuc ? `${e.empresa(String(x.empresaRuc))}?seccion=gente` : undefined,
          enlace_entidad: x.entidadRuc ? e.entidad(String(x.entidadRuc)) : undefined,
          ficha_del_caso: x.clave ? `${cx.env.VIGIA_URL}/app/patrones/caso/autoridad/${x.clave}` : undefined,
        })),
        como_leerlo: r.como_leerlo,
        aviso: AVISO,
      };
    }
    if (a.alcance === "compras_familia") {
      const r = await api<Fila>(cx.env, "/patrones/compras-familia", { buscar: ruc, severidad: a.solo_graves ? "alta" : undefined, page: a.pagina, size: 20 });
      return {
        total: r.total,
        en_observacion: true,
        resumen_por_severidad: r.resumen,
        casos: ((r.data ?? []) as Fila[]).map((x) => ({
          persona: x.persona, puesto_declarado: x.cargo, en_el_puesto_desde: x.cargoDesde ?? undefined, hasta: x.cargoHasta ?? "sin cese declarado",
          entidad: x.entidad, entidad_ruc: x.entidadRuc, parentesco_del_familiar: x.parentesco, familiar_cercano: x.cercano,
          ordenes_al_familiar: x.ordenes, monto_soles: x.monto, ordenes_desde_el_anio: x.desde ?? undefined, ordenes_hasta_el_anio: x.hasta ?? undefined,
          ...ordenesFrenteAlPuesto(x), severidad: x.severidad,
          ficha_del_caso: x.clave ? `${cx.env.VIGIA_URL}/app/patrones/caso/compras/${x.clave}` : undefined,
          enlace_persona: x.codigo ? `${e.funcionario(String(x.codigo))}?seccion=revision` : undefined,
          enlace_entidad: x.entidadRuc ? e.entidad(String(x.entidadRuc)) : undefined,
          enlace_empresa_del_familiar: x.empresaRuc ? e.empresa(String(x.empresaRuc)) : undefined,
          // Todo lo que la entidad le compró a esa empresa, en la lista de compras de la entidad.
          enlace_compras_a_esa_empresa: x.empresaRuc && x.entidadRuc ? `${e.entidad(String(x.entidadRuc))}?seccion=contratos&ccon=${x.empresaRuc}` : undefined,
        })),
        como_leerlo: r.como_leerlo,
        aviso: AVISO,
      };
    }
    if (a.alcance === "doble") {
      const r = await api<Fila>(cx.env, "/patrones/doble", { buscar: ruc, severidad: a.solo_graves ? "media" : undefined, page: a.pagina, size: 20 });
      return {
        total: r.total,
        casos: ((r.data ?? []) as Fila[]).map((x) => ({
          persona: x.persona, cargo: x.cargo, entidad_de_su_planilla: x.entidad, entidad_ruc: x.entidadRuc, sueldo_mensual_soles: x.sueldo ?? undefined,
          entidad_que_le_emitio_ordenes: x.otra, otra_entidad_ruc: x.otraRuc, ordenes_de_servicio: x.ordenes, monto_soles: x.monto,
          meses_que_coinciden: x.meses, desde: x.desde, hasta: x.hasta, docencia: x.docente, severidad: x.severidad,
          enlace_persona: x.codigo ? e.funcionario(String(x.codigo)) : undefined,
        })),
        como_leerlo: r.como_leerlo,
        aviso: AVISO,
      };
    }
    if (a.alcance === "repetida") {
      // Con un RUC: primero como entidad; si no hay nada, como empresa proveedora.
      let r = await api<Fila>(cx.env, "/patrones/repetidas", { entidad: ruc, severidad: a.solo_graves ? "alta" : undefined, page: a.pagina, size: 20 });
      if (ruc && !(r.total > 0)) r = await api<Fila>(cx.env, "/patrones/repetidas", { ruc, severidad: a.solo_graves ? "alta" : undefined, page: a.pagina, size: 20 });
      return {
        total: r.total,
        compras_repetidas: ((r.data ?? []) as Fila[]).map((x) => ({
          entidad: x.entidad, entidad_ruc: x.entidadRuc, proveedor: x.nombre, proveedor_ruc: String(x.ruc ?? "").startsWith("20") ? x.ruc : undefined,
          severidad: x.severidad, objeto: x.objeto, monto_de_cada_orden: x.monto, ordenes: x.ordenes, total_soles: x.total, tope_soles: x.tope,
          desde: x.desde, hasta: x.hasta, dias: x.dias, devengadas: x.devengadas,
          detalle: ((x.detalle ?? []) as Fila[]).map((o) => ({ orden: o.orden, fecha: o.fecha, estado: o.estado, enlace: e.orden(String(x.entidadRuc), o.orden, o.fecha) })),
          ficha_del_caso: x.clave ? `${cx.env.VIGIA_URL}/app/patrones/caso/repetidas/${x.clave}` : undefined,
          enlace_entidad: e.entidad(x.entidadRuc),
        })),
        como_leerlo: r.como_leerlo,
        aviso: AVISO,
      };
    }
    if (a.alcance === "grupo") {
      // Con un RUC: si es una entidad, sus grupos; si no, los grupos de esa empresa (en cada entidad a la que vendió).
      let r = await api<Fila>(cx.env, "/patrones/grupos", { entidad: ruc, severidad: a.solo_graves ? "alta" : undefined, page: a.pagina, size: 10 });
      if (ruc && !(r.total > 0)) r = await api<Fila>(cx.env, "/patrones/grupos", { ruc, severidad: a.solo_graves ? "alta" : undefined, page: a.pagina, size: 10 });
      return {
        total: r.total,
        grupos: ((r.data ?? []) as Fila[]).map((g) => ({
          entidad: g.entidad, entidad_ruc: g.entidadRuc, severidad: g.severidad, miembros: g.miembros, empresas: g.empresas, personas: g.personas,
          ordenes: g.ordenes, monto_soles: g.monto, desde: g.desde, hasta: g.hasta,
          puesto_del_grupo_entre_los_proveedores: g.puestoGrupo, puesto_de_su_miembro_mayor: g.puestoMayor,
          parte_de_sus_ventas_por_ordenes_que_viene_de_esta_entidad: g.parteEntidad ?? undefined,
          al_borde_del_tope: { ordenes: g.borde, de_ordenes_hasta_8_uit: g.hasta8Uit, monto_soles: g.montoBorde },
          sobre_el_tope: g.sobreTope, dias_con_ordenes_a_varios_miembros: g.diasJuntos, pares_de_ordenes_correlativas: g.correlativas,
          objetos_repartidos_entre_miembros: g.repartidos, monto_repartido_soles: g.montoRepartido,
          integrantes: ((g.miembros ?? []) as Fila[]).map((m) => ({
            nombre: m.nombre, ruc: m.persona ? undefined : m.ruc, persona_natural: m.persona || undefined, ordenes: m.ordenes, monto_soles: m.monto,
            parte_de_sus_ventas_por_ordenes_que_viene_de_esta_entidad: m.parteDeSusVentas ?? undefined,
            enlace: m.persona ? (m.codigo ? `${cx.env.VIGIA_URL}/app/personas/${m.codigo}` : undefined) : e.empresa(m.ruc),
          })),
          por_que_estan_juntos: ((g.vinculos ?? []) as Fila[]).slice(0, 20).map((v) => ({ entre: [v.nombreA, v.nombreB], vinculo: v.que, persona: v.persona ?? undefined, otra_persona: v.personaB ?? undefined })),
          dias_destacados: ((g.dias ?? []) as Fila[]).slice(0, 6).map((d) => ({ fecha: d.fecha, ordenes: d.ordenes, miembros: d.miembros, monto_soles: d.monto, correlativas: d.correlativas,
            ordenes_del_dia: ((d.detalle ?? []) as Fila[]).map((o) => ({ orden: o.orden, a: o.nombre, monto_soles: o.monto })) })),
          objetos_repartidos: ((g.objetosRepartidos ?? []) as Fila[]).slice(0, 6).map((x) => ({ anio: x.anio, objeto: x.objeto, ordenes: x.ordenes, miembros: x.miembros, monto_soles: x.monto, tope_soles: x.tope })),
          parientes_declarados_de_funcionarios_de_la_entidad: ((g.parientesDeFuncionarios ?? []) as Fila[]).map((d) => ({ integrante: d.nombre, cargo_del_funcionario: d.cargo ?? undefined, parentesco: d.parentesco,
            como: d.via === "socio" ? "un socio o representante de esta empresa es el pariente declarado" : "el integrante es el pariente declarado (vende con su RUC)" })),
          // La ficha del caso: su historia hecho por hecho, la red de quiénes son, cada orden y qué revisar.
          ficha_del_caso: g.clave ? `${cx.env.VIGIA_URL}/app/patrones/caso/grupos/${g.clave}` : undefined,
          enlace_entidad: e.entidad(g.entidadRuc),
        })),
        como_leerlo:
          "Un grupo junta proveedores de la misma entidad; cada uno solo puede parecer pequeño. «posibles hermanos» sale de los apellidos y no está comprobado. " +
          "Para confirmar un fraccionamiento hay que ver si las órdenes del mismo día o del mismo objeto respondían a un solo requerimiento.",
        aviso: AVISO,
      };
    }
    if (a.alcance === "observacion") {
      const r = await api<Fila>(cx.env, "/patrones/observacion", { ruc, tipo: a.indicador, page: a.pagina, size: 20 });
      return {
        total: r.total,
        por_indicador: ((r.porTipo ?? []) as Fila[]).map((x) => ({
          indicador: x.tipo, que_es: x.etiqueta, contratos: x.n,
          cuan_frecuente: x.tasaBase ? { casos: x.tasaBase.casos, de: x.tasaBase.universo, universo: x.tasaBase.que } : undefined,
        })),
        casos: ((r.data ?? []) as Fila[]).map((x) => ({
          indicador: x.tipo, que_es: x.etiqueta, empresa: x.empresa, ruc: x.ruc, enlace_empresa: e.empresa(x.ruc),
          entidad: x.entidad, ruc_entidad: x.entidadRuc ?? undefined, contrato: e.contrato(x.ocid), codigo: x.codigo ?? undefined,
          objeto: x.objeto ? recortar(x.objeto, 140) : undefined, buena_pro: x.buenaPro ?? undefined,
          // De quien recibió la visita, sólo su cargo y su área; quien visitó sale en ficha_contrato, con un apellido tapado.
          cargo_de_quien_recibio: x.cargo ?? undefined, area: x.area ?? undefined,
          visitas: x.visitas ?? undefined, dias_distintos: x.dias ?? undefined, meses_distintos: x.meses ?? undefined,
          presento_su_oferta: x.oferta ?? undefined, dias_de_evaluacion: x.diasEvaluacion ?? undefined,
          ya_era_proveedor_de_la_entidad: x.yaProveedor ?? undefined,
          minutos_entre_las_ofertas: x.minutos ?? undefined, horas_de_registro: x.horaGanador && x.horaOtro ? [x.horaGanador, x.horaOtro] : undefined,
          otro_postor: x.otro ?? undefined, ruc_otro_postor: x.otroRuc ?? undefined,
          cuando_fue_el_empleo: x.cuando ?? undefined, empleo_desde: x.empleoDesde ?? undefined, empleo_hasta: x.empleoHasta ?? undefined,
          firma_del_contrato: x.firma ?? undefined, dias_habiles_tras_la_buena_pro: x.diasHabiles ?? undefined,
          ofertas_en_el_item: x.ofertas ?? undefined, consentimiento_registrado: x.consentimiento ?? undefined, norma: x.norma ?? undefined,
        })),
        como_leerlo:
          "Son indicadores EN OBSERVACIÓN: Vigía todavía mide cuántas veces aciertan, así que no cuentan para el puntaje del " +
          "contrato ni lo hacen un «contrato con antecedentes». reunion_en_evaluacion: gente de la empresa visitó a un " +
          "funcionario que decide las compras después de presentar su oferta y antes de la buena pro; pesa más si la empresa " +
          "no era proveedora de la entidad (entre quienes no lo eran, 1,01 % de los que ganan tuvo esa reunión contra 0,32 % " +
          "de los que pierden; entre proveedores previos casi no hay diferencia). visita_personal_decisor: la misma persona " +
          "visitó al mismo funcionario que decide, declarando «visita personal», en 3 o más días de 2 o más meses, en el año " +
          "anterior a la buena pro. ofertas_a_la_vez: el ganador y otro postor comparten un socio o representante y " +
          "registraron sus ofertas con 30 minutos o menos de diferencia. trabajo_en_el_ganador: un funcionario de la entidad " +
          "declaró en su DJI (datos abiertos) un empleo en la empresa, y la buena pro cayó mientras ocupaba su cargo; " +
          "cuando_fue_el_empleo dice si el empleo seguía vigente (a_la_vez), si empezó después (despues), si lo dejó en los " +
          "dos años anteriores (hasta_2_anios) o antes. firma_en_plazo_de_apelacion: en un ítem con dos o más ofertas, el " +
          "contrato se firmó antes del 5.º día hábil siguiente a la buena pro, cuando los otros postores todavía podían " +
          "apelarla (el contrato se perfecciona después del consentimiento: arts. 64 y 141 del reglamento de la Ley 30225; " +
          "arts. 82, 90 y 304 del de la Ley 32069); puede ser también un error de fecha en CONOSCE. " +
          "Cada uno tiene una explicación sencilla posible " +
          "(una subsanación, un familiar, el mismo estudio contable): abre el contrato con ficha_contrato y lee su evidencia.",
        fuente: "Registro de visitas en línea, Registro Nacional de Proveedores, CONOSCE (adjudicaciones, contratos y postores) y el reporte de presentación de ofertas del SEACE",
        aviso: AVISO,
      };
    }
    if (a.alcance === "observado") {
      const r = await api<Fila>(cx.env, "/patrones/observados", { ruc, page: a.pagina, size: 20, graves: a.solo_graves ? 1 : undefined, siguio: a.siguio_ganando ? 1 : undefined });
      return {
        total: r.total,
        casos: ((r.data ?? []) as Fila[]).map((x) => ({
          empresa: x.empresa, ruc: x.ruc, enlace: e.empresa(x.ruc), entidad: x.entidad, ruc_entidad: x.entidadRuc,
          procesos_observados: x.observados, graves: x.graves, observaciones: x.observaciones, informes: x.informes, temas: x.temas ?? undefined,
          monto_de_los_procesos_soles: x.monto, perjuicio_que_cuantifican_soles: x.perjuicio ?? undefined,
          primer_informe: x.informeNumero ?? x.informeCodigo, fecha_del_informe: x.emision, responsabilidad_presunta: x.responsabilidades,
          ficha_del_informe: x.ficha ?? undefined,
          adjudicado_despues_por_la_misma_entidad: { procesos: x.despues, monto_soles: x.montoDespues ?? undefined, ultima_buena_pro: x.ultimaDespues ?? undefined },
          ejemplos: ((x.ejemplos ?? []) as string[]).map((o) => e.contrato(o)),
        })),
        como_leerlo:
          "Cada fila es un proveedor y una entidad: procesos que ese proveedor ganó ahí y que una observación de un informe " +
          "de control de la Contraloría nombra (por su nomenclatura o por el CUI de la obra). El informe es posterior al " +
          "proceso y dice lo que los auditores encontraron; la responsabilidad que identifica es PRESUNTA y recae en " +
          "funcionarios y servidores: NO sanciona al proveedor. «adjudicado_despues» cuenta lo que esa misma entidad le " +
          "adjudicó con su propio RUC después de emitido el primer informe (lo ganado en consorcio no se cuenta). Abre el " +
          "contrato de ejemplo con ficha_contrato y lee la observación con informes_control o buscar_informes_control.",
        fuente: "Contraloría (Fichas Resumen de los informes de control, leídas con IA) y CONOSCE (adjudicaciones desde 2018)",
        aviso: AVISO,
      };
    }
    if (a.alcance === "control") {
      const r = await api<Fila>(cx.env, "/patrones/control", { ruc, page: a.pagina, size: 20, graves: a.solo_graves ? 1 : undefined });
      return {
        total: r.total,
        casos: ((r.data ?? []) as Fila[]).map((x) => ({
          empresa_que_gana: x.empresa, ruc: x.ruc, enlace: e.empresa(x.ruc), persona: x.socios?.[0]?.nombre ?? undefined, papel_en_la_empresa: x.socios?.[0]?.rol,
          informe_de_control: x.informeNumero ?? x.informeCodigo, entidad_del_informe: x.informeEntidad, fecha_del_informe: x.emision,
          responsabilidad_presunta: x.responsabilidades, otros_informes_de_la_persona: Math.max(0, Number(x.informes ?? 1) - 1),
          ficha_del_informe: x.ficha ?? undefined, informe_de_la_misma_entidad_que_contrato: x.mismaEntidad === true ? true : undefined,
          contratos_ganados_despues: x.contratos, graves: x.graves, monto_de_los_procesos_soles: x.monto, entidades: x.entidades,
          primera_buena_pro: x.desde, ultima_buena_pro: x.hasta, ejemplos: ((x.ejemplos ?? []) as string[]).map((o) => e.contrato(o)),
        })),
        como_leerlo:
          "Cada fila es una empresa que ganó buenas pro teniendo como socio o representante legal a una persona comprendida en " +
          "un informe de control de la Contraloría emitido ANTES. La responsabilidad es PRESUNTA: no es una condena ni un " +
          "impedimento para contratar. «graves»: responsabilidad penal presunta y el informe es de la misma entidad que " +
          "contrató o de los dos años anteriores. Lee qué observó el informe (informes_control o su ficha) y si se parece a lo " +
          "contratado; si ganó en consorcio, el monto es el del proceso entero.",
        fuente: "Contraloría (informes de control), RNP (socios y representantes) y CONOSCE (adjudicaciones desde 2018)",
        aviso: AVISO,
      };
    }
    if (a.alcance === "inhabilitada") {
      const r = await api<Fila>(cx.env, "/patrones/inhabilitadas", { ruc, page: a.pagina, size: 20, graves: a.solo_graves ? 1 : undefined });
      return {
        total: r.total,
        casos: ((r.data ?? []) as Fila[]).map((x) => ({
          empresa_que_gana: x.empresa, ruc: x.ruc, enlace: e.empresa(x.ruc), socio: x.socios?.[0]?.nombre ?? undefined,
          empresa_inhabilitada: x.sancionada, ruc_inhabilitada: x.sancionadaRuc, enlace_inhabilitada: x.sancionadaRuc ? e.empresa(x.sancionadaRuc) : undefined,
          ficha_del_caso: x.clave ? `${cx.env.VIGIA_URL}/app/patrones/caso/inhabilitadas/${x.clave}` : undefined,
          sancion: x.sancion === "definitivo" ? "inhabilitación definitiva" : "inhabilitación temporal", sancion_desde: x.sancionDesde, sancion_hasta: x.sancionHasta ?? undefined,
          contratos_ganados_durante_la_sancion: x.contratos, graves: x.graves, monto_de_los_procesos_soles: x.monto, entidades: x.entidades,
          ganadora_fundada: x.fundada ?? undefined, hecha_cerca_de_la_sancion: x.hechaParaSeguir === true ? true : undefined,
          primera_buena_pro: x.desde, ultima_buena_pro: x.hasta, ejemplos: ((x.ejemplos ?? []) as string[]).map((o) => e.contrato(o)),
        })),
        como_leerlo:
          "Cada fila es una empresa que ganó buenas pro mientras otra empresa del mismo socio estaba inhabilitada para contratar. " +
          "La ley impide contratar a la empresa del mismo rubro cuyos socios con más de 30 % del capital formaron parte de una " +
          "inhabilitada cuando cometió la infracción, mientras dure la sanción (Ley 32069, art. 30, impedimento 3.E; antes, art. 11 " +
          "de la Ley 30225). «graves»: la sanción es definitiva, o la ganadora se fundó o el socio entró a ella desde seis meses antes " +
          "de la sanción. La base no tiene el porcentaje del socio ni el rubro: confírmalos (ficha_empresa de las dos, norma_aplicable) " +
          "antes de afirmar que hubo impedimento. Si ganó en consorcio, el monto es el del proceso entero.",
        fuente: "OECE (sancionados), RNP (socios) y CONOSCE (adjudicaciones desde 2018)",
        aviso: AVISO,
      };
    }
    if (a.alcance === "dueno") {
      const r = await api<Fila>(cx.env, "/patrones/duenos", { ruc, page: a.pagina, size: 20, graves: a.solo_graves ? 1 : undefined, min: a.minimo_contratos });
      return {
        total: r.total,
        grupos: ((r.data ?? []) as Fila[]).map((x) => ({
          entidad: x.entidad, entidad_ruc: x.entidadRuc, socio: x.socios?.[0]?.nombre ?? undefined,
          empresas: ((x.empresas ?? []) as Fila[]).map((y) => ({ empresa: y.nombre, ruc: y.ruc, enlace: e.empresa(y.ruc) })),
          contratos_con_objeto_parecido: x.contratos, con_90_dias_o_menos_entre_si: x.seguidos, monto_soles: x.monto, desde: x.desde, hasta: x.hasta,
          ejemplos: ((x.ejemplos ?? []) as string[]).map((o) => e.contrato(o)), enlace_entidad: e.entidad(x.entidadRuc),
          ficha_del_caso: x.clave ? `${cx.env.VIGIA_URL}/app/patrones/caso/duenos/${x.clave}` : undefined,
        })),
        como_leerlo:
          "Cada fila es un socio que tiene dos o más empresas ganando en la misma entidad procesos de objeto parecido. " +
          "«con_90_dias_o_menos_entre_si»: contratos que tienen otro parecido de una empresa hermana a 90 días o menos, la forma " +
          "típica de repartir una compra para no pasar un tope. Sólo cuenta socios (no directores ni representantes) de 2 a 6 " +
          "empresas, según el Registro Nacional de Proveedores. Un grupo familiar puede ser legítimo: mira en ficha_contrato si " +
          "las compras debieron ser una sola y si las hermanas se presentaron como competidoras.",
        fuente: "RNP (socios) y CONOSCE (adjudicaciones desde 2023)",
        aviso: AVISO,
      };
    }
    if (a.alcance === "renovacion") {
      const r = await api<Fila>(cx.env, "/patrones/renovaciones", { ruc, page: a.pagina, size: 20 });
      return {
        total: r.total,
        de_mas_en_total_soles: r.exceso,
        renovaciones: ((r.data ?? []) as Fila[]).map((x) => ({
          servicio: x.objeto, entidad: x.entidad, entidad_ruc: x.entidadRuc, proveedor: x.proveedor ?? undefined, proveedor_ruc: x.proveedorRuc ?? undefined,
          mismo_proveedor_que_antes: x.mismoProveedor ?? undefined, costo_mensual_soles: x.costoMensual, costo_mensual_anterior_soles: x.costoMensualAnterior,
          subio_pct: x.diffPct, de_mas_en_el_plazo_soles: x.exceso, plazo_dias: x.plazoDias, plazo_anterior_dias: x.plazoAnterior,
          fecha: x.fecha, fecha_anterior: x.fechaAnterior, parecido_del_objeto: x.similitud,
          enlace: e.contrato(x.ocid), enlace_contrato_anterior: e.contrato(x.ocidAnterior), enlace_entidad: e.entidad(x.entidadRuc),
          ficha_del_caso: x.clave ? `${cx.env.VIGIA_URL}/app/patrones/caso/renovaciones/${x.clave}` : undefined,
        })),
        como_leerlo:
          "El costo mensual es el monto entre el plazo. Sólo servicios continuos (cinco meses o más), con objeto casi igual y cuando el " +
          "anterior ya había corrido la mayor parte de su plazo. La subida puede deberse a más sedes, personal o alcance: abre los dos " +
          "contratos con ficha_contrato y compara los términos de referencia antes de concluir.",
        aviso: AVISO,
      };
    }
    if (a.alcance === "consorcio") {
      const r = await api<Fila>(cx.env, "/patrones/consorcios", { ruc, page: a.pagina, size: 20 });
      return {
        total: r.total,
        pares: ((r.data ?? []) as Fila[]).map((x) => ({
          empresa_a: x.nombreA, ruc_a: x.rucA, empresa_b: x.nombreB, ruc_b: x.rucB, consorcios_juntas: x.consorcios,
          procesos_como_rivales: x.rivales, solas_las_dos: x.solas, gano_a: x.ganoA, gano_b: x.ganoB, se_turnan: x.ganoA > 0 && x.ganoB > 0,
          entidades: x.entidades, desde: x.desde, hasta: x.hasta, mercado_nacional: x.mercadoNacional === true ? true : undefined,
          enlace_a: e.empresa(x.rucA), enlace_b: e.empresa(x.rucB),
        })),
        como_leerlo:
          "Sólo cuenta procesos de 2 a 4 postores en que las dos postularon por separado y ganó exactamente una. «solas_las_dos»: " +
          "procesos en que fueron las únicas postoras. Salen primero los pares concentrados en pocas entidades. «mercado_nacional»: " +
          "coinciden en más de 20 entidades (p. ej. aseguradoras) y no dan bandera en el contrato. En mercados de pocos proveedores es normal asociarse a veces y competir otras: " +
          "compara los precios ofertados y mira si la que pierde alguna vez ofertó en serio.",
        aviso: AVISO,
      };
    }
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
          ficha_del_caso: x.clave ? `${cx.env.VIGIA_URL}/app/patrones/caso/relleno/${x.clave}` : undefined,
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

export const preciosReferencia = definir({
  nombre: "precios_referencia",
  titulo: "Precios de referencia",
  descripcion:
    "Cuánto paga el Estado por un bien o por un servicio, para juzgar si un precio es alto. Con tipo «bien»: los productos " +
    "de los Catálogos Electrónicos de Perú Compras cuya descripción trae las palabras (por ejemplo «papel bond a4 75», " +
    "«toner hp 85a», «llanta 215 75 r17»), con lo que pagaron por cada producto 5 entidades o más en el año: cuartil 1, " +
    "mediana y cuartil 3, sin IGV y con IGV; y, de las mismas palabras, lo que pagaron los procesos adjudicados (3 años), " +
    "las compras menores (2 años) y otros contratos que Vigía leyó, cada fuente en una unidad. Con tipo «servicio»: el costo MENSUAL (monto entre plazo) de servicios " +
    "contratados cuyo objeto trae las palabras (por ejemplo «vigilancia», «limpieza», «alimentacion»), con su contrato; " +
    "con entidad_ruc, sólo los de esa entidad (para ver cómo cambió el costo mensual de una renovación a otra). El precio " +
    "de catálogo incluye la entrega; un servicio puede tener otro alcance (más sedes o más personal): compara antes de concluir.",
  cuenta: true,
  entrada: {
    que: z.string().min(3).max(120).describe("Palabras del producto o del servicio; todas deben estar en la descripción."),
    tipo: z.enum(["bien", "servicio"]).default("bien"),
    entidad_ruc: z.string().min(11).max(14).optional().describe("(servicio) RUC 20 de la entidad."),
    anio: z.number().int().min(2017).max(2035).optional().describe("(bien) Desde qué año (por defecto, el año pasado)."),
  },
  async ejecutar(a, cx) {
    const e = enlaces(cx.env);
    const r = await api<Fila>(cx.env, "/patrones/precios", {
      q: a.que, tipo: a.tipo, anio: a.anio, entidad: a.entidad_ruc ? rucJuridico(a.entidad_ruc, "RUC de la entidad") : undefined,
    });
    if (a.tipo === "bien") {
      // Las compras del Estado con esas palabras (migraciones 338-339), en una unidad por fuente.
      const estado = await api<Fila>(cx.env, "/patrones/precios-estado", { q: a.que }).catch(() => null);
      return {
        total: r.total,
        // Si no respondió (la base cargada), se dice: no es «sin compras del Estado».
        compras_del_estado: estado
          ? (((estado as { referencias?: Fila[] }).referencias ?? []) as Fila[]).map((x) => ({
              fuente: x.fuente, que: x.detalle, unidad: x.unidad ?? undefined, compras: x.n, cuartil_1: x.p25, mediana: x.mediana, cuartil_3: x.p75,
            }))
          : "no respondió ahora (no es un cero): vuelve a pedirlo en un momento",
        productos: ((r.data ?? []) as Fila[]).map((x) => ({
          producto: x.descripcion, marca: x.marca ?? undefined, numero_de_parte: x.nroParte ?? undefined, catalogo: x.catalogo, anio: x.anio,
          ordenes: x.lineas, entidades: x.entidades, mediana_sin_igv: x.mediana, mediana_con_igv: x.medianaConIgv,
          cuartil_1_con_igv: x.p25ConIgv, cuartil_3_con_igv: x.p75ConIgv,
        })),
        como_leerlo:
          "«compras_del_estado»: lo que pagaron otras entidades por un bien con esas palabras; compara sólo en la misma unidad. " +
          "Cada fila de «productos» es un producto exacto del catálogo (ficha-producto). Un contrato se pacta con IGV: compara con «con_igv». " +
          "Lo normal va del cuartil 1 al cuartil 3; por encima del cuartil 3 vale preguntar por qué. Si no sale nada, prueba menos palabras.",
        fuente: "Perú Compras, Catálogos Electrónicos de Acuerdos Marco (órdenes de compra)",
        aviso: AVISO,
      };
    }
    return {
      total: r.total,
      resumen_costo_mensual: r.resumen ?? "menos de 5 servicios: sin resumen",
      servicios: ((r.data ?? []) as Fila[]).map((x) => ({
        objeto: x.objeto, entidad: x.entidad, entidad_ruc: x.entidadRuc, fecha: x.fecha, monto_soles: x.monto, plazo_dias: x.plazoDias,
        plazo_segun: x.plazoFuente, costo_mensual_soles: x.costoMensual, ocid: x.ocid, enlace: e.contrato(x.ocid),
      })),
      como_leerlo:
        "El costo mensual es el monto entre el plazo (en meses de 30 días). Dos servicios con el mismo nombre pueden tener otro " +
        "alcance: mira sedes, personal y horarios en los términos de referencia. El resumen mezcla todo lo que coincidió.",
      fuente: "SEACE (monto) y contrato, OCDS o bases (plazo)",
      aviso: AVISO,
    };
  },
});

export const normaAplicable = definir({
  nombre: "norma_aplicable",
  titulo: "Norma aplicable en una fecha",
  descripcion:
    "Qué dice la norma de contrataciones sobre un tema, PARA LA FECHA del proceso. Con una pregunta o un tema («fraccionamiento», " +
    "«impedimentos de parientes de un alcalde», «penalidad por mora», «contratación directa por emergencia») y la fecha de la " +
    "convocatoria devuelve: los artículos de la ley, el reglamento y las directivas que regían ese día (Ley 32069 desde el " +
    "22-04-2025; antes, Ley 30225), con el texto que tenían entonces si después se modificaron; los criterios del OECE de " +
    "esa misma ley (opiniones de la Dirección Técnico Normativa y acuerdos de Sala Plena del Tribunal); y, aparte, criterios " +
    "emitidos bajo la otra ley, que valen sólo por analogía. Sirve para citar bien una irregularidad: el artículo exacto y " +
    "su enlace oficial. Con materia «empleo_publico» busca en las normas de CAS y planillas; con «especial», en obras " +
    "paralizadas, Reconstrucción con Cambios y Obras por Impuestos; con «integridad», en la gestión de intereses y el registro " +
    "de visitas (Ley 28024), el Código de Ética de la Función Pública (Ley 27815), la declaración jurada de intereses " +
    "(Ley 31227), los impedimentos al dejar el cargo (Ley 27588 hasta el 19-07-2023; desde el 20, Ley 31564) y los delitos " +
    "contra la administración pública del Código Penal (colusión, negociación incompatible, tráfico de influencias, cohecho). " +
    "No interpreta el caso: da el texto.",
  cuenta: true,
  entrada: {
    pregunta: z.string().min(3).max(300).describe("El tema o la pregunta, en palabras de la norma si las sabes."),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Fecha de la convocatoria (AAAA-MM-DD). Sin ella, hoy. ficha_contrato la da."),
    materia: z.enum(["contrataciones", "empleo_publico", "especial", "inversion", "integridad"]).default("contrataciones"),
  },
  async ejecutar(a, cx) {
    const r = await api<Fila>(cx.env, "/normas/buscar", { q: a.pregunta, fecha: a.fecha, materia: a.materia });
    // La ley de contrataciones que regía (32069 o 30225) no dice nada de una norma de integridad: ahí no va.
    const deContrataciones = a.materia !== "integridad";
    const filas = (r.data ?? []) as Fila[];
    const como = (x: Fila) => ({
      norma: x.documento, articulo: x.articulo ?? undefined, titulo: x.epigrafe ?? undefined, emitida: x.fechaEmision ?? undefined,
      version: x.version ?? undefined, texto: recortar(String(x.texto ?? ""), 1200), fuente_oficial: x.urlOficial ?? undefined,
    });
    return {
      fecha_del_proceso: r.fecha, rige: deContrataciones ? r.ley : undefined,
      normas_que_regian: filas.filter((x) => x.aplica === "norma").map(como),
      criterios_de_esa_ley: filas.filter((x) => x.aplica === "criterio").map(como),
      criterios_de_la_otra_ley: filas.filter((x) => x.aplica === "criterio_anterior").map((x) => ({
        ...como(x), advertencia: "Emitido bajo la otra ley: vale por analogía; sus artículos no son los vigentes para este proceso.",
      })),
      como_leerlo:
        "Cita primero un artículo de «normas_que_regian». «version» avisa que el artículo se modificó después y que ese es el texto de " +
        "la fecha. Una opinión del OECE interpreta la norma, no la reemplaza. Si no aparece el artículo que buscas, prueba con las " +
        "palabras de la norma (por ejemplo «prestaciones adicionales» en vez de «ampliación del contrato»).",
      busqueda: r.busqueda === "hibrida" ? "por palabras y por significado" : "sólo por palabras",
      fuente: "Textos oficiales de El Peruano y de gob.pe (OECE, MEF, Perú Compras, Contraloría, SERVIR), por artículo",
      aviso: AVISO,
    };
  },
});

export const HERRAMIENTAS_ACTORES = [fichaEmpresa, redEmpresa, fichaEntidad, proveedoresDeEntidad, partido, historia, personaPublica, rastroPersona, patrones, preciosReferencia, normaAplicable];
