import Link from "next/link";
import { ArrowRight, Coins } from "lucide-react";
import { ChipsCruces } from "@/components/contratos/CrucesCelda";
import { SemanasMini, type SemanaNueva } from "@/components/novedades/SemanaASemana";
import { CifrasEnFila, type Cifra } from "@/components/ui/CifrasEnFila";
import { Dato } from "@/components/ui/Dato";
import { Partes } from "@/components/ui/Partes";
import { API_BASE } from "@/lib/api-client";
import { numero, porcentaje, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { rutaContrato } from "@/lib/rutas";
import { diasDesde, rangoSemana } from "@/lib/semanas";

/**
 * «Lo nuevo» en el Inicio (fase 6 del plan del 2026-10-27; con semanas desde el 2026-11-01): cuántos contratos con un
 * antecedente grave dejó la última semana que el Estado publicó completa (de cuántas buenas pro), los informes de
 * control del último mes publicado y, si el registro está al día, las sanciones; y los tres contratos con más
 * antecedentes graves, cada uno con su ficha. Todo lo demás, en /app/novedades. La misma lectura que esa página (GET
 * /novedades/semana, 30 minutos en caché), así las dos dicen las mismas cifras; antes un consorcio salía una vez por
 * empresa. Si no responde, el bloque no se dibuja.
 *
 * Pedido del usuario del 2026-11-05: las cifras eran dos cajas de media pantalla con un número cada una («4 contratos…»,
 * «45 informes de control»). Ahora van en una franja de una línea con las 12 semanas en chico al lado (así una semana
 * flaca se ve flaca), y cada antecedente grave de los contratos de abajo es una insignia roja, no texto gris. La semana
 * que se muestra es la última COMPLETA: una que todavía llega a medias va en la gráfica, punteada, pero no abre el bloque.
 */
interface Semana {
  semana: { desde: string; hasta: string };
  ultimaCompleta: string;
  semanas: SemanaNueva[];
  resumen: { buenasPro: number | null; graves: number };
  contratos: {
    ocid: string;
    objeto: string | null;
    entidad: string | null;
    monto: number | null;
    consorcio: string | null;
    ganadores: { nombre: string | null }[];
    graves: string[];
  }[];
  sanciones: unknown[];
  sancionesUltima: string | null;
  informes: unknown[];
}

const FILA = "block px-4 py-3 transition-colors duration-rapido hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate sm:px-5";

async function getSemana(): Promise<Semana | null> {
  try {
    const r = await fetch(`${API_BASE}/novedades/semana`, { next: { revalidate: 1800 } } as RequestInit);
    return r.ok ? ((await r.json()) as Semana) : null;
  } catch {
    return null;
  }
}

export async function NovedadesInicio() {
  const d = await getSemana();
  if (!d) return null;
  const graves = d.resumen.graves;
  // Las sanciones sólo si el registro del OECE está al día: «8 sanciones nuevas» de mayo, en noviembre, no son nuevas.
  const sancionesAlDia = !!d.sancionesUltima && diasDesde(d.sancionesUltima) <= 45;
  const candidatas: (Cifra & { n: number })[] = [
    {
      valor: numero(graves),
      etiqueta: graves === 1 ? "contrato con un antecedente grave" : "contratos con un antecedente grave",
      contexto: `${d.resumen.buenasPro ? `de ${numero(d.resumen.buenasPro)} buenas pro (${porcentaje((graves / d.resumen.buenasPro) * 100)}), ` : ""}semana ${rangoSemana(d.semana.desde, d.semana.hasta)}`,
      tono: "alta",
      href: "/app/novedades?ver=contratos#listas",
      n: graves,
    },
    {
      valor: numero(d.informes.length),
      etiqueta: d.informes.length === 1 ? "informe de control" : "informes de control",
      contexto: "de la Contraloría, el último mes publicado",
      href: "/app/novedades?ver=informes#listas",
      n: d.informes.length,
    },
    ...(sancionesAlDia
      ? [{
          valor: numero(d.sanciones.length),
          etiqueta: d.sanciones.length === 1 ? "sanción a una empresa" : "sanciones a empresas",
          contexto: "del Tribunal, el último mes publicado",
          href: "/app/novedades?ver=sanciones#listas",
          n: d.sanciones.length,
        }]
      : []),
  ];
  // Sin ceros: un «0 sanciones» diría que no hubo, cuando puede ser que la fuente no publicó (/fuentes dice desde cuándo).
  const cifras: Cifra[] = candidatas.filter((c) => c.n > 0);
  if (!cifras.length) return null;
  // Cada columna de la gráfica abre su semana en «Lo nuevo» (la última completa, sin parámetro: es la de por defecto).
  const hrefSemana = (s: string) => (s === d.ultimaCompleta ? "/app/novedades" : `/app/novedades?semana=${s}`);
  // recorte: el Inicio muestra los tres primeros (ya vienen con más antecedentes graves y de mayor monto); la lista entera está en /app/novedades.
  const top = d.contratos.slice(0, 3);
  return (
    // Sin `overflow-hidden`: el detalle de cada semana de la gráfica chica se abre hacia abajo y no se recorta; la última
    // fila de la lista redondea sola su fondo al pasar el mouse.
    <section aria-labelledby="nuevo-inicio-t" className="tarjeta rounded-2xl border border-line bg-paper">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line px-4 py-3 sm:px-5">
        <h2 id="nuevo-inicio-t" className="font-display text-seccion font-bold leading-tight text-ink">
          Lo nuevo
        </h2>
        <Link href="/app/novedades" className="inline-flex min-h-[24px] items-center gap-1 text-meta font-semibold text-granate underline-offset-2 hover:underline">
          Ver todo lo nuevo <ArrowRight size={13} aria-hidden />
        </Link>
      </div>
      {/* Las cifras en una franja y, al lado, las semanas en chico: una línea en vez de dos cajas de media pantalla. */}
      <div className="flex flex-col gap-3 border-b border-line px-4 py-3 sm:px-5 lg:flex-row lg:items-center lg:gap-6">
        <CifrasEnFila items={cifras} className="min-w-0 flex-1" />
        <SemanasMini semanas={d.semanas} elegida={d.semana.desde} href={hrefSemana} className="shrink-0 pb-1.5" />
      </div>
      {top.length > 0 && (
        <ul className="divide-y divide-line [&>li:last-child>a]:rounded-b-2xl">
          {top.map((c) => {
            const nombre = c.consorcio ?? c.ganadores.find((g) => g.nombre)?.nombre ?? null;
            return (
              <li key={c.ocid}>
                <Link href={rutaContrato(c.ocid)} className={FILA}>
                  <span className="line-clamp-2 text-dato font-semibold leading-snug text-ink sm:line-clamp-1">
                    {c.objeto ? `${c.objeto.charAt(0).toUpperCase()}${c.objeto.slice(1).toLowerCase()}` : "Contrato sin objeto registrado"}
                  </span>
                  <span className="mt-0.5 block truncate text-meta text-mute">
                    <Partes
                      partes={[
                        <Dato key="e" tipo="entidad" nombre="Entidad">{c.entidad ? tituloNatural(c.entidad) : "Sin entidad"}</Dato>,
                        <Dato key="g" tipo="personas" nombre="Ganó">{nombre ? tituloNatural(nombre) : "Una persona natural"}</Dato>,
                        c.monto ? <Dato key="m" icono={Coins} nombre="Monto">{solesCompacto(c.monto)}</Dato> : null,
                      ]}
                    />
                  </span>
                  {/* Cada antecedente grave, en su insignia roja (la misma de la ficha y de la lista de contratos). */}
                  {c.graves.length > 0 && (
                    <div className="mt-1.5">
                      <ChipsCruces cruces={c.graves.map((tipo) => ({ tipo, severidad: "alta" as const }))} etiquetaLista="Antecedentes graves del ganador" />
                    </div>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
