import Link from "next/link";
import { ArrowRight, Coins, FileWarning, Gavel, ShieldAlert } from "lucide-react";
import { Dato } from "@/components/ui/Dato";
import { Partes } from "@/components/ui/Partes";
import { API_BASE } from "@/lib/api-client";
import { GRUPOS_CRUCE } from "@/lib/cruces";
import { fechaCorta, numero, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { rutaContrato } from "@/lib/rutas";

/**
 * «Lo nuevo esta semana» en el Inicio (fase 6 del plan del 2026-10-27): cuántos contratos con antecedentes graves dejó
 * la última semana con datos, cuántas sanciones e informes de control trajo el último mes, y los tres contratos con más
 * antecedentes graves, cada uno con su ficha; todo lo demás, en /app/novedades. La misma lectura que esa página
 * (GET /novedades?dias=7, 30 minutos en caché): si no responde, el bloque no se dibuja.
 */
interface Novedades {
  dias: number;
  contratosHasta: string | null;
  contratos: { ocid: string; ruc: string | null; proveedor: string | null; entidad: string | null; objeto: string | null; fecha: string; monto: number | null; tipos: string[] | null; nAlta: number }[];
  sanciones: unknown[];
  informes: unknown[];
  totales?: { contratos: number; sanciones: number; informes: number };
}

const NOMBRE_CRUCE = new Map(GRUPOS_CRUCE.flatMap((g) => g.tipos.map((t) => [t.tipo, t.chip ?? t.corto] as const)));
const COLUMNAS: Record<number, string> = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3" };
const FILA = "block px-4 py-3 transition-colors duration-rapido hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate sm:px-5";

async function getNovedades(): Promise<Novedades | null> {
  try {
    const r = await fetch(`${API_BASE}/novedades?dias=7`, { next: { revalidate: 1800 } } as RequestInit);
    return r.ok ? ((await r.json()) as Novedades) : null;
  } catch {
    return null;
  }
}

export async function NovedadesInicio() {
  const d = await getNovedades();
  if (!d) return null;
  const t = d.totales ?? { contratos: d.contratos.length, sanciones: d.sanciones.length, informes: d.informes.length };
  if (t.contratos + t.sanciones + t.informes === 0) return null;
  const cifras = [
    { n: t.contratos, uno: "contrato con antecedentes graves", varios: "contratos con antecedentes graves", sub: d.contratosHasta ? `buena pro en los 7 días al ${fechaCorta(d.contratosHasta)}` : "la última semana", icono: ShieldAlert, href: "/app/novedades#nuevo-contratos" },
    { n: t.sanciones, uno: "sanción nueva a una empresa", varios: "sanciones nuevas a empresas", sub: "del Tribunal, último mes", icono: Gavel, href: "/app/novedades#nuevo-sanciones" },
    { n: t.informes, uno: "informe de control nuevo", varios: "informes de control nuevos", sub: "de la Contraloría, último mes", icono: FileWarning, href: "/app/novedades#nuevo-informes" },
    // Sin ceros: un «0 sanciones» diría que no hubo, cuando puede ser que la fuente no publicó (/fuentes dice desde cuándo).
  ].filter((c) => c.n > 0);
  // recorte: el Inicio muestra los tres primeros (ya vienen con más antecedentes graves y de mayor monto); la lista entera está en /app/novedades.
  const top = d.contratos.slice(0, 3);
  return (
    <section aria-labelledby="nuevo-inicio-t" className="tarjeta overflow-hidden rounded-2xl border border-line bg-paper">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line px-4 py-3 sm:px-5">
        <h2 id="nuevo-inicio-t" className="font-display text-seccion font-bold leading-tight text-ink">
          Lo nuevo esta semana
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
            const tipos = (c.tipos ?? []).map((x) => NOMBRE_CRUCE.get(x) ?? x.replace(/_/g, " "));
            return (
              <li key={`${c.ocid}-${c.ruc ?? "x"}`}>
                <Link href={rutaContrato(c.ocid)} className={FILA}>
                  <span className="line-clamp-2 text-dato font-semibold leading-snug text-ink sm:line-clamp-1">
                    {c.objeto ? `${c.objeto.charAt(0).toUpperCase()}${c.objeto.slice(1).toLowerCase()}` : "Contrato sin objeto registrado"}
                  </span>
                  <span className="mt-0.5 block truncate text-meta text-mute">
                    <Partes
                      partes={[
                        <Dato key="e" tipo="entidad" nombre="Entidad">{c.entidad ? tituloNatural(c.entidad) : "Sin entidad"}</Dato>,
                        <Dato key="g" tipo="personas" nombre="Ganó">{c.proveedor ? tituloNatural(c.proveedor) : "Una persona natural"}</Dato>,
                        c.monto ? <Dato key="m" icono={Coins} nombre="Monto">{solesCompacto(c.monto)}</Dato> : null,
                        tipos.length ? <Dato key="t" tipo="tipo" nombre="Antecedentes">{tipos.slice(0, 2).join(", ")}{tipos.length > 2 ? ` y ${tipos.length - 2} más` : ""}</Dato> : null,
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
