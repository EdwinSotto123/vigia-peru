import type { Metadata } from "next";
import Link from "next/link";
import { Ban, FileWarning, Gavel, Receipt, RotateCw, Scale, X } from "lucide-react";
import { Ayuda } from "@/components/patrones/Ayuda";
import { BarrasAnio } from "@/components/salud/sanciones/BarrasAnio";
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

      {/* 2026-11-21 («atosigante, sin jerarquías»): las cuatro claves eran cuatro columnas con ícono antes del buscador;
          ahora una línea y el resto detrás del ⓘ. */}
      <p className="mt-4 flex max-w-[80ch] flex-wrap items-center gap-x-1.5 text-dato leading-relaxed text-inkSoft">
        Sólo sanciones firmes, de la institución y no de sus médicos. No es el historial completo.
        <Ayuda titulo="¿Qué es y qué no es este registro?" etiqueta="Qué es y qué no es este registro">
          <span className="block"><b className="font-semibold">Sólo sanciones firmes:</b> ya no se pueden apelar en la vía administrativa. Una denuncia no aparece aquí.</span>
          <span className="mt-1 block"><b className="font-semibold">No es el historial completo:</b> SUSALUD publica cada sanción por lo menos un año y después puede retirarla.</span>
          <span className="mt-1 block"><b className="font-semibold">Algunas siguen en juicio:</b> cuando el registro dice que una sanción está en un proceso judicial, lo marcamos.</span>
          <span className="mt-1 block"><b className="font-semibold">Es de la institución:</b> la sanción de una clínica no es una sanción a sus médicos ni a quien la dirige.</span>
        </Ayuda>
      </p>

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

      {d && d.porAnio.length > 0 && <BarrasAnio porAnio={d.porAnio} activo={f.anio ?? null} enlace={(anio) => enlace({ anio })} />}

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
              <ul className="mt-3 overflow-hidden rounded-2xl border border-line bg-paper divide-y divide-line" aria-label="Sanciones firmes">
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
