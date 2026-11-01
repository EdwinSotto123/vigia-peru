import Link from "next/link";
import { ArrowRight, Coins, FileWarning, Gavel, ShieldAlert } from "lucide-react";
import { Dato } from "@/components/ui/Dato";
import { Partes } from "@/components/ui/Partes";
import { API_BASE } from "@/lib/api-client";
import { GRUPOS_CRUCE } from "@/lib/cruces";
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
 */
interface Semana {
  semana: { desde: string; hasta: string };
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

const NOMBRE_CRUCE = new Map(GRUPOS_CRUCE.flatMap((g) => g.tipos.map((t) => [t.tipo, t.chip ?? t.corto] as const)));
const COLUMNAS: Record<number, string> = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3" };
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
  const cifras = [
    {
      n: graves,
      uno: "contrato con un antecedente grave",
      varios: "contratos con un antecedente grave",
      sub: `${d.resumen.buenasPro ? `de ${numero(d.resumen.buenasPro)} buenas pro (${porcentaje((graves / d.resumen.buenasPro) * 100)}), ` : ""}semana ${rangoSemana(d.semana.desde, d.semana.hasta)}`,
      icono: ShieldAlert,
      href: "/app/novedades?ver=contratos#listas",
    },
    { n: d.informes.length, uno: "informe de control", varios: "informes de control", sub: "de la Contraloría, el último mes publicado", icono: FileWarning, href: "/app/novedades?ver=informes#listas" },
    ...(sancionesAlDia
      ? [{ n: d.sanciones.length, uno: "sanción a una empresa", varios: "sanciones a empresas", sub: "del Tribunal, el último mes publicado", icono: Gavel, href: "/app/novedades?ver=sanciones#listas" }]
      : []),
    // Sin ceros: un «0 sanciones» diría que no hubo, cuando puede ser que la fuente no publicó (/fuentes dice desde cuándo).
  ].filter((c) => c.n > 0);
  if (!cifras.length) return null;
  // recorte: el Inicio muestra los tres primeros (ya vienen con más antecedentes graves y de mayor monto); la lista entera está en /app/novedades.
  const top = d.contratos.slice(0, 3);
  return (
    <section aria-labelledby="nuevo-inicio-t" className="tarjeta overflow-hidden rounded-2xl border border-line bg-paper">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line px-4 py-3 sm:px-5">
        <h2 id="nuevo-inicio-t" className="font-display text-seccion font-bold leading-tight text-ink">
          Lo nuevo
        </h2>
        <Link href="/app/novedades" className="inline-flex min-h-[24px] items-center gap-1 text-meta font-semibold text-granate underline-offset-2 hover:underline">
          Ver todo lo nuevo <ArrowRight size={13} aria-hidden />
        </Link>
      </div>
      <ul className={`grid grid-cols-1 divide-y divide-line border-b border-line sm:divide-x sm:divide-y-0 ${COLUMNAS[cifras.length] ?? ""}`}>
        {cifras.map((c) => (
          <li key={c.href}>
            <Link href={c.href} className="flex h-full items-start gap-3 px-4 py-3 transition-colors duration-rapido hover:bg-paperSoft sm:px-5">
              <c.icono size={18} className="mt-1 shrink-0 text-mute" aria-hidden />
              <span className="min-w-0">
                <span className="block font-mono text-cifra font-bold tabular-nums leading-tight text-ink">{numero(c.n)}</span>
                <span className="block text-meta font-medium text-ink">{c.n === 1 ? c.uno : c.varios}</span>
                <span className="block text-rotulo text-mute">{c.sub}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {top.length > 0 && (
        <ul className="divide-y divide-line">
          {top.map((c) => {
            const tipos = c.graves.map((x) => NOMBRE_CRUCE.get(x) ?? x.replace(/_/g, " "));
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
                        tipos.length ? <Dato key="t" tipo="tipo" nombre="Antecedentes graves">{tipos.slice(0, 2).join(", ")}{tipos.length > 2 ? ` y ${tipos.length - 2} más` : ""}</Dato> : null,
                      ]}
                    />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
