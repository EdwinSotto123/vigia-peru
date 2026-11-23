import Link from "next/link";
import { ArrowRight, ClipboardList, Compass, HardHat, MapPinned, Shapes, Truck, Users } from "lucide-react";
import { Odometro } from "@/components/gobserva/portada/Odometro";
import { PestanasVivas } from "@/components/gobserva/portada/PestanasVivas";
import { RuedaAlVer } from "@/components/gobserva/portada/RuedaAlVer";
import { BarrasDobles } from "@/components/gobserva-obras/Graficas";
import { numero, solesCompacto } from "@/lib/formato";
import { rutaEn } from "@/lib/gobserva";
import { nombreSector, type ResumenObras } from "@/lib/gobserva-obras";
import { nombreRegion } from "@/lib/licitaciones";

/**
 * «Dónde está la plata» en la portada de Gobserva Obras (2026-11-22): tres secciones que medían 3,000 px en el celular
 * (por región, por sector y para quién es) en tres pestañas, con la cifra total que rueda cuando llega a la pantalla.
 * Server-safe.
 */
export function DondeLaPlata({ r, base }: { r: ResumenObras; base: string }) {
  const ruta = (p: string) => rutaEn(base, p);
  const lista = (qs: string) => `${ruta("/proyectos")}${qs}`;
  const anio = new Date().getFullYear();
  return (
    <section aria-labelledby="plata-t">
      <h2 id="plata-t" className="text-balance font-display text-seccion font-bold leading-tight text-ink sm:text-titulo">
        Dónde está la plata
      </h2>
      <p className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-ink">
        <RuedaAlVer>
          <Odometro texto={solesCompacto(r.seVienenMonto)} className="font-display text-cifra font-bold leading-none tracking-[-0.02em] sm:text-vitrina" />
        </RuedaAlVer>
        <span className="text-cuerpo text-inkSoft">
          se vienen en obras sin contratista, y {solesCompacto(r.enMarchaMonto)} están en ejecución.
        </span>
      </p>
      <PestanasVivas
        etiqueta="La plata de las obras"
        className="mt-5"
        pestanas={[
          { titulo: "Por región", icono: <MapPinned size={16} aria-hidden /> },
          { titulo: "Qué se construye", icono: <Shapes size={16} aria-hidden /> },
          { titulo: "Para quién es", icono: <Users size={16} aria-hidden /> },
        ]}
      >
        <div>
          <BarrasDobles
            etiqueta="Monto por región"
            serieA="Se vienen"
            serieB="En ejecución"
            columnas={2}
            visibles={6}
            mas="Ver las otras {n} regiones"
            filas={r.porRegion.map((x) => ({
              clave: x.clave,
              etiqueta: nombreRegion(x.clave),
              a: x.seVienenMonto,
              b: x.enMarchaMonto,
              detalle: `${numero(x.seVienen)} se vienen, ${numero(x.enMarcha)} en marcha${x.paralizadas ? `, ${numero(x.paralizadas)} paralizadas` : ""}`,
              href: lista(`?region=${x.clave}`),
            }))}
          />
          <Link href={ruta("/mercado")} className="group mt-3 inline-flex min-h-11 items-center gap-1 text-dato font-semibold text-granate underline-offset-4 hover:underline">
            Ver el mercado de tu región <ArrowRight size={15} aria-hidden className="transition-transform duration-rapido group-hover:translate-x-0.5" />
          </Link>
        </div>
        <div>
          <BarrasDobles
            etiqueta="Monto por sector"
            serieA="Se vienen"
            serieB="En ejecución"
            columnas={2}
            visibles={6}
            mas="Ver los otros {n} sectores"
            filas={r.porSector
              .filter((x) => x.clave !== "otros" && (x.seVienen > 0 || x.enMarcha > 0))
              .map((x) => ({
                clave: x.clave,
                etiqueta: nombreSector(x.clave),
                a: x.seVienenMonto,
                b: x.enMarchaMonto,
                detalle: `${numero(x.seVienen)} se vienen, ${numero(x.enMarcha)} en marcha`,
                href: lista(`?sector=${x.clave}`),
              }))}
          />
          <p className="mt-3 text-meta text-mute">
            Por sector, la función del MEF. Presupuesto de inversión {anio} de estos proyectos: {solesCompacto(r.pimAnio)}, con {solesCompacto(r.devengadoAnio)} ya gastado.
          </p>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          <ParaQuien
            Icono={HardHat}
            titulo="Constructoras"
            texto="Las obras con expediente técnico antes de la convocatoria, las que se licitan hoy y los saldos de obra de las paralizadas."
            href={lista("?fase=expediente")}
            accion="Ver las que tienen expediente"
          />
          <ParaQuien
            Icono={ClipboardList}
            titulo="Consultoras y supervisoras"
            texto="Los proyectos viables sin expediente técnico y las obras que van a necesitar supervisión."
            href={lista("?fase=viable")}
            accion="Ver los viables sin expediente"
          />
          <ParaQuien
            Icono={Truck}
            titulo="Proveedores de materiales y equipos"
            texto="Las obras en marcha, también las que hace la entidad por administración directa, y la compra de equipos que se viene."
            href={lista("?tipo=equipamiento")}
            accion="Ver la compra de equipos"
          />
          <ParaQuien
            Icono={Compass}
            titulo="Bancos, aseguradoras y gremios"
            texto="El tamaño del mercado por región y sector, el presupuesto del año y cuánto se queda paralizado."
            href={ruta("/mercado")}
            accion="Ver el mercado"
          />
        </ul>
      </PestanasVivas>
    </section>
  );
}

function ParaQuien({ Icono, titulo, texto, href, accion }: { Icono: typeof HardHat; titulo: string; texto: string; href: string; accion: string }) {
  return (
    <li className="min-w-0">
      <Link
        href={href}
        className="gs-mira group flex h-full gap-3 rounded-2xl border border-line bg-paper p-4 transition-colors duration-rapido hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
      >
        <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-granate-50 text-granate">
          <Icono size={19} />
        </span>
        <span className="min-w-0">
          <span className="block font-display text-bloque font-bold leading-tight text-ink">{titulo}</span>
          <span className="mt-1 block text-dato leading-relaxed text-inkSoft">{texto}</span>
          <span className="mt-2 inline-flex items-center gap-1 text-dato font-semibold text-granate">
            {accion} <ArrowRight size={14} aria-hidden className="transition-transform duration-rapido group-hover:translate-x-0.5" />
          </span>
        </span>
      </Link>
    </li>
  );
}
