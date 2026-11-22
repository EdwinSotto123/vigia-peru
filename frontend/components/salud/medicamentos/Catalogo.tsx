import Link from "next/link";
import { LayoutGrid, TriangleAlert } from "lucide-react";
import { Pixel } from "@/components/pixel/Pixel";
import type { NombreSprite } from "@/components/pixel/sprites";
import { rutaEn } from "@/lib/gobserva";
import { concentracionLegible, numero, rutaMedicamento, soles, type BusquedaMedicamentos, type Medicamento } from "@/lib/gobserva-salud";
import { FORMAS, formaDe, type FormaGrupo } from "@/lib/salud-formas";
import { cn } from "@/lib/utils";
import { nombreMed } from "./piezas";

/**
 * El catálogo de medicamentos (Gobserva Salud, 2026-11-22; el usuario: «QUE SEA TIPO MARKETPLACE, donde se muestre
 * cuadros en PIXEL ART los medicamentos, filtrado»): cada producto es una tarjeta con el dibujo de su forma, su precio
 * típico y lo que importa de un vistazo (genérico, alertas sobre su registro, cuántas farmacias lo reportan); arriba, un
 * riel de formas con su dibujo y su cuenta, y el orden. Todo con enlaces (GET): se puede compartir y volver. Server-safe.
 */

/** La ventana de píxeles: el dibujo sobre el tinte de la marca. Decorativa: el texto de al lado dice lo mismo. */
export function CuadroPixel({ sprite, escala, className }: { sprite: NombreSprite; escala: number; className?: string }) {
  return (
    <span aria-hidden className={cn("grid shrink-0 place-items-center rounded-xl bg-granate-50", className)}>
      <Pixel nombre={sprite} escala={escala} animado={false} acento="accion" />
    </span>
  );
}

/** Un producto del catálogo: el dibujo de su forma, el nombre, la concentración, el titular y el precio por unidad. */
export function TarjetaMedicamento({ m, base, masBarato = false }: { m: Medicamento; base: string; masBarato?: boolean }) {
  const forma = formaDe(m.formaGrupo);
  const generico = /^GEN/.test(m.clasificacion ?? "");
  const varias = (m.presentacionesN ?? 1) > 1;
  const rango = varias && m.precioMin != null && m.precioMax != null && m.precioMin !== m.precioMax;
  // El precio de la presentación que representa al producto (el mismo que abre su ficha, con sus farmacias); el rango de
  // las otras presentaciones va aparte (antes la tarjeta decía el mínimo de otra presentación con las farmacias de ésta).
  const precio = m.precioMediana ?? m.precioMin ?? null;
  const alertas = m.alertasRegistro ?? 0;
  return (
    <Link
      href={rutaEn(base, rutaMedicamento(m.codigo))}
      prefetch={false}
      className={cn(
        "gs-hunde group flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border bg-paper transition-colors duration-rapido hover:border-granate/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate focus-visible:ring-offset-2",
        masBarato ? "border-moss/50" : "border-line",
      )}
    >
      <div className="relative">
        {/* Más alto que el dibujo y con aire arriba: las insignias de la esquina no lo tapan. */}
        <CuadroPixel sprite={forma.sprite} escala={4} className="h-28 rounded-none border-b border-line pt-6 sm:h-32" />
        <p className="absolute inset-x-2 top-2 flex flex-wrap items-start justify-between gap-1">
          {generico ? (
            <span className="rounded-full bg-paper/95 px-2 py-0.5 text-rotulo font-semibold text-mossTexto ring-1 ring-moss/30">Genérico</span>
          ) : (
            <span />
          )}
          {alertas > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-amber-soft px-2 py-0.5 text-rotulo font-semibold text-amberTexto ring-1 ring-amber/40"
              title={`DIGEMID emitió ${alertas === 1 ? "una alerta" : `${alertas} alertas`} sobre su registro sanitario: mira de qué lotes.`}
            >
              <TriangleAlert size={11} aria-hidden />
              {alertas === 1 ? "1 alerta" : `${alertas} alertas`}
            </span>
          )}
        </p>
      </div>
      <div className="flex min-w-0 flex-1 flex-col px-3 pb-3 pt-2.5">
        <p className="line-clamp-2 text-dato font-semibold leading-snug text-ink group-hover:text-granate">{nombreMed(m.nombre)}</p>
        <p className="mt-0.5 line-clamp-2 text-meta leading-snug text-inkSoft">
          {[concentracionLegible(m.concentracion), nombreMed(m.forma)].filter(Boolean).join(", ")}
        </p>
        {m.titular && <p className="mt-0.5 truncate text-rotulo text-mute">{nombreMed(m.titular)}</p>}
        <div className="mt-auto pt-2.5">
          <p className="font-display text-bloque font-bold leading-none tabular-nums text-ink">
            {precio == null ? <span className="font-sans text-dato font-semibold text-mute">Sin precio</span> : soles(precio)}
          </p>
          {rango && precio != null && <p className="mt-1 text-rotulo text-inkSoft">Otras presentaciones desde {soles(m.precioMin)}</p>}
          {masBarato && <p className="mt-1 text-rotulo font-semibold text-mossTexto">Más barato que este</p>}
          <p className="mt-1 text-rotulo leading-snug text-mute">
            {precio == null ? "Ninguna farmacia lo reportó" : "por unidad"}
            {m.establecimientos ? `, en ${numero(m.establecimientos)} ${m.establecimientos === 1 ? "farmacia" : "farmacias"}` : ""}
          </p>
        </div>
      </div>
    </Link>
  );
}

/**
 * El riel de formas: «Todas» y cada forma con su dibujo y cuántos productos hay (para lo buscado). En el celular se
 * desliza de lado dentro de su franja (la página no); en la computadora entra entero.
 */
export function RielFormas({
  facetas,
  activa,
  href,
}: {
  facetas: NonNullable<BusquedaMedicamentos["facetas"]>;
  activa: FormaGrupo | null;
  href: (forma: FormaGrupo | null) => string;
}) {
  const n = (k: FormaGrupo) => facetas.forma.find((x) => x.clave === k)?.n ?? 0;
  const total = facetas.forma.reduce((a, x) => a + x.n, 0);
  const visibles = FORMAS.filter((f) => n(f.clave) > 0 || f.clave === activa);
  const caja = "flex h-full w-[5.25rem] flex-col items-center gap-1 rounded-2xl border px-1.5 pb-2 pt-1.5 text-center transition-colors duration-rapido lg:w-full";
  return (
    <nav aria-label="Qué forma" className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-2 lg:grid lg:w-full lg:grid-cols-11">
        <li>
          <Link
            href={href(null)}
            aria-current={activa ? undefined : "page"}
            className={cn(caja, !activa ? "border-granate bg-granate-50 ring-1 ring-granate/40" : "border-line bg-paper hover:border-granate/50")}
          >
            <span aria-hidden className="grid h-10 w-full place-items-center text-granate">
              <LayoutGrid size={22} />
            </span>
            <span className="text-meta font-semibold leading-tight text-ink">Todas</span>
            <span className="text-rotulo tabular-nums text-mute">{numero(total)}</span>
          </Link>
        </li>
        {visibles.map((f) => (
          <li key={f.clave}>
            <Link
              href={href(activa === f.clave ? null : f.clave)}
              aria-current={activa === f.clave ? "page" : undefined}
              title={f.etiqueta}
              className={cn(caja, activa === f.clave ? "border-granate bg-granate-50 ring-1 ring-granate/40" : "border-line bg-paper hover:border-granate/50")}
            >
              <span aria-hidden className="grid h-10 w-full place-items-center">
                <Pixel nombre={f.sprite} escala={2} animado={false} acento="accion" />
              </span>
              <span className="text-meta font-semibold leading-tight text-ink">{f.corta}</span>
              <span className="text-rotulo tabular-nums text-mute">{numero(n(f.clave))}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Una opción de un grupo de enlaces (genérico o de marca, el orden): la elegida, llena. */
function Opcion({ href, activa, children, className }: { href: string; activa: boolean; children: React.ReactNode; className?: string }) {
  return (
    <Link
      href={href}
      aria-current={activa ? "true" : undefined}
      className={cn(
        "gs-hunde inline-flex min-h-10 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-full px-3 text-meta font-semibold transition-colors duration-rapido sm:min-h-9",
        activa ? "bg-granate text-paper" : "text-inkSoft hover:bg-granate-50 hover:text-ink",
        className,
      )}
    >
      {children}
    </Link>
  );
}

/** Genérico o de marca, y el orden: dos grupos de enlaces en una franja. */
export function OrdenYTipo({
  d,
  conBusqueda,
  href,
}: {
  d: BusquedaMedicamentos;
  conBusqueda: boolean;
  href: (cambio: { tipo?: string | null; orden?: string | null }) => string;
}) {
  const f = d.facetas;
  const orden = d.orden ?? (conBusqueda ? "relevancia" : "populares");
  const ordenes = [
    ...(conBusqueda ? [{ k: "relevancia", t: "Más parecidos" }] : []),
    { k: "populares", t: "Más vendidos" },
    { k: "precio", t: "Menor precio" },
    { k: "nombre", t: "De la A a la Z" },
  ];
  return (
    // En el celular: los tres tipos en una fila pareja (sin sus cifras) y el orden se desliza de lado; nada se parte.
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4">
      <div role="group" aria-label="Genérico o de marca" className="flex rounded-full border border-line bg-paper p-1 sm:inline-flex">
        <Opcion href={href({ tipo: null })} activa={!d.tipo} className="flex-1 sm:flex-none">
          Todos
        </Opcion>
        <Opcion href={href({ tipo: "generico" })} activa={d.tipo === "generico"} className="flex-1 sm:flex-none">
          Genéricos{f ? <span className="font-normal tabular-nums opacity-80 max-sm:hidden"> {numero(f.genericos)}</span> : null}
        </Opcion>
        <Opcion href={href({ tipo: "marca" })} activa={d.tipo === "marca"} className="flex-1 sm:flex-none">
          De marca{f ? <span className="font-normal tabular-nums opacity-80 max-sm:hidden"> {numero(f.marcas)}</span> : null}
        </Opcion>
      </div>
      <div role="group" aria-label="Ordenar" className="-mx-4 flex items-center gap-1 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
        <span className="shrink-0 pr-1 text-meta text-mute">Ordenar:</span>
        {ordenes.map((o) => (
          <Opcion key={o.k} href={href({ orden: o.k === (conBusqueda ? "relevancia" : "populares") ? null : o.k })} activa={orden === o.k}>
            {o.t}
          </Opcion>
        ))}
      </div>
    </div>
  );
}
