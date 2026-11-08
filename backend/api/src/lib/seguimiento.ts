/**
 * El seguimiento de Gobserva Licitaciones (2026-11-07): lo guardado (licitaciones y contratos menores) con lo que se
 * sabe hoy de cada uno — la entidad, el valor referencial, la región, la etapa y sus plazos — para el tablero
 * (Seguimiento) y el calendario de la cuenta. En Gobserva Empleo (2026-11-07), lo mismo con las plazas CAS guardadas:
 * el sueldo como valor, la región de su ubicación y dos plazos, cuándo abre y cuándo cierra la postulación (el último
 * día, a las 23:59 de Lima: SERVIR sólo publica el día).
 *
 * Plazos que se conocen: de una licitación, la convocatoria, el fin de consultas y observaciones (enquiryPeriod del
 * OCDS) y la buena pro (CONOSCE); de un contrato menor, el fin de consultas y el cierre de la cotización (prod6). La
 * presentación de ofertas no viene en el OCDS (su tenderPeriod repite la convocatoria): la ficha enlaza al cronograma
 * del SEACE.
 */
import { pool } from "./db.js";

export type ClavePlazo = "convocatoria" | "consultas" | "buena_pro" | "cierre" | "abre" | "postulacion";

export interface Plazo {
  clave: ClavePlazo;
  etiqueta: string;
  fecha: string;
}

export interface ItemSeguimiento {
  tipo: "oportunidad" | "menor" | "plaza";
  ref: string;
  titulo: string | null;
  estado: string;
  nota: string | null;
  creado: string;
  actualizado: string;
  entidad: string | null;
  entidadRuc: string | null;
  /** El valor referencial (licitación) o el sueldo mensual (plaza). */
  valor: number | null;
  region: string | null;
  /** «convocada», «adjudicada»… (licitación), «Vigente», «Cerrado»… (contrato menor) o «abierta», «cerrada» (plaza). */
  etapa: string | null;
  plazos: Plazo[];
  /** El próximo plazo que todavía no pasó (null si ya pasaron todos). */
  proximo: Plazo | null;
}

export const ETIQUETA_PLAZO: Record<ClavePlazo, string> = {
  convocatoria: "Convocatoria",
  consultas: "Fin de consultas y observaciones",
  buena_pro: "Buena pro",
  cierre: "Cierra la cotización",
  abre: "Abre la postulación",
  postulacion: "Cierra la postulación",
};

/**
 * Los plazos con fecha válida, en orden, y el próximo que no pasó. En un contrato menor el fin de consultas suele ser
 * el mismo minuto que el cierre de la cotización: entonces queda sólo el cierre (dos avisos del mismo plazo confunden).
 */
export function ordenarPlazos(crudos: { clave: ClavePlazo; fecha: string | Date | null | undefined }[], ahora = new Date()): { plazos: Plazo[]; proximo: Plazo | null } {
  const validos = crudos
    .map((p) => ({ clave: p.clave, fecha: p.fecha ? new Date(p.fecha) : null }))
    .filter((p): p is { clave: ClavePlazo; fecha: Date } => !!p.fecha && !Number.isNaN(p.fecha.getTime()));
  const cierre = validos.find((p) => p.clave === "cierre")?.fecha.getTime();
  const plazos = validos
    .filter((p) => !(p.clave === "consultas" && cierre !== undefined && Math.abs(p.fecha.getTime() - cierre) < 60_000))
    .sort((a, b) => a.fecha.getTime() - b.fecha.getTime())
    .map((p) => ({ clave: p.clave, etiqueta: ETIQUETA_PLAZO[p.clave], fecha: p.fecha.toISOString() }));
  const proximo = plazos.find((p) => new Date(p.fecha).getTime() >= ahora.getTime()) ?? null;
  return { plazos, proximo };
}

interface Fila {
  tipo: "oportunidad" | "menor" | "plaza";
  ref: string;
  titulo: string | null;
  estado: string;
  nota: string | null;
  creado: string;
  actualizado: string;
  entidad: string | null;
  entidad_ruc: string | null;
  valor: number | null;
  region: string | null;
  etapa: string | null;
  convocatoria: string | null;
  consultas: string | null;
  buena_pro: string | null;
  cierre: string | null;
  abre?: string | null;
  postulacion?: string | null;
}

/** La región de una plaza desde su ubicación («LA LIBERTAD - TRUJILLO» → «LA LIBERTAD»), como la lista de Empleo. */
const REGION_PLAZA = `NULLIF(mef_norm(split_part(s.ubicacion, ' - ', 1)), '')`;

/** Las plazas CAS guardadas en Empleo, con su sueldo, su región y los días en que abre y cierra la postulación. */
const SQL_PLAZAS = `WITH g AS (
       SELECT tipo, ref, titulo, estado, nota, creado_at, actualizado_at
         FROM gobserva_guardados
        WHERE firebase_uid = $1 AND producto = 'empleo' AND tipo = 'plaza'
        ORDER BY creado_at DESC LIMIT 3000
     )
     SELECT g.tipo, g.ref, COALESCE(g.titulo, s.titulo) AS titulo, g.estado, g.nota,
            to_json(g.creado_at)#>>'{}' AS creado, to_json(g.actualizado_at)#>>'{}' AS actualizado,
            s.entidad, s.entidad_ruc::text AS entidad_ruc, NULLIF(s.remuneracion, 0)::float AS valor,
            ${REGION_PLAZA} AS region,
            CASE WHEN s.fecha_fin >= (now() AT TIME ZONE 'America/Lima')::date THEN 'abierta' ELSE 'cerrada' END AS etapa,
            NULL::text AS convocatoria, NULL::text AS consultas, NULL::text AS buena_pro, NULL::text AS cierre,
            to_json(s.fecha_inicio::timestamp AT TIME ZONE 'America/Lima')#>>'{}' AS abre,
            to_json((s.fecha_fin + time '23:59') AT TIME ZONE 'America/Lima')#>>'{}' AS postulacion
       FROM g LEFT JOIN servir_convocatoria s ON s.aviso = CASE WHEN g.ref ~ '^[0-9]{1,9}$' THEN g.ref::int END`;

/** Lo guardado en un producto (Licitaciones o Empleo) con su estado de hoy (hasta 3000, lo más reciente primero). */
export async function seguimiento(uid: string, ahora = new Date(), producto: "licitaciones" | "empleo" = "licitaciones"): Promise<ItemSeguimiento[]> {
  const r = producto === "empleo" ? await pool.query<Fila>(SQL_PLAZAS, [uid]) : await pool.query<Fila>(
    `WITH g AS (
       SELECT tipo, ref, titulo, estado, nota, creado_at, actualizado_at
         FROM gobserva_guardados
        WHERE firebase_uid = $1 AND producto = 'licitaciones' AND tipo IN ('oportunidad', 'menor')
        ORDER BY creado_at DESC LIMIT 3000
     )
     SELECT g.tipo, g.ref, COALESCE(g.titulo, c.objeto) AS titulo, g.estado, g.nota,
            to_json(g.creado_at)#>>'{}' AS creado, to_json(g.actualizado_at)#>>'{}' AS actualizado,
            e.nombre AS entidad, c.entidad_ruc::text AS entidad_ruc, NULLIF(c.cuantia_referencial, 0)::float AS valor,
            left(c.ubigeo_zona, 2) AS region, c.etapa,
            to_json(c.fecha_convocatoria::timestamp AT TIME ZONE 'America/Lima')#>>'{}' AS convocatoria,
            c.ocds_payload->'tender'->'enquiryPeriod'->>'endDate' AS consultas,
            to_json(c.fecha_buena_pro::timestamp AT TIME ZONE 'America/Lima')#>>'{}' AS buena_pro,
            NULL::text AS cierre
       FROM g JOIN convocatorias c ON c.ocid = g.ref
       LEFT JOIN entidades e ON e.ruc = c.entidad_ruc
      WHERE g.tipo = 'oportunidad'
     UNION ALL
     SELECT g.tipo, g.ref, COALESCE(g.titulo, x.descripcion), g.estado, g.nota,
            to_json(g.creado_at)#>>'{}', to_json(g.actualizado_at)#>>'{}',
            x.entidad, x.entidad_ruc, NULL::float, x.departamentos[1], x.estado,
            to_json(x.fec_publica)#>>'{}', to_json(x.consultas_hasta)#>>'{}', NULL::text, to_json(x.fec_fin_cotizacion)#>>'{}'
       FROM g JOIN seace_cotizacion x ON x.id_prod6::text = g.ref
      WHERE g.tipo = 'menor'`,
    [uid],
  );
  return r.rows
    .map((f) => {
      const { plazos, proximo } = ordenarPlazos(
        [
          { clave: "convocatoria", fecha: f.convocatoria },
          { clave: "consultas", fecha: f.consultas },
          { clave: "buena_pro", fecha: f.buena_pro },
          { clave: "cierre", fecha: f.cierre },
          { clave: "abre", fecha: f.abre },
          { clave: "postulacion", fecha: f.postulacion },
        ],
        ahora,
      );
      return {
        tipo: f.tipo, ref: f.ref, titulo: f.titulo, estado: f.estado, nota: f.nota, creado: f.creado, actualizado: f.actualizado,
        entidad: f.entidad, entidadRuc: f.entidad_ruc, valor: f.valor, region: f.region, etapa: f.etapa, plazos, proximo,
      };
    })
    .sort((a, b) => b.creado.localeCompare(a.creado));
}
