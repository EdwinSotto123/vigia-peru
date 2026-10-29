import Link from "next/link";
import { ArrowUpRight, EyeOff, ListOrdered, Megaphone, ShieldCheck, type LucideIcon } from "lucide-react";
import { dolares, getVigilancia } from "@/lib/financiamiento";
import { numero } from "@/lib/formato";
import { EnlaceAccion } from "./EnlaceAccion";

/**
 * Cuánto cuesta mantener Vigía y por qué aportar no compra nada (pedido del usuario del 2026-10-28: el pedido de la
 * portada dejó de ser «S/ 3 por contrato»). Las cifras salen de GET /financiamiento/vigilancia (migración 206): lo que
 * cuesta seguir encendidos al mes, lo que costaría leer a fondo lo más grave y lo que cuesta, en promedio, leer un
 * contrato con IA. Debajo, las tres reglas que protegen lo que se encuentra, en cajitas con su ícono.
 *
 * Reglas que no se negocian, porque son las del producto:
 *  - Sin ranking por plata.
 *  - Sólo aliados reales, siempre: ningún nombre inventado, ni en desarrollo.
 */

/** Por qué aportar no compra nada: una línea cada una, el detalle en /app/apoyar. */
const REGLAS: { Icono: LucideIcon; titulo: string; detalle: string }[] = [
  { Icono: ListOrdered, titulo: "No eligen qué se lee", detalle: "Lo más grave se lee primero, aporte quien aporte." },
  { Icono: EyeOff, titulo: "No cambian lo que se encuentra", detalle: "El análisis no sabe quién aportó." },
  { Icono: Megaphone, titulo: "Si los encuentra a ellos, se publica", detalle: "Y su comprobante lo muestra." },
];

export async function Aliados() {
  const v = await getVigilancia().catch(() => null);
  const piso = v?.meta.pisoPen ?? null;
  const completa = v?.meta.completaPen ?? null;

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
            Vigilar todo cuesta poco si lo sostenemos entre muchos.
          </h2>
          <p className="mt-5 max-w-[60ch] text-pretty text-bloque leading-relaxed text-paper/75">
            Personas, colectivos y empresas, con un aporte de cada mes. Las cuentas, abiertas: cuánto cuesta, de dónde sale cada
            cifra y cuánto entró.
          </p>
        </div>

        {/* Cuánto cuesta: tres cifras y las dos acciones. */}
        {piso != null && completa != null && (
          <div className="mt-10 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-paper/15 bg-paper/5 p-5">
              <p className="text-meta text-paper/70">Mantenerla encendida</p>
              <p className="mt-1 font-display text-cifra font-bold tabular-nums">S/ {numero(piso)}</p>
              <p className="text-meta text-paper/70">al mes: base de datos, servidores y captura de datos</p>
            </div>
            <div className="rounded-2xl border border-paper/15 bg-paper/5 p-5">
              <p className="text-meta text-paper/70">Leer a fondo lo más grave</p>
              <p className="mt-1 font-display text-cifra font-bold tabular-nums">S/ {numero(completa - piso)}</p>
              <p className="text-meta text-paper/70">más al mes: los ~{numero(v!.graves.porMes)} contratos con banderas graves</p>
            </div>
            <div className="rounded-2xl border border-paper/15 bg-paper/5 p-5">
              <p className="text-meta text-paper/70">Leer un contrato con IA</p>
              <p className="mt-1 font-display text-cifra font-bold tabular-nums">{v!.ia.costoMedioUsd != null ? dolares(v!.ia.costoMedioUsd) : "Sin dato"}</p>
              <p className="text-meta text-paper/70">en promedio: por eso ya no pedimos «S/ 3 por contrato»</p>
            </div>
          </div>
        )}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <EnlaceAccion href="/app/apoyar" variante="oscuro" tamano="lg">
            Ayúdanos a seguir vigilando
          </EnlaceAccion>
          <EnlaceAccion href="/app/cuanto-cuesta" variante="contornoOscuro" tamano="lg" flecha={false}>
            Cuánto cuesta Vigía
          </EnlaceAccion>
        </div>

        {/* Qué protege lo que se encuentra: tres cajitas en fila. */}
        <div className="mt-12">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
            <h3 className="flex items-center gap-2.5 font-display text-2xl font-bold">
              <ShieldCheck size={22} className="shrink-0 text-maiz" aria-hidden />
              Sostienes la vigilancia, no el resultado.
            </h3>
            <Link
              href="/app/apoyar"
              className="inline-flex min-h-11 sm:min-h-8 items-center gap-1.5 text-dato font-semibold text-maiz underline-offset-4 hover:underline"
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
        <span className="block text-cuerpo font-semibold leading-snug text-paper">{titulo}</span>
        <span className="mt-1 block text-dato leading-snug text-paper/70">{detalle}</span>
      </span>
    </li>
  );
}
