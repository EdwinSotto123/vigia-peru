import Link from "next/link";
import { ChevronRight, Crown, Heart } from "lucide-react";
import { Medalla } from "@/components/marca";
import { getRankingPaginado } from "@/lib/financiamiento";
import { numero } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { HREF_APOYAR } from "./Podio";
import { AvatarAliado } from "./TarjetaAliado";
import { clasificar, hrefPerfil, type FilaRanking } from "./ranking";

/**
 * Los aliados de Vigía arriba de cada página, como el cintillo de los auspiciadores (pedido del dueño, 2026-11-01: «los
 * ALIADOS GLOBALES, ponerlos de header para resaltarlos, tipo publicidad para ellos»). Es el podio nacional de
 * /app/aliados (sin región) en una línea: los tres primeros por constancia (meses, nunca soles; la semilla de Vigía Perú
 * no compite), cada uno con su medalla, su logo y su nombre, que abre su perfil. Un lugar libre dice «Tu nombre aquí» y
 * lleva al aporte: el cintillo se ve entero aunque falten nombres, y dice lo que gana quien se suma (estar aquí, en cada
 * página). Si el registro no responde, no se dibuja: no se inventan lugares.
 *
 * Los tres lugares se ven siempre: si no entran, los nombres se acortan (nada de deslizar de lado, que cortaba el tercero
 * a la mitad); en el celular el 2.º y el 3.º quedan en su medalla, con el nombre en su título y para el lector de pantalla.
 * Va encima de la cabecera pública (se va al bajar: la cabecera sigue pegada arriba) y arriba de cada pantalla de /app.
 * Banda de marca (`sobre-oscuro`): carbón con lima de noche, verde bosque de día. Server-safe; el ranking, 5 min en caché.
 */

/** Filas que se piden: los aportes sin nombre no ocupan puesto, y hacen falta tres con nombre. */
const TOPE = 12;
const LUGARES = [1, 2, 3] as const;
type Lugar = (typeof LUGARES)[number];

export async function FranjaAliados({ className, ancho = "pagina" }: { className?: string; ancho?: "pagina" | "columna" }) {
  const ranking = await getRankingPaginado({ periodo: "todo", limit: TOPE }).catch(() => null);
  if (!ranking) return null;
  const podio = clasificar(ranking.data ?? []).slice(0, 3);
  const libres = 3 - podio.length;

  return (
    <aside aria-labelledby="franja-aliados-t" className={cn("sobre-oscuro border-b border-maiz/25 bg-granate-deep text-paper", className)}>
      <div
        className={cn(
          "flex min-h-11 items-center gap-2 py-1.5 [container-type:inline-size] sm:gap-3",
          // En la cabecera pública, el ancho de la página; en /app, el de la columna (sin tope: la barra lateral ya resta).
          ancho === "pagina" ? "container-page" : "px-4 sm:px-6 lg:px-8",
        )}
      >
        <Link
          href="/app/aliados"
          className="group flex shrink-0 items-center gap-1.5 rounded-full py-1 text-meta font-semibold text-maiz focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maiz"
        >
          <Crown size={15} aria-hidden />
          {/* En el celular, la corona sola (la palabra, para el lector de pantalla): el nombre del 1.º necesita el lugar. */}
          <span id="franja-aliados-t" className="underline-offset-2 group-hover:underline max-sm:sr-only">
            Aliados<span className="hidden sm:inline"> de Vigía</span>
          </span>
        </Link>

        <ol aria-label="Podio de aliados: los tres que más meses sostienen Vigía" className="flex min-w-0 flex-1 items-center gap-1 sm:gap-1.5">
          {LUGARES.map((lugar) => {
            const f = podio[lugar - 1];
            return f ? <Ocupado key={f.id} lugar={lugar} fila={f} /> : <Libre key={`libre-${lugar}`} lugar={lugar} primero={libres === 3 && lugar === 1} />;
          })}
        </ol>

        <Link
          href={HREF_APOYAR}
          className="group inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full bg-maiz px-3 text-meta font-semibold text-[rgb(var(--sobre-maiz))] transition-colors duration-rapido hover:bg-maiz/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper"
        >
          <Heart size={13} aria-hidden className="fill-current motion-safe:group-hover:animate-latir" />
          Súmate<span className="hidden md:inline">&nbsp;desde S/&nbsp;5</span>
        </Link>
        <Link
          href="/app/aliados"
          className="hidden shrink-0 items-center gap-0.5 rounded-full py-1 text-meta font-medium text-paper/80 underline-offset-2 hover:text-paper hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maiz lg:inline-flex"
        >
          Ver todos <ChevronRight size={14} aria-hidden />
        </Link>
      </div>
    </aside>
  );
}

const PLACA = "flex h-9 min-w-0 items-center gap-1.5 rounded-full";
/** El 2.º y el 3.º en el celular: sólo la medalla, en un círculo. */
const SOLO_MEDALLA = "max-sm:w-9 max-sm:justify-center max-sm:px-0";

/** Un lugar con su aliado: la medalla, el logo y el nombre, y cuántos meses lleva (en el título y desde md, escrito). */
function Ocupado({ lugar, fila: f }: { lugar: Lugar; fila: FilaRanking }) {
  const href = hrefPerfil(f.slug);
  const meses = `${numero(f.meses)} ${f.meses === 1 ? "mes" : "meses"} sosteniendo Vigía`;
  const compacto = lugar > 1;
  const cuerpo = (
    <>
      <Medalla puesto={lugar} tamano={20} corona={false} />
      {/* El nombre va escrito al lado: el logo no lo repite para el lector de pantalla. */}
      <span aria-hidden className="flex shrink-0 max-sm:hidden">
        <AvatarAliado tipo={f.tipo} logoUrl={f.logoUrl} nombre={f.nombre} size="xs" />
      </span>
      <span className={cn("min-w-0 truncate text-meta font-semibold text-paper", compacto && "max-sm:sr-only")}>{f.nombre}</span>
      <span className="hidden shrink-0 whitespace-nowrap font-mono text-rotulo tabular-nums text-paper/70 [@container(min-width:72rem)]:inline">
        {numero(f.meses)} {f.meses === 1 ? "mes" : "meses"}
      </span>
    </>
  );
  const clase = cn(PLACA, "bg-paper/[0.08] pl-1 pr-3", compacto && SOLO_MEDALLA);
  return (
    // El 1.º cede ancho primero sólo si hace falta; en el celular, el 2.º y el 3.º no ceden (miden lo que su medalla).
    <li className={cn("min-w-0", compacto && "max-sm:shrink-0")}>
      {href ? (
        <Link
          href={href}
          title={`${lugar}.º lugar: ${f.nombre}, ${meses}`}
          className={cn(clase, "transition-colors duration-rapido hover:bg-paper/[0.16] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maiz")}
        >
          {cuerpo}
        </Link>
      ) : (
        <span title={`${lugar}.º lugar: ${f.nombre}, ${meses}`} className={clase}>
          {cuerpo}
        </span>
      )}
    </li>
  );
}

/** Un lugar que nadie ocupa: la medalla apagada y la invitación, que lleva al aporte. */
function Libre({ lugar, primero }: { lugar: Lugar; primero: boolean }) {
  const compacto = lugar > 1;
  return (
    // No se achica: su texto es corto («Lugar li…» se leía mal); ceden los nombres de los que están.
    <li className="shrink-0">
      <Link
        href={HREF_APOYAR}
        title={`El ${lugar}.º lugar del podio está libre: se gana con meses de aporte, desde S/ 5 al mes`}
        className={cn(
          PLACA,
          "border border-dashed border-paper/30 pl-1 pr-3 text-paper/75 transition-colors duration-rapido hover:border-maiz/60 hover:text-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maiz",
          compacto && SOLO_MEDALLA,
        )}
      >
        <Medalla puesto={lugar} tamano={20} corona={false} className="shrink-0 opacity-40 grayscale" />
        <span className={cn("min-w-0 truncate text-meta", compacto && "max-sm:sr-only")}>
          {primero ? (
            <>
              Tu nombre aquí<span className="hidden xl:inline">, en cada página</span>
            </>
          ) : (
            "Lugar libre"
          )}
        </span>
      </Link>
    </li>
  );
}
