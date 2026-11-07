/**
 * El seguimiento de Gobserva Licitaciones (2026-11-07): lo guardado (licitaciones y contratos menores) con lo que se
 * sabe hoy de cada uno — la entidad, el valor referencial, la región, la etapa y sus plazos — para el tablero
 * (Seguimiento) y el calendario de la cuenta.
 *
 * Plazos que se conocen: de una licitación, la convocatoria, el fin de consultas y observaciones (enquiryPeriod del
 * OCDS) y la buena pro (CONOSCE); de un contrato menor, el fin de consultas y el cierre de la cotización (prod6). La
 * presentación de ofertas no viene en el OCDS (su tenderPeriod repite la convocatoria): la ficha enlaza al cronograma
 * del SEACE.
 */
import { pool } from "./db.js";

export type ClavePlazo = "convocatoria" | "consultas" | "buena_pro" | "cierre";

export interface Plazo {
  clave: ClavePlazo;
  etiqueta: string;
  fecha: string;
}

export interface ItemSeguimiento {
  tipo: "oportunidad" | "menor";
  ref: string;
  titulo: string | null;
  estado: string;
  nota: string | null;
  creado: string;
  actualizado: string;
  entidad: string | null;
  entidadRuc: string | null;
  valor: number | null;
  region: string | null;
  /** «convocada», «adjudicada»… (licitación) o «Vigente», «Cerrado»… (contrato menor). */
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
  tipo: "oportunidad" | "menor";
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
}

/** Lo guardado en Licitaciones con su estado de hoy (hasta 3000, lo más reciente primero). */
export async function seguimiento(uid: string, ahora = new Date()): Promise<ItemSeguimiento[]> {
  const r = await pool.query<Fila>(
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
