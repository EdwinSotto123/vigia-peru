import { Banknote, Construction, ExternalLink } from "lucide-react";
import { numero, oracion } from "@/lib/formato";
import { CONTRALORIA_CORRUPCION, DE_CADA_CIEN, DE_CADA_CIEN_SOLES } from "@/lib/costoCorrupcion";
import { cn } from "@/lib/utils";

/**
 * Lo que cuesta la corrupción, dibujado (pedido del 2026-10-29: «texto y ya, nada de jerarquía»): cien cuadros, uno por
 * cada sol de 100 del presupuesto, y encendidos los que se habrían llevado la corrupción y la inconducta funcional según
 * la Contraloría (12,7: doce enteros y el decimotercero a 70 %). Debajo, las dos cifras con su ícono y la fuente: antes
 * eran un párrafo con los números adentro. Cuadros y no puntos, para no confundirlos con los contratos de la portada.
 *
 * Va sobre una banda oscura (`sobre-oscuro`: /app/apoyar y la portada): encendidos en maíz, los demás en el tono del
 * texto con poca opacidad. `horizontal` pone los cuadros a la izquierda de las cifras desde sm. Server-safe.
 *
 * `claro`: sobre el fondo de la página, dentro de una caja con borde (/app/apoyar desde el 2026-11-13: sin bandas de
 * color como jerarquía). Encendidos en granate y los demás en el gris de las pistas.
 */
const TONOS = {
  oscuro: {
    cuadro: "bg-paper/15",
    lleno: "bg-maiz",
    cifra: "text-maiz",
    rotulo: "text-paper/75",
    icono: "bg-paper/10 text-maiz",
    fuerte: "text-paper",
    pie: "text-paper/60",
    enlace: "text-maiz decoration-maiz/50 hover:decoration-maiz",
  },
  claro: {
    cuadro: "bg-paperDeep",
    lleno: "bg-granate",
    cifra: "text-granate",
    rotulo: "text-inkSoft",
    icono: "bg-paperDeep text-granate",
    fuerte: "text-ink",
    pie: "text-mute",
    enlace: "text-granate decoration-granate/40 hover:decoration-granate",
  },
} as const;

export function DeCadaCien({ horizontal = false, claro = false, className }: { horizontal?: boolean; claro?: boolean; className?: string }) {
  const t = TONOS[claro ? "claro" : "oscuro"];
  const c = CONTRALORIA_CORRUPCION;
  const llenos = Math.floor(c.porCien);
  const parte = c.porCien - llenos;
  return (
    <figure className={cn("min-w-0", horizontal ? "grid gap-6 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:gap-10" : "space-y-6", className)}>
      <div className="flex items-end gap-4">
        <div
          role="img"
          aria-label={`Según la Contraloría, ${DE_CADA_CIEN_SOLES} del presupuesto de ${c.anio} se habrían perdido por corrupción e inconducta funcional.`}
          className="grid w-fit shrink-0 grid-cols-10 gap-[3px]"
        >
          {Array.from({ length: 100 }, (_, i) => (
            <span key={i} className={cn("relative h-3.5 w-3.5 overflow-hidden rounded-[3px] sm:h-4 sm:w-4", t.cuadro)}>
              {i < llenos ? (
                <span className={cn("absolute inset-0", t.lleno)} />
              ) : i === llenos && parte > 0 ? (
                <span className={cn("absolute inset-y-0 left-0", t.lleno)} style={{ width: `${Math.round(parte * 100)}%` }} />
              ) : null}
            </span>
          ))}
        </div>
        {/* El rótulo directo de la figura en dos niveles: en uno solo, al lado de los cuadros, se partía en cinco renglones. */}
        <p aria-hidden className="pb-0.5">
          <span className={cn("block font-display text-cifra font-bold leading-none", t.cifra)}>
            {oracion(`${DE_CADA_CIEN.cerca ? `${DE_CADA_CIEN.cerca} ` : ""}${DE_CADA_CIEN.redondo}`)}
          </span>
          <span className={cn("mt-1.5 block max-w-[10ch] text-meta leading-snug", t.rotulo)}>de cada 100 soles</span>
        </p>
      </div>

      <div className="min-w-0 space-y-4">
        <ul className="space-y-3.5">
          <li className="flex gap-3">
            <span aria-hidden className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full", t.icono)}>
              <Banknote size={17} />
            </span>
            <p className={cn("min-w-0 text-meta leading-snug", t.rotulo)}>
              <span className={cn("block font-display text-destacado font-bold", t.fuerte)}>S/{"\u00a0"}{numero(c.millones)} millones</span>
              se habrían perdido en {c.anio} por corrupción e inconducta funcional
            </p>
          </li>
          <li className="flex gap-3">
            <span aria-hidden className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full", t.icono)}>
              <Construction size={17} />
            </span>
            <p className={cn("min-w-0 text-meta leading-snug", t.rotulo)}>
              <span className={cn("block font-display text-destacado font-bold", t.fuerte)}>S/{"\u00a0"}{numero(c.inversionMillones)} millones</span>
              la tajada más grande, en la inversión: carreteras, hospitales y colegios
            </p>
          </li>
        </ul>
        <figcaption className={cn("text-rotulo leading-snug", t.pie)}>
          Estimación de la Contraloría General de la República.{" "}
          <a
            href={c.url}
            target="_blank"
            rel="noopener noreferrer"
            className={cn("inline-flex items-center gap-1 font-semibold underline underline-offset-2", t.enlace)}
          >
            Ver la fuente
            <ExternalLink size={11} aria-hidden />
            <span className="sr-only"> (se abre en otra pestaña)</span>
          </a>
        </figcaption>
      </div>
    </figure>
  );
}
