import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BellRing, RotateCcw, SearchX, X } from "lucide-react";
import { FiltrosPlazas, OrdenPlazas } from "@/components/empleo/FiltrosPlazas";
import { Paginador, Ruta } from "@/components/empleo/Piezas";
import { TarjetaPlaza } from "@/components/empleo/TarjetaPlaza";
import { Briefcase, Coins, Eye, Users } from "@/components/empleo/iconos";
import { AccionesBusqueda } from "@/components/gobserva/cuenta/AccionesBusqueda";
import { Nota } from "@/components/patrones/Estructura";
import { Franja } from "@/components/patrones/Franja";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { NIVEL, canalAlertas, claveDeSlug, entidadNombre, esAlertable, filtrosDeUrl, getPlazasEmpleo, nombreRegion, qsEmpleo, type FiltrosEmpleo } from "@/lib/empleo";
import { numero, soles } from "@/lib/formato";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { planesServidor } from "@/lib/gobserva-planes";
import { baseProducto } from "@/lib/gobserva-servidor";
import { SENAL_PLAZA } from "@/lib/planilla";

/** 20 por página (la API da hasta 30): con una columna se escanea rápido y se pagina menos. */
const POR_PAGINA = 20;
/** La invitación a la alerta va después de las primeras plazas: no tapa lo que se vino a ver. */
const PROMO_DESPUES_DE = 4;
/** La API no pasa de la página 300. */
const MAX_PAGINAS = 300;

type Props = { searchParams?: Record<string, string | string[] | undefined> };

/** El título de la lista según los filtros: «Plazas CAS abiertas de «abogado» en Cusco». */
function tituloLista(f: FiltrosEmpleo): string {
  const partes = ["Plazas CAS abiertas"];
  if (f.q) partes.push(`de «${f.q}»`);
  if (f.region) partes.push(`en ${nombreRegion(claveDeSlug(f.region))}`);
  return partes.join(" ");
}

export function generateMetadata({ searchParams }: Props): Metadata {
  const f = filtrosDeUrl(searchParams);
  const filtrado = Object.entries(f).some(([k, v]) => v != null && !(k === "orden" && v === "cierre") && !(k === "page" && v === 1));
  return {
    title: tituloLista(f),
    description: "Todas las convocatorias CAS abiertas del Estado peruano, con su sueldo, sus requisitos y cuándo cierran. Filtra por región, estudios, sueldo y experiencia.",
    alternates: { canonical: urlCanonica("empleo", "/plazas") },
    // Una combinación de filtros no es una página para el buscador: sólo la lista entera.
    robots: filtrado ? { index: false, follow: true } : undefined,
  };
}

/**
 * /plazas de Gobserva Empleo, en modo «operar»: escanear, filtrar y abrir. Arriba el título según la búsqueda y lo que
 * hay (plazas, vacantes, sueldo mediano) como datos con ícono. En la computadora, los filtros en una columna a la
 * izquierda, pegada al bajar; en el celular, la búsqueda y un botón «Filtros» que abre el panel, para que la primera
 * plaza se vea en la primera pantalla. Sobre la lista, los filtros puestos (para quitarlos) y el orden. Las plazas en una
 * columna, 20 por página, con una invitación a la alerta después de las primeras cuatro y la alerta entera al final
 * (AccionesBusqueda; antes iba entre los filtros y la lista, empujándola). Sin resultados: qué quitar y la alerta para
 * cuando aparezca. GET /empleo/plazas.
 */
export default async function PlazasEmpleo({ searchParams }: Props) {
  const base = baseProducto("empleo");
  const f = filtrosDeUrl(searchParams);
  const [d, cat] = await Promise.all([getPlazasEmpleo(f, POR_PAGINA), planesServidor("empleo")]);
  const lista = rutaEn(base, "/plazas");
  const sin = (k: keyof FiltrosEmpleo) => `${lista}${qsEmpleo({ ...f, [k]: undefined, page: undefined })}`;
  const paginas = d ? Math.max(1, Math.min(MAX_PAGINAS, Math.ceil(d.total / POR_PAGINA))) : 1;
  const pagina = f.page ?? 1;
  const canal = canalAlertas(cat.correoActivo);
  const alertable = esAlertable(f);

  // La entidad del filtro, con el nombre que trae su primera plaza (la URL sólo lleva el RUC).
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

  const plazas = d?.data ?? [];
  const primeras = plazas.slice(0, PROMO_DESPUES_DE);
  const resto = plazas.slice(PROMO_DESPUES_DE);
  const desde = (pagina - 1) * POR_PAGINA;

  return (
    <div className="container-page py-6 sm:py-10">
      <Ruta items={[{ etiqueta: "Inicio", href: rutaEn(base, "/") }, { etiqueta: "Plazas" }]} />
      <header className="mt-2">
        <h1 className="text-balance font-display text-cifra font-bold leading-tight text-ink sm:text-titulo">{tituloLista(f)}</h1>
        {d && d.total > 0 && (
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-dato text-inkSoft" aria-label="Lo que hay en esta búsqueda">
            <li className="inline-flex items-center gap-1.5">
              <Briefcase size={15} aria-hidden className="shrink-0 text-mute" />
              <span>
                <b className="font-semibold tabular-nums text-ink">{numero(d.total)}</b> {d.total === 1 ? "plaza abierta" : "plazas abiertas"}
              </span>
            </li>
            <li className="inline-flex items-center gap-1.5">
              <Users size={15} aria-hidden className="shrink-0 text-mute" />
              <span>
                <b className="font-semibold tabular-nums text-ink">{numero(d.vacantes)}</b> {d.vacantes === 1 ? "vacante" : "vacantes"}
              </span>
            </li>
            {d.medianaSueldo ? (
              <li className="inline-flex items-center gap-1.5">
                <Coins size={15} aria-hidden className="shrink-0 text-mute" />
                <span>
                  Sueldo mediano <b className="font-semibold tabular-nums text-ink">{soles(d.medianaSueldo)}</b>
                </span>
              </li>
            ) : null}
          </ul>
        )}
        {f.senal && (
          <Nota icono={<Eye size={15} aria-hidden />} className="mt-4 max-w-3xl">
            <b className="font-semibold text-ink">{SENAL_PLAZA[f.senal].titulo}.</b> {SENAL_PLAZA[f.senal].explica}
          </Nota>
        )}
      </header>

      <div className="mt-5 grid grid-cols-1 gap-x-8 gap-y-4 sm:mt-6 lg:grid-cols-[17.5rem_minmax(0,1fr)] lg:items-start">
        {/* Con otra búsqueda se arma de nuevo: sus campos muestran siempre lo que dice la URL. */}
        <FiltrosPlazas key={qsEmpleo({ ...f, page: undefined, orden: undefined })} base={base} filtros={f} facetas={d?.facetas ?? { region: [], nivel: [] }} />

        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            {puestos.length > 0 ? (
              <ul className="flex min-w-0 flex-wrap items-center gap-2" aria-label="Filtros puestos">
                {puestos.map((p) => (
                  <li key={p.texto} className="min-w-0 max-w-full">
                    <Link
                      href={p.href}
                      className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border border-granate/40 bg-granate-50 px-3.5 text-meta font-medium text-ink transition-colors duration-rapido hover:border-granate"
                    >
                      <span className="truncate">{p.texto}</span>
                      <X size={14} aria-hidden className="shrink-0" />
                      <span className="sr-only"> (quitar)</span>
                    </Link>
                  </li>
                ))}
                {puestos.length > 1 && (
                  <li>
                    <Link href={lista} className="inline-flex min-h-11 items-center px-2 text-meta font-semibold text-granate underline-offset-4 hover:underline">
                      Quitar todos
                    </Link>
                  </li>
                )}
              </ul>
            ) : (
              <p className="text-meta text-mute">{d && d.total > 0 ? `Página ${numero(pagina)} de ${numero(paginas)}` : ""}</p>
            )}
            <OrdenPlazas key={f.orden ?? "cierre"} base={base} filtros={f} />
          </div>

          {!d ? (
            <div role="alert" className="mt-4 rounded-2xl border border-line bg-paper p-6">
              <p className="font-display text-bloque font-bold text-ink">No pudimos leer las plazas ahora</p>
              <p className="mt-1 text-dato text-inkSoft">Suele pasar un momento. Vuelve a intentarlo: tu búsqueda se mantiene.</p>
              <Link href={`${lista}${qsEmpleo(f)}`} className={claseAccion("secundario", "mt-4 min-h-11")}>
                <RotateCcw size={16} aria-hidden /> Volver a intentar
              </Link>
            </div>
          ) : plazas.length === 0 && d.total > 0 ? (
            <div className="mt-4 rounded-2xl border border-line bg-paper p-6">
              <p className="font-display text-bloque font-bold text-ink">Esta página ya no tiene plazas</p>
              <p className="mt-1 text-dato text-inkSoft">
                La búsqueda tiene {numero(d.total)} {d.total === 1 ? "plaza" : "plazas"}: entran en {numero(paginas)} {paginas === 1 ? "página" : "páginas"}.
              </p>
              <Link href={`${lista}${qsEmpleo({ ...f, page: undefined })}`} className={claseAccion("secundario", "mt-4 min-h-11")}>
                Ir a la primera página
              </Link>
            </div>
          ) : plazas.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-line bg-paper p-6 sm:p-8">
              <SearchX size={32} aria-hidden className="text-mute" />
              <h2 className="mt-3 font-display text-seccion font-bold leading-tight text-ink">No hay plazas abiertas con estos filtros</h2>
              <p className="mt-2 max-w-[62ch] text-dato leading-relaxed text-inkSoft">
                Quita alguno de los filtros de arriba o busca con otra palabra: la profesión en vez del cargo («enfermera» en vez de «licenciada en
                enfermería»). Cada día se publican plazas nuevas{alertable ? `: con una alerta te avisamos ${canal} cuando aparezca una así` : ""}.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                {alertable && (
                  <a href="#crear-alerta" className={claseAccion("primario", "min-h-11")}>
                    <BellRing size={16} aria-hidden /> Avísame cuando aparezca
                  </a>
                )}
                <Link href={lista} className={claseAccion("secundario", "min-h-11")}>
                  Ver todas las plazas
                </Link>
              </div>
            </div>
          ) : (
            <>
              <ol className="mt-4 grid grid-cols-1 gap-3" aria-label="Plazas" start={desde + 1}>
                {primeras.map((p) => (
                  <li key={p.aviso} className="min-w-0">
                    <TarjetaPlaza p={p} base={base} />
                  </li>
                ))}
              </ol>
              {alertable && resto.length > 0 && (
                <Franja
                  icono={<BellRing size={18} aria-hidden />}
                  titulo="¿Te sirven plazas como estas?"
                  className="my-3 border-granate/30 bg-granate-50 sm:w-full"
                  accion={
                    <a href="#crear-alerta" className={claseAccion("primario", "min-h-11")}>
                      Crear alerta
                    </a>
                  }
                >
                  Guarda esta búsqueda y te avisamos {canal} de las nuevas, sin volver a buscar.
                </Franja>
              )}
              {resto.length > 0 && (
                <ol className="mt-3 grid grid-cols-1 gap-3" aria-label="Más plazas" start={desde + primeras.length + 1}>
                  {resto.map((p) => (
                    <li key={p.aviso} className="min-w-0">
                      <TarjetaPlaza p={p} base={base} />
                    </li>
                  ))}
                </ol>
              )}
              <div className="mt-8">
                <Paginador pagina={pagina} paginas={paginas} href={(pg) => `${lista}${qsEmpleo({ ...f, page: pg })}`} />
              </div>
            </>
          )}

          {d &&
            (alertable ? (
              <section id="crear-alerta" aria-labelledby="crear-alerta-t" className="mt-10 scroll-mt-28 rounded-3xl border border-granate/30 bg-granate-50 p-5 sm:p-6">
                <h2 id="crear-alerta-t" className="flex items-center gap-2 font-display text-bloque font-bold leading-tight text-ink">
                  <BellRing size={18} aria-hidden className="shrink-0 text-granate" />
                  Que te avisen de las nuevas
                </h2>
                <p className="mt-1.5 max-w-[65ch] text-dato leading-relaxed text-inkSoft">
                  Guarda esta búsqueda como alerta y te avisamos {canal} cuando se publique una plaza que calce. Gratis una vez por semana; cada mañana con el{" "}
                  <Link href={rutaEn(base, "/planes")} className="font-semibold text-granate underline-offset-4 hover:underline">
                    plan Alertas
                  </Link>
                  .
                </p>
                {/* Sin su caja (`barra`): ya va dentro de este bloque. Con su «Con: …», que dice qué guarda la alerta. */}
                <Suspense fallback={<div aria-hidden className="mt-4 h-11 w-72 max-w-full animate-pulse rounded-full bg-paperDeep" />}>
                  <AccionesBusqueda producto="empleo" base={base} variante="barra" resumen={false} className="mt-4" />
                </Suspense>
              </section>
            ) : (
              <div id="crear-alerta" className="mt-10 scroll-mt-28">
                <Franja
                  icono={<BellRing size={18} aria-hidden />}
                  titulo="¿Buscas algo en especial?"
                  className="sm:w-full"
                  accion={
                    <a href="#filtros-plazas" className={claseAccion("secundario", "min-h-11")}>
                      Elegir qué busco
                    </a>
                  }
                >
                  Busca un puesto o elige tu región y guárdalo como alerta: te avisamos {canal} de las plazas nuevas.
                </Franja>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
