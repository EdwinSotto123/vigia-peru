import Link from "next/link";
import { ArrowUpRight, FileSearch, Map as Mapa, Megaphone, Navigation } from "lucide-react";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { PreguntaRapida } from "@/components/salud/asistente/PreguntaRapida";
import { rutaEn } from "@/lib/gobserva";
import { nombrePropio, type FichaIpress } from "@/lib/gobserva-salud";
import { cn } from "@/lib/utils";
import { CopiarEnlace } from "./CopiarEnlace";
import { URL_DENUNCIA_SUSALUD } from "./piezas";

/** OpenStreetMap con el punto marcado y el zoom de una calle. */
export const urlComoLlegar = (lat: number, lon: number) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`;

const EXTERNO = <span className="sr-only"> (se abre en otra pestaña)</span>;

/**
 * Lo que se puede hacer con la ficha (actuar), justo después de la verificación: llegar, verla en el mapa, la consulta
 * oficial de RENIPRESS, presentar una denuncia ante SUSALUD, copiar el enlace y preguntarle al asistente. La primera
 * acción es «Cómo llegar» cuando hay ubicación; si no, la consulta oficial. Server-safe (copiar es una hoja de cliente).
 */
export function AccionesFicha({ f, base, className }: { f: FichaIpress; base: string; className?: string }) {
  const conPunto = f.lat != null && f.lon != null;
  const renipress = f.fuentes.renipress?.url ?? null;
  const pregunta = `¿Qué servicios le registra RENIPRESS a ${nombrePropio(f.nombre)} (código ${f.codigo}) y qué sanciones firmes de SUSALUD tiene?`;
  return (
    <aside aria-labelledby="acciones-t" className={cn("min-w-0", className)}>
      <div className="tarjeta rounded-2xl border border-line bg-paper p-4 sm:p-5">
        <h2 id="acciones-t" className="font-display text-bloque font-bold leading-snug text-ink">
          Qué puedes hacer
        </h2>
        <ul className="mt-3 grid gap-2">
          {conPunto && (
            <li>
              <a href={urlComoLlegar(f.lat!, f.lon!)} target="_blank" rel="noopener noreferrer" className={claseAccion("primario", "min-h-11 w-full")}>
                <Navigation size={16} aria-hidden /> Cómo llegar
                {EXTERNO}
              </a>
            </li>
          )}
          {conPunto && (
            <li>
              <Link href={rutaEn(base, `/mapa?${new URLSearchParams({ codigo: f.codigo })}`)} prefetch={false} className={claseAccion("secundario", "min-h-11 w-full")}>
                <Mapa size={16} aria-hidden /> Ver en el mapa
              </Link>
            </li>
          )}
          {renipress && (
            <li>
              <a href={renipress} target="_blank" rel="noopener noreferrer" className={claseAccion(conPunto ? "secundario" : "primario", "min-h-11 w-full")}>
                <FileSearch size={16} aria-hidden /> Consulta oficial en RENIPRESS
                <ArrowUpRight size={14} aria-hidden className="shrink-0" />
                {EXTERNO}
              </a>
            </li>
          )}
          <li>
            <a href={URL_DENUNCIA_SUSALUD} target="_blank" rel="noopener noreferrer" className={claseAccion("secundario", "min-h-11 w-full")}>
              <Megaphone size={16} aria-hidden /> Presentar una denuncia ante SUSALUD
              <ArrowUpRight size={14} aria-hidden className="shrink-0" />
              {EXTERNO}
            </a>
          </li>
          <li>
            <CopiarEnlace />
          </li>
        </ul>
        <p className="mt-3 text-meta leading-snug text-mute">
          La denuncia la recibe SUSALUD, no Gobserva. En una emergencia llama al 106 (SAMU) o al 113.
        </p>
      </div>
      <PreguntaRapida base={base} pregunta={pregunta} className="mt-3" />
    </aside>
  );
}
