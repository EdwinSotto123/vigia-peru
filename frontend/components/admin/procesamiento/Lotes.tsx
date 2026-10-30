"use client";

import { cn } from "@/lib/utils";
import { Partes } from "@/components/ui/Partes";
import { Ayuda } from "@/components/patrones/Ayuda";
import { DataTable, EmptyState, type Columna } from "@/components/admin/ui";
import { type ProcAdmin, type Conteo, conteoVacio, ESTADO_UI, hace, ORDEN_BARRA, TOPE_LISTA } from "./tipos";
// ── Los lotes ─────────────────────────────────────────────────────────────

export interface Lote {
  codigo: string;
  financiador: string | null;
  zonas: string[];
  total: number;
  c: Conteo;
  ultimo: number;
}

export function agruparLotes(rows: ProcAdmin[]): Lote[] {
  const m = new Map<string, Lote>();
  for (const r of rows) {
    const k = r.contribucionCodigo;
    if (!k) continue;
    const l = m.get(k) ?? { codigo: k, financiador: r.financiador, zonas: [], total: 0, c: conteoVacio(), ultimo: 0 };
    l.total += 1;
    l.c[r.estado] += 1;
    if (r.zona && !l.zonas.includes(r.zona)) l.zonas.push(r.zona);
    const t = new Date(r.latidoAt ?? r.finalizadoAt ?? r.encoladoAt ?? 0).getTime();
    if (t > l.ultimo) l.ultimo = t;
    m.set(k, l);
  }
  // Primero los que todavía tienen trabajo; dentro de cada grupo, el de movimiento más reciente
  // (antes se ordenaba por código y `ultimo` se calculaba sin usarse).
  const activo = (l: Lote) => l.c.encolado + l.c.procesando + l.c.esperando_documentos > 0;
  return [...m.values()].sort((a, b) => Number(activo(b)) - Number(activo(a)) || b.ultimo - a.ultimo || b.codigo.localeCompare(a.codigo));
}

/** "Lima, Callao y 3 más": las zonas de un lote en una línea, sin perder la cuenta de las que no se nombran. */
const zonasDe = (l: Lote) => (l.zonas.length > 2 ? `${l.zonas.slice(0, 2).join(", ")} y ${l.zonas.length - 2} más` : l.zonas.join(", "));

/** Cuánto de cada estado tiene el lote, en los colores del flujo. */
function BarraLote({ l }: { l: Lote }) {
  return (
    <span className="flex h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-paperDeep" aria-hidden>
      {ORDEN_BARRA.map((e) => (l.c[e] > 0 ? <span key={e} className={ESTADO_UI[e].barra} style={{ width: `${(l.c[e] / l.total) * 100}%` }} /> : null))}
    </span>
  );
}

/** Lo que todavía no se leyó, por estado; o que ya está todo. */
function Pendiente({ l }: { l: Lote }) {
  const abiertos = ORDEN_BARRA.filter((e) => e !== "procesado" && l.c[e] > 0);
  if (!abiertos.length) return <span className="text-rotulo text-mossTexto">todo leído</span>;
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-rotulo text-inkSoft">
      {abiertos.map((e) => (
        <span key={e} className="inline-flex items-center gap-1 whitespace-nowrap">
          <span className={cn("h-1.5 w-1.5 rounded-full", ESTADO_UI[e].punto)} aria-hidden />
          {l.c[e]} {ESTADO_UI[e].corto}
        </span>
      ))}
    </span>
  );
}

/**
 * Los lotes (un aporte validado o un lote a nombre de Vigía) en una lista compacta y paginada: antes eran tarjetas
 * de 100 px, tres a la vista y «Ver los 11» para el resto. Elegir uno filtra la lista de contratos por ese lote
 * (la página pasa a la pestaña Contratos); el elegido queda marcado.
 */
export function Lotes({
  lotes,
  activo,
  onElegir,
  incompletos = false,
}: {
  /** null = la lista de contratos todavía no llegó. */
  lotes: Lote[] | null;
  activo: string | null;
  onElegir: (codigo: string) => void;
  /** La lista de la que salen vino con tope: un lote puede tener más contratos de los que se cuentan acá. */
  incompletos?: boolean;
}) {
  const columnas: Columna<Lote>[] = [
    {
      clave: "lote",
      titulo: "Lote",
      principal: true,
      className: "max-w-[28rem]",
      celda: (l) => (
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 font-mono text-rotulo font-semibold text-ink">{l.codigo}</span>
          <span className="truncate text-rotulo text-mute">
            <Partes partes={[l.financiador, zonasDe(l)]} />
          </span>
        </span>
      ),
    },
    {
      clave: "leidos",
      titulo: "Leídos",
      celda: (l) => (
        <span className="flex items-center gap-2 whitespace-nowrap text-rotulo text-inkSoft">
          <BarraLote l={l} />
          <span>
            <span className="font-mono text-ink">{l.c.procesado}</span> de {l.total}
          </span>
        </span>
      ),
    },
    { clave: "pendiente", titulo: "Pendiente", celda: (l) => <Pendiente l={l} /> },
    {
      clave: "movimiento",
      titulo: "Movimiento",
      className: "whitespace-nowrap text-rotulo text-mute",
      celda: (l) => (l.ultimo ? hace(new Date(l.ultimo).toISOString()) : null) ?? "sin movimiento",
    },
  ];

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="text-meta text-mute">Elige un lote para ver sus contratos.</span>
        <Ayuda titulo="¿Cómo se cuentan?">
          Un lote es lo que se pidió leer junto: un aporte validado o un lote procesado a nombre de Vigía. Primero van los que todavía tienen trabajo y
          después el de movimiento más reciente.
          {incompletos &&
            ` Se cuentan sólo los contratos de la lista, que trae los ${TOPE_LISTA} con movimiento más reciente: a un lote grande o antiguo le pueden faltar contratos aquí, y «todo leído» es lo de la lista.`}
        </Ayuda>
      </div>
      <DataTable
        className="mt-3"
        etiqueta="Lotes"
        columnas={columnas}
        filas={lotes}
        claveFila={(l) => l.codigo}
        onFila={(l) => onElegir(l.codigo)}
        filaActiva={(l) => l.codigo === activo}
        cargando={lotes === null}
        porPagina={15}
        compactoMovil
        vacio={<EmptyState compacto titulo="Todavía no hay lotes en la lista" descripcion="Aparecen al validar un aporte o al procesar un lote a nombre de Vigía." />}
      />
    </>
  );
}
