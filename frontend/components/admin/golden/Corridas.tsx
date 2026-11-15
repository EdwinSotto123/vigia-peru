"use client";

import { useMemo } from "react";
import { DataTable, EmptyState, SinDato, type Columna } from "@/components/admin/ui";
import { useAdmin } from "@/lib/useAdmin";
import { Delta, ErrorGolden, SelectorConjunto } from "./comunes";
import { QUE_MIDE, fmtEjecutada, fmtF1, fmtPct, fmtSeg, fmtUsd, porFechaDesc, type Conjunto, type Corrida } from "./tipos";

/**
 * Pestaña «Corridas»: las corridas de un conjunto, de la más nueva a la más vieja, cada una con la diferencia de F1
 * frente a la anterior del mismo conjunto. El clic en una fila abre su detalle (`?corrida=<id>`).
 */

type Fila = Corrida & { previa: Corrida | null };

export function CorridasGolden({ conjuntos, conjunto, onConjunto, onCorrida }: { conjuntos: Conjunto[]; conjunto: string; onConjunto: (clave: string) => void; onCorrida: (id: string) => void }) {
  const { data, error, isLoading, mutate } = useAdmin<{ data: Corrida[] }>(conjunto ? `/golden/corridas?conjunto=${encodeURIComponent(conjunto)}` : null);
  const elegido = conjuntos.find((c) => c.clave === conjunto);
  const que = QUE_MIDE[elegido?.queMide ?? "banderas"] ?? QUE_MIDE.banderas;

  // Cada corrida con la anterior en el tiempo (la que sigue en la lista ordenada de nueva a vieja).
  const filas = useMemo<Fila[] | undefined>(() => {
    if (!data) return undefined;
    const orden = porFechaDesc(data.data ?? []);
    return orden.map((c, i) => ({ ...c, previa: orden[i + 1] ?? null }));
  }, [data]);

  const columnas: Columna<Fila>[] = [
    {
      clave: "imagen",
      titulo: "Imagen del agente",
      principal: true,
      celda: (f) => (
        <span className="block min-w-0">
          <span className="block break-all font-mono text-meta font-semibold text-ink">{f.imagen ?? "Sin imagen"}</span>
          <span className="block truncate text-rotulo text-mute">{[f.corrida, f.variante ? `variante ${f.variante}` : null].filter(Boolean).join(", ") || "Sin nombre de corrida"}</span>
        </span>
      ),
    },
    { clave: "ejecutada", titulo: "Ejecutada", className: "whitespace-nowrap", celda: (f) => fmtEjecutada(f.ejecutada) ?? <SinDato texto="Sin fecha" /> },
    { clave: "contratos", titulo: que.casos === "preguntas" ? "Preguntas" : "Contratos", alinear: "derecha", celda: (f) => f.contratos?.toLocaleString("es-PE") ?? <SinDato /> },
    {
      clave: "errores",
      titulo: "Errores",
      alinear: "derecha",
      celda: (f) => (f.errores ? <span className="font-semibold text-crimsonTexto">{f.errores.toLocaleString("es-PE")}</span> : <span className="font-sans text-mute">Ninguno</span>),
    },
    { clave: "precision", titulo: "Precisión", alinear: "derecha", celda: (f) => fmtPct(f.precision) ?? <SinDato texto="No aplica" /> },
    { clave: "exhaustividad", titulo: que.casos === "preguntas" ? "Acierto en 8" : "Exhaustividad", alinear: "derecha", celda: (f) => fmtPct(f.exhaustividad) ?? <SinDato /> },
    {
      clave: "f1",
      titulo: que.casos === "preguntas" ? "MRR" : "F1",
      alinear: "derecha",
      celda: (f) => (
        <span className="inline-flex items-center justify-end gap-1.5">
          <span className="font-semibold text-ink">{fmtF1(f.f1) ?? <SinDato />}</span>
          <Delta ahora={f.f1} antes={f.previa?.f1} contra={f.previa?.imagen} />
        </span>
      ),
    },
    { clave: "costo", titulo: "Costo medio", alinear: "derecha", celda: (f) => fmtUsd(f.usdMedio) ?? <SinDato /> },
    { clave: "tiempo", titulo: "Tiempo medio", alinear: "derecha", celda: (f) => fmtSeg(f.segundosMedio) ?? <SinDato /> },
  ];

  return (
    <div className="space-y-3">
      <SelectorConjunto conjuntos={conjuntos} valor={conjunto} onCambiar={onConjunto} />
      <ErrorGolden error={error} titulo="No se pudieron leer las corridas" onReintentar={() => mutate()} />
      {!error && (
        <DataTable
          columnas={columnas}
          filas={filas}
          claveFila={(f) => String(f.id)}
          etiqueta={`Corridas de ${elegido?.nombre ?? "este conjunto"}`}
          onFila={(f) => onCorrida(String(f.id))}
          cargando={isLoading}
          porPagina={25}
          reinicio={conjunto}
          apilarHasta="lg"
          anchoMinimo="min-w-[980px]"
          vacio={<EmptyState compacto titulo="Todavía no se subió ninguna corrida" descripcion="Corre este conjunto contra una imagen del agente y sube el resultado." />}
        />
      )}
    </div>
  );
}
