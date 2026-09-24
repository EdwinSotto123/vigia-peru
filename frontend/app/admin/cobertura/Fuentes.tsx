"use client";

import { Badge, DataTable, Expandable, KeyValue, SinDato, fmtFechaHora, fmtNum, hace, type Columna, type Tone } from "@/components/admin/ui";

// ── Fuentes externas: lo que no viene del SEACE ────────────────────────────

export interface Fuente { fuente: string; tabla: string | null; cargas: number; cargasConError: number; filas: number | string; ultimaClave: string | null; ultimaDescarga: string | null; ultimaCarga: string | null; ultimoError: string | null }

type Donde = "nube" | "peru" | "manual";
const DONDE: Record<Donde, { label: string; tono: Tone; ayuda: string }> = {
  nube: { label: "En la nube", tono: "ok", ayuda: "tarea programada en Google Cloud" },
  peru: { label: "Conexión peruana", tono: "pending", ayuda: "la fuente bloquea a la nube: corre desde el servidor de Lima" },
  manual: { label: "A mano", tono: "muted", ayuda: "alguien la exporta del portal y la carga" },
};

/**
 * Los pipelines de backend/scrapers (catálogo y agenda en su README). `anota` =
 * el pipeline registra cada carga en `datasets_cargas`; los que no, no tienen
 * cómo decir aquí cuándo corrieron, y la tabla lo dice en vez de dejar un hueco.
 */
const FUENTES: Record<string, { nombre: string; cadencia: string; donde: Donde; cruce: string; anota: boolean }> = {
  oece_ocds: { nombre: "Convocatorias del OECE", cadencia: "Diaria", donde: "peru", cruce: "la cola de contratos de cada distrito", anota: false },
  pnda_sancionados: { nombre: "Proveedores sancionados (OECE)", cadencia: "Semanal, domingos", donde: "nube", cruce: "postores con sanción vigente", anota: false },
  pnda_visitas: { nombre: "Visitas a entidades (datos abiertos)", cadencia: "Días 1 y 15", donde: "nube", cruce: "visitas de postores antes de la convocatoria", anota: true },
  portal_visitas_manual: { nombre: "Visitas: exportación del portal de la PCM", cadencia: "Cuando se exporta", donde: "manual", cruce: "lo mismo, pero de todas las entidades", anota: true },
  pnda_dji: { nombre: "Declaraciones de intereses (Contraloría)", cadencia: "Mensual, día 5", donde: "nube", cruce: "empleos previos y parientes de funcionarios", anota: true },
  jne_infogob: { nombre: "Autoridades vigentes (JNE)", cadencia: "Mensual, día 5", donde: "nube", cruce: "alcalde o gobernador y su organización política", anota: true },
  onpe_claridad: { nombre: "Aportantes de campaña (ONPE Claridad)", cadencia: "Mensual", donde: "peru", cruce: "aportantes que también son postores o socios", anota: true },
  pnda_oece: { nombre: "Datasets del OECE (ofertantes, consorcios)", cadencia: "Mensual, día 1", donde: "nube", cruce: "quién se presentó y en qué consorcio", anota: false },
  mef_presupuesto: { nombre: "Presupuesto público (MEF)", cadencia: "Mensual, día 12", donde: "nube", cruce: "presupuesto y gasto de cada entidad", anota: false },
};

/** Cuántas fuentes muestra la tabla: las conocidas más cualquiera nueva que aparezca en la base. */
export const totalFuentes = (fuentes: Fuente[]) => new Set([...Object.keys(FUENTES), ...fuentes.map((f) => f.fuente)]).size;

interface Fila { clave: string; meta: (typeof FUENTES)[string]; f: Fuente | null }

function estadoFuente({ f, meta }: Fila): { label: string; tono: Tone; pista: string } {
  if (!f) return meta.anota ? { label: "Sin cargas", tono: "muted", pista: "todavía no se cargó nunca" } : { label: "Sin registro", tono: "muted", pista: "este proceso no anota sus cargas" };
  if (f.cargasConError > 0) return { label: "Con errores", tono: "danger", pista: `${fmtNum(f.cargasConError)} de ${fmtNum(f.cargas)} cargas fallaron` };
  return { label: "Sin errores", tono: "ok", pista: `${fmtNum(f.cargas)} ${f.cargas === 1 ? "carga" : "cargas"}` };
}

export function Fuentes({ fuentes }: { fuentes: Fuente[] }) {
  // Todas las conocidas + cualquiera nueva que aparezca en la base.
  const claves = Array.from(new Set([...Object.keys(FUENTES), ...fuentes.map((f) => f.fuente)]));
  const filas: Fila[] = claves.map((k) => ({
    clave: k,
    meta: FUENTES[k] ?? { nombre: k, cadencia: "Sin agenda conocida", donde: "manual", cruce: "sin descripción", anota: true },
    f: fuentes.find((x) => x.fuente === k) ?? null,
  }));
  // Primero las que tienen algo que decir (errores), luego las que cargan, al final las mudas.
  const orden = (x: Fila) => (x.f?.cargasConError ? 0 : x.f ? 1 : 2);
  filas.sort((a, b) => orden(a) - orden(b));

  const columnas: Columna<Fila>[] = [
    {
      clave: "fuente",
      titulo: "Fuente",
      principal: true,
      className: "max-w-[300px]",
      celda: ({ meta }) => (
        <>
          <span className="block font-medium text-ink">{meta.nombre}</span>
          <span className="block text-[11.5px] text-mute">Sirve para cruzar {meta.cruce}</span>
        </>
      ),
    },
    {
      clave: "donde",
      titulo: "Dónde corre",
      celda: ({ meta }) => (
        <span title={DONDE[meta.donde].ayuda}>
          <Badge tono={DONDE[meta.donde].tono} punto>{DONDE[meta.donde].label}</Badge>
          <span className="mt-0.5 block text-[11px] text-mute">{meta.cadencia}</span>
        </span>
      ),
    },
    { clave: "filas", titulo: "Filas", alinear: "derecha", celda: ({ f }) => (f ? fmtNum(f.filas) : <span className="font-sans text-[12px] text-mute">—</span>) },
    {
      clave: "ultima",
      titulo: "Última carga",
      className: "whitespace-nowrap text-[12px]",
      celda: ({ f }) => (f?.ultimaCarga ? <span className="text-ink" title={fmtFechaHora(f.ultimaCarga) ?? undefined}>{hace(f.ultimaCarga)}</span> : <SinDato texto="Sin dato" />),
    },
    {
      clave: "estado",
      titulo: "Estado",
      celda: (x) => {
        const e = estadoFuente(x);
        return (
          <>
            <Badge tono={e.tono}>{e.label}</Badge>
            <span className="mt-0.5 block text-[11px] text-mute">{e.pista}</span>
          </>
        );
      },
    },
  ];

  const conCargas = filas.filter((x) => x.f).length;

  return (
    <div className="space-y-3">
      <DataTable etiqueta="Fuentes externas" columnas={columnas} filas={filas} claveFila={(x) => x.clave} />
      <Expandable variante="linea" resumen={`Detalle técnico de las cargas (${conCargas} fuentes con registro)`}>
        <div className="grid gap-3 md:grid-cols-2">
          {filas.filter((x) => x.f).map(({ clave, f, meta }) => (
            <div key={clave} className="rounded-xl border border-line bg-paper p-3">
              <p className="text-[13px] font-medium text-ink">{meta.nombre}</p>
              <KeyValue
                className="mt-2"
                items={[
                  { etiqueta: "Pipeline → tabla", valor: `${clave}${f!.tabla ? ` → ${f!.tabla}` : ""}`, mono: true, completo: true },
                  { etiqueta: "Último archivo o periodo", valor: f!.ultimaClave, mono: true },
                  { etiqueta: "Descargado de la fuente", valor: fmtFechaHora(f!.ultimaDescarga) },
                  { etiqueta: "Último error", valor: f!.ultimoError ?? <span className="text-mute">Ninguno</span>, mono: !!f!.ultimoError, completo: true },
                ]}
              />
            </div>
          ))}
        </div>
      </Expandable>
    </div>
  );
}
