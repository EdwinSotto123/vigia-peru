import Link from "next/link";
import { ArrowUpRight, EyeOff, ListOrdered, Megaphone, ShieldCheck, type LucideIcon } from "lucide-react";
import { getEstadoGlobal } from "@/lib/financiamiento";
import { CalculadoraAporte, type ParteTarifa } from "./CalculadoraAporte";

/**
 * Cuánto cuesta leer un contrato, y por qué financiar no compra nada.
 *
 * El podio de quienes lo hacen posible subió al inicio de la portada (`PodioPortada`, justo
 * después de la escala del dinero). Acá quedan, en dos filas que se leen de izquierda a
 * derecha: la calculadora (la única acción de financiar de la sección) y las tres reglas
 * que protegen lo que se encuentra, en cajitas con su ícono.
 *
 * Reglas que no se negocian, porque son las del producto:
 *  - Se cuenta en CONTRATOS, nunca en soles.
 *  - Sólo aliados reales, siempre: ningún nombre inventado, ni en desarrollo.
 */

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
  const estado = await getEstadoGlobal();

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
            Leer un contrato cuesta poco, y lo puede pagar cualquiera.
          </h2>
          <p className="mt-5 max-w-[60ch] text-pretty text-lg leading-relaxed text-paper/75">
            Personas, colectivos y empresas. Su nombre queda en el podio, contado en contratos, nunca en soles.
          </p>
        </div>

        {/* Cuánto cuesta: una placa a lo ancho. */}
        {precio != null && (
          <div className="mt-10">
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
