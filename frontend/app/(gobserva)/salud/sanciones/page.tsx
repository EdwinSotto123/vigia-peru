import type { Metadata } from "next";
import Link from "next/link";
import { Ban, CalendarClock, FileWarning, Gavel, Receipt, RotateCw, Scale, UserX, X } from "lucide-react";
import { EstadoError, EstadoVacio } from "@/components/gobserva/ui/Estados";
import { FuenteFecha } from "@/components/salud/comun";
import { nombreLugar } from "@/components/salud/lista/filtros";
import { Paginas } from "@/components/salud/lista/Paginas";
import { Encabezado, Ruta } from "@/components/salud/portada/Piezas";
import { FilaSancion } from "@/components/salud/sanciones/FilaSancion";
import { ADMINISTRADAS, GRAVEDADES, TIPOS_FILTRO, filtrosSancionesDeUrl, paramsSanciones, qsSanciones, uit, type FiltrosSanciones } from "@/components/salud/sanciones/filtros";
import { FormSanciones } from "@/components/salud/sanciones/FormSanciones";
import { TiraCifras } from "@/components/salud/sanciones/TiraCifras";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { getSanciones, numero } from "@/lib/gobserva-salud";
import { baseProducto } from "@/lib/gobserva-servidor";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const POR_PAGINA = 25;

type Props = { searchParams?: Record<string, string | string[] | undefined> };

export function generateMetadata({ searchParams }: Props): Metadata {
  const f = filtrosSancionesDeUrl(searchParams);
  const filtrado = Object.values(f).some((v) => v != null);
  return {
    title: f.departamento ? `Sanciones firmes de SUSALUD en ${nombreLugar(f.departamento)}` : "Registro de Sanciones de SUSALUD",
    description:
      "Las sanciones firmes que SUSALUD impuso a clínicas, hospitales, aseguradoras y otras instituciones de salud: amonestaciones, multas en UIT y cierres, con su resolución, su infracción y si están en un proceso judicial.",
    alternates: { canonical: urlCanonica("salud", "/sanciones") },
    robots: filtrado ? { index: false, follow: true } : undefined,
  };
}

/**
 * /sanciones de Gobserva Salud (2026-11-20): el Registro de Sanciones de SUSALUD. Lo que es (y lo que no) en una lista con
 * íconos, las cifras de lo filtrado con su fuente y fecha, los filtros (formulario GET), los años como chips con cuántas
 * hay, una fila por sanción y la paginación. GET /salud/sanciones (10 min en caché).
 */
export default async function Sanciones({ searchParams }: Props) {
  const base = baseProducto("salud");
  const f = filtrosSancionesDeUrl(searchParams);
  const d = await getSanciones(paramsSanciones(f, POR_PAGINA));
  const lista = rutaEn(base, "/sanciones");
  const enlace = (c: Partial<FiltrosSanciones>) => `${lista}${qsSanciones({ ...f, pagina: undefined, ...c })}`;
  const paginas = d ? Math.min(500, Math.max(1, Math.ceil(d.n / POR_PAGINA))) : 1;
  const pagina = Math.min(f.pagina ?? 1, paginas);
  const fuente = <FuenteFecha nombre="Registro de Sanciones de SUSALUD" url={d?.fuente.url ?? null} al={d?.fuente.al} />;

  const puestos = [
    f.q ? { texto: `«${f.q}»`, href: enlace({ q: undefined }) } : null,
    f.ipress ? { texto: `IPRESS ${f.ipress}`, href: enlace({ ipress: undefined }) } : null,
    f.departamento ? { texto: nombreLugar(f.departamento), href: enlace({ departamento: undefined }) } : null,
    f.tipo ? { texto: TIPOS_FILTRO.find((t) => t.clave === f.tipo)?.nombre ?? f.tipo, href: enlace({ tipo: undefined }) } : null,
    f.gravedad ? { texto: `Infracción ${GRAVEDADES.find((g) => g.clave === f.gravedad)?.nombre.toLocaleLowerCase("es-PE")}`, href: enlace({ gravedad: undefined }) } : null,
    f.administrada ? { texto: ADMINISTRADAS.find((a) => a.clave === f.administrada)?.nombre ?? f.administrada, href: enlace({ administrada: undefined }) } : null,
    f.naturaleza ? { texto: f.naturaleza === "publica" ? "Públicas" : "Privadas", href: enlace({ naturaleza: undefined }) } : null,
    f.anio ? { texto: `Emitidas en ${f.anio}`, href: enlace({ anio: undefined }) } : null,
    f.judicial ? { texto: "En proceso judicial", href: enlace({ judicial: undefined }) } : null,
    f.orden ? { texto: "La multa más alta primero", href: enlace({ orden: undefined }) } : null,
  ].filter((x): x is { texto: string; href: string } => x != null);

  return (
    <div className="container-page pb-10 pt-5 sm:pb-14 sm:pt-6">
      <Ruta items={[{ etiqueta: "Inicio", href: rutaEn(base, "/") }, { etiqueta: "Sanciones" }]} />
      <Encabezado
        className="mt-2"
        titulo="Registro de Sanciones de SUSALUD"
        bajada="Las sanciones firmes que SUSALUD impuso a establecimientos de salud (IPRESS), aseguradoras (IAFAS) y unidades de gestión (UGIPRESS), con su resolución y su infracción."
      >
        {fuente}
      </Encabezado>

      <ul className="mt-5 grid gap-x-8 gap-y-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Qué es este registro">
        <Clave Icono={Gavel} titulo="Sólo sanciones firmes">
          Ya no se pueden apelar en la vía administrativa. Una denuncia no aparece aquí.
        </Clave>
        <Clave Icono={CalendarClock} titulo="No es el historial completo">
          SUSALUD publica cada sanción por lo menos un año y después puede retirarla.
        </Clave>
        <Clave Icono={Scale} titulo="Algunas siguen en juicio">
          Cuando el registro dice que una sanción está en un proceso judicial, lo marcamos.
        </Clave>
        <Clave Icono={UserX} titulo="Es de la institución">
          La sanción de una clínica no es una sanción a sus médicos ni a quien la dirige.
        </Clave>
      </ul>

      <FormSanciones accion={lista} f={f} limpiar={lista} className="mt-6" />

      {puestos.length > 0 && (
        <ul className="mt-3 flex flex-wrap items-center gap-2" aria-label="Filtros puestos">
          {puestos.map((p) => (
            <li key={p.texto}>
              <Link
                href={p.href}
                prefetch={false}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-granate/40 bg-granate-50 px-3.5 text-meta font-medium text-ink transition-colors duration-rapido hover:border-granate sm:min-h-9 sm:px-3"
              >
                {p.texto}
                <X size={13} aria-hidden />
                <span className="sr-only"> (quitar)</span>
              </Link>
            </li>
          ))}
          <li>
            <Link href={lista} prefetch={false} className="inline-flex min-h-11 items-center px-2 text-meta font-semibold text-granate underline-offset-2 hover:underline sm:min-h-9">
              Quitar todos
            </Link>
          </li>
        </ul>
      )}

      {d && d.porAnio.length > 0 && (
        <nav aria-label="Año de emisión" className="mt-4">
          <p className="text-rotulo font-medium text-inkSoft">Año de emisión (en todo el registro)</p>
          <ul className="-mx-4 mt-1.5 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden">
            <li className="shrink-0">
              <Link
                href={enlace({ anio: undefined })}
                prefetch={false}
                aria-current={!f.anio ? "true" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center whitespace-nowrap rounded-full border px-3.5 text-meta transition-colors duration-rapido sm:min-h-9",
                  !f.anio ? "border-granate bg-granate-50 font-semibold text-ink" : "border-line bg-paper text-inkSoft hover:border-granate/40 hover:text-ink",
                )}
              >
                Todos los años
              </Link>
            </li>
            {d.porAnio.map((a) => {
              const activo = f.anio === a.anio;
              return (
                <li key={a.anio} className="shrink-0">
                  <Link
                    href={enlace({ anio: activo ? undefined : a.anio })}
                    prefetch={false}
                    aria-current={activo ? "true" : undefined}
                    className={cn(
                      "inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-meta tabular-nums transition-colors duration-rapido sm:min-h-9",
                      activo ? "border-granate bg-granate-50 font-semibold text-ink" : "border-line bg-paper text-inkSoft hover:border-granate/40 hover:text-ink",
                    )}
                  >
                    {a.anio}
                    <span className="text-mute">{numero(a.n)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}

      {!d ? (
        <div className="mt-8 rounded-2xl border border-line bg-paper">
          <EstadoError
            texto="No pudimos leer el registro ahora. Suele ser momentáneo: vuelve a intentarlo en unos segundos."
            acciones={
              <a href={`${lista}${qsSanciones(f)}`} className={claseAccion("secundario", "min-h-11")}>
                <RotateCw size={15} aria-hidden /> Volver a intentar
              </a>
            }
          />
        </div>
      ) : (
        <>
          <TiraCifras
            className="mt-5"
            etiqueta="Lo que suma esta búsqueda"
            items={[
              { Icono: Gavel, valor: numero(d.n), etiqueta: d.n === 1 ? "Sanción firme" : "Sanciones firmes" },
              { Icono: Receipt, valor: numero(d.multas), etiqueta: d.multas === 1 ? "Multa" : "Multas", detalle: `Suman ${uit(d.uit)} UIT` },
              { Icono: FileWarning, valor: numero(d.amonestaciones), etiqueta: d.amonestaciones === 1 ? "Amonestación" : "Amonestaciones" },
              { Icono: Ban, valor: numero(d.cierres), etiqueta: d.cierres === 1 ? "Cierre definitivo" : "Cierres definitivos" },
              { Icono: Scale, valor: numero(d.judicializadas), etiqueta: "En proceso judicial" },
            ]}
            pie={
              <span className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                {fuente}
                <span className="text-rotulo text-mute">Las multas van en UIT, como las publica SUSALUD.</span>
              </span>
            }
          />

          {d.filas.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-line bg-paper">
              <EstadoVacio
                Icono={Gavel}
                titulo="Ninguna sanción firme con estos filtros"
                texto="Quita un filtro o busca con menos palabras. Que algo no figure en el registro no quiere decir que nunca haya sido sancionado: SUSALUD retira las sanciones antiguas."
                acciones={
                  <Link href={lista} className={claseAccion("secundario", "min-h-11")}>
                    Ver todo el registro
                  </Link>
                }
              />
            </div>
          ) : (
            <>
              <div id="resultados" className="scroll-mt-32">
                <Paginas
                  className="mt-6"
                  pagina={pagina}
                  paginas={paginas}
                  total={d.n}
                  tamano={POR_PAGINA}
                  nombre={d.n === 1 ? "sanción" : "sanciones"}
                  href={(n) => `${lista}${qsSanciones({ ...f, pagina: n })}`}
                />
              </div>
              <ul className="mt-3 space-y-3" aria-label="Sanciones firmes">
                {d.filas.map((s) => (
                  <li key={s.id} className="min-w-0">
                    <FilaSancion s={s} base={base} />
                  </li>
                ))}
              </ul>
              <Paginas
                className="mt-6"
                pagina={pagina}
                paginas={paginas}
                total={d.n}
                tamano={POR_PAGINA}
                nombre={d.n === 1 ? "sanción" : "sanciones"}
                href={(n) => `${lista}${qsSanciones({ ...f, pagina: n })}`}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

function Clave({ Icono, titulo, children }: { Icono: typeof Gavel; titulo: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-paperDeep text-ink">
        <Icono size={16} />
      </span>
      <span className="min-w-0">
        <span className="block text-dato font-semibold leading-snug text-ink">{titulo}</span>
        <span className="mt-0.5 block text-meta leading-snug text-inkSoft">{children}</span>
      </span>
    </li>
  );
}
