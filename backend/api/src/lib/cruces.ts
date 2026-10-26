/**
 * Cruces de los proveedores ganadores con las otras fuentes de la base (migraciones 48 y 50, `cruces_proveedor`):
 * aportes a partidos y gastos de campaña (ONPE), candidaturas, autoridades, el partido que gobierna la entidad
 * (JNE), penalidades, sanciones del OSCE, visitas previas a la buena pro, socios comunes entre postores, y de
 * CONOSCE el historial con la entidad, los adicionales del contrato y las órdenes menores de un mismo día que
 * juntas pasan el tope de 8 UIT (migración 51). Son datos de registros públicos, no conclusiones: cada uno va con su
 * fuente.
 *
 * Privacidad (lib/privacidad.ts): el DNI (`persona_doc`) no sale de la base. Las personas van bajo `socios`
 * (nombre en orden SUNAT, como en el RNP) y las visitas bajo `visitas` (visitante y funcionario): son papeles
 * que `publicar` reconoce y les tapa un apellido. Quien llama pasa la respuesta por `publicar`.
 */

import { pool } from "./db.js";
import { evidenciasDe, ofertasDe, type Evidencia, type FilaCruce, type ProcesoCruce } from "./evidencia.js";

export const ETIQUETA_CRUCE: Record<string, string> = {
  aporte: "Aportó a una organización política",
  aporte_empresa: "La empresa aportó a una organización política",
  candidato: "Fue candidato",
  autoridad: "Es autoridad electa",
  penalidad: "Penalidades en contratos anteriores",
  sancion: "Sanción del Tribunal de Contrataciones",
  // Sanción en bandas por tipo (migración 121).
  sancion_definitiva: "Inhabilitación definitiva antes de este proceso",
  sancion_temporal: "Inhabilitación temporal antes de este proceso",
  sancion_multa: "Multa del Tribunal antes de este proceso",
  sancion_vigente: "Ganó con una inhabilitación vigente",
  visita_previa: "Visitó una entidad antes de la buena pro",
  socio_comun: "Comparte socio o representante con otro postor",
  // Competencia y conflicto en el proceso (migración 122).
  unico_postor: "Único postor del proceso",
  socio_en_entidad: "Un socio del proveedor trabaja en la entidad",
  domicilio_compartido: "Mismo domicilio fiscal que otro postor",
  proveedor_cautivo: "Casi todo su ingreso del Estado es de esta entidad",
  partido_gobernante: "Financió al partido que gobierna la entidad",
  vendio_gobernante: "Le vendió a la campaña del partido que gobierna la entidad",
  proveedor_campana: "Le vendió a una campaña electoral",
  recurrente: "Proveedor frecuente de esta entidad",
  // Recurrente en bandas por dominancia (migración 121).
  recurrente_dominante: "Concentra el gasto de la entidad",
  recurrente_frecuente: "Le ganó muchos procesos a la misma entidad",
  adicional: "Contrato con adicionales o prórrogas",
  // Adicionales en bandas por % sobre el tope legal (migración 121).
  adicional_sobre_tope: "Adicionales por encima del tope legal (25%)",
  adicional_alto: "Adicionales cerca del tope legal",
  fraccionamiento: "Recibió de esta entidad órdenes menores el mismo día que juntas pasan 8 UIT",
  otro_postor: "Se le adjudicó después de que la buena pro fuera de otro postor",
  sobreprecio: "Precio 1.5 a 2 veces la mediana de otras entidades",
  // Sobreprecio en bandas por magnitud (migración 121).
  sobreprecio_extremo: "Precio 3 veces o más la mediana de otras entidades",
  sobreprecio_alto: "Precio 2 a 3 veces la mediana de otras entidades",
  // Señales de la ficha RUC de la SUNAT (migraciones 116-119). "Recién fundada" en tres bandas por tiempo de fundación.
  recien_fundada: "Ganó recién fundada",
  recien_fundada_medio_ano: "Ganó con 6 meses o menos de fundada",
  recien_fundada_un_ano: "Ganó con menos de 1 año de fundada",
  recien_fundada_dos_anos: "Ganó con menos de 2 años de fundada",
  dada_de_baja: "Dada de baja en la SUNAT",
  suspendida: "Suspendida en la SUNAT",
  no_habida: "No habida en la SUNAT",
};

/** La etiqueta de un cruce posterior a la convocatoria, donde la de siempre diría "anteriores". */
const ETIQUETA_POSTERIOR: Record<string, string> = {
  penalidad: "Penalidades en otros contratos",
  autoridad: "Fue elegido autoridad",
};

const ORDEN_SEVERIDAD = `CASE severidad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END`;

const ROL: Record<string, string> = {
  TITULAR: "titular",
  SOCIO_ACCIONISTA_TITULAR: "socio",
  REPRESENTANTE_LEGAL: "representante legal",
  ORGANO_ADMINISTRACION: "órgano de administración",
};
const rolLegible = (r: unknown) =>
  typeof r === "string" && r ? r.split(/,\s*/).map((x) => ROL[x] ?? x.toLowerCase().replace(/_/g, " ")).join(", ") : null;

export interface Cruce {
  tipo: string;
  etiqueta: string;
  severidad: "alta" | "media" | "baja";
  rucProveedor: string;
  /** Razón social del ganador y lo que ganó en este proceso (sólo en la ficha del contrato). */
  proveedor?: string | null;
  buenaPro?: { fecha: string | null; montoSoles: number | null } | null;
  /** Si el ganador es un consorcio, el cruce es de uno de sus integrantes (rucProveedor / proveedor). */
  consorcio?: { codigo: string; nombre: string | null } | null;
  /** socio_comun: los otros postores del proceso con el mismo socio, con su razón social. */
  otrosPostores?: { ruc: string; nombre: string | null }[];
  /** fraccionamiento: cada día con sus órdenes (número, descripción, monto, estado), de ordenes_fraccionadas. */
  ordenesDias?: DiaFraccionado[];
  /** Los registros oficiales que sostienen el cruce (lib/evidencia.ts): sin DNI ni nombres de personas naturales. */
  evidencia?: Evidencia[];
  /**
   * Todo lo del cruce pasó después de que se convocó este proceso (migración 83: cruce_es_antecedente): no es un
   * antecedente; la ficha lo muestra aparte. Sólo en la ficha del contrato.
   */
  posterior?: boolean;
  ocid: string | null;
  fecha: string | null;
  montoSoles: number | null;
  detalle: Record<string, unknown>;
  socios: { nombre: string; rol: string | null; cargo?: string | null }[];
  visitas: Record<string, unknown>[];
  fuente: string;
  fuenteUrl: string | null;
}

const fecha = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === "string" ? v.slice(0, 10) : null);

/** Fila de cruces_proveedor → lo que ve el público (sin el DNI; personas bajo `socios` / `visitas`). */
export function aCruce(r: Record<string, any>): Cruce {
  const d: Record<string, unknown> = { ...(r.detalle ?? {}) };
  const visitas: Record<string, unknown>[] = [];
  if (r.tipo === "visita_previa") {
    visitas.push({
      visitante: r.persona_nombre ?? null, rol: rolLegible(r.persona_rol), funcionario: d.funcionario ?? null, cargoFuncionario: d.cargo_funcionario ?? null,
      entidad: d.entidad_visitada ?? null, fecha: fecha(r.fecha), motivo: d.motivo ?? null,
    });
    delete d.funcionario;
    delete d.cargo_funcionario;
    delete d.motivo;
  }
  const socios = r.persona_nombre && r.tipo !== "visita_previa"
    ? [{ nombre: String(r.persona_nombre), rol: rolLegible(r.persona_rol), ...(r.tipo === "autoridad" ? { cargo: (d.cargo as string) ?? null } : {}) }]
    : [];
  return {
    tipo: r.tipo,
    etiqueta: ETIQUETA_CRUCE[r.tipo] ?? r.tipo,
    severidad: r.severidad,
    rucProveedor: r.ruc_empresa,
    ocid: r.ocid ?? null,
    fecha: fecha(r.fecha),
    montoSoles: r.monto == null ? null : Number(r.monto),
    detalle: d,
    socios,
    visitas,
    fuente: r.fuente,
    fuenteUrl: r.fuente_url ?? null,
  };
}

export interface DiaFraccionado {
  fecha: string | null;
  entidad: string | null;
  objeto: string | null;
  ordenes: number;
  totalSoles: number;
  topeSoles: number;
  mismaDescripcion: boolean;
  severidad: string;
  detalle: { orden: string; montoSoles: number; descripcion: string | null; estado: string | null }[];
}

/** Una fila de ordenes_fraccionadas para la API (la ficha del contrato y la de la entidad). */
function aDia(r: Record<string, any>): DiaFraccionado {
  return {
    fecha: fecha(r.fecha), entidad: r.entidad ?? null, objeto: r.objeto ?? null,
    ordenes: r.ordenes, totalSoles: Number(r.total), topeSoles: Number(r.tope), mismaDescripcion: r.misma_descripcion,
    severidad: r.severidad,
    detalle: (r.detalle as { orden: string; monto: number; descripcion: string | null; estado: string | null }[])
      .map((o) => ({ orden: o.orden, montoSoles: Number(o.monto), descripcion: o.descripcion, estado: o.estado })),
  };
}

const COLS = `tipo, ruc_empresa, ocid, severidad, fecha, monto, persona_nombre, persona_rol, detalle, fuente, fuente_url`;

export interface Ganador {
  proveedorRuc: string | null;
  proveedor: string | null;
  fecha: string | null;
  montoPen: number | null;
  consorcio?: { codigo: string; nombre: string | null } | null;
}

const ES_RUC = /^(10|20)\d{9}$/;

/** Un consorcio con código del SEACE (no RUC) se abre en sus integrantes con RUC (conosce_consorcios, migración 53). */
async function abrirConsorcios(ganadores: Ganador[]): Promise<Ganador[]> {
  const codigos = [...new Set(ganadores.map((g) => g.proveedorRuc).filter((r): r is string => !!r && /^\d+$/.test(r) && !ES_RUC.test(r)))];
  if (!codigos.length) return ganadores;
  const q = await pool.query(
    `SELECT DISTINCT ON (ruc_consorcio, ruc_miembro) ruc_consorcio, ruc_miembro, miembro
     FROM conosce_consorcios WHERE ruc_consorcio = ANY($1::text[]) AND ruc_miembro ~ '^(10|20)[0-9]{9}$'
     ORDER BY ruc_consorcio, ruc_miembro, anio DESC`, [codigos]).catch(() => null);
  const miembros = new Map<string, { ruc: string; nombre: string | null }[]>();
  for (const r of q?.rows ?? []) miembros.set(r.ruc_consorcio, [...(miembros.get(r.ruc_consorcio) ?? []), { ruc: r.ruc_miembro, nombre: r.miembro }]);
  return ganadores.flatMap((g) => {
    const ms = g.proveedorRuc ? miembros.get(g.proveedorRuc) : undefined;
    if (!ms) return [g];
    const consorcio = { codigo: g.proveedorRuc!, nombre: g.proveedor };
    return ms.map((m) => ({ ...g, proveedorRuc: m.ruc, proveedor: m.nombre, consorcio }));
  });
}

/**
 * Cruces de los ganadores del proceso `ocid`: los de la empresa (aportes, sanciones, penalidades…) y los de
 * este proceso (visitas previas, inhabilitación vigente, socio común). Cada uno va con la razón social del
 * ganador y lo que ganó (fecha y monto de la buena pro), y el socio común con los nombres de los otros
 * postores: así el texto dice de qué empresa se habla. Sin la migración 48 devuelve [].
 */
export async function crucesDeProceso(ocid: string, ganadores: Ganador[]): Promise<Cruce[]> {
  const porRuc = new Map<string, Ganador>();
  for (const g of await abrirConsorcios(ganadores)) if (g.proveedorRuc && /^\d{11}$/.test(g.proveedorRuc) && !porRuc.has(g.proveedorRuc)) porRuc.set(g.proveedorRuc, g);
  if (!porRuc.size) return [];
  const q = await pool.query(
    // `antecedente` (migración 83): lo de la empresa que ya había pasado cuando se convocó; lo demás es posterior.
    // persona_doc: sólo para buscar la evidencia de un socio o representante (aCruce no lo copia a la respuesta). Sin
    // él, la evidencia de una persona vinculada se buscaba con el RUC de la empresa.
    `SELECT ${COLS}, persona_doc, (ocid IS NOT NULL OR cruce_es_antecedente(tipo, fecha, detalle,
              (SELECT c.fecha_convocatoria FROM convocatorias c WHERE ocid_corto(c.ocid) = ocid_corto($2) LIMIT 1))) AS antecedente
       FROM cruces_proveedor
     WHERE ruc_empresa = ANY($1::text[]) AND (ocid IS NULL OR ocid_corto(ocid) = ocid_corto($2))
     ORDER BY ${ORDEN_SEVERIDAD}, tipo, fecha DESC NULLS LAST LIMIT 200`, [[...porRuc.keys()], ocid]).catch(() => null);
  const crudas = q?.rows ?? [];
  const cruces = crudas.map(aCruce);
  const otros = [...new Set(cruces.flatMap((c) => (c.tipo === "socio_comun" && Array.isArray(c.detalle.otros_postores) ? c.detalle.otros_postores as string[] : [])))];
  // Fraccionamiento: los días y sus órdenes, de la entidad de ESTE proceso (el cruce sólo trae cuántos y cuánto).
  const fracc = new Map<string, DiaFraccionado[]>();
  const conFracc = [...new Set(cruces.filter((c) => c.tipo === "fraccionamiento").map((c) => c.rucProveedor))];
  if (conFracc.length) {
    const f = await pool.query(
      `SELECT f.* FROM ordenes_fraccionadas f
        WHERE f.ruc_contratista = ANY($1::text[]) AND f.entidad_ruc = (SELECT entidad_ruc FROM convocatorias WHERE ocid = $2)
          -- Sólo los días anteriores a la convocatoria, como el cruce (migración 83).
          AND f.fecha < COALESCE((SELECT fecha_convocatoria FROM convocatorias WHERE ocid = $2), 'infinity'::date)
        ORDER BY f.fecha DESC, f.total DESC LIMIT 500`, [conFracc, ocid]).catch(() => null);
    for (const r of f?.rows ?? []) fracc.set(r.ruc_contratista, [...(fracc.get(r.ruc_contratista) ?? []), aDia(r)]);
  }
  // La evidencia de cada cruce: los registros de la fuente (gastos y aportes de campaña, cargos, penalidades,
  // sanciones, los otros procesos que ganó). Necesita la entidad, el código y la fecha de este proceso.
  const proc = await pool.query(
    `SELECT c.ocid, c.codigo, c.entidad_ruc::text AS "entidadRuc", e.ubigeo::text AS ubigeo, to_char(c.fecha_convocatoria, 'YYYY-MM-DD') AS fecha
       FROM convocatorias c LEFT JOIN entidades e ON e.ruc = c.entidad_ruc WHERE ocid_corto(c.ocid) = ocid_corto($1) LIMIT 1`, [ocid]).catch(() => null);
  const proceso: ProcesoCruce = proc?.rows[0] ?? { ocid, codigo: null, entidadRuc: null, ubigeo: null, fecha: null };
  const evidencias = crudas.length ? await evidenciasDe(crudas as FilaCruce[], proceso) : [];
  // Mismo domicilio (migración 141): cada otro participante con `oferta` (true/false; null si CONOSCE no trae el
  // proceso). Los del OCDS sólo se registraron; CONOSCE dice quién ofertó: «compitieron» no es lo mismo.
  if (cruces.some((c) => c.tipo === "domicilio_compartido" && Array.isArray(c.detalle.postores))) {
    const ofertas = await ofertasDe(proceso.codigo);
    for (const c of cruces) {
      if (c.tipo !== "domicilio_compartido" || !Array.isArray(c.detalle.postores)) continue;
      c.detalle = {
        ...c.detalle,
        postores: (c.detalle.postores as { ruc?: unknown }[]).map((o) => ({ ...o, oferta: ofertas ? ofertas.has(String(o.ruc)) : null })),
      };
    }
  }
  const nombres = new Map<string, string>();
  if (otros.length) {
    const n = await pool.query(
      `SELECT ruc_postor AS ruc, max(postor) AS nombre FROM conosce_postores WHERE ruc_postor = ANY($1::text[]) GROUP BY ruc_postor`, [otros]).catch(() => null);
    for (const r of n?.rows ?? []) nombres.set(r.ruc, r.nombre);
  }
  // La misma venta o aporte no va dos veces (migración 87): si ya está como "partido que gobierna", sin la genérica.
  const clave = (r: Record<string, any>) =>
    `${r.ruc_empresa}|${r.persona_doc ?? ""}|${String(r.detalle?.organizacion ?? r.detalle?.partido ?? "").toUpperCase()}|${r.detalle?.proceso ?? ""}`;
  const gobernantes = new Set(crudas.filter((r) => r.tipo === "vendio_gobernante" || r.tipo === "partido_gobernante").map(clave));
  const repetida = crudas.map((r) => {
    if (r.tipo === "proveedor_campana") return gobernantes.has(clave(r));
    if (r.tipo === "aporte" || r.tipo === "aporte_empresa") return gobernantes.has(clave({ ...r, detalle: { partido: r.detalle?.partido } }));
    return false;
  });
  return cruces.map((c, i) => {
    const g = porRuc.get(c.rucProveedor);
    const anteriores = soloAnteriores(c, evidencias[i], proceso.fecha);
    const posterior = crudas[i]?.antecedente === false || anteriores.posterior === true;
    return {
      ...c,
      proveedor: g?.proveedor ?? null,
      buenaPro: g ? { fecha: g.fecha, montoSoles: g.montoPen } : null,
      consorcio: g?.consorcio ?? null,
      ...(c.tipo === "socio_comun"
        ? { otrosPostores: ((c.detalle.otros_postores as string[] | undefined) ?? []).map((ruc) => ({ ruc, nombre: nombres.get(ruc) ?? null })) }
        : {}),
      ...(c.tipo === "fraccionamiento" ? { ordenesDias: fracc.get(c.rucProveedor) ?? [] } : {}),
      ...(evidencias[i]?.length ? { evidencia: marcarPosteriores(evidencias[i], proceso.fecha) } : {}),
      ...anteriores,
      ...(posterior ? { posterior: true, etiqueta: ETIQUETA_POSTERIOR[c.tipo] ?? c.etiqueta } : {}),
    };
  }).filter((_, i) => !repetida[i]);
}

/**
 * Procesos de la entidad `ruc` cuyo ganador tiene cruces: uno por proceso y proveedor, con los tipos que
 * le tocan, ordenados por cuántos de severidad alta y por fecha de buena pro.
 */
export async function crucesDeEntidad(ruc: string, limit = 50): Promise<{ total: number; procesos: Record<string, unknown>[] }> {
  // De casos_cruce (migración 57, una fila por proceso y ganador, sólo con antecedentes, migración 83): ya trae los
  // tipos con su severidad. Antes se armaba desde los payloads de todas las convocatorias de la entidad y, con la
  // historia desde 2015, tardaba más que los 10 s del rol (respondía vacío).
  const q = await pool.query(
    `SELECT k.ocid, k.codigo, k.objeto, k.fecha_buena_pro, k.ruc, k.proveedor, k.consorcio, k.monto, k.cruces, k.n_alta,
            count(*) OVER () AS total
       FROM casos_cruce k
      WHERE k.entidad_ruc = $1
      ORDER BY k.n_alta DESC, k.fecha_buena_pro DESC NULLS LAST, k.ocid
      LIMIT $2`,
    [ruc, limit]).catch(() => null);
  const filas = q?.rows ?? [];
  return {
    total: filas.length ? Number(filas[0].total) : 0,
    procesos: filas.map((r) => ({
      ocid: r.ocid, codigo: r.codigo, objeto: r.objeto, fechaBuenaPro: fecha(r.fecha_buena_pro),
      proveedor: r.proveedor, rucProveedor: r.ruc, consorcio: r.consorcio ?? null, montoSoles: r.monto == null ? null : Number(r.monto),
      cruces: ((r.cruces ?? []) as { tipo: string; severidad: string }[])
        .map((t) => ({ tipo: t.tipo, severidad: t.severidad, etiqueta: ETIQUETA_CRUCE[t.tipo] ?? t.tipo }))
        .sort((a, b) => "amb".indexOf(a.severidad[0]) - "amb".indexOf(b.severidad[0])),
    })),
  };
}

/**
 * Días en que la entidad `ruc` le emitió a una misma empresa 2 o más órdenes "hasta 8 UIT" que juntas pasan el
 * tope (migración 51, `ordenes_fraccionadas`): severidad alta primero, luego los más recientes. Sin la
 * migración devuelve vacío.
 */
export async function fraccionamientoDeEntidad(ruc: string, limit = 50): Promise<{ total: number; montoTotal: number; empresas: number; casos: Record<string, unknown>[] }> {
  const q = await pool.query(
    `SELECT f.*, count(*) OVER () AS n, sum(f.total) OVER () AS monto_total,
            (SELECT count(DISTINCT ruc_contratista) FROM ordenes_fraccionadas WHERE entidad_ruc = $1) AS empresas
     FROM ordenes_fraccionadas f WHERE f.entidad_ruc = $1
     ORDER BY CASE f.severidad WHEN 'alta' THEN 0 ELSE 1 END, f.fecha DESC, f.total DESC LIMIT $2`, [ruc, limit]).catch(() => null);
  const filas = q?.rows ?? [];
  return {
    total: filas.length ? Number(filas[0].n) : 0,
    montoTotal: filas.length ? Number(filas[0].monto_total) : 0,
    empresas: filas.length ? Number(filas[0].empresas) : 0,
    casos: filas.map((r) => ({ ...aDia(r), rucProveedor: r.ruc_contratista, proveedor: r.contratista, objeto: r.objeto })),
  };
}

/** Las filas de la evidencia con fecha posterior a la convocatoria llevan `posterior: true` (la ficha las atenúa). */
function marcarPosteriores(ev: Evidencia[], fecha: string | null): Evidencia[] {
  if (!fecha) return ev;
  return ev.map((e) =>
    e.columnas.some((c) => c.clave === "fecha")
      ? { ...e, filas: e.filas.map((f) => (typeof f.fecha === "string" && f.fecha >= fecha ? { ...f, posterior: true } : f)) }
      : e);
}

/**
 * Penalidades y aportes de la empresa son agregados (cuántos, entre qué fechas): si parte pasó después de la
 * convocatoria, el texto del cruce cuenta sólo lo anterior, con la evidencia completa (menos de 60 registros).
 */
function soloAnteriores(c: Cruce, ev: Evidencia[] | undefined, fecha: string | null): Partial<Cruce> {
  if (!fecha || !ev?.length || !["penalidad", "aporte", "aporte_empresa"].includes(c.tipo)) return {};
  const e = ev[0];
  if (e.total != null && e.total > e.filas.length) return {};
  // Sin fecha, el registro queda como anterior (la fuente no dice cuándo).
  const despues = e.filas.filter((f) => typeof f.fecha === "string" && f.fecha >= fecha).length;
  const antes = e.filas.filter((f) => !(typeof f.fecha === "string" && f.fecha >= fecha));
  if (!despues) return {};
  // Un aporte del mismo año pero posterior a la convocatoria: el cruce entero es posterior.
  if (!antes.length) return { posterior: true };
  const fechas = antes.map((f) => f.fecha).filter((f): f is string => typeof f === "string").sort();
  if (!fechas.length) return {};
  const monto = antes.reduce((s, f) => s + (Number(f.monto) || 0), 0);
  const detalle: Record<string, unknown> = { ...c.detalle, posteriores: despues };
  if (c.tipo === "penalidad") {
    Object.assign(detalle, { penalidades: antes.length, entidades: new Set(antes.map((f) => f.entidad)).size, desde: fechas[0], hasta: fechas[fechas.length - 1] });
  } else {
    Object.assign(detalle, { aportes: antes.length, desde: Number(fechas[0].slice(0, 4)), hasta: Number(fechas[fechas.length - 1].slice(0, 4)) });
  }
  return { detalle, montoSoles: monto };
}
