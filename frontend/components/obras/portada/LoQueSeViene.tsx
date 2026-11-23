import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, ArrowUpRight, FileCheck2, HardHat, Megaphone, PackageSearch, Ruler, Sparkles } from "lucide-react";
import { PestanasVivas } from "@/components/gobserva/portada/PestanasVivas";
import { BarraAvance, FaseInsignia, iconoSector } from "@/components/gobserva-obras/Piezas";
import { TarjetaProyecto } from "@/components/gobserva-obras/TarjetaProyecto";
import { fechaCorta, numero, solesCompacto } from "@/lib/formato";
import { PRODUCTOS, rutaEn } from "@/lib/gobserva";
import { haceTiempo, lugarProyecto, nombreEmpresa, nombreEntidad, nombreProyecto, nombreSector, procesoConvocado, type ResumenObras } from "@/lib/gobserva-obras";
import { nombreRegion } from "@/lib/licitaciones";
import { cn } from "@/lib/utils";

/**
 * «Lo que se viene» en la portada de Gobserva Obras (2026-11-22, el usuario: «portadas más cortas»): el camino de una obra
 * en cuatro pestañas en vez de cinco secciones apiladas (el camino, los que se vienen, los que se licitan, los recién
 * viables y los que están en marcha medían 5,000 px en el celular). Cada pestaña dice cuántos hay hoy, muestra los
 * primeros y lleva a la lista con su filtro. Cada fila se toca entera y la mira de Gobserva se cierra sobre ella.
 * Server-safe (las pestañas son el único cliente).
 */
export function LoQueSeViene({ r, base }: { r: ResumenObras; base: string }) {
  const ruta = (p: string) => rutaEn(base, p);
  const lista = (qs: string) => `${ruta("/proyectos")}${qs}`;
  const licitaciones = `https://${PRODUCTOS.licitaciones.host}`;

  type Pestana = { titulo: ReactNode; icono: ReactNode; panel: ReactNode };
  const pestanas = ([
    r.seVienenTop.length > 0 && { titulo: <Titulo texto="Con expediente" n={r.expediente} />, icono: <FileCheck2 size={16} aria-hidden />, panel: SeVienen() },
    r.licitandoTop.length > 0 && { titulo: <Titulo texto="Licitándose" n={r.licitando} />, icono: <Megaphone size={16} aria-hidden />, panel: Licitando() },
    r.nuevos.length > 0 && { titulo: <Titulo texto="Recién viables" n={r.nuevos30} />, icono: <Sparkles size={16} aria-hidden />, panel: Nuevos() },
    r.enMarchaTop.length > 0 && { titulo: <Titulo texto="En ejecución" n={r.enMarcha} />, icono: <HardHat size={16} aria-hidden />, panel: EnMarcha() },
  ] as (Pestana | false)[]).filter((x): x is Pestana => !!x);
  if (!pestanas.length) return null;

  return (
    <section aria-labelledby="seviene-t">
      <h2 id="seviene-t" className="text-balance font-display text-seccion font-bold leading-tight text-ink sm:text-titulo">
        Llega antes de que se licite
      </h2>
      <p className="mt-2 max-w-[62ch] text-pretty text-cuerpo leading-relaxed text-inkSoft">
        Toda obra pública pasa por estos pasos. Con expediente técnico y sin contratista es el momento de preparar tu oferta.
      </p>
      <PestanasVivas etiqueta="El camino de una obra, hoy" className="mt-5" pestanas={pestanas.map(({ titulo, icono }) => ({ titulo, icono }))}>
        {pestanas.map((p, i) => (
          <div key={i}>{p.panel}</div>
        ))}
      </PestanasVivas>
    </section>
  );

  function SeVienen() {
    return (
      <>
        <p className="text-dato text-inkSoft">Los más grandes declarados viables en los últimos dos años: lo siguiente es licitar la obra.</p>
        {/* En el celular, una fila que se desliza; desde md, la rejilla con los primeros que entran en una fila. */}
        <ul
          aria-label="Proyectos con expediente técnico que se vienen"
          className="-mx-4 mt-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:-mx-6 sm:px-6 md:mx-0 md:grid md:grid-cols-2 md:gap-4 md:overflow-visible md:px-0 md:pb-0 xl:grid-cols-3 md:[&>li:nth-child(n+5)]:hidden xl:[&>li:nth-child(n+4)]:hidden [&::-webkit-scrollbar]:hidden"
        >
          {r.seVienenTop.map((p) => (
            <li key={p.cui} className="w-[85%] min-w-0 shrink-0 snap-start scroll-ml-4 sm:w-[60%] sm:scroll-ml-6 md:w-auto">
              <TarjetaProyecto p={p} base={base} compacta />
            </li>
          ))}
        </ul>
        <ul aria-label="Atajos" className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:-mx-6 sm:px-6 md:mx-0 md:flex-wrap md:px-0 [&::-webkit-scrollbar]:hidden">
          <Atajo href={lista("?min=10000000")} Icono={Ruler} texto={`De S/ 10 millones o más: ${numero(r.seVienen10m)}`} />
          <Atajo href={lista("?modalidad=contrata")} Icono={HardHat} texto={`Por contrata: ${numero(r.seVienenContrata)}`} />
          <Atajo href={lista("?tipo=equipamiento")} Icono={PackageSearch} texto={`Compra de equipos: ${numero(r.seVienenEquipamiento)}`} />
        </ul>
        <VerTodos href={lista("?fase=expediente")} texto={`Ver los ${numero(r.expediente)} con expediente técnico`} />
      </>
    );
  }

  function Licitando() {
    return (
      <>
        <p className="text-dato text-inkSoft">Con un proceso de obra en convocatoria en el SEACE. El cronograma y las bases, en Gobserva Licitaciones.</p>
        <ol className="mt-3 grid gap-x-6 lg:grid-cols-2">
          {/* recorte: los cuatro primeros; la lista entera en «Ver los … que se están licitando», debajo */}
          {r.licitandoTop.slice(0, 4).map((p) => (
            <Fila key={p.cui} href={ruta(`/proyecto/${p.cui}`)} titulo={nombreProyecto(p.nombre, p)} monto={p.costo}>
              <span>{nombreEntidad(p.entidad)}</span>
              {p.convocatoriaFecha && (
                <span className="text-amberTexto">
                  {procesoConvocado(p.convocatoriaTipo)} {haceTiempo(p.convocatoriaFecha)}
                </span>
              )}
              {p.convocatoriaOcid && (
                <a
                  href={`${licitaciones}/oportunidad/${encodeURIComponent(p.convocatoriaOcid)}`}
                  className="relative z-[3] inline-flex items-center gap-0.5 font-semibold text-granate underline-offset-2 hover:underline"
                >
                  Ver la convocatoria <ArrowUpRight size={13} aria-hidden />
                </a>
              )}
            </Fila>
          ))}
        </ol>
        <VerTodos href={lista("?fase=licitacion")} texto={`Ver los ${numero(r.licitando)} que se están licitando`} />
      </>
    );
  }

  function Nuevos() {
    return (
      <>
        <p className="text-dato text-inkSoft">Los últimos de S/ 1 millón o más: lo que acaba de nacer y todavía necesita su expediente técnico.</p>
        <ol className="mt-3 grid gap-x-6 lg:grid-cols-2">
          {r.nuevos.slice(0, 4).map((p) => {
            const Icono = iconoSector(p.sector);
            return (
              <Fila
                key={p.cui}
                href={ruta(`/proyecto/${p.cui}`)}
                titulo={nombreProyecto(p.nombre, p)}
                monto={p.costo}
                icono={
                  <span aria-hidden className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-granate-50 text-granate">
                    <Icono size={16} />
                  </span>
                }
              >
                <span>{p.region ? nombreRegion(p.region) : "Varias regiones"}</span>
                <span>{p.fechaViable ? `Viable ${haceTiempo(p.fechaViable)}` : nombreSector(p.sector)}</span>
              </Fila>
            );
          })}
        </ol>
        <VerTodos href={lista("?orden=reciente")} texto={`Ver los ${numero(r.nuevos30)} de los últimos 30 días`} />
      </>
    );
  }

  function EnMarcha() {
    return (
      <>
        <p className="text-dato text-inkSoft">Las más grandes, con su avance físico en INFOBRAS y quién las construye: la demanda de materiales y supervisión de hoy.</p>
        <ol className="mt-3 grid gap-x-6 lg:grid-cols-2">
          {r.enMarchaTop.slice(0, 4).map((p) => (
            <Fila
              key={p.cui}
              href={ruta(`/proyecto/${p.cui}`)}
              titulo={nombreProyecto(p.nombre, p)}
              monto={p.costo}
              arriba={
                <span className="flex flex-wrap items-center gap-1.5">
                  <FaseInsignia fase={p.fase} />
                  <span className="text-rotulo text-mute">{lugarProyecto(p)}</span>
                </span>
              }
              abajo={
                p.obraRepresenta && p.obraFisico != null ? (
                  <BarraAvance className="mt-2" real={p.obraFisico} programado={p.obraProgramado} pie={p.obraAvanceAl ? `INFOBRAS, ${fechaCorta(p.obraAvanceAl)}` : undefined} />
                ) : (
                  <BarraAvance className="mt-2" real={p.avanceMef} etiqueta="Avance físico (MEF)" />
                )
              }
            >
              <span className="truncate">{p.ejecutor && p.obraRepresenta ? nombreEmpresa(p.ejecutor) : nombreEntidad(p.entidad)}</span>
            </Fila>
          ))}
        </ol>
        <VerTodos href={lista("?pestana=en_marcha")} texto={`Ver las ${numero(r.enMarcha)} en ejecución`} />
      </>
    );
  }
}

function Titulo({ texto, n }: { texto: string; n: number }) {
  return (
    <>
      {texto}
      <span className="rounded-full bg-ink/[0.06] px-2 py-0.5 text-meta font-semibold tabular-nums">{numero(n)}</span>
    </>
  );
}

/**
 * Una fila de proyecto: el título es el enlace y su `::after` cubre la fila entera (se toca en cualquier parte); los
 * enlaces de adentro van encima (`z-[3]`). La mira (`gs-mira`) se cierra al pasar sobre la fila.
 */
function Fila({
  href,
  titulo,
  monto,
  icono,
  arriba,
  abajo,
  children,
}: {
  href: string;
  titulo: string;
  monto: number | null | undefined;
  icono?: ReactNode;
  arriba?: ReactNode;
  abajo?: ReactNode;
  children: ReactNode;
}) {
  return (
    <li className="gs-mira -mx-3 flex gap-3 rounded-2xl px-3 py-3.5 transition-colors duration-rapido hover:bg-paperSoft">
      {icono}
      <div className="min-w-0 flex-1">
        {arriba}
        <div className={cn("flex items-start justify-between gap-3", arriba && "mt-1.5")}>
          <Link
            href={href}
            className="group line-clamp-2 text-dato font-semibold leading-snug text-ink after:absolute after:inset-0 after:z-[1] after:rounded-2xl hover:text-granate focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-granate"
          >
            {titulo}
          </Link>
          <span className="shrink-0 font-display text-dato font-bold tabular-nums text-ink">{monto ? solesCompacto(monto) : "Sin dato"}</span>
        </div>
        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-meta text-inkSoft">{children}</p>
        {abajo}
      </div>
    </li>
  );
}

function Atajo({ href, Icono, texto }: { href: string; Icono: typeof Ruler; texto: string }) {
  return (
    <li className="shrink-0">
      <Link
        href={href}
        className="inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full border border-line bg-paper px-4 text-meta font-semibold text-ink transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50 sm:min-h-10"
      >
        <Icono size={15} aria-hidden className="text-granate" /> {texto}
      </Link>
    </li>
  );
}

function VerTodos({ href, texto }: { href: string; texto: string }) {
  return (
    <Link href={href} className="group mt-3 inline-flex min-h-11 items-center gap-1 text-dato font-semibold text-granate underline-offset-4 hover:underline">
      {texto} <ArrowRight size={15} aria-hidden className="transition-transform duration-rapido group-hover:translate-x-0.5" />
    </Link>
  );
}
