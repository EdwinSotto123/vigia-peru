import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, ArrowUpRight, FileCheck2, HardHat, Landmark, MapPin, Megaphone, PackageSearch, Ruler, Sparkles } from "lucide-react";
import { PestanasVivas } from "@/components/gobserva/portada/PestanasVivas";
import { BarraAvance, FaseInsignia, iconoSector } from "@/components/gobserva-obras/Piezas";
import { TarjetaProyecto } from "@/components/gobserva-obras/TarjetaProyecto";
import { fechaCorta, numero, solesCompacto } from "@/lib/formato";
import { PRODUCTOS, rutaEn } from "@/lib/gobserva";
import { haceTiempo, lugarProyecto, nombreEmpresa, nombreEntidad, nombreProyecto, nombreSector, procesoConvocado, type ResumenObras } from "@/lib/gobserva-obras";
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
    const lista4 = r.licitandoTop.slice(0, 4);
    const max = Math.max(...lista4.map((p) => p.costo ?? 0), 1);
    return (
      <>
        <p className="text-dato text-inkSoft">Con un proceso de obra en convocatoria en el SEACE. El cronograma y las bases, en Gobserva Licitaciones.</p>
        <Fichas etiqueta="Obras que se están licitando">
          {/* recorte: las cuatro primeras; la lista entera en «Ver los … que se están licitando», debajo */}
          {lista4.map((p) => (
            <Ficha
              key={p.cui}
              href={ruta(`/proyecto/${p.cui}`)}
              titulo={nombreProyecto(p.nombre, p)}
              monto={p.costo}
              max={max}
              sector={p.sector}
              lugar={lugarProyecto(p)}
              quien={nombreEntidad(p.entidad)}
              estado={
                <Estado vivo>
                  {p.convocatoriaFecha ? `${procesoConvocado(p.convocatoriaTipo)} ${haceTiempo(p.convocatoriaFecha)}` : "Licitándose"}
                </Estado>
              }
              accion={
                p.convocatoriaOcid ? (
                  <a
                    href={`${licitaciones}/oportunidad/${encodeURIComponent(p.convocatoriaOcid)}`}
                    className="relative z-[3] inline-flex min-h-10 items-center gap-1.5 rounded-full border border-line bg-paper px-3.5 text-meta font-semibold text-ink transition-colors duration-rapido hover:border-granate/50 hover:text-granate"
                  >
                    Ver la convocatoria <ArrowUpRight size={14} aria-hidden />
                  </a>
                ) : null
              }
            />
          ))}
        </Fichas>
        <VerTodos href={lista("?fase=licitacion")} texto={`Ver los ${numero(r.licitando)} que se están licitando`} />
      </>
    );
  }

  function Nuevos() {
    const lista4 = r.nuevos.slice(0, 4);
    const max = Math.max(...lista4.map((p) => p.costo ?? 0), 1);
    return (
      <>
        <p className="text-dato text-inkSoft">Los últimos de S/ 1 millón o más: lo que acaba de nacer y todavía necesita su expediente técnico.</p>
        <Fichas etiqueta="Proyectos recién declarados viables">
          {/* recorte: los cuatro primeros; la lista entera en «Ver los … de los últimos 30 días», debajo */}
          {lista4.map((p) => (
            <Ficha
              key={p.cui}
              href={ruta(`/proyecto/${p.cui}`)}
              titulo={nombreProyecto(p.nombre, p)}
              monto={p.costo}
              max={max}
              sector={p.sector}
              lugar={p.region ? lugarProyecto(p) : "Varias regiones"}
              quien={nombreEntidad(p.entidad)}
              estado={<Estado>{p.fechaViable ? `Viable ${haceTiempo(p.fechaViable)}` : nombreSector(p.sector)}</Estado>}
            />
          ))}
        </Fichas>
        <VerTodos href={lista("?orden=reciente")} texto={`Ver los ${numero(r.nuevos30)} de los últimos 30 días`} />
      </>
    );
  }

  function EnMarcha() {
    const lista4 = r.enMarchaTop.slice(0, 4);
    const max = Math.max(...lista4.map((p) => p.costo ?? 0), 1);
    return (
      <>
        <p className="text-dato text-inkSoft">Las más grandes, con su avance físico en INFOBRAS y quién las construye: la demanda de materiales y supervisión de hoy.</p>
        <Fichas etiqueta="Obras más grandes en ejecución">
          {/* recorte: las cuatro más grandes; la lista entera en «Ver las … en ejecución», debajo */}
          {lista4.map((p) => (
            <Ficha
              key={p.cui}
              href={ruta(`/proyecto/${p.cui}`)}
              titulo={nombreProyecto(p.nombre, p)}
              monto={p.costo}
              max={max}
              sector={p.sector}
              lugar={lugarProyecto(p)}
              quien={p.ejecutor && p.obraRepresenta ? nombreEmpresa(p.ejecutor) : nombreEntidad(p.entidad)}
              estado={<FaseInsignia fase={p.fase} />}
              abajo={
                p.obraRepresenta && p.obraFisico != null ? (
                  <BarraAvance real={p.obraFisico} programado={p.obraProgramado} pie={p.obraAvanceAl ? `INFOBRAS, ${fechaCorta(p.obraAvanceAl)}` : undefined} />
                ) : (
                  <BarraAvance real={p.avanceMef} etiqueta="Avance físico (MEF)" />
                )
              }
            />
          ))}
        </Fichas>
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

/** Las fichas de una pestaña: en el celular una fila que se desliza (cuatro apiladas eran una pantalla y media); desde md, dos columnas. */
function Fichas({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <ul
      aria-label={etiqueta}
      className="-mx-4 mt-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:-mx-6 sm:px-6 md:mx-0 md:grid md:grid-cols-2 md:gap-4 md:overflow-visible md:px-0 md:pb-0 [&::-webkit-scrollbar]:hidden"
    >
      {children}
    </ul>
  );
}

/** El estado de la obra en una pastilla; `vivo`: con un punto que late (se está licitando ahora). */
function Estado({ vivo = false, children }: { vivo?: boolean; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-meta font-semibold", vivo ? "bg-amber/15 text-amberTexto" : "bg-granate-50 text-granate")}>
      {vivo && (
        <span aria-hidden className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full rounded-full bg-amber opacity-60 motion-safe:animate-ping" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-amber" />
        </span>
      )}
      {children}
    </span>
  );
}

/**
 * Una obra como ficha (2026-11-22, el usuario: «esta mierda es texto plano»): el ícono de su sector, su estado en una
 * pastilla, el nombre, el monto grande con una barra que lo compara con el mayor de la pestaña (crece a pasos), quién y
 * dónde con su ícono, y el avance o el enlace a la convocatoria. Se toca entera: el `::after` del título cubre la ficha y
 * lo de adentro con enlace va encima (`z-[3]`). La mira se cierra al pasar.
 */
function Ficha({
  href,
  titulo,
  monto,
  max,
  sector,
  lugar,
  quien,
  estado,
  accion,
  abajo,
}: {
  href: string;
  titulo: string;
  monto: number | null | undefined;
  max: number;
  sector: string | null | undefined;
  lugar: string;
  quien: string;
  estado: ReactNode;
  accion?: ReactNode;
  abajo?: ReactNode;
}) {
  const Icono = iconoSector(sector ?? null);
  const pct = monto ? Math.max(6, Math.round((monto / max) * 100)) : 0;
  return (
    <li className="gs-mira relative flex w-[86%] min-w-0 shrink-0 snap-start scroll-ml-4 flex-col rounded-2xl border border-line bg-paper p-4 transition-colors duration-rapido hover:border-granate/40 sm:w-[62%] sm:scroll-ml-6 sm:p-5 md:w-auto">
      <div className="flex items-start justify-between gap-3">
        <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-granate-50 text-granate">
          <Icono size={19} />
        </span>
        {estado}
      </div>
      <Link
        href={href}
        className="mt-3 line-clamp-3 text-dato font-semibold leading-snug text-ink after:absolute after:inset-0 after:z-[1] after:rounded-2xl hover:text-granate focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-granate"
      >
        {titulo}
      </Link>
      <div className="mt-3">
        <span className="font-display text-seccion font-bold leading-none tabular-nums text-ink">{monto ? solesCompacto(monto) : "Sin monto"}</span>
        {pct > 0 && (
          <span aria-hidden className="mt-2 block h-1.5 overflow-hidden rounded-full bg-ink/[0.06]">
            <span className="gs-barra-crece block h-full rounded-full bg-granate" style={{ width: `${pct}%` }} />
          </span>
        )}
      </div>
      <ul className="mt-3 space-y-1 text-meta text-inkSoft">
        <li className="flex items-start gap-1.5">
          <Landmark size={14} aria-hidden className="mt-0.5 shrink-0 text-mute" />
          <span className="line-clamp-1">{quien}</span>
        </li>
        <li className="flex items-start gap-1.5">
          <MapPin size={14} aria-hidden className="mt-0.5 shrink-0 text-mute" />
          <span className="line-clamp-1">{lugar}</span>
        </li>
      </ul>
      {abajo && <div className="mt-3">{abajo}</div>}
      {accion && <div className="mt-auto pt-4">{accion}</div>}
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
