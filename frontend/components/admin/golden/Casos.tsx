"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, Search, X } from "lucide-react";
import { Badge, DataTable, EmptyState, Panel, SinDato, claseBoton, plural, type Columna, type Tone } from "@/components/admin/ui";
import { paraBuscar, coincide } from "@/lib/formato";
import { useAdmin } from "@/lib/useAdmin";
import { ErrorGolden, SelectorConjunto } from "./comunes";
import { QUE_MIDE, fmtEjecutada, nombreRegimen, nombreRegla, type Caso, type Conjunto, type Esperado } from "./tipos";

/**
 * Pestaña «Casos»: los casos de un conjunto con lo que la referencia espera de cada regla (sólo lectura). Se busca por
 * OCID o por texto (título, nota, nombre de regla, evidencia); el clic en una fila abre lo esperado regla por regla.
 */

const ESTADO: Record<Esperado["estado"], { nombre: string; tono: Tone }> = {
  disparada: { nombre: "Debe dispararse", tono: "warn" },
  no_disparada: { nombre: "No debe dispararse", tono: "neutral" },
  sin_dato: { nombre: "Sin dato para decidir", tono: "muted" },
};

const ORDEN_ESTADO: Esperado["estado"][] = ["disparada", "no_disparada", "sin_dato"];

export function CasosGolden({ conjuntos, conjunto, onConjunto }: { conjuntos: Conjunto[]; conjunto: string; onConjunto: (clave: string) => void }) {
  const { data, error, isLoading, mutate } = useAdmin<{ data: Caso[] }>(conjunto ? `/golden/casos?conjunto=${encodeURIComponent(conjunto)}` : null);
  const [q, setQ] = useState("");
  const [abierto, setAbierto] = useState<string | null>(null);
  useEffect(() => setAbierto(null), [conjunto]);
  const elegido = conjuntos.find((c) => c.clave === conjunto);
  const esContrato = (elegido?.queMide ?? "banderas") !== "recuperacion";
  const que = QUE_MIDE[elegido?.queMide ?? "banderas"] ?? QUE_MIDE.banderas;

  const casos = data?.data;
  const indice = useMemo(
    () =>
      (casos ?? []).map((c) =>
        paraBuscar(
          [c.caso, c.titulo, c.perfil, c.nota, nombreRegimen(c.regimen), ...Object.entries(c.esperado ?? {}).flatMap(([regla, e]) => [regla, nombreRegla(regla), e?.evidencia])].filter(Boolean).join(" "),
        ),
      ),
    [casos],
  );
  const consulta = paraBuscar(q);
  const filas = useMemo(() => (casos && consulta ? casos.filter((_, i) => coincide(indice[i], consulta)) : casos), [casos, indice, consulta]);
  const sel = abierto ? casos?.find((c) => c.caso === abierto) ?? null : null;

  const columnas: Columna<Caso>[] = [
    {
      clave: "caso",
      titulo: que.casos === "preguntas" ? "Pregunta" : "Contrato",
      principal: true,
      celda: (c) => (
        <span className="block min-w-0">
          <span className="block break-all font-mono text-meta font-semibold text-ink">{c.caso}</span>
          {c.titulo && <span className="mt-0.5 block text-meta leading-snug text-inkSoft text-pretty">{c.titulo}</span>}
        </span>
      ),
    },
    { clave: "fecha", titulo: "Fecha", className: "whitespace-nowrap", celda: (c) => fmtEjecutada(c.fecha) ?? <SinDato texto="Sin fecha" /> },
    { clave: "regimen", titulo: "Régimen", className: "whitespace-nowrap", celda: (c) => nombreRegimen(c.regimen) ?? <SinDato /> },
    { clave: "perfil", titulo: "Perfil", celda: (c) => c.perfil ?? <SinDato /> },
    {
      clave: "esperado",
      titulo: "Lo esperado",
      anchoCompletoMovil: true,
      celda: (c) => {
        const e = Object.values(c.esperado ?? {});
        const n = (estado: Esperado["estado"]) => e.filter((x) => x?.estado === estado).length;
        if (!e.length) return <SinDato texto="Sin reglas esperadas" />;
        return (
          <span className="flex flex-wrap items-center gap-1.5">
            {n("disparada") > 0 && <Badge tono="warn">{plural(n("disparada"), "debe dispararse", "deben dispararse")}</Badge>}
            {n("no_disparada") > 0 && <Badge>{plural(n("no_disparada"), "no debe", "no deben")}</Badge>}
            {n("sin_dato") > 0 && <Badge tono="muted">{plural(n("sin_dato"), "sin dato", "sin dato")}</Badge>}
          </span>
        );
      },
    },
  ];

  return (
    <div className="space-y-3">
      <SelectorConjunto conjuntos={conjuntos} valor={conjunto} onCambiar={onConjunto} />
      <form role="search" onSubmit={(e) => e.preventDefault()} className="relative max-w-xl">
        <label htmlFor="buscar-casos" className="sr-only">
          Buscar un caso por OCID o por texto
        </label>
        <Search size={16} aria-hidden className="absolute left-3.5 top-1/2 -translate-y-1/2 text-mute" />
        <input
          id="buscar-casos"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por OCID, título, regla o evidencia"
          autoComplete="off"
          className="h-11 w-full rounded-xl border border-line bg-paperSoft pl-10 pr-3 text-destacado placeholder:text-mute focus:border-granate focus:bg-paper focus:outline-none focus:ring-2 focus:ring-granate/20"
        />
      </form>
      <ErrorGolden error={error} titulo="No se pudieron leer los casos" onReintentar={() => mutate()} />

      {sel && (
        <Panel
          titulo={<span className="break-all font-mono">{sel.caso}</span>}
          descripcion={sel.titulo ?? undefined}
          acciones={
            <>
              {esContrato && (
                <Link href={`/app/contratos/${encodeURIComponent(sel.caso)}`} target="_blank" className={claseBoton("secundario")}>
                  Abrir el contrato <ExternalLink size={13} aria-hidden />
                  <span className="sr-only">(se abre en otra pestaña)</span>
                </Link>
              )}
              <button type="button" onClick={() => setAbierto(null)} className={claseBoton("fantasma")} aria-label="Cerrar el caso">
                <X size={14} aria-hidden /> Cerrar
              </button>
            </>
          }
        >
          {sel.nota && <p className="mb-3 whitespace-pre-wrap break-words text-meta leading-relaxed text-inkSoft">Nota: {sel.nota}</p>}
          <EsperadoPorRegla esperado={sel.esperado} />
        </Panel>
      )}

      {!error && (
        <DataTable
          columnas={columnas}
          filas={filas}
          claveFila={(c) => c.caso}
          etiqueta={`Casos de ${elegido?.nombre ?? "este conjunto"}`}
          onFila={(c) => setAbierto((a) => (a === c.caso ? null : c.caso))}
          filaActiva={(c) => c.caso === abierto}
          cargando={isLoading}
          porPagina={25}
          reinicio={`${conjunto}|${consulta}`}
          vacio={<EmptyState compacto titulo={consulta ? "Ningún caso coincide con la búsqueda" : "Este conjunto todavía no tiene casos"} />}
        />
      )}
    </div>
  );
}

/** Lo que la referencia dice de cada regla: primero las que deben dispararse. */
function EsperadoPorRegla({ esperado }: { esperado: Record<string, Esperado> | null }) {
  const reglas = Object.entries(esperado ?? {}).sort(
    ([a, x], [b, y]) => ORDEN_ESTADO.indexOf(x?.estado) - ORDEN_ESTADO.indexOf(y?.estado) || a.localeCompare(b),
  );
  if (!reglas.length) return <EmptyState compacto className="px-0" titulo="La referencia no trae reglas para este caso" />;
  return (
    <ul className="divide-y divide-line">
      {reglas.map(([regla, e]) => {
        const est = ESTADO[e?.estado] ?? ESTADO.sin_dato;
        return (
          <li key={regla} className="min-w-0 py-2.5 first:pt-0 last:pb-0">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-dato font-medium text-ink">
              {nombreRegla(regla)}
              <Badge tono={est.tono}>{est.nombre}</Badge>
              {e?.severidad && <Badge>severidad {e.severidad}</Badge>}
            </p>
            {e?.evidencia?.trim() && <p className="mt-1 whitespace-pre-wrap break-words text-meta leading-relaxed text-inkSoft">{e.evidencia}</p>}
          </li>
        );
      })}
    </ul>
  );
}
