"use client";

import { DatabaseZap } from "lucide-react";
import { Badge, Card, EmptyState, ErrorBanner, FilterChips } from "@/components/admin/ui";
import { colorSerie } from "@/components/charts/BarraSegmentada";
import { cn } from "@/lib/utils";
import { diferencia, esSinMigracion, fmtEjecutada, fmtF1, type Conjunto, type Corrida } from "./tipos";

/**
 * Un pedido que falló: si la API dice que falta la migración (503 `sin_migracion`), el estado vacío del kit con qué
 * hacer; cualquier otro error, el aviso de siempre con «Reintentar».
 */
export function ErrorGolden({ error, titulo, onReintentar }: { error: unknown; titulo: string; onReintentar?: () => void }) {
  if (!error) return null;
  if (esSinMigracion(error))
    return (
      <Card relleno="none">
        <EmptyState
          icono={<DatabaseZap size={16} />}
          titulo="Falta aplicar la migración"
          descripcion="La base todavía no tiene las tablas de esta pantalla. Aplica la migración en este ambiente y vuelve a cargar."
        />
      </Card>
    );
  return <ErrorBanner error={error} titulo={titulo} onReintentar={onReintentar} />;
}

/** El conjunto elegido, en chips (uno solo a la vez). Sin `?conjunto=` en la URL vale el primero. */
export function SelectorConjunto({ conjuntos, valor, onCambiar }: { conjuntos: Conjunto[]; valor: string; onCambiar: (clave: string) => void }) {
  if (conjuntos.length < 2) return null;
  return <FilterChips etiqueta="Conjunto de prueba" valor={valor} onCambiar={onCambiar} opciones={conjuntos.map((c) => ({ valor: c.clave, etiqueta: c.nombre }))} />;
}

/** Cuánto cambió frente a la corrida anterior: «+0.03» en verde, «−0.05» en rojo, «igual» en gris. */
export function Delta({ ahora, antes, como = "f1", contra }: { ahora: number | null | undefined; antes: number | null | undefined; como?: "f1" | "pct"; contra?: string | null }) {
  const d = diferencia(ahora, antes, como);
  if (!d) return null;
  return (
    <Badge tono={d.tono} title={contra ? `Frente a ${contra}` : "Frente a la corrida anterior"}>
      {d.texto}
    </Badge>
  );
}

/**
 * La serie de F1 de un conjunto, una columna por corrida (de la más vieja a la más nueva): la altura es el F1 sobre 1 y
 * la última va entera de color, las anteriores atenuadas. Cada columna dice su imagen, su fecha y su F1 al pasar el
 * mouse; el nombre del gráfico las lista para el lector de pantalla. Colores de la paleta de series del proyecto.
 */
export function SerieF1({ serie, className }: { serie: Corrida[]; className?: string }) {
  const puntos = serie.filter((c) => c.f1 != null);
  if (puntos.length < 2) return null;
  const leer = (c: Corrida) => `${c.imagen ?? c.corrida ?? "corrida"}, ${fmtEjecutada(c.ejecutada) ?? "sin fecha"}: F1 ${fmtF1(c.f1)}`;
  return (
    <figure className={cn("min-w-0", className)}>
      <div role="img" aria-label={`F1 por corrida, de la más vieja a la más nueva. ${puntos.map(leer).join("; ")}`} className="flex h-16 items-end gap-1 border-b border-paperEdge">
        {puntos.map((c, i) => (
          <span key={String(c.id)} title={leer(c)} className="flex h-full min-w-0 max-w-[28px] flex-1 items-end">
            <span
              className={cn("block w-full rounded-t-[4px]", i < puntos.length - 1 && "opacity-45")}
              style={{ height: `${Math.max(3, Math.min(1, c.f1 ?? 0) * 100)}%`, background: colorSerie(0) }}
            />
          </span>
        ))}
      </div>
      <figcaption className="mt-1 flex items-baseline justify-between gap-2 text-rotulo text-mute">
        <span>F1 de las últimas {puntos.length} corridas</span>
        <span className="font-mono tabular-nums">
          {fmtF1(puntos[0].f1)} a {fmtF1(puntos[puntos.length - 1].f1)}
        </span>
      </figcaption>
    </figure>
  );
}
