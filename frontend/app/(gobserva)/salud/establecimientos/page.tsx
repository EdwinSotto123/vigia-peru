import type { Metadata } from "next";
import Link from "next/link";
import { Building2, Gavel, Info, MapPinned, RotateCw, X } from "lucide-react";
import { EstadoError, EstadoVacio } from "@/components/gobserva/ui/Estados";
import { FuenteFecha } from "@/components/salud/comun";
import { URL_RENIPRESS_CONSULTA, URL_SANCIONES } from "@/components/salud/fuentes/urls";
import { FilaEstablecimiento } from "@/components/salud/lista/FilaEstablecimiento";
import { ESTADOS, ORDENES, filtrosDeUrl, filtrosMapa, nombreCategoria, nombreLugar, nombreTipo, paramsApi, qsLista, type FiltrosLista } from "@/components/salud/lista/filtros";
import { FiltrosEstablecimientos } from "@/components/salud/lista/FiltrosEstablecimientos";
import { Paginas } from "@/components/salud/lista/Paginas";
import { Encabezado, Ruta, Tesela } from "@/components/salud/portada/Piezas";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { SECTORES, getEstablecimientos, getResumenSalud, numero } from "@/lib/gobserva-salud";
import { baseProducto } from "@/lib/gobserva-servidor";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const POR_PAGINA = 25;

type Props = { searchParams?: Record<string, string | string[] | undefined> };

/** «Establecimientos de salud privados en Arequipa con sanción firme». */
function tituloLista(f: FiltrosLista): string {
  const partes = ["Establecimientos de salud"];
  if (f.sector) partes.push(f.sector === "publico" ? "públicos" : f.sector === "privado" ? "privados" : "de otro sector");
  if (f.distrito) partes.push(`en ${nombreLugar(f.distrito)}`);
  else if (f.provincia) partes.push(`en ${nombreLugar(f.provincia)}`);
  else if (f.departamento) partes.push(`en ${nombreLugar(f.departamento)}`);
  if (f.sanciones === "con") partes.push("con sanción firme");
  if (f.estado === "inactivos") partes.push("inactivos");
  return partes.join(" ");
}

export function generateMetadata({ searchParams }: Props): Metadata {
  const f = filtrosDeUrl(searchParams);
  const filtrado = Object.values(f).some((v) => v != null);
  return {
    title: tituloLista(f),
    description:
      "Todos los establecimientos de salud del Perú registrados en RENIPRESS (SUSALUD): su categoría, su sector, su estado y si tienen sanciones firmes o denuncias, con su fuente y su fecha. Filtra por departamento, categoría y tipo.",
    alternates: { canonical: urlCanonica("salud", "/establecimientos") },
    // Una combinación de filtros no es una página para el buscador: la lista entera sí.
    robots: filtrado ? { index: false, follow: true } : undefined,
  };
}

/**
 * /establecimientos de Gobserva Salud (2026-11-20): todas las IPRESS de RENIPRESS, con los filtros en la URL (formulario
 * GET, plegado en el celular), los filtros puestos como chips para quitar, las provincias del departamento elegido, lo que
 * suma la búsqueda (con su fuente y fecha), una fila por establecimiento con sus hechos rotulados y la paginación.
 * GET /salud/establecimientos (10 min en caché).
 */
export default async function Establecimientos({ searchParams }: Props) {
  const base = baseProducto("salud");
  const f = filtrosDeUrl(searchParams);
  const [d, r] = await Promise.all([getEstablecimientos(paramsApi(f, POR_PAGINA)), getResumenSalud()]);
  const lista = rutaEn(base, "/establecimientos");
  const enlace = (c: Partial<FiltrosLista>) => `${lista}${qsLista({ ...f, pagina: undefined, ...c })}`;
  const paginas = d ? Math.min(2000, Math.max(1, Math.ceil(d.total / POR_PAGINA))) : 1;
  const pagina = Math.min(f.pagina ?? 1, paginas);
  const fuentes = r?.fuentes;

  const puestos = [
    f.q ? { texto: `«${f.q}»`, href: enlace({ q: undefined }) } : null,
    f.departamento ? { texto: nombreLugar(f.departamento), href: enlace({ departamento: undefined, provincia: undefined, distrito: undefined }) } : null,
    f.provincia ? { texto: `Provincia de ${nombreLugar(f.provincia)}`, href: enlace({ provincia: undefined, distrito: undefined }) } : null,
    f.distrito ? { texto: `Distrito de ${nombreLugar(f.distrito)}`, href: enlace({ distrito: undefined }) } : null,
    f.categoria ? { texto: `Categoría ${f.categoria.split(",").map(nombreCategoria).join(", ")}`, href: enlace({ categoria: undefined }) } : null,
    f.sector ? { texto: SECTORES[f.sector], href: enlace({ sector: undefined }) } : null,
    f.tipo ? { texto: nombreTipo(f.tipo), href: enlace({ tipo: undefined }) } : null,
    f.estado ? { texto: ESTADOS.find((e) => e.clave === f.estado)?.nombre ?? f.estado, href: enlace({ estado: undefined }) } : null,
    f.sanciones === "con" ? { texto: "Con sanción firme", href: enlace({ sanciones: undefined }) } : null,
    f.sanciones === "sin" ? { texto: "Sin sanción firme en el registro", href: enlace({ sanciones: undefined }) } : null,
    f.quirurgico ? { texto: "Con centro quirúrgico", href: enlace({ quirurgico: undefined }) } : null,
    f.internamiento ? { texto: "Con internamiento", href: enlace({ internamiento: undefined }) } : null,
    f.orden ? { texto: `Orden: ${ORDENES.find((o) => o.clave === f.orden)?.nombre.toLocaleLowerCase("es-PE") ?? f.orden}`, href: enlace({ orden: undefined }) } : null,
  ].filter((x): x is { texto: string; href: string } => x != null);

  const provincias = f.departamento && d ? d.facetas.provincia : [];
  const mapa = `${rutaEn(base, "/mapa")}${qsLista(filtrosMapa(f))}`;

  return (
    <div className="container-page pb-10 pt-5 sm:pb-14 sm:pt-6">
      <Ruta items={[{ etiqueta: "Inicio", href: rutaEn(base, "/") }, { etiqueta: "Establecimientos" }]} />
      <Encabezado
        className="mt-2"
        titulo={tituloLista(f)}
        bajada="Hospitales, clínicas, centros y puestos de salud, consultorios y servicios de apoyo inscritos en RENIPRESS, el registro de SUSALUD. Toca uno para ver su verificación completa."
      >
        <FuenteFecha nombre="RENIPRESS (SUSALUD)" url={URL_RENIPRESS_CONSULTA} al={fuentes?.renipressAl} />
      </Encabezado>

      <FiltrosEstablecimientos accion={lista} f={f} facetas={d?.facetas} limpiar={lista} className="mt-5" />

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

      {provincias.length > 1 && (
        <nav aria-label={`Provincias de ${nombreLugar(f.departamento)}`} className="mt-4">
          <p className="text-rotulo font-medium text-inkSoft">Provincias de {nombreLugar(f.departamento)}</p>
          <ul className="-mx-4 mt-1.5 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden">
            {provincias.map((p) => {
              const activa = f.provincia === p.clave;
              return (
                <li key={p.clave} className="shrink-0">
                  <Link
                    href={enlace({ provincia: activa ? undefined : p.clave, distrito: undefined })}
                    prefetch={false}
                    aria-current={activa ? "true" : undefined}
                    className={cn(
                      "inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-meta transition-colors duration-rapido sm:min-h-9",
                      activa ? "border-granate bg-granate-50 font-semibold text-ink" : "border-line bg-paper text-inkSoft hover:border-granate/40 hover:text-ink",
                    )}
                  >
                    {nombreLugar(p.clave)}
                    <span className="tabular-nums text-mute">{numero(p.n)}</span>
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
            texto="No pudimos leer la lista ahora. Suele ser momentáneo: vuelve a intentarlo en unos segundos."
            acciones={
              <a href={`${lista}${qsLista(f)}`} className={claseAccion("secundario", "min-h-11")}>
                <RotateCw size={15} aria-hidden /> Volver a intentar
              </a>
            }
          />
        </div>
      ) : (
        <>
          <div id="resultados" className="mt-5 grid scroll-mt-32 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-stretch">
            <Tesela
              Icono={Building2}
              valor={numero(d.total)}
              etiqueta={d.total === 1 ? "establecimiento con estos filtros" : "establecimientos con estos filtros"}
              pie={<FuenteFecha nombre="RENIPRESS (SUSALUD)" url={URL_RENIPRESS_CONSULTA} al={fuentes?.renipressAl} />}
            />
            <Tesela
              Icono={Gavel}
              tono="hecho"
              valor={numero(d.conSanciones)}
              etiqueta={d.conSanciones === 1 ? "tiene al menos una sanción firme" : "tienen al menos una sanción firme"}
              detalle="La sanción es de la institución, no de sus médicos."
              pie={<FuenteFecha nombre="Registro de Sanciones (SUSALUD)" url={URL_SANCIONES} al={fuentes?.sancionesAl} />}
              href={f.sanciones === "con" ? undefined : enlace({ sanciones: "con" })}
            />
            <Link
              href={mapa}
              className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-line bg-paper px-5 text-dato font-semibold text-ink transition-colors duration-rapido hover:border-granate/40 hover:text-granate sm:col-span-2 lg:col-span-1"
            >
              <MapPinned size={17} aria-hidden className="text-granate" /> Verlos en el mapa
            </Link>
          </div>

          {f.quirurgico && fuentes && (
            <p role="note" className="mt-3 flex items-start gap-2 rounded-xl border border-line bg-paperSoft px-3.5 py-3 text-meta leading-relaxed text-inkSoft">
              <Info size={15} aria-hidden className="mt-0.5 shrink-0 text-mute" />
              <span>
                El centro quirúrgico sale del detalle de cada establecimiento en RENIPRESS, y ya lo leímos en {numero(fuentes.detalle.leidas)} de{" "}
                {numero(fuentes.detalle.total)}. Los demás aparecerán con este filtro a medida que se lea su detalle.
              </span>
            </p>
          )}

          {d.filas.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-line bg-paper">
              <EstadoVacio
                titulo="Ningún establecimiento con estos filtros"
                texto="Quita un filtro o busca con menos palabras (el distrito en vez del nombre exacto). Si buscas a un médico, su habilitación se verifica en el Colegio Médico."
                acciones={
                  <>
                    <Link href={lista} className={claseAccion("secundario", "min-h-11")}>
                      Ver todos
                    </Link>
                    <Link href={rutaEn(base, "/medico")} className={claseAccion("secundario", "min-h-11")}>
                      Verificar a un médico
                    </Link>
                  </>
                }
              />
            </div>
          ) : (
            <>
              <Paginas
                className="mt-6"
                pagina={pagina}
                paginas={paginas}
                total={d.total}
                tamano={POR_PAGINA}
                nombre={d.total === 1 ? "establecimiento" : "establecimientos"}
                href={(n) => `${lista}${qsLista({ ...f, pagina: n })}`}
              />
              <ul className="mt-3 space-y-3" aria-label="Establecimientos">
                {d.filas.map((x) => (
                  <li key={x.codigo} className="min-w-0">
                    <FilaEstablecimiento x={x} base={base} />
                  </li>
                ))}
              </ul>
              <Paginas
                className="mt-6"
                pagina={pagina}
                paginas={paginas}
                total={d.total}
                tamano={POR_PAGINA}
                nombre={d.total === 1 ? "establecimiento" : "establecimientos"}
                href={(n) => `${lista}${qsLista({ ...f, pagina: n })}`}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
