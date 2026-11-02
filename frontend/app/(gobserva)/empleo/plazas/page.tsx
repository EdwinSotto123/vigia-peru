import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AccionesBusqueda } from "@/components/gobserva/cuenta/AccionesBusqueda";
import { BellRing, SearchX, X } from "lucide-react";
import { FiltrosPlazas } from "@/components/empleo/FiltrosPlazas";
import { Paginador } from "@/components/empleo/Piezas";
import { TarjetaPlaza } from "@/components/empleo/TarjetaPlaza";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { NIVEL, claveDeSlug, filtrosDeUrl, getPlazasEmpleo, nombreRegion, qsEmpleo, type FiltrosEmpleo } from "@/lib/empleo";
import { numero, soles } from "@/lib/formato";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";
import { SENAL_PLAZA } from "@/lib/planilla";

const POR_PAGINA = 12;

type Props = { searchParams?: Record<string, string | string[] | undefined> };

/** El título de la lista según los filtros: «Plazas CAS de abogado en Cusco». */
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
 * /plazas de Gobserva Empleo: la lista de plazas CAS abiertas con sus filtros en la URL (texto, región, estudios, sueldo
 * mínimo, experiencia, cierre, señal y orden), las cifras de lo filtrado, los filtros puestos como chips para quitar, las
 * tarjetas y el paginador. Sin resultados: qué quitar y la alerta para cuando aparezca. GET /empleo/plazas.
 */
export default async function PlazasEmpleo({ searchParams }: Props) {
  const base = baseProducto("empleo");
  const f = filtrosDeUrl(searchParams);
  const d = await getPlazasEmpleo(f, POR_PAGINA);
  const lista = rutaEn(base, "/plazas");
  const sin = (k: keyof FiltrosEmpleo) => `${lista}${qsEmpleo({ ...f, [k]: undefined, page: undefined })}`;
  const paginas = d ? Math.max(1, Math.ceil(d.total / POR_PAGINA)) : 1;

  const puestos: { texto: string; href: string }[] = [
    f.q ? { texto: `«${f.q}»`, href: sin("q") } : null,
    f.region ? { texto: nombreRegion(claveDeSlug(f.region)), href: sin("region") } : null,
    f.nivel ? { texto: NIVEL[f.nivel].largo, href: sin("nivel") } : null,
    f.sueldo ? { texto: `Desde ${soles(f.sueldo)}`, href: sin("sueldo") } : null,
    f.exp != null ? { texto: f.exp === 0 ? "Sin experiencia" : `Hasta ${f.exp} ${f.exp === 1 ? "año" : "años"} de experiencia`, href: sin("exp") } : null,
    f.cierra ? { texto: f.cierra === "hoy" ? "Cierran hoy" : f.cierra === "2dias" ? "Cierran en 2 días" : "Cierran esta semana", href: sin("cierra") } : null,
    f.senal ? { texto: SENAL_PLAZA[f.senal].corto, href: sin("senal") } : null,
  ].filter((x): x is { texto: string; href: string } => x != null);

  return (
    <div className="container-page py-8 sm:py-12">
      <nav aria-label="Ruta" className="text-meta text-mute">
        <Link href={rutaEn(base, "/")} className="hover:text-granate hover:underline">
          Inicio
        </Link>
        <span aria-hidden className="mx-1.5">/</span>
        <span className="text-inkSoft">Plazas</span>
      </nav>
      <h1 className="mt-3 text-balance font-display text-titulo font-bold leading-tight text-ink sm:text-vitrina">{tituloLista(f)}</h1>
      {d && (
        <p className="mt-3 max-w-[70ch] text-cuerpo leading-relaxed text-inkSoft">
          <b className="text-ink">{numero(d.total)}</b> {d.total === 1 ? "plaza" : "plazas"} con <b className="text-ink">{numero(d.vacantes)}</b>{" "}
          {d.vacantes === 1 ? "vacante" : "vacantes"}
          {d.medianaSueldo ? (
            <>
              ; la mitad paga más de <b className="text-ink">{soles(d.medianaSueldo)}</b> al mes
            </>
          ) : null}
          . Todas se pueden postular hoy.
        </p>
      )}

      <div className="mt-6">
        <FiltrosPlazas base={base} filtros={f} facetas={d?.facetas ?? { region: [], nivel: [] }} />
      </div>
      <div id="crear-alerta" className="mt-4 scroll-mt-24">
        <Suspense>
          <AccionesBusqueda producto="empleo" base={base} />
        </Suspense>
      </div>

      {puestos.length > 0 && (
        <ul className="mt-4 flex flex-wrap items-center gap-2" aria-label="Filtros puestos">
          {puestos.map((p) => (
            <li key={p.texto}>
              <Link
                href={p.href}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-granate/40 bg-granate-50 px-3 text-meta font-medium text-ink transition-colors duration-rapido hover:border-granate"
              >
                {p.texto}
                <X size={13} aria-hidden />
                <span className="sr-only"> (quitar)</span>
              </Link>
            </li>
          ))}
          <li>
            <Link href={lista} className="inline-flex min-h-9 items-center px-2 text-meta font-semibold text-granate underline-offset-2 hover:underline">
              Quitar todos
            </Link>
          </li>
        </ul>
      )}

      {!d ? (
        <p className="mt-8 rounded-2xl border border-line bg-paper p-6 text-cuerpo text-inkSoft">No pudimos leer las plazas ahora. Vuelve a intentarlo en un momento.</p>
      ) : d.data.length === 0 ? (
        <div className="mt-8 rounded-3xl border border-line bg-paper p-8 text-center sm:p-12">
          <SearchX size={36} aria-hidden className="mx-auto text-mute" />
          <p className="mt-4 font-display text-seccion font-bold text-ink">No hay plazas abiertas con estos filtros</p>
          <p className="mx-auto mt-2 max-w-[52ch] text-dato leading-relaxed text-inkSoft">
            Prueba quitando un filtro o buscando con otra palabra (por ejemplo, la profesión en vez del cargo). Cada día se
            publican plazas nuevas: con las alertas, te avisamos cuando aparezca una como la que buscas.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href={lista} className={claseAccion("secundario")}>
              Ver todas las plazas
            </Link>
            <a href="#crear-alerta" className={claseAccion("primario")}>
              <BellRing size={16} aria-hidden /> Avísame cuando aparezca
            </a>
          </div>
        </div>
      ) : (
        <>
          <ol className="mt-8 grid grid-cols-1 gap-3 lg:grid-cols-2" aria-label="Plazas">
            {d.data.map((p) => (
              <li key={p.aviso} className="min-w-0">
                <TarjetaPlaza p={p} base={base} />
              </li>
            ))}
          </ol>
          <div className="mt-8">
            <Paginador pagina={f.page ?? 1} paginas={paginas} href={(pg) => `${lista}${qsEmpleo({ ...f, page: pg })}`} />
          </div>
          <aside className="mt-10 flex flex-col items-start gap-4 rounded-3xl border border-granate/30 bg-granate-50 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-display text-bloque font-bold text-ink">¿No quieres revisar esto todos los días?</p>
              <p className="mt-1 text-dato text-inkSoft">Guarda esta búsqueda como alerta y te llega lo nuevo a tu correo, sin volver a buscar.</p>
            </div>
            <a href="#crear-alerta" className={claseAccion("primario", "shrink-0")}>
              <BellRing size={16} aria-hidden /> Crear mi alerta
            </a>
          </aside>
        </>
      )}
    </div>
  );
}
