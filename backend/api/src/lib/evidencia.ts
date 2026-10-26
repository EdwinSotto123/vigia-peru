/**
 * La evidencia de cada antecedente del ganador (lib/cruces.ts): los registros oficiales que lo sostienen, para que la
 * ficha del contrato muestre de dónde sale cada afirmación y cómo verificarla, no sólo una conclusión con el enlace a
 * la portada de la fuente. El usuario lo pidió el 2026-10-19 ("ni siquiera adjuntas evidencia").
 *
 * Una forma para todos los tipos: un título, columnas tipadas, filas, cómo verificarlo y un enlace a la fuente (el
 * del registro cuando la fuente lo trae: el aporte en Claridad, la hoja de vida en el JNE, el proceso en el OECE).
 * Privacidad (lib/privacidad.ts): nunca un DNI ni el nombre de una persona natural. Lo de una persona vinculada (socio,
 * representante) se busca por su documento en el servidor, pero lo que sale es el registro sin nombre ni documento;
 * la autoridad que gobernaba la entidad va por su cargo, su organización y su período.
 */

import { pool } from "./db.js";

export type TipoColumna = "texto" | "fecha" | "soles" | "pct" | "enlace";

export interface Evidencia {
  titulo: string;
  columnas: { clave: string; titulo: string; tipo?: TipoColumna }[];
  filas: Record<string, unknown>[];
  /** Si hay más registros que los que se muestran. */
  total?: number;
  /** Cómo verificarlo en la fuente, en una frase. */
  verificar?: string;
  enlace?: { texto: string; url: string } | null;
}

/** Una fila de cruces_proveedor con lo que hace falta para buscar su evidencia (persona_doc no sale de aquí). */
export interface FilaCruce {
  tipo: string;
  ruc_empresa: string;
  ocid?: string | null;
  persona_doc: string | null;
  detalle: Record<string, unknown> | null;
}

/** El proceso del contrato: su entidad, su código y su fecha (para los procesos repetidos y quién gobernaba). */
export interface ProcesoCruce {
  ocid: string;
  codigo: string | null;
  entidadRuc: string | null;
  ubigeo: string | null;
  fecha: string | null;
}

// Registros por evidencia: la ficha los pagina de a 10 y los busca (components/contratos/TablaEvidencia.tsx). Con 60 decía
// "los 60 más recientes de 400" en proveedores recurrentes.
const TOPE = 250;
const fecha = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === "string" ? v.slice(0, 10) : null);
const num = (v: unknown) => (v == null ? null : Number(v));
/** ONPE trae algunas fechas de aporte mal digitadas (año 0217, 2916): fuera de 1995 → hoy no se muestran. */
const fechaPlausible = (v: unknown) => {
  const f = fecha(v);
  return f && f >= "1995-01-01" && f <= new Date().toISOString().slice(0, 10) ? f : null;
};
const filas = (sql: string, vals: unknown[]) => pool.query(sql, vals).then((r) => r.rows as Record<string, any>[]).catch(() => [] as Record<string, any>[]);

const PERFIL_OSCE = (ruc: string) => `https://apps.osce.gob.pe/perfilprov-ui/ficha/${ruc}`;
const PROCESO_OECE = (codigo: string) => `https://contratacionesabiertas.oece.gob.pe/proceso/${encodeURIComponent(codigo)}`;
const CLARIDAD = "https://claridadportal.onpe.gob.pe/";

/** Quién: la empresa, el proveedor persona natural (RUC 10) o una persona vinculada (sin nombre: ya va, tapado, en el cruce). */
const quien = (f: FilaCruce) =>
  f.persona_doc ? "una persona vinculada a la empresa (socio o representante)" : f.ruc_empresa.startsWith("10") ? "el proveedor" : "la empresa";
/** Cómo buscarlo en la fuente: por RUC si es una empresa; una persona natural, por su nombre (Vigía no publica su documento). */
const comoBuscar = (f: FilaCruce) =>
  f.persona_doc ? "el documento de la persona vinculada" : f.ruc_empresa.startsWith("10") ? "al proveedor por su nombre" : `el RUC ${f.ruc_empresa}`;

async function gastosCampana(f: FilaCruce): Promise<Evidencia> {
  const doc = f.persona_doc ?? f.ruc_empresa;
  const org = String(f.detalle?.organizacion ?? "");
  // El total de la campaña es lo que declaró ESA organización en ese proceso (migración 85): `total_op` es el de
  // todas las organizaciones de la elección.
  const r = await filas(
    `SELECT g.proceso, g.organizacion, g.monto,
            (SELECT sum(t.monto) FROM onpe_gastos_proveedores t WHERE t.proceso = g.proceso AND t.organizacion = g.organizacion) AS total_org
       FROM onpe_gastos_proveedores g
      WHERE g.documento = $1 AND ($2 = '' OR g.organizacion = $2) ORDER BY g.anio DESC, g.monto DESC LIMIT ${TOPE}`, [doc, org]);
  return {
    titulo: `Lo que ${quien(f)} le vendió a la campaña`,
    columnas: [
      { clave: "proceso", titulo: "Elección" },
      { clave: "organizacion", titulo: "Organización política" },
      { clave: "monto", titulo: "Le vendió", tipo: "soles" },
      { clave: "total", titulo: "Lo que gastó la organización", tipo: "soles" },
      { clave: "parte", titulo: "Parte del gasto", tipo: "pct" },
    ],
    filas: r.map((x) => ({
      proceso: x.proceso, organizacion: x.organizacion, monto: num(x.monto), total: num(x.total_org),
      parte: Number(x.total_org) > 0 ? (100 * Number(x.monto)) / Number(x.total_org) : null,
    })),
    verificar: `En Claridad (ONPE): Gastos de campaña › ${org || "la organización"} › Proveedores, buscando ${comoBuscar(f)}. ONPE publica a quién le compró cada campaña y cuánto, pero no qué compró.`,
    enlace: { texto: "Gastos de campaña en Claridad (ONPE)", url: CLARIDAD },
  };
}

async function aportes(f: FilaCruce): Promise<Evidencia> {
  const doc = f.persona_doc ?? f.ruc_empresa;
  const partido = String(f.detalle?.partido ?? "");
  const r = await filas(
    `SELECT fecha_aporte, "año" AS anio, proceso, partido, tipo_aporte, monto, fuente_url, count(*) OVER () AS n
       FROM onpe_aportantes WHERE numero_documento = $1 AND ($2 = '' OR partido = $2)
      ORDER BY fecha_aporte DESC NULLS LAST LIMIT ${TOPE}`, [doc, partido]);
  return {
    titulo: `Los aportes de ${quien(f)}`,
    columnas: [
      { clave: "fecha", titulo: "Fecha", tipo: "fecha" },
      { clave: "proceso", titulo: "Elección" },
      { clave: "partido", titulo: "A quién" },
      { clave: "tipo", titulo: "Tipo de aporte" },
      { clave: "monto", titulo: "Monto", tipo: "soles" },
      { clave: "fuente", titulo: "Registro", tipo: "enlace" },
    ],
    filas: r.map((x) => ({
      fecha: fechaPlausible(x.fecha_aporte), proceso: x.proceso ?? (x.anio ? String(x.anio) : null), partido: x.partido, tipo: x.tipo_aporte,
      monto: num(x.monto), fuente: x.fuente_url ? { texto: "ONPE", url: x.fuente_url } : null,
    })),
    total: r.length ? Number(r[0].n) : 0,
    verificar: "En Claridad (ONPE): Aportes, buscando a la organización política y el aportante.",
    enlace: { texto: "Aportes en Claridad (ONPE)", url: "https://claridad.onpe.gob.pe/" },
  };
}

async function candidaturas(f: FilaCruce): Promise<Evidencia> {
  const r = await filas(`SELECT organizacion, proceso, departamento, fuente_url FROM onpe_candidatos WHERE dni = $1 LIMIT ${TOPE}`, [f.persona_doc]);
  return {
    titulo: "Su candidatura",
    columnas: [
      { clave: "proceso", titulo: "Elección" },
      { clave: "organizacion", titulo: "Organización política" },
      { clave: "departamento", titulo: "Departamento" },
      { clave: "fuente", titulo: "Registro", tipo: "enlace" },
    ],
    filas: r.map((x) => ({ proceso: x.proceso, organizacion: x.organizacion, departamento: x.departamento, fuente: x.fuente_url ? { texto: "ONPE", url: x.fuente_url } : null })),
    verificar: "En Claridad (ONPE): Candidatos, por organización y elección.",
    enlace: { texto: "Candidatos en Claridad (ONPE)", url: "https://claridad.onpe.gob.pe/" },
  };
}

const COL_AUTORIDAD: Evidencia["columnas"] = [
  { clave: "cargo", titulo: "Cargo" },
  { clave: "organizacion", titulo: "Organización política" },
  { clave: "lugar", titulo: "Dónde" },
  { clave: "periodo", titulo: "Período" },
  { clave: "fuente", titulo: "Registro", tipo: "enlace" },
];
const filaAutoridad = (x: Record<string, any>) => ({
  cargo: x.cargo, organizacion: x.organizacion_politica,
  lugar: [x.distrito, x.provincia, x.departamento].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(", ") || null,
  periodo: [fecha(x.periodo_inicio)?.slice(0, 4), fecha(x.periodo_fin)?.slice(0, 4)].filter(Boolean).join("–") || null,
  fuente: x.fuente_url ? { texto: "JNE", url: x.fuente_url } : null,
});

async function autoridad(f: FilaCruce): Promise<Evidencia> {
  const r = await filas(
    `SELECT cargo, organizacion_politica, departamento, provincia, distrito, periodo_inicio, periodo_fin, fuente_url
       FROM jne_autoridades WHERE dni = $1 ORDER BY periodo_inicio DESC NULLS LAST LIMIT ${TOPE}`, [f.persona_doc]);
  return {
    titulo: "El cargo de la persona vinculada (JNE)",
    columnas: COL_AUTORIDAD,
    filas: r.map(filaAutoridad),
    verificar: "En Infogob / Voto Informado (JNE), su hoja de vida.",
    enlace: { texto: "Infogob del JNE", url: "https://infogob.jne.gob.pe/" },
  };
}

/** Quién gobernaba la entidad del proceso, de esa organización, cuando se convocó (sin el nombre: cargo y período). */
async function gobernante(f: FilaCruce, p: ProcesoCruce): Promise<Evidencia | null> {
  const cargo = String(f.detalle?.cargo_gobernante ?? "");
  const org = String(f.detalle?.organizacion_gobernante ?? "");
  if (!cargo || !org || !p.ubigeo) return null;
  const r = await filas(
    `SELECT cargo, organizacion_politica, departamento, provincia, distrito, periodo_inicio, periodo_fin, fuente_url
       FROM jne_autoridades
      WHERE cargo = $1 AND organizacion_politica = $2
        AND CASE $1 WHEN 'ALCALDE DISTRITAL' THEN ubigeo = $3 WHEN 'ALCALDE PROVINCIAL' THEN left(ubigeo, 4) = left($3, 4)
                    ELSE left(ubigeo, 2) = left($3, 2) END
        AND ($4::date IS NULL OR ((periodo_inicio IS NULL OR $4::date >= periodo_inicio) AND (periodo_fin IS NULL OR $4::date <= periodo_fin)))
      ORDER BY periodo_inicio DESC NULLS LAST LIMIT 5`, [cargo, org, p.ubigeo, p.fecha]);
  return {
    titulo: "Quién gobernaba la entidad cuando se convocó",
    columnas: COL_AUTORIDAD,
    filas: r.map(filaAutoridad),
    verificar: "En Infogob (JNE): autoridades electas de la región, provincia o distrito de la entidad.",
    enlace: { texto: "Infogob del JNE", url: "https://infogob.jne.gob.pe/" },
  };
}

async function penalidades(f: FilaCruce): Promise<Evidencia> {
  const r = await filas(
    `SELECT fecha, entidad_contratante, tipo_penalidad, objeto_contrato, descripcion, monto, contrato_id, count(*) OVER () AS n
       FROM penalidades WHERE empresa_ruc = $1 ORDER BY fecha DESC NULLS LAST LIMIT ${TOPE}`, [f.ruc_empresa]);
  return {
    titulo: "Las penalidades que le aplicaron",
    columnas: [
      { clave: "fecha", titulo: "Fecha", tipo: "fecha" },
      { clave: "entidad", titulo: "Entidad que la aplicó" },
      { clave: "tipo", titulo: "Penalidad" },
      { clave: "motivo", titulo: "Detalle" },
      { clave: "monto", titulo: "Monto", tipo: "soles" },
    ],
    filas: r.map((x) => ({
      fecha: fecha(x.fecha), entidad: x.entidad_contratante, tipo: x.tipo_penalidad,
      motivo: x.descripcion ?? x.objeto_contrato, monto: num(x.monto),
    })),
    total: r.length ? Number(r[0].n) : 0,
    verificar: `En el perfil del proveedor del OSCE (RUC ${f.ruc_empresa}), pestaña de penalidades.`,
    enlace: { texto: "Perfil del proveedor en el OSCE", url: PERFIL_OSCE(f.ruc_empresa) },
  };
}

async function sanciones(f: FilaCruce): Promise<Evidencia> {
  const r = await filas(
    `SELECT tipo, resolucion, fecha_resolucion, fecha_desde, fecha_hasta, infraccion, norma, estado, monto_multa_soles
       FROM osce_sancionados WHERE ruc = $1 ORDER BY fecha_resolucion DESC NULLS LAST LIMIT ${TOPE}`, [f.ruc_empresa]);
  return {
    titulo: "Las sanciones del Tribunal de Contrataciones",
    columnas: [
      { clave: "resolucion", titulo: "Resolución" },
      { clave: "fecha", titulo: "Fecha", tipo: "fecha" },
      { clave: "tipo", titulo: "Sanción" },
      { clave: "vigencia", titulo: "Vigencia" },
      { clave: "infraccion", titulo: "Infracción" },
      { clave: "multa", titulo: "Multa", tipo: "soles" },
    ],
    filas: r.map((x) => ({
      resolucion: x.resolucion, fecha: fecha(x.fecha_resolucion), tipo: [x.tipo, x.estado].filter(Boolean).join(", "),
      vigencia: x.fecha_desde ? `${fecha(x.fecha_desde)} → ${fecha(x.fecha_hasta) ?? "sin fin"}` : null,
      infraccion: [x.infraccion, x.norma].filter(Boolean).join(" — ") || null, multa: num(x.monto_multa_soles),
    })),
    verificar: `En el perfil del proveedor del OSCE (RUC ${f.ruc_empresa}), sanciones; o en el buscador de resoluciones del Tribunal.`,
    enlace: { texto: "Perfil del proveedor en el OSCE", url: PERFIL_OSCE(f.ruc_empresa) },
  };
}

async function recurrente(f: FilaCruce, p: ProcesoCruce): Promise<Evidencia | null> {
  if (!p.entidadRuc) return null;
  const r = await filas(
    `SELECT a.codigo_convocatoria AS codigo, min(a.fecha_convocatoria) AS fecha, min(a.fecha_buenapro) AS buenapro,
            max(a.descripcion_proceso) AS descripcion,
            max(a.objeto) AS objeto, sum(a.monto_adjudicado) AS monto,
            (SELECT c.ocid FROM convocatorias c WHERE c.codigo = a.codigo_convocatoria AND c.entidad_ruc = $1 LIMIT 1) AS ocid,
            count(*) OVER () AS n
       FROM conosce_adjudicaciones a
      WHERE a.entidad_ruc = $1 AND a.ruc_proveedor = $2 AND a.codigo_convocatoria IS DISTINCT FROM $3
      GROUP BY a.codigo_convocatoria ORDER BY min(a.fecha_convocatoria) DESC NULLS LAST LIMIT ${TOPE}`,
    [p.entidadRuc, f.ruc_empresa, p.codigo]);
  return {
    titulo: "Los otros procesos que le ganó a esta entidad",
    columnas: [
      { clave: "fecha", titulo: "Convocado", tipo: "fecha" },
      { clave: "proceso", titulo: "Proceso", tipo: "enlace" },
      { clave: "objeto", titulo: "Objeto" },
      { clave: "monto", titulo: "Adjudicado", tipo: "soles" },
    ],
    filas: r.map((x) => ({
      fecha: fecha(x.fecha), objeto: x.objeto, monto: num(x.monto),
      // El cruce cuenta los que ya tenían buena pro cuando se convocó este (migración 83): los demás, marcados.
      ...(p.fecha && fecha(x.buenapro) != null && fecha(x.buenapro)! >= p.fecha ? { posterior: true } : {}),
      proceso: { texto: x.descripcion ?? `Proceso ${x.codigo}`, url: x.ocid ? `/app/contratos/${x.ocid}` : PROCESO_OECE(String(x.codigo)) },
    })),
    total: r.length ? Number(r[0].n) : 0,
    verificar: "Cada proceso abre su ficha en Vigía o, si no está en la base, su registro en el OECE (Contrataciones Abiertas).",
    enlace: { texto: "Perfil del proveedor en el OSCE", url: PERFIL_OSCE(f.ruc_empresa) },
  };
}

/**
 * Sobreprecio (migración 84): los ítems de este proceso que pasan la mediana de lo que pagaron otras entidades por el
 * mismo CUBSO y unidad, y, del peor, esas otras compras una por una (cada una abre su contrato en Vigía).
 */
async function sobreprecio(f: FilaCruce, p: ProcesoCruce): Promise<Evidencia[]> {
  const ocid = f.ocid ?? p.ocid;
  const items = await filas(
    `SELECT i.posicion, i.descripcion, i.cantidad, i.unidad, i.unit_adj, r.mediana, r.p25, r.p75, r.entidades,
            (i.unit_adj - r.p75) * i.cantidad AS exceso
       FROM precio_item i
       JOIN precio_referencia r ON r.cubso = i.cubso AND r.unidad = i.unidad AND r.anio = i.anio AND r.base = 'adjudicado'
      WHERE i.ocid = $1 AND i.unit_adj >= 1.5 * r.mediana
      ORDER BY exceso DESC NULLS LAST LIMIT ${TOPE}`, [ocid]);
  const peor = (f.detalle?.peor ?? {}) as Record<string, unknown>;
  const otras = peor.cubso
    ? await filas(
      `SELECT i.ocid, i.fecha, i.cantidad, i.unit_adj, e.nombre AS entidad, i.departamento
         FROM precio_item i LEFT JOIN entidades e ON e.ruc = i.entidad_ruc
        WHERE i.cubso = $1 AND i.unidad = $2 AND i.anio IN ($3::int, $3::int - 1) AND i.unit_adj > 0
          AND i.entidad_ruc IS DISTINCT FROM $4
        ORDER BY abs(ln(i.unit_adj / NULLIF($5::numeric, 0))) LIMIT 15`,
      [peor.cubso, peor.unidad, Number(peor.anio), p.entidadRuc, Number(peor.mediana)])
    : [];
  const ev: Evidencia[] = [{
    titulo: "Los ítems que pagaron más que otras entidades",
    columnas: [
      { clave: "item", titulo: "Ítem" },
      { clave: "cantidad", titulo: "Cantidad" },
      { clave: "unitario", titulo: "Pagó por unidad", tipo: "soles" },
      { clave: "mediana", titulo: "Mediana de otras entidades", tipo: "soles" },
      { clave: "rango", titulo: "Rango habitual (p25–p75)" },
      { clave: "exceso", titulo: "Por encima del p75", tipo: "soles" },
    ],
    filas: items.map((x) => ({
      item: x.descripcion, cantidad: x.cantidad != null ? `${Number(x.cantidad).toLocaleString("es-PE")} ${x.unidad ?? ""}`.trim() : null,
      unitario: num(x.unit_adj), mediana: num(x.mediana),
      rango: `S/ ${Number(x.p25).toLocaleString("es-PE", { maximumFractionDigits: 2 })} – ${Number(x.p75).toLocaleString("es-PE", { maximumFractionDigits: 2 })} en ${x.entidades} entidades`,
      exceso: x.exceso != null && Number(x.exceso) > 0 ? num(x.exceso) : null,
    })),
    verificar: "El precio por unidad es lo adjudicado del ítem (CONOSCE) entre su cantidad (OCDS). La referencia son las compras de otras entidades con el mismo código CUBSO y la misma unidad, ese año y el anterior.",
    enlace: { texto: "Contrataciones Abiertas del OECE", url: "https://contratacionesabiertas.oece.gob.pe/" },
  }];
  if (otras.length) ev.push({
    titulo: `Lo que pagaron otras entidades por ${String(peor.descripcion ?? "el mismo ítem").toLowerCase().slice(0, 80)}`,
    columnas: [
      { clave: "fecha", titulo: "Convocado", tipo: "fecha" },
      { clave: "entidad", titulo: "Entidad", tipo: "enlace" },
      { clave: "cantidad", titulo: "Cantidad" },
      { clave: "unitario", titulo: "Pagó por unidad", tipo: "soles" },
    ],
    filas: otras.map((x) => ({
      fecha: fecha(x.fecha), cantidad: x.cantidad != null ? `${Number(x.cantidad).toLocaleString("es-PE")} ${String(peor.unidad ?? "")}`.trim() : null,
      unitario: num(x.unit_adj), entidad: { texto: x.entidad ?? "Entidad", url: `/app/contratos/${x.ocid}` },
    })),
    verificar: "Las 15 compras con el precio más cercano a la mediana. Cada una abre su contrato en Vigía.",
    enlace: null,
  });
  return ev;
}

const SUNAT_RUC = "https://e-consultaruc.sunat.gob.pe/";
const MENORES = new Set(["de", "del", "la", "las", "los", "el", "y", "e", "en", "a"]);
/** "INVERSIONES Y NEGOCIOS DEL PERU S.R.L." → "Inversiones y Negocios del Peru S.R.L.": las siglas (S.A.C., E.I.R.L.), igual. */
const titulo = (t: string) =>
  t.split(/\s+/).map((w, i) => {
    if ((w.match(/\./g) ?? []).length >= 2 && w === w.toUpperCase()) return w;
    const m = w.toLowerCase();
    return i > 0 && MENORES.has(m) ? m : m.charAt(0).toUpperCase() + m.slice(1);
  }).join(" ");
type EmpresaRef = { ruc: string; nombre: string | null };
const refs = (v: unknown): EmpresaRef[] =>
  Array.isArray(v) ? v.filter((x): x is EmpresaRef => !!x && typeof x === "object" && typeof (x as EmpresaRef).ruc === "string") : [];
/** La empresa como enlace a su ficha; una persona natural (RUC 10), en texto, sin nombre ni enlace (lib/privacidad.ts). */
const empresaEnlace = (e: EmpresaRef) =>
  e.ruc.startsWith("20") ? { texto: e.nombre ? titulo(e.nombre) : `RUC ${e.ruc}`, url: `/empresa/${e.ruc}` } : "Una persona natural";
const estadoSunat = (x: Record<string, any> | undefined) =>
  x ? [x.estado_sunat, x.condicion].filter(Boolean).map((s: string) => s.charAt(0) + s.slice(1).toLowerCase()).join(", ") || null : null;

const MESES = ["ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "set.", "oct.", "nov.", "dic."];
/** "2026-07-16" → "16 jul. 2026", como las fechas de la web. */
const fechaTexto = (iso: string) => {
  const [a, m, d] = iso.split("-");
  return `${Number(d)} ${MESES[Number(m) - 1] ?? m} ${a}`;
};

/** Quién presentó oferta en el proceso, según CONOSCE: null si CONOSCE no trae el proceso (no es «nadie»). */
export async function ofertasDe(codigo: string | null): Promise<Map<string, string | null> | null> {
  if (!codigo) return null;
  const r = await filas(`SELECT ruc_postor AS ruc, min(fecha_propuesta) AS fecha FROM conosce_postores WHERE codigo_convocatoria = $1 GROUP BY 1`, [codigo]);
  return r.length ? new Map(r.map((x) => [String(x.ruc), fecha(x.fecha)])) : null;
}
/** Qué hizo una empresa en este proceso: ganó, ofertó, sólo se registró o no participó. */
const enElProceso = (ruc: string, ganador: string, registrados: Set<string>, ofertas: Map<string, string | null> | null) => {
  if (ruc === ganador) return "Ganó la buena pro";
  if (!registrados.has(ruc)) return "No participó";
  if (!ofertas) return "Se registró como participante";
  return ofertas.has(ruc) ? `Presentó oferta${ofertas.get(ruc) ? ` el ${fechaTexto(ofertas.get(ruc)!)}` : ""}` : "Se registró, sin presentar oferta";
};

/**
 * Mismo domicilio fiscal que otro participante (migración 141): las empresas de esa dirección en la SUNAT, cuál se
 * registró en este proceso y si presentó oferta (CONOSCE). Sólo RUC 20: la dirección de una empresa es pública (va en su
 * ficha); nunca la de una persona natural (el cruce ni la guarda).
 */
async function domicilio(f: FilaCruce, p: ProcesoCruce): Promise<Evidencia | null> {
  const empresas = refs(f.detalle?.empresas);
  if (!empresas.length) return null;
  const registrados = new Set(refs(f.detalle?.postores).map((x) => x.ruc));
  const [sunat, ofertas] = await Promise.all([
    filas(`SELECT ruc, estado_sunat, metadata->>'condicion' AS condicion, fecha_alta_ruc FROM empresas WHERE ruc = ANY($1::text[])`, [empresas.map((e) => e.ruc)]),
    ofertasDe(p.codigo),
  ]);
  const porRuc = new Map(sunat.map((x) => [String(x.ruc), x]));
  const dir = typeof f.detalle?.domicilio === "string" ? f.detalle.domicilio : null;
  return {
    titulo: dir ? `Las empresas con domicilio fiscal en ${titulo(dir)}` : "Las empresas con ese domicilio fiscal",
    columnas: [
      { clave: "empresa", titulo: "Empresa", tipo: "enlace" },
      { clave: "ruc", titulo: "RUC" },
      { clave: "proceso", titulo: "En este proceso" },
      { clave: "estado", titulo: "En la SUNAT" },
      { clave: "alta", titulo: "Inscrita", tipo: "fecha" },
    ],
    filas: empresas.map((e) => ({
      empresa: empresaEnlace(e), ruc: e.ruc,
      proceso: enElProceso(e.ruc, f.ruc_empresa, registrados, ofertas),
      estado: estadoSunat(porRuc.get(e.ruc)), alta: fecha(porRuc.get(e.ruc)?.fecha_alta_ruc),
    })),
    verificar: `En la Consulta RUC de la SUNAT, busca cada RUC: todas declaran ese domicilio fiscal. Compartir dirección no prueba un vínculo (puede ser un estudio contable o un edificio de oficinas); por eso no cuentan las direcciones con más de 5 empresas.`,
    enlace: { texto: "Consulta RUC de la SUNAT", url: SUNAT_RUC },
  };
}

/** Recién fundada: la empresa en la SUNAT (alta, estado, actividad) y su ficha, donde están sus socios y representantes. */
async function fundacion(f: FilaCruce): Promise<Evidencia | null> {
  if (!f.ruc_empresa.startsWith("20")) return null;
  const r = await filas(
    `SELECT e.razon_social, e.fecha_alta_ruc, e.estado_sunat, e.metadata->>'condicion' AS condicion, e.actividad_economica,
            (SELECT count(DISTINCT j.numero_documento) FROM rnp_conformacion_juridica j WHERE j.ruc_empresa = e.ruc) AS personas
       FROM empresas e WHERE e.ruc = $1`, [f.ruc_empresa]);
  if (!r.length) return null;
  const x = r[0];
  return {
    titulo: "La empresa en la SUNAT",
    columnas: [
      { clave: "alta", titulo: "Inscrita", tipo: "fecha" },
      { clave: "estado", titulo: "Estado" },
      { clave: "actividad", titulo: "Actividad declarada" },
      { clave: "quien", titulo: "Quién está detrás", tipo: "enlace" },
    ],
    filas: [{
      alta: fecha(x.fecha_alta_ruc), estado: estadoSunat(x), actividad: x.actividad_economica ?? null,
      quien: {
        texto: Number(x.personas) === 1 ? "1 persona (socio o representante) en su ficha"
          : Number(x.personas) > 1 ? `${Number(x.personas)} personas (socios y representantes) en su ficha` : "Su ficha en Vigía",
        url: `/empresa/${f.ruc_empresa}?seccion=gente`,
      },
    }],
    verificar: `En la Consulta RUC de la SUNAT (RUC ${f.ruc_empresa}): fecha de inscripción y estado. Sus socios y representantes están en el RNP (OECE).`,
    enlace: { texto: "Consulta RUC de la SUNAT", url: SUNAT_RUC },
  };
}

/** Proveedor cautivo: a qué entidades les vende y cuánto de lo suyo sale de cada una (CONOSCE). */
async function clientes(f: FilaCruce): Promise<Evidencia | null> {
  const r = await filas(
    `SELECT a.entidad_ruc, max(a.entidad) AS entidad, count(DISTINCT a.codigo_convocatoria) AS procesos,
            sum(a.monto_adjudicado) FILTER (WHERE a.moneda IN ('Soles', 'Nuevos Soles')) AS monto,
            sum(sum(a.monto_adjudicado) FILTER (WHERE a.moneda IN ('Soles', 'Nuevos Soles'))) OVER () AS total,
            count(*) OVER () AS n
       FROM conosce_adjudicaciones a WHERE a.ruc_proveedor = $1 AND a.entidad_ruc IS NOT NULL
      GROUP BY a.entidad_ruc ORDER BY monto DESC NULLS LAST LIMIT 25`, [f.ruc_empresa]);
  return {
    titulo: "A quién le vende",
    columnas: [
      { clave: "entidad", titulo: "Entidad", tipo: "enlace" },
      { clave: "procesos", titulo: "Procesos" },
      { clave: "monto", titulo: "Le adjudicó", tipo: "soles" },
      { clave: "parte", titulo: "Parte de lo que vende", tipo: "pct" },
    ],
    filas: r.map((x) => ({
      entidad: { texto: x.entidad ?? `RUC ${x.entidad_ruc}`, url: `/entidad/${x.entidad_ruc}` }, procesos: Number(x.procesos), monto: num(x.monto),
      parte: Number(x.total) > 0 && x.monto != null ? (100 * Number(x.monto)) / Number(x.total) : null,
    })),
    total: r.length ? Number(r[0].n) : 0,
    verificar: "Suma de lo adjudicado por entidad en CONOSCE (OECE), desde 2018.",
    enlace: { texto: "Perfil del proveedor en el OSCE", url: PERFIL_OSCE(f.ruc_empresa) },
  };
}

/** El RUC 10 de una persona por su DNI: "10" + DNI + dígito verificador (módulo 11 de la SUNAT). */
const ruc10 = (dni: string) => {
  const base = `10${dni}`;
  const suma = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2].reduce((s, p, i) => s + p * Number(base[i]), 0);
  const r = 11 - (suma % 11);
  return `${base}${r === 10 ? 0 : r === 11 ? 1 : r}`;
};

/**
 * Socio en la entidad (puerta giratoria, migración 122): lo que las entidades le pagaron por órdenes de servicio a esa
 * persona (persona_entidad), con la ficha de cada una; la de este proceso, primero. Sin su nombre ni su documento: la
 * persona va tapada en el cruce y su ficha pública es la de `codigo`.
 */
async function ordenesSocio(f: FilaCruce, p: ProcesoCruce): Promise<Evidencia | null> {
  if (!f.persona_doc || !/^\d{8}$/.test(f.persona_doc)) return null;
  const r = await filas(
    `SELECT entidad_ruc, entidad, servicio, ordenes, monto, primera, ultima, codigo, count(*) OVER () AS n
       FROM persona_entidad WHERE ruc = $1
      ORDER BY (entidad_ruc = $2) DESC, monto DESC NULLS LAST LIMIT ${TOPE}`, [ruc10(f.persona_doc), p.entidadRuc ?? ""]);
  return {
    titulo: "Lo que esa persona cobró por órdenes de servicio",
    columnas: [
      { clave: "entidad", titulo: "Entidad", tipo: "enlace" },
      { clave: "servicio", titulo: "Servicio" },
      { clave: "ordenes", titulo: "Órdenes" },
      { clave: "periodo", titulo: "Período" },
      { clave: "monto", titulo: "Le pagaron", tipo: "soles" },
      { clave: "ficha", titulo: "Su ficha", tipo: "enlace" },
    ],
    filas: r.map((x) => ({
      entidad: { texto: x.entidad ?? `RUC ${x.entidad_ruc}`, url: `/entidad/${x.entidad_ruc}` }, servicio: x.servicio ?? null,
      ordenes: x.ordenes == null ? null : Number(x.ordenes),
      periodo: [fecha(x.primera), fecha(x.ultima)].filter(Boolean).map((v) => fechaTexto(v!)).join(" a ") || null,
      monto: num(x.monto), ficha: x.codigo ? { texto: "Ver sus órdenes", url: `/app/personas/${x.codigo}` } : null,
    })),
    total: r.length ? Number(r[0].n) : 0,
    verificar: "En CONOSCE (OECE), órdenes de servicio por proveedor; su RUC de persona natural no se publica aquí. Que sea socio de la empresa ganadora sale del RNP.",
    enlace: { texto: "Buscador de CONOSCE (OECE)", url: "https://conosce.osce.gob.pe/buscador/" },
  };
}

/** Socio común: las otras empresas de este proceso donde figura la misma persona, con su ficha y si ofertaron. */
async function socioComun(f: FilaCruce, p: ProcesoCruce): Promise<Evidencia | null> {
  const otros = (Array.isArray(f.detalle?.otros_postores) ? (f.detalle!.otros_postores as unknown[]) : []).filter((x): x is string => typeof x === "string");
  if (!otros.length) return null;
  const [nombres, ofertas] = await Promise.all([
    filas(`SELECT ruc, razon_social AS nombre FROM empresas WHERE ruc = ANY($1::text[])`, [otros]),
    ofertasDe(p.codigo),
  ]);
  const nombre = new Map(nombres.map((x) => [String(x.ruc), x.nombre as string | null]));
  const registrados = new Set(otros);
  return {
    titulo: "Las otras empresas del proceso con esa persona",
    columnas: [
      { clave: "empresa", titulo: "Empresa", tipo: "enlace" },
      { clave: "ruc", titulo: "RUC" },
      { clave: "proceso", titulo: "En este proceso" },
    ],
    filas: otros.map((ruc) => ({
      empresa: empresaEnlace({ ruc, nombre: nombre.get(ruc) ?? null }), ruc: ruc.startsWith("20") ? ruc : null,
      proceso: enElProceso(ruc, f.ruc_empresa, registrados, ofertas),
    })),
    verificar: "En el RNP (OECE), la conformación jurídica de cada empresa: la misma persona figura como socio, titular o representante.",
    enlace: { texto: "Buscador de proveedores del RNP", url: "https://apps.osce.gob.pe/perfilprov-ui/" },
  };
}

/** La evidencia de cada fila (mismo orden), [] donde no hay nada que agregar a lo que el cruce ya trae. */
export async function evidenciasDe(rows: FilaCruce[], p: ProcesoCruce): Promise<Evidencia[][]> {
  return Promise.all(rows.map(async (f): Promise<Evidencia[]> => {
    const ev: (Evidencia | null)[] = [];
    switch (f.tipo) {
      case "proveedor_campana": ev.push(await gastosCampana(f)); break;
      case "aporte":
      case "aporte_empresa": ev.push(await aportes(f)); break;
      case "candidato": ev.push(await candidaturas(f)); break;
      case "autoridad": ev.push(await autoridad(f)); break;
      case "vendio_gobernante": ev.push(await gastosCampana(f)); ev.push(await gobernante(f, p)); break;
      case "partido_gobernante": {
        const via = String(f.detalle?.via ?? "");
        ev.push(via === "proveedor_campana" ? await gastosCampana(f) : await aportes(f));
        ev.push(await gobernante(f, p));
        break;
      }
      case "penalidad": ev.push(await penalidades(f)); break;
      // Las bandas de la migración 121 (sanción, recurrente, sobreprecio) con la evidencia de su tipo base: no entraban
      // al switch y su tabla desaparecía.
      case "sancion":
      case "sancion_vigente":
      case "sancion_definitiva":
      case "sancion_temporal":
      case "sancion_multa": ev.push(await sanciones(f)); break;
      case "recurrente":
      case "recurrente_frecuente":
      case "recurrente_dominante": ev.push(await recurrente(f, p)); break;
      case "sobreprecio":
      case "sobreprecio_alto":
      case "sobreprecio_extremo": ev.push(...(await sobreprecio(f, p))); break;
      case "domicilio_compartido": ev.push(await domicilio(f, p)); break;
      case "socio_comun": ev.push(await socioComun(f, p)); break;
      case "socio_en_entidad": ev.push(await ordenesSocio(f, p)); break;
      case "proveedor_cautivo": ev.push(await clientes(f)); break;
      case "recien_fundada_medio_ano":
      case "recien_fundada_un_ano":
      case "recien_fundada_dos_anos": ev.push(await fundacion(f)); break;
      default: break;
    }
    return ev.filter((e): e is Evidencia => !!e && e.filas.length > 0);
  }));
}
