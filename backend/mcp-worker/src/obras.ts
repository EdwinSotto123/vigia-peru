import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Client } from "pg";
import { conConexion, type Env } from "./db";
import type { Campo } from "./python";

/**
 * Las herramientas de Gobserva Obras (obras.gobserva.cloud): proyectos de inversión pública (Invierte.pe) y obras
 * (INFOBRAS), con sus procesos del SEACE. Se suman a las de herramientas.ts igual que las de src/gobserva.ts (mismo
 * despacho: validan sus argumentos y responden un JSON).
 *
 *   buscar_proyectos_inversion   la lista de gobserva_proyecto (migración 232) con filtros de texto, región, sector,
 *                                estado (fase) y monto.
 *   ficha_proyecto               gobserva_obras_ficha(cui): la inversión, sus obras, sus procesos y quién los ganó.
 *   mercado_obras                gobserva_obras_mercado(region, sector): el pipeline, lo que está en marcha, las
 *                                paralizadas y quién gana las obras en 12 meses.
 *
 * Sólo lectura y datos públicos: de quien construye o supervisa sale el nombre sólo si es una empresa (RUC 20); una
 * persona natural no se nombra (las funciones SECURITY DEFINER de la 232 ya lo filtran). Cada resultado lleva el enlace a
 * su ficha en Gobserva y a la fuente oficial. Las palabras del texto quedan sólo en letras y cifras antes de llegar a la
 * consulta (LIKE con parámetros).
 */
type Definicion = { tool: Tool; campos: Campo[] };

const OBRAS = "https://obras.gobserva.cloud";
const LICITACIONES = "https://licitaciones.gobserva.cloud";
const NOTA =
  "Datos públicos del MEF (Invierte.pe, inversiones activas), de la Contraloría (INFOBRAS, avance de las obras) y del " +
  "OECE (SEACE y CONOSCE). El avance de INFOBRAS lo registra cada entidad y puede venir con meses de atraso. Gobserva no " +
  "reemplaza a esas fuentes: cada proyecto enlaza a su ficha oficial.";

const sinTildes = (t: string) => t.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").trim();

/** Las palabras de una búsqueda como en el texto de gobserva_proyecto: sin tildes, en minúsculas, de 3 letras o más, hasta 6. */
function palabras(texto: string): string[] {
  return sinTildes(texto)
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .slice(0, 6);
}

/** El ubigeo de 2 dígitos de un departamento por su nombre («cusco», «Junín», «madre de dios»). */
const DEPARTAMENTOS: Record<string, string> = {
  amazonas: "01", ancash: "02", apurimac: "03", arequipa: "04", ayacucho: "05", cajamarca: "06", callao: "07", cusco: "08",
  cuzco: "08", huancavelica: "09", huanuco: "10", ica: "11", junin: "12", "la libertad": "13", lambayeque: "14", lima: "15",
  loreto: "16", "madre de dios": "17", moquegua: "18", pasco: "19", piura: "20", puno: "21", "san martin": "22", tacna: "23",
  tumbes: "24", ucayali: "25",
};
const NOMBRE_DEPARTAMENTO: Record<string, string> = {
  "01": "Amazonas", "02": "Áncash", "03": "Apurímac", "04": "Arequipa", "05": "Ayacucho", "06": "Cajamarca", "07": "Callao",
  "08": "Cusco", "09": "Huancavelica", "10": "Huánuco", "11": "Ica", "12": "Junín", "13": "La Libertad", "14": "Lambayeque",
  "15": "Lima", "16": "Loreto", "17": "Madre de Dios", "18": "Moquegua", "19": "Pasco", "20": "Piura", "21": "Puno",
  "22": "San Martín", "23": "Tacna", "24": "Tumbes", "25": "Ucayali",
};
const region = (v: unknown) => {
  const t = sinTildes(String(v ?? ""));
  return /^(0[1-9]|1\d|2[0-5])$/.test(t) ? t : DEPARTAMENTOS[t] ?? "";
};

/** Los sectores de gobserva_proyecto (gobserva_obras_sector) y cómo los puede pedir alguien. */
const SECTOR: Record<string, string> = {
  transporte: "Transporte (carreteras, pistas, puentes, caminos)",
  saneamiento: "Agua y saneamiento",
  educacion: "Educación",
  salud: "Salud",
  agro: "Agro, riego y pesca",
  urbano: "Vivienda y desarrollo urbano",
  deporte: "Cultura y deporte",
  energia: "Energía",
  ambiente: "Ambiente",
  seguridad: "Orden público y seguridad",
  gestion: "Gestión pública",
  social: "Protección social",
  comercio: "Comercio, turismo e industria",
  justicia: "Justicia",
  comunicaciones: "Comunicaciones",
  otros: "Otros",
};
const SINONIMO_SECTOR: Record<string, string> = {
  carreteras: "transporte", carretera: "transporte", vias: "transporte", pistas: "transporte", puentes: "transporte", caminos: "transporte",
  agua: "saneamiento", desague: "saneamiento", alcantarillado: "saneamiento", educativo: "educacion", colegios: "educacion",
  escuelas: "educacion", hospitales: "salud", riego: "agro", agricultura: "agro", agropecuaria: "agro", vivienda: "urbano",
  cultura: "deporte", electrificacion: "energia", electricidad: "energia", residuos: "ambiente", comisarias: "seguridad",
  turismo: "comercio",
};
const sector = (v: unknown) => {
  const t = sinTildes(String(v ?? "")).replace(/[^a-z ]/g, "");
  return SECTOR[t] ? t : SINONIMO_SECTOR[t] ?? "";
};

/** La fase de un proyecto, como la diría alguien. */
const FASE: Record<string, string> = {
  viable: "Viable o aprobado, sin expediente técnico todavía",
  expediente: "Con expediente técnico: listo para licitar la obra",
  licitacion: "Se está licitando la obra",
  ejecucion: "En ejecución",
  paralizada: "Obra paralizada",
  terminada: "Obra terminada, la inversión aún no se cierra",
  sin_movimiento: "Sin gasto ni avance en los últimos 2 años",
  cerrada: "Inversión cerrada",
};
/** La modalidad de ejecución (gobserva_obras_modalidad) y el nivel de gobierno, en palabras. */
const MODALIDAD: Record<string, string> = {
  contrata: "Por contrata (se licita)",
  mixta: "Por contrata y por administración directa",
  directa: "Por administración directa (la ejecuta la entidad)",
  oxi: "Obras por impuestos",
  app: "Asociación público privada",
  nucleo: "Núcleo ejecutor",
  otra: "Otra modalidad",
};
const NIVEL: Record<string, string> = { GN: "Gobierno nacional", GR: "Gobierno regional", GL: "Gobierno local (municipalidad)" };

/** Lo que se puede pedir en `estado`. */
const ESTADO_SQL: Record<string, string> = {
  se_vienen: "p.se_viene",
  en_marcha: "p.fase = 'ejecucion'",
  paralizadas: "p.fase = 'paralizada'",
  licitacion: "p.fase = 'licitacion'",
  expediente: "p.se_viene AND p.fase = 'expediente'",
  viable: "p.se_viene AND p.fase = 'viable'",
  terminada: "p.fase = 'terminada'",
  todos: "true",
};

const num = (v: unknown) => (v == null ? null : Number(v));
const redondo = (v: unknown) => (v == null ? null : Math.round(Number(v)));
const fichaMef = (cui: string) => `https://ofi5.mef.gob.pe/ssi/Ssi/Index?codigo=${encodeURIComponent(cui)}&tipo=2`;
const fichaInfobras = (codigo: unknown) => `https://infobras.contraloria.gob.pe/InfobrasWeb/Mapa/Sumario?ObraId=${encodeURIComponent(String(codigo))}`;

async function filas(c: Client, sql: string, params: unknown[]): Promise<Record<string, unknown>[]> {
  const r = await c.query({ text: sql, values: params });
  return r.rows as Record<string, unknown>[];
}

const esquema = (nombre: string, props: Record<string, object>, requeridos: string[] = []) => ({
  properties: props,
  ...(requeridos.length ? { required: requeridos } : {}),
  title: `${nombre}Arguments`,
  type: "object" as const,
});

export const DEFINICIONES_OBRAS: Record<string, Definicion> = {
  buscar_proyectos_inversion: {
    campos: [
      { nombre: "texto", tipo: "str", defecto: "" },
      { nombre: "region", tipo: "str", defecto: "" },
      { nombre: "sector", tipo: "str", defecto: "" },
      { nombre: "estado", tipo: "str", defecto: "se_vienen" },
      { nombre: "monto_min", tipo: "int", defecto: 0 },
      { nombre: "monto_max", tipo: "int", defecto: 0 },
      { nombre: "limite", tipo: "int", defecto: 20 },
    ],
    tool: {
      name: "buscar_proyectos_inversion",
      description:
        "Busca proyectos de inversión pública del Perú (Invierte.pe) con su obra (INFOBRAS), de Gobserva Obras: los que se " +
        "vienen (viables, con expediente técnico o licitándose, todavía sin contrato de obra), los que están en ejecución y " +
        "los paralizados. Devuelve CUI, nombre, entidad, lugar, sector, fase, costo, lo devengado y lo que falta ejecutar, el " +
        "avance de la obra, quién la construye (sólo empresas), la licitación abierta si la hay y los enlaces. Args: texto: " +
        "palabras del proyecto, la entidad o el lugar (ej. 'agua potable Juliaca', 'hospital'); region: departamento (ej. " +
        "'Cusco'; vacío = todo el país); sector: transporte, saneamiento, educacion, salud, agro, urbano, deporte, energia, " +
        "ambiente, seguridad, gestion, social, comercio, justicia o comunicaciones (vacío = todos); estado: se_vienen " +
        "(defecto), expediente, viable, licitacion, en_marcha, paralizadas, terminada o todos; monto_min y monto_max: costo " +
        "en soles (0 = sin límite); limite: 1 a 50. Ordena por costo, de mayor a menor.",
      inputSchema: esquema("buscar_proyectos_inversion", {
        texto: { default: "", title: "Texto", type: "string" },
        region: { default: "", title: "Region", type: "string" },
        sector: { default: "", title: "Sector", type: "string" },
        estado: { default: "se_vienen", title: "Estado", type: "string" },
        monto_min: { default: 0, title: "Monto Min", type: "integer" },
        monto_max: { default: 0, title: "Monto Max", type: "integer" },
        limite: { default: 20, title: "Limite", type: "integer" },
      }),
    },
  },
  ficha_proyecto: {
    campos: [{ nombre: "cui", tipo: "int" }],
    tool: {
      name: "ficha_proyecto",
      description:
        "La ficha completa de un proyecto de inversión pública por su CUI (Código Único de Inversión, 7 dígitos; el que " +
        "devuelve buscar_proyectos_inversion): montos (viable, costo actualizado, expediente técnico, devengado, presupuesto " +
        "del año), fase, fechas, sus obras en INFOBRAS con su avance físico y financiero, quién las ejecuta y supervisa (sólo " +
        "empresas), los procesos del SEACE que citan el CUI con quién los ganó, proyectos parecidos y los enlaces oficiales " +
        "(MEF e INFOBRAS). Args: cui: el código de 7 dígitos.",
      inputSchema: esquema("ficha_proyecto", { cui: { title: "Cui", type: "integer" } }, ["cui"]),
    },
  },
  mercado_obras: {
    campos: [
      { nombre: "region", tipo: "str", defecto: "" },
      { nombre: "sector", tipo: "str", defecto: "" },
    ],
    tool: {
      name: "mercado_obras",
      description:
        "El mercado de obras públicas de una región y un sector (Gobserva Obras): cuántos proyectos se vienen y por cuánto, " +
        "cuántos están en ejecución y cuánto les falta ejecutar, cuántos están paralizados y por qué, el tamaño típico de una " +
        "obra, el presupuesto del año, y qué empresas ganan más obras y supervisiones en los últimos 12 meses (CONOSCE; sólo " +
        "empresas con RUC 20; lo ganado en consorcio se reparte en partes iguales entre sus integrantes). Args: region: " +
        "departamento (vacío = todo el país); sector: como en buscar_proyectos_inversion (vacío = todos).",
      inputSchema: esquema("mercado_obras", {
        region: { default: "", title: "Region", type: "string" },
        sector: { default: "", title: "Sector", type: "string" },
      }),
    },
  },
};

/** Un proyecto de gobserva_proyecto como lo devuelve la búsqueda. */
function proyecto(r: Record<string, unknown>) {
  const cui = String(r.cui);
  return {
    cui,
    nombre: r.nombre,
    fase: FASE[String(r.fase)] ?? r.fase,
    se_viene: r.se_viene === true,
    entidad: r.entidad,
    region: r.region ? NOMBRE_DEPARTAMENTO[String(r.region)] ?? r.region : null,
    provincia: r.provincia,
    distrito: r.distrito,
    sector: SECTOR[String(r.sector)] ?? r.sector,
    modalidad: r.modalidad ? MODALIDAD[String(r.modalidad)] ?? r.modalidad : null,
    tipo: r.tipo === "equipamiento" ? "Compra de equipos" : "Obra",
    costo_soles: redondo(r.costo),
    devengado_soles: redondo(r.devengado),
    por_ejecutar_soles: redondo(r.por_ejecutar),
    presupuesto_del_anio_soles: redondo(r.pim_anio),
    con_expediente_tecnico: r.con_expediente === true,
    viable_desde: r.fecha_viable,
    obra: r.obra_codigo
      ? {
          // false: es una parte chica de un proyecto grande (su avance y su contratista no son los del proyecto).
          es_el_proyecto: r.obra_representa !== false,
          estado: r.obra_estado,
          avance_fisico_pct: num(r.obra_fisico),
          avance_programado_pct: num(r.obra_programado),
          avance_al: r.obra_avance_al,
          inicio: r.obra_inicio,
          fin_previsto: r.obra_fin,
          paralizada_desde: r.obra_paralizada_desde,
          causal_paralizacion: r.obra_causal,
          ficha_infobras: fichaInfobras(r.obra_codigo),
        }
      : null,
    // Sólo una empresa (RUC 20): la tabla ya no guarda otro. Y sólo si la obra es el proyecto.
    ejecutor: r.ejecutor_ruc && r.obra_representa !== false ? { ruc: r.ejecutor_ruc, nombre: r.ejecutor } : null,
    avance_fisico_mef_pct: num(r.avance_mef),
    licitacion_abierta: r.convocatoria_ocid
      ? {
          tipo: r.convocatoria_tipo,
          convocada: r.convocatoria_fecha,
          valor_referencial_soles: redondo(r.convocatoria_valor),
          en_gobserva_licitaciones: `${LICITACIONES}/oportunidad/${encodeURIComponent(String(r.convocatoria_ocid))}`,
        }
      : null,
    procesos_seace: num(r.procesos),
    ficha_oficial_mef: fichaMef(cui),
    en_gobserva: `${OBRAS}/proyecto/${cui}`,
  };
}

export async function ejecutarObras(nombre: string, v: Record<string, unknown>, env: Env, ctx: ExecutionContext): Promise<unknown> {
  const entero = (x: unknown, min: number, max: number, def: number) => {
    const n = Number(x ?? def);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : def;
  };

  if (nombre === "buscar_proyectos_inversion") {
    const estado = sinTildes(String(v.estado ?? "se_vienen")).replace(/\s+/g, "_");
    const donde = [ESTADO_SQL[estado] ?? ESTADO_SQL.se_vienen];
    const vals: unknown[] = [];
    const p = (x: unknown) => {
      vals.push(x);
      return `$${vals.length}`;
    };
    for (const w of palabras(String(v.texto ?? ""))) donde.push(`p.texto LIKE ${p(`%${w}%`)}`);
    const reg = region(v.region);
    if (reg) donde.push(`p.region = ${p(reg)}`);
    const sec = sector(v.sector);
    if (sec) donde.push(`p.sector = ${p(sec)}`);
    const min = entero(v.monto_min, 0, 1e13, 0);
    const max = entero(v.monto_max, 0, 1e13, 0);
    if (min > 0) donde.push(`p.costo >= ${p(min)}`);
    if (max > 0) donde.push(`p.costo <= ${p(max)}`);
    const limite = entero(v.limite, 1, 50, 20);
    return conConexion(env, ctx, async (c) => {
      const rs = await filas(
        c,
        `SELECT p.cui, p.nombre, p.fase, p.se_viene, p.tipo, p.sector, p.modalidad, p.entidad, p.region, p.provincia, p.distrito,
                p.costo::float, p.devengado::float, p.por_ejecutar::float, p.pim_anio::float, p.con_expediente,
                to_char(p.fecha_viable, 'YYYY-MM-DD') AS fecha_viable, p.obra_codigo, p.obra_estado, p.obra_fisico::float,
                p.obra_programado::float, to_char(p.obra_avance_al, 'YYYY-MM-DD') AS obra_avance_al, p.obra_representa, p.avance_mef::float,
                to_char(p.obra_inicio, 'YYYY-MM-DD') AS obra_inicio, to_char(p.obra_fin, 'YYYY-MM-DD') AS obra_fin,
                to_char(p.obra_paralizada_desde, 'YYYY-MM-DD') AS obra_paralizada_desde, p.obra_causal, p.ejecutor_ruc, p.ejecutor,
                p.convocatoria_ocid, p.convocatoria_tipo, to_char(p.convocatoria_fecha, 'YYYY-MM-DD') AS convocatoria_fecha,
                p.convocatoria_valor::float, p.procesos
           FROM gobserva_proyecto p WHERE ${donde.join(" AND ")}
          ORDER BY p.costo DESC NULLS LAST, p.cui DESC LIMIT ${limite}`,
        vals,
      );
      const filtros = new URLSearchParams();
      if (String(v.texto ?? "").trim()) filtros.set("q", String(v.texto).trim().slice(0, 120));
      if (reg) filtros.set("region", reg);
      if (sec) filtros.set("sector", sec);
      if (["en_marcha", "paralizadas", "todos"].includes(estado)) filtros.set("pestana", estado);
      if (min > 0) filtros.set("min", String(min));
      if (max > 0) filtros.set("max", String(max));
      return {
        proyectos: rs.map(proyecto),
        n: rs.length,
        filtros_aplicados: { region: reg ? NOMBRE_DEPARTAMENTO[reg] : "todo el Perú", sector: sec ? SECTOR[sec] : "todos", estado: ESTADO_SQL[estado] ? estado : "se_vienen" },
        en_gobserva: `${OBRAS}/proyectos${filtros.toString() ? `?${filtros}` : ""}`,
        nota: NOTA,
      };
    });
  }

  if (nombre === "ficha_proyecto") {
    // Un entero (el validador acepta también «2233850» escrito como texto): el CUI no empieza con 0.
    const cui = String(v.cui ?? "").replace(/\D/g, "");
    if (!/^\d{7}$/.test(cui)) return { encontrado: false, cui: String(v.cui ?? ""), nota: "El CUI tiene 7 dígitos (ej. 2233850)." };
    return conConexion(env, ctx, async (c) => {
      const [r] = await filas(c, "SELECT gobserva_obras_ficha($1) AS f", [cui]);
      const f = r?.f as Record<string, any> | null | undefined;
      if (!f) return { encontrado: false, cui };
      const m = (f.montos ?? {}) as Record<string, unknown>;
      const obras = (Array.isArray(f.obras) ? f.obras : []) as Record<string, any>[];
      const procesos = (Array.isArray(f.procesos) ? f.procesos : []) as Record<string, any>[];
      const quien = (q: Record<string, any> | null | undefined) =>
        !q ? null : q.tipo === "empresa" ? { ruc: q.ruc, nombre: q.nombre } : q.tipo === "entidad" ? "La propia entidad (administración directa)"
          : q.tipo === "consorcio" ? "Un consorcio (sin RUC de empresa en INFOBRAS)" : "Una persona natural (no se nombra)";
      return {
        encontrado: true,
        cui,
        nombre: f.nombre,
        estado: f.estado,
        fase: FASE[String(f.fase)] ?? f.fase,
        se_viene: f.seViene === true,
        situacion: f.situacion,
        nivel_de_gobierno: NIVEL[String(f.nivel)] ?? f.nivel,
        sector: SECTOR[String(f.sector)] ?? f.sector,
        funcion: f.funcion,
        tipologia: f.tipologia,
        tipo_de_inversion: f.tipoInversion,
        modalidad_de_ejecucion: f.modalidadTexto,
        entidad: f.entidad,
        unidad_ejecutora: f.unidadEjecutora,
        lugar: f.lugar,
        montos_soles: {
          viable: redondo(m.viable),
          costo_actualizado: redondo(m.actualizado),
          expediente_tecnico: redondo(m.expediente),
          devengado_acumulado: redondo(m.devengado),
          presupuesto_del_anio: redondo(m.pimAnio),
          devengado_del_anio: redondo(m.devengadoAnio),
          por_ejecutar: redondo(m.porEjecutar),
        },
        costo_dudoso: f.costoDudoso === true,
        avance_fisico_mef_pct: num(f.avanceMef),
        con_expediente_tecnico: f.conExpediente === true,
        fechas: f.fechas,
        beneficiarios: num(f.beneficiarios),
        obras_infobras: obras.slice(0, 10).map((o) => ({
          codigo: o.codigo,
          nombre: o.nombre,
          estado: o.estado,
          modalidad: o.modalidad,
          avance: o.avance,
          fechas: o.fechas,
          contrato_soles: redondo(o.montos?.contrato),
          contrato_dudoso: o.montos?.contratoDudoso === true,
          paralizacion: o.paralizacion,
          ejecutor: quien(o.ejecutor),
          supervisor: quien(o.supervisor),
          ficha_infobras: fichaInfobras(o.codigo),
        })),
        obras_total: obras.length,
        procesos_seace: procesos.slice(0, 15).map((x) => ({
          ocid: x.ocid,
          objeto: x.objeto,
          tipo: x.tipo,
          etapa: x.etapa,
          convocado: x.fecha,
          valor_referencial_soles: redondo(x.valor),
          adjudicado_soles: redondo(x.adjudicado),
          ganadores_empresas: (x.ganadores?.empresas ?? []).map((g: Record<string, unknown>) => ({
            ruc: g.ruc,
            nombre: g.nombre,
            en_consorcio: g.consorcio === true,
          })),
          ganadores_sin_nombre: num(x.ganadores?.otros) ?? 0,
          en_gobserva_licitaciones: `${LICITACIONES}/oportunidad/${encodeURIComponent(String(x.ocid))}`,
        })),
        procesos_total: num(f.procesosTotal),
        parecidos: ((f.parecidos ?? []) as Record<string, unknown>[]).slice(0, 5).map((x) => ({
          cui: x.cui,
          nombre: x.nombre,
          fase: FASE[String(x.fase)] ?? x.fase,
          region: x.region ? NOMBRE_DEPARTAMENTO[String(x.region)] ?? x.region : null,
          costo_soles: redondo(x.costo),
          en_gobserva: `${OBRAS}/proyecto/${x.cui}`,
        })),
        al_dia: f.alDia,
        ficha_oficial_mef: fichaMef(cui),
        en_gobserva: `${OBRAS}/proyecto/${cui}`,
        nota: NOTA,
      };
    });
  }

  // mercado_obras
  const reg = region(v.region);
  const sec = sector(v.sector);
  return conConexion(env, ctx, async (c) => {
    const [r] = await filas(c, "SELECT gobserva_obras_mercado($1, $2) AS m", [reg || null, sec || null]);
    const m = (r?.m ?? {}) as Record<string, any>;
    const filtros = new URLSearchParams();
    if (reg) filtros.set("region", reg);
    if (sec) filtros.set("sector", sec);
    const zona = (z: Record<string, unknown>) => ({
      zona: reg ? z.clave : NOMBRE_DEPARTAMENTO[String(z.clave)] ?? z.clave,
      se_vienen: z.seVienen,
      se_vienen_soles: z.seVienenMonto,
      en_marcha: z.enMarcha,
      en_marcha_soles: z.enMarchaMonto,
      paralizadas: z.paralizadas,
      por_ejecutar_soles: z.porEjecutar,
    });
    return {
      region: reg ? NOMBRE_DEPARTAMENTO[reg] : "todo el Perú",
      sector: sec ? SECTOR[sec] : "todos",
      inversiones_activas: m.activas,
      se_vienen: m.seVienen,
      en_marcha: m.enMarcha,
      paralizadas: m.paralizadas,
      por_ejecutar_soles: m.porEjecutar,
      presupuesto_del_anio_soles: m.pimAnio,
      devengado_del_anio_soles: m.devengadoAnio,
      por_zona: ((m.porZona ?? []) as Record<string, unknown>[])
        .sort((a, b) => Number(b.porEjecutar ?? 0) - Number(a.porEjecutar ?? 0))
        .slice(0, 25)
        .map(zona),
      por_sector: ((m.porSector ?? []) as Record<string, unknown>[]).map((s) => ({
        sector: SECTOR[String(s.clave)] ?? s.clave,
        se_vienen: s.seVienen,
        se_vienen_soles: s.seVienenMonto,
        en_marcha: s.enMarcha,
        en_marcha_soles: s.enMarchaMonto,
        paralizadas: s.paralizadas,
      })),
      por_tamano: m.tamanos,
      causas_de_paralizacion: m.causales,
      paralizadas_mas_grandes: ((m.mayoresParalizadas ?? []) as Record<string, unknown>[]).map((x) => ({
        ...x,
        en_gobserva: `${OBRAS}/proyecto/${x.cui}`,
      })),
      obras_adjudicadas_12_meses: m.adjudicadoObras,
      empresas_que_mas_obras_ganan: m.quienConstruye,
      empresas_que_mas_supervisiones_ganan: m.quienSupervisa,
      al_dia: { ...(m.alDia ?? {}), conosce_hasta: m.conosceHasta },
      en_gobserva: `${OBRAS}/mercado${filtros.toString() ? `?${filtros}` : ""}`,
      nota: `${NOTA} Quién gana: adjudicaciones con buena pro de CONOSCE en los últimos 12 meses, en el departamento de la obra` +
        `${sec ? "; con sector, sólo los procesos que citan un CUI de ese sector" : ""}.`,
    };
  });
}
