import type { Metadata } from "next";
import { BarraSegmentada, MuestraSerie } from "@/components/charts/BarraSegmentada";
import Link from "next/link";
import { Gavel, RotateCw } from "lucide-react";
import { Ayuda } from "@/components/patrones/Ayuda";
import { EstadoError, EstadoVacio } from "@/components/gobserva/ui/Estados";
import { FuenteFecha } from "@/components/salud/comun";
import { BarraFiltros, ProveedorFiltros, Resultados, type FiltroBarra } from "@/components/salud/filtros/BarraFiltros";
import { DEPARTAMENTOS, nombreLugar } from "@/components/salud/lista/filtros";
import { Paginas } from "@/components/salud/lista/Paginas";
import { CabeceraLista, Ruta } from "@/components/salud/portada/Piezas";
import { FilaSancion } from "@/components/salud/sanciones/FilaSancion";
import { ADMINISTRADAS, GRAVEDADES, TIPOS_FILTRO, filtrosSancionesDeUrl, paramsSanciones, qsSanciones } from "@/components/salud/sanciones/filtros";
import { uit } from "@/components/salud/sanciones/filtros";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { getSanciones, numero } from "@/lib/gobserva-salud";
import { baseProducto } from "@/lib/gobserva-servidor";

export const dynamic = "force-dynamic";

// 10 por página (2026-11-21: con 25, la lista era un scroll sin fin, sobre todo en el celular).
const POR_PAGINA = 10;

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
 * /sanciones de Gobserva Salud: el Registro de Sanciones de SUSALUD. 2026-11-22 (el usuario: «ordenar mejor, textos muy
 * grandes, filtros sin forma»): la franja con lo que suma (antes un gráfico y cinco tarjetas antes de la primera sanción),
 * la barra de filtros con el año como un filtro más, y la lista con la fuente una vez al pie. GET /salud/sanciones.
 */
export default async function Sanciones({ searchParams }: Props) {
  const base = baseProducto("salud");
  const f = filtrosSancionesDeUrl(searchParams);
  const d = await getSanciones(paramsSanciones(f, POR_PAGINA));
  const lista = rutaEn(base, "/sanciones");
  const paginas = d ? Math.min(500, Math.max(1, Math.ceil(d.n / POR_PAGINA))) : 1;
  const pagina = Math.min(f.pagina ?? 1, paginas);
  const params = Object.fromEntries(new URLSearchParams(qsSanciones({ ...f, pagina: undefined }).slice(1)));

  const filtros: FiltroBarra[] = [
    { tipo: "uno", clave: "departamento", etiqueta: "Dónde", buscar: true, valor: f.departamento, opciones: DEPARTAMENTOS.map((dep) => ({ valor: dep, nombre: nombreLugar(dep) })) },
    { tipo: "uno", clave: "tipo", etiqueta: "Qué sanción", valor: f.tipo, opciones: TIPOS_FILTRO.map((t) => ({ valor: t.clave, nombre: t.nombre })) },
    {
      tipo: "uno",
      clave: "gravedad",
      etiqueta: "Gravedad",
      valor: f.gravedad,
      opciones: GRAVEDADES.map((g) => ({ valor: g.clave, nombre: `Infracción ${g.nombre.toLocaleLowerCase("es-PE")}` })),
    },
    {
      tipo: "uno",
      clave: "anio",
      etiqueta: "Año",
      valor: f.anio ? String(f.anio) : null,
      opciones: (d?.porAnio ?? []).map((a) => ({ valor: String(a.anio), nombre: `Emitidas en ${a.anio}` })),
    },
    {
      tipo: "uno",
      clave: "administrada",
      etiqueta: "A quién",
      valor: f.administrada,
      opciones: ADMINISTRADAS.map((a) => ({ valor: a.clave, nombre: a.nombre })),
    },
    {
      tipo: "uno",
      clave: "naturaleza",
      etiqueta: "Del Estado o privada",
      valor: f.naturaleza,
      opciones: [
        { valor: "publica", nombre: "Del Estado" },
        { valor: "privada", nombre: "Privada" },
      ],
    },
    { tipo: "si", clave: "judicial", etiqueta: "En proceso judicial", valorSi: "si", activo: !!f.judicial },
  ];

  return (
    <div className="container-page pb-10 pt-4 sm:pb-14 sm:pt-5">
      <Ruta items={[{ etiqueta: "Inicio", href: rutaEn(base, "/") }, { etiqueta: "Sanciones" }]} />
      <ProveedorFiltros ruta={lista} params={params}>
        <CabeceraLista
          className="mt-2"
          figura="documento"
          titulo={f.departamento ? `Sanciones firmes de SUSALUD en ${nombreLugar(f.departamento)}` : "Sanciones firmes de SUSALUD"}
          resumen={
            d && (
              <>
                <span>
                  <b className="font-semibold tabular-nums text-crimsonTexto">{numero(d.n)}</b> {d.n === 1 ? "sanción" : "sanciones"}:{" "}
                  <b className="font-semibold tabular-nums text-ink">{numero(d.multas)}</b> {d.multas === 1 ? "multa" : "multas"} ({uit(d.uit)} UIT),{" "}
                  <b className="font-semibold tabular-nums text-ink">{numero(d.amonestaciones)}</b> {d.amonestaciones === 1 ? "amonestación" : "amonestaciones"}
                  {d.cierres > 0 && (
                    <>
                      , <b className="font-semibold tabular-nums text-ink">{numero(d.cierres)}</b> {d.cierres === 1 ? "cierre" : "cierres"}
                    </>
                  )}
                </span>
                <Ayuda titulo="¿Qué es y qué no es este registro?" etiqueta="Qué es y qué no es este registro">
                  <span className="block"><b className="font-semibold">Sólo sanciones firmes:</b> ya no se pueden apelar en la vía administrativa. Una denuncia no aparece aquí.</span>
                  <span className="mt-1 block"><b className="font-semibold">No es el historial completo:</b> SUSALUD publica cada sanción por lo menos un año y después puede retirarla.</span>
                  <span className="mt-1 block"><b className="font-semibold">Algunas siguen en juicio:</b> {numero(d.judicializadas)} de estas están en un proceso judicial, según el registro.</span>
                  <span className="mt-1 block"><b className="font-semibold">Es de la institución:</b> no de sus médicos ni de quien la dirige. Las multas van en UIT, como las publica SUSALUD.</span>
                </Ayuda>
              </>
            )
          }
        />

        {d && d.n > 0 && (
          <section aria-label="De qué está hecho el registro" className="mt-4 rounded-2xl border border-line bg-paper px-4 py-3.5 sm:px-5">
            <BarraSegmentada
              etiqueta="Sanciones firmes por tipo"
              partes={[
                { clave: "multa", nombre: "Multas", valor: d.multas, texto: `${numero(d.multas)} ${d.multas === 1 ? "multa" : "multas"}` },
                { clave: "amonestacion", nombre: "Amonestaciones", valor: d.amonestaciones, texto: `${numero(d.amonestaciones)}` },
                ...(d.cierres > 0 ? [{ clave: "cierre", nombre: "Cierres", valor: d.cierres, texto: `${numero(d.cierres)}` }] : []),
              ]}
            />
            <ul className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1.5 text-meta text-inkSoft">
              <li className="inline-flex items-center gap-1.5">
                <MuestraSerie i={0} />
                <b className="font-semibold tabular-nums text-ink">{numero(d.multas)}</b> {d.multas === 1 ? "multa" : "multas"}, {uit(d.uit)} UIT en total
              </li>
              <li className="inline-flex items-center gap-1.5">
                <MuestraSerie i={1} />
                <b className="font-semibold tabular-nums text-ink">{numero(d.amonestaciones)}</b> {d.amonestaciones === 1 ? "amonestación" : "amonestaciones"}
              </li>
              {d.cierres > 0 && (
                <li className="inline-flex items-center gap-1.5">
                  <MuestraSerie i={2} />
                  <b className="font-semibold tabular-nums text-ink">{numero(d.cierres)}</b> {d.cierres === 1 ? "cierre" : "cierres"}
                </li>
              )}
              {d.judicializadas > 0 && (
                <li className="inline-flex items-center gap-1.5">
                  <Gavel size={13} aria-hidden className="text-mute" />
                  <b className="font-semibold tabular-nums text-ink">{numero(d.judicializadas)}</b> en un proceso judicial
                </li>
              )}
            </ul>
          </section>
        )}

        <BarraFiltros
          className="mt-4"
          busqueda={{ clave: "q", valor: f.q, ejemplo: "Clínica o aseguradora" }}
          filtros={filtros}
          orden={{
            clave: "orden",
            porDefecto: "recientes",
            valor: f.orden,
            opciones: [
              { valor: "recientes", nombre: "Las más recientes" },
              { valor: "multa", nombre: "La multa más alta primero" },
            ],
          }}
        />

        <Resultados clave={qsSanciones(f)} className="mt-4">
          {!d ? (
            <div className="rounded-2xl border border-line bg-paper">
              <EstadoError
                texto="No pudimos leer el registro ahora. Suele ser momentáneo: vuelve a intentarlo en unos segundos."
                acciones={
                  <a href={`${lista}${qsSanciones(f)}`} className={claseAccion("secundario", "min-h-11")}>
                    <RotateCw size={15} aria-hidden /> Volver a intentar
                  </a>
                }
              />
            </div>
          ) : d.filas.length === 0 ? (
            <div className="rounded-2xl border border-line bg-paper">
              <EstadoVacio
                Icono={Gavel}
                titulo="Ninguna sanción firme con estos filtros"
                texto="Quita un filtro o busca con menos palabras. Que algo no figure en el registro no quiere decir que nunca haya sido sancionado: SUSALUD puede retirar las sanciones de más de un año."
                acciones={
                  <Link href={lista} className={claseAccion("secundario", "min-h-11")}>
                    Ver todo el registro
                  </Link>
                }
              />
            </div>
          ) : (
            <>
              {/* Casillas (2026-11-22: «mejora esta mierda»): el tipo y la multa se leen de un vistazo. */}
              <ul className="grid grid-cols-1 items-start gap-3 min-[560px]:grid-cols-2 xl:grid-cols-3" aria-label="Sanciones firmes">
                {d.filas.map((s) => (
                  <li key={s.id} className="h-full min-w-0">
                    <FilaSancion s={s} base={base} />
                  </li>
                ))}
              </ul>
              <p className="mt-3">
                <FuenteFecha nombre="Registro de Sanciones de SUSALUD" url={d.fuente.url} al={d.fuente.al} />
              </p>
              {paginas > 1 && (
                <Paginas
                  className="mt-5"
                  pagina={pagina}
                  paginas={paginas}
                  total={d.n}
                  tamano={POR_PAGINA}
                  nombre={d.n === 1 ? "sanción" : "sanciones"}
                  href={(k) => `${lista}${qsSanciones({ ...f, pagina: k })}`}
                />
              )}
            </>
          )}
        </Resultados>
      </ProveedorFiltros>
    </div>
  );
}
