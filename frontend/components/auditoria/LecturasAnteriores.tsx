import { rutaContrato } from "@/lib/rutas";
import Link from "next/link";
import { ChevronRight, Coins } from "lucide-react";
import { fechaLima, type Procesamiento } from "@/lib/auditoria";
import { oracion, plural, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { Dato } from "@/components/ui/Dato";
import { Partes } from "@/components/ui/Partes";

/**
 * Las lecturas que vinieron antes de "Lo último que se leyó": hasta cinco filas de una línea (objeto, entidad y zona,
 * cuándo terminó, qué encontró). Va en la pestaña En curso cuando no hay nada en análisis, que es su estado normal:
 * en vez de una pantalla a medio llenar, la persona ve que el trabajo existe y puede abrir cualquiera. Datos reales
 * de /financiamiento/procesamientos (los mismos de Ya leídos). Una lectura en revisión humana dice solo eso:
 * ni señales ni puntaje. Server-safe.
 */
export function LecturasAnteriores({ items, total }: { items: Procesamiento[]; total: number | null }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="lecturas-anteriores" className="space-y-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h3 id="lecturas-anteriores" className="text-[13px] font-semibold text-ink">
          Antes de esa{total != null ? `, ${plural(Math.max(total - 1, items.length), "lectura más", "lecturas más")}` : ""}
        </h3>
        <Link
          href="/app/auditoria?seccion=leidos"
          className="text-[13px] font-semibold text-granate underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
        >
          Ver todas
        </Link>
      </div>
      <ul className="divide-y divide-line">
        {items.map((p) => {
          const enRevision = p.alertaEstado === "revision";
          return (
            <li key={p.ocid}>
              <Link
                href={rutaContrato(p.ocid, "vivo")}
                className="group flex items-center gap-3 py-2 transition-colors hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
              >
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-1 text-[13.5px] font-medium text-ink group-hover:text-granate">{p.titulo ? oracion(p.titulo) : p.ocid}</span>
                  <span className="block truncate text-[12px] text-mute">
                    <Partes
                      partes={[
                        p.entidad && <Dato key="entidad" tipo="entidad">{tituloNatural(p.entidad)}</Dato>,
                        p.zona && <Dato key="zona" tipo="lugar">{p.zona}</Dato>,
                        p.montoPen ? <Dato key="monto" icono={Coins} nombre="Valor" mono>{solesCompacto(p.montoPen)}</Dato> : null,
                      ]}
                    />
                  </span>
                </span>
                <span className="hidden shrink-0 text-right text-[12px] tabular-nums text-mute sm:block">
                  {p.finalizadoAt ? fechaLima(p.finalizadoAt, { hora: true }) : null}
                </span>
                <span className="w-24 shrink-0 text-right text-[12.5px] text-inkSoft">
                  {enRevision ? "En revisión" : p.banderas > 0 ? plural(p.banderas, "señal", "señales") : "sin señales"}
                </span>
                <ChevronRight size={14} className="shrink-0 text-mute group-hover:text-granate" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
