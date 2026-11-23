import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BellRing, RotateCcw, X } from "lucide-react";
import { CabeceraPagina, Caja, Pagina } from "@/components/gobserva/app/Caja";
import { EstadoPostulante } from "@/components/empleo/EstadoPostulante";
import { FiltrosPlazas, OrdenPlazas } from "@/components/empleo/FiltrosPlazas";
import { TarjetaPlaza } from "@/components/empleo/TarjetaPlaza";
import { AplicarPerfil, SelectorParaTi } from "@/components/empleo-app/SelectorParaTi";
import { carrerasDeAlerta, textosMotivo } from "@/lib/empleo-app/entrevista";
import { AccionesBusqueda } from "@/components/gobserva/cuenta/AccionesBusqueda";
import { EstrellaSeguir } from "@/components/licitaciones-app/seguimiento/BotonSeguir";
import { Paginacion } from "@/components/gobserva/ui/Paginacion";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { NIVEL, claveDeSlug, entidadNombre, filtrosDeUrl, getPlazasEmpleo, nombreRegion, puesto, qsEmpleo, type FiltrosEmpleo } from "@/lib/empleo";
import { numero, soles } from "@/lib/formato";
import { rutaEn } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";
import { SENAL_PLAZA } from "@/lib/planilla";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Plazas", robots: { index: false, follow: false } };

const POR_PAGINA = 20;
const MAX_PAGINAS = 300;

type Props = { searchParams?: Record<string, string | string[] | undefined> };

/**
 * Las plazas CAS abiertas dentro de la app de Empleo (2026-11-07), como la bandeja de Licitaciones: los filtros a la
 * izquierda (los de la portada: texto, región, tus estudios, sueldo, experiencia, cierre), los puestos en chips que se
 * quitan, el orden, guardar la búsqueda como alerta o bajarla, y cada plaza con su estrella para llevarla al tablero.
 * Todo en la URL: Atrás vuelve, un enlace se comparte y la ficha vuelve a estos filtros.
 */
export default async function PlazasApp({ searchParams }: Props) {
  const base = baseProducto("empleo");
  const f = filtrosDeUrl(searchParams);
  // «Para ti» desde un enlace (?para=ti, sin el perfil en la URL): la lista espera a que el navegador lea el perfil.
  const esperandoPerfil = f.para === "ti" && !f.carreras && !f.palabras;
  const conPerfil = !!(f.carreras || f.palabras);
  const d = esperandoPerfil ? null : await getPlazasEmpleo(f, POR_PAGINA);
  const carrerasPerfil = conPerfil ? carrerasDeAlerta(f.carreras ?? "") : [];
  const lista = rutaEn(base, "/app/plazas");
  const sin = (k: keyof FiltrosEmpleo) => `${lista}${qsEmpleo({ ...f, [k]: undefined, page: undefined })}`;
  const paginas = d ? Math.max(1, Math.min(MAX_PAGINAS, Math.ceil(d.total / POR_PAGINA))) : 1;
  const pagina = f.page ?? 1;
  const volver = qsEmpleo(f).replace(/^\?/, "");

  const deLaEntidad = f.entidad ? d?.data.find((x) => x.entidadRuc === f.entidad)?.entidad : undefined;
  const puestos: { texto: string; href: string }[] = [
    f.q ? { texto: `«${f.q}»`, href: sin("q") } : null,
    f.entidad ? { texto: deLaEntidad ? entidadNombre(deLaEntidad) : "Una entidad", href: sin("entidad") } : null,
    f.region ? { texto: nombreRegion(claveDeSlug(f.region)), href: sin("region") } : null,
    f.tengo ? { texto: `Tus estudios: ${NIVEL[f.tengo].largo}`, href: sin("tengo") } : null,
    f.nivel ? { texto: `Piden: ${NIVEL[f.nivel].largo}`, href: sin("nivel") } : null,
    f.sueldo ? { texto: `Desde ${soles(f.sueldo)}`, href: sin("sueldo") } : null,
    f.exp != null ? { texto: f.exp === 0 ? "Sin experiencia" : `Hasta ${f.exp} ${f.exp === 1 ? "año" : "años"} de experiencia`, href: sin("exp") } : null,
    f.cierra ? { texto: f.cierra === "hoy" ? "Cierran hoy" : f.cierra === "2dias" ? "Cierran en 2 días" : "Cierran esta semana", href: sin("cierra") } : null,
    f.senal ? { texto: SENAL_PLAZA[f.senal].corto, href: sin("senal") } : null,
  ].filter((x): x is { texto: string; href: string } => x != null);

  return (
    <Pagina>
      <CabeceraPagina
        titulo={conPerfil || esperandoPerfil ? "Plazas para ti" : "Plazas abiertas"}
        bajada={
          d && conPerfil ? (
            <>
              <b className="font-semibold tabular-nums text-ink">{numero(d.total)}</b> {d.total === 1 ? "plaza abierta calza" : "plazas abiertas calzan"} con tu perfil, con{" "}
              <b className="font-semibold tabular-nums text-ink">{numero(d.vacantes)}</b> {d.vacantes === 1 ? "vacante" : "vacantes"}. Piden tu carrera; primero las más afines.
            </>
          ) : d ? (
            <>
              <b className="font-semibold tabular-nums text-ink">{numero(d.total)}</b> {d.total === 1 ? "plaza" : "plazas"} con{" "}
              <b className="font-semibold tabular-nums text-ink">{numero(d.vacantes)}</b> {d.vacantes === 1 ? "vacante" : "vacantes"}
              {d.medianaSueldo ? (
                <>
                  , sueldo mediano <b className="font-semibold tabular-nums text-ink">{soles(d.medianaSueldo)}</b>
                </>
              ) : null}
              . Las publica SERVIR y se postula en cada entidad.
            </>
          ) : (
            "Las plazas CAS del Estado que puedes postular hoy."
          )
        }
        acciones={
          <Suspense>
            <AccionesBusqueda producto="empleo" base={base} variante="barra" resumen={false} />
          </Suspense>
        }
      />

      <div className="grid grid-cols-1 gap-x-6 gap-y-4 lg:grid-cols-[17.5rem_minmax(0,1fr)] lg:items-start">
        <FiltrosPlazas key={qsEmpleo({ ...f, page: undefined, orden: undefined })} base={base} filtros={f} facetas={d?.facetas ?? { region: [], nivel: [] }} ruta="/app/plazas" />

        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <SelectorParaTi base={base} filtros={f} total={d?.total ?? null} />
            {!esperandoPerfil && <OrdenPlazas key={f.orden ?? "cierre"} base={base} filtros={f} ruta="/app/plazas" />}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            {puestos.length > 0 ? (
              <ul className="flex min-w-0 flex-wrap items-center gap-2" aria-label="Filtros puestos">
                {puestos.map((p) => (
                  <li key={p.texto} className="min-w-0 max-w-full">
                    <Link href={p.href} className="inline-flex min-h-10 max-w-full items-center gap-1.5 rounded-full border border-granate/40 bg-granate-50 px-3.5 text-meta font-medium text-ink transition-colors duration-rapido hover:border-granate">
                      <span className="truncate">{p.texto}</span>
                      <X size={14} aria-hidden className="shrink-0" />
                      <span className="sr-only"> (quitar)</span>
                    </Link>
                  </li>
                ))}
                {puestos.length > 1 && (
                  <li>
                    <Link
                      href={conPerfil ? `${lista}${qsEmpleo({ carreras: f.carreras, palabras: f.palabras, para: f.para, orden: f.orden })}` : lista}
                      className="inline-flex min-h-10 items-center px-2 text-meta font-semibold text-granate underline-offset-4 hover:underline"
                    >
                      Quitar todos
                    </Link>
                  </li>
                )}
              </ul>
            ) : (
              <p className="text-meta text-mute">{d && d.total > 0 ? `Página ${numero(pagina)} de ${numero(paginas)}` : ""}</p>
            )}
          </div>

          {esperandoPerfil ? (
            <AplicarPerfil base={base} filtros={f} />
          ) : !d ? (
            <Caja className="mt-4">
              <EstadoPostulante
                alerta
                titulo="No pudimos leer las plazas ahora"
                texto="Suele pasar un momento. Vuelve a intentarlo: tu búsqueda se mantiene."
                acciones={
                  <Link href={`${lista}${qsEmpleo(f)}`} className={claseAccion("secundario")}>
                    <RotateCcw size={15} aria-hidden /> Volver a intentar
                  </Link>
                }
              />
            </Caja>
          ) : d.data.length === 0 ? (
            <Caja className="mt-4">
              <EstadoPostulante
                compacto
                titulo={d.total > 0 ? "Esta página ya no tiene plazas" : "No hay plazas abiertas con estos filtros"}
                texto={
                  d.total > 0
                    ? `La búsqueda tiene ${numero(d.total)} plazas: entran en ${numero(paginas)} páginas.`
                    : "Quita algún filtro o busca con otra palabra: la profesión en vez del cargo («enfermera» en vez de «licenciada en enfermería»). Guarda la búsqueda como alerta y te avisamos cuando aparezca una."
                }
                acciones={
                  d.total > 0 ? (
                    <Link href={`${lista}${qsEmpleo({ ...f, page: undefined })}`} className={claseAccion("primario")}>Ir a la primera página</Link>
                  ) : (
                    <Link href={lista} className={claseAccion("primario")}>
                      <BellRing size={15} aria-hidden /> Ver todas las plazas
                    </Link>
                  )
                }
              />
            </Caja>
          ) : (
            <>
              <ol className="gs-lista mt-4 grid grid-cols-1 gap-3" aria-label="Plazas" start={(pagina - 1) * POR_PAGINA + 1}>
                {d.data.map((p) => (
                  <li key={p.aviso} className="min-w-0">
                    <TarjetaPlaza
                      p={p}
                      base={base}
                      ruta="/app/plaza"
                      enApp
                      volver={volver}
                      motivo={conPerfil ? textosMotivo(p.motivo, carrerasPerfil) : undefined}
                      accion={<EstrellaSeguir id={String(p.aviso)} codigo={null} titulo={puesto(p.titulo)} tipo="plaza" />}
                    />
                  </li>
                ))}
              </ol>
              <div className="mt-4">
                <Paginacion
                  pagina={pagina}
                  paginas={paginas}
                  total={d.total}
                  tamano={POR_PAGINA}
                  href={(n) => `${lista}${qsEmpleo({ ...f, page: n === 1 ? undefined : n })}`}
                  nombre="plazas"
                />
              </div>
            </>
          )}
        </div>
      </div>
    </Pagina>
  );
}
