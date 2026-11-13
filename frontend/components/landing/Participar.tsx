import Link from "next/link";
import { ArrowUpRight, Camera, EyeOff, HeartHandshake, ListOrdered, Megaphone, Search, ShieldCheck, type LucideIcon } from "lucide-react";
import { OjoPixel } from "@/components/marca";
import { CintaAportes } from "@/components/aliados/CintaAportes";
import { CifrasEnFila, type Cifra } from "@/components/ui/CifrasEnFila";
import { dolares, getRecientesPagina, getVigilancia } from "@/lib/financiamiento";
import { numero } from "@/lib/formato";
import { EnlaceAccion } from "./EnlaceAccion";
import { ExpansionSection } from "./ExpansionSection";

/**
 * El cierre de la portada: cómo sumarse, en UNA sección (2026-11-13).
 *
 * Antes eran cinco bandas seguidas (4 pantallas en escritorio, 6 en el celular): el podio de aliados con su pedido,
 * «No hace falta ser experto para vigilar» (denunciar e investigar), la franja de otros países y una banda de cierre
 * que repetía los dos botones de la portada. El podio, además, ya estaba tres veces: en el cintillo de aliados, en la
 * primera pantalla («Lo hacen posible») y aquí, en una escena de 1,6 pantallas que, vacía, decía «por estrenarse».
 *
 * Ahora, en este orden:
 *  1. La banda de marca, con el ojo y la cifra real de lo que espera ser leído, y dentro de ella las tres maneras de
 *     sumarse, cada una con su verbo y un solo botón: aportar, denunciar una obra, investigar un contrato.
 *  2. Lo que sostiene el aporte: lo que cuesta mantener Vigía (si el registro respondió) y por qué aportar no compra
 *     nada, en dos cajas lado a lado.
 *  3. Los últimos aportes, si hay, y otros países en una línea.
 *
 * Todo lo que se afirma de la denuncia sale de cómo funciona hoy `/reporte/nuevo`: anónima por defecto, sin DNI ni
 * nombre publicados, y confirmada cuando dos reportes independientes del mismo punto coinciden en 30 días. Mismas
 * reglas que el podio de /app/apoyar: el podio se gana por constancia (meses), nunca por plata.
 */

interface Manera {
  Icono: LucideIcon;
  titulo: string;
  texto: string;
  accion: { href: string; texto: string };
  /** Una acción secundaria, como enlace. */
  otra?: { href: string; texto: string };
}

const MANERAS: Manera[] = [
  {
    Icono: HeartHandshake,
    titulo: "Aporta cada mes",
    texto: "Vigía es gratis porque la sostienen personas, colectivos y empresas. El podio cuenta los meses, no los soles.",
    accion: { href: "/app/apoyar", texto: "Ayúdanos a seguir vigilando" },
    otra: { href: "/app/apoyar?seccion=aliados", texto: "Ver el podio" },
  },
  {
    Icono: Camera,
    titulo: "Denuncia una obra",
    texto: "Una foto y dónde está: Vigía la cruza con los contratos de la zona. Anónima si quieres; con otro reporte del mismo lugar en 30 días, queda confirmada.",
    accion: { href: "/reporte/nuevo", texto: "Denunciar una obra" },
  },
  {
    Icono: Search,
    titulo: "Investiga un contrato",
    texto: "Por lo que se compró, la entidad o la región. Si Vigía ya lo leyó, trae sus señales, la ley y los documentos oficiales.",
    accion: { href: "/app/contratos", texto: "Buscar un contrato" },
  },
];

/** Por qué aportar no compra nada: una línea cada una, el detalle en /app/apoyar. */
const REGLAS: { Icono: LucideIcon; titulo: string; detalle: string }[] = [
  { Icono: ListOrdered, titulo: "No eligen qué se lee", detalle: "Lo más grave se lee primero, aporte quien aporte." },
  { Icono: EyeOff, titulo: "No cambian lo que se encuentra", detalle: "El análisis no sabe quién aportó." },
  { Icono: Megaphone, titulo: "Si los encuentra a ellos, se publica", detalle: "Y su recibo lo muestra." },
];

export async function Participar({ enCola }: { enCola: number | null }) {
  const [v, recientes] = await Promise.all([
    getVigilancia().catch(() => null),
    getRecientesPagina(20, 0, undefined, { sinSemilla: true }).catch(() => null),
  ]);
  const piso = v?.meta.pisoPen ?? null;
  const completa = v?.meta.completaPen ?? null;
  // Lo que cuesta mantener Vigía (GET /financiamiento/vigilancia, migración 206): tres cifras, sólo si respondió.
  const costos: Cifra[] | null =
    v && piso != null && completa != null
      ? [
          { valor: `S/ ${numero(piso)}`, etiqueta: "al mes para mantenerla encendida", contexto: "base de datos, servidores y captura de datos", parte: null },
          {
            valor: `S/ ${numero(completa - piso)}`,
            etiqueta: "más al mes para leer lo más grave",
            contexto: `los ~${numero(v.graves.porMes)} contratos con banderas graves`,
            parte: null,
          },
          {
            valor: v.ia.costoMedioUsd != null ? dolares(v.ia.costoMedioUsd) : null,
            etiqueta: "cuesta leer un contrato con IA",
            contexto: "en promedio: por eso pedimos para el mes y no por contrato",
            parte: null,
          },
        ]
      : null;

  return (
    <section id="denunciar" aria-labelledby="participar-titulo" className="relative scroll-mt-16 bg-paper py-10 sm:py-12">
      {/* El ancla de la banda de aliados que vivía aquí. */}
      <span id="aliados" aria-hidden className="absolute top-0 scroll-mt-16" />
      <div className="container-page space-y-4">
        {/* ── 1. La banda de marca: la cifra que espera y las tres maneras ── */}
        <div data-tema="oscuro" className="sobre-oscuro relative isolate overflow-hidden rounded-2xl bg-granate-deep text-paper">
          <div className="grid items-center gap-x-10 gap-y-4 px-5 pb-6 pt-6 sm:px-8 sm:pt-8 lg:grid-cols-[auto_minmax(0,1fr)] lg:px-10">
            {/* El ojo, decorativo: acompaña la invitación, no una señal ni un nombre. */}
            <OjoPixel animado tamano={220} className="h-auto w-16 sm:w-24 lg:w-36" />
            <div className="min-w-0">
              <h2 id="participar-titulo" className="max-w-[26ch] text-balance font-display text-cifra font-bold leading-[1.08] sm:text-titulo">
                {enCola != null && enCola > 0 ? `Hay ${numero(enCola)} contratos esperando que alguien los lea.` : "Empieza por los contratos de tu región."}
              </h2>
              <p className="mt-2 max-w-[62ch] text-pretty text-cuerpo leading-relaxed text-paper/80">
                No hace falta ser experto para vigilar. Detrás de cada contrato hay una pista, un colegio o un hospital: elige cómo
                sumarte.
              </p>
            </div>
          </div>
          <ul className="grid divide-y divide-paper/15 border-t border-paper/15 md:grid-cols-3 md:divide-x md:divide-y-0" aria-label="Cómo sumarte">
            {MANERAS.map(({ Icono, titulo, texto, accion, otra }, i) => (
              <li key={titulo} className="flex flex-col px-5 py-4 sm:px-8 sm:py-5 lg:px-6 xl:px-8">
                <h3 className="flex items-center gap-2.5 font-display text-bloque font-bold leading-tight">
                  <Icono size={19} className="shrink-0 text-maiz" aria-hidden />
                  {titulo}
                </h3>
                <p className="mt-1.5 text-meta leading-relaxed text-paper/80">
                  {texto}
                  {/* La acción secundaria va en el texto: al lado del botón no entraba y lo descolocaba de los otros dos. */}
                  {otra && (
                    <>
                      {" "}
                      <Link href={otra.href} className="inline-flex items-center gap-0.5 font-semibold text-maiz underline-offset-4 hover:underline">
                        {otra.texto} <ArrowUpRight size={12} aria-hidden />
                      </Link>
                    </>
                  )}
                </p>
                <div className="mt-auto pt-4">
                  <EnlaceAccion href={accion.href} variante={i === 0 ? "oscuro" : "contornoOscuro"} tamano="sm">
                    {accion.texto}
                  </EnlaceAccion>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* ── 2. Lo que sostiene el aporte ── */}
        <div className={costos ? "grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]" : undefined}>
          {costos && (
            <div className="tarjeta rounded-2xl border border-line bg-paper p-4 sm:p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h3 className="font-display text-bloque font-bold leading-tight text-ink">Lo que cuesta mantener Vigía</h3>
                <Link href="/app/apoyar?seccion=costos" className="inline-flex min-h-10 items-center gap-1 text-dato font-semibold text-granate underline-offset-4 hover:underline">
                  Cuánto cuesta y quién paga <ArrowUpRight size={13} aria-hidden />
                </Link>
              </div>
              <CifrasEnFila items={costos} className="mt-3" />
            </div>
          )}
          <div className="rounded-2xl border border-line bg-paperSoft p-4 sm:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h3 className="flex items-center gap-2 font-display text-bloque font-bold leading-tight text-ink">
                <ShieldCheck size={18} className="shrink-0 text-granate" aria-hidden />
                Sostienes la vigilancia, no el resultado.
              </h3>
              <Link href="/app/apoyar" className="inline-flex min-h-10 items-center gap-1 text-dato font-semibold text-granate underline-offset-4 hover:underline">
                Todas las reglas <ArrowUpRight size={13} aria-hidden />
              </Link>
            </div>
            <ul className={costos ? "mt-3 space-y-2.5" : "mt-3 grid gap-3 md:grid-cols-3"}>
              {REGLAS.map(({ Icono, titulo, detalle }) => (
                <li key={titulo} className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-paper text-granate" aria-hidden>
                    <Icono size={16} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-dato font-semibold leading-snug text-ink">{titulo}</span>
                    <span className="block text-meta leading-snug text-inkSoft">{detalle}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* ── 3. Los últimos aportes y otros países ── */}
        {recientes && recientes.data.length > 0 && <CintaAportes items={recientes.data} total={recientes.total} />}
        <ExpansionSection />
      </div>
    </section>
  );
}
