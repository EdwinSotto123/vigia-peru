import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { FilePen, Globe2, Info, Layers, PackageX, ShieldAlert, TriangleAlert } from "lucide-react";
import { Odometro } from "@/components/gobserva/portada/Odometro";
import { numero, TIPOS_ALERTA, type TipoAlerta } from "@/lib/gobserva-salud";
import { cn } from "@/lib/utils";

const ESTILO: Record<TipoAlerta, { Icono: LucideIcon; tinta: string; fondo: string; barra: string }> = {
  falsificado: { Icono: TriangleAlert, tinta: "text-crimsonTexto", fondo: "bg-crimson/10", barra: "bg-crimson" },
  calidad: { Icono: PackageX, tinta: "text-amberTexto", fondo: "bg-amber/15", barra: "bg-amber" },
  seguridad: { Icono: ShieldAlert, tinta: "text-amberTexto", fondo: "bg-amber/15", barra: "bg-amber" },
  modificacion: { Icono: FilePen, tinta: "text-inkSoft", fondo: "bg-ink/[0.06]", barra: "bg-inkSoft" },
  internacional: { Icono: Globe2, tinta: "text-inkSoft", fondo: "bg-ink/[0.06]", barra: "bg-inkSoft" },
  otra: { Icono: Info, tinta: "text-inkSoft", fondo: "bg-ink/[0.06]", barra: "bg-inkSoft" },
};

/**
 * El tablero de tipos de /alertas (2026-11-22, el usuario: «mejora la UX/UI de todo… esta mierda es texto plano»): antes
 * el tipo era sólo una lista desplegable. Ahora cada tipo es una baldosa con su ícono, su color (falsificados en rojo,
 * retiros y seguridad en ámbar), cuántas alertas hay (la cifra rueda) y una barra con su parte del total; se toca y
 * filtra. La elegida queda marcada; «Todas» quita el filtro. En el celular, una fila que se desliza. Las cifras son las
 * de GET /salud/alertas (`tipos`). Server-safe (`href` es una función: sólo desde el servidor).
 */
export function TiposAlerta({
  tipos,
  orden,
  activo,
  href,
  className,
}: {
  tipos: Partial<Record<TipoAlerta, number>>;
  orden: TipoAlerta[];
  activo?: TipoAlerta;
  href: (t?: TipoAlerta) => string;
  className?: string;
}) {
  const conAlertas = orden.filter((t) => (tipos[t] ?? 0) > 0);
  const total = conAlertas.reduce((s, t) => s + (tipos[t] ?? 0), 0);
  if (!conAlertas.length) return null;
  return (
    <ul
      aria-label="Tipos de alerta"
      className={cn(
        "-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:-mx-6 sm:px-6 lg:mx-0 lg:grid lg:auto-cols-fr lg:grid-flow-col lg:overflow-visible lg:px-0 [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      <li className="w-[8.5rem] shrink-0 snap-start lg:w-auto">
        <Baldosa href={href()} activa={!activo} Icono={Layers} tinta="text-granate" fondo="bg-granate-50" barra="bg-granate" n={total} pct={100} nombre="Todas" />
      </li>
      {conAlertas.map((t) => {
        const e = ESTILO[t];
        const n = tipos[t] ?? 0;
        return (
          <li key={t} className="w-[8.5rem] shrink-0 snap-start lg:w-auto">
            <Baldosa
              href={href(t)}
              activa={activo === t}
              Icono={e.Icono}
              tinta={e.tinta}
              fondo={e.fondo}
              barra={e.barra}
              n={n}
              pct={total ? Math.max(4, Math.round((n / total) * 100)) : 0}
              nombre={TIPOS_ALERTA[t].nombre}
              explica={TIPOS_ALERTA[t].explica}
            />
          </li>
        );
      })}
    </ul>
  );
}

function Baldosa({
  href,
  activa,
  Icono,
  tinta,
  fondo,
  barra,
  n,
  pct,
  nombre,
  explica,
}: {
  href: string;
  activa: boolean;
  Icono: LucideIcon;
  tinta: string;
  fondo: string;
  barra: string;
  n: number;
  pct: number;
  nombre: string;
  explica?: string;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={activa ? "true" : undefined}
      title={explica}
      className={cn(
        "gs-mira gs-hunde flex h-full min-h-[7.25rem] flex-col rounded-2xl border bg-paper p-3 transition-colors duration-rapido focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate",
        activa ? "border-granate ring-1 ring-granate" : "border-line hover:border-granate/40",
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span aria-hidden className={cn("grid h-8 w-8 place-items-center rounded-lg", fondo, tinta)}>
          <Icono size={16} />
        </span>
        <span className={cn("font-display text-bloque font-bold leading-none tabular-nums", activa ? "text-ink" : tinta === "text-inkSoft" ? "text-ink" : tinta)}>
          <Odometro texto={numero(n)} />
        </span>
      </span>
      <span className="mt-2 text-meta font-semibold leading-snug text-ink">{nombre}</span>
      <span aria-hidden className="mt-auto block pt-2.5">
        <span className="block h-1 overflow-hidden rounded-full bg-ink/[0.06]">
          <span className={cn("gs-barra-crece block h-full rounded-full", barra)} style={{ width: `${pct}%` }} />
        </span>
      </span>
    </Link>
  );
}
