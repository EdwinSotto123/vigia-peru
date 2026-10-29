import Link from "next/link";
import { ArrowUpRight, EyeOff, ListOrdered, Megaphone, ShieldCheck, type LucideIcon } from "lucide-react";
import { PodioRanking } from "@/components/aliados/Podio";
import { clasificar } from "@/components/aliados/ranking";
import { CintaAportes } from "@/components/aliados/CintaAportes";
import { dolares, getRankingPaginado, getRecientesPagina, getVigilancia } from "@/lib/financiamiento";
import { numero } from "@/lib/formato";
import { EnlaceAccion } from "./EnlaceAccion";

/**
 * Quién sostiene Vigía, en UNA sección (2026-10-29): antes eran dos seguidas que se contradecían, «Guardianes…» con el
 * modelo viejo (los 320 contratos de la semilla, «Eliges región y cuántos contratos, S/ 3 cada uno») y «Vigilar todo
 * cuesta poco…» con el nuevo («ya no pedimos S/ 3 por contrato»). Ahora, en este orden: el podio (destacado, siempre de
 * tres, ocupados o libres), lo que cuesta mantener Vigía, las acciones, por qué aportar no compra nada y los últimos
 * aportes.
 *
 * Mismas reglas que /app/aliados: el podio se gana por constancia (meses), nunca por plata; la semilla de Vigía Perú no
 * compite; sólo aliados reales. Si el registro no responde, el podio no se dibuja: una portada que estima lo que no sabe
 * es lo que este producto le reprocha al Estado.
 */

/** Filas que se piden: los aportes sin nombre no ocupan puesto, y el podio necesita tres con nombre. */
const TOPE = 12;

/** Por qué aportar no compra nada: una línea cada una, el detalle en /app/apoyar. */
const REGLAS: { Icono: LucideIcon; titulo: string; detalle: string }[] = [
  { Icono: ListOrdered, titulo: "No eligen qué se lee", detalle: "Lo más grave se lee primero, aporte quien aporte." },
  { Icono: EyeOff, titulo: "No cambian lo que se encuentra", detalle: "El análisis no sabe quién aportó." },
  { Icono: Megaphone, titulo: "Si los encuentra a ellos, se publica", detalle: "Y su recibo lo muestra." },
];

export async function PodioPortada() {
  const [ranking, v, recientes] = await Promise.all([
    getRankingPaginado({ periodo: "todo", limit: TOPE }).catch(() => null),
    getVigilancia().catch(() => null),
    getRecientesPagina(20, 0, undefined, { sinSemilla: true }).catch(() => null),
  ]);
  const podio = ranking ? clasificar(ranking.data ?? []).slice(0, 3) : null;
  const piso = v?.meta.pisoPen ?? null;
  const completa = v?.meta.completaPen ?? null;

  return (
    <section
      id="aliados"
      data-tema="oscuro"
      aria-labelledby="aliados-titulo"
      className="sobre-oscuro relative scroll-mt-16 overflow-hidden bg-ink text-paper"
    >
      <div aria-hidden className="fondo-puntos-tenue pointer-events-none absolute inset-0" />
      <div className="container-page relative py-16 sm:py-24">
        <div className="max-w-3xl">
          <h2 id="aliados-titulo" className="text-balance font-display text-titulo font-bold leading-[1.05] sm:text-vitrina">
            Guardianes de los recursos <span className="text-maiz">del Perú.</span>
          </h2>
          <p className="mt-5 max-w-[58ch] text-pretty text-bloque leading-relaxed text-paper/75">
            Ver todo en Vigía es gratis porque lo sostienen personas, colectivos y empresas, mes a mes. El podio no se compra: cuenta
            los meses, no los soles.
          </p>
        </div>

        {podio && (
          <div className="mt-10 sm:mt-12">
            <PodioRanking filas={podio} nivel={3} destacado />
          </div>
        )}

        {/* Lo que cuesta mantener Vigía (GET /financiamiento/vigilancia, migración 206): tres cifras. */}
        {piso != null && completa != null && (
          <div className="mt-10 grid gap-3 sm:grid-cols-3">
            <Costo titulo="Mantenerla encendida" valor={`S/\u00a0${numero(piso)}`} detalle="al mes: base de datos, servidores y captura de datos" />
            <Costo titulo="Leer a fondo lo más grave" valor={`S/\u00a0${numero(completa - piso)}`} detalle={`más al mes: los ~${numero(v!.graves.porMes)} contratos con banderas graves`} />
            <Costo
              titulo="Leer un contrato con IA"
              valor={v!.ia.costoMedioUsd != null ? dolares(v!.ia.costoMedioUsd) : "Sin dato"}
              detalle="en promedio: por eso pedimos para el mes y no por contrato"
            />
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <EnlaceAccion href="/app/apoyar" variante="oscuro" tamano="lg">
            Quiero estar en el podio
          </EnlaceAccion>
          <EnlaceAccion href="/app/aliados" variante="contornoOscuro" tamano="lg" flecha={false}>
            Ver el podio completo
          </EnlaceAccion>
          <Link
            href="/app/cuanto-cuesta"
            className="inline-flex min-h-11 items-center gap-1.5 px-2 text-dato font-semibold text-maiz underline-offset-4 hover:underline"
          >
            Cuánto cuesta Vigía <ArrowUpRight size={14} aria-hidden />
          </Link>
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

        {recientes && recientes.data.length > 0 && (
          <div className="mt-10">
            <CintaAportes items={recientes.data} total={recientes.total} />
          </div>
        )}
      </div>
    </section>
  );
}

function Costo({ titulo, valor, detalle }: { titulo: string; valor: string; detalle: string }) {
  return (
    <div className="rounded-2xl border border-paper/15 bg-paper/5 p-5">
      <p className="text-meta text-paper/70">{titulo}</p>
      <p className="mt-1 font-display text-cifra font-bold tabular-nums">{valor}</p>
      <p className="text-meta text-paper/70">{detalle}</p>
    </div>
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
