import Link from "next/link";
import { ArrowUpRight, EyeOff, ListOrdered, Megaphone, ShieldCheck, type LucideIcon } from "lucide-react";
import { LUGAR_LIBRE, PodioRanking } from "@/components/aliados/Podio";
import { clasificar } from "@/components/aliados/ranking";
import { getEstadoGlobal, getRankingPaginado } from "@/lib/financiamiento";
import { EstadoError } from "@/components/patrones";
import { CalculadoraAporte, type ParteTarifa } from "./CalculadoraAporte";
import { EnlaceAccion } from "./EnlaceAccion";

/**
 * Quienes lo hacen posible.
 *
 * La lectura de cada contrato la paga alguien, y la portada lo muestra con el mismo
 * podio de /app/aliados (`PodioRanking`): los que más contratos hicieron leer, con su
 * medalla, y el enlace al ranking completo. Debajo, en dos filas que se leen de
 * izquierda a derecha: cuánto cuesta leer uno (la calculadora, la única acción de
 * financiar de la sección) y las tres reglas que protegen lo que se encuentra, en
 * cajitas con su ícono en vez de una lista de oraciones.
 *
 * Tres reglas que no se negocian, porque son las del producto:
 *  - Se cuenta en CONTRATOS, nunca en soles. Ningún monto va al lado de ningún
 *    nombre: trescientos vecinos que financian trescientos contratos pesan lo
 *    mismo que una empresa que financia trescientos.
 *  - Sólo aliados reales, siempre: ningún nombre inventado, ni en desarrollo.
 *  - Con menos de tres nombres, los puestos que faltan se ven libres: una
 *    invitación, no una losa que finja que hay alguien.
 */

/** Filas que se piden: los aportes sin nombre no ocupan puesto, y el podio necesita tres con nombre. */
const TOPE = 12;

/** "S/1 procesamiento · S/1 infraestructura y datos · …" → partes con monto. */
function partesDeTarifa(nota: string | null | undefined): ParteTarifa[] {
  if (!nota) return [];
  return nota
    .split(/\s*·\s*/)
    .map((p) => p.match(/^S\/\s?(\d+(?:[.,]\d+)?)\s+(.+)$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => ({ monto: Number(m[1].replace(",", ".")), concepto: m[2] }));
}

/** Por qué financiar no compra nada: una línea cada una, el detalle en /app/financiar. */
const REGLAS: { Icono: LucideIcon; titulo: string; detalle: string }[] = [
  { Icono: ListOrdered, titulo: "No eligen qué se lee", detalle: "Los contratos se asignan por orden de llegada." },
  { Icono: EyeOff, titulo: "No cambian lo que se encuentra", detalle: "El análisis no sabe quién lo pagó." },
  { Icono: Megaphone, titulo: "Si los encuentra a ellos, se publica", detalle: "Y su comprobante lo muestra." },
];

export async function Aliados() {
  const [rankingRaw, estado] = await Promise.all([
    getRankingPaginado({ periodo: "todo", limit: TOPE }),
    getEstadoGlobal(),
  ]);

  // El mismo orden y los mismos puestos que /app/aliados (components/aliados/ranking.ts).
  const podio = clasificar(rankingRaw?.data ?? []).slice(0, 3);

  const precio = estado?.tarifa.precioPen ?? null;
  const partes = partesDeTarifa(estado?.tarifa.nota);

  return (
    <section
      id="aliados"
      data-tema="oscuro"
      aria-labelledby="aliados-titulo"
      className="sobre-oscuro relative scroll-mt-16 overflow-hidden bg-ink text-paper"
    >
      <div className="container-page relative py-20 sm:py-24">
        <div className="max-w-3xl">
          <h2 id="aliados-titulo" className="text-balance font-display text-4xl font-bold leading-[1.05] sm:text-5xl lg:text-6xl">
            Cada contrato que Vigía lee, lo financia alguien.
          </h2>
          <p className="mt-5 max-w-[60ch] text-pretty text-lg leading-relaxed text-paper/75">
            Personas, colectivos y empresas. Su nombre queda acá, contado en contratos, nunca en soles.
          </p>
        </div>

        {/* Sin ranking hay dos casos distintos: el registro no respondió (una falla,
            con su EstadoError sobre papel) o todavía nadie financió (el podio con
            sus tres puestos libres, que es una invitación, no un error). */}
        {podio.length === 0 && rankingRaw == null ? (
          <div className="sobre-claro mt-10 rounded-2xl bg-paper">
            <EstadoError titulo="No pudimos leer el registro de aportes">
              Es una falla de esta página: los aportes siguen registrados. Vuelve a intentarlo en unos minutos.
            </EstadoError>
          </div>
        ) : (
          <div className="mt-10">
            <PodioRanking
              filas={podio}
              titulo="Quienes más contratos hicieron leer"
              nivel={3}
              lugarLibre={LUGAR_LIBRE}
            />
            {podio.length > 0 && (
              <EnlaceAccion href="/app/aliados" variante="contornoOscuro" className="mt-5">
                Ver el ranking completo
              </EnlaceAccion>
            )}
          </div>
        )}

        {/* Cuánto cuesta: una placa a lo ancho. */}
        {precio != null && (
          <div className="mt-16">
            <CalculadoraAporte precio={precio} partes={partes} enCola={estado?.colaGlobal ?? 0} />
          </div>
        )}

        {/* Qué protege lo que se encuentra: tres cajitas en fila. */}
        <div className="mt-12">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
            <h3 className="flex items-center gap-2.5 font-display text-2xl font-bold">
              <ShieldCheck size={22} className="shrink-0 text-maiz" aria-hidden />
              Financias la lectura, no el resultado.
            </h3>
            <Link
              href="/app/financiar#independencia"
              className="inline-flex min-h-[32px] items-center gap-1.5 text-[14px] font-semibold text-maiz underline-offset-4 hover:underline"
            >
              Todas las reglas de independencia <ArrowUpRight size={14} aria-hidden />
            </Link>
          </div>
          <ul className="mt-5 grid gap-3 md:grid-cols-3">
            {REGLAS.map((r) => (
              <Regla key={r.titulo} {...r} />
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function Regla({ Icono, titulo, detalle }: { Icono: LucideIcon; titulo: string; detalle: string }) {
  return (
    <li className="flex items-start gap-3.5 rounded-2xl border border-paper/12 bg-paper/[0.04] p-4 sm:p-5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-maiz/10 text-maiz" aria-hidden>
        <Icono size={19} />
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold leading-snug text-paper">{titulo}</span>
        <span className="mt-1 block text-[14px] leading-snug text-paper/70">{detalle}</span>
      </span>
    </li>
  );
}
