/**
 * Lo que el registro de un proceso dice además de la convocatoria, para la ficha de un contrato (pedido del usuario,
 * 2026-10-26: «la API de SEACE te trae MÁS METADATA, ¿no la podemos PONER ACÁ? Participantes y demás»). Sin dictamen
 * la ficha mostraba sólo el resumen, los ítems y los documentos.
 *
 *   · participantes  quiénes se registraron (OCDS, `tender.tenderers`), quiénes presentaron oferta (CONOSCE postores),
 *                    quién ganó, su ficha SUNAT y su historial en Vigía (`empresa_resumen`), y lo que los une en ESTE
 *                    proceso (los cruces `socio_comun` y `domicilio_compartido`). Registrarse no es competir: en el
 *                    1224210 se registraron 17 y ofertaron 3, y el OCDS los llama a todos «tenderers».
 *   · cronograma     los hitos con fecha y de dónde sale cada uno (OCDS, CONOSCE, documentos del SEACE).
 *   · contrato       lo adjudicado por ítem (CONOSCE o el OCDS) y el contrato firmado (CONOSCE, o el OCDS si lo trae).
 *   · presupuesto    el proyecto de inversión (CUI) con su PIM y devengado del MEF.
 *
 * Privacidad (lib/privacidad.ts): quien llama pasa la respuesta por `publicar()`. Cada persona o empresa va como
 * `{ ruc, nombre }`, el par que reconoce (RUC 10 → `10·ref·…` y un apellido tapado). La dirección fiscal, sólo de una
 * empresa (RUC 20): la de una persona natural no se pide en la SQL ni sale (`armarParticipantes` la descarta igual).
 * Del cruce de socio común no sale la persona en común (está en `cruces`, tapada).
 *
 * Costo: una consulta por pieza, todas por índice (conosce_postores y conosce_contratos por código, empresas y
 * empresa_resumen por PK, cruces_proveedor por ocid, el MEF por su PK con las unidades ejecutoras de la entidad).
 */

import { LISTA_JSON, OCID_CANDIDATOS, pool } from "./db.js";

type Severidad = "alta" | "media" | "baja";
const RANGO: Record<Severidad, number> = { alta: 0, media: 1, baja: 2 };
const severidad = (v: unknown): Severidad => (v === "alta" || v === "media" ? v : "baja");

/** Una empresa o persona del proceso: el par que `publicar()` reconoce. */
export interface Persona { ruc: string; nombre: string | null }

export const esRuc20 = (ruc: string | null | undefined) => /^20\d{9}$/.test(ruc ?? "");
const num = (v: unknown): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const dia = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const texto = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

// ─── Participantes ───────────────────────────────────────────────────────────

/** Lo que une a un participante con otros de ESTE proceso (cruces de la migración 48/122), sin la persona en común. */
export interface Vinculo {
  /** socio_comun: comparten un socio o representante (RNP). domicilio_compartido: la misma dirección fiscal (SUNAT). */
  tipo: "socio_comun" | "domicilio_compartido";
  severidad: Severidad;
  /** Con quiénes de este proceso. */
  con: Persona[];
  /** Alguno de `con` ganó la buena pro. */
  conGanador: boolean;
  /** La dirección compartida: sólo entre empresas (RUC 20). */
  domicilio?: string | null;
}

export interface Participante extends Persona {
  tipo: "empresa" | "persona" | "consorcio";
  /** Figura entre los participantes registrados del OCDS (`tender.tenderers`). */
  registrado: boolean;
  /** Presentó oferta según CONOSCE: el día (o el rango) y a qué ítems. null: no figura entre los que ofertaron. */
  oferta: { desde: string | null; hasta: string | null; items: number[] } | null;
  gano: boolean;
  /** Los ítems que ganó (posición) y por cuánto en total (CONOSCE; sin CONOSCE, las adjudicaciones vigentes del OCDS). */
  itemsGanados: number[];
  montoAdjudicado: number | null;
  /** Su ficha RUC. `domicilio` y `distrito`, sólo de una empresa (RUC 20). */
  sunat: {
    estado: string | null; condicion: string | null; fechaAlta: string | null;
    /** Meses de inscrita en la SUNAT el día de la convocatoria (negativo: se inscribió después). */
    mesesAlConvocar: number | null;
    actividad: string | null; domicilio?: string | null; distrito?: string | null;
  } | null;
  rnpVigente: boolean | null;
  /** Su historial en Vigía (`empresa_resumen`): procesos a los que postuló, cuántos ganó, lo adjudicado y sus antecedentes. */
  historial: {
    postulaciones: number; ganadas: number; adjudicado: number | null;
    alta: number; media: number; baja: number;
    antecedentes: { tipo: string; severidad: Severidad; n: number }[];
  } | null;
  vinculos: Vinculo[];
  /** Si es un consorcio: sus integrantes (CONOSCE). */
  integrantes: Persona[];
}

/**
 * Los participantes registrados del OCDS, sin repetir y en su orden: `tender.tenderers` y, si el release no los trae,
 * las partes con papel `tenderer` (la SQL de la ruta ya las filtra). Un consorcio va con su código del SEACE (7 dígitos).
 */
export function registradosDe(tenderers: unknown, partes: unknown): Persona[] {
  const lista = Array.isArray(tenderers) && tenderers.length ? tenderers : Array.isArray(partes) ? partes : [];
  const vistos = new Set<string>();
  const out: Persona[] = [];
  for (const t of lista) {
    if (!t || typeof t !== "object") continue;
    const o = t as Record<string, unknown>;
    const ruc = String(o.id ?? "").replace(/^PE-RUC-/, "").trim();
    if (!/^\d{5,11}$/.test(ruc) || vistos.has(ruc)) continue;
    vistos.add(ruc);
    out.push({ ruc, nombre: texto(o.name) });
  }
  return out;
}

/** Una fila de PARTICIPANTES_SQL. */
export interface FilaParticipante {
  ruc: string; nombre: string | null; orden: number | null; registrado: boolean; oferto: boolean;
  desde: string | null; hasta: string | null; items: number[] | null;
  estado_sunat: string | null; condicion: string | null; fecha_alta: string | null; actividad: string | null; rnp_vigente: boolean | null;
  domicilio: string | null; distrito: string | null;
  postulaciones: number | null; ganadas: number | null; adjudicado: number | null; n_alta: number | null; n_media: number | null; n_baja: number | null;
  antecedentes: unknown; integrantes: unknown;
}

/**
 * Los registrados (OCDS, `$1` RUC y `$2` nombre) unidos a los que ofertaron (CONOSCE, código `$3`): un FULL JOIN, así
 * entra también quien ofertó sin figurar en el release guardado. Con su ficha SUNAT y su resumen en Vigía.
 */
const PARTICIPANTES_SQL = `
  WITH t AS (
    SELECT r.ruc, r.nombre, r.orden::int AS orden FROM unnest($1::text[], $2::text[]) WITH ORDINALITY AS r(ruc, nombre, orden)
  ), p AS (
    SELECT ruc_postor AS ruc, max(postor) AS nombre, min(fecha_propuesta) AS desde, max(fecha_propuesta) AS hasta,
           array_agg(DISTINCT n_item ORDER BY n_item) FILTER (WHERE n_item IS NOT NULL) AS items
      FROM conosce_postores WHERE codigo_convocatoria = $3 GROUP BY ruc_postor
  ), u AS (
    SELECT COALESCE(t.ruc, p.ruc) AS ruc, COALESCE(t.nombre, p.nombre) AS nombre, t.orden,
           t.ruc IS NOT NULL AS registrado, p.ruc IS NOT NULL AS oferto, p.desde, p.hasta, p.items
      FROM t FULL JOIN p ON p.ruc = t.ruc
  )
  SELECT u.ruc, COALESCE(e.razon_social, u.nombre) AS nombre, u.orden, u.registrado, u.oferto,
         to_char(u.desde, 'YYYY-MM-DD') AS desde, to_char(u.hasta, 'YYYY-MM-DD') AS hasta, u.items,
         e.estado_sunat, e.metadata->>'condicion' AS condicion, to_char(e.fecha_alta_ruc, 'YYYY-MM-DD') AS fecha_alta,
         e.actividad_economica AS actividad, e.rnp_vigente,
         -- La dirección, sólo de una empresa: la de una persona natural no sale nunca (docs/PRIVACIDAD.md).
         CASE WHEN u.ruc ~ '^20[0-9]{9}$' THEN e.domicilio_fiscal END AS domicilio,
         CASE WHEN u.ruc ~ '^20[0-9]{9}$' THEN e.metadata->>'distrito' END AS distrito,
         r.postulaciones, r.ganadas, r.adj_monto::float AS adjudicado, r.n_alta, r.n_media, r.n_baja, r.cruces AS antecedentes,
         (SELECT jsonb_agg(DISTINCT jsonb_build_object('ruc', k.ruc_miembro, 'nombre', k.miembro))
            FROM conosce_consorcios k WHERE u.ruc !~ '^(10|20)[0-9]{9}$' AND k.ruc_consorcio = u.ruc) AS integrantes
    FROM u
    LEFT JOIN empresas e ON e.ruc = u.ruc::bpchar
    LEFT JOIN empresa_resumen r ON r.ruc = u.ruc`;

/** Las filas de los participantes, en cualquier orden (`armarParticipantes` ordena). */
export async function filasParticipantes(registrados: Persona[], codigo: string): Promise<FilaParticipante[]> {
  const r = await pool.query(PARTICIPANTES_SQL, [registrados.map((p) => p.ruc), registrados.map((p) => p.nombre), codigo]);
  return r.rows as FilaParticipante[];
}

/** Una fila de cruces_proveedor de este proceso que relaciona a dos participantes. */
export interface FilaVinculo { tipo: string; ruc: string; severidad: string; detalle: Record<string, unknown> | null }

/** Los cruces de ESTE proceso entre participantes, de cualquiera (no sólo del ganador): socio común y mismo domicilio. */
export async function vinculosDelProceso(ocid: string): Promise<FilaVinculo[]> {
  const r = await pool.query(
    `SELECT tipo, ruc_empresa AS ruc, severidad, detalle FROM cruces_proveedor
      WHERE ocid = ANY(${OCID_CANDIDATOS("$1")}) AND tipo IN ('socio_comun', 'domicilio_compartido')`, [ocid]);
  return r.rows as FilaVinculo[];
}

/**
 * ¿La adjudicación (`id`) o el contrato (`awardID`) del OCDS es de ESTA convocatoria? Sus ids empiezan con el código de
 * la convocatoria («1224210-20615038998»). Un OCID de procedimiento («2026-1516-2») junta varias convocatorias en su
 * record: la buena pro y el contrato de una anterior (la 1196572, de marzo) no son de la que muestra la ficha (la
 * 1249080, de setiembre). Sin un código al comienzo, se toma como propia.
 */
export function deEstaConvocatoria(id: unknown, codigo: string): boolean {
  const m = /^(\d+)-/.exec(String(id ?? ""));
  return !m || !/^\d+$/.test(codigo) || m[1] === codigo;
}

/** Lo que ganó cada RUC: los ítems (posición) y el monto. */
export type Ganadores = Map<string, { items: number[]; monto: number | null }>;

/**
 * Quién ganó: lo que CONOSCE registra adjudicado o contratado por ítem y, para quien no figura ahí, las adjudicaciones
 * VIGENTES del OCDS (una buena pro reemplazada no cuenta). `posicion`: id del ítem del OCDS → su posición.
 */
export function ganadoresDe(
  adjudicaciones: { proveedorRuc: string | null; items: string[]; montoPen?: number | null; vigente?: boolean }[],
  conosce: { item: number; ruc: string | null; montoPen: number | null }[],
  posicion: Map<string, number>,
): Ganadores {
  const out: Ganadores = new Map();
  const sumar = (ruc: string, items: number[], monto: number | null) => {
    const g = out.get(ruc) ?? { items: [], monto: null };
    for (const i of items) if (!g.items.includes(i)) g.items.push(i);
    if (monto != null) g.monto = (g.monto ?? 0) + monto;
    out.set(ruc, g);
  };
  for (const k of conosce) if (k.ruc) sumar(k.ruc, Number.isFinite(k.item) ? [k.item] : [], k.montoPen);
  const deConosce = new Set(out.keys());
  for (const a of adjudicaciones) {
    if (a.vigente === false || !a.proveedorRuc || deConosce.has(a.proveedorRuc)) continue;
    sumar(a.proveedorRuc, a.items.map((i) => posicion.get(i)).filter((x): x is number => x != null), a.montoPen ?? null);
  }
  for (const g of out.values()) g.items.sort((a, b) => a - b);
  return out;
}

/** Meses enteros de `desde` a `hasta` (AAAA-MM-DD); si `desde` es posterior, negativo (−1 aunque sean días). */
export function mesesEntre(desde: string | null, hasta: string | null): number | null {
  const a = dia(desde), b = dia(hasta);
  if (!a || !b) return null;
  if (a > b) return -Math.max(1, mesesEntre(b, a)!);
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  const m = (yb - ya) * 12 + (mb - ma);
  return db < da ? m - 1 : m;
}

const normalDomicilio = (d: string | null | undefined) => (d ?? "").toUpperCase().replace(/\s+/g, " ").trim();

/**
 * Los vínculos de cada participante en este proceso. El socio común se guarda por empresa (la que tiene el socio y
 * los otros postores con él): se cuenta en las dos puntas. El mismo domicilio se guarda en el ganador; su detalle trae
 * los otros postores desde la migración 141 y, antes, sólo cuántos: entonces son los participantes con la MISMA
 * dirección fiscal que él (la misma comparación que hace el cruce).
 */
export function vinculosDe(filas: FilaVinculo[], participantes: { ruc: string; nombre: string | null; domicilio?: string | null }[], ganadores: Set<string>): Map<string, Vinculo[]> {
  const nombre = new Map(participantes.map((p) => [p.ruc, p.nombre]));
  const domicilio = new Map(participantes.filter((p) => esRuc20(p.ruc)).map((p) => [p.ruc, normalDomicilio(p.domicilio)]));
  const pares = new Map<string, { tipo: Vinculo["tipo"]; severidad: Severidad; con: Set<string>; domicilio: string | null }>();
  const unir = (tipo: Vinculo["tipo"], a: string, b: string, sev: Severidad, dom: string | null) => {
    if (!a || !b || a === b) return;
    for (const [x, y] of [[a, b], [b, a]]) {
      const k = `${tipo}|${x}`;
      const v = pares.get(k) ?? { tipo, severidad: sev, con: new Set<string>(), domicilio: dom };
      v.con.add(y);
      if (RANGO[sev] < RANGO[v.severidad]) v.severidad = sev;
      pares.set(k, v);
    }
  };
  for (const f of filas) {
    const d = f.detalle ?? {};
    const sev = severidad(f.severidad);
    if (f.tipo === "socio_comun") {
      for (const otro of Array.isArray(d.otros_postores) ? d.otros_postores : []) unir("socio_comun", f.ruc, String(otro), sev, null);
    } else if (f.tipo === "domicilio_compartido") {
      const dir = esRuc20(f.ruc) ? (texto(d.domicilio) ?? texto(participantes.find((p) => p.ruc === f.ruc)?.domicilio)) : null;
      const otros = Array.isArray(d.postores)
        ? d.postores.map((x) => String((x as { ruc?: unknown })?.ruc ?? ""))
        : [...domicilio.entries()].filter(([r, dd]) => r !== f.ruc && dd && dd === domicilio.get(f.ruc)).map(([r]) => r);
      for (const otro of otros) if (esRuc20(otro)) unir("domicilio_compartido", f.ruc, otro, sev, dir);
      // El nombre de un postor que no está entre los registrados (release guardado viejo): el del cruce.
      if (Array.isArray(d.postores)) for (const x of d.postores as { ruc?: unknown; nombre?: unknown }[]) if (!nombre.has(String(x?.ruc))) nombre.set(String(x?.ruc), texto(x?.nombre));
    }
  }
  const out = new Map<string, Vinculo[]>();
  for (const [k, v] of pares) {
    const ruc = k.slice(k.indexOf("|") + 1);
    const con = [...v.con].sort().map((r) => ({ ruc: r, nombre: nombre.get(r) ?? null }));
    out.set(ruc, [...(out.get(ruc) ?? []), {
      tipo: v.tipo, severidad: v.severidad, con, conGanador: con.some((c) => ganadores.has(c.ruc)),
      ...(v.tipo === "domicilio_compartido" ? { domicilio: v.domicilio } : {}),
    }]);
  }
  return out;
}

/** Persona natural (RUC 10), consorcio (con su código del SEACE o un RUC 20 a su nombre) o empresa. */
const tipoDe = (ruc: string, nombre: string | null): Participante["tipo"] =>
  /^10\d{9}$/.test(ruc) ? "persona" : !esRuc20(ruc) || /^CONSORCIO\b/i.test(nombre ?? "") ? "consorcio" : "empresa";

const personas = (v: unknown): Persona[] =>
  (Array.isArray(v) ? v : [])
    .map((x) => ({ ruc: String((x as { ruc?: unknown })?.ruc ?? ""), nombre: texto((x as { nombre?: unknown })?.nombre) }))
    .filter((p) => p.ruc);

/**
 * Las filas de la SQL → participantes: quién ganó y qué, su ficha SUNAT (la dirección, sólo de una empresa), su
 * historial y sus vínculos en este proceso. Primero los que ganaron, después los que ofertaron y al final los que sólo
 * se registraron, cada grupo en el orden del OCDS.
 */
export function armarParticipantes(filas: FilaParticipante[], ctx: { fechaConvocatoria: string | null; ganadores: Ganadores; vinculos: FilaVinculo[] }): Participante[] {
  const ganadores = new Set(ctx.ganadores.keys());
  const vinculos = vinculosDe(ctx.vinculos, filas, ganadores);
  const out = filas.map((f): Participante & { orden: number | null } => {
    const ruc = String(f.ruc);
    const empresa = esRuc20(ruc);
    const g = ctx.ganadores.get(ruc);
    const haySunat = !!(f.estado_sunat || f.condicion || f.fecha_alta || f.actividad);
    const antecedentes = (Array.isArray(f.antecedentes) ? f.antecedentes : [])
      .map((a) => ({ tipo: String((a as { tipo?: unknown })?.tipo ?? ""), severidad: severidad((a as { severidad?: unknown })?.severidad), n: Number((a as { n?: unknown })?.n) || 1 }))
      .filter((a) => a.tipo);
    return {
      ruc,
      nombre: texto(f.nombre),
      tipo: tipoDe(ruc, f.nombre),
      registrado: f.registrado === true,
      oferta: f.oferto ? { desde: dia(f.desde), hasta: dia(f.hasta), items: (f.items ?? []).map(Number).filter(Number.isFinite) } : null,
      gano: !!g,
      itemsGanados: g?.items ?? [],
      montoAdjudicado: g?.monto ?? null,
      sunat: haySunat
        ? {
            estado: texto(f.estado_sunat), condicion: texto(f.condicion), fechaAlta: dia(f.fecha_alta),
            mesesAlConvocar: mesesEntre(f.fecha_alta, ctx.fechaConvocatoria), actividad: texto(f.actividad),
            ...(empresa ? { domicilio: texto(f.domicilio), distrito: texto(f.distrito) } : {}),
          }
        : null,
      rnpVigente: typeof f.rnp_vigente === "boolean" ? f.rnp_vigente : null,
      historial: f.postulaciones != null
        ? {
            postulaciones: Number(f.postulaciones) || 0, ganadas: Number(f.ganadas) || 0, adjudicado: num(f.adjudicado),
            alta: Number(f.n_alta) || 0, media: Number(f.n_media) || 0, baja: Number(f.n_baja) || 0, antecedentes,
          }
        : null,
      vinculos: vinculos.get(ruc) ?? [],
      integrantes: personas(f.integrantes),
      orden: f.orden == null ? null : Number(f.orden),
    };
  });
  const grupo = (p: Participante) => (p.gano ? 0 : p.oferta ? 1 : 2);
  out.sort((a, b) => grupo(a) - grupo(b) || (a.orden ?? 1e9) - (b.orden ?? 1e9) || String(a.nombre).localeCompare(String(b.nombre)));
  return out.map(({ orden: _o, ...p }) => p);
}

// ─── Adjudicación y contrato ─────────────────────────────────────────────────

/** Una fila de conosce_adjudicaciones (la de contratos_detalle.ts, con referencial y fechas). */
export interface FilaAdjudicacion {
  item: number; ruc: string | null; proveedor: string | null; cantidad: number | null; montoPen: number | null; estado: string | null;
  referencial?: number | null; fechaBuenaPro?: string | null; fechaConsentimiento?: string | null; descripcion?: string | null;
}

export interface ItemAdjudicado {
  posicion: number;
  descripcion: string | null;
  /** Contratado, consentido o adjudicado (CONOSCE); sin CONOSCE, el estado del ítem en el OCDS. */
  estado: string | null;
  fuente: "conosce" | "ocds" | null;
  referencial: number | null;
  adjudicado: number | null;
  /** Lo adjudicado como porcentaje del valor referencial del ítem. */
  porcentaje: number | null;
  proveedores: (Persona & { monto: number | null })[];
  fechaBuenaPro: string | null;
  fechaConsentimiento: string | null;
  /** Los contratos (código CONOSCE) que cubren el ítem. */
  contratos: string[];
}

export interface ContratoFirmado {
  codigo: string | null;
  numero: string | null;
  items: number[];
  monto: number | null;
  adicional: number | null;
  reduccion: number | null;
  prorroga: number | null;
  complementario: number | null;
  moneda: string | null;
  firmado: string | null;
  vigenciaDesde: string | null;
  /** Hasta cuándo va; `vigenciaOriginal` es la fecha de antes si se amplió. */
  vigenciaHasta: string | null;
  vigenciaOriginal: string | null;
  publicado: string | null;
  url: string | null;
  contratista: Persona | null;
  fuente: "conosce" | "ocds";
}

/** Un contrato de CONOSCE ya agrupado en la base: sus ítems, su monto y la suma de sus modificaciones. */
export interface FilaContrato {
  codigo: string | null; numero: string | null; items: number[] | null; total: number | null; suma_items: number | null;
  adicional: number | null; reduccion: number | null; prorroga: number | null; complementario: number | null; moneda: string | null;
  ruc: string | null; url: string | null; publicado: string | null; firmado: string | null; desde: string | null; hasta: string | null; hasta_actualizada: string | null;
}

/**
 * Los contratos que CONOSCE registra para el proceso, uno por fila. CONOSCE da una fila por contrato, ítem y modificación,
 * con el monto del contrato repetido en cada una: se agrupa en la base (antes llegaban todas: 412 mil filas en un proceso
 * de 2,232 contratos, 15 s; auditoría del 2026-10-29). El monto del contrato es el mayor de sus filas y, sin él, lo de
 * cada ítem una vez; los adicionales, reducciones y prórrogas se suman (como el cruce `adicional`, migración 121). La
 * vigencia es la de todo el contrato: desde su primer inicio hasta el fin más tardío de sus ítems (el original y el
 * actualizado).
 */
export async function contratosConosce(codigo: string): Promise<FilaContrato[]> {
  if (!/^\d+$/.test(codigo)) return [];
  const r = await pool.query(
    `WITH f AS (
       SELECT COALESCE(codigo_contrato, n_cod_contrato) AS codigo, num_contrato AS numero, num_item AS item,
              COALESCE(codigo_contrato, n_cod_contrato, num_contrato, fecha_suscripcion::text || '-' || ruc_contratista) AS clave,
              monto_contratado_total, monto_contratado_item, monto_adicional, monto_reduccion, monto_prorroga, monto_complementario,
              moneda, ruc_contratista, url_contrato, fecha_publicacion, fecha_suscripcion, fecha_vigencia_inicial, fecha_vigencia_final,
              fecha_vigencia_fin_actualizada
         FROM conosce_contratos WHERE codigo_convocatoria = $1),
     ci AS (
       SELECT clave, max(codigo) AS codigo, max(numero) AS numero, item, max(monto_contratado_total) AS total,
              max(monto_contratado_item) AS monto_item, sum(monto_adicional) AS adicional, sum(monto_reduccion) AS reduccion,
              sum(monto_prorroga) AS prorroga, sum(monto_complementario) AS complementario, min(moneda) AS moneda,
              min(ruc_contratista) AS ruc, min(url_contrato) AS url, min(fecha_publicacion) AS publicado, min(fecha_suscripcion) AS firmado,
              min(fecha_vigencia_inicial) AS desde, max(fecha_vigencia_final) AS hasta, max(fecha_vigencia_fin_actualizada) AS hasta_actualizada
         FROM f GROUP BY clave, item)
     SELECT max(codigo) AS codigo, max(numero) AS numero, array_agg(item ORDER BY item) FILTER (WHERE item IS NOT NULL) AS items,
            max(total)::float AS total, sum(monto_item)::float AS suma_items, sum(adicional)::float AS adicional,
            sum(reduccion)::float AS reduccion, sum(prorroga)::float AS prorroga, sum(complementario)::float AS complementario,
            min(moneda) AS moneda, min(ruc) AS ruc, min(url) AS url, to_char(min(publicado), 'YYYY-MM-DD') AS publicado,
            to_char(min(firmado), 'YYYY-MM-DD') AS firmado, to_char(min(desde), 'YYYY-MM-DD') AS desde,
            to_char(max(hasta), 'YYYY-MM-DD') AS hasta, to_char(max(hasta_actualizada), 'YYYY-MM-DD') AS hasta_actualizada
       FROM ci GROUP BY clave
      ORDER BY min(firmado) NULLS LAST, max(codigo)`, [codigo]);
  return r.rows as FilaContrato[];
}

const maximo = (xs: (number | null)[]) => xs.reduce<number | null>((m, x) => (x == null ? m : m == null || x > m ? x : m), null);
/** La fecha más reciente de una lista (AAAA-MM-DD), o null. */
const ultima = (xs: unknown[]) => xs.map(dia).filter((x): x is string => !!x).sort().pop() ?? null;
const redondear1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Lo adjudicado ítem por ítem y los contratos firmados. Cada ítem del OCDS con lo que CONOSCE registra para su
 * posición (estado, monto, proveedor, fechas) y, si CONOSCE no lo trae, con la adjudicación vigente del OCDS que lo
 * cubre sola (una que cubre varios ítems no se reparte: su monto va en el total, no en un ítem). Los contratos: los de
 * CONOSCE y, sin ellos, los que trae el OCDS. CONOSCE da una fila por contrato, ítem y modificación: el monto contratado
 * se repite en cada una y los adicionales, reducciones y prórrogas se suman (como el cruce `adicional`, migración 121).
 */
export function armarContrato(e: {
  items: { id: string; posicion: number; descripcion: string | null; montoPen: number | null; estado: string | null }[];
  conosce: FilaAdjudicacion[];
  adjudicaciones: { id?: string | null; proveedorRuc: string | null; proveedor: string | null; items: string[]; montoPen: number | null; vigente?: boolean }[];
  filas: FilaContrato[];
  contratosOcds: unknown;
  nombres: Map<string, string | null>;
}): { items: ItemAdjudicado[]; firmados: ContratoFirmado[] } {
  const persona = (ruc: string | null | undefined, nombre?: string | null): Persona | null =>
    ruc ? { ruc, nombre: nombre ?? e.nombres.get(ruc) ?? null } : null;
  const vigentes = e.adjudicaciones.filter((a) => a.vigente !== false);
  const posiciones = new Set([...e.items.map((i) => i.posicion), ...e.conosce.map((k) => k.item).filter(Number.isFinite)]);
  // Índices de una pasada: buscar en cada ítem recorría todas las filas (un proceso con miles de ítems y 412 mil filas de
  // contratos de CONOSCE tardaba 15 s en armarse; auditoría del 2026-10-29).
  const itemPorPos = new Map<number, (typeof e.items)[number]>();
  for (const i of e.items) if (!itemPorPos.has(i.posicion)) itemPorPos.set(i.posicion, i);
  const conoscePorItem = new Map<number, FilaAdjudicacion[]>();
  for (const x of e.conosce) {
    const l = conoscePorItem.get(x.item);
    if (l) l.push(x);
    else conoscePorItem.set(x.item, [x]);
  }
  const contratosPorItem = new Map<number, Set<string>>();
  for (const f of e.filas) {
    if (!f.codigo) continue;
    for (const item of f.items ?? []) {
      const l = contratosPorItem.get(item);
      if (l) l.add(String(f.codigo));
      else contratosPorItem.set(item, new Set([String(f.codigo)]));
    }
  }
  const items: ItemAdjudicado[] = [...posiciones].sort((a, b) => a - b).map((pos) => {
    const it = itemPorPos.get(pos);
    const k = conoscePorItem.get(pos) ?? [];
    const sola = it ? vigentes.filter((a) => a.items.length === 1 && a.items[0] === it.id) : [];
    // Un referencial de 0 es que el registro no lo publica (como en la pestaña Ítems), no un valor de cero.
    const referencial = (it?.montoPen || null) ?? maximo(k.map((x) => x.referencial || null));
    const adjudicado = k.length
      ? k.reduce<number | null>((s, x) => (x.montoPen == null ? s : (s ?? 0) + x.montoPen), null)
      : sola.reduce<number | null>((s, a) => (a.montoPen == null ? s : (s ?? 0) + a.montoPen), null);
    const proveedores = k.length
      ? k.filter((x) => x.ruc).map((x) => ({ ...persona(x.ruc, x.proveedor)!, monto: x.montoPen }))
      : sola.filter((a) => a.proveedorRuc).map((a) => ({ ...persona(a.proveedorRuc, a.proveedor)!, monto: a.montoPen }));
    const estados = [...new Set(k.map((x) => texto(x.estado)).filter((x): x is string => !!x))];
    return {
      posicion: pos,
      descripcion: it?.descripcion ?? texto(k[0]?.descripcion) ?? null,
      estado: estados.length ? estados.join(", ") : it?.estado ?? null,
      fuente: estados.length ? "conosce" : it?.estado ? "ocds" : null,
      referencial,
      adjudicado,
      porcentaje: adjudicado != null && referencial ? redondear1((adjudicado / referencial) * 100) : null,
      proveedores,
      fechaBuenaPro: ultima(k.map((x) => x.fechaBuenaPro)),
      fechaConsentimiento: ultima(k.map((x) => x.fechaConsentimiento)),
      contratos: [...(contratosPorItem.get(pos) ?? [])],
    };
  });

  // Cada fila ya es un contrato (contratosConosce agrupa en la base).
  let firmados: ContratoFirmado[] = e.filas.map((f) => {
    const hasta = dia(f.hasta_actualizada) ?? dia(f.hasta);
    return {
      codigo: texto(f.codigo), numero: texto(f.numero),
      items: f.items ?? [],
      // El monto de todo el contrato (se repite en cada fila de CONOSCE); sin él, lo de cada ítem una vez.
      monto: num(f.total) ?? num(f.suma_items),
      adicional: num(f.adicional), reduccion: num(f.reduccion), prorroga: num(f.prorroga), complementario: num(f.complementario),
      moneda: texto(f.moneda),
      firmado: dia(f.firmado), vigenciaDesde: dia(f.desde), vigenciaHasta: hasta,
      vigenciaOriginal: dia(f.hasta) && hasta && dia(f.hasta) !== hasta ? dia(f.hasta) : null,
      publicado: dia(f.publicado), url: texto(f.url), contratista: persona(texto(f.ruc)), fuente: "conosce" as const,
    };
  });
  if (!firmados.length) {
    // El contrato del OCDS dice de qué adjudicación sale (`awardID`): su proveedor es el contratista.
    firmados = (Array.isArray(e.contratosOcds) ? e.contratosOcds : []).filter((k) => k && typeof k === "object").map((k) => {
      const o = k as Record<string, any>;
      const aw = e.adjudicaciones.find((a) => a.id != null && String(a.id) === String(o.awardID ?? ""));
      const items = (aw?.items ?? []).map((id) => e.items.find((i) => i.id === id)?.posicion).filter((x): x is number => x != null);
      return {
        codigo: texto(String(o.id ?? "")), numero: texto(o.title), items: [...new Set(items)].sort((a, b) => a - b), monto: num(o.value?.amount),
        adicional: null, reduccion: null, prorroga: null, complementario: null, moneda: texto(o.value?.currency),
        firmado: dia(o.dateSigned), vigenciaDesde: dia(o.period?.startDate), vigenciaHasta: dia(o.period?.endDate), vigenciaOriginal: null,
        publicado: null, url: null, contratista: aw ? persona(aw.proveedorRuc, aw.proveedor) : null, fuente: "ocds" as const,
      };
    });
  }
  return { items, firmados };
}

// ─── Cronograma ──────────────────────────────────────────────────────────────

export interface Hito {
  clave: "convocatoria" | "consultas" | "documentos" | "ofertas" | "buena_pro" | "consentimiento" | "contrato" | "vigencia";
  fecha: string;
  /** Fin del periodo (consultas, ofertas en varios días, vigencia del contrato). */
  hasta?: string | null;
  fuentes: ("ocds" | "conosce" | "seace")[];
  /** ofertas: cuántos presentaron oferta. */
  n?: number;
  /** contrato y vigencia: los números de contrato. */
  contratos?: string[];
  /** documentos: los que se publicaron ese día. */
  documentos?: { titulo: string | null; tipo: string | null }[];
}

// En un mismo día, los documentos después del hito: se publican tras la buena pro, la firma o la convocatoria que registran.
const ORDEN_HITO: Hito["clave"][] = ["convocatoria", "consultas", "ofertas", "buena_pro", "consentimiento", "contrato", "vigencia", "documentos"];

/**
 * Los hitos del proceso con fecha, en orden, cada uno con su fuente: la convocatoria y el plazo de consultas (OCDS), los
 * documentos publicados cada día (SEACE), las ofertas, la buena pro y su consentimiento (CONOSCE; la buena pro también
 * del OCDS), y la firma y la vigencia de cada contrato. Sólo lo que traen los registros: nada se estima.
 */
export function armarCronograma(e: {
  convocatoria: string | null;
  consultas: unknown;
  documentos: { tipo: string | null; titulo: string | null; fecha: string | null }[];
  ofertas: { desde: string | null; hasta: string | null; n: number } | null;
  conosce: { fechaBuenaPro?: string | null; fechaConsentimiento?: string | null }[];
  adjudicaciones: { fecha: string | null; vigente?: boolean }[];
  firmados: ContratoFirmado[];
}): Hito[] {
  const hitos = new Map<string, Hito>();
  const agregar = (h: Hito) => {
    const k = `${h.clave}|${h.fecha}|${h.hasta ?? ""}`;
    const x = hitos.get(k);
    if (!x) return void hitos.set(k, h);
    x.fuentes = [...new Set([...x.fuentes, ...h.fuentes])];
    if (h.contratos) x.contratos = [...new Set([...(x.contratos ?? []), ...h.contratos])];
    if (h.documentos) x.documentos = [...(x.documentos ?? []), ...h.documentos];
  };
  const conv = dia(e.convocatoria);
  if (conv) agregar({ clave: "convocatoria", fecha: conv, fuentes: ["ocds"] });
  const c = (e.consultas && typeof e.consultas === "object" ? e.consultas : {}) as Record<string, unknown>;
  const cDesde = dia(c.startDate), cHasta = dia(c.endDate);
  if (cDesde || cHasta) agregar({ clave: "consultas", fecha: (cDesde ?? cHasta)!, hasta: cDesde && cHasta && cHasta !== cDesde ? cHasta : null, fuentes: ["ocds"] });
  for (const d of e.documentos) {
    const f = dia(d.fecha);
    // Uno anterior a la convocatoria es de otra convocatoria del mismo procedimiento (el record las junta): sigue en la
    // pestaña Documentos, pero no es un hito de ésta.
    if (f && !(conv && f < conv)) agregar({ clave: "documentos", fecha: f, fuentes: ["seace"], documentos: [{ titulo: texto(d.titulo), tipo: texto(d.tipo) }] });
  }
  if (e.ofertas && dia(e.ofertas.desde)) {
    const hasta = dia(e.ofertas.hasta);
    agregar({ clave: "ofertas", fecha: dia(e.ofertas.desde)!, hasta: hasta && hasta !== dia(e.ofertas.desde) ? hasta : null, fuentes: ["conosce"], n: e.ofertas.n });
  }
  for (const k of e.conosce) {
    const bp = dia(k.fechaBuenaPro), cs = dia(k.fechaConsentimiento);
    if (bp) agregar({ clave: "buena_pro", fecha: bp, fuentes: ["conosce"] });
    if (cs) agregar({ clave: "consentimiento", fecha: cs, fuentes: ["conosce"] });
  }
  for (const a of e.adjudicaciones) {
    const f = dia(a.fecha);
    if (f && a.vigente !== false) agregar({ clave: "buena_pro", fecha: f, fuentes: ["ocds"] });
  }
  for (const k of e.firmados) {
    const numero = k.numero ?? k.codigo;
    const contratos = numero ? [numero] : [];
    const fuentes: Hito["fuentes"] = [k.fuente];
    if (k.firmado) agregar({ clave: "contrato", fecha: k.firmado, fuentes, contratos });
    if (k.vigenciaDesde) agregar({ clave: "vigencia", fecha: k.vigenciaDesde, hasta: k.vigenciaHasta, fuentes, contratos });
  }
  return [...hitos.values()].sort((a, b) => a.fecha.localeCompare(b.fecha) || ORDEN_HITO.indexOf(a.clave) - ORDEN_HITO.indexOf(b.clave));
}

/**
 * La fecha de la buena pro: la que leyeron los agentes; si no, la de CONOSCE (la más reciente de sus ítems); si no, la
 * de la primera adjudicación vigente del OCDS. Antes sólo la de los agentes: casi toda ficha decía «buena pro: sin
 * fecha» con CONOSCE sabiéndola.
 */
export function fechaBuenaProDe(
  analisis: string | null,
  conosce: { fechaBuenaPro?: string | null }[],
  adjudicaciones: { fecha: string | null; vigente?: boolean }[],
): { fecha: string | null; fuente: "analisis" | "conosce" | "ocds" | null } {
  if (dia(analisis)) return { fecha: dia(analisis), fuente: "analisis" };
  const k = conosce.map((x) => dia(x.fechaBuenaPro)).filter((x): x is string => !!x).sort().pop();
  if (k) return { fecha: k, fuente: "conosce" };
  const a = adjudicaciones.filter((x) => x.vigente !== false).map((x) => dia(x.fecha)).filter((x): x is string => !!x).sort()[0];
  return a ? { fecha: a, fuente: "ocds" } : { fecha: null, fuente: null };
}

// ─── Presupuesto ─────────────────────────────────────────────────────────────

export interface Presupuesto {
  cui: string | null;
  proyecto: string | null;
  /** La fuente de financiamiento que declara el registro ("Fondos Públicos", "Recursos Ordinarios"…). */
  fuente: string | null;
  /** El monto presupuestado que declara el registro OCDS (`planning.budget.amount`). */
  monto: number | null;
  /** De dónde salió el CUI: el registro OCDS (`planning.budget`) o la descripción del proceso, confirmado en el MEF. */
  cuiOrigen: "ocds" | "descripcion" | null;
  /** El proyecto en el presupuesto de la entidad, por año (MEF): lo que tiene para gastar y lo que ya devengó. */
  mef: { anio: number; nombre: string | null; pia: number | null; pim: number | null; devengado: number | null }[];
}

/**
 * El CUI (Código Único de Inversión, 7 dígitos) escrito en un texto del proceso: «CON CUI Nº 2655159», «Código Único de
 * Inversión N° 2233862». El SEACE escribe a veces «¿» por una vocal con tilde.
 */
export function cuiDeTexto(...textos: (string | null | undefined)[]): string | null {
  for (const t of textos) {
    if (!t) continue;
    const s = t.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();
    const m = /(?:\bC\.?\s?U\.?\s?I\b\.?|C.DIGO\s+.NICO\s+DE\s+INVERSI.N)[^\d]{0,14}(\d{7})(?!\d)/.exec(s);
    if (m) return m[1];
  }
  return null;
}

/**
 * El presupuesto del proyecto: lo que dice el OCDS (`planning.budget`: fuente, monto, proyecto y CUI) y, con el CUI, el
 * PIM y el devengado del MEF de ese proyecto en las unidades ejecutoras de la ENTIDAD (mef_entity_budget, por PK). Un CUI
 * leído de la descripción sólo cuenta si el MEF lo confirma en esa entidad. `anio`: el de la convocatoria.
 */
export async function presupuestoDe(budget: unknown, textos: (string | null | undefined)[], entidadRuc: string | null, anio: number | null): Promise<Presupuesto | null> {
  const b = (budget && typeof budget === "object" ? budget : {}) as Record<string, any>;
  const explicito = /^\d{6,7}$/.test(String(b.projectID ?? "").trim()) ? String(b.projectID).trim() : null;
  const cui = explicito ?? cuiDeTexto(...textos);
  const hayOcds = !!(explicito || texto(b.description) || num(b.amount?.amount));
  if (!cui && !hayOcds) return null;
  let mef: Presupuesto["mef"] = [];
  if (cui && entidadRuc) {
    const hoy = new Date().getUTCFullYear();
    const desde = Math.max(2015, Math.min(anio ?? hoy, hoy));
    const anios = Array.from({ length: hoy - desde + 2 }, (_, i) => desde + i);
    const r = await pool.query(
      `SELECT g.anio::int AS anio, max(g.nombre) AS nombre, sum(g.pia)::float AS pia, sum(g.pim)::float AS pim, sum(g.devengado)::float AS devengado
         FROM mef_entity_budget m
         JOIN mef_ejecutora_gasto g ON g.anio = ANY($3::smallint[]) AND g.sec_ejec = ANY(m.sec_ejecs) AND g.tipo = 'proyecto' AND g.codigo = $2
        WHERE m.entidad_ruc = $1
        GROUP BY g.anio ORDER BY g.anio`, [entidadRuc, cui, anios]);
    mef = r.rows.map((x) => ({ anio: Number(x.anio), nombre: texto(x.nombre), pia: num(x.pia), pim: num(x.pim), devengado: num(x.devengado) }));
  }
  // Un CUI leído de la descripción que el MEF no confirma en la entidad no se muestra.
  const confirmado = explicito ?? (mef.length ? cui : null);
  if (!confirmado && !hayOcds) return null;
  return {
    cui: confirmado,
    proyecto: texto(b.project) ?? mef.find((x) => x.nombre)?.nombre ?? null,
    fuente: texto(b.description),
    monto: num(b.amount?.amount),
    cuiOrigen: explicito ? "ocds" : confirmado ? "descripcion" : null,
    mef,
  };
}

/** El SQL de la ruta para las partes con papel `tenderer` (record completo: `parties`; recortado: `partes`). */
export const PARTES_TENDERER_SQL = `(SELECT jsonb_agg(jsonb_build_object('id', p->>'id', 'name', p->>'name'))
   FROM jsonb_array_elements(${LISTA_JSON("COALESCE(c.ocds_payload->'parties', c.ocds_payload->'partes')")}) p
  WHERE p->'roles' ? 'tenderer')`;

/** Los contratos del payload sin ítems ni documentos (los documentos ya van en `documentos`). */
export const CONTRATOS_OCDS_SQL = `(SELECT jsonb_agg(jsonb_build_object('id', k->'id', 'awardID', k->'awardID', 'title', k->'title', 'status', k->'status',
     'dateSigned', k->'dateSigned', 'period', k->'period', 'value', k->'value'))
   FROM jsonb_array_elements(${LISTA_JSON("c.ocds_payload->'contracts'")}) k)`;
